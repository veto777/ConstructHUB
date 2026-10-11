/**
 * Call Assistant round-3 fixes (pure, no DB, no child server):
 *  - publishedState compiles a published profile that has no stored `compiled` copy (the seed regression:
 *    "Published (v3)" in the Studio while the engine and Simulator said "nothing is published");
 *  - the feature-shot seed is a valid, live, compiled profile whose compiled copy is not stale;
 *  - recordingStateOf (Pending / Available / Failed / none) and the reminder worker's switch + status.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultVoiceProfile, parseVoiceProfile, voiceProfileSchema } from "@shared/voice-profile";
import type { VoiceProfileRow } from "@shared/schema";
import { publishedState } from "./profile-store";
import { compileVoiceProfile } from "./prompt-compiler";
import { recordingStateOf, RECORDING_PENDING_MAX_MS } from "./calls";
import { voiceEscalationWorkerOffReason, voiceEscalationWorkerStatus, noteEscalationWorkerRun } from "./escalations";

const profile = defaultVoiceProfile({ name: "Acme Siding", timezone: "America/Los_Angeles", state: "WA" });
const row = (over: Partial<VoiceProfileRow>): VoiceProfileRow => ({
  id: "p1", orgId: "org-1", profile, publishedVersion: 3, publishedProfile: profile, compiled: null, status: "live",
  setupCompletedAt: null, updatedByMemberId: null, createdAt: new Date(), updatedAt: new Date(), ...over,
} as unknown as VoiceProfileRow);

describe("publishedState", () => {
  it("compiles the published profile when no compiled copy is stored", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const st = publishedState(row({ compiled: null }), now);
    expect(st.state).toBe("live");
    if (st.state !== "live") return;
    expect(st.version).toBe(3);
    expect(st.compiled).toEqual(compileVoiceProfile(parseVoiceProfile(profile), 3, now));
  });

  it("uses the stored compiled copy when there is one", () => {
    const stored = compileVoiceProfile(profile, 3, new Date("2026-01-01T00:00:00Z"));
    const st = publishedState(row({ compiled: stored }));
    expect(st).toMatchObject({ state: "live", version: 3 });
    if (st.state === "live") expect(st.compiled).toBe(stored);
  });

  it("any status but paused runs (a legacy 'published' row too); paused stays paused", () => {
    expect(publishedState(row({ status: "published" as any })).state).toBe("live");
    expect(publishedState(row({ status: "paused" }))).toEqual({ state: "paused" });
  });

  it("is unpublished with nothing published, or a published profile the compiler cannot read", () => {
    expect(publishedState(null)).toEqual({ state: "unpublished" });
    expect(publishedState(row({ publishedVersion: null }))).toEqual({ state: "unpublished" });
    expect(publishedState(row({ publishedProfile: null }))).toEqual({ state: "unpublished" });
    const broken = { ...profile, policies: { ...profile.policies, repairs: "yes" } } as any;
    expect(publishedState(row({ publishedProfile: broken }))).toEqual({ state: "unpublished" });
  });
});

describe("feature-shot seed 41-call-assistant.sql", () => {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../../script/feature-shots/seed/41-call-assistant.sql"), "utf8");
  const profileJson = JSON.parse(/\$J\$(\{[\s\S]*?\})\$J\$/.exec(sql)![1]);
  const compiledJson = JSON.parse(/\$C\$(\{[\s\S]*?\})\$C\$/.exec(sql)![1]);

  it("holds a profile the schema accepts as-is (no invalid enums like repairs: 'yes')", () => {
    expect(voiceProfileSchema.safeParse(profileJson).success).toBe(true);
    expect(profileJson.policies.repairs).toBe("repairs_and_replacements");
  });

  it("publishes it live with a compiled copy that matches the compiler (regenerate it when this fails)", () => {
    expect(sql).toMatch(/published_profile, compiled, status/);
    expect(sql).toMatch(/p\.j, 3, p\.j, p\.c, 'live'/);
    expect(sql).not.toMatch(/'published'/);
    const fresh = compileVoiceProfile(parseVoiceProfile(profileJson), 3, new Date(compiledJson.compiledAt));
    expect(compiledJson.version).toBe(3);
    expect(compiledJson.hash).toBe(fresh.hash);
    expect(compiledJson).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("writes the version row the Studio's history lists", () => {
    expect(sql).toMatch(/insert into voice_profile_versions[\s\S]*?select o\.org_id, 'fs-voice-profile', 3, p\.j, p\.c/);
  });
});

describe("recordingStateOf", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("available beats everything; no flag is none", () => {
    expect(recordingStateOf({ recordingKey: "voice/o/recordings/x.wav", recordingPending: true, endedAt: now }, now)).toBe("available");
    expect(recordingStateOf({ recordingKey: null, endedAt: now, flags: {} }, now)).toBe("none");
    expect(recordingStateOf({ recordingKey: null, endedAt: now, flags: null }, now)).toBe("none");
  });
  it("pending while the engine may still upload it, failed after its retry window", () => {
    expect(recordingStateOf({ recordingKey: null, endedAt: new Date(now.getTime() - 60_000), flags: { recordingPending: true } }, now)).toBe("pending");
    expect(recordingStateOf({ recordingKey: null, recordingPending: true, endedAt: new Date(now.getTime() - RECORDING_PENDING_MAX_MS - 1) }, now)).toBe("failed");
  });
});

describe("escalation reminder worker", () => {
  it("runs by default in production, never by default elsewhere, and the flag overrides both", () => {
    expect(voiceEscalationWorkerOffReason({ NODE_ENV: "production" })).toBeNull();
    expect(voiceEscalationWorkerOffReason({ NODE_ENV: "production", VOICE_ESCALATION_WORKER_ENABLED: "false" })).toMatch(/false/);
    expect(voiceEscalationWorkerOffReason({ NODE_ENV: "development" })).toMatch(/not a production server/);
    expect(voiceEscalationWorkerOffReason({ NODE_ENV: "development", VOICE_ESCALATION_WORKER_ENABLED: "true" })).toBeNull();
  });

  it("reports its state for the Escalations tab", () => {
    const s0 = voiceEscalationWorkerStatus();
    expect(s0).toMatchObject({ running: false, intervalMinutes: 30, stale: false });
    const at = new Date("2026-10-11T12:00:00Z");
    noteEscalationWorkerRun(false, at);
    expect(voiceEscalationWorkerStatus(at)).toMatchObject({ lastRunAt: at.toISOString(), lastOk: false });
  });
});
