"""Vercel serverless entry point: exposes the JalNetra FastAPI app (ASGI) at /api/*."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401  (Vercel looks for `app`)
