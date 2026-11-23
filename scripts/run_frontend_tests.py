import os, subprocess, sys
os.chdir(os.path.join(os.path.dirname(__file__), "..", "Frontend"))
r = subprocess.run(["npm", "test"], shell=True)
sys.exit(r.returncode)
