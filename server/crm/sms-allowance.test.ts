import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS, UNLIMITED, type PlanKey } from "@shared/plans";
import { CRM_PLANS, type CrmPlanKey } from "@shared/crm-plans";
import { crmSmsOptouts } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  platform: {} as any, crm: {} as any,
  org: { id: "org", ownerUserId: 7, customFields: {} as any },
  used: 0, assigned: false,
  numbers: [] as string[], transaction: vi.fn(),
  reserve: vi.fn(), execute: vi.fn(), update: vi.fn(), query: vi.fn(),
}));
vi.mock("../db", () => ({
  pool: { query: state.query },
  db: {
    select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === crmSmsOptouts ? [] : [state.org] }) }) }),
    transaction: state.transaction,
    execute: state.execute,
    update: () => ({ set: state.update }),
  },
}));
vi.mock("../entitlements", async (original) => ({
  ...await original<typeof import("../entitlements")>(),
  getEntitlements: vi.fn(async () => state.platform),
}));
vi.mock("./entitlements", () => ({ getCrmEntitlements: vi.fn(async () => state.crm) }));
vi.mock("../growth-quotas", () => ({
  reserveQuotaFor: state.reserve, refundReservation: vi.fn(), monthKey: () => "2026-10",
}));
vi.mock("./tenancy", () => ({ requireOrg: async () => ({ org: state.org }), requireSmsOrg: async () => ({ org: state.org }), requirePermission: () => true }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("../auth", () => ({ getBaseUrl: () => "https://example.invalid" }));
vi.mock("./entities", () => ({ logEvent: vi.fn(), presentEstimate: vi.fn() }));
vi.mock("../apns", () => ({ pushSoon: vi.fn() }));
vi.mock("../tutorials/fixtures", () => ({ providerFixture: () => null }));

import { textingNumbersAllowance, getEntitlements } from "../entitlements";
import { getCrmEntitlements } from "./entitlements";
import { clearSmsEntitlementCache, registerCrmSmsRoutes, dedicatedSmsAllowed, reconcileTextingNumbers, sendSms } from "./sms";
import { INTEGRATION_BUILDERS } from "../account/integrations-route";

function plans(platform: PlanKey | null, crm: CrmPlanKey | null, bought = 0) {
  state.platform = { accessPlan: platform, allowances: platform ? PLANS[platform].limits : null,
    addons: { texting_number: bought }, modules: {} };
  state.crm = { active: !!crm, limits: crm ? CRM_PLANS[crm].limits : null };
}
const number = "+15551112222";
let sender: (req: any, res: any) => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearSmsEntitlementCache();
  state.reserve.mockResolvedValue({ ok: true, reservation: null });
  plans("starter", "crm_max");
  state.org.customFields = {};
  state.used = 0;
  state.assigned = false;
  state.numbers = [];
  state.execute.mockImplementation(async (q) => {
    const { sql: query } = new PgDialect().sqlToQuery(q);
    if (!query.includes("GROUP BY")) return { rows: [] };
    const numbers = state.numbers.length ? state.numbers : Array.from({ length: state.used }, (_, i) => state.assigned && i === 0 ? number : "+1555999" + i);
    return { rows: numbers.map(number => ({ number })) };
  });
  let tail = Promise.resolve();
  state.transaction.mockImplementation(async fn => {
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await before;
    try { return await fn({ execute: state.execute,
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.org] }) }) }),
      update: () => ({ set: state.update }),
    }); } finally { release(); }
  });
  state.query.mockImplementation(async () => ({ rows: [{ n: state.used }] }));
  state.update.mockImplementation(({ customFields }) => ({ where: () => ({ returning: async () => [{ ...state.org, customFields }] }) }));
  const app = { get: vi.fn(), post: vi.fn(), put: (path: string, fn: typeof sender) => {
    if (path === "/api/crm/sms/sender") sender = fn;
  } };
  registerCrmSmsRoutes(app as any, () => ({ id: 99 }));
});
async function save(mode = "dedicated", fromNumber = number) {
  const res: any = { statusCode: 200, status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }) };
  await sender({ body: { mode, fromNumber } }, res);
  return res;
}

describe("combined texting allowance", () => {
  it.each([
    ["starter", "crm_max", 0, 1], [null, "crm_max", 0, 1],
    ["growth", "crm_max", 2, 4], ["agency", "crm_max", 0, 3],
    ["starter", "crm_essentials", 2, 2], [null, null, 2, 2],
    ["growth", null, 0, 1],
  ] as const)("%s + %s + %s add-ons = %s", (platform, crm, bought, expected) => {
    plans(platform, crm, bought);
    expect(textingNumbersAllowance(state.platform, state.crm)).toBe(expected);
  });
  it("does not count inactive CRM access and keeps the one-argument contract", () => {
    state.crm.active = false;
    expect(textingNumbersAllowance(state.platform, state.crm)).toBe(0);
    plans("growth", "crm_max", 2);
    expect(textingNumbersAllowance(state.platform)).toBe(3);
  });
  it("preserves unlimited platform and purchased allowances", () => {
    plans("starter", "crm_max", UNLIMITED);
    expect(textingNumbersAllowance(state.platform, state.crm)).toBe(UNLIMITED);
    state.platform.allowances = { textingNumbersIncluded: UNLIMITED };
    state.platform.addons = {};
    expect(textingNumbersAllowance(state.platform, state.crm)).toBe(UNLIMITED);
  });
});

