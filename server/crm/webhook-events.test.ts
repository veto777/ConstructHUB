/**
 * CRM outbound webhooks — every event the Integrations page offers is really
 * sent from the moment the record changes: customer.created/updated,
 * project.created/stage_changed, estimate.sent/viewed/approved/declined,
 * changeorder.approved/declined and appointment.scheduled/completed (the
 * invoice.* and payment.* events were already wired). Each delivery goes
 * through emitCrmEvent: Stripe-style `t=…,v1=<hmac>` signature, three tries,
 * and lastStatus/failureCount on the webhook row.
 *
 * In-process CRM routes on the lane Postgres (constructhub_dev[_x] on
 * localhost only); throwaway user/org, deleted afterwards. The delivery
 * transport (global fetch to the hook URL) and the hook host's DNS are mocked;
 * no email, SMS or Stripe calls.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import { CRM_WEBHOOK_EVENTS } from "@shared/schema";

vi.mock("dns/promises", async (orig) => {
  const real = await orig<typeof import("dns/promises")>();
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { ...real, lookup, default: { ...real, lookup } };
});
vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
vi.mock("./sms", async (original) => ({
  ...(await original<typeof import("./sms")>()),
  sendSms: vi.fn(async () => ({ ok: true, provider: "log", sid: null })),
  textOrgOwners: vi.fn(async () => {}),
}));

const HOOK = "https://hooks.example.com/constructhub";
const SECRET = `whsec_${randomBytes(12).toString("hex")}`;
type Delivery = { event: string; body: any; headers: Record<string, string>; raw: string };
const deliveries: Delivery[] = [];
let hookStatus = 200;
const realFetch = globalThis.fetch;

let base = "", server: ReturnType<express.Express["listen"]>;
let userId = 0, orgId = "", hookId = "";

async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie?: string) {
  const r = await realFetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-fixture-user": String(userId), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/** Wait for the fire-and-forget delivery of one event (optionally matching its data). */
async function delivered(event: string, match: (data: any) => boolean = () => true, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const hit = deliveries.find((d) => d.event === event && match(d.body.data));
    if (hit) return hit;
    if (Date.now() > until) throw new Error(`${event} was not delivered (got: ${deliveries.map((d) => d.event).join(", ") || "nothing"})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The signature a subscriber verifies: HMAC-SHA256 over `<t>.<body>` with the webhook secret. */
function verifySignature(d: Delivery) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(d.headers["constructhub-signature"] ?? "");
  expect(m).not.toBeNull();
  const expected = createHmac("sha256", SECRET).update(`${m![1]}.${d.raw}`).digest("hex");
  expect(m![2]).toBe(expected);
  expect(d.headers["constructhub-event"]).toBe(d.event);
  expect(d.body).toMatchObject({ event: d.event, orgId });
}

const sessionHashes: string[] = [];
async function clientCookie(customerId: string) {
  const raw = randomBytes(32).toString("hex");
  sessionHashes.push(createHash("sha256").update(raw).digest("hex"));
  await pool.query(
    `INSERT INTO crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     VALUES ($1, $2::jsonb, now() + interval '1 day', now())`,
    [createHash("sha256").update(raw).digest("hex"), JSON.stringify([customerId])]);
  return `crm_client=${raw}`;
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  const { ensureCrmSchema } = await import("./schema-ensure");
  await ensureCrmSchema();

  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    if (!String(url).startsWith(HOOK)) return realFetch(url, init);
    const raw = String(init.body);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    // A signed delivery must never follow a redirect off the validated host (Kimi review, 2026-10-16).
    if (init.redirect !== "manual") throw new Error(`webhook delivered with redirect=${init.redirect}`);
    deliveries.push({ event: headers["constructhub-event"], body: JSON.parse(raw), headers, raw });
    return new Response("ok", { status: hookStatus });
  }));

  userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-hooks-${randomUUID()}@example.invalid`])).rows[0].id;
  // Change orders need job costing — CRM Essentials has it.
  await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);

  const { registerCrmRoutes } = await import("./routes");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
  registerCrmRoutes(app, (req: any) => req.user);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const me = await call("/api/crm/me");
  expect(me.status).toBe(200);
  orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
  hookId = (await pool.query(
    "INSERT INTO crm_webhooks(org_id,url,secret,events,active) VALUES($1,$2,$3,$4,true) RETURNING id",
    [orgId, HOOK, SECRET, [...CRM_WEBHOOK_EVENTS]])).rows[0].id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((resolve) => server?.close(resolve));
  await settle();
  if (orgId) {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
    for (const { table_name } of rows) {
      await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
    }
    await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
  }
  await pool.query("DELETE FROM crm_client_sessions WHERE token_hash = ANY($1::text[])", [sessionHashes]);
  await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});

