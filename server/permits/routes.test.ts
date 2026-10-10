import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// /api/permits/watches against an in-process express app and the real dev database: the module gate
// (Agency includes permitAlerts, Pro does not, platform admins always pass), CRUD, hits and check-now.
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "./../db";
import { ensureGrowthSchema } from "../growth-schema";
import { ensurePermitAlertsSchema } from "./schema";
import { registerPermitAlertRoutes, alertPlatforms } from "./routes";
import { registerAdapter } from "../scrapers/registry";
import { PLANS, planForModule } from "@shared/plans";

vi.mock("../admin", async (original) => ({ ...(await original<typeof import("../admin")>()), isPlatformAdminEmail: (email?: string | null) => !!email && email.startsWith("pa-admin-") }));
delete process.env.GOOGLE_PLACES_API_KEY; // no geocoder: the routes must work without one

const users = {} as Record<"agency" | "pro" | "admin" | "nobody", number>;
let base = "", server: ReturnType<express.Express["listen"]>, dbId: number, otherDbId: number;
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(user: number | null, path: string, method = "GET", body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "x-forwarded-for": ip, ...(user ? { "x-fixture-user": String(user) } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text; try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, data };
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await ensureGrowthSchema();
  await ensurePermitAlertsSchema();
  for (const key of Object.keys({ agency: 0, pro: 0, admin: 0, nobody: 0 }) as (keyof typeof users)[])
    users[key] = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`${key === "admin" ? "pa-admin" : `pa-routes-${key}`}-${randomUUID()}@example.invalid`])).rows[0].id;
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active'),($3,$4,'active')", [users.agency, planForModule("permitAlerts"), users.pro, PLANS.pro.key]);
  dbId = (await pool.query("INSERT INTO permit_databases(name, jurisdiction, jurisdiction_type, county_id, platform, search_url) VALUES ('PA routes Faketown', 'Faketown, OR', 'city', 1, 'FakeRoutesPortal', 'https://permits.faketown.invalid/') RETURNING id")).rows[0].id;
  otherDbId = (await pool.query("INSERT INTO permit_databases(name, jurisdiction, jurisdiction_type, county_id, platform, search_url) VALUES ('PA routes Legacytown', 'Legacytown, OR', 'city', 1, 'SmartGov', 'https://permits.legacy.invalid/') RETURNING id")).rows[0].id;
  registerAdapter({ platform: "FakeRoutesPortal", capabilities: { search: ["address"], listRecent: true, detail: false }, async search() { return []; }, async listRecent() { return []; } });

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: any, _res, next) => { const id = Number(req.headers["x-fixture-user"]); if (id) req.user = { id }; next(); });
  const auth = (req: any, res: any) => req.user ? req.user : (res.status(401).json({ message: "Not authenticated" }), null);
  registerPermitAlertRoutes(app, auth);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  const ids = Object.values(users);
  await pool.query("DELETE FROM permit_watches WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM permits WHERE database_id=ANY($1::int[])", [[dbId, otherDbId]]);
  await pool.query("DELETE FROM permit_poll_state WHERE database_id=ANY($1::int[])", [[dbId, otherDbId]]);
  await pool.query("DELETE FROM permit_databases WHERE id=ANY($1::int[])", [[dbId, otherDbId]]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await pool.end();
});

