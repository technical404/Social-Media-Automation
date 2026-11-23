# Architecture

- UI: TanStack Start in `Frontend/src`
- API: stdlib HTTP server `Frontend/backend/server.py` on 127.0.0.1:8765
- DB: SQLite + `Frontend/db/migrations`
- Scheduler: daemon thread in backend (heartbeat + due posts)
- Secrets: `secrets_store.py` (not plaintext provider table)
