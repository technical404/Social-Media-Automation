<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Local-first: no app login and no cloud database. `db/migrations/*.sql` is the single SQLite schema, applied by both `src/lib/db/sqljs-core.ts` (browser, sql.js) and `backend/db.py` (Python) — never fork the schema.
- All frontend data access goes through `src/lib/repo.ts` on the `Driver` from `src/lib/db` (Python backend when `/api/health` answers, else SQLite in IndexedDB), so both modes run identical SQL.
- App pages live under the pathless `src/routes/_app` layout with `ssr: false` because the database exists only in the browser/PC.
- The Python backend (`backend/`, stdlib only) binds 127.0.0.1, checks Host/Origin allowlist plus a per-run session token, and blocks ATTACH/PRAGMA writes — keep these guards on every new endpoint.
- API keys never enter SQLite or backups: Python mode stores them via `backend/secrets_store.py` (DPAPI on Windows), browser mode in a separate IndexedDB store; the UI only sees `api_key_hint`.
- Every AI call goes through `src/lib/ai/client.ts` (`runAi`); browser mode relays hosted providers through `aiProxy` (`src/lib/ai-proxy.functions.ts`), which refuses non-https/private hosts. Python mode uses `backend/ai.py`.
- AI event output is validated by `validateProposals` in `src/lib/planner.ts` (pure, unit-tested) and stored as a preview run; only explicit approval (`repo.commitRun`) creates events.
- Scheduling only touches approved events (enforced in the SQL of `repo.scheduleEvents`); content/category edits reset approval and unschedule.
- Shared date helpers live in `src/lib/dates.ts`; `src/components/three-month-calendar.tsx` is the single calendar view (always three months in one row).
- `python main.py` is the launcher (start/--check/--status/--stop/--logs/--backup/--restore); runtime data lives in `data/` (git-ignored).
