# Development rules (single source of truth)

- Existing Frontend/ app is the product. Do not replace it with a new template.
- Launch: `python main.py` from repository root (delegates to Frontend/main.py).
- SQLite is the system of record. Never fake published/connected/analytics states.
- API keys live in encrypted/local secrets store, never plaintext DB columns or logs.
- Social publishing requires official OAuth. Until credentials exist: status stays not_connected / failed with a real reason.
- Evidence belongs in `memory/evidence/` as real outputs, not descriptions.
