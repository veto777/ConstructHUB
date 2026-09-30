/**
 * QA round 2 (r2-crm-data): document numbering, the (org_id, number) unique
 * backstop, daily-log edit/delete, webhook and customer validation sentences,
 * honest customer audit fields, time-in-stage, bell cleanup on a client hard
 * delete, and the UTC clock for defaultNow() columns.
 *
 * Integration parts run against the dev server (CRM_TEST_BASE_URL, default
 * http://127.0.0.1:8119, DEV_AUTH_BYPASS_USER1=true). Every record they make
 * is created through the app and named "R2-crm-data …". The unique-index
 * step is exercised on session-private TEMP tables, so the shared database's
 * own tables are never altered by this file.
 */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { ensureDocNumberUniqueIndexes, docNumberIndexName, DOC_NUMBER_TABLES } from "./doc-number";
import { customerIssueMessage, changedCustomerFields } from "./entities";
import { z } from "zod";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}
const send = (method: string, path: string, data: unknown, cookie?: string) =>
  api(path, { method, body: JSON.stringify(data) }, cookie);

const RUN = `R2-crm-data ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let cookie: string | undefined;
let orgId = "";

async function makeCustomer(label: string, extra: Record<string, unknown> = {}) {
  const slug = `${RUN}.${label}`.replace(/\W+/g, "").toLowerCase();
  const r = await send("POST", "/api/crm/customers?force=1", {
    displayName: `${RUN} ${label}`, email: `${slug}@example.com`, ...extra,
  }, cookie);
  expect(r.status).toBe(201);
  return r.body as { id: string; createdAt: string };
}
async function makeProject(label: string) {
  const cust = await makeCustomer(label);
  const p = await send("POST", "/api/crm/projects", { customerId: cust.id, name: `${RUN} ${label}` }, cookie);
  expect(p.status).toBe(201);
  return { customerId: cust.id, project: p.body };
}
const seq = (n: string) => Number(n.split("-").pop());

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("customer validation sentences (pure)", () => {
  const schema = z.object({
    displayName: z.string().min(1).max(200), email: z.string().email().nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    tags: z.array(z.string().max(40)).max(30).nullable().optional(),
  });
  const msg = (body: unknown) => {
    const r = schema.safeParse(body);
    return r.success ? null : customerIssueMessage(r.error.issues);
  };
  it("names the field instead of 'Invalid customer'", () => {
    expect(msg({ displayName: "A", email: "not-an-email" })).toBe("Enter a valid email address.");
    expect(msg({ displayName: "" })).toBe("Enter the client's name.");
    expect(msg({ displayName: "A", city: "x".repeat(121) })).toBe("City is too long (120 characters at most).");
    expect(msg({ displayName: "A", tags: ["x".repeat(41)] })).toBe("Each tag can be 40 characters at most.");
    expect(customerIssueMessage([])).toBe("Invalid customer");
  });
  it("lists only the fields whose values change", () => {
    const before = { phone: "555-0100", email: null, tags: ["a", "b"], city: "Tacoma" };
    expect(changedCustomerFields(before, { phone: "555-0100", email: null, tags: ["a", "b"] })).toEqual([]);
    expect(changedCustomerFields(before, { phone: "555-0101", city: "Tacoma", tags: ["a"] })).toEqual(["phone", "tags"]);
    expect(changedCustomerFields({ notes: null }, { notes: undefined as any })).toEqual([]);
  });
});

// ── Unique (org_id, number) backstop, on TEMP tables ────────────────────────

describe("ensureDocNumberUniqueIndexes (temp tables only)", () => {
  it("covers every numbered series", () => {
    expect([...DOC_NUMBER_TABLES].sort()).toEqual(
      ["crm_change_orders", "crm_commitments", "crm_estimates", "crm_invoices", "crm_projects"]);
  });

  it("skips a table with repeated numbers, adds the index to a clean one, then leaves it", async () => {
    const client = await pool.connect();
    const lines: string[] = [];
    try {
      const dup = "r2_tmp_docs_dup", clean = "r2_tmp_docs_clean";
      for (const t of [dup, clean]) {
        await client.query(`create temp table ${t} (id serial primary key, org_id text not null, number text)`);
      }
      await client.query(`insert into ${dup} (org_id, number) values ('o1','INV-1'),('o1','INV-1'),('o2','INV-1'),('o1',null),('o1',null)`);
      await client.query(`insert into ${clean} (org_id, number) values ('o1','INV-1'),('o2','INV-1'),('o1','INV-2'),('o1',null),('o1',null)`);

      const first = await ensureDocNumberUniqueIndexes(client, [dup, clean], (l) => lines.push(l));
      expect(first).toEqual({ [dup]: "skipped-duplicates", [clean]: "created" });
      // The skip names the repeat and promises nothing was renumbered.
      expect(lines[0]).toContain("INV-1 ×2 (org o1)");
      expect(lines[0]).toContain("never renumbered");
      // Nothing in the duplicate table was rewritten.
      const { rows } = await client.query(`select count(*)::int as n from ${dup} where number = 'INV-1'`);
      expect(rows[0].n).toBe(3);

      // With the index, a repeated (org_id, number) now fails loudly…
      await expect(client.query(`insert into ${clean} (org_id, number) values ('o1','INV-2')`))
        .rejects.toMatchObject({ code: "23505" });
      // …while NULL numbers and another org's same number stay allowed.
      await client.query(`insert into ${clean} (org_id, number) values ('o1', null), ('o3','INV-2')`);

      const again = await ensureDocNumberUniqueIndexes(client, [dup, clean], () => {});
      expect(again[clean]).toBe("exists");
      const idx = await client.query(`select to_regclass($1) is not null as present`, [docNumberIndexName(clean)]);
      expect(idx.rows[0].present).toBe(true);
    } finally {
      client.release(true); // drop the temp tables with the session
    }
  });

  it("refuses anything but a plain table name", async () => {
    await expect(ensureDocNumberUniqueIndexes(pool, ["crm_invoices; drop table x"], () => {}))
      .rejects.toThrow(/plain table name/);
  });
});

// ── Against the dev server ──────────────────────────────────────────────────

describe("r2-crm-data against the dev server", () => {
  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
  });
  afterAll(async () => { await pool.end(); });

  it("defaultNow() columns land on the UTC clock (no 4h skew)", async () => {
    const before = Date.now();
    const cust = await makeCustomer("clock");
    const created = new Date(cust.createdAt).getTime();
    expect(Math.abs(created - before)).toBeLessThan(2 * 60_000);
    // A raw read in a UTC session sees the same wall time drizzle returned.
    const [row] = await q(`select to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as wall from crm_customers where id = $1`, [cust.id]);
    expect(row.wall).toBe(new Date(cust.createdAt).toISOString().slice(0, 19));
  });

  it("change orders and POs number per org under the lock, never count(*)+1", async () => {
    const { project } = await makeProject("numbers");
    const co = async (title: string) => {
      const r = await send("POST", `/api/crm/projects/${project.id}/change-orders`, { title, amountCents: 100 }, cookie);
      expect(r.status).toBe(201);
      return r.body.number as string;
    };
    const po = async () => {
      const r = await send("POST", `/api/crm/projects/${project.id}/commitments`, { amountCents: 100, vendorName: `${RUN} vendor` }, cookie);
      expect(r.status).toBe(201);
      return r.body.number as string;
    };
    // Other lanes may create documents in this org concurrently, so assert
    // "past everything that existed" and "unique", never an exact value.
    const maxOf = (table: string, prefix: string) => q(
      `select coalesce(max((substring(number from '^${prefix}-([0-9]+)$'))::bigint), 0)::int as n from ${table} where org_id = $1`,
      [orgId]).then((r) => r[0].n as number);
    const copies = (table: string, number: string) => q(
      `select count(*)::int as n from ${table} where org_id = $1 and number = $2`, [orgId, number]).then((r) => r[0].n as number);

    const coBefore = await maxOf("crm_change_orders", "CO");
    const [co1, co2] = [await co(`${RUN} CO a`), await co(`${RUN} CO b`)];
    expect(co1).toMatch(/^CO-\d+$/);
    expect(seq(co1)).toBeGreaterThan(coBefore);
    expect(seq(co2)).toBeGreaterThan(seq(co1));
    expect(await copies("crm_change_orders", co2)).toBe(1);

    const poBefore = await maxOf("crm_commitments", "PO");
    const [po1, po2] = [await po(), await po()];
    expect(po1).toMatch(/^PO-\d+$/);
    expect(seq(po1)).toBeGreaterThan(poBefore);
    expect(seq(po2)).toBeGreaterThan(seq(po1));
    expect(await copies("crm_commitments", po2)).toBe(1);

    // Concurrent creates still get distinct numbers.
    const burst = await Promise.all([1, 2, 3, 4].map((i) => co(`${RUN} CO burst ${i}`)));
    expect(new Set(burst).size).toBe(4);
  });

  it("estimates share one allocator: a new estimate is past the org's highest E- number", async () => {
    const cust = await makeCustomer("estimate-number");
    const [before] = await q(`select coalesce(max((substring(number from '^E-([0-9]+)$'))::bigint), 0)::int as n from crm_estimates where org_id = $1`, [orgId]);
    const r = await send("POST", "/api/crm/estimates", { customerId: cust.id, title: `${RUN} est`, items: [] }, cookie);
    expect(r.status).toBe(201);
    expect(seq(r.body.number)).toBeGreaterThan(before.n);
    const [dup] = await q(`select count(*)::int as n from crm_estimates where org_id = $1 and number = $2`, [orgId, r.body.number]);
    expect(dup.n).toBe(1);
  });

  it("daily logs can be edited and deleted, org-scoped", async () => {
    const { project } = await makeProject("daily-log");
    const created = await send("POST", `/api/crm/projects/${project.id}/daily-logs`, {
      logDate: "2026-09-29", workCompleted: `${RUN} framed the wall`, crewCount: 3,
    }, cookie);
    expect(created.status).toBe(201);
    const id = created.body.id;

    const bad = await send("PATCH", `/api/crm/daily-logs/${id}`, { logDate: "not a date" }, cookie);
    expect(bad.status).toBe(400);

    const edited = await send("PATCH", `/api/crm/daily-logs/${id}`, {
      workCompleted: `${RUN} framed and sheathed the wall`, crewCount: 4, logDate: "2026-09-28",
    }, cookie);
    expect(edited.status).toBe(200);
    expect(edited.body.workCompleted).toBe(`${RUN} framed and sheathed the wall`);
    expect(edited.body.crewCount).toBe(4);
    expect(edited.body.logDate.slice(0, 10)).toBe("2026-09-28");

    const list = await api(`/api/crm/projects/${project.id}/daily-logs`, {}, cookie);
    expect(list.body.find((l: any) => l.id === id)?.crewCount).toBe(4);

    expect((await send("PATCH", `/api/crm/daily-logs/00000000-0000-0000-0000-000000000000`, { crewCount: 1 }, cookie)).status).toBe(404);

    const gone = await api(`/api/crm/daily-logs/${id}`, { method: "DELETE" }, cookie);
    expect(gone.status).toBe(200);
    expect((await send("PATCH", `/api/crm/daily-logs/${id}`, { crewCount: 1 }, cookie)).status).toBe(404);
    const after = await api(`/api/crm/projects/${project.id}/daily-logs`, {}, cookie);
    expect(after.body.some((l: any) => l.id === id)).toBe(false);
  });

  it("webhook validation answers in a sentence and lists payment.reversed", async () => {
    const list = await api("/api/crm/webhooks", {}, cookie);
    expect(list.status).toBe(200);
    expect(list.body.events).toContain("payment.reversed");
    // The Stripe refund event integrations.ts already emits is subscribable too.
    expect(list.body.events).toContain("payment.refunded");

    const badUrl = await send("POST", "/api/crm/webhooks", { url: "example.com/hook", events: ["invoice.paid"] }, cookie);
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.message).toBe("Webhook URL must be a full web address, e.g. https://example.com/hooks/crm.");
    expect(Array.isArray(badUrl.body.issues)).toBe(true);

    const noEvents = await send("POST", "/api/crm/webhooks", { url: "https://example.com/hooks/crm", events: [] }, cookie);
    expect(noEvents.status).toBe(400);
    expect(noEvents.body.message).toBe("Pick at least one event to send.");

    const unknown = await send("POST", "/api/crm/webhooks", { url: "https://example.com/hooks/crm", events: ["invoice.exploded"] }, cookie);
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe(`"invoice.exploded" isn't a webhook event this CRM sends.`);
  });

  it("customer 400s name the field; PATCH audits only real changes", async () => {
    const bad = await send("POST", "/api/crm/customers", { displayName: `${RUN} bad`, email: "nope" }, cookie);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Enter a valid email address.");
    expect(Array.isArray(bad.body.issues)).toBe(true);

    const cust = await makeCustomer("audit", { phone: "555-0142", city: "Tacoma" });
    const badPatch = await send("PATCH", `/api/crm/customers/${cust.id}`, { email: "still-nope" }, cookie);
    expect(badPatch.body.message).toBe("Enter a valid email address.");

    const audits = async () => q(
      `select meta from crm_activity_log where org_id = $1 and action = 'customer.updated' and customer_id = $2 order by created_at`,
      [orgId, cust.id]);

    // Resending the stored values is not an edit.
    const same = await send("PATCH", `/api/crm/customers/${cust.id}`, { phone: "555-0142", city: "Tacoma" }, cookie);
    expect(same.status).toBe(200);
    // One real change among resent values logs just that field.
    const real = await send("PATCH", `/api/crm/customers/${cust.id}`, { phone: "555-0142", city: "Seattle" }, cookie);
    expect(real.status).toBe(200);
    let rows: any[] = [];
    for (let i = 0; i < 30 && !rows.length; i++) { rows = await audits(); if (!rows.length) await sleep(150); }
    await sleep(300);
    rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0].meta.fields).toEqual(["city"]);

    expect((await send("PATCH", `/api/crm/customers/00000000-0000-0000-0000-000000000000`, { city: "X" }, cookie)).status).toBe(404);
  });

  it("time-in-stage restarts only when the stage really changes", async () => {
    const { project } = await makeProject("stage");
    const moved = await send("PATCH", `/api/crm/projects/${project.id}`, { status: "estimating" }, cookie);
    expect(moved.status).toBe(200);
    const stamp = moved.body.stageChangedAt;
    await sleep(1100);
    const resent = await send("PATCH", `/api/crm/projects/${project.id}`, { status: "estimating", description: `${RUN} edit` }, cookie);
    expect(resent.status).toBe(200);
    expect(resent.body.stageChangedAt).toBe(stamp);
    const again = await send("PATCH", `/api/crm/projects/${project.id}`, { status: "lead" }, cookie);
    expect(new Date(again.body.stageChangedAt).getTime()).toBeGreaterThan(new Date(stamp).getTime());
  });

  it("a client hard delete takes their bell items with it", async () => {
    const lc = await api("/api/crm/integrations/lead-capture", {}, cookie);
    expect(lc.status).toBe(200);
    const name = `${RUN} lead`;
    const posted = await send("POST", `/api/public/leads/${lc.body.token}`, {
      name, email: `${RUN.replace(/\W+/g, "").toLowerCase()}.lead@example.com`, message: "R2 bell cleanup",
    });
    expect(posted.status).toBe(201);
    let lead: any = null;
    for (let i = 0; i < 30 && !lead; i++) {
      const found = await api(`/api/crm/customers?q=${encodeURIComponent(name)}`, {}, cookie);
      lead = (found.body as any[]).find((c) => c.displayName === name) ?? null;
      if (!lead) await sleep(150);
    }
    expect(lead).toBeTruthy();
    const bell = () => q(`select count(*)::int as n from crm_notifications where org_id = $1 and link like $2`,
      [orgId, `/crm/clients/${lead.id}%`]).then((r) => r[0].n as number);
    let n = 0;
    for (let i = 0; i < 30 && !n; i++) { n = await bell(); if (!n) await sleep(150); }
    expect(n).toBeGreaterThan(0);

    const del = await api(`/api/crm/customers/${lead.id}?force=1`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    expect(await bell()).toBe(0);
  });
});
