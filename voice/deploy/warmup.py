#!/usr/bin/env python3
"""Download / warm up the engine's models so the first real call does not wait on them.

Run from voice/ with the venv: `.venv/bin/python deploy/warmup.py`. Reads voice/.env through config.py
(VOICE_WHISPER_MODEL, VOICE_MODELS_DIR, VOICE_STT_DEVICE, VOICE_TTS_DEVICE). Each stage is best-effort
and reports what it did; the exit code is non-zero only when NOTHING could be loaded. The engine lane's
speech.py is what loads them for real — this script only fills the caches it will read."""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import settings  # noqa: E402

ok = 0


def stage(name: str, fn) -> None:
    global ok
    t = time.time()
    try:
        info = fn()
        ok += 1
        print(f"[warmup] {name}: ok ({time.time() - t:.1f}s) {info or ''}")
    except Exception as e:  # noqa: BLE001 — report and continue
        print(f"[warmup] {name}: FAILED ({type(e).__name__}: {str(e)[:200]})")


def cuda() -> str:
    import torch
    avail = torch.cuda.is_available()
    return f"torch {torch.__version__} cuda={avail}" + (f" {torch.cuda.get_device_name(0)}" if avail else "")


def whisper() -> str:
    from faster_whisper import WhisperModel
    # models_dir is a string from voice/.env; a relative one means relative to voice/ (the unit's
    # WorkingDirectory, where speech.py resolves it), and empty means the shared Hugging Face cache.
    root = None
    if settings.models_dir:
        root = Path(settings.models_dir)
        if not root.is_absolute():
            root = Path(__file__).resolve().parents[1] / root
        root.mkdir(parents=True, exist_ok=True)
    device = settings.stt_device if settings.stt_device in ("cuda", "cpu") else "auto"
    compute = "float16" if device == "cuda" else "int8"
    WhisperModel(settings.whisper_model, device=device, compute_type=compute, download_root=str(root) if root else None)
    return f"{settings.whisper_model} on {device} -> {root or 'HF cache'}"


def kokoro() -> str:
    from kokoro import KPipeline
    p = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    # Touch one voice so the voice pack is in the cache too.
    for _ in p("Warm-up complete.", voice="af_heart"):
        break
    return "Kokoro-82M + af_heart"


def silero() -> str:
    from silero_vad import load_silero_vad
    load_silero_vad()
    return "silero-vad"


stage("cuda", cuda)
stage("faster-whisper", whisper)
stage("kokoro", kokoro)
stage("silero-vad", silero)
sys.exit(0 if ok else 1)