describe("permit alert routes", () => {
  it("public reads: alert platforms and trades", async () => {
    expect(alertPlatforms()).toContain("FakeRoutesPortal");
    const r = await call(null, "/api/permits/alert-platforms");
    expect(r.status).toBe(200);
    expect(r.data.platforms).toContain("FakeRoutesPortal");
    expect(r.data.platforms).not.toContain("SmartGov");
    const t = await call(null, "/api/permits/trades");
    expect(t.data.trades.map((x: any) => x.key)).toContain("roofing");
  });

  it("the gate: signed out 401, Pro 402 plan_required, Agency and platform admins pass", async () => {
    expect((await call(null, "/api/permits/watches")).status).toBe(401);
    const pro = await call(users.pro, "/api/permits/watches");
    expect(pro.status).toBe(402);
    expect(pro.data.code).toBe("plan_required");
    expect((await call(users.agency, "/api/permits/watches")).status).toBe(200);
    expect((await call(users.admin, "/api/permits/watches")).status).toBe(200);
    expect((await call(users.nobody, "/api/permits/watches")).status).toBe(402);
  });

  it("jurisdiction picker reports alerts support per portal", async () => {
    const r = await call(users.agency, "/api/permits/watches/jurisdictions?q=PA%20routes");
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.data.jurisdictions.map((j: any) => [j.id, j]));
    expect(byId[dbId].alertsSupported).toBe(true);
    expect(byId[otherDbId].alertsSupported).toBe(false);
  });

  it("create, list, update, hits, check now, delete — scoped to the owner", async () => {
    const bad = await call(users.agency, "/api/permits/watches", "POST", { kind: "address", params: {}, databaseIds: [dbId] });
    expect(bad.status).toBe(400);
    expect(bad.data.message).toMatch(/address/i);
    const noChannel = await call(users.agency, "/api/permits/watches", "POST", { kind: "address", params: { address: "1 Oak St" }, channels: { email: false, sms: false, telegram: false }, databaseIds: [dbId] });
    expect(noChannel.status).toBe(400);
    const unknownDb = await call(users.agency, "/api/permits/watches", "POST", { kind: "address", params: { address: "1 Oak St" }, databaseIds: [999999999] });
    expect(unknownDb.status).toBe(400);

    const created = await call(users.agency, "/api/permits/watches", "POST", {
      kind: "trade_area", params: { trades: ["roofing", "solar"], address: "1 Oak St", radiusMiles: 5 }, channels: { email: true, sms: true, smsTo: "(541) 555-0100", telegram: false }, databaseIds: [dbId, otherDbId],
    });
    expect(created.status).toBe(201);
    const w = created.data.watch;
    expect(w.name).toBe("Roofing, Solar in 2 jurisdictions");
    // No geocoder in tests: the radius falls back to the whole jurisdictions, honestly.
    expect(w.params.radiusMiles).toBe(0);
    expect(w.channels.smsTo).toBe("+15415550100");
    expect(w.jurisdictions.map((j: any) => j.alertsSupported)).toEqual([true, false]);
    // Creating a watch asks for its jurisdictions to be polled on the next tick.
    const { rows } = await pool.query("SELECT database_id FROM permit_poll_state WHERE database_id = ANY($1::int[]) AND next_poll_at <= now()", [[dbId, otherDbId]]);
    expect(rows).toHaveLength(2);

    const list = await call(users.agency, "/api/permits/watches");
    expect(list.data.watches.map((x: any) => x.id)).toContain(w.id);
    expect((await call(users.admin, "/api/permits/watches")).data.watches.map((x: any) => x.id)).not.toContain(w.id);

    const renamed = await call(users.agency, `/api/permits/watches/${w.id}`, "PATCH", { name: "My roofs", active: false });
    expect(renamed.status).toBe(200);
    expect(renamed.data.watch).toMatchObject({ name: "My roofs", active: false });
    expect((await call(users.admin, `/api/permits/watches/${w.id}`, "PATCH", { name: "stolen" })).status).toBe(404);

    // A hit shows up with its permit.
    const permitId = (await pool.query("INSERT INTO permits(database_id, permit_number, jurisdiction, permit_type, address, content_hash) VALUES ($1,'R-9','Faketown, OR','Re-roof','1 Oak St','h') RETURNING id", [dbId])).rows[0].id;
    await pool.query("INSERT INTO permit_watch_hits(watch_id, permit_id, reason, notified_at, channel_results) VALUES ($1,$2,'Roofing',now(),'{\"email\":{\"ok\":true}}')", [w.id, permitId]);
    const hits = await call(users.agency, `/api/permits/watches/${w.id}/hits`);
    expect(hits.status).toBe(200);
    expect(hits.data.hits).toHaveLength(1);
    expect(hits.data.hits[0].permit.permitNumber).toBe("R-9");
    expect(hits.data.hits[0].channelResults.email.ok).toBe(true);
    expect((await call(users.agency, "/api/permits/watches")).data.watches.find((x: any) => x.id === w.id).hitCount).toBe(1);

    await pool.query("UPDATE permit_poll_state SET next_poll_at = now() + interval '1 hour' WHERE database_id=$1", [dbId]);
    expect((await call(users.agency, `/api/permits/watches/${w.id}/check`, "POST")).status).toBe(200);
    const { rows: [st] } = await pool.query("SELECT next_poll_at <= now() AS due FROM permit_poll_state WHERE database_id=$1", [dbId]);
    expect(st.due).toBe(true);

    expect((await call(users.admin, `/api/permits/watches/${w.id}`, "DELETE")).status).toBe(404);
    expect((await call(users.agency, `/api/permits/watches/${w.id}`, "DELETE")).status).toBe(200);
    expect((await call(users.agency, `/api/permits/watches/${w.id}/hits`)).status).toBe(404);
  });
});
