import os
p = os.path.join(os.path.dirname(__file__), "..", "Frontend", "data", "_seed_providers.py")
if os.path.exists(p):
    os.remove(p)
    print("removed")
else:
    print("missing")
