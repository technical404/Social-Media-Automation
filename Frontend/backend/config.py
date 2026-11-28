"""Paths and settings. Everything lives under the project's data/ folder unless SOCIALAI_DATA_DIR is set."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SOCIALAI_DATA_DIR", ROOT / "data")).resolve()
DB_PATH = DATA_DIR / "socialai.sqlite"
SECRETS_PATH = DATA_DIR / "secrets.json"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"
RUNTIME_DIR = DATA_DIR / "runtime"
MEDIA_DIR = DATA_DIR / "media"
MIGRATIONS_DIR = ROOT / "db" / "migrations"

HOST = "127.0.0.1"  # never listen on the network
PORT = int(os.environ.get("SOCIALAI_BACKEND_PORT", "8765"))
FRONTEND_PORT = int(os.environ.get("SOCIALAI_FRONTEND_PORT", "8080"))
# The provider redirects here. Register this exact URL in each developer app.
OAUTH_REDIRECT_URI = os.environ.get(
    "SOCIALAI_OAUTH_REDIRECT_URI", f"http://127.0.0.1:{PORT}/api/oauth/callback"
)
# Hosts the local API accepts. A public tunnel host is accepted only on the
# OAuth callback endpoint (see server._host_ok), never on data routes.
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "SOCIALAI_ALLOWED_ORIGINS",
        f"http://localhost:{FRONTEND_PORT},http://127.0.0.1:{FRONTEND_PORT}",
    ).split(",")
    if o.strip()
}


def ensure_dirs() -> None:
    for d in (DATA_DIR, BACKUP_DIR, LOG_DIR, RUNTIME_DIR, MEDIA_DIR):
        d.mkdir(parents=True, exist_ok=True)
