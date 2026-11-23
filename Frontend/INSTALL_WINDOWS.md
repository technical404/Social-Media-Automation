# SocialAI Studio — run it on Windows 11

## 1. Install once
1. **Python 3.10+** from python.org (tick "Add python.exe to PATH").
2. **Node.js 20+** (LTS) from nodejs.org.
3. Open the project folder in a terminal (PowerShell) and run:
   ```
   npm install
   python main.py --check
   ```
   Every line should say `[ OK ]`.

## 2. Start
```
python main.py
```
Your browser opens `http://localhost:8080/dashboard`. Keep the terminal open; press **Ctrl+C** to stop.

| Command | What it does |
|---|---|
| `python main.py --status` | Shows backend, frontend and worker |
| `python main.py --stop` | Stops everything the launcher started |
| `python main.py --logs` | Last lines of `data/logs/*.log` |
| `python main.py --backup` | Saves a verified copy in `data/backups/` |
| `python main.py --restore FILE` | Restores a backup (stop the app first; current data is backed up first) |

## 3. Where things are
- Database: `data/socialai.sqlite`
- API keys: `data/secrets.json`, encrypted with your Windows account (DPAPI) — not inside the database or backups.
- Backups: `data/backups/`, logs: `data/logs/`.

## 4. Bring your old online data
Open **Database & Backup → Import old cloud data** and choose `cloud-export.json`. Imported events start as "Needs review". AI keys were not exported — add them again in AI Provider Manager.

## 5. Troubleshooting
- *"Port 8080 IN USE"* — another program uses it. Set `SOCIALAI_FRONTEND_PORT=8090` before `python main.py`.
- *Top bar says "Data: this browser"* — the backend isn't running; start with `python main.py`.
- *Ollama not reachable* — start Ollama; base URL `http://localhost:11434/v1`.
