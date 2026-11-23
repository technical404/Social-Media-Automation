"""SQLite access, migrations, backup and restore."""
import re
import shutil
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from . import config

_lock = threading.RLock()


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or config.DB_PATH), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def migration_files() -> list[tuple[str, str]]:
    files = sorted(config.MIGRATIONS_DIR.glob("*.sql"))
    return [(f.stem, f.read_text(encoding="utf-8")) for f in files]


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Apply pending migrations in order inside transactions. Never drops data."""
    with _lock:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, "
            "applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
        )
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        applied = []
        for version, sql in migration_files():
            if version in done:
                continue
            body = re.sub(r"PRAGMA\s+foreign_keys\s*=\s*ON\s*;", "", sql, flags=re.I)
            try:
                conn.execute("BEGIN")
                for stmt in _split(body):
                    conn.execute(stmt)
                conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
                conn.execute("COMMIT")
                applied.append(version)
            except Exception as e:  # noqa: BLE001
                conn.execute("ROLLBACK")
                raise RuntimeError(f"Migration {version} failed: {e}") from e
        return applied


def _split(sql: str) -> list[str]:
    out, buf = [], []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        joined = "\n".join(buf)
        if joined.rstrip().endswith(";") and sqlite3.complete_statement(joined):
            out.append(joined.strip())
            buf = []
    if "\n".join(buf).strip():
        out.append("\n".join(buf).strip())
    return out


def schema_version(conn: sqlite3.Connection) -> str:
    try:
        r = conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()
        return r[0] or "none"
    except sqlite3.Error:
        return "none"


def integrity(conn: sqlite3.Connection) -> str:
    return str(conn.execute("PRAGMA integrity_check").fetchone()[0])


def backup_to(conn: sqlite3.Connection, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        target = sqlite3.connect(str(dest))
        try:
            conn.backup(target)
        finally:
            target.close()
    return dest


def new_backup(conn: sqlite3.Connection, label: str = "manual") -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return backup_to(conn, config.BACKUP_DIR / f"socialai-{label}-{stamp}.sqlite")


def validate_backup(path: Path) -> None:
    with open(path, "rb") as f:
        if f.read(16) != b"SQLite format 3\x00":
            raise ValueError("This file is not a SQLite database.")
    c = sqlite3.connect(str(path))
    try:
        res = c.execute("PRAGMA integrity_check").fetchone()[0]
        if res != "ok":
            raise ValueError(f"Backup failed the integrity check: {res}")
    finally:
        c.close()


def restore_from(conn: sqlite3.Connection, src: Path) -> Path:
    """Validate, keep a safety copy of the current DB, then copy the backup's contents in."""
    validate_backup(src)
    safety = new_backup(conn, "before-restore")
    with _lock:
        source = sqlite3.connect(str(src))
        try:
            source.backup(conn)
        finally:
            source.close()
        migrate(conn)
    return safety


def copy_file(src: Path, dest: Path) -> None:
    shutil.copy2(src, dest)
