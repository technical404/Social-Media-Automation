#!/usr/bin/env python3
"""Launch SocialAI Studio. The application lives in the Frontend/ folder."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "Frontend"
if not (APP / "main.py").exists():
    print("Frontend/main.py not found.", file=sys.stderr)
    sys.exit(1)
sys.path.insert(0, str(APP))
sys.argv[0] = str(APP / "main.py")
runpy.run_path(str(APP / "main.py"), run_name="__main__")
