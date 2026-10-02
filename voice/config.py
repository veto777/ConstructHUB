"""Settings for the ConstructHUB Call Assistant engine — the ONE place voice/.env is read.

Everything is a plain attribute on `settings`; nothing else in the engine calls os.environ.
Secrets are never logged: `describe()` prints only which ones are set."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip().strip("'\"")


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # listen
    port: int = _int("VOICE_PORT", 8152)
    bind: tuple[str, ...] = tuple(h.strip() for h in _env("VOICE_BIND", "127.0.0.1").split(",") if h.strip())
    # app
    app_url: str = _env("VOICE_APP_URL", "https://constructhub.us").rstrip("/")
    internal_secret: str = _env("VOICE_INTERNAL_SECRET")
    public_base: str = _env("VOICE_PUBLIC_BASE", "https://constructhub.us/voice").rstrip("/")
    # brain
    ai_provider: str = _env("VOICE_AI_PROVIDER", "openai")          # openai | anthropic
    openai_base_url: str = _env("AI_INTEGRATIONS_OPENAI_BASE_URL")
    openai_api_key: str = _env("AI_INTEGRATIONS_OPENAI_API_KEY")
    ai_model: str = _env("AI_MODEL", "truthcode-api")
    ai_timeout_s: float = _int("AI_TIMEOUT_MS", 12000) / 1000.0
    anthropic_api_key: str = _env("VOICE_ANTHROPIC_API_KEY")
    anthropic_model: str = _env("VOICE_ANTHROPIC_MODEL", "claude-opus-5-5")
    # signalwire (verification only)
    sw_space_url: str = _env("SIGNALWIRE_SPACE_URL")
    sw_project_id: str = _env("SIGNALWIRE_PROJECT_ID")
    sw_api_token: str = _env("SIGNALWIRE_API_TOKEN")
    sw_signing_key: str = _env("SIGNALWIRE_SIGNING_KEY")
    skip_signature: bool = _env("VOICE_SKIP_SIGNATURE") == "1"    # dev only, and only on loopback binds (startup_problems)
    # limits / privacy
    max_active_calls: int = _int("VOICE_MAX_ACTIVE_CALLS", 6)     # GPU + AI + minutes: concurrent live calls this engine takes
    log_transcripts: bool = _env("VOICE_LOG_TRANSCRIPTS") == "1"   # dev flag: what callers say stays out of the journal by default
    # speech
    whisper_model: str = _env("VOICE_WHISPER_MODEL", "large-v3-turbo")
    tts_device: str = _env("VOICE_TTS_DEVICE", "cuda")
    stt_device: str = _env("VOICE_STT_DEVICE", "cuda")
    models_dir: str = _env("VOICE_MODELS_DIR")       # Whisper download root; empty = the Hugging Face cache (shared)
    recordings_dir: Path = Path(_env("VOICE_RECORDINGS_DIR", str(HERE / "recordings")))
    # tuning (Alpine's proven defaults; the compiled profile can override timings per org)
    greeting_delay_s: float = _float("VOICE_GREETING_DELAY_S", 3.0)
    pace_lead_s: float = 0.8
    barge_prob: float = 0.9
    barge_frames: int = 20
    barge_rms: float = 0.05
    echo_corr: float = 0.35
    speech_on: float = 0.5
    speech_end_frames: int = 30
    min_speech_frames: int = 7
    engine_name: str = "own"
    personas_file: Path = field(default_factory=lambda: HERE / "personas.json")

    @property
    def media_ws_url(self) -> str:
        base = self.public_base
        return ("wss://" + base[len("https://"):] if base.startswith("https://") else "ws://" + base[len("http://"):]) + "/media"

    def startup_problems(self) -> list[str]:
        """Reasons to refuse to start. Signature checks off on a non-loopback interface (the tailnet address the app
        proxies to) would let any peer forge SignalWire webhooks into the app."""
        out = []
        if self.skip_signature:
            exposed = [h for h in self.bind if h not in ("127.0.0.1", "::1", "localhost")]
            if exposed:
                out.append(f"VOICE_SKIP_SIGNATURE=1 is only allowed on loopback binds; VOICE_BIND has {', '.join(exposed)}")
        return out

    def describe(self) -> dict:
        """Safe to log: no secret values, only whether they are set."""
        return {
            "port": self.port, "bind": list(self.bind), "app_url": self.app_url, "public_base": self.public_base,
            "ai_provider": self.ai_provider, "ai_model": self.ai_model, "openai_base_url": self.openai_base_url or None,
            "internal_secret": bool(self.internal_secret), "openai_api_key": bool(self.openai_api_key),
            "anthropic_api_key": bool(self.anthropic_api_key), "signalwire": bool(self.sw_project_id and self.sw_api_token),
            "signing_key": bool(self.sw_signing_key), "whisper_model": self.whisper_model, "tts_device": self.tts_device,
            "skip_signature": self.skip_signature, "max_active_calls": self.max_active_calls, "log_transcripts": self.log_transcripts,
        }


settings = Settings()
