import os, subprocess, sys
fe = os.path.join(os.path.dirname(__file__), "..", "Frontend")
os.chdir(fe)
r = subprocess.run(["npm", "install"], shell=True)
sys.exit(r.returncode)
