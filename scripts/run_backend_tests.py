import os, sys, unittest
root = os.path.join(os.path.dirname(__file__), "..", "Frontend")
os.chdir(root)
sys.path.insert(0, root)
r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover("backend/tests"))
sys.exit(0 if r.wasSuccessful() else 1)
