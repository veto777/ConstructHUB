/**
 * Estimate options as tabs, duplicates, copies and templates (server/crm/estimate-options.ts), and the client's
 * "Only one option / Any options" rule on select-options (portal.ts). In-process on the lane Postgres with a
 * throwaway org (deleted afterwards); the public route runs with a client session row like doc-defaults.test.ts.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { optionTotals } from "./estimate-options";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
process.env.WA_DOR_ADDRESS_LOOKUP = "off";

describe("optionTotals", () => {
  it("uses the shared math: tax after the option's own discount line, taxable lines only", () => {
    expect(optionTotals([
      { kind: "labor", name: "Siding", quantityMilli: 1000, unitPriceCents: 100_000, taxable: true } as any,
      { kind: "labor", name: "Permit", quantityMilli: 1000, unitPriceCents: 10_000, taxable: false } as any,
      { kind: "discount", name: "Discount", quantityMilli: 1000, unitPriceCents: 10_000, taxable: false } as any,
    ], 1000)).toEqual({ subtotalCents: 110_000, totalCents: 110_000 - 10_000 + 9_000 });
  });
});

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("options, copies and templates through the routes (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, orgId = "", customerId = "", otherCustomerId = "";
  const hashes: string[] = [];

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie?: string) {
    const r = await fetch(base + path, {
      method, headers: { "content-type": "application/json", "x-fixture-user": String(userId), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const L = (name: string, cents: number, extra: Record<string, unknown> = {}) => ({ name, unitPriceCents: cents, quantityMilli: 1000, ...extra });
  const optionsOf = async (estId: string) => (await pool.query(
    "SELECT id, name, tier, is_main, cancelled_at, items FROM crm_estimate_options WHERE estimate_id=$1 ORDER BY tier", [estId])).rows;
  async function clientCookie(cust: string) {
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    hashes.push(hash);
    await pool.query(`INSERT INTO crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) VALUES ($1,$2::jsonb, now() + interval '1 day', now())`,
      [hash, JSON.stringify([cust])]);
    return `crm_client=${raw}`;
  }

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    await (await import("./schema-ensure")).ensureCrmSchema();
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-opts-${randomUUID()}@example.invalid`])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    await pool.query("UPDATE crm_orgs SET default_tax_rate_bps=700 WHERE id=$1", [orgId]);
    customerId = (await call("/api/crm/customers", { displayName: "Options Client", addressLine1: "1 Main", email: `o-${randomUUID()}@example.invalid` })).data.id;
    otherCustomerId = (await call("/api/crm/customers", { displayName: "Other Client", addressLine1: "2 Main", city: "Tampa", state: "FL", email: `o2-${randomUUID()}@example.invalid` })).data.id;
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
    await pool.query("DELETE FROM crm_client_sessions WHERE token_hash = ANY($1::text[])", [hashes]);
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  });

  async function tabbedEstimate() {
    const e = await call("/api/crm/estimates", { customerId, taxRateBps: 1000, items: [L("Siding", 100_000)] });
    const set = await call(`/api/crm/estimates/${e.data.id}/option-set`, { options: [
      { name: "Option 1", items: [L("Siding", 100_000)] },
      { name: "Premium", items: [L("Siding premium", 150_000, { description: "ColorPlus" }), L("Trim", 20_000)] },
      { name: "Budget", items: [L("Siding budget", 80_000)] },
    ] }, "PUT");
    expect(set.status).toBe(200);
    return { id: e.data.id as string, rows: set.data.options as any[] };
  }

  it("option-set saves the tabs (Option 1 = main), keeps ids on re-save, and <2 tabs makes it a plain estimate again", async () => {
    const { id, rows } = await tabbedEstimate();
    expect(rows.map((r) => [r.name, r.isMain])).toEqual([["Option 1", true], ["Premium", false], ["Budget", false]]);
    expect(rows[1]).toMatchObject({ subtotalCents: 170_000, totalCents: 187_000 });
    // A legacy display tier (no lines) is not the popup's to manage.
    await call(`/api/crm/estimates/${id}/options`, { name: "Display only", totalCents: 5 });
    const again = await call(`/api/crm/estimates/${id}/option-set`, { options: [
      { id: rows[0].id, name: "Option 1", items: [L("Siding", 100_000)] },
      { id: rows[2].id, name: "Budget", items: [L("Siding budget", 80_000)] },
    ] }, "PUT");
    expect(again.data.options.filter((o: any) => o.items?.length).map((o: any) => o.id)).toEqual([rows[0].id, rows[2].id]);
    expect((await optionsOf(id)).map((o) => o.name)).toContain("Display only");
    await call(`/api/crm/estimates/${id}/option-set`, { options: [{ name: "Option 1", items: [L("Siding", 100_000)] }] }, "PUT");
    expect((await optionsOf(id)).map((o) => o.name)).toEqual(["Display only"]);
  });

  it("copy to new option is a deep copy with a new id; cancel hides it from the client; delete removes it", async () => {
    const { id, rows } = await tabbedEstimate();
    const dup = await call(`/api/crm/estimates/${id}/options/${rows[1].id}/duplicate`, {});
    expect(dup.status).toBe(201);
    expect(dup.data.id).not.toBe(rows[1].id);
    expect(dup.data).toMatchObject({ name: "Premium (copy)", isMain: false, subtotalCents: 170_000 });
    expect(dup.data.items).toEqual(rows[1].items);
    // Changing the copy leaves the source alone.
    await pool.query(`UPDATE crm_estimate_options SET items = '[]'::jsonb WHERE id=$1`, [dup.data.id]);
    expect((await optionsOf(id)).find((o) => o.id === rows[1].id).items).toHaveLength(2);

    expect((await call(`/api/crm/estimates/${id}/options/${rows[2].id}`, { cancelled: true }, "PATCH")).data.cancelledAt).toBeTruthy();
    await call(`/api/crm/estimates/${id}`, { status: "sent" }, "PATCH");
    const token = (await pool.query("SELECT public_token FROM crm_estimates WHERE id=$1", [id])).rows[0].public_token;
    const cookie = await clientCookie(customerId);
    const page = await call(`/api/public/estimates/${token}`, undefined, "GET", cookie);
    expect(page.status).toBe(200);
    expect(page.data.options.map((o: any) => o.name)).not.toContain("Budget");
    const pickCancelled = await call(`/api/public/estimates/${token}/select-options`, { optionIds: [rows[2].id] }, "POST", cookie);
    expect(pickCancelled.status).toBe(400);
    expect((await call(`/api/crm/estimates/${id}/options/${rows[2].id}`, { cancelled: false }, "PATCH")).data.cancelledAt).toBeNull();
    expect((await call(`/api/crm/estimates/${id}/options/${dup.data.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await optionsOf(id)).map((o) => o.id)).not.toContain(dup.data.id);
  });

  it("Only one option: the server refuses two; Any options: two are fine", async () => {
    const { id, rows } = await tabbedEstimate();
    await call(`/api/crm/estimates/${id}/option-approval`, { mode: "one" }, "PUT");
    expect((await call(`/api/crm/estimates/${id}`)).data.estimate.optionApproval).toBe("one");
    await call(`/api/crm/estimates/${id}`, { status: "sent" }, "PATCH");
    const token = (await pool.query("SELECT public_token FROM crm_estimates WHERE id=$1", [id])).rows[0].public_token;
    const cookie = await clientCookie(customerId);
    expect((await call(`/api/public/estimates/${token}`, undefined, "GET", cookie)).data.optionApproval).toBe("one");
    const two = await call(`/api/public/estimates/${token}/select-options`, { optionIds: [rows[1].id, rows[2].id] }, "POST", cookie);
    expect(two.status).toBe(400);
    expect(two.data.message).toMatch(/just one option/);
    const one = await call(`/api/public/estimates/${token}/select-options`, { optionIds: [rows[1].id] }, "POST", cookie);
    expect(one.status).toBeLessThan(300);
    const any = await tabbedEstimate();
    await call(`/api/crm/estimates/${any.id}`, { status: "sent" }, "PATCH");
    const token2 = (await pool.query("SELECT public_token FROM crm_estimates WHERE id=$1", [any.id])).rows[0].public_token;
    const both = await call(`/api/public/estimates/${token2}/select-options`, { optionIds: [any.rows[1].id, any.rows[2].id] }, "POST", cookie);
    expect(both.status).toBeLessThan(300);
  });

  it("copy an option / the whole estimate to a new draft — same client or another (tax re-resolved for them)", async () => {
    const { id, rows } = await tabbedEstimate();
    await call(`/api/crm/estimates/${id}/discounts`, { offers: [{ code: "military", label: "Military", percentBps: 200, enabled: true }] }, "PUT");
    const same = await call(`/api/crm/estimates/${id}/options/${rows[1].id}/copy-to-estimate`, {});
    expect(same.status).toBe(201);
    expect(same.data).toMatchObject({ customerId, status: "draft", title: "Premium", taxRateBps: 1000 });
    const sameItems = (await call(`/api/crm/estimates/${same.data.id}`)).data.items;
    expect(sameItems.map((i: any) => i.name)).toEqual(["Siding premium", "Trim"]);
    const other = await call(`/api/crm/estimates/${id}/duplicate`, { customerId: otherCustomerId });
    expect(other.status).toBe(201);
    expect(other.data.customerId).toBe(otherCustomerId);
    expect(other.data.taxRateBps).toBe(0); // FL job: contractors don't charge sales tax (tax.ts)
    const copiedOpts = await optionsOf(other.data.id);
    expect(copiedOpts.map((o) => o.name)).toEqual(["Option 1", "Premium", "Budget"]);
    expect(copiedOpts.map((o) => o.id)).not.toContain(rows[1].id); // new ids
    const offers = (await call(`/api/crm/estimates/${other.data.id}/discounts`)).data.offers;
    expect(offers.map((o: any) => o.code)).toEqual(["military"]);
    expect((await call(`/api/crm/estimates/${id}/duplicate`, { customerId: randomUUID() })).status).toBe(400);
  });

  it("templates round-trip: save, list, use, delete", async () => {
    const t = await call("/api/crm/estimate-templates", {
      name: "Hardie re-side", title: "Siding Remodel", introText: "Thanks!",
      items: [L("Siding Remodel - James Hardie", 1650, { unit: "sf", quantityMilli: 2_200_000, description: "ColorPlus lap", scopeCategory: "siding" })],
      offers: [{ code: "bundle", label: "Bundle", percentBps: 500, enabled: true }], contractorDiscount: { mode: "percent", value: "5", label: "Fall" },
    });
    expect(t.status).toBe(201);
    const list = await call("/api/crm/estimate-templates");
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      name: "Hardie re-side", title: "Siding Remodel", introText: "Thanks!",
      contractorDiscount: { mode: "percent", value: "5", label: "Fall" },
      items: [{ name: "Siding Remodel - James Hardie", quantityMilli: 2_200_000, unitPriceCents: 1650, description: "ColorPlus lap", scopeCategory: "siding" }],
    });
    expect((await call(`/api/crm/estimate-templates/${t.data.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await call("/api/crm/estimate-templates")).data).toHaveLength(0);
  });
});
