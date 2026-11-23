# Security

- Backend binds 127.0.0.1
- Origin allow-list + session token
- SQL ATTACH/VACUUM INTO blocked
- PBKDF2 helper in `backend/auth.py` for local passwords
- Secrets DPAPI on Windows
- Media filenames reject `..` and path separators
