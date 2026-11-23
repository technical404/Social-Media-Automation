# Scheduler

Python worker thread in `backend/server.py`. Heartbeat every 15s. Survives frontend close. Due `posts` with status scheduled are processed; without OAuth they are marked failed, never published.
