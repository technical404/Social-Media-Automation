"""OAuth unit tests: no network calls, real SQLite schema, real secret store.

Run: python -m unittest discover -s backend/tests -v
"""
import base64
import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="socialai-oauth-test-")
os.environ["SOCIALAI_DATA_DIR"] = TMP
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend import oauth, secrets_store  # noqa: E402

MIGRATIONS = ROOT / "db" / "migrations"


def make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript((MIGRATIONS / "004_clients.sql").read_text(encoding="utf-8"))
    conn.executescript((MIGRATIONS / "010_social_oauth.sql").read_text(encoding="utf-8"))
    conn.execute("INSERT INTO clients(id, name) VALUES ('c1', 'Acme')")
    conn.execute("INSERT INTO clients(id, name) VALUES ('c2', 'Other')")
    conn.commit()
    return conn


def ensure_connection(conn, client_id: str, platform: str) -> str:
    import uuid

    connection_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO social_connections(id, client_id, platform) VALUES (?,?,?)",
        (connection_id, client_id, platform),
    )
    conn.commit()
    return connection_id


class OAuthPureTest(unittest.TestCase):
    def test_pkce_challenge_matches_verifier(self):
        verifier, challenge = oauth.make_pkce()
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.assertEqual(challenge, expected)
        self.assertGreaterEqual(len(verifier), 43)

    def test_authorize_url_contains_state_scope_and_pkce(self):
        url = oauth.build_authorize_url(
            "x", "client-1", "http://127.0.0.1:8765/api/oauth/callback", "tweet.read", "state-1", "challenge-1"
        )
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(query["client_id"], ["client-1"])
        self.assertEqual(query["redirect_uri"], ["http://127.0.0.1:8765/api/oauth/callback"])
        self.assertEqual(query["state"], ["state-1"])
        self.assertEqual(query["scope"], ["tweet.read"])
        self.assertEqual(query["code_challenge"], ["challenge-1"])
        self.assertEqual(query["code_challenge_method"], ["S256"])

    def test_tiktok_uses_client_key(self):
        url = oauth.build_authorize_url("tiktok", "key-1", "https://example.com/cb", "user.info.basic", "s")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(query["client_key"], ["key-1"])
        self.assertNotIn("client_id", query)

    def test_redirect_uri_rules(self):
        oauth.validate_redirect_uri("http://127.0.0.1:8765/api/oauth/callback")
        oauth.validate_redirect_uri("http://localhost:8765/api/oauth/callback")
        oauth.validate_redirect_uri("https://example.com/oauth/callback")
        for bad in ("http://example.com/cb", "javascript:alert(1)", "ftp://127.0.0.1/cb"):
            with self.assertRaises(oauth.OAuthError):
                oauth.validate_redirect_uri(bad)

    def test_token_endpoint_auth_modes(self):
        redirect = "http://127.0.0.1:8765/api/oauth/callback"
        captured: dict = {}

        def fake_request(url, *, headers=None, form=None, method="GET", timeout=0):
            captured.update(
                {"url": url, "headers": headers or {}, "form": form or {}, "method": method}
            )
            return {"access_token": "tok", "expires_in": 3600}

        original = oauth._request_json
        oauth._request_json = fake_request
        try:
            # Secret in the body (LinkedIn, Google, Meta).
            oauth.exchange_code(
                "linkedin", {"app_client_id": "li", "client_secret": "secret"}, "code", redirect, None
            )
            self.assertEqual(captured["form"]["client_id"], "li")
            self.assertEqual(captured["form"]["client_secret"], "secret")
            self.assertEqual(captured["form"]["code"], "code")
            self.assertEqual(captured["form"]["redirect_uri"], redirect)
            self.assertNotIn("Authorization", captured["headers"])

            # HTTP Basic (Pinterest); the secret must not be in the body.
            oauth.exchange_code(
                "pinterest", {"app_client_id": "pin", "client_secret": "secret"}, "code", redirect, None
            )
            self.assertNotIn("client_id", captured["form"])
            self.assertNotIn("client_secret", captured["form"])
            decoded = base64.b64decode(captured["headers"]["Authorization"].split(" ", 1)[1]).decode()
            self.assertEqual(decoded, "pin:secret")

            # Public X client with PKCE and no secret.
            oauth.exchange_code("x", {"app_client_id": "x", "client_secret": ""}, "code", redirect, "verifier")
            self.assertEqual(captured["form"]["client_id"], "x")
            self.assertEqual(captured["form"]["code_verifier"], "verifier")
            self.assertNotIn("Authorization", captured["headers"])

            # TikTok uses client_key/client_secret in the body.
            oauth.exchange_code(
                "tiktok", {"app_client_id": "tt", "client_secret": "secret"}, "code", redirect, "verifier"
            )
            self.assertEqual(captured["form"]["client_key"], "tt")
            self.assertEqual(captured["form"]["client_secret"], "secret")
            self.assertEqual(captured["form"]["code_verifier"], "verifier")
        finally:
            oauth._request_json = original

    def test_refresh_keeps_scope_and_refresh_token_when_provider_omits_them(self):
        captured: dict = {}

        def fake_request(url, *, headers=None, form=None, method="GET", timeout=0):
            captured.update({"form": form or {}})
            return {"access_token": "new-token", "expires_in": 3600}

        original = oauth._request_json
        oauth._request_json = fake_request
        try:
            result = oauth.refresh_access_token(
                "linkedin",
                {"app_client_id": "li", "client_secret": "secret"},
                {"access_token": "old", "refresh_token": "ref", "scope": "openid profile"},
            )
        finally:
            oauth._request_json = original
        self.assertEqual(captured["form"]["grant_type"], "refresh_token")
        self.assertEqual(result["access_token"], "new-token")
        self.assertEqual(result["refresh_token"], "ref")
        self.assertEqual(result["scope"], "openid profile")


