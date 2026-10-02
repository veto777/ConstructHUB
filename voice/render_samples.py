#!/usr/bin/env python3
"""Engine-lane tool: verify the persona voice ids against Kokoro-82M, write personas.json (verified: true), and
render each persona's sample line to client/public/persona-samples/<id>.mp3 (the Studio's "play sample" button).

  python render_samples.py            # renders every persona
  python render_samples.py --check    # only verify the voice ids and rewrite personas.json

Needs the GPU (or VOICE_TTS_DEVICE=cpu) and ffmpeg on PATH for the MP3 encode. The WAVs are kept next to the
MP3s only when --keep-wav is given (they are gitignored)."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from speech import TTS, verify_personas  # noqa: E402

SAMPLES_DIR = HERE.parent / "client" / "public" / "persona-samples"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--keep-wav", action="store_true")
    ap.add_argument("--out", default=str(SAMPLES_DIR))
    a = ap.parse_args()
    tts = TTS()
    doc = verify_personas(tts)
    print("personas:", json.dumps([(p["id"], p["voice"], p.get("swappedFrom")) for p in doc["personas"]]))
    if a.check:
        return
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH (needed for the MP3 encode)")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for p in doc["personas"]:
        pcm = tts.synth(p["sampleLine"], p["voice"])
        # a touch of silence either side so players don't clip the first word
        pcm = np.concatenate([np.zeros(2400, np.float32), pcm, np.zeros(4800, np.float32)])
        wav = out / f"{p['id']}.wav"
        mp3 = out / f"{p['id']}.mp3"
        sf.write(wav, pcm, TTS.SR, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "64k", "-ac", "1", str(mp3)], check=True)
        if not a.keep_wav:
            wav.unlink()
        print(f"{p['id']:8s} {p['voice']:11s} {len(pcm) / TTS.SR:4.1f}s → {mp3.relative_to(HERE.parent)} ({mp3.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
