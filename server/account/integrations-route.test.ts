/** GET /api/account/integrations reads each module's own tables; status is only what those rows say. */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureGrowthSchema } from "../growth-schema";
import { ensureGbpSchema } from "../gbp/schema";
import { ensureAdsSchema } from "../ads/schema";
import { ensureCloudflareSearchSchema } from "../cloudflare/schema";
import { ensureSocialSchema } from "../social/schema";
import { ensureDomainsSchema } from "../domains/schema";
import { ensureMailAlertsSchema } from "../mail-alerts/schema";
import { registerIntegrationsRoute, integrationItems, listNames, INTEGRATION_BUILDERS } from "./integrations-route";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: [], rejected: [], response: "mock" })) }));

const users = {} as Record<"agency" | "pro" | "none", number>;
let base = "", server: ReturnType<express.Express["listen"]>;
const tag = randomUUID().slice(0, 8);
const IDS = ["google_business", "google_ads", "cloudflare", "search_console", "blotato", "registrars", "gmail_alerts"];

async function get(user: number | null) {
  const r = await fetch(`${base}/api/account/integrations`, { headers: user ? { "x-fixture-user": String(user) } : {} });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const byId = (items: any[]) => Object.fromEntries(items.map((i) => [i.id, i]));

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await ensureGrowthSchema(); await ensureGbpSchema(); await ensureAdsSchema(); await ensureCloudflareSearchSchema();
  await ensureSocialSchema(); await ensureDomainsSchema(); await ensureMailAlertsSchema();
  for (const key of ["agency", "pro", "none"] as const)
    users[key] = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`ACCT-l5-int-${key}-${randomUUID()}@example.invalid`])).rows[0].id;
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'agency','active'),($2,'pro','active')", [users.agency, users.pro]);
  const a = users.agency;
  // Google Business Profile: two accounts, one flagged by the GBP module.
  await pool.query("INSERT INTO gbp_grants(user_id,google_subject,email,scopes,reconnect_required) VALUES($1,'sub-ok','owner@example.invalid','{}',false),($1,'sub-stale','stale@example.invalid','{}',true)", [a]);
  // Google Ads manager with two client accounts and the manager itself.
  await pool.query("INSERT INTO ads_grants(user_id,manager_id,refresh_token,verified) VALUES($1,'123-456-7890','enc',true)", [a]);
  await pool.query("INSERT INTO ads_accounts(user_id,customer_id,name,manager) VALUES($1,'111','ACCT-l5 client one',false),($1,'222','ACCT-l5 client two',false),($1,'999','ACCT-l5 mcc',true)", [a]);
  // Cloudflare: one token connection with two zones; Search Console: a Google token that expired with no refresh token.
  const { rows: [cf] } = await pool.query("INSERT INTO edge_connections(user_id,provider,subject,email,token_name,method) VALUES($1,'cloudflare','cf-sub','cf@example.invalid','ACCT-l5 token','token') RETURNING id", [a]);
  await pool.query("INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status) VALUES($1,$2,'cloudflare','z1','ACCT-l5 zone one','one.example.test','active'),($1,$2,'cloudflare','z2','ACCT-l5 zone two','two.example.test','active')", [a, cf.id]);
  await pool.query("INSERT INTO edge_connections(user_id,provider,subject,email,method,expires_at,refresh_token) VALUES($1,'gsc','gsc-sub','gsc@example.invalid','oauth',now()-interval '1 day',NULL)", [a]);
  // Blotato: an agency-wide key with three social accounts.
  await pool.query("INSERT INTO social_connections(user_id,key_enc,accounts) VALUES($1,'enc',$2::jsonb)", [a, JSON.stringify([{ id: "1", platform: "facebook", name: "ACCT-l5 FB" }, { id: "2", platform: "instagram", name: "ACCT-l5 IG" }, { id: "3", platform: "linkedin", name: "ACCT-l5 LI" }])]);
  // Registrars: one API key, two monitored domains.
  const { rows: [reg] } = await pool.query("INSERT INTO domain_connections(user_id,provider,label,credentials) VALUES($1,'porkbun','ACCT-l5 porkbun key','enc') RETURNING id", [a]);
  await pool.query("INSERT INTO managed_domains(user_id,connection_id,domain,registrar) VALUES($1,$2,$3,'porkbun'),($1,NULL,$4,'manual')", [a, reg.id, `acct-l5-${tag}-a.example.test`, `acct-l5-${tag}-b.example.test`]);
  // Gmail alerts: a healthy grant plus the inbound forwarding address.
  await pool.query("INSERT INTO mail_alert_grants(user_id,google_subject,email,needs_reconnect) VALUES($1,'mail-sub','alerts@example.invalid',false)", [a]);
  await pool.query("INSERT INTO mail_alert_addresses(user_id,token_hash,token_cipher) VALUES($1,$2,'enc')", [a, `acct-l5-${tag}`]);

  const app = express();
  app.use((req: any, _res, next) => { const id = Number(req.headers["x-fixture-user"]); if (id) req.user = { id }; next(); });
  registerIntegrationsRoute(app, (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  const ids = Object.values(users);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await pool.end();
});

