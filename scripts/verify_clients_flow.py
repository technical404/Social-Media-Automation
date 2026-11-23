"""End-to-end check of the P1 model: one Global Calendar that client calendars reference.

Exercises the exact SQL the frontend repo issues against the running backend
(ensure the single global calendar -> seed built-ins -> client calendar with a region
scope -> project global events for that client -> per-client overrides -> cleanup).
Run the app first (`python main.py`), then: python scripts/verify_clients_flow.py
"""
import json
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:8765"
ORIGIN = "http://127.0.0.1:8080"


def _req(path, data=None, token=None):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Origin": ORIGIN}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["X-SocialAI-Token"] = token
    req = urllib.request.Request(f"{BASE}{path}", data=body, method="POST" if body is not None else "GET", headers=headers)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def q(sql, params=None):
    return _req("/api/db/query", {"sql": sql, "params": params or []}, TOKEN)["rows"]


def batch(statements):
    return _req("/api/db/batch", {"statements": statements}, TOKEN)


def expect(cond, msg):
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    print(f"  ok - {msg}")


def must_fail(sql, params, msg):
    try:
        q(sql, params)
    except urllib.error.HTTPError:
        print(f"  ok - {msg}")
        return
    raise SystemExit(f"FAIL: {msg} (statement unexpectedly succeeded)")


TOKEN = _req("/api/session")["token"]
health = _req("/api/health")
print("schema:", health["schema"])
expect(health["schema"] == "006_global_calendar", "migration 006 applied")

print("\n== the one Global Calendar ==")
# Mirrors repo.ensureGlobalCalendar: create the master calendar only if it is missing.
if not q("SELECT id FROM calendars WHERE is_global = 1"):
    q("INSERT INTO calendars(id,name,industry,region,theme,default_time,timezone,is_global,scope) VALUES (?,?,?,?,?,?,?,1,'GLOBAL')",
      [str(uuid.uuid4()), "Global Calendar", "", "Worldwide", "", "10:00", "Asia/Kolkata"])
g = q("SELECT id, scope FROM calendars WHERE is_global = 1")
expect(len(g) == 1, "exactly one global calendar exists")
gid = g[0]["id"]
expect(g[0]["scope"] == "GLOBAL", "the master calendar is worldwide")

# Mirrors repo.seedGlobalObservances for two fixed-date observances, one per year.
year = 2027
for name, scope, date, code in (
    ("India Independence Day", "IN", f"{year}-08-15", f"IN-INDIA-INDEPENDENCE-DAY-0815"),
    ("US Independence Day", "US", f"{year}-07-04", f"US-US-INDEPENDENCE-DAY-0704"),
):
    existing = q("SELECT id FROM events WHERE event_code = ? AND substr(start_date,1,4) = ?", [code, str(year)])
    if not existing:
        q("INSERT INTO events(id,calendar_id,name,short_description,category,start_date,end_date,importance,event_kind,scope,event_code,approval_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'approved')",
          [str(uuid.uuid4()), gid, name, "", "Holiday", date, date, "medium", "official_observance", scope, code])
expect(len(q("SELECT id FROM events WHERE calendar_id = ? AND event_code IS NOT NULL", [gid])) >= 2, "built-in observances live in the global calendar")

print("\n== stable event codes ==")
must_fail("INSERT INTO events(id,calendar_id,name,start_date,end_date,event_code) VALUES (?,?,?,?,?,?)",
          [str(uuid.uuid4()), gid, "India Independence Day", f"{year}-08-15", f"{year}-08-15", "IN-INDIA-INDEPENDENCE-DAY-0815"],
          "the same observance code is refused twice in one year")

print("\n== a client calendar references the global one ==")
cid = str(uuid.uuid4())
q("INSERT INTO clients(id,name,description,industry,timezone,default_time,scope) VALUES (?,?,?,?,?,?,?)",
  [cid, "Verify Client", "e2e", "Healthcare", "Asia/Kolkata", "10:00", "IN"])
calid = str(uuid.uuid4())
q("INSERT INTO calendars(id,name,region,theme,default_time,timezone,client_id,is_global,scope) VALUES (?,?,?,?,?,?,?,0,?)",
  [calid, "Verify Client Calendar", "India", "", "10:00", "Asia/Kolkata", cid, "IN"])
expect(q("SELECT id FROM calendars WHERE client_id = ?", [cid])[0]["id"] == calid, "client calendar linked via calendars.client_id")
expect(q("SELECT id FROM calendars WHERE is_global = 1 AND id = ?", [calid]) == [], "the client calendar is not a global calendar")
expect(q("SELECT COUNT(*) AS n FROM events WHERE calendar_id = ?", [calid])[0]["n"] == 0, "the client calendar holds no copies of events")

# The projection repo.listClientCalendarEvents builds: global events in scope, minus hidden.
projection = q(
    "SELECT e.id, e.name, e.scope FROM events e JOIN calendars c ON c.id = e.calendar_id "
    "LEFT JOIN client_event_state s ON s.event_id = e.id AND s.calendar_id = ? "
    "WHERE c.is_global = 1 AND (e.scope = 'GLOBAL' OR e.scope = ?) AND COALESCE(s.hidden,0) = 0",
    [calid, "IN"],
)
names = {r["name"] for r in projection}
expect("India Independence Day" in names, "the client sees its own region's observance")
expect("US Independence Day" not in names, "the client does not see another region's observance")
in_id = next(r["id"] for r in projection if r["name"] == "India Independence Day")

print("\n== per-client state only ==")
q("INSERT INTO client_event_state(calendar_id, event_id, time_override, approval_status) VALUES (?,?,?,?)",
  [calid, in_id, "18:30", "approved"])
expect(q("SELECT time_override FROM client_event_state WHERE calendar_id = ? AND event_id = ?", [calid, in_id])[0]["time_override"] == "18:30", "own posting time stored per client")
expect(q("SELECT time_override FROM events WHERE id = ?", [in_id])[0]["time_override"] is None, "the global event itself is untouched")
q("INSERT INTO client_event_state(calendar_id, event_id, hidden) VALUES (?,?,1) ON CONFLICT(calendar_id, event_id) DO UPDATE SET hidden = 1", [calid, in_id])
hidden_proj = q(
    "SELECT e.id FROM events e JOIN calendars c ON c.id = e.calendar_id "
    "LEFT JOIN client_event_state s ON s.event_id = e.id AND s.calendar_id = ? "
    "WHERE c.is_global = 1 AND (e.scope = 'GLOBAL' OR e.scope = ?) AND COALESCE(s.hidden,0) = 0",
    [calid, "IN"],
)
expect(all(r["id"] != in_id for r in hidden_proj), "a hidden event disappears from the client's view")
expect(q("SELECT id FROM events WHERE id = ?", [in_id]) != [], "the hidden event still exists in the global calendar")

print("\n== delete client cascades ==")
batch([
    {"sql": "DELETE FROM calendars WHERE client_id = ?", "params": [cid]},
    {"sql": "DELETE FROM clients WHERE id = ?", "params": [cid]},
])
expect(q("SELECT id FROM clients WHERE id = ?", [cid]) == [], "client deleted")
expect(q("SELECT id FROM calendars WHERE id = ?", [calid]) == [], "client calendar deleted")
expect(q("SELECT calendar_id FROM client_event_state WHERE calendar_id = ?", [calid]) == [], "per-client state deleted via cascade")
expect(q("SELECT id FROM events WHERE id = ?", [in_id]) != [], "global events survive a client leaving")

print("\n=== GLOBAL CALENDAR + CLIENT REFERENCE FLOW VERIFIED ===")
