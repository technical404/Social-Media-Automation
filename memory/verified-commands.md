# Verified commands (2026-11-20)

- `python scripts\run_backend_tests.py` → 10 tests OK (migrations 001–006 applied)
- `python scripts\run_frontend_tests.py` → 62 tests OK (incl. strict-JSON parser, global-calendar
  codes/scopes, 006 schema constraints, layout-audit maths, clients schema, schedule start, time zones)
- `python scripts\run_check.py` / `python main.py --check` → all OK, schema `006_global_calendar`
  (note: the check claims "Port 8765 is free" even when the backend runs, because it probes `/`
  which the API answers with 404 — use `python main.py --status` instead)
- `python scripts\verify_clients_flow.py` → one global calendar → built-in seed → stable event_code
  uniqueness per year → client calendar references it (own region visible, other region hidden,
  no copies) → per-client time/hide state only → cascade delete; all OK against the running
  backend (needs the app running; restart it after adding a migration so 006 applies)
- `cd Frontend && npx tsc --noEmit` → only 8 pre-existing TS7030 warnings in unrelated routes
  (accounts, automation, brand, campaigns, posts, providers, studio); touched files are clean
- UI-level (browser) verification: `/planner`, `/dashboard`, `/calendar`, `/clients`, a client
  scheduler, `/planner/$calendarId`, `/studio`, `/posts`, `/providers`, `/settings`, `/activity`,
  `/campaigns`, `/accounts`, `/automation`, `/brand`, `/analytics` all render with **zero** dev
  layout-guard findings at a 959px viewport. Wider breakpoints were not measured.
  The automated browser can navigate and snapshot but does **not** deliver real clicks
  (`Prev`/`list`/`hide` had no effect), so UI flows must be verified another way.