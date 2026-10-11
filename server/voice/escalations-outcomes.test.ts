import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ row: {} as any, sms: vi.fn(), notify: vi.fn() }));
vi.mock("../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [{ ...f.row }], limit: async () => [{ ...f.row }] }) }) }),
  update: () => ({ set: (values: any) => ({ where: () => {
    const apply = () => { Object.assign(f.row, values, values.lastError && typeof values.lastError === "object" ? { lastError: new PgDialect().sqlToQuery(values.lastError).params[0] } : {}); return [{ ...f.row }]; };
    return { returning: async () => f.row.lastError?.startsWith("Delivery uncertain;") ? [] : apply(),
      then: (resolve: any) => resolve(apply()) };
  } }) }),
  execute: async () => ({ rows: [] }),
} }));
vi.mock("../crm/sms", () => ({ sendSms: f.sms, normalizePhone: (s: string) => s, resolveSmsSender: () => null }));
vi.mock("../crm/notify", () => ({ notifyMembers: f.notify }));
vi.mock("../crm/activity", () => ({ recordActivity: vi.fn() }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn() }));
vi.mock("./leads", () => ({ prettyPhone: (s: string) => s, leadFactsFrom: () => ({}) }));
vi.mock("./org-profile", () => ({ loadOrgVoiceContext: async () => ({ org: { id: "org" }, profile: { company: { timezone: "UTC" } } }) }));
import { escalationSmsOutcome, raiseEscalation, sendFirstEscalation, tickVoiceEscalations } from "./escalations";

const now = new Date("2026-10-11T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  f.row = { id: 1, orgId: "org", callId: "call", kind: "scheduling", channel: "sms", recipient: "+15555550123", body: "Help",
    sentCount: 0, lastSentAt: null, followupSentAt: null, lastError: null, confirmedAt: null, closedAt: null,
    remindEveryMinutes: 60, remindFromHour: 0, remindToHour: 24, maxDays: 3, followUpNextDay: true, createdAt: now };
});
it("requires a carrier and SID, and preserves ambiguous outcomes", () => {
  expect(escalationSmsOutcome({ ok: true, provider: "log", sid: null })).toMatchObject({ ok: false, error: "Not sent: texting isn't set up." });
  expect(escalationSmsOutcome({ ok: true, provider: "signalwire", sid: "SM-1" })).toMatchObject({ ok: true, sid: "SM-1" });
  expect(escalationSmsOutcome({ ok: true, provider: "signalwire" })).toMatchObject({ ok: false, ambiguous: true });
});
for (const stage of ["first", "reminder", "followup"] as const) {
  for (const ambiguous of [false, true]) {
    it(`${stage}: ${ambiguous ? "uncertain acceptance never resends" : "log-only never advances delivery"}`, async () => {
      if (stage !== "first") Object.assign(f.row, { sentCount: 1, lastSentAt: new Date("2026-10-10T10:00:00Z") });
      if (stage === "followup") f.row.confirmedAt = new Date("2026-10-10T10:00:00Z");
      const before = { sentCount: f.row.sentCount, lastSentAt: f.row.lastSentAt, followupSentAt: null };
      f.sms.mockResolvedValue(ambiguous ? { ok: false, provider: "signalwire", ambiguous: true, error: "Response lost" } : { ok: true, provider: "log", sid: null });
      await tickVoiceEscalations(now);
      expect(f.row).toMatchObject(before);
      expect(f.row.lastError).toContain(ambiguous ? "Delivery uncertain;" : "Not sent: texting isn't set up.");
      if (ambiguous) {
        await tickVoiceEscalations(new Date(now.getTime() + 3600000));
        await expect(raiseEscalation({ ctx: { org: { id: "org" }, profile: { escalations: { rules: [], fallbackToOwner: false } } } as any,
          call: { id: "call" } as any, kind: "scheduling", summary: "", strict: true })).rejects.toThrow("Delivery uncertain");
        expect(f.sms).toHaveBeenCalledTimes(1);
      }
    });
  }
}
it("a definitive refusal remains retryable and a carrier acceptance advances once", async () => {
  f.sms.mockResolvedValueOnce({ ok: false, provider: "signalwire", error: "Rejected", ambiguous: false })
    .mockResolvedValueOnce({ ok: true, provider: "signalwire", sid: "SM-accepted" });
  await sendFirstEscalation({ id: "org" } as any, { ...f.row }, "Help", "Help");
  expect(f.row).toMatchObject({ sentCount: 0, lastError: "Rejected" });
  await sendFirstEscalation({ id: "org" } as any, { ...f.row }, "Help", "Help");
  expect(f.row).toMatchObject({ sentCount: 1, lastProviderSid: "SM-accepted", lastError: null });
  expect(f.row.lastSentAt).toBeInstanceOf(Date);
});
it("a crash marker or competing claim blocks every automatic send", async () => {
  f.row.lastError = "Delivery uncertain; verify with the carrier before resending.";
  await sendFirstEscalation({ id: "org" } as any, { ...f.row }, "Help", "Help");
  await tickVoiceEscalations(now);
  expect(f.sms).not.toHaveBeenCalled();
});
it("reminders preserve pending details delivery instead of clearing its error", async () => {
  const error = "Details update not sent: Not sent: texting isn't set up.";
  Object.assign(f.row, { sentCount: 1, lastSentAt: new Date("2026-10-10T10:00:00Z"), lastError: error });
  f.sms.mockResolvedValue({ ok: true, provider: "signalwire", sid: "SM-reminder" });
  await tickVoiceEscalations(now);
  expect(f.sms).not.toHaveBeenCalled();
  expect(f.row.lastError).toBe(error);
});