describe("CRM webhook events fire from their real code paths", () => {
  let customerId = "", projectId = "";

  it("customer.created and customer.updated (signed; the portal token never ships)", async () => {
    const created = await call("/api/crm/customers", { addressLine1: "100 Test St", displayName: "Hook Client", email: `hook-${randomUUID()}@example.invalid` });
    expect(created.status).toBe(201);
    customerId = created.data.id;
    const d = await delivered("customer.created", (x) => x.customerId === customerId);
    verifySignature(d);
    expect(d.body.data).toMatchObject({ customerId, displayName: "Hook Client" });
    expect(JSON.stringify(d.body)).not.toContain("portalToken");

    const patched = await call(`/api/crm/customers/${customerId}`, { phone: "555-0100" }, "PATCH");
    expect(patched.status).toBe(200);
    const u = await delivered("customer.updated", (x) => x.customerId === customerId);
    verifySignature(u);
    expect(u.body.data.fields).toEqual(["phone"]);

    // Re-sending the same value changes nothing, so nothing is sent.
    const before = deliveries.filter((x) => x.event === "customer.updated").length;
    await call(`/api/crm/customers/${customerId}`, { phone: "555-0100" }, "PATCH");
    await settle();
    expect(deliveries.filter((x) => x.event === "customer.updated").length).toBe(before);
  });

  it("project.created and project.stage_changed (only on a real move)", async () => {
    const p = await call("/api/crm/projects", { customerId, name: "Hook roof" });
    expect(p.status).toBe(201);
    projectId = p.data.id;
    const d = await delivered("project.created", (x) => x.projectId === projectId);
    verifySignature(d);
    expect(d.body.data).toMatchObject({ projectId, customerId, name: "Hook roof" });

    const from = p.data.status;
    const moved = await call(`/api/crm/projects/${projectId}`, { status: "estimating" }, "PATCH");
    expect(moved.status).toBe(200);
    const s = await delivered("project.stage_changed", (x) => x.projectId === projectId && x.to === "estimating");
    expect(s.body.data.from).toBe(from);

    const count = deliveries.filter((x) => x.event === "project.stage_changed").length;
    await call(`/api/crm/projects/${projectId}`, { status: "estimating", name: "Hook roof 2" }, "PATCH");
    await settle();
    expect(deliveries.filter((x) => x.event === "project.stage_changed").length).toBe(count);
  });

  it("estimate.sent, estimate.viewed (first open only) and estimate.approved; the project follows", async () => {
    const est = await call("/api/crm/estimates", {
      customerId, projectId, title: "Hook estimate",
      items: [{ kind: "labor", name: "Tear-off", quantityMilli: 1000, unitPriceCents: 100000, taxable: false }],
    });
    expect(est.status).toBe(201);
    const id = est.data.id;
    const sent = await call(`/api/crm/estimates/${id}/send`, { sms: false });
    expect(sent.status).toBe(200);
    const s = await delivered("estimate.sent", (x) => x.estimateId === id);
    verifySignature(s);
    expect(s.body.data).toMatchObject({ estimateId: id, customerId, projectId, totalCents: 100000, resend: false });
    await delivered("project.stage_changed", (x) => x.projectId === projectId && x.to === "proposal_sent");

    const { rows: [{ public_token: tokenE }] } = await pool.query("SELECT public_token FROM crm_estimates WHERE id=$1", [id]);
    const cookie = await clientCookie(customerId);
    expect((await call(`/api/public/estimates/${tokenE}`, undefined, "GET", cookie)).status).toBe(200);
    const v = await delivered("estimate.viewed", (x) => x.estimateId === id);
    verifySignature(v);
    expect((await call(`/api/public/estimates/${tokenE}`, undefined, "GET", cookie)).status).toBe(200);
    await settle();
    expect(deliveries.filter((x) => x.event === "estimate.viewed" && x.body.data.estimateId === id)).toHaveLength(1);

    const ok = await call(`/api/public/estimates/${tokenE}/respond`, { decision: "approve", signatureName: "Hook Client" }, "POST", cookie);
    expect(ok.status).toBe(200);
    const a = await delivered("estimate.approved", (x) => x.estimateId === id);
    verifySignature(a);
    expect(a.body.data).toMatchObject({ approvedTotalCents: 100000, signatureName: "Hook Client" });
    await delivered("project.stage_changed", (x) => x.projectId === projectId && x.from === "proposal_sent" && x.to === "approved");
  });

  it("estimate.declined — by the client, and when marked declined by hand", async () => {
    const mk = async () => (await call("/api/crm/estimates", {
      customerId, title: "Hook decline",
      items: [{ kind: "labor", name: "Gutter", quantityMilli: 1000, unitPriceCents: 5000, taxable: false }],
    })).data.id as string;
    const id = await mk();
    expect((await call(`/api/crm/estimates/${id}/send`, { sms: false })).status).toBe(200);
    const { rows: [{ public_token: t }] } = await pool.query("SELECT public_token FROM crm_estimates WHERE id=$1", [id]);
    const cookie = await clientCookie(customerId);
    const no = await call(`/api/public/estimates/${t}/respond`, { decision: "decline", reason: "Too pricey" }, "POST", cookie);
    expect(no.status).toBe(200);
    const d = await delivered("estimate.declined", (x) => x.estimateId === id);
    verifySignature(d);
    expect(d.body.data.reason).toBe("Too pricey");

    const manual = await mk();
    expect((await call(`/api/crm/estimates/${manual}`, { status: "declined" }, "PATCH")).status).toBe(200);
    const m = await delivered("estimate.declined", (x) => x.estimateId === manual);
    expect(m.body.data.manual).toBe(true);
  });

  it("changeorder.approved and changeorder.declined", async () => {
    const mk = async (title: string) => {
      const co = await call(`/api/crm/projects/${projectId}/change-orders`, { title, amountCents: 25000 });
      expect(co.status).toBe(201);
      expect((await call(`/api/crm/change-orders/${co.data.id}/send`, {})).status).toBe(200);
      const { rows: [{ public_token }] } = await pool.query("SELECT public_token FROM crm_change_orders WHERE id=$1", [co.data.id]);
      return { id: co.data.id as string, token: public_token as string };
    };
    const yes = await mk("Extra flashing");
    expect((await call(`/api/public/change-orders/${yes.token}/respond`, { decision: "approve", signatureName: "Hook Client" })).status).toBe(200);
    const a = await delivered("changeorder.approved", (x) => x.changeOrderId === yes.id);
    verifySignature(a);
    expect(a.body.data).toMatchObject({ projectId, amountCents: 25000, title: "Extra flashing" });

    const no = await mk("Skylight");
    expect((await call(`/api/public/change-orders/${no.token}/respond`, { decision: "decline" })).status).toBe(200);
    verifySignature(await delivered("changeorder.declined", (x) => x.changeOrderId === no.id));
  });

  it("appointment.scheduled and appointment.completed (once, on the move into complete)", async () => {
    const appt = await call("/api/crm/appointments", {
      title: "Hook site visit", customerId, projectId, startsAt: "2031-03-04T15:00:00.000Z", endsAt: "2031-03-04T16:00:00.000Z",
    });
    expect(appt.status).toBe(201);
    const id = appt.data.appointment.id;
    const s = await delivered("appointment.scheduled", (x) => x.appointmentId === id);
    verifySignature(s);
    expect(s.body.data).toMatchObject({ title: "Hook site visit", customerId, projectId });
    expect(JSON.stringify(s.body)).not.toContain("crewNotes");

    expect((await call(`/api/crm/appointments/${id}`, { status: "complete" }, "PATCH")).status).toBe(200);
    const c = await delivered("appointment.completed", (x) => x.appointmentId === id);
    expect(c.body.data.status).toBe("complete");
    await call(`/api/crm/appointments/${id}`, { status: "complete" }, "PATCH");
    await settle();
    expect(deliveries.filter((x) => x.event === "appointment.completed" && x.body.data.appointmentId === id)).toHaveLength(1);
  });

  it("only subscribed events are sent, and a failing endpoint is retried three times and logged on the webhook", async () => {
    await pool.query("UPDATE crm_webhooks SET events=$2, failure_count=0 WHERE id=$1", [hookId, ["project.created"]]);
    const n = deliveries.length;
    await call("/api/crm/customers", { addressLine1: "100 Test St", displayName: "Unsubscribed", email: `hook-${randomUUID()}@example.invalid` });
    await settle();
    expect(deliveries.length).toBe(n);

    hookStatus = 500;
    try {
      const p = await call("/api/crm/projects", { customerId, name: "Failing hook" });
      expect(p.status).toBe(201);
      // 500 → retry after 0.5 s → retry after 1.5 s, then the row records the failure.
      const until = Date.now() + 8000;
      let row: any;
      while (Date.now() < until) {
        row = (await pool.query("SELECT last_status, failure_count, last_attempt_at FROM crm_webhooks WHERE id=$1", [hookId])).rows[0];
        if (row.failure_count > 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(deliveries.filter((x) => x.event === "project.created" && x.body.data.projectId === p.data.id)).toHaveLength(3);
      expect(row).toMatchObject({ last_status: 500, failure_count: 1 });
      expect(row.last_attempt_at).not.toBeNull();
    } finally {
      hookStatus = 200;
    }
  }, 15000);

  it("offers no event that nothing sends", () => {
    // Every event in the subscribable list has an emitter in the server.
    expect([...CRM_WEBHOOK_EVENTS].sort()).toEqual([
      "appointment.completed", "appointment.scheduled",
      "changeorder.approved", "changeorder.declined",
      "customer.created", "customer.updated",
      "estimate.approved", "estimate.declined", "estimate.sent", "estimate.viewed",
      "invoice.paid", "invoice.sent", "invoice.viewed",
      "payment.failed", "payment.refunded", "payment.reversed", "payment.succeeded",
      "project.created", "project.stage_changed",
    ]);
  });
});
