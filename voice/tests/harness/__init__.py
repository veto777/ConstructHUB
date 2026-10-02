"""Break-test harness for the Call Assistant engine (harness lane — docs/call-assistant/LANES.md).

  scenarios.py   the scripted-call format (voice/tests/scenarios/*.txt) — twin of server/voice/fixtures/scenarios.ts
  scoring.py     the rubric (`#! expect.*`) → a scorecard — twin of server/voice/fixtures/scorer.ts
  engine.py      imports the engine's own brain/decision modules; CannedProvider; run one scenario through Brain
  fake_app.py    a stand-in for the app's /api/voice-internal/* (records what the engine reports; spam ledger)

Nothing here reads a secret or talks to a real phone number."""
