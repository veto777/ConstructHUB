/**
 * The New estimate dialog never loses work (owner, 2026-10-21). Pure rules first (shared/estimate-draft.ts: when the
 * dialog has content, so an outside click / Esc can't close it; what the autosave sends; the device mirror a refresh
 * restores), then the server side in-process on the lane Postgres: ONE draft per dialog session (create once with
 * autosave, then PATCH), the flag the dialog reads to offer "continue", Create clears it, Discard deletes only an
 * unfinished autosaved draft.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  autoTitleFrom, autosavePayload, clearDraftMirror, draftHasContent, draftMirrorKey, readDraftMirror, snapshotFromEstimate,
  writeDraftMirror, type EstimateDraftSnapshot,
} from "@shared/estimate-draft";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));

const blank = { kind: "labor", name: "", description: "", quantityMilli: 1000, unit: "", unitPriceCents: 0, taxable: true };
const empty: EstimateDraftSnapshot = { title: "Estimate", intro: "", taxPct: "9.1", taxTouched: false, items: [{ ...blank }] };
// The owner's lost estimate.
const OWNER: EstimateDraftSnapshot = {
  title: "Siding Remodel - James Hardie Color Plus", intro: "Thanks for having us out.", taxPct: "9.1", taxTouched: true,
  items: [{ ...blank, name: "Siding Remodel - James Hardie Color Plus", unit: "sf", quantityMilli: 2_200_000, unitPriceCents: 1650,
    description: "Remove existing siding, install house wrap, James Hardie ColorPlus lap siding, trim and caulk; haul away debris." }],
};

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe("draftHasContent — what blocks an outside click / Esc from closing the dialog", () => {
  it("an untouched dialog (default title, blank line, pre-filled tax) closes freely", () => {
    expect(draftHasContent(empty)).toBe(false);
    expect(draftHasContent(null)).toBe(false);
  });
  it("any typed content keeps it open: a title, a message, a line name, a scope, a price", () => {
    expect(draftHasContent({ ...empty, title: "Roof", autoTitle: false })).toBe(true);
    // An automatic title is not content of its own (the lines it comes from are).
    expect(draftHasContent({ ...empty, title: "Roof", autoTitle: true })).toBe(false);
    expect(draftHasContent({ ...empty, intro: "Hi" })).toBe(true);
    expect(draftHasContent({ ...empty, items: [{ ...blank, name: "Gutters" }] })).toBe(true);
    expect(draftHasContent({ ...empty, items: [{ ...blank, description: "scope only" }] })).toBe(true);
    expect(draftHasContent({ ...empty, items: [{ ...blank, unitPriceCents: 1650 }] })).toBe(true);
    expect(draftHasContent(OWNER)).toBe(true);
  });
});

describe("autoTitleFrom — the title follows the lines until the user types one", () => {
  const L = (name: string, kind = "labor") => ({ name, kind });
  it("one, two, three+ lines, in order; blanks and discount lines skipped", () => {
    expect(autoTitleFrom([])).toBe("Estimate");
    expect(autoTitleFrom([L("  ")])).toBe("Estimate");
    expect(autoTitleFrom([L("Door Remodel")])).toBe("Door Remodel");
    // The owner's screenshot: the picked-then-replaced "Door Remodel" must not linger.
    expect(autoTitleFrom([L("Siding Remodel - Primed (NO PAINT)"), L("Exterior Painting")]))
      .toBe("Siding Remodel - Primed (NO PAINT) + Exterior Painting");
    expect(autoTitleFrom([L("Siding Remodel"), L("Exterior Painting"), L("Seamless Gutter")])).toBe("Siding Remodel + Exterior Painting + 1 more");
    expect(autoTitleFrom([L("A"), L("Discount", "discount")])).toBe("A");
    expect(autoTitleFrom([L("x".repeat(150)), L("y".repeat(150))]).length).toBeLessThanOrEqual(200);
  });
  it("a draft from before auto titles (no meta) is recomputed; only a typed title stays manual", () => {
    const items = [{ kind: "labor", name: "Door Remodel", quantityMilli: 1000, unitPriceCents: 500000, taxable: true }];
    expect(snapshotFromEstimate({ title: "Seamless Gutter Installation" }, items).autoTitle).toBe(true);
    expect(snapshotFromEstimate({ title: "Smith job", autosaveMeta: { autoTitle: false } }, items).autoTitle).toBe(false);
    expect(autosavePayload({ ...OWNER, autoTitle: false }).autosaveMeta).toMatchObject({ autoTitle: false });
  });
});

describe("autosavePayload", () => {
  it("keeps every line with content, names a nameless one, drops untouched blanks", () => {
    const p = autosavePayload({ ...OWNER, items: [...OWNER.items, { ...blank }, { ...blank, description: "Exterior paint scope" }] });
    expect(p).toMatchObject({ title: OWNER.title, introText: "Thanks for having us out.", taxRateBps: 910 });
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ quantityMilli: 2_200_000, unitPriceCents: 1650, unit: "sf", sortOrder: 0 });
    expect(p.items[0].description).toContain("James Hardie ColorPlus");
    expect(p.items[1]).toMatchObject({ name: "Untitled item", description: "Exterior paint scope", sortOrder: 1 });
  });
});

describe("device mirror — what a refresh restores", () => {
  it("round-trips title, tax, message, every line and every scope; survives junk and blocked storage", () => {
    const st = new MemStorage();
    const key = draftMirrorKey("org-1", "cust-1");
    writeDraftMirror(key, { ...OWNER, draftId: "est-1", open: true }, st);
    const back = readDraftMirror(key, st)!;
    expect(back).toMatchObject({ ...OWNER, draftId: "est-1", open: true, v: 1 });
    expect(back.items[0].description).toBe(OWNER.items[0].description);
    clearDraftMirror(key, st);
    expect(readDraftMirror(key, st)).toBeNull();
    st.setItem(key, "{not json");
    expect(readDraftMirror(key, st)).toBeNull();
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(readDraftMirror(key, throwing)).toBeNull();
    expect(() => writeDraftMirror(key, { ...OWNER, draftId: null, open: true }, throwing)).not.toThrow();
    expect(draftMirrorKey("org-1", "cust-2")).not.toBe(key);
  });
  it("a server draft loads back into the form (continue a draft)", () => {
    const snap = snapshotFromEstimate({ title: "T", introText: null, taxRateBps: 910 },
      [{ kind: "labor", name: "Untitled item", description: "d", quantityMilli: 1000, unitPriceCents: 5, taxable: true }]);
    expect(snap).toMatchObject({ title: "T", intro: "", taxPct: "9.1", items: [{ name: "", description: "d" }] });
  });
});

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("autosaved drafts through the CRM routes (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, orgId = "", customerId = "";

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const r = await fetch(base + path, {
      method, headers: { "content-type": "application/json", "x-fixture-user": String(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const estimatesOf = async () => (await pool.query(
    "SELECT id, status, custom_fields, title FROM crm_estimates WHERE org_id=$1 AND customer_id=$2 ORDER BY created_at", [orgId, customerId])).rows;

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    await (await import("./schema-ensure")).ensureCrmSchema();
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-autosave-${randomUUID()}@example.invalid`])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    const c = await call("/api/crm/customers", { displayName: "Autosave Client", email: `as-${randomUUID()}@example.invalid`, addressLine1: "1 Main", city: "Blaine", state: "WA" });
    customerId = c.data.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (orgId) {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
      for (const { table_name } of rows) await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
      await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
    }
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  });

  it("autosave creates exactly ONE draft, then updates it; Create finishes that same estimate", async () => {
    const first = await call("/api/crm/estimates", { customerId, ...autosavePayload({ ...OWNER, items: [] }), autosave: true });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ status: "draft", autosave: true, sentAt: null, autosaveMeta: { autoTitle: true } });
    for (const step of [1, 2, 3]) {
      const r = await call(`/api/crm/estimates/${first.data.id}`, autosavePayload({ ...OWNER, intro: `v${step}` }), "PATCH");
      expect(r.status).toBe(200);
    }
    let rows = await estimatesOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].custom_fields.autosave).toBeTruthy();
    // The auto/manual title flag rides along with the draft.
    await call(`/api/crm/estimates/${first.data.id}`, autosavePayload({ ...OWNER, intro: "v3", autoTitle: false }), "PATCH");
    const detail = await call(`/api/crm/estimates/${first.data.id}`);
    expect(detail.data.estimate.autosaveMeta).toMatchObject({ autoTitle: false });
    expect(detail.data.items[0]).toMatchObject({ quantityMilli: 2_200_000, unitPriceCents: 1650 });
    expect(detail.data.estimate.introText).toBe("v3");
    // The client page lists it like any draft, flagged so "New estimate" offers to continue it.
    const page = await call(`/api/crm/customers/${customerId}`);
    expect((page.data.estimates ?? []).find((e: any) => e.id === first.data.id)).toMatchObject({ status: "draft", autosave: true });

    const done = await call(`/api/crm/estimates/${first.data.id}`, { ...autosavePayload(OWNER), autosave: false }, "PATCH");
    expect(done.status).toBe(200);
    rows = await estimatesOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].custom_fields?.autosave).toBeUndefined();
    expect(done.data.autosave).toBeUndefined();
    // Finished: Discard can no longer delete it.
    expect((await call(`/api/crm/estimates/${first.data.id}/autosave`, undefined, "DELETE")).status).toBe(409);
  });

  it("Discard deletes only the unfinished autosaved draft", async () => {
    const d = await call("/api/crm/estimates", { customerId, ...autosavePayload(OWNER), autosave: true });
    const before = (await estimatesOf()).length;
    expect((await call(`/api/crm/estimates/${d.data.id}/autosave`, undefined, "DELETE")).status).toBe(200);
    expect((await estimatesOf()).length).toBe(before - 1);
    const plain = await call("/api/crm/estimates", { customerId, ...autosavePayload(OWNER) });
    expect((await call(`/api/crm/estimates/${plain.data.id}/autosave`, undefined, "DELETE")).status).toBe(409);
    expect((await call(`/api/crm/estimates/${randomUUID()}/autosave`, undefined, "DELETE")).status).toBe(404);
  });
});
