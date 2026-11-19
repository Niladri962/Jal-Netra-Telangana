"""Runtime configuration (environment variables)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Vercel serverless functions have a read-only filesystem except /tmp, and cannot hold WebSockets.
ON_VERCEL = bool(os.getenv("VERCEL"))
DATA_DIR = Path(os.getenv("JALNETRA_DATA_DIR", "/tmp/jalnetra" if ON_VERCEL else ROOT / "backend" / "data"))
# Days of 15-min history generated automatically on first use (kept small on serverless cold starts).
AUTO_GEN_DAYS = int(os.getenv("JALNETRA_GEN_DAYS", "7" if ON_VERCEL else "30"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "jalnetra_sim.sqlite3"
KB_PATH = ROOT / "frontend" / "src" / "data" / "knowledge_base.json"
GEO_PATH = ROOT / "frontend" / "src" / "data" / "telangana_geo.json"

# LLM: Claude Opus 5.5 by default; override with JALNETRA_MODEL.
MODEL = os.getenv("JALNETRA_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("JALNETRA_EFFORT", "low")  # chat-style Q&A: low effort keeps answers fast


def llm_configured() -> bool:
    """True when an Anthropic credential is available in the environment."""
    # JALNETRA_LLM=1 forces LLM mode when credentials come from an `ant auth login` profile.
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("JALNETRA_LLM") == "1")
