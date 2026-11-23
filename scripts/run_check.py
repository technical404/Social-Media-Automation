import os, runpy, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.argv = ["main.py", "--check"]
os.chdir(root)
runpy.run_path(os.path.join(root, "main.py"), run_name="__main__")
