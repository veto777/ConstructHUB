import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CRM_PLANS, type CrmPlanKey } from "@shared/crm-plans";
import { crmApiKeys, crmOrgs, crmChangeOrders } from "@shared/schema";

const mocks = vi.hoisted(() => ({
  entitlement: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), query: vi.fn(),
  org: vi.fn(), permission: vi.fn(),
}));
vi.mock("../db", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update }, pool: { query: mocks.query } }));
vi.mock("./entitlements", () => ({ getCrmEntitlements: mocks.entitlement }));
vi.mock("./tenancy", () => ({ requireOrg: mocks.org, requirePermission: mocks.permission, requireOwnerRole: vi.fn(), stripMoney: (_ctx: unknown, row: unknown) => row }));
vi.mock("./payment-ledger", () => ({ reconcileStripeEvent: vi.fn() }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("./receipts", () => ({ autoSendPaymentReceipt: vi.fn() }));
vi.mock("./sms", () => ({ textOrgOwners: vi.fn() }));
vi.mock("./notify", () => ({ notifyMembers: vi.fn() }));
vi.mock("../tutorials/fixtures", () => ({ providerFixture: () => null }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));
vi.mock("../auth", () => ({ getBaseUrl: () => "https://example.invalid" }));
vi.mock("./divisions", () => ({ divisionScopeOf: vi.fn(), divisionVisible: vi.fn(), divisionMapsForOrg: vi.fn(), docDivisionFromMaps: vi.fn() }));
vi.mock("./doc-number", () => ({ lockDocNumbers: vi.fn(), nextDocNumber: vi.fn() }));
vi.mock("./object-access", () => ({ objectPolicy: vi.fn() }));
vi.mock("./permit-suggest", () => ({ suggestPermitOffices: vi.fn() }));

import { requireApiKey, registerCrmIntegrationRoutes } from "./integrations";
import { registerCrmOpsRoutes } from "./ops";

const routes = new Map<string, Function[]>();
const app: any = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(method => [method,
  (path: string, ...handlers: Function[]) => routes.set(`${method} ${path}`, handlers)]));
registerCrmOpsRoutes(app, () => ({ id: 999 })); // acting seat != billing owner
registerCrmIntegrationRoutes(app);
const owner = 41;
let plan: CrmPlanKey | null;
let keyValid: boolean;
let keySequence: number;
let publicCo: boolean;
let meterFailure: boolean;
let used: Map<string, number>;
function chain(rows: unknown[]) {
  const result: any = Promise.resolve(rows);
  for (const method of ["where", "limit", "orderBy", "offset", "set", "values", "returning"]) result[method] = () => result;
  return result;
}
function response() {
  const res: any = { statusCode: 200, body: undefined, headers: {}, destroyed: false, headersSent: false };
  res.status = (status: number) => { res.statusCode = status; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (key: string, value: unknown) => { res.headers[key] = value; };
  return res;
}
async function call(method: string, path: string, body: unknown = {}) {
  const res = response();
  await routes.get(`${method} ${path}`)![0]({ params: { id: "project", lineId: "line", token: "token" }, body }, res);
  return res;
}
async function authenticate(token = "chk_valid") {
  const res = response(), next = vi.fn();
  const req: any = { headers: { authorization: `Bearer ${token}` }, method: "GET" };
  await requireApiKey(req, res, next);
  return { req, res, next };
}
async function send(res: any, body: unknown = { ok: true }) {
  res.json(body);
  await vi.waitFor(() => expect(res.body).not.toBeUndefined());
}
beforeEach(() => {
  vi.clearAllMocks();
  plan = "crm_basic"; keyValid = true; keySequence = 0; publicCo = false; meterFailure = false; used = new Map();
  mocks.entitlement.mockImplementation(async () => ({ active: !!plan, plan, limits: plan ? CRM_PLANS[plan].limits : null }));
  mocks.org.mockResolvedValue({ org: { id: "org", ownerUserId: owner }, member: { id: "seat" }, permissions: { seeCosts: true } });
  mocks.permission.mockReturnValue(true);
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => chain(
    table === crmApiKeys ? (keyValid ? [{ id: `key-${++keySequence}`, orgId: `org-${keySequence}`, scopes: ["read"] }] : []) :
    table === crmOrgs ? [{ id: "org", ownerUserId: owner }] :
    table === crmChangeOrders && publicCo ? [{ id: "co", orgId: "org", projectId: "project" }] : []
  ) }));
  mocks.insert.mockReturnValue(chain([{ id: "new-key" }]));
  mocks.update.mockReturnValue(chain([{ id: "key" }]));
  mocks.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("CREATE TABLE")) return { rows: [] };
    const id = `${args[0]}:${args[1]}`;
    if (sql.startsWith("SELECT units")) return { rows: [{ units: used.get(id) ?? 0 }] };
    if (meterFailure) throw new Error("meter unavailable");
    expect(sql).toContain("ON CONFLICT (owner_user_id, month) DO UPDATE");
    expect(sql).toContain("WHERE crm_api_monthly_usage.units + EXCLUDED.units <= $4::integer");
    const total = (used.get(id) ?? 0) + args[2];
    if (total > args[3]) return { rows: [] };
    used.set(id, total);
    return { rows: [{ units: total }] };
  });
});
afterEach(() => vi.useRealTimers());