class OAuthDataTest(unittest.TestCase):
    def test_save_app_keeps_secret_out_of_sqlite(self):
        conn = make_conn()
        result = oauth.save_app(
            conn,
            {
                "platform": "facebook",
                "client_id": None,
                "app_client_id": "meta-app-id",
                "client_secret": "super-secret-value",
                "redirect_uri": "http://127.0.0.1:8765/api/oauth/callback",
                "scopes": "pages_show_list",
            },
        )
        row = conn.execute("SELECT * FROM social_oauth_apps WHERE id = ?", (result["id"],)).fetchone()
        self.assertEqual(row["app_client_id"], "meta-app-id")
        self.assertEqual(row["has_client_secret"], 1)
        self.assertNotIn("super-secret-value", repr(dict(row)))
        self.assertEqual(secrets_store.get_key(f"oauth-app:{result['id']}"), "super-secret-value")

    def test_client_app_overrides_workspace_app(self):
        conn = make_conn()
        oauth.save_app(
            conn,
            {"platform": "facebook", "client_id": None, "app_client_id": "global", "client_secret": "gsecret"},
        )
        oauth.save_app(
            conn,
            {"platform": "facebook", "client_id": "c1", "app_client_id": "client", "client_secret": "csecret"},
        )
        self.assertEqual(oauth.resolve_app(conn, "facebook", "c1")["app_client_id"], "client")
        self.assertEqual(oauth.resolve_app(conn, "facebook", "c2")["app_client_id"], "global")

    def test_delete_app_removes_override_and_secret(self):
        conn = make_conn()
        app = oauth.save_app(
            conn,
            {"platform": "facebook", "client_id": "c1", "app_client_id": "client-app", "client_secret": "secret"},
        )
        oauth.delete_app(conn, "facebook", "c1")
        self.assertIsNone(secrets_store.get_key(f"oauth-app:{app['id']}"))
        self.assertEqual(conn.execute("SELECT * FROM social_oauth_apps").fetchall(), [])
        oauth.delete_app(conn, "facebook", "c1")  # idempotent

        workspace = oauth.save_app(
            conn,
            {"platform": "linkedin", "client_id": None, "app_client_id": "ws-app", "client_secret": "secret"},
        )
        oauth.delete_app(conn, "linkedin", None)
        self.assertIsNone(secrets_store.get_key(f"oauth-app:{workspace['id']}"))
        self.assertEqual(conn.execute("SELECT * FROM social_oauth_apps").fetchall(), [])

    def test_begin_requires_secret_except_for_public_x(self):
        conn = make_conn()
        oauth.save_app(conn, {"platform": "linkedin", "client_id": None, "app_client_id": "li-id"})
        linkedin_connection = ensure_connection(conn, "c1", "linkedin")
        with self.assertRaises(oauth.OAuthError):
            oauth.begin(conn, linkedin_connection)
        oauth.save_app(conn, {"platform": "x", "client_id": None, "app_client_id": "x-id"})
        x_connection = ensure_connection(conn, "c1", "x")
        url = oauth.begin(conn, x_connection)
        self.assertIn("state=", url)

    def test_complete_marks_connected_and_stores_token(self):
        conn = make_conn()
        oauth.save_app(
            conn,
            {
                "platform": "linkedin",
                "client_id": None,
                "app_client_id": "li-id",
                "client_secret": "li-secret",
                "redirect_uri": "http://127.0.0.1:8765/api/oauth/callback",
            },
        )
        connection_id = ensure_connection(conn, "c1", "linkedin")
        url = oauth.begin(conn, connection_id)
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["state"][0]

        original_exchange, original_profile = oauth.exchange_code, oauth.fetch_profile
        oauth.exchange_code = lambda *a, **k: {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "token_type": "Bearer",
            "scope": "openid profile",
            "expires_at": None,
        }
        oauth.fetch_profile = lambda *a, **k: {"external_id": "42", "display_name": "Acme Page", "handle": "acme"}
        try:
            status, page = oauth.complete(conn, {"state": state, "code": "code-1"})
        finally:
            oauth.exchange_code, oauth.fetch_profile = original_exchange, original_profile

        self.assertEqual(status, 200)
        self.assertIn("connected", page.lower())
        row = conn.execute("SELECT * FROM social_connections WHERE id = ?", (connection_id,)).fetchone()
        self.assertEqual(row["status"], "connected")
        self.assertEqual(row["handle"], "acme")
        self.assertEqual(row["external_id"], "42")
        stored = secrets_store.get_key(f"oauth-token:{connection_id}")
        self.assertIn("access-123", stored or "")
        self.assertIn("refresh-123", stored or "")

    def test_complete_rejects_unknown_state(self):
        conn = make_conn()
        status, _ = oauth.complete(conn, {"state": "not-a-real-state", "code": "x"})
        self.assertEqual(status, 400)

    def test_disconnect_and_cleanup_delete_tokens(self):
        conn = make_conn()
        oauth.save_app(
            conn,
            {"platform": "facebook", "client_id": "c1", "app_client_id": "app", "client_secret": "secret"},
        )
        connection_id = ensure_connection(conn, "c1", "facebook")
        oauth._save_token(connection_id, {"access_token": "tok", "refresh_token": "ref"})
        oauth.disconnect(conn, connection_id)
        row = conn.execute("SELECT * FROM social_connections WHERE id = ?", (connection_id,)).fetchone()
        self.assertEqual(row["status"], "not_connected")
        self.assertIsNone(secrets_store.get_key(f"oauth-token:{connection_id}"))

        app = conn.execute("SELECT id FROM social_oauth_apps WHERE client_id = 'c1'").fetchone()
        oauth._save_token(connection_id, {"access_token": "tok"})
        removed = oauth.cleanup_client(conn, "c1")
        self.assertEqual(removed, 1)
        self.assertIsNone(secrets_store.get_key(f"oauth-token:{connection_id}"))
        self.assertIsNone(secrets_store.get_key(f"oauth-app:{app['id']}"))

    def test_reconcile_marks_rows_without_stored_secrets(self):
        conn = make_conn()
        app = oauth.save_app(
            conn,
            {"platform": "facebook", "client_id": None, "app_client_id": "app", "client_secret": "secret"},
        )
        connection_id = ensure_connection(conn, "c1", "facebook")
        oauth._save_token(connection_id, {"access_token": "tok"})
        oauth._mark_connected(conn, connection_id, "facebook", {"access_token": "tok"}, {"display_name": "Acme"})

        # Simulate restoring a DB backup on another PC: the encrypted store is gone.
        secrets_store.set_key(f"oauth-app:{app['id']}", "")
        secrets_store.set_key(f"oauth-token:{connection_id}", "")

        self.assertEqual(oauth.reconcile_connections(conn), 1)
        row = conn.execute("SELECT * FROM social_connections WHERE id = ?", (connection_id,)).fetchone()
        self.assertEqual(row["status"], "not_connected")
        self.assertIn("Reconnect", row["last_error"])
        app_row = conn.execute("SELECT * FROM social_oauth_apps WHERE id = ?", (app["id"],)).fetchone()
        self.assertEqual(app_row["has_client_secret"], 0)

        # A connection whose token is still present stays connected.
        other = ensure_connection(conn, "c2", "facebook")
        oauth._save_token(other, {"access_token": "still-here"})
        oauth._mark_connected(conn, other, "facebook", {"access_token": "still-here"}, {})
        self.assertEqual(oauth.reconcile_connections(conn), 0)
        other_row = conn.execute("SELECT status FROM social_connections WHERE id = ?", (other,)).fetchone()
        self.assertEqual(other_row["status"], "connected")

    def test_reconcile_marks_undecryptable_tokens(self):
        conn = make_conn()
        connection_id = ensure_connection(conn, "c1", "facebook")
        oauth._save_token(connection_id, {"access_token": "tok"})
        oauth._mark_connected(conn, connection_id, "facebook", {"access_token": "tok"}, {})

        original = secrets_store.get_key

        def broken(key):
            if key == f"oauth-token:{connection_id}":
                raise OSError("simulated DPAPI failure")
            return original(key)

        secrets_store.get_key = broken
        try:
            self.assertEqual(oauth.reconcile_connections(conn), 1)
        finally:
            secrets_store.get_key = original

        row = conn.execute("SELECT * FROM social_connections WHERE id = ?", (connection_id,)).fetchone()
        self.assertEqual(row["status"], "not_connected")
        self.assertIn("decrypt", row["last_error"])


if __name__ == "__main__":
    unittest.main()
