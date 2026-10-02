"""Engine self-tests: no GPU, no network, no real AI provider, no voice/.env values.

config.py reads voice/.env with override=False, so every setting a test depends on is pinned here BEFORE any
engine module is imported (an operator's .env — e.g. VOICE_SKIP_SIGNATURE=1 on a dev box — must not change
what the tests prove). The brain always gets a stub provider; nothing here can reach TruthCoder or Anthropic."""
from __future__ import annotations

import os
import sys
from pathlib import Path

VOICE = Path(__file__).resolve().parent.parent
TEST_ENV = {
    "VOICE_INTERNAL_SECRET": "selftest-secret-0123456789",
    "VOICE_SKIP_SIGNATURE": "0",
    "SIGNALWIRE_SIGNING_KEY": "selftest-signing-key",
    "SIGNALWIRE_SPACE_URL": "",
    "SIGNALWIRE_PROJECT_ID": "",
    "SIGNALWIRE_API_TOKEN": "",
    "VOICE_PUBLIC_BASE": "https://constructhub.us/voice",
    "VOICE_APP_URL": "http://127.0.0.1:9",          # tests inject their own AppClient
    "VOICE_AI_PROVIDER": "openai",
    "AI_INTEGRATIONS_OPENAI_API_KEY": "",            # a test that forgets its stub fails instead of calling out
    "VOICE_ANTHROPIC_API_KEY": "",
    "VOICE_GREETING_DELAY_S": "0.2",
    "VOICE_RECORDINGS_DIR": str(Path(os.environ.get("TMPDIR", "/tmp")) / "constructhub-voice-selftest-recordings"),
}
os.environ.update(TEST_ENV)
sys.path.insert(0, str(VOICE))
sys.path.insert(0, str(Path(__file__).resolve().parent))
