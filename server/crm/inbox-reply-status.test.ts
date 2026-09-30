/**
 * What the CRM tells the contractor after a reply, against the running dev
 * server:
 *  1. POST /api/crm/inbox/:customerId/reply reports `emailed` (did the email
 *     copy go out?) and a user-safe `emailError`; a client with no email on
 *     file gets emailed:false and no error (nothing was attempted).
 *  2. GET /api/crm/inbox sends thread timestamps as ISO-8601 UTC ("…Z"), not
 *     Postgres' naive "YYYY-MM-DD HH:MM:SS" that browsers read as local time.
 *  3. The client-detail "Client comments" card lists only what the CLIENT
 *     sent; the team's own replies stay in the inbox thread.
 *  4. /api/crm/stats carries the open pipeline and the active client count.
 *
 * Requires the dev server (DEV_AUTH_BYPASS_USER1=true; email sinks to the dev
 * outbox outside production):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Fixtures are made through the app's own routes (no raw SQL writes) and
 * removed through the owner's delete-client route in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (path: string, data: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(data) });

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function mkCustomer(label: string, email?: string) {
  const r = await post("/api/crm/customers", {
    displayName: `R2-r3 ${label} ${stamp}`,
    ...(email ? { email } : {}),
  });
  expect(r.status).toBe(201);
  created.push(r.body.id);
  return r.body.id as string;
}

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
});

afterAll(async () => {
  for (const id of created) await api(`/api/crm/customers/${id}?force=1`, { method: "DELETE" });
});

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("isoUtc (pure)", () => {
  it("reads naive Postgres timestamps as UTC and passes zoned values through", async () => {
    const { isoUtc } = await import("./inbox");
    expect(isoUtc("2026-09-30 14:05:00")).toBe("2026-09-30T14:05:00.000Z");
    expect(isoUtc("2026-09-30 14:05:00.123456")).toBe("2026-09-30T14:05:00.123Z");
    expect(isoUtc("2026-09-30T14:05:00.123Z")).toBe("2026-09-30T14:05:00.123Z");
    expect(isoUtc("2026-09-30 10:05:00-04")).toBe("2026-09-30T14:05:00.000Z");
    expect(isoUtc("2026-09-30 10:05:00.5-0400")).toBe("2026-09-30T14:05:00.500Z");
    expect(isoUtc("2026-09-30 14:05:00+00:00")).toBe("2026-09-30T14:05:00.000Z");
    expect(isoUtc(new Date("2026-09-30T14:05:00Z"))).toBe("2026-09-30T14:05:00.000Z");
    expect(isoUtc(null)).toBeNull();
    expect(isoUtc(undefined)).toBeNull();
    expect(isoUtc("not a date")).toBeNull();
  });
});

describe("inbox reply status", () => {
  it("email on file: emailed true, no error, and the thread time is ISO UTC", async () => {
    const id = await mkCustomer("Inbox Emailed", `r2-r3-inbox-${stamp}@example.com`);
    const reply = await post(`/api/crm/inbox/${id}/reply`, { body: "R2-r3: we can start Tuesday." });
    expect(reply.status).toBe(201);
    expect(reply.body.emailed).toBe(true);
    expect(reply.body.emailError).toBeNull();

    const list = await api("/api/crm/inbox");
    expect(list.status).toBe(200);
    const t = (list.body.threads as any[]).find((x) => x.customerId === id);
    expect(t).toBeTruthy();
    expect(t.lastAt).toMatch(ISO_UTC);
    // Read as UTC, the reply we just sent is from moments ago — not hours
    // off by the browser's offset.
    expect(Math.abs(Date.parse(t.lastAt) - Date.now())).toBeLessThan(5 * 60_000);
    expect(t.oldestUnreadAt).toBeNull(); // only our own reply: nothing unread
  });

  it("no email on file: emailed false and no error (nothing was attempted)", async () => {
    const id = await mkCustomer("Inbox NoEmail");
    const reply = await post(`/api/crm/inbox/${id}/reply`, { body: "R2-r3: portal only." });
    expect(reply.status).toBe(201);
    expect(reply.body.emailed).toBe(false);
    expect(reply.body.emailError).toBeNull();
  });

  it("the Client comments card leaves out the team's own replies", async () => {
    const id = await mkCustomer("Comments Card");
    const reply = await post(`/api/crm/inbox/${id}/reply`, { body: "R2-r3: a team reply, not a client note." });
    expect(reply.status).toBe(201);

    const card = await api(`/api/crm/customers/${id}/client-comments`);
    expect(card.status).toBe(200);
    expect((card.body as any[]).some((c) => c.id === reply.body.id)).toBe(false);

    // …while the two-way thread still carries it.
    const thread = await api(`/api/crm/inbox/${id}`);
    expect((thread.body.messages as any[]).some((m) => m.id === reply.body.id && !m.fromClient)).toBe(true);
  });
});

describe("home stats", () => {
  it("carries the open pipeline and the active client count", async () => {
    await mkCustomer("Stats Client");
    const r = await api("/api/crm/stats");
    expect(r.status).toBe(200);
    expect(Number.isInteger(r.body.clients.count)).toBe(true);
    expect(r.body.clients.count).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(r.body.openPipeline.count)).toBe(true);
    expect(typeof r.body.openPipeline.totalCents).toBe("number");
    expect(r.body.openPipeline.totalCents).toBeGreaterThanOrEqual(0);
  });
});
