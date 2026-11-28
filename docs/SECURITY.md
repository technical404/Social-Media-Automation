# Security

- Backend binds 127.0.0.1
- Origin allow-list + session token
- SQL ATTACH/VACUUM INTO blocked
- PBKDF2 helper in `backend/auth.py` for local passwords
- Secrets DPAPI on Windows
- OAuth app secrets and access/refresh tokens are DPAPI-encrypted in
  `data/secrets.json`, never stored in SQLite or backups
- OAuth callbacks are validated by a one-time state value; the local backend
  still checks Host + Origin and accepts a public callback host (from
  `SOCIALAI_OAUTH_REDIRECT_URI` or a configured app's redirect URI) only on the
  callback endpoint
- Request logs omit query strings, so OAuth authorization codes are never
  written to `backend.log`
- Media filenames reject `..` and path separators
