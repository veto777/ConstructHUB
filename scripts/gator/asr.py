"""What does he actually say? Local speech-to-text for the gator's talking takes (docs/gator/VOICE.md).

    analysis/gator-shorts/_asr/venv/bin/python -I scripts/gator/asr.py <models-dir> <audio-or-video>...

Prints one JSON object per file: {"file", "text", "words": [{"w", "start", "end", "p"}]}.
faster-whisper "base.en" on the CPU, int8, 4 threads, run niced by the caller: this box serves production.
The venv and the model live under analysis/ (git-ignored); without them make.ts times captions from the
speech-energy bursts instead and marks the words as unverified.
"""
import json
import subprocess
import sys

import numpy as np

from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=4, download_root=sys.argv[1])
for path in sys.argv[2:]:
    # Decoded by ffmpeg here (the library's own decoder does not match the installed PyAV).
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "2", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], check=True, capture_output=True).stdout
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _info = model.transcribe(audio, language="en", word_timestamps=True, beam_size=5, vad_filter=False, condition_on_previous_text=False)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "p": round(w.probability, 2)})
    print(json.dumps({"file": path, "text": " ".join(w["w"] for w in words), "words": words}), flush=True)
