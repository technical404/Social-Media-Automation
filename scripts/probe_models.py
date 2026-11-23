import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import ai, db, secrets_store

conn = db.connect()

def try_one(pid, model=None, extra=None):
    row = conn.execute("SELECT * FROM ai_providers WHERE id=?", (pid,)).fetchone()
    p = dict(row)
    if model:
        p["model_id"] = model
    if extra:
        p.update(extra)
    key = secrets_store.get_key(pid)
    try:
        r = ai.run_text(p, key, "Reply with PONG only.", "ping", False)
        print("OK", pid, p["model_id"], r["ms"], (r["text"] or "")[:60].replace("\n", " "))
        return True
    except Exception as e:
        print("NO", pid, p["model_id"], str(e)[:160].replace("\n", " "))
        return False

nvidia_models = [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-70b-instruct",
    "google/gemma-2-9b-it",
    "google/gemma-2-2b-it",
    "mistralai/mistral-7b-instruct-v0.3",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "microsoft/phi-3.5-mini-instruct",
    "qwen/qwen2.5-7b-instruct",
]
print("== nvidia ==")
ok_n = None
for m in nvidia_models:
    if try_one("prov-nvidia", m):
        ok_n = m
        break
print("nvidia pick", ok_n)

print("== groq ==")
for m in ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"]:
    if try_one("prov-groq", m):
        break

print("== gemini models ==")
for m in ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-pro", "gemini-2.0-flash-lite"]:
    if try_one("prov-gemini", m):
        break

conn.close()
