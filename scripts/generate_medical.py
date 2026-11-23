import json, re, sys, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "Frontend"
sys.path.insert(0, str(ROOT))
from backend import ai, db, secrets_store

CAL = "e5a96ce8-0c49-4f6c-b3d2-d457611d4dc5"
system = (
    'You list real medical awareness days. Return JSON only: '
    '{"events":[{"name":"","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD",'
    '"short_description":"","category":"Awareness day","event_kind":"official_observance",'
    '"importance":"high","source_url":""}]} '
    "Dates must be between 2026-11-04 and 2026-12-31 inclusive. India/WHO observances. Do not invent dates."
)
user = "Upcoming medical awareness days India rest of 2026 Nov-Dec. Include World Diabetes Day, World AIDS Day, Universal Health Coverage Day if they fall in range."

conn = db.connect()
row = dict(conn.execute("SELECT * FROM ai_providers WHERE id='prov-gemini'").fetchone())
key = secrets_store.get_key("prov-gemini")
r = ai.run_text(row, key, system, user, True)
print("ms", r["ms"], "chars", len(r["text"]))
text = r["text"]
m = re.search(r"\{[\s\S]*\}", text)
if not m:
    print("NO JSON", text[:400])
    raise SystemExit(1)
data = json.loads(m.group(0))
events = data.get("events") or []
print("parsed", len(events))
n = 0
for e in events:
    name = (e.get("name") or "").strip()
    start = (e.get("start_date") or e.get("date") or "")[:10]
    end = (e.get("end_date") or start)[:10]
    if not name or not start:
        continue
    if start < "2026-11-04" or start > "2026-12-31":
        print("skip out of range", start, name)
        continue
    eid = str(uuid.uuid4())
    try:
        conn.execute(
            """INSERT INTO events(id,calendar_id,name,short_description,category,start_date,end_date,
               event_kind,source_url,approval_status,verification_status)
               VALUES (?,?,?,?,?,?,?,?,?,'approved','source_provided')""",
            (
                eid, CAL, name, (e.get("short_description") or "")[:400],
                e.get("category") or "Awareness day", start, end,
                e.get("event_kind") or "official_observance", e.get("source_url") or "",
            ),
        )
        n += 1
        print("saved", start, name)
    except Exception as ex:
        print("dup/err", name, ex)
print("inserted", n)
print("total", conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])
conn.close()
