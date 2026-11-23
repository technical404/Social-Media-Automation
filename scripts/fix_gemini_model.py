import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import db
conn = db.connect()
conn.execute("UPDATE ai_providers SET model_id=?, is_default=1, fallback_priority=5 WHERE id='prov-gemini'", ("gemini-2.5-flash",))
conn.execute("UPDATE ai_providers SET is_default=0 WHERE id!='prov-gemini'")
print("updated", conn.execute("SELECT id,model_id,is_default FROM ai_providers").fetchall())
conn.close()
