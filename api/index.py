"""Vercel Python function entry: the numpy-only MonsoonLens API (see backend/lite_app.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.lite_app import app  # noqa: E402,F401  (Vercel serves this WSGI app)
