"""G.711 mu-law codec and resampling for the SignalWire 8 kHz phone leg (port of Alpine's audio.py).

Everything is numpy float32 PCM in [-1, 1] inside the engine; mu-law bytes only at the WebSocket edge.
WAV helpers write the recording the app uploads to R2 (8 kHz mono PCM16)."""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

_BIAS, _CLIP = 0x84, 32635
PHONE_SR = 8000
STT_SR = 16000


def mulaw_decode(b: bytes) -> np.ndarray:
    """mu-law bytes -> float32 PCM in [-1, 1]."""
    if not b:
        return np.zeros(0, np.float32)
    u = ~np.frombuffer(b, dtype=np.uint8)
    sign = u & 0x80
    exp = (u >> 4) & 0x07
    mant = u & 0x0F
    mag = ((mant.astype(np.int32) << 3) + _BIAS) << exp
    pcm = np.where(sign, _BIAS - mag, mag - _BIAS).astype(np.int16)
    return pcm.astype(np.float32) / 32768.0


def mulaw_encode(x: np.ndarray) -> bytes:
    """float32 PCM in [-1, 1] -> mu-law bytes."""
    if len(x) == 0:
        return b""
    pcm = np.clip(x * 32767.0, -32768, 32767).astype(np.int16).astype(np.int32)
    sign = np.where(pcm < 0, 0x80, 0).astype(np.int32)
    mag = np.minimum(np.abs(pcm), _CLIP) + _BIAS
    exp = np.floor(np.log2(mag)).astype(np.int32) - 7
    mant = (mag >> (exp + 3)) & 0x0F
    return (~(sign | (exp << 4) | mant) & 0xFF).astype(np.uint8).tobytes()


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    """Linear resampling — good enough for 8/16/24 kHz speech on a phone line."""
    if src == dst or len(x) == 0:
        return np.asarray(x, dtype=np.float32)
    n = int(round(len(x) * dst / src))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float32) ** 2))) if len(x) else 0.0


def write_wav(path: Path, pcm: np.ndarray, sr: int = PHONE_SR) -> float:
    """Write float32 PCM as 16-bit mono WAV; returns the duration in seconds."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes())
    return len(pcm) / sr


def mix_legs(inbound: np.ndarray, outbound: np.ndarray) -> np.ndarray:
    """Both legs of a call as one mono track (the caller and the assistant, same clock, same length)."""
    n = max(len(inbound), len(outbound))
    a = np.pad(inbound, (0, n - len(inbound)))
    b = np.pad(outbound, (0, n - len(outbound)))
    return np.clip(a + b, -1, 1).astype(np.float32)
