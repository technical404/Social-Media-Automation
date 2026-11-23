# Test evidence — spec steps 1–7 (run 2026-11-04, sandbox, Linux)

All results below come from real runs. Nothing was posted to any social network.

## Automated tests
| Suite | Command | Result |
|---|---|---|
| Planner rules, dates, schema, routing (Vitest) | `bunx vitest run` | 27/27 passed |
| Python backend (unittest) | `python -m unittest discover -s backend/tests -v` | 8/8 passed |

Covered: week/day/month/year scopes, leap years, AI-answer validation (out-of-period, impossible date, duplicate, selected-dates only, unknown "official" claims), override-beats-default rule, list filter/sort, CSV quoting, relay refuses private hosts, migrations run once, unique event per calendar/date/name, end-before-start rejected, cascade delete, backend origin/token checks, dangerous SQL blocked, transaction rollback, key masking, backup/restore and non-SQLite restore rejected.

## End-to-end (Playwright, `e2e_planner_flow.py`)
Same 26-step script run twice, using the deterministic **Test provider** (fixed answer with known dates plus 3 deliberately bad items):

| Mode | Folder | Result |
|---|---|---|
| Browser storage (SQLite in IndexedDB, like the hosted preview) | `browser-mode/` | 26/26 passed |
| Python backend + SQLite file (`python -m backend.server`) | `python-mode/` | 26/26 passed |

Steps: opens on dashboard with no login → add + test provider → create medical calendar → AI request for year 2028 → 37 proposals shown unsaved, 3 rejected with reasons → approve blocked until medical review ticked → untick 1, approve 36 → three months in one row → Feb 2028 has 29 days, Feb 1 aligned on Tuesday → default time 08:15 applied → select 2 dates, override 18:45 → default changed to 10:30, overrides kept → List View tiles in MM/DD/YYYY with correct times → search, sort → bulk schedule (approved only) → edit returns event to review → CSV export (36 rows) → reload: 36 events still there → dashboard counts match → integrity ok → backup downloaded and checked with Python `sqlite3` (`sqlite_verification.json`: 0 unapproved scheduled events, 3 overrides, default 10:30).

## Python backend and launcher (`python-mode/`)
- `sqlite_file_check_before_restart.txt`: rows read straight from the SQLite file, worker heartbeat and AI request log present.
- `restart_and_cli.txt`: after a backend restart, 36 events and 3 overrides are still there; another website's origin gets HTTP 403; `--status`, `--backup` (written + verified) work; `--restore` refuses while the app is running.
- `main_py_start.log` + `11_main_py_launch_dashboard.png`: `python main.py --no-browser` ran the checks, started backend + frontend + worker, the dashboard opened in PC mode with 36 events and "Worker running"; a second launch was refused; `--stop` stopped both.

## Not tested yet
- Real Windows 11 machine (DPAPI key encryption path, `taskkill`, `npm.cmd`): run `python main.py --check` there.
- Real paid AI providers (no working key was available in this run) and Ollama.
- Spec steps 8–20.
