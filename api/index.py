"""Vercel serverless entry point: the JalNetra FastAPI app (ASGI), served at /api/*.

The implementation lives in api/_jalnetra/ — the leading underscore stops Vercel from turning
those helper modules into separate functions.

Local development (from the repo root):  python -m uvicorn api.index:app --port 8000
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _jalnetra.main import app  # noqa: E402,F401  (Vercel looks for `app`)
