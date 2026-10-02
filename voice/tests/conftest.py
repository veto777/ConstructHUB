"""pytest setup for the harness tests: `harness` importable; the engine is VOICE_ENGINE_DIR or ../ (voice/)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
