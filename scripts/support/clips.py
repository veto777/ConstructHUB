"""Record the keypad line's clips (server/support/ivr.ts CLIPS) once, in Gabe's voice (Kokoro am_michael — the voice the
GPU engine gives him), as mono 22 kHz MP3s in server/data/support-audio/. Re-run after changing any clip's text:
  npx tsx -e 'import("./server/support/ivr.ts").then(m=>console.log(JSON.stringify(m.CLIPS)))' > /tmp/clips.json
  ~/ConstructHUB-voice/voice/.venv/bin/python scripts/support/clips.py /tmp/clips.json server/data/support-audio
"""
import json, subprocess, sys, tempfile, os
import numpy as np, soundfile as sf
from kokoro import KPipeline

clips, out = json.load(open(sys.argv[1])), sys.argv[2]
p = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for cid, text in clips.items():
    audio = np.concatenate([np.asarray(a.detach().cpu() if hasattr(a, "detach") else a) for _, _, a in p(text, voice="am_michael")])
    if cid in ("t",) or cid.startswith("d"):   # digit clips: trim the tails so a ticket number reads at a natural pace
        nz = np.where(np.abs(audio) > 0.01)[0]; audio = audio[max(0, nz[0] - 600): nz[-1] + 2400]
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f: sf.write(f.name, audio, 24000)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f.name, "-ac", "1", "-ar", "22050", "-b:a", "48k", os.path.join(out, f"{cid}.mp3")], check=True)
    os.unlink(f.name); print(cid, f"{len(audio)/24000:.1f}s")
