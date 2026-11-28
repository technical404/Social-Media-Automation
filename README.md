# SocialAI Studio (local Windows)

Offline-first desktop launcher for the existing app in `Frontend/`.

## Run

```bat
cd /d "%~dp0"
python main.py --check
python main.py
```

Requires Python 3.10+, Node.js 20+, and `npm install` once in `Frontend`.

- Data: `Frontend/data/socialai.sqlite`
- Secrets: `Frontend/data/secrets.json`
- Backups: `Frontend/data/backups`
- Logs: `Frontend/data/logs`

Social publishing and platform analytics remain **EXTERNAL VERIFICATION PENDING**
until the publishing adapters are verified against real accounts.

Official OAuth 2.0 is implemented for Instagram, Facebook, LinkedIn, X, YouTube,
TikTok and Pinterest, per client. Configure each platform's developer app in
**Social Accounts**, then connect the account from the client's page. Tokens and
app secrets are DPAPI-encrypted; see `docs/SOCIAL_INTEGRATIONS.md`.