const costingRoutes = [
  ["get", "/api/crm/projects/:id/costing"],
  ["put", "/api/crm/projects/:id/budget"],
  ["post", "/api/crm/projects/:id/budget-lines"],
  ["patch", "/api/crm/budget-lines/:lineId"],
  ["delete", "/api/crm/budget-lines/:lineId"],
  ["post", "/api/crm/projects/:id/commitments"],
  ["post", "/api/crm/projects/:id/costs"],
  ["get", "/api/crm/projects/:id/change-orders"],
  ["post", "/api/crm/projects/:id/change-orders"],
  ["post", "/api/crm/change-orders/:id/send"],
];
describe("owner CRM jobCosting entitlement on every owned route", () => {
  it.each(costingRoutes)("Basic blocks %s %s before accessing job data", async (method, path) => {
    const res = await call(method, path);
    expect(res.statusCode).toBe(402);
    expect(res.body.feature).toBe("jobCosting");
    expect(mocks.entitlement).toHaveBeenCalledWith(owner, { fresh: true });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["crm_essentials", "crm_max"] as const)("%s reaches the tenant-scoped lookup on every costing route", async tier => {
    plan = tier;
    for (const [method, path] of costingRoutes) expect((await call(method, path)).statusCode).toBe(404);
  });
  it.each(["get", "post"])("Basic blocks public change-order %s and its tracking/approval writes", async method => {
    publicCo = true;
    const path = `/api/public/change-orders/:token${method === "post" ? "/respond" : ""}`;
    const res = await call(method, path, { decision: "approve", signatureName: "Client Name" });
    expect(res.statusCode).toBe(402);
    expect(mocks.entitlement).toHaveBeenCalledWith(owner, { fresh: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["crm_essentials", "crm_max"] as const)("%s can read and respond to public change orders", async tier => {
    plan = tier; publicCo = true;
    expect((await call("get", "/api/public/change-orders/:token")).statusCode).toBe(200);
    mocks.update.mockReturnValue(chain([{ id: "co", status: "approved" }]));
    const res = await call("post", "/api/public/change-orders/:token/respond", { decision: "approve", signatureName: "Client Name" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "approved" });
  });
  it("keeps Basic's included price-book cost codes available", async () => {
    expect((await call("get", "/api/crm/cost-codes")).statusCode).toBe(200);
    expect((await call("post", "/api/crm/cost-codes", { code: "01", name: "Labor" })).statusCode).toBe(201);
    expect(mocks.entitlement).not.toHaveBeenCalled();
  });
  it("retains role permission checks for an entitled owner", async () => {
    plan = "crm_max";
    mocks.permission.mockReturnValue(false);
    await call("post", "/api/crm/projects/:id/budget-lines");
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

describe("CRM key creation and live authentication", () => {
  it.each(["crm_basic", null] as const)("refuses key creation and existing keys for %s", async tier => {
    plan = tier;
    expect((await call("post", "/api/crm/api-keys")).statusCode).toBe(402);
    expect(mocks.insert).not.toHaveBeenCalled();
    const { res, next } = await authenticate();
    expect(res.statusCode).toBe(402);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(["crm_essentials", "crm_max"] as const)("allows %s key creation", async tier => {
    plan = tier;
    const res = await call("post", "/api/crm/api-keys");
    expect(res.statusCode).toBe(201);
    expect(res.body.key).toMatch(/^chk_/);
    expect(mocks.entitlement).toHaveBeenCalledWith(owner, { fresh: true });
  });
  it("rechecks the subscription when a previously valid key is used after cancellation or downgrade", async () => {
    plan = "crm_essentials";
    expect((await authenticate()).next).toHaveBeenCalledOnce();
    plan = null;
    expect((await authenticate()).res.statusCode).toBe(402);
    plan = "crm_basic";
    expect((await authenticate()).res.statusCode).toBe(402);
    expect(mocks.entitlement).toHaveBeenCalledTimes(3);
  });
  it("does not grant API access from stale limits on an inactive entitlement", async () => {
    mocks.entitlement.mockResolvedValue({ active: false, limits: CRM_PLANS.crm_max.limits });
    expect((await authenticate()).res.statusCode).toBe(402);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("still allows listing and revoking keys after downgrade", async () => {
    expect((await call("get", "/api/crm/api-keys")).statusCode).toBe(200);
    expect((await call("delete", "/api/crm/api-keys/:id")).statusCode).toBe(200);
    expect(mocks.entitlement).not.toHaveBeenCalled();
  });
  it("rejects malformed and revoked keys before entitlements or metering", async () => {
    expect((await authenticate("chub_wrong")).res.statusCode).toBe(401);
    keyValid = false;
    expect((await authenticate()).res.statusCode).toBe(401);
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("all registered private CRM API resources use the authenticated meter", () => {
    for (const path of ["ping", "customers", "projects", "estimates", "invoices", "payments"]) {
      expect(routes.get(`get /api/v1/${path}`)![0]).toBe(requireApiKey);
    }
  });
});

describe("CRM monthly API allowance (mocked persistence; no database)", () => {
  it.each(["crm_essentials", "crm_max"] as const)("enforces %s's published allowance with the platform row-cost formula", async tier => {
    plan = tier;
    const limit = CRM_PLANS[tier].limits.apiUnitsPerMonth;
    const month = new Date().toISOString().slice(0, 7) + "-01";
    used.set(`${owner}:${month}`, limit - 3);
    const first = await authenticate();
    await send(first.res, { data: Array(200).fill({}) }); // 1 + floor(200 / 100)
    expect(first.res.statusCode).toBe(200);
    expect(first.res.headers["X-Units-Remaining"]).toBe("0");
    const second = await authenticate();
    expect(second.res.statusCode).toBe(429);
    expect(second.next).not.toHaveBeenCalled();
  });
  it("atomically rejects a response whose actual row cost exceeds remaining units", async () => {
    plan = "crm_essentials";
    const month = new Date().toISOString().slice(0, 7) + "-01";
    used.set(`${owner}:${month}`, 9999);
    const { res } = await authenticate();
    await send(res, { data: Array(100).fill({}) });
    expect(res.statusCode).toBe(429);
    expect(res.body.data).toBeUndefined();
    expect(used.get(`${owner}:${month}`)).toBe(9999);
  });
  it("two concurrent keys cannot double-spend the owner's last unit", async () => {
    plan = "crm_essentials";
    const month = new Date().toISOString().slice(0, 7) + "-01";
    used.set(`${owner}:${month}`, 9999);
    const [a, b] = await Promise.all([authenticate("chk_one"), authenticate("chk_two")]);
    expect(a.req.apiCtx.keyId).not.toBe(b.req.apiCtx.keyId);
    expect(a.req.apiCtx.orgId).not.toBe(b.req.apiCtx.orgId);
    await Promise.all([send(a.res), send(b.res)]);
    expect([a.res.statusCode, b.res.statusCode].sort()).toEqual([200, 429]);
    expect(used.get(`${owner}:${month}`)).toBe(10000);
  });
  it("starts a separate bucket at the UTC calendar-month boundary", async () => {
    plan = "crm_essentials";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));
    used.set(`${owner}:2026-12-01`, 10000);
    expect((await authenticate()).res.statusCode).toBe(429);
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const { res, next } = await authenticate();
    expect(next).toHaveBeenCalledOnce();
    await send(res);
    expect(used.get(`${owner}:2027-01-01`)).toBe(1);
  });
  it("does not charge failed resource responses", async () => {
    plan = "crm_essentials";
    const { res } = await authenticate();
    res.status(404);
    await send(res, { error: "not found" });
    expect(used.size).toBe(0);
  });
  it("fails closed when usage cannot be persisted", async () => {
    plan = "crm_essentials"; meterFailure = true;
    const { res } = await authenticate();
    await send(res, { data: ["private"] });
    expect(res.statusCode).toBe(503);
    expect(res.body.data).toBeUndefined();
    expect(used.size).toBe(0);
  });
});