describe("dedicated sender allocation", () => {
  it.each(["growth", "agency", "starter"] as const)("configures platform %s without CRM", async platform => {
    plans(platform, null, platform === "starter" ? 1 : 0);
    expect((await save()).statusCode).toBe(200);
    expect(state.update).toHaveBeenCalledOnce();
  });
  it.each(["starter", null] as const)("allows CRM Max's first number with platform %s", async (platform) => {
    plans(platform, "crm_max");
    expect((await save()).statusCode).toBe(200);
    expect(state.update).toHaveBeenCalled();
    expect(getEntitlements).toHaveBeenCalledWith(7);
    expect(getCrmEntitlements).toHaveBeenCalledWith(7);
  });
  it("refuses a full CRM-only account without dereferencing a platform plan", async () => {
    plans(null, "crm_max");
    state.used = 1;
    const res = await save();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ feature: "textingNumbers", limit: 1, used: 1 });
    expect(res.body.message).toContain("Your account includes 1 client-texting number");
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(["byo", "platform"])("checks a same-number switch from %s at capacity", async (mode) => {
    plans("starter", "crm_essentials");
    state.org.customFields = { sms: { mode, fromNumber: number } };
    expect((await save()).statusCode).toBe(403);
    expect(state.execute).toHaveBeenCalledTimes(2);
    const query = new PgDialect().sqlToQuery(state.execute.mock.calls[1][0]);
    expect(query.sql).toContain("GROUP BY");
    expect(query.sql).toContain("owner_user_id=$1");
    expect(query.sql).toContain("custom_fields->'sms'->>'mode'='dedicated'");
    expect(query.params).toEqual([7]);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("allows a same-number BYO switch when the allowance has room", async () => {
    state.org.customFields = { sms: { mode: "byo", fromNumber: number } };
    expect((await save()).statusCode).toBe(200);
    expect(state.execute).toHaveBeenCalledTimes(2);
  });
  it("refuses an existing dedicated assignment above today's allowance", async () => {
    plans("starter", "crm_essentials");
    state.org.customFields = { sms: { mode: "dedicated", fromNumber: number } };
    expect((await save()).statusCode).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("refuses a different dedicated number at capacity", async () => {
    state.org.customFields = { sms: { mode: "dedicated", fromNumber: "+15559998888" } };
    state.used = 1;
    expect((await save()).statusCode).toBe(403);
  });
  it("allows reuse of a number already dedicated elsewhere on this account", async () => {
    state.org.customFields = { sms: { mode: "byo", fromNumber: number } };
    state.used = 1;
    state.assigned = true;
    expect((await save()).statusCode).toBe(200);
  });
});

describe("integrations texting status", () => {
  it.each(["starter", null] as const)("shows the CRM Max number with platform %s", async (platform) => {
    plans(platform, "crm_max");
    const item = await INTEGRATION_BUILDERS.at(-1)!(7, {} as any);
    expect(item).toMatchObject({ id: "client_texting", status: "not_connected", detail: "One number included with your plan; none assigned yet." });
  });
  it("shows the combined platform, CRM and purchased allowance", async () => {
    plans("growth", "crm_max", 2);
    state.used = 3;
    expect(await INTEGRATION_BUILDERS.at(-1)!(7, {} as any)).toMatchObject({ status: "connected", detail: "3 dedicated numbers on our carrier · 4 included with your plan." });
  });
});

describe("dedicated number removal and concurrency", () => {
  it("serializes competing assignments through the owner lock", async () => {
    state.update.mockImplementation(({ customFields }) => ({ where: () => ({ returning: async () => {
      state.numbers.push(customFields.sms.fromNumber);
      return [{ ...state.org, customFields }];
    } }) }));
    const results = await Promise.all([save("dedicated", number), save("dedicated", "+15553334444")]);
    expect(results.map(r => r.statusCode)).toEqual([200, 403]);
    expect(state.update).toHaveBeenCalledOnce();
    const statements = state.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q));
    expect(statements[0]).toMatchObject({ sql: "SELECT pg_advisory_xact_lock($1, $2)", params: [7165, 7] });
    expect(statements[2]).toEqual(statements[0]);
  });
  it("uses the current allowance after an add-on is removed", async () => {
    plans("starter", null, 1);
    state.org.customFields = { sms: { mode: "dedicated", fromNumber: number } };
    state.numbers = [number];
    expect(await dedicatedSmsAllowed("org", number)).toBe(true);
    plans("starter", null, 0);
    expect(await dedicatedSmsAllowed("org", number)).toBe(false);
  });
  it("refuses stale settings and missing org identities", async () => {
    expect(await dedicatedSmsAllowed("org", number)).toBe(false);
    expect(await dedicatedSmsAllowed(undefined, number)).toBe(false);
    expect(await dedicatedSmsAllowed("*", number)).toBe(false);
  });
  it("preserves assignments after a downgrade and only authorizes the first number", async () => {
    plans("agency", null);
    state.numbers = [number, "+15553334444"];
    state.org.customFields = { sms: { mode: "dedicated", fromNumber: "+15553334444" } };
    expect(await dedicatedSmsAllowed("org", "+15553334444")).toBe(true);
    plans("growth", null);
    await reconcileTextingNumbers(7);
    expect(await dedicatedSmsAllowed("org", "+15553334444")).toBe(false);
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.org.customFields.sms).toEqual({ mode: "dedicated", fromNumber: "+15553334444" });
    state.org.customFields.sms.fromNumber = number;
    expect(await dedicatedSmsAllowed("org", number)).toBe(true);
    state.org.customFields.sms.fromNumber = "+15553334444";
    plans("agency", null);
    await reconcileTextingNumbers(7);
    expect(await dedicatedSmsAllowed("org", "+15553334444")).toBe(true);
  });
  describe.each(["purchased", "Agency", "CRM Max"])("%s number recovery", source => {
    it.each(["past_due", "unpaid", "incomplete", "canceled", "ended", "allowance removed"])(
      "blocks sends during %s and resumes with the saved number", async status => {
        vi.stubEnv("SIGNALWIRE_SPACE_URL", "example.signalwire.com");
        vi.stubEnv("SIGNALWIRE_PROJECT_ID", "project");
        vi.stubEnv("SIGNALWIRE_API_TOKEN", "token");
        vi.stubEnv("SIGNALWIRE_FROM_NUMBER", "+15550000000");
        const fetch = vi.fn(async (_url: string, _request: RequestInit) => ({ ok: true, json: async () => ({ sid: "sent" }) }));
        vi.stubGlobal("fetch", fetch);
        const activate = () => plans(source === "Agency" ? "growth" : "starter",
          source === "CRM Max" ? "crm_max" : null, source === "purchased" ? 1 : 0);
        const saved = { sms: { mode: "dedicated", fromNumber: number }, smsAlerts: true };
        state.org.customFields = structuredClone(saved);
        state.numbers = [number];
        const send = () => sendSms("+15553334444", "test", state.org.customFields, "org");
        try {
          activate();
          await reconcileTextingNumbers(7);
          expect(await send()).toMatchObject({ ok: true, provider: "signalwire" });
          // Effective entitlements returned while billing denies number access.
          plans(status === "allowance removed" ? "starter" : null, null);
          state.platform.status = status;
          state.crm.status = status;
          await reconcileTextingNumbers(7);
          expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("outside your current allowance") });
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(state.reserve).toHaveBeenCalledTimes(1);
          expect(state.org.customFields).toEqual(saved);
          expect(state.transaction).not.toHaveBeenCalled();
          activate();
          await reconcileTextingNumbers(7);
          expect(await send()).toMatchObject({ ok: true, provider: "signalwire" });
          expect(fetch).toHaveBeenCalledTimes(2);
          expect(state.reserve).toHaveBeenCalledTimes(2);
          for (const [, request] of fetch.mock.calls) {
            expect(new URLSearchParams(String(request.body)).get("From")).toBe(number);
          }
        } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
      },
    );
  });
  it("blocks the carrier send before metering after an add-on is removed", async () => {
    vi.stubEnv("SIGNALWIRE_SPACE_URL", "example.signalwire.com");
    vi.stubEnv("SIGNALWIRE_PROJECT_ID", "project");
    vi.stubEnv("SIGNALWIRE_API_TOKEN", "token");
    vi.stubEnv("SIGNALWIRE_FROM_NUMBER", "+15550000000");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      plans("starter", null);
      state.org.customFields = { sms: { mode: "dedicated", fromNumber: number } };
      state.numbers = [number];
      expect(await sendSms("+15553334444", "test", state.org.customFields, "org")).toMatchObject({ ok: false, error: expect.stringContaining("outside your current allowance") });
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  it("retains CRM Max's number and unlimited grants during reconciliation", async () => {
    plans(null, "crm_max");
    state.numbers = [number];
    await reconcileTextingNumbers(7);
    expect(state.execute.mock.calls.some(([q]) => new PgDialect().sqlToQuery(q).sql.includes("UPDATE"))).toBe(false);
    state.platform.addons.texting_number = UNLIMITED;
    state.execute.mockClear();
    await reconcileTextingNumbers(7);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("uses effective purchased allowances without rewriting legacy billing", async () => {
    plans("starter", null, 2);
    state.numbers = [number, "+15553334444"];
    await reconcileTextingNumbers(7);
    expect(state.execute.mock.calls.some(([q]) => new PgDialect().sqlToQuery(q).sql.includes("UPDATE"))).toBe(false);
  });
});
