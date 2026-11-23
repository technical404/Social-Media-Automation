import json, sys, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import secrets_store

key = secrets_store.get_key("prov-nvidia")
req = urllib.request.Request(
    "https://integrate.api.nvidia.com/v1/models",
    headers={"Authorization": f"Bearer {key}"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    ids = [x.get("id") for x in data.get("data", [])][:40]
    print("count", len(data.get("data", [])))
    for i in ids:
        print(i)
except Exception as e:
    print("list fail", e)
    if hasattr(e, "read"):
        print(e.read()[:300])
