import os, subprocess, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
log = open(os.path.join(root, "Frontend", "data", "logs", "launcher_bg.log"), "a", encoding="utf-8")
os.makedirs(os.path.dirname(log.name), exist_ok=True)
subprocess.Popen([sys.executable, os.path.join(root, "main.py"), "--no-browser"], cwd=root, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
print("started")
