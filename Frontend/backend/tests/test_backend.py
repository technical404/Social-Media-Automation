"""Run: python -m unittest discover -s backend/tests -v"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="socialai-test-")
os.environ["SOCIALAI_DATA_DIR"] = TMP
os.environ["SOCIALAI_BACKEND_PORT"] = "8799"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import auth, config, db, secrets_store, server  # noqa: E402

BASE = "http://127.0.0.1:8799"
ORIGIN = "http://localhost:8080"


def call(path, body=None, token=None, origin=ORIGIN, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method="POST" if data is not None else "GET")
    if origin:
        req.add_header("Origin", origin)
    if token:
        req.add_header("X-SocialAI-Token", token)
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            b = r.read()
            return r.status, (json.loads(b) if r.headers.get("Content-Type") == "application/json" else b)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class BackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        threading.Thread(target=server.serve, daemon=True).start()
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/api/health", timeout=0.5)
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.1)
        cls.token = call("/api/session")[1]["token"]

    def test_health_reports_schema_and_worker(self):
        code, h = call("/api/health")
        self.assertEqual(code, 200)
        self.assertIn(h["schema"], (
            "001_init", "002_content", "003_provider_comments", "004_clients",
            "005_client_calendars", "006_global_calendar", "007_client_event_ownership",
            "008_topic_calendar", "009_client_social_handles",
        ))
        self.assertTrue(h["worker"]["running"])

    def test_other_websites_are_refused(self):
        code, _ = call("/api/session", origin="https://evil.example")
        self.assertEqual(code, 403)

    def test_token_required_for_data(self):
        code, _ = call("/api/db/query", {"sql": "SELECT 1", "params": []})
        self.assertEqual(code, 401)

    def test_query_and_transaction_rollback(self):
        t = self.token
        call("/api/db/query", {"sql": "INSERT INTO calendars(id,name) VALUES ('c1','Med')", "params": []}, t)
        code, _ = call("/api/db/batch", {"statements": [
            {"sql": "INSERT INTO events(id,calendar_id,name,start_date,end_date) VALUES ('e1','c1','A','2027-01-01','2027-01-01')", "params": []},
            {"sql": "INSERT INTO events(id,calendar_id,name,start_date,end_date) VALUES ('e2','c1','a','2027-01-01','2027-01-01')", "params": []},
        ]}, t)
        self.assertEqual(code, 409)  # duplicate -> whole batch rolled back
        _, r = call("/api/db/query", {"sql": "SELECT COUNT(*) AS n FROM events", "params": []}, t)
        self.assertEqual(r["rows"][0]["n"], 0)

    def test_dangerous_sql_blocked(self):
        code, _ = call("/api/db/query", {"sql": "ATTACH DATABASE 'x.db' AS x", "params": []}, self.token)
        self.assertEqual(code, 403)
        code, _ = call("/api/db/query", {"sql": "PRAGMA writable_schema = 1", "params": []}, self.token)
        self.assertEqual(code, 403)

    def test_api_keys_are_never_returned(self):
        code, r = call("/api/secrets", {"provider_id": "p1", "api_key": "sk-test-1234567890ABCD"}, self.token)
        self.assertEqual(code, 200)
        self.assertEqual(r["hint"], "••••ABCD")
        self.assertNotIn("1234567890", config.SECRETS_PATH.read_text())  # stored encoded, not plain
        self.assertEqual(secrets_store.get_key("p1"), "sk-test-1234567890ABCD")

    def test_backup_download_and_restore(self):
        t = self.token
        call("/api/db/query", {"sql": "INSERT OR IGNORE INTO calendars(id,name) VALUES ('keep','Keep me')", "params": []}, t)
        code, data = call("/api/backup/download", token=t)
        self.assertEqual(code, 200)
        self.assertTrue(data.startswith(b"SQLite format 3"))
        call("/api/db/query", {"sql": "DELETE FROM calendars WHERE id='keep'", "params": []}, t)
        code, r = call("/api/backup/restore", token=t, raw=data, ctype="application/octet-stream")
        self.assertEqual(code, 200)
        self.assertTrue(Path(r["safety_backup"]).exists())
        _, q = call("/api/db/query", {"sql": "SELECT name FROM calendars WHERE id='keep'", "params": []}, t)
        self.assertEqual(q["rows"][0]["name"], "Keep me")

    def test_restore_rejects_non_sqlite(self):
        code, _ = call("/api/backup/restore", token=self.token, raw=b"not a db" * 10, ctype="application/octet-stream")
        self.assertEqual(code, 400)


class AuthTest(unittest.TestCase):
    def test_hash_roundtrip(self):
        h = auth.hash_password("correct-horse-battery")
        self.assertTrue(auth.verify_password("correct-horse-battery", h))
        self.assertFalse(auth.verify_password("wrong-password-xx", h))

    def test_short_password_rejected(self):
        with self.assertRaises(ValueError):
            auth.hash_password("short")


if __name__ == "__main__":
    unittest.main()
