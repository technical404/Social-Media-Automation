#!/usr/bin/env python3
"""SocialAI Studio launcher.

    python main.py            start backend + worker + frontend, open the browser
    python main.py --check    check Python, Node, dependencies, config and database
    python main.py --status   show what is running
    python main.py --stop     stop everything this launcher started
    python main.py --logs     show the latest log lines
    python main.py --backup   write a database backup to data/backups
    python main.py --restore FILE [--yes]   restore a backup (current DB is backed up first)
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend import config, db  # noqa: E402

PIDS = config.RUNTIME_DIR / "pids.json"
IS_WIN = sys.platform == "win32"


def say(ok: bool | None, msg: str):
    mark = {True: "[ OK ]", False: "[FAIL]", None: "[ .. ]"}[ok]
    print(f"{mark} {msg}", flush=True)


def which_npm() -> str | None:
    return shutil.which("npm.cmd" if IS_WIN else "npm") or shutil.which("npm")


def http_ok(url: str, timeout=1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:  # noqa: BLE001
        return False


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if IS_WIN:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_pids() -> dict:
    try:
        return json.loads(PIDS.read_text())
    except Exception:  # noqa: BLE001
        return {}


def kill_tree(pid: int):
    if IS_WIN:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except OSError:
            pass


# ---------------- commands ----------------
def check() -> bool:
    ok = True
    v = sys.version_info
    py_ok = v >= (3, 10)
    say(py_ok, f"Python {v.major}.{v.minor}.{v.micro} (need 3.10+)")
    ok &= py_ok
    npm = which_npm()
    node = shutil.which("node")
    say(bool(node and npm), f"Node.js {'found' if node else 'NOT found'} / npm {'found' if npm else 'NOT found'} (install Node 20+ from nodejs.org)")
    ok &= bool(node and npm)
    if node:
        nv = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        major = int(nv.lstrip("v").split(".")[0] or 0) if nv else 0
        say(major >= 20, f"Node version {nv} (need 20+)")
        ok &= major >= 20
    nm = (ROOT / "node_modules").exists()
    say(nm, "Frontend packages installed" if nm else "Frontend packages missing — run: npm install")
    ok &= nm
    say(config.MIGRATIONS_DIR.exists(), f"Schema files in {config.MIGRATIONS_DIR}")
    try:
        config.ensure_dirs()
        conn = db.connect()
        applied = db.migrate(conn)
        res = db.integrity(conn)
        say(res == "ok", f"Database {config.DB_PATH} — schema {db.schema_version(conn)}, integrity: {res}" + (f", applied {applied}" if applied else ""))
        ok &= res == "ok"
        conn.close()
    except Exception as e:  # noqa: BLE001
        say(False, f"Database error: {e}")
        ok = False
    for name, port in (("backend", config.PORT), ("frontend", config.FRONTEND_PORT)):
        busy = http_ok(f"http://127.0.0.1:{port}/")
        say(None, f"Port {port} ({name}) is {'IN USE' if busy else 'free'}")
    return ok


def status() -> int:
    pids = read_pids()
    be = http_ok(f"http://127.0.0.1:{config.PORT}/api/health")
    fe = http_ok(f"http://127.0.0.1:{config.FRONTEND_PORT}/")
    say(be, f"Backend  http://127.0.0.1:{config.PORT}  pid={pids.get('backend', '-')}")
    say(fe, f"Frontend http://localhost:{config.FRONTEND_PORT}  pid={pids.get('frontend', '-')}")
    if be:
        with urllib.request.urlopen(f"http://127.0.0.1:{config.PORT}/api/health", timeout=2) as r:
            h = json.loads(r.read())
        say(h["worker"]["running"], f"Worker heartbeat {h['worker']['heartbeat_at']}, schema {h['schema']}")
    return 0 if be and fe else 1


def stop() -> int:
    pids = read_pids()
    if not pids:
        say(None, "Nothing recorded as running.")
        return 0
    for name in ("frontend", "backend"):
        pid = pids.get(name)
        if pid and pid_alive(pid):
            kill_tree(pid)
            say(True, f"Stopped {name} (pid {pid})")
    PIDS.unlink(missing_ok=True)
    return 0


def logs(n=60) -> int:
    for f in sorted(config.LOG_DIR.glob("*.log")):
        print(f"===== {f} =====")
        lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        print("\n".join(lines[-n:]))
    return 0


def backup() -> int:
    config.ensure_dirs()
    conn = db.connect()
    db.migrate(conn)
    p = db.new_backup(conn, "manual")
    db.validate_backup(p)
    say(True, f"Backup written and verified: {p}")
    return 0


def restore(file: str, yes: bool) -> int:
    src = Path(file).resolve()
    if not src.exists():
        say(False, f"File not found: {src}")
        return 1
    if http_ok(f"http://127.0.0.1:{config.PORT}/api/health"):
        say(False, "Stop the app first: python main.py --stop")
        return 1
    db.validate_backup(src)
    if not yes and input(f"Replace the current database with {src.name}? A safety backup is made first. Type YES: ").strip() != "YES":
        say(None, "Restore cancelled.")
        return 1
    conn = db.connect()
    safety = db.restore_from(conn, src)
    say(True, f"Restored. Previous database saved as {safety}")
    return 0


def start(open_browser=True) -> int:
    if not check():
        say(False, "Fix the problems above, then run python main.py again.")
        return 1
    pids = read_pids()
    if any(pid_alive(pids.get(k, 0)) for k in ("backend", "frontend")) or http_ok(f"http://127.0.0.1:{config.PORT}/api/health"):
        say(False, "SocialAI Studio already looks like it is running. Use --status or --stop.")
        return 1
    config.ensure_dirs()
    kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN else {"start_new_session": True}
    be_log = open(config.LOG_DIR / "backend.stdout.log", "a", encoding="utf-8")
    fe_log = open(config.LOG_DIR / "frontend.log", "a", encoding="utf-8")
    be = subprocess.Popen([sys.executable, "-m", "backend.server"], cwd=ROOT, stdout=be_log, stderr=subprocess.STDOUT, **kw)
    fe_env = {**os.environ, "VITE_LOCAL_BACKEND_URL": f"http://127.0.0.1:{config.PORT}"}
    fe = subprocess.Popen([which_npm(), "run", "dev", "--", "--port", str(config.FRONTEND_PORT), "--host", "127.0.0.1", "--strictPort"],
                          cwd=ROOT, stdout=fe_log, stderr=subprocess.STDOUT, env=fe_env, **kw)
    PIDS.write_text(json.dumps({"backend": be.pid, "frontend": fe.pid, "started": time.time()}))
    say(None, "Starting backend and frontend…")
    deadline = time.time() + 90
    be_up = fe_up = False
    while time.time() < deadline and not (be_up and fe_up):
        if be.poll() is not None or fe.poll() is not None:
            break
        be_up = be_up or http_ok(f"http://127.0.0.1:{config.PORT}/api/health")
        fe_up = fe_up or http_ok(f"http://127.0.0.1:{config.FRONTEND_PORT}/")
        time.sleep(1)
    say(be_up, f"Backend on http://127.0.0.1:{config.PORT}")
    say(fe_up, f"Frontend on http://localhost:{config.FRONTEND_PORT}")
    if not (be_up and fe_up):
        say(False, "Startup failed. See: python main.py --logs")
        stop()
        return 1
    url = f"http://localhost:{config.FRONTEND_PORT}/dashboard"
    print(f"\n  SocialAI Studio is running → {url}\n  Press Ctrl+C to stop.\n", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        while be.poll() is None and fe.poll() is None:
            time.sleep(1)
        say(False, "A process exited unexpectedly. See: python main.py --logs")
    except KeyboardInterrupt:
        print()
    finally:
        stop()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="SocialAI Studio launcher")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true")
    g.add_argument("--status", action="store_true")
    g.add_argument("--stop", action="store_true")
    g.add_argument("--logs", action="store_true")
    g.add_argument("--backup", action="store_true")
    g.add_argument("--restore", metavar="FILE")
    ap.add_argument("--yes", action="store_true", help="skip the restore confirmation")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    if a.check:
        return 0 if check() else 1
    if a.status:
        return status()
    if a.stop:
        return stop()
    if a.logs:
        return logs()
    if a.backup:
        return backup()
    if a.restore:
        return restore(a.restore, a.yes)
    return start(not a.no_browser)


if __name__ == "__main__":
    sys.exit(main())