describe("GET /api/account/integrations", () => {
  it("needs a session and lists every service in display order with the contract's fields", async () => {
    expect((await get(null)).status).toBe(401);
    const r = await get(users.agency);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.data.items.map((i: any) => i.id)).toEqual(IDS);
    expect(INTEGRATION_BUILDERS).toHaveLength(IDS.length);
    for (const item of r.data.items) {
      expect(Object.keys(item).sort()).toEqual(["detail", "id", "manageHref", "service", "status"]);
      expect(["connected", "not_connected", "reconnect"]).toContain(item.status);
      expect(item.manageHref).toMatch(/^\//);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });
  it("reports connected / reconnect from the modules' own flags", async () => {
    const items = byId((await get(users.agency)).data.items);
    expect(items.google_business).toMatchObject({ status: "reconnect", service: "Google Business Profile", manageHref: "/google-business", detail: "stale@example.invalid needs to be reconnected." });
    expect(items.google_ads).toMatchObject({ status: "connected", manageHref: "/google-ads", detail: "Manager account 123-456-7890 · 2 client accounts." });
    expect(items.cloudflare).toMatchObject({ status: "connected", manageHref: "/cloudflare", detail: "1 connection (cf@example.invalid) · 2 zones." });
    expect(items.search_console).toMatchObject({ status: "reconnect", manageHref: "/search-console", detail: "gsc@example.invalid needs to be reconnected." });
    expect(items.blotato).toMatchObject({ status: "connected", manageHref: "/social-media", detail: "3 social accounts linked · agency-wide key." });
    expect(items.registrars).toMatchObject({ status: "connected", manageHref: "/domains", detail: "porkbun: ACCT-l5 porkbun key · 2 domains monitored." });
    expect(items.gmail_alerts).toMatchObject({ status: "connected", manageHref: "/mail-alerts", detail: "Reading alerts@example.invalid · forwarding address set." });
  });
  it("moves with the stored flags: a reconnected Google account and a Gmail grant that needs reconnecting", async () => {
    await pool.query("UPDATE gbp_grants SET reconnect_required=false WHERE user_id=$1", [users.agency]);
    await pool.query("UPDATE mail_alert_grants SET needs_reconnect=true WHERE user_id=$1", [users.agency]);
    await pool.query("UPDATE edge_assets SET status='access_removed' WHERE user_id=$1 AND external_id='z2'", [users.agency]);
    const items = byId(await integrationItems(users.agency));
    expect(items.google_business).toMatchObject({ status: "connected", detail: "2 Google accounts: owner@example.invalid and stale@example.invalid." });
    expect(items.gmail_alerts).toMatchObject({ status: "reconnect", detail: "alerts@example.invalid needs to be reconnected." });
    expect(items.cloudflare.detail).toBe("1 connection (cf@example.invalid) · 2 zones (1 access removed).");
  });
  it("shows another account nothing of the first, and names the plan that includes an Agency-only service", async () => {
    const pro = byId((await get(users.pro)).data.items);
    for (const id of IDS) expect(pro[id].status, id).toBe("not_connected");
    expect(pro.google_business.detail).toBe("No Google account connected.");
    expect(pro.blotato.detail).toBe("No Blotato API key connected.");
    for (const id of ["google_ads", "cloudflare", "search_console", "registrars", "gmail_alerts"]) expect(pro[id].detail, id).toBe("Included with the Agency plan.");
    const none = byId((await get(users.none)).data.items);
    expect(none.cloudflare.detail).toBe("Included with the Agency plan.");
    await pool.query("INSERT INTO mail_alert_addresses(user_id,token_hash,token_cipher) VALUES($1,$2,'enc')", [users.pro, `acct-l5-${tag}-pro`]);
    expect(byId(await integrationItems(users.pro)).gmail_alerts).toMatchObject({ status: "connected", detail: "Forwarding address set; no Gmail account connected." });
  });
  it("names a few and counts the rest", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["a"])).toBe("a");
    expect(listNames(["a", "b"])).toBe("a and b");
    expect(listNames(["a", "b", "c"])).toBe("a, b and 1 more");
    expect(listNames(["a", "b", "c", "d"], 3)).toBe("a, b, c and 1 more");
  });
});
