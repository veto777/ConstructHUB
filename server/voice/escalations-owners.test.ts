import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const f = vi.hoisted(() => ({ tasks: new Map<string, any>(), row: {} as any, flags: {} as any, sms: vi.fn(), bells: new Set<string>() }));
vi.mock("../db", () => ({ db: {
  select: () => ({ from: (table: any) => ({ where: () => {
    const rows = table[Symbol.for("drizzle:Name")] === "crm_members"
      ? [{ id: "owner1", role: "owner", phone: "one" }, { id: "owner2", role: "owner", phone: "two" }]
      : [{ ...f.row }];
    return Object.assign(Promise.resolve(rows), { limit: async () => rows });
  } }) }),
  insert: () => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => {
    const existed = f.bells.has(value.id); f.bells.add(value.id); return existed ? [] : [{ id: value.id }];
  } }) }) }),
  update: () => ({ set: (values: any) => ({ where: async () => {
    if (values.lastError && typeof values.lastError === "object") {
      const params = new PgDialect().sqlToQuery(values.lastError).params;
      f.row.lastError = params[0] ?? null;
    } else Object.assign(f.row, values);
  } }) }),
  execute: async (query: any) => {
    const { sql, params } = new PgDialect().sqlToQuery(query);
    if (sql.includes("returning id")) {
      const [key, pending] = params as string[];
      if (f.tasks.has(key) && f.tasks.get(key).status !== "failed") return { rows: [] };
      f.tasks.set(key, JSON.parse(pending)); return { rows: [{ id: "call" }] };
    }
    if (sql.startsWith("select")) return { rows: [{ status: f.tasks.get(String(params[0]))?.status }] };
    if (sql.includes("array['ownerEscalationDelivery'")) f.tasks.set(String(params[0]), JSON.parse(String(params[1])));
    if (sql.includes("jsonb_build_object('alertFacts'")) f.flags.alertFacts = { urgent: JSON.parse(String(params[1])) };
    return { rows: [] };
  },
} }));
vi.mock("../crm/sms", () => ({ sendSms: f.sms, normalizePhone: (s: string) => s, resolveSmsSender: () => null }));
vi.mock("../apns", () => ({ pushSoon: vi.fn(), appForLink: vi.fn() }));
vi.mock("../crm/activity", () => ({ recordActivity: vi.fn() }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn() }));
vi.mock("./leads", () => ({ prettyPhone: (s: string) => s, leadFactsFrom: () => ({}) }));
vi.mock("./org-profile", () => ({}));
import { raiseEscalation } from "./escalations";
const ctx = { companyName: "Test", assistantName: "Assistant", org: { id: "org", customFields: { notificationPrefs: { leadReceived: { inApp: true, email: false, sms: true } } } }, profile: { escalations: { rules: [], fallbackToOwner: true } } } as any;
const run = () => raiseEscalation({ ctx, call: { id: "call", flags: f.flags } as any, kind: "urgent", summary: "Help", strict: true });
beforeEach(() => {
  vi.clearAllMocks(); f.tasks.clear(); f.bells.clear(); f.flags = {};
  f.row = { id: 1, kind: "urgent", body: "Help", sentCount: 1, lastSentAt: new Date(), lastError: null, closedAt: null };
});
it("keeps failed owner alerts incomplete and retries only the failed recipient", async () => {
  f.sms.mockResolvedValueOnce({ ok: true, provider: "signalwire", sid: "SM-one" })
    .mockResolvedValueOnce({ ok: false, provider: "signalwire", error: "Rejected" })
    .mockResolvedValueOnce({ ok: true, provider: "signalwire", sid: "SM-two" });
  await expect(run()).rejects.toThrow("Rejected");
  expect(f.row.lastError).toContain("Owner alert: Rejected");
  expect(f.flags.alertFacts).toBeUndefined();
  await run();
  expect(f.sms.mock.calls.map(([to]) => to)).toEqual(["one", "two", "two"]);
  expect(f.flags.alertFacts.urgent).toBeDefined();
  expect(f.row.lastError).toBeNull();
  expect(f.bells.size).toBe(2);
  expect([...f.tasks.values()].map((v) => v.sid)).toEqual(["SM-one", "SM-two"]);
});
it("keeps an uncertain owner recipient blocked across retries while recovering a definite rejection", async () => {
  f.sms.mockResolvedValueOnce({ ok: false, provider: "signalwire", ambiguous: true })
    .mockResolvedValueOnce({ ok: false, provider: "signalwire", error: "Rejected" })
    .mockResolvedValueOnce({ ok: true, provider: "signalwire", sid: "SM-two" });
  await expect(run()).rejects.toThrow("Delivery uncertain");
  await expect(run()).rejects.toThrow("Delivery uncertain");
  await expect(run()).rejects.toThrow("Delivery uncertain");
  expect(f.sms.mock.calls.map(([to]) => to)).toEqual(["one", "two", "two"]);
  expect(f.flags.alertFacts).toBeUndefined();
  expect([...f.tasks.values()].map((v) => v.status)).toEqual(["uncertain", "sent"]);
});
it("never remembers log-only owner texts as completed", async () => {
  f.sms.mockResolvedValue({ ok: true, provider: "log", sid: null });
  await expect(run()).rejects.toThrow("texting isn't set up");
  expect(f.row.lastError).toContain("Owner alert:");
  expect(f.flags.alertFacts).toBeUndefined();
  expect([...f.tasks.values()].map((v) => v.status)).toEqual(["failed", "failed"]);
});
