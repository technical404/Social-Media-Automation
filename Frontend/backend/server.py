"""Local HTTP API on 127.0.0.1 only. Run with: python -m backend.server"""
import json
import logging
import re
import secrets as pysecrets
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import VERSION, ai, config, db, secrets_store

log = logging.getLogger("socialai.backend")
TOKEN = pysecrets.token_urlsafe(32)
CONN = None  # set in serve()
WORKER = {"running": False, "heartbeat_at": None}
MAX_BODY = 200 * 1024 * 1024

FORBIDDEN_SQL = re.compile(r"\b(ATTACH|DETACH|LOAD_EXTENSION|VACUUM\s+INTO)\b", re.I)
PRAGMA_SQL = re.compile(r"^\s*PRAGMA\b", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def check_sql(sql: str) -> None:
    if FORBIDDEN_SQL.search(sql):
        raise PermissionError("This SQL statement is not allowed through the local API.")
    if PRAGMA_SQL.match(sql) and not re.match(r"^\s*PRAGMA\s+(integrity_check|foreign_key_check|table_info)\b", sql, re.I):
        raise PermissionError("Only read-only PRAGMA checks are allowed.")


def rows_of(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()] if cur.description else []


class Handler(BaseHTTPRequestHandler):
    server_version = f"SocialAIStudio/{VERSION}"

    def log_message(self, fmt, *args):  # route to our logger, never log bodies
        log.info("%s %s", self.address_string(), fmt % args)

    # ---------- security ----------
    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in config.ALLOWED_ORIGINS

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        return host in {f"127.0.0.1:{config.PORT}", f"localhost:{config.PORT}"}

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in config.ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-SocialAI-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, code: int, payload, raw: bytes | None = None, ctype="application/json"):
        body = raw if raw is not None else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code: int, msg: str):
        self._send(code, {"error": msg})

    def _guard(self, need_token=True) -> bool:
        if not self._host_ok():
            self._err(403, "Bad host.")
            return False
        if not self._origin_ok():
            self._err(403, "This page is not allowed to use the local backend.")
            return False
        if need_token and not pysecrets.compare_digest(self.headers.get("X-SocialAI-Token", ""), TOKEN):
            self._err(401, "Missing or wrong session token.")
            return False
        return True

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Request too large.")
        return self.rfile.read(n) if n else b""

    def _json(self) -> dict:
        b = self._body()
        return json.loads(b.decode("utf-8")) if b else {}

    # ---------- routes ----------
    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._err(403, "Origin not allowed.")
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            if not self._guard(need_token=False):
                return
            return self._send(200, {
                "ok": True, "version": VERSION, "db_path": str(config.DB_PATH), "schema": db.schema_version(CONN),
                "worker": WORKER, "time": now_iso(),
            })
        if path == "/api/session":
            if not self._guard(need_token=False):
                return
            return self._send(200, {"token": TOKEN})
        if not self._guard():
            return
        if path == "/api/backup/download":
            with tempfile.TemporaryDirectory() as td:
                p = db.backup_to(CONN, Path(td) / "backup.sqlite")
                data = p.read_bytes()
            db.new_backup(CONN, "download")
            return self._send(200, None, raw=data, ctype="application/x-sqlite3")
        return self._err(404, "Not found.")

    def do_POST(self):
        path = self.path.split("?")[0]
        if not self._guard():
            return
        try:
            if path == "/api/db/query":
                d = self._json()
                check_sql(d["sql"])
                with db._lock:
                    cur = CONN.execute(d["sql"], d.get("params") or [])
                    rows = rows_of(cur)
                    return self._send(200, {"rows": rows, "changes": max(cur.rowcount, 0)})
            if path == "/api/db/batch":
                stmts = self._json().get("statements") or []
                for s in stmts:
                    check_sql(s["sql"])
                with db._lock:
                    CONN.execute("BEGIN")
                    try:
                        for s in stmts:
                            CONN.execute(s["sql"], s.get("params") or [])
                        CONN.execute("COMMIT")
                    except Exception:
                        CONN.execute("ROLLBACK")
                        raise
                return self._send(200, {"ok": True, "count": len(stmts)})
            if path == "/api/integrity":
                return self._send(200, {"result": db.integrity(CONN)})
            if path == "/api/backup/restore":
                data = self._body()
                with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite") as f:
                    f.write(data)
                    tmp = Path(f.name)
                try:
                    safety = db.restore_from(CONN, tmp)
                finally:
                    tmp.unlink(missing_ok=True)
                return self._send(200, {"ok": True, "safety_backup": str(safety)})
            if path == "/api/secrets":
                d = self._json()
                pid, key = str(d["provider_id"]), str(d.get("api_key") or "").strip()
                if len(key) > 500:
                    raise ValueError("Key too long.")
                secrets_store.set_key(pid, key)
                return self._send(200, {"ok": True, "hint": secrets_store.mask(key)})
            if path == "/api/ai/models":
                d = self._json()
                row = CONN.execute("SELECT * FROM ai_providers WHERE id = ?", (d["provider_id"],)).fetchone()
                if not row:
                    return self._send(200, {"ok": False, "error": "Provider not found."})
                p = dict(row)
                key = secrets_store.get_key(p["id"])
                try:
                    models = ai.list_models(p, key)
                    return self._send(200, {"ok": True, "models": models})
                except ai.ProviderError as e:
                    return self._send(200, {"ok": False, "error": str(e), "kind": e.kind, "status": e.status})
            if path == "/api/ai/run":
                d = self._json()
                row = CONN.execute("SELECT * FROM ai_providers WHERE id = ?", (d["provider_id"],)).fetchone()
                if not row:
                    return self._send(200, {"ok": False, "error": "Provider not found."})
                p = dict(row)
                key = secrets_store.get_key(p["id"])
                try:
                    r = ai.run_text(p, key, str(d.get("system", ""))[:8000], str(d.get("user", ""))[:12000], bool(d.get("json")))
                    return self._send(200, {"ok": True, **r})
                except ai.ProviderError as e:
                    return self._send(200, {"ok": False, "error": str(e), "kind": e.kind, "status": e.status})
        except PermissionError as e:
            return self._err(403, str(e))
        except __import__("sqlite3").IntegrityError as e:
            return self._err(409, f"Conflict: {e}")
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            return self._err(400, f"Bad request: {e}")
        except Exception as e:  # noqa: BLE001
            log.exception("request failed")
            return self._err(500, f"Backend error: {e}")
        return self._err(404, "Not found.")


