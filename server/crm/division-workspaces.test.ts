/**
 * Division WORKSPACES (owner, 2026-10-17: "keep divisions separate even for
 * the owner so everything is not in one place").
 *
 *   1. Pure: workspace resolution (a pinned seat never escapes; "all" / a
 *      division id / the saved pick), scoping through divisionScopeOf(ctx),
 *      labels and tab order, the this-month window, and the sort-unassigned
 *      suggestions — real links only.
 *   2. Dev server (CRM_TEST_BASE_URL, a throwaway org of the dev-bypass user):
 *      the owner inside one division sees only that division's estimates,
 *      projects, invoices, clients and stats; "all" restores everything; the
 *      saved pick applies without the header; creation lands in the active
 *      division; a pinned admin's header is IGNORED (and the switch route is
 *      403); the overview's per-division numbers equal that workspace's
 *      /api/crm/stats; and the sort preview/apply uses only real signals.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL
  ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

let divisions: typeof import("./divisions");
let ws: typeof import("./division-workspaces");
let shared: typeof import("@shared/divisions");
let access: typeof import("./object-access");

beforeAll(async () => {
  divisions = await import("./divisions");
  ws = await import("./division-workspaces");
  shared = await import("@shared/divisions");
  access = await import("./object-access");
});

// ── 1. Pure ─────────────────────────────────────────────────────────────────

describe("workspace resolution (pure)", () => {
  const ids = ["d-fl", "d-wa"];
  const owner = { role: "owner", divisionId: null, activeDivisionId: null as string | null };

  it("an unpinned seat follows the header, then its saved pick, and never a division outside the org", () => {
    expect(divisions.resolveActiveDivision(owner, "d-fl", ids)).toBe("d-fl");
    expect(divisions.resolveActiveDivision(owner, "all", ids)).toBeNull();
    expect(divisions.resolveActiveDivision(owner, "ALL", ids)).toBeNull();
    expect(divisions.resolveActiveDivision({ ...owner, activeDivisionId: "d-wa" }, null, ids)).toBe("d-wa");
    expect(divisions.resolveActiveDivision({ ...owner, activeDivisionId: "d-wa" }, "all", ids)).toBeNull();
    expect(divisions.resolveActiveDivision(owner, "d-foreign", ids)).toBeNull();
    expect(divisions.resolveActiveDivision({ ...owner, activeDivisionId: "d-wa" }, "d-deleted", ids)).toBe("d-wa");
    expect(divisions.resolveActiveDivision({ ...owner, activeDivisionId: "d-gone" }, null, ids)).toBeNull();
    // A division-less admin is unpinned too; an owner with a divisionId is still the owner.
    expect(divisions.resolveActiveDivision({ role: "admin", divisionId: null }, "d-fl", ids)).toBe("d-fl");
    expect(divisions.resolveActiveDivision({ role: "owner", divisionId: "d-wa" }, "d-fl", ids)).toBe("d-fl");
  });

  it("a pinned seat ignores the header and its saved pick: its pin is the scope", () => {
    const pinned = { role: "admin", divisionId: "d-wa", activeDivisionId: "d-fl" };
    expect(divisions.canSwitchDivision(pinned)).toBe(false);
    expect(divisions.resolveActiveDivision(pinned, "d-fl", ids)).toBeNull();
    expect(divisions.resolveActiveDivision(pinned, "all", ids)).toBeNull();
    expect(divisions.divisionScopeOf({ member: pinned, activeDivisionId: "d-fl" })).toBe("d-wa");
    expect(divisions.divisionScopeOf({ member: pinned, activeDivisionId: null })).toBe("d-wa");
  });

  it("divisionScopeOf(ctx): the owner is scoped to his workspace, unscoped in All divisions", () => {
    expect(divisions.divisionScopeOf({ member: owner, activeDivisionId: "d-fl" })).toBe("d-fl");
    expect(divisions.divisionScopeOf({ member: owner, activeDivisionId: null })).toBeNull();
    expect(divisions.divisionScopeOf({ member: owner })).toBeNull();
    // The bare-member form keeps its old (pin-only) answer.
    expect(divisions.divisionScopeOf(owner)).toBeNull();
    expect(divisions.divisionScopeOf({ role: "pm", divisionId: "d-wa" })).toBe("d-wa");
  });
});

describe("labels, order, states (pure)", () => {
  it("labels by code + region from the division's state; both Alpine divisions share a name", () => {
    expect(shared.divisionLabel({ name: "Alpine Exteriors", code: "FL", state: "FL" })).toBe("FL · Florida");
    expect(shared.divisionLabel({ name: "Alpine Exteriors", code: "WA", state: "Washington" })).toBe("WA · Washington");
    expect(shared.divisionLabel({ name: "North arm", code: "N", state: null })).toBe("N · North arm");
  });
  it("tabs run by code: FL before WA", () => {
    const sorted = shared.sortDivisions([
      { id: "w", name: "Alpine Exteriors", code: "WA", state: "WA" },
      { id: "f", name: "Alpine Exteriors", code: "FL", state: "FL" },
    ]);
    expect(sorted.map((d) => d.code)).toEqual(["FL", "WA"]);
  });
  it("normalizes a state only when it is exactly a code or a name", () => {
    expect(shared.normalizeUsState(" wa ")).toBe("WA");
    expect(shared.normalizeUsState("Florida")).toBe("FL");
    expect(shared.normalizeUsState("new  york")).toBe("NY");
    expect(shared.normalizeUsState("Fla")).toBeNull();
    expect(shared.normalizeUsState("")).toBeNull();
    expect(shared.normalizeUsState(null)).toBeNull();
  });
});

describe("this-month window (pure)", () => {
  it("starts at local midnight on the 1st in the org's zone", () => {
    // 2026-10-17 12:00 UTC → Oct 1 00:00 in Los Angeles (PDT, UTC-7) = 07:00 UTC.
    expect(ws.monthStartIn(new Date("2026-10-17T12:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-10-01T07:00:00.000Z");
    // Across a DST change: Nov 20 (PST) → Nov 1 00:00 PDT = 07:00 UTC.
    expect(ws.monthStartIn(new Date("2026-11-20T12:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    // 2026-10-01 03:00 UTC is still September in Los Angeles.
    expect(ws.monthStartIn(new Date("2026-10-01T03:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-09-01T07:00:00.000Z");
    expect(ws.monthStartIn(new Date("2026-10-17T12:00:00Z"), "Not/AZone").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("the year starts at local midnight on Jan 1 (revenue 'this year')", () => {
    // Jan 1 00:00 PST = 08:00 UTC; New York (EST) = 05:00 UTC.
    expect(ws.yearStartIn(new Date("2026-10-17T12:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(ws.yearStartIn(new Date("2026-10-17T12:00:00Z"), "America/New_York").toISOString()).toBe("2026-01-01T05:00:00.000Z");
    // 2026-01-01 03:00 UTC is still 2025 in Los Angeles.
    expect(ws.yearStartIn(new Date("2026-01-01T03:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2025-01-01T08:00:00.000Z");
    expect(ws.yearStartIn(new Date("2026-03-05T12:00:00Z"), null).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("sort-unassigned suggestions (pure, real links only)", () => {
  const d = [{ id: "fl", state: "FL" }, { id: "wa", state: "WA" }];
  const t = (n: number) => new Date(2026, 0, n);
  const base = {
    divisions: d,
    customers: [
      { id: "c-state", displayName: "State only", state: "Florida" },
      { id: "c-proj", displayName: "Has a WA job", state: "FL" },
      { id: "c-none", displayName: "Illinois", state: "IL" },
      { id: "c-blank", displayName: "No address", state: null },
    ],
    projects: [
      { id: "p-wa-old", customerId: "c-proj", name: "Old WA job", divisionId: "wa", state: "WA", createdAt: t(1) },
      { id: "p-new", customerId: "c-proj", name: "New job", divisionId: null, state: null, createdAt: t(5) },
      { id: "p-addr", customerId: "c-blank", name: "Job with address", divisionId: null, state: "WA", createdAt: t(2) },
    ],
    estimates: [
      { id: "e-state", customerId: "c-state", projectId: null, number: "E-1", title: null },
      { id: "e-proj", customerId: "c-proj", projectId: "p-new", number: "E-2", title: null },
      { id: "e-none", customerId: "c-none", projectId: null, number: "E-3", title: null },
      { id: "e-blank", customerId: "c-blank", projectId: null, number: "E-4", title: null },
    ],
    unassigned: {
      customers: new Set(["c-state", "c-none", "c-blank"]),
      projects: new Set(["p-new", "p-addr"]),
      estimates: new Set(["e-state", "e-proj", "e-none", "e-blank"]),
    },
  };
  const by = (rows: any[]) => Object.fromEntries(rows.map((r) => [`${r.kind}:${r.id}`, [r.suggestedDivisionId, r.reason]]));

  it("project division → client's latest project with a division → client's state → project address; nothing else", () => {
    const s = by(ws.suggestDivisions(base));
    expect(s["estimate:e-state"]).toEqual(["fl", "customer_state"]);
    // The client's service address says FL, but their most recent project WITH a division is WA — that link wins.
    expect(s["estimate:e-proj"]).toEqual(["wa", "customer_project"]);
    expect(s["project:p-new"]).toEqual(["wa", "customer_project"]);
    expect(s["estimate:e-none"]).toEqual([null, null]);       // IL matches no division
    expect(s["customer:c-none"]).toEqual([null, null]);
    expect(s["customer:c-blank"]).toEqual([null, null]);      // no state, no project division
    expect(s["estimate:e-blank"]).toEqual([null, null]);      // projectless: the job address is not its signal
    expect(s["project:p-addr"]).toEqual(["wa", "project_state"]);
    expect(s["customer:c-state"]).toEqual(["fl", "customer_state"]);
  });

  it("a state shared by two divisions is no suggestion", () => {
    const s = by(ws.suggestDivisions({ ...base, divisions: [...d, { id: "fl2", state: "fl" }] }));
    expect(s["estimate:e-state"]).toEqual([null, null]);
  });
});

describe("notification links (pure)", () => {
  it("finds the record an in-app link points at", () => {
    expect(access.linkedObject("/crm/clients/abc")).toEqual({ kind: "customers", id: "abc" });
    expect(access.linkedObject("/crm/projects/p1?tab=punch")).toEqual({ kind: "projects", id: "p1" });
    expect(access.linkedObject("/crm/inbox?c=c9")).toEqual({ kind: "customers", id: "c9" });
    expect(access.linkedObject("/crm/settings")).toBeNull();
    expect(access.linkedObject(null)).toBeNull();
  });
});

// ── 2. Dev server ───────────────────────────────────────────────────────────

describe("division workspaces (dev server)", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const org = randomUUID();
  const memberId = randomUUID();
  const run = Date.now().toString(36);
  let cookie = "";
  let homeOrg: string | null = null;
  let up = false;

  async function api(method: string, path: string, body?: unknown, division?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    if (division) headers["x-crm-division"] = division;
    const r = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: r.status, json, text };
  }

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const me = await api("GET", "/api/crm/me").catch(() => null);
    if (!me || me.status !== 200) return;
    up = true;
    homeOrg = me.json.org.id;
    await pool.query("insert into crm_orgs(id,name,owner_user_id,timezone) values ($1,$2,1,'America/Los_Angeles')", [org, `Vitest divisions ${run}`]);
    await pool.query("insert into crm_members(id,org_id,user_id,email,role,status,display_name) values ($1,$2,1,$3,'owner','active','Owner Under Test')",
      [memberId, org, `vitest-divws-${run}@example.invalid`]);
    expect((await api("POST", "/api/crm/org/switch", { orgId: org })).status).toBe(200);

    const div = async (code: string, state: string, city: string) => {
      const r = await api("POST", "/api/crm/divisions", { name: "Alpine Exteriors", code, state, city });
      expect(r.status).toBe(201);
      return r.json.id as string;
    };
    ids.wa = await div("WA", "WA", "Bellingham");
    ids.fl = await div("FL", "FL", "Largo");

    // One full set per division, created in All divisions with explicit picks.
    const set = async (tag: string, divisionId: string | null, state: string | null) => {
      const c = await api("POST", "/api/crm/customers", { addressLine1: "100 Test St", displayName: `Vitest ${tag} ${run}`, state, ...(divisionId ? { divisionId } : {}) }, "all");
      expect(c.status).toBe(201);
      const p = await api("POST", "/api/crm/projects", { customerId: c.json.id, name: `Vitest ${tag} job`, ...(divisionId ? { divisionId } : {}) }, "all");
      expect(p.status).toBe(201);
      const e = await api("POST", "/api/crm/estimates", {
        customerId: c.json.id, projectId: p.json.id, items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 100_00 }],
      }, "all");
      expect(e.status).toBe(201);
      expect((await api("PATCH", `/api/crm/estimates/${e.json.id}`, { status: "sent" }, "all")).status).toBe(200);
      const i = await api("POST", "/api/crm/invoices", {
        customerId: c.json.id, projectId: p.json.id, items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 100_00 }],
      }, "all");
      expect(i.status).toBe(201);
      ids[`${tag}C`] = c.json.id; ids[`${tag}P`] = p.json.id; ids[`${tag}E`] = e.json.id; ids[`${tag}I`] = i.json.id;
    };
    await set("wa", ids.wa, "WA");
    await set("fl", ids.fl, "FL");
    // Unassigned: a Florida client (service address) and an Illinois one. A client CREATED with a Florida
    // address is placed in FL at once now, so "un" is a legacy record: created without a state, then given one.
    await set("un", null, null);
    await pool.query("update crm_customers set state = 'Florida' where id = $1", [ids.unC]);
    await set("il", null, "IL");
  }, 120_000);

  afterAll(async () => {
    if (up) {
      await pool.query("update crm_members set role='owner', division_id=null where id=$1", [memberId]).catch(() => {});
      if (homeOrg) await api("POST", "/api/crm/org/switch", { orgId: homeOrg }).catch(() => {});
      const { rows } = await pool.query(
        "select table_name from information_schema.columns where column_name='org_id' and table_schema=current_schema() and table_name <> 'crm_orgs'");
      for (const { table_name } of rows) await pool.query(`delete from "${table_name}" where org_id = $1`, [org]).catch(() => {});
      await pool.query("delete from crm_orgs where id=$1", [org]);
    }
    await pool.end();
  }, 60_000);

  const listIds = (body: any, key?: string) => (key ? body[key] : body).map((r: any) => r.id ?? r.doc?.id);

  it("a client created in All divisions with an address lands in that address's division", async () => {
    if (!up) return expect.fail(`dev server not reachable at ${BASE}`);
    const c = await api("POST", "/api/crm/customers", { addressLine1: "5590 Example Rd", city: "Bellingham", postalCode: "98226", displayName: `Vitest addr ${run}` }, "all");
    expect(c.status).toBe(201);
    expect(c.json.divisionId).toBe(ids.wa);
    await pool.query("delete from crm_customers where id = $1", [c.json.id]);
  });

  it("inside FL the owner sees only FL — estimates, projects, invoices, clients, stats; All restores everything", async () => {
    if (!up) return expect.fail(`dev server not reachable at ${BASE}`);
    const est = listIds((await api("GET", "/api/crm/estimates", undefined, ids.fl)).json);
    expect(est).toEqual([ids.flE]);
    const proj = listIds((await api("GET", "/api/crm/projects", undefined, ids.fl)).json, "projects");
    expect(proj).toEqual([ids.flP]);
    const inv = listIds((await api("GET", "/api/crm/invoices", undefined, ids.fl)).json);
    expect(inv).toEqual([ids.flI]);
    const cust = listIds((await api("GET", "/api/crm/customers", undefined, ids.fl)).json);
    expect(cust).toEqual([ids.flC]);
    const doc = (await api("GET", "/api/crm/estimates?status=sent,viewed&limit=50", undefined, ids.fl)).json;
    expect(doc.filtered).toBe(1);
    expect(doc.total).toBe(1); // the "of N" total is the workspace's too
    const stats = (await api("GET", "/api/crm/stats", undefined, ids.fl)).json;
    expect(stats.openEstimates).toEqual({ count: 1, totalCents: 100_00 });
    expect(stats.openPipeline.count).toBe(1);
    expect(stats.clients.count).toBe(1);

    const all = (await api("GET", "/api/crm/estimates", undefined, "all")).json.map((e: any) => e.id).sort();
    expect(all).toEqual([ids.waE, ids.flE, ids.unE, ids.ilE].sort());
    expect((await api("GET", "/api/crm/stats", undefined, "all")).json.openEstimates.count).toBe(4);
  });

  it("another division's record answers 404 other_division, not a silent 'not found'", async () => {
    if (!up) return;
    const r = await api("GET", `/api/crm/projects/${ids.waP}`, undefined, ids.fl);
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("other_division");
    const gone = await api("GET", `/api/crm/projects/${randomUUID()}`, undefined, ids.fl);
    expect(gone.status).toBe(404);
    expect(gone.json.code).toBeUndefined();
  });

  it("the saved pick (PUT /divisions/workspace) applies without the header and is reported by /api/crm/me", async () => {
    if (!up) return;
    expect((await api("PUT", "/api/crm/divisions/workspace", { workspace: ids.wa })).status).toBe(200);
    const me = (await api("GET", "/api/crm/me")).json;
    expect(me.divisionWorkspace).toMatchObject({ activeDivisionId: ids.wa, canSwitch: true, pinnedDivisionId: null });
    expect((await api("GET", "/api/crm/estimates")).json.map((e: any) => e.id)).toEqual([ids.waE]);
    // The header still wins for this request.
    expect((await api("GET", "/api/crm/estimates", undefined, "all")).json.length).toBe(4);
    expect((await api("PUT", "/api/crm/divisions/workspace", { workspace: randomUUID() })).status).toBe(400);
    expect((await api("PUT", "/api/crm/divisions/workspace", { workspace: "all" })).status).toBe(200);
    expect((await api("GET", "/api/crm/estimates")).json.length).toBe(4);
  });

  it("new clients, projects and estimates default to the active division", async () => {
    if (!up) return;
    const c = await api("POST", "/api/crm/customers", { addressLine1: "100 Test St", displayName: `Vitest new FL ${run}` }, ids.fl);
    expect(c.status).toBe(201);
    expect(c.json.divisionId).toBe(ids.fl);
    const p = await api("POST", "/api/crm/projects", { customerId: c.json.id, name: "New FL job" }, ids.fl);
    expect(p.status).toBe(201);
    expect(p.json.divisionId).toBe(ids.fl);
    const e = await api("POST", "/api/crm/estimates", {
      customerId: c.json.id, items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 1 }],
    }, ids.fl);
    expect(e.status).toBe(201);
    expect(e.json.divisionId).toBe(ids.fl);
    const fl = listIds((await api("GET", "/api/crm/customers", undefined, ids.fl)).json);
    expect(fl).toContain(c.json.id);
    expect(listIds((await api("GET", "/api/crm/customers", undefined, ids.wa)).json)).not.toContain(c.json.id);
    // In All divisions nothing is defaulted.
    const any = await api("POST", "/api/crm/customers", { addressLine1: "100 Test St", displayName: `Vitest new all ${run}` }, "all");
    expect(any.json.divisionId).toBeNull();
    ids.newFlC = c.json.id; ids.newFlP = p.json.id; ids.newFlE = e.json.id; ids.newAllC = any.json.id;
  });

  it("the overview: each division's own numbers (= that workspace's /api/crm/stats), Unassigned, and a labelled company total", async () => {
    if (!up) return;
    const o = await api("GET", "/api/crm/divisions/overview", undefined, "all");
    expect(o.status).toBe(200);
    expect(o.json.divisions.map((d: any) => d.label)).toEqual(["FL · Florida", "WA · Washington"]);
    for (const d of o.json.divisions) {
      const stats = (await api("GET", "/api/crm/stats", undefined, d.id)).json;
      expect(d.kpis.openEstimates).toEqual(stats.openEstimates);
      expect(d.kpis.activeProjects).toEqual(stats.openPipeline);
      expect(d.kpis.clients.count).toBe(stats.clients.count);
      expect(d.kpis.outstanding).toEqual(stats.openInvoices);
    }
    const wa = o.json.divisions.find((d: any) => d.code === "WA");
    expect(wa.kpis.records).toEqual({ customers: 1, projects: 1, estimates: 1, invoices: 1 });
    expect(o.json.unassigned.records).toEqual({ customers: 3, projects: 2, estimates: 2, invoices: 2 });
    expect(o.json.companyTotal.openEstimates.count).toBe(4);
    expect(o.json.companyTotal.records.estimates).toBe(
      o.json.divisions.reduce((n: number, d: any) => n + d.kpis.records.estimates, 0) + o.json.unassigned.records.estimates);
  });

  it("sort unassigned: preview from real links only, apply one division's suggestions, the rest stay unassigned (logged)", async () => {
    if (!up) return;
    const p = await api("GET", "/api/crm/divisions/unassigned");
    expect(p.status).toBe(200);
    const s = Object.fromEntries(p.json.records.map((r: any) => [r.id, [r.suggestedDivisionId, r.reason]]));
    expect(s[ids.unE]).toEqual([ids.fl, "customer_state"]);
    expect(s[ids.unP]).toEqual([ids.fl, "customer_state"]);
    expect(s[ids.unC]).toEqual([ids.fl, "customer_state"]);
    expect(s[ids.ilE]).toEqual([null, null]);
    expect(s[ids.ilC]).toEqual([null, null]);
    expect(s[ids.newAllC]).toEqual([null, null]);       // no state, no project: nothing to go on
    expect(s[ids.waE]).toBeUndefined();                 // assigned rows are not offered
    expect(p.json.byDivision[ids.fl]).toEqual({ customers: 1, projects: 1, estimates: 1 });
    expect(p.json.noSuggestion).toEqual({ customers: 2, projects: 1, estimates: 1 });

    const applied = await api("POST", "/api/crm/divisions/unassigned/apply", { divisionIds: [ids.fl] });
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ customers: 1, projects: 1, estimates: 1 });
    const row = (await pool.query("select division_id from crm_estimates where id=$1", [ids.unE])).rows[0];
    expect(row.division_id).toBe(ids.fl);
    expect((await pool.query("select division_id from crm_estimates where id=$1", [ids.ilE])).rows[0].division_id).toBeNull();
    const log = await pool.query("select meta from crm_activity_log where org_id=$1 and action='divisions.unassigned_sorted'", [org]);
    expect(log.rows.length).toBe(1);
    // The FL workspace now holds the sorted work too; the Illinois client stays in All only.
    const fl = (await api("GET", "/api/crm/estimates", undefined, ids.fl)).json.map((e: any) => e.id);
    expect(fl).toEqual(expect.arrayContaining([ids.flE, ids.unE, ids.newFlE]));
    expect(fl).not.toContain(ids.ilE);

    // By hand: the Illinois estimate into WA.
    expect((await api("POST", "/api/crm/divisions/assign", { kind: "estimate", id: ids.ilE, divisionId: ids.wa })).status).toBe(200);
    expect((await api("GET", "/api/crm/estimates", undefined, ids.wa)).json.map((e: any) => e.id)).toContain(ids.ilE);
  });

  it("a pinned admin cannot switch: the header is ignored and the switch / overview routes answer 403", async () => {
    if (!up) return;
    await pool.query("update crm_members set role='admin', division_id=$1 where id=$2", [ids.wa, memberId]);
    try {
      const est = (await api("GET", "/api/crm/estimates", undefined, ids.fl)).json.map((e: any) => e.id);
      expect(est).toContain(ids.waE);
      expect(est).not.toContain(ids.flE);
      expect((await api("GET", "/api/crm/estimates", undefined, "all")).json.map((e: any) => e.id)).not.toContain(ids.flE);
      expect((await api("PUT", "/api/crm/divisions/workspace", { workspace: ids.fl })).status).toBe(403);
      expect((await api("GET", "/api/crm/divisions/overview", undefined, ids.fl)).status).toBe(403);
      expect((await api("GET", "/api/crm/divisions/unassigned")).status).toBe(403);
      const me = (await api("GET", "/api/crm/me", undefined, ids.fl)).json;
      expect(me.divisionWorkspace).toMatchObject({ canSwitch: false, pinnedDivisionId: ids.wa, activeDivisionId: null });
      // Nor can a pinned seat move work into another division.
      expect((await api("PATCH", `/api/crm/projects/${ids.waP}`, { divisionId: ids.fl })).status).toBe(404);
    } finally {
      await pool.query("update crm_members set role='owner', division_id=null where id=$1", [memberId]);
    }
  });

  it("a division still used by estimates or clients cannot be deleted", async () => {
    if (!up) return;
    const r = await api("DELETE", `/api/crm/divisions/${ids.fl}`);
    expect(r.status).toBe(409);
    expect(r.json.estimates).toBeGreaterThan(0);
    expect(r.json.customers).toBeGreaterThan(0);
  });
});
