"""Local speech on the tower GPU, loaded once per process (port of Alpine's speech.py, multi-voice).

  STT  faster-whisper (default large-v3-turbo, CUDA float16) — one shared model; the per-org vocabulary goes
       in as Whisper's initial_prompt so brand names and cities are heard right.
  TTS  Kokoro-82M, ONE pipeline, the voice id chosen per call (the org's persona). Returns 24 kHz float32.
  VAD  Silero on 16 kHz / 512-sample (32 ms) frames; one instance per call (it keeps state).

All GPU work is serialized by one lock (the GPU is shared with alpine-voice; keep VRAM modest: Kokoro ≈ 0.6 GB,
Whisper turbo ≈ 1.6 GB). Model loading is lazy so unit tests and the text simulator never touch the GPU."""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path

import numpy as np

from config import settings

log = logging.getLogger("voice.speech")
_lock = threading.Lock()

KOKORO_REPO = "hexgrad/Kokoro-82M"
DEFAULT_VOCAB = "Phone call to a contractor. Siding, roofing, windows, decks, estimate, James Hardie, vinyl, gutters, soffit, fascia."


class STT:
    def __init__(self, size: str = settings.whisper_model, device: str = settings.stt_device):
        from faster_whisper import WhisperModel
        self.m = WhisperModel(size, device=device, compute_type="float16" if device == "cuda" else "int8",
                              download_root=settings.models_dir or None)

    def transcribe(self, pcm16k: np.ndarray, vocabulary: str = DEFAULT_VOCAB) -> str:
        if len(pcm16k) < 1600:  # < 0.1 s
            return ""
        with _lock:
            segs, _ = self.m.transcribe(pcm16k, beam_size=1, language="en", vad_filter=False,
                                        condition_on_previous_text=False, initial_prompt=vocabulary or DEFAULT_VOCAB)
            return " ".join(s.text.strip() for s in segs).strip()


class TTS:
    SR = 24000

    def __init__(self, device: str = settings.tts_device):
        from kokoro import KPipeline
        self.p = KPipeline(lang_code="a", repo_id=KOKORO_REPO, device=device)

    def synth(self, text: str, voice: str) -> np.ndarray:
        """text -> float32 PCM at 24 kHz in the given Kokoro voice."""
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return np.zeros(0, np.float32)
        with _lock:
            parts = [a.detach().cpu().numpy() if hasattr(a, "detach") else np.asarray(a) for _, _, a in self.p(text, voice=voice)]
        return np.concatenate(parts).astype(np.float32) if parts else np.zeros(0, np.float32)

    def voice_exists(self, voice: str) -> bool:
        """True when the voice pack can be loaded (downloads it from the hub on first use)."""
        try:
            with _lock:
                self.p.load_voice(voice)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("voice %s unavailable: %s", voice, str(e)[:120])
            return False


class VAD:
    """Silero VAD on 16 kHz, 512-sample (32 ms) frames. One per call."""
    FRAME = 512

    def __init__(self):
        from silero_vad import load_silero_vad
        import torch
        self._torch = torch
        self.m = load_silero_vad()

    def prob(self, frame16k: np.ndarray) -> float:
        with self._torch.no_grad():
            return float(self.m(self._torch.from_numpy(np.ascontiguousarray(frame16k, dtype=np.float32)), 16000))

    def reset(self) -> None:
        self.m.reset_states()


SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")


def sentences(text: str) -> list[str]:
    return [s for s in SENT_SPLIT.split(text.strip()) if s]


# ── personas: verify the Kokoro voice ids once, swap a missing one for the closest match ────────

# Same gender + American accent first, in the order we would pick them.
CLOSE_MATCH = {
    "female": ["af_heart", "af_bella", "af_sarah", "af_nicole", "af_sky", "af_nova", "af_alloy", "af_aoede", "af_kore", "af_jessica", "af_river"],
    "male": ["am_michael", "am_adam", "am_eric", "am_liam", "am_onyx", "am_echo", "am_fenrir", "am_puck"],
}


def load_personas(path: Path = settings.personas_file) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def verify_personas(tts: TTS, path: Path = settings.personas_file, write: bool = True) -> dict:
    """Check every persona's voice id against the Kokoro pack; swap a missing one for the closest match of the
    same gender; write the result back to personas.json (`verified: true`). Returns the final document."""
    doc = load_personas(path)
    changed = False
    for p in doc["personas"]:
        if tts.voice_exists(p["voice"]):
            continue
        for alt in CLOSE_MATCH.get(p.get("gender", "female"), []):
            if alt != p["voice"] and tts.voice_exists(alt):
                log.warning("persona %s: voice %s missing → swapped for %s", p["id"], p["voice"], alt)
                p["swappedFrom"], p["voice"], changed = p["voice"], alt, True
                break
        else:
            log.error("persona %s: no usable voice found; keeping %s", p["id"], p["voice"])
    if not doc.get("verified") or changed:
        doc["verified"] = True
        changed = True
    if write and changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
    return doc


def persona_voice(doc: dict, persona_id: str, fallback: str = "af_heart") -> str:
    for p in doc.get("personas", []):
        if p.get("id") == persona_id:
            return p.get("voice") or fallback
    return fallback
