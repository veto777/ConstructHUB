import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../stripe", () => ({}));
let sms: typeof import("../crm/sms");
let dir: string;
beforeAll(async () => { sms = await import("../crm/sms"); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-sms-r6-"));
  vi.stubEnv("SMS_OUTBOX_PATH", path.join(dir, "outbox.jsonl"));
  vi.stubEnv("SIGNALWIRE_SPACE_URL", "carrier.example.invalid");
  vi.stubEnv("SIGNALWIRE_PROJECT_ID", "test-project");
  vi.stubEnv("SIGNALWIRE_API_TOKEN", "test-token");
  vi.stubEnv("SIGNALWIRE_FROM_NUMBER", "+15555550123");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });
it("no carrier records a log but never acceptance", async () => {
  vi.stubEnv("SIGNALWIRE_API_TOKEN", "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  // The shared sender only records (provider "log", no carrier id); the Call Assistant reads that as "Not sent" (leads.ts).
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ provider: "log", sid: null });
  expect(fetch).not.toHaveBeenCalled();
});
it("definite carrier rejection remains retryable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Rejected" }), { status: 400 })));
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ ok: false, ambiguous: false, error: "Rejected" });
});
it("lost acceptance response is uncertain", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection lost after sending")));
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ ok: false, ambiguous: true });
});
it("unreadable acceptance and server failures are uncertain", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("truncated", { status: 201 }))
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ ok: false, ambiguous: true });
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ ok: false, ambiguous: true });
});
it("real acceptance retains the carrier identifier", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: "SM-test" }), { status: 201 })));
  expect(await sms.sendSms("+15555550124", "Summary")).toMatchObject({ ok: true, provider: "signalwire", sid: "SM-test" });
});
