import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICE_NUDGE_ENABLED, placeEmailNudgeCall, voiceNudgeOnEstimate } from "./voice";

// Owner order 2026-11-14: the automatic call to the client when a bid is sent
// is off for everyone, whatever the org has stored. No database needed here.
describe("voice nudge is turned off for everyone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a stored voiceNudge=true does not turn it on", () => {
    expect(VOICE_NUDGE_ENABLED).toBe(false);
    expect(voiceNudgeOnEstimate({ voiceNudge: true })).toBe(false);
    expect(voiceNudgeOnEstimate(null)).toBe(false);
  });

  it("placeEmailNudgeCall never reaches the carrier and records nothing", async () => {
    const outbox = path.join(process.cwd(), "tmp", `voice-off-test-${Date.now()}.jsonl`);
    const saved: Record<string, string | undefined> = {};
    const env: Record<string, string> = {
      VOICE_OUTBOX_PATH: outbox, SIGNALWIRE_SPACE_URL: "x.signalwire.com", SIGNALWIRE_PROJECT_ID: "proj-1",
      SIGNALWIRE_API_TOKEN: "tok", SIGNALWIRE_FROM_NUMBER: "+15550001111",
    };
    for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ sid: "CAabc123" }) }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const r = await placeEmailNudgeCall("+15551234567", { name: "Vitest Roofing", customFields: { voiceNudge: true } });
      expect(r.ok).toBe(false);
      expect(r.sid ?? null).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(outbox)).toBe(false);
    } finally {
      for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      fs.rmSync(outbox, { force: true });
    }
  });
});
