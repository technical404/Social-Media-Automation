import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import ai, db, secrets_store

conn = db.connect()
rows = conn.execute("SELECT * FROM ai_providers WHERE id LIKE 'prov-%'").fetchall()
for row in rows:
    p = dict(row)
    key = secrets_store.get_key(p["id"])
    print("---", p["name"], p["model_id"], "key", "yes" if key else "NO")
    try:
        r = ai.run_text(p, key, "You are a tester.", "Reply with the single word PONG.", False)
        print("OK ms", r["ms"], "text", (r["text"] or "")[:80].replace("\n", " "))
    except Exception as e:
        print("FAIL", type(e).__name__, str(e)[:200])
conn.close()