def process_due_posts():
    """Mark due scheduled posts failed unless a real platform adapter is configured.
    Never pretends a post was published."""
    with db._lock:
        rows = CONN.execute(
            "SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?",
            (now_iso(),),
        ).fetchall()
        for r in rows:
            CONN.execute(
                "UPDATE posts SET status='failed', fail_reason=?, updated_at=? WHERE id=?",
                (
                    "No official social OAuth credentials are configured. Post was not published.",
                    now_iso(),
                    r["id"],
                ),
            )


def worker_loop(stop: threading.Event):
    """Heartbeat plus due-post processing. Publishing requires real platform APIs."""
    WORKER["running"] = True
    while not stop.is_set():
        ts = now_iso()
        try:
            process_due_posts()
            with db._lock:
                CONN.execute(
                    "INSERT INTO scheduler_jobs(id, name, heartbeat_at, last_status) VALUES ('worker','worker',?, 'ok') "
                    "ON CONFLICT(name) DO UPDATE SET heartbeat_at = excluded.heartbeat_at, last_status = 'ok'",
                    (ts,),
                )
            WORKER["heartbeat_at"] = ts
        except Exception:  # noqa: BLE001
            log.exception("worker heartbeat failed")
        stop.wait(15)
    WORKER["running"] = False


def serve():
    global CONN
    config.ensure_dirs()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.FileHandler(config.LOG_DIR / "backend.log", encoding="utf-8"), logging.StreamHandler(sys.stdout)],
    )
    CONN = db.connect()
    applied = db.migrate(CONN)
    log.info("database %s ready (applied: %s)", config.DB_PATH, applied or "none")
    stop = threading.Event()
    threading.Thread(target=worker_loop, args=(stop,), daemon=True).start()
    httpd = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    log.info("backend listening on http://%s:%s (origins: %s)", config.HOST, config.PORT, ", ".join(sorted(config.ALLOWED_ORIGINS)))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        httpd.server_close()
        CONN.close()
        log.info("backend stopped")


if __name__ == "__main__":
    serve()
