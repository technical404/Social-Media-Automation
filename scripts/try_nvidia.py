import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import ai, db, secrets_store
conn = db.connect()
row = dict(conn.execute("SELECT * FROM ai_providers WHERE id='prov-nvidia'").fetchone())
key = secrets_store.get_key("prov-nvidia")
for m in ["google/gemma-3-4b-it", "google/gemma-3-12b-it", "mistralai/mistral-7b-instruct-v0.3", "nv-mistralai/mistral-nemo-12b-instruct"]:
    p = {**row, "model_id": m}
    try:
        r = ai.run_text(p, key, "Say PONG", "ping", False)
        print("OK", m, r["ms"], r["text"][:50].replace("\n"," "))
        conn.execute("UPDATE ai_providers SET model_id=? WHERE id='prov-nvidia'", (m,))
        break
    except Exception as e:
        print("NO", m, str(e)[:120])
conn.close()
