import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS, UNLIMITED, type PlanKey } from "@shared/plans";
import { CRM_PLANS, type CrmPlanKey } from "@shared/crm-plans";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  platform: {} as any, crm: {} as any,
  org: { id: "org", ownerUserId: 7, customFields: {} as any },
  used: 0, assigned: false,
  execute: vi.fn(), update: vi.fn(), query: vi.fn(),
}));
vi.mock("../db", () => ({
  pool: { query: state.query },
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.org] }) }) }),
    execute: state.execute,
    update: () => ({ set: state.update }),
  },
}));
vi.mock("../entitlements", async (original) => ({
  ...await original<typeof import("../entitlements")>(),
  getEntitlements: vi.fn(async () => state.platform),
}));
vi.mock("./entitlements", () => ({ getCrmEntitlements: vi.fn(async () => state.crm) }));
vi.mock("./tenancy", () => ({ requireOrg: async () => ({ org: state.org }), requirePermission: () => true }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("../auth", () => ({ getBaseUrl: () => "https://example.invalid" }));
vi.mock("./entities", () => ({ logEvent: vi.fn(), presentEstimate: vi.fn() }));
vi.mock("../apns", () => ({ pushSoon: vi.fn() }));
vi.mock("../tutorials/fixtures", () => ({ providerFixture: () => null }));

import { textingNumbersAllowance, getEntitlements } from "../entitlements";
import { getCrmEntitlements } from "./entitlements";
import { clearSmsEntitlementCache, registerCrmSmsRoutes } from "./sms";
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
  plans("starter", "crm_max");
  state.org.customFields = {};
  state.used = 0;
  state.assigned = false;
  state.execute.mockImplementation(async () => ({ rows: [{ n: state.used, assigned: state.assigned }] }));
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
    expect(state.execute).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
    expect(query.sql).toContain("bool_or(custom_fields->'sms'->>'fromNumber'=$1)");
    expect(query.sql).toContain("owner_user_id=$2");
    expect(query.sql).toContain("custom_fields->'sms'->>'mode'='dedicated'");
    expect(query.params).toEqual([number, 7]);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("allows a same-number BYO switch when the allowance has room", async () => {
    state.org.customFields = { sms: { mode: "byo", fromNumber: number } };
    expect((await save()).statusCode).toBe(200);
    expect(state.execute).toHaveBeenCalledOnce();
  });
  it("preserves an existing dedicated assignment even above today's allowance", async () => {
    plans("starter", "crm_essentials");
    state.org.customFields = { sms: { mode: "dedicated", fromNumber: number } };
    expect((await save()).statusCode).toBe(200);
    expect(state.execute).not.toHaveBeenCalled();
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
