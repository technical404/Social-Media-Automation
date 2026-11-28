# Roadmap — SocialAI Studio (per MASTER_PROJECT_SPECIFICATION)

## This round (spec steps 1–7) — done, evidence in TEST_EVIDENCE/
- [x] Export old cloud data (calendars, events, providers without keys, posts) to data/legacy/cloud-export.json
- [x] Remove cloud login; app opens straight into the dashboard
- [x] Shared SQLite schema (db/migrations) used by both the browser engine and the Python backend
- [x] Python local backend (stdlib only) + main.py with --check/--status/--stop/--logs/--backup/--restore
- [x] Sidebar + top bar (clock, timezone, search, quick create, notifications, worker/online status)
- [x] Dashboard with real database metrics only
- [x] Event Planner: AI request -> validated preview -> explicit approval -> saved
- [x] Three-month calendar with global time, multi-date selection, per-date overrides
- [x] "Show As" Calendar/List, list tiles, search/filters/sort/export, bulk actions
- [x] Settings (timezone, theme), Activity logs, Database (backup/restore/integrity/import legacy)
- [x] Minimal AI provider config so the planner works (full manager = step 8)
- [x] Tests + TEST_EVIDENCE (browser mode and Python backend mode)

## Next (spec steps 8–20)
- [ ] Full AI Provider Manager, model fetching, fallback engine, task routing (8–11)
- [ ] AI Content Studio, campaigns, post approval workflow (12–14); bulk "Generate content"/"Assign campaign" join here — old cloud Studio/Approvals/Schedule pages were retired; their 2 posts are in the export
- [ ] Media library, ComfyUI (15)
- [x] Social account OAuth for all platforms, per client (16) — backend token exchange, DPAPI-encrypted secrets/tokens, workspace + per-client apps
- [ ] Real publishing adapters (17) — OAuth is connected; per-platform post/media upload and retries still need the user's developer app credentials to verify
- [ ] Background scheduler for posts, retries (18), diagnostics (19), full E2E (20)
- [ ] Match AI Provider page to reference screenshot — blocked: screenshot not attached yet
- [ ] Verify on a real Windows 11 PC — needs the user to run `python main.py --check`
