import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { pool } from "../db";
import { ensureCloudflareSearchSchema } from "./schema";
import { CloudflareClient, ZONE_PERMISSIONS, tokenPolicies } from "./client";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { listAssets, ownedAsset, withinProperty, queue } from "./common";
import {
  exchangeKey,
  rulePack,
  applyAction,
  discoverZones,
  cloudflareAnalytics,
} from "./service";
import { registerCloudflareRoutes } from "./routes";
import { registerGscRoutes } from "../gsc/routes";
import {
  gscToken,
  saveGscGrant,
  discoverProperties,
  analyticsPage,
  inspectUrl,
  locationSearchClicks,
} from "../gsc/service";
import { GSC_SCOPE } from "../gsc/client";
import { runEdgeJob, memberships } from "./worker";
vi.mock("../email", () => ({
  sendWithFallback: vi.fn(async () => ({ success: true })),
}));
let user: number,
  other: number,
  cf: any,
  gsc: any,
  asset: any,
  property: any,
  loc: number,
  authUser: number | null,
  app: any;
const rawKey = "fixture-global-key-never-save",
  scoped = "fixture-scoped-token-only",
  zone = "a".repeat(32),
  tokenId = "b".repeat(32);
const calls: any[] = [];
let sets: Record<string, any> = {};
const json = (d: any, status = 200) =>
  new Response(JSON.stringify(d), { status });
const http = vi.fn(async (url: any, init: any = {}) => {
  const u = new URL(url),
    path = u.pathname.replace("/client/v4", "");
  const body = init.body
    ? JSON.parse(typeof init.body === "string" ? init.body : "{}")
    : null;
  calls.push({
    url: String(url),
    path,
    method: init.method ?? "GET",
    body,
    headers: init.headers,
  });
  if (u.hostname === "api.cloudflare.com") {
    if (path === "/user")
      return json({
        success: true,
        result: { id: "identity", email: "client@example.invalid" },
      });
    if (path === "/user/tokens/permission_groups")
      return json({
        result: ZONE_PERMISSIONS.map((name, i) => ({
          id: String(i),
          name,
          scopes: ["com.cloudflare.api.account.zone"],
        })),
      });
    if (path === "/user/tokens" && init.method === "POST")
      return json({ success: true, result: { id: tokenId, value: scoped } });
    if (path === "/user/tokens/verify")
      return json({ success: true, result: { status: "active", id: tokenId } });
    if (path === `/user/tokens/${tokenId}`)
      return json({ success: true, result: { id: tokenId } });
    if (path === "/zones")
      return json({
        result: [
          {
            id: zone,
            name: "fixture.example.invalid",
            account: { id: "c".repeat(32) },
            status: "active",
          },
        ],
        result_info: { total_pages: 1, total_count: 1 },
      });
    if (path === "/memberships")
      return json({
        result: [
          {
            id: "membership",
            account: { id: "c".repeat(32) },
            roles: ["Domain Administrator"],
          },
        ],
        result_info: { total_pages: 1 },
      });
    if (path === "/memberships/membership")
      return json({ result: { status: "accepted" } });
    if (path === "/graphql")
      return json({
        data: {
          viewer: {
            zones: [
              {
                traffic: [
                  {
                    dimensions: { date: "2026-09-01" },
                    sum: {
                      requests: 10,
                      threats: 2,
                      pageViews: 8,
                      countryMap: [],
                    },
                    uniq: { uniques: 5 },
                  },
                ],
                events: [
                  {
                    action: "block",
                    ruleId: "r",
                    clientIP: "192.0.2.2",
                    source: "firewallCustom",
                  },
                ],
                paths: [],
                bots: [],
              },
            ],
          },
        },
      });
    const phase = path.match(/phases\/([^/]+)\/entrypoint/);
    if (phase)
      return sets[phase[1]]
        ? json({ result: sets[phase[1]] })
        : json({ success: false }, 404);
    if (path.endsWith("/rulesets") && init.method === "POST") {
      const set = {
        id: `set${Object.keys(sets).length}`,
        rules: body.rules.map((r: any) => ({ ...r, id: "rule0" })),
      };
      sets[body.phase] = set;
      return json({ result: set });
    }
    const match = path.match(/rulesets\/(set\d+)\/rules(?:\/(rule\d+))?$/);
    if (match) {
      const s = Object.values(sets).find((s: any) => s.id === match[1]);
      if (init.method === "DELETE") {
        s.rules = s.rules.filter((r: any) => r.id !== match[2]);
        return json({ success: true });
      }
      s.rules.push({ ...body, id: `rule${s.rules.length}` });
      return json({ result: s });
    }
  }
  if (path.endsWith("/sites"))
    return json({
      siteEntry: [
        {
          siteUrl: "sc-domain:fixture.example.invalid",
          permissionLevel: "siteFullUser",
        },
      ],
    });
  if (path.endsWith("/searchAnalytics/query"))
    return json({
      rows: [
        {
          keys:
            body.dimensions.length === 1
              ? ["2026-09-01"]
              : ["2026-09-01", "fixture query"],
          clicks: 3,
          impressions: 30,
          ctr: 0.1,
          position: 2,
        },
      ],
    });
  if (path.endsWith("/urlInspection/index:inspect"))
    return json({
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
        },
      },
    });
  if (path.endsWith("/sitemaps")) return json({ sitemap: [] });
  throw new Error("Unexpected mock API path");
}) as unknown as typeof fetch;
async function invoke(
  method: string,
  path: string,
  { body = {}, query = {}, params = {}, recent = true, session = {} }: any = {},
) {
  const layer = app.router.stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layer) throw Error(`Missing route ${path}`);
  const req: any = {
    body,
    query,
    params,
    headers: {},
    ip: "127.0.0.1",
    user: authUser ? { id: authUser } : undefined,
    session: {
      ...(recent ? { recentAuth: { userId: authUser, at: Date.now() } } : {}),
      ...session,
    },
    secure: true,
  };
  const res: any = {
    code: 200,
    status(n: number) {
      this.code = n;
      return this;
    },
    json(d: any) {
      this.body = d;
      return this;
    },
    redirect(s: string) {
      this.code = 302;
      this.redirectTo = s;
      return this;
    },
  };
  await layer.route.stack[0].handle(req, res);
  return { ...res, req };
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a5")
    throw Error("a5 DB required");
  await ensureCloudflareSearchSchema();
  await ensureCloudflareSearchSchema();
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES('edge-fixture-'||gen_random_uuid()||'@example.invalid'),('edge-other-'||gen_random_uuid()||'@example.invalid') RETURNING id",
  );
  [user, other] = rows.map((r) => r.id);
  authUser = user;
  loc = (
    await pool.query(
      "INSERT INTO business_locations(user_id,business_name,website) VALUES($1,'Edge fixture','https://fixture.example.invalid/') RETURNING id",
      [user],
    )
  ).rows[0].id;
  cf = (
    await pool.query(
      "INSERT INTO edge_connections(user_id,provider,subject,token,method) VALUES($1,'cloudflare','fixture',$2,'paste') RETURNING *",
      [user, encryptToken(scoped)],
    )
  ).rows[0];
  asset = (
    await pool.query(
      "INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status) VALUES($1,$2,'cloudflare',$3,'fixture.example.invalid','fixture.example.invalid','active') RETURNING *",
      [user, cf.id, zone],
    )
  ).rows[0];
  const id = await saveGscGrant(
    user,
    { sub: "fixture", email: "agency@example.invalid", email_verified: true },
    {
      scope: GSC_SCOPE,
      access_token: "fixture-google",
      refresh_token: "fixture-google-refresh",
      expires_in: 3600,
    },
  );
  gsc = (await pool.query("SELECT * FROM edge_connections WHERE id=$1", [id]))
    .rows[0];
  await discoverProperties(gsc, http);
  property = (
    await pool.query("SELECT * FROM edge_assets WHERE connection_id=$1", [id])
  ).rows[0];
  await pool.query("DELETE FROM edge_jobs WHERE user_id=$1", [user]);
  app = express();
  const auth = (_req: any, res: any) =>
    authUser
      ? { id: authUser }
      : (res.status(401).json({ message: "Not authenticated" }), null);
  registerCloudflareRoutes(app, auth, http);
  registerGscRoutes(app, auth, http);
});
beforeEach(() => {
  authUser = user;
  calls.length = 0;
  sets = {};
});
afterAll(async () => {
  await pool.query(
    "DELETE FROM business_locations WHERE user_id=ANY($1::int[])",
    [[user, other]],
  );
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [
    [user, other],
  ]);
  await pool.end();
});
it("encrypts only the scoped credential and never persists, returns or logs the Global Key", async () => {
  const log = vi.spyOn(console, "log"),
    error = vi.spyOn(console, "error");
  const response = await invoke("POST", "/api/cloudflare/exchange", {
    body: { email: "client@example.invalid", key: rawKey, zones: [zone] },
  });
  expect(response.code).toBe(200);
  expect(response.req.body.key).toBeUndefined();
  expect(JSON.stringify(response.body)).not.toContain(rawKey);
  expect(JSON.stringify(response.body)).not.toContain(scoped);
  const c = (
    await pool.query("SELECT * FROM edge_connections WHERE id=$1", [
      response.body.id,
    ])
  ).rows[0];
  expect(c.token.startsWith("v1:")).toBe(true);
  expect(decryptToken(c.token)).toBe(scoped);
  for (const table of [
    "edge_connections",
    "edge_jobs",
    "account_activity",
    "user_notifications",
  ])
    expect(
      JSON.stringify(
        (
          await pool.query(
            `SELECT to_jsonb(t) d FROM ${table} t WHERE user_id=$1`,
            [user],
          )
        ).rows,
      ),
    ).not.toContain(rawKey);
  expect(
    JSON.stringify(log.mock.calls) + JSON.stringify(error.mock.calls),
  ).not.toContain(rawKey);
  expect(calls.find((c) => c.path === "/user").headers["X-Auth-Key"]).toBe(
    rawKey,
  );
  const policy = calls.find((c) => c.path === "/user/tokens").body.policies;
  expect(Object.keys(policy[0].resources)).toEqual([
    `com.cloudflare.api.account.zone.${zone}`,
  ]);
  log.mockRestore();
  error.mockRestore();
  await pool.query("DELETE FROM edge_connections WHERE id=$1", [c.id]);
});
it("redacts malicious API errors and transport errors; rejects missing permission groups", async () => {
  const malicious = async () =>
    json({ success: false, errors: [{ message: rawKey }] }, 403);
  await expect(
    new CloudflareClient(
      { email: "x", key: rawKey },
      malicious as typeof fetch,
      async () => {},
    ).call("/user"),
  ).rejects.not.toThrow(rawKey);
  await expect(
    new CloudflareClient(
      { email: "x", key: rawKey },
      (async () => {
        throw Error(rawKey);
      }) as typeof fetch,
      async () => {},
    ).call("/user"),
  ).rejects.not.toThrow(rawKey);
  expect(() => tokenPolicies([], [zone])).toThrow("permission unavailable");
});
it("fails closed on anonymous, missing reauth, invalid IDs and cross-owner access without provider calls", async () => {
  authUser = null;
  expect((await invoke("GET", "/api/cloudflare/assets")).code).toBe(401);
  authUser = user;
  expect(
    (
      await invoke("POST", "/api/cloudflare/token", {
        recent: false,
        body: { token: scoped },
      })
    ).code,
  ).toBe(403);
  expect(
    (
      await invoke("GET", "/api/gsc/assets/:id/analytics", {
        params: { id: "invalid" },
      })
    ).code,
  ).toBe(400);
  authUser = other;
  expect(
    (
      await invoke("GET", "/api/cloudflare/assets/:id", {
        params: { id: asset.id },
      })
    ).code,
  ).toBe(404);
  expect(
    (
      await invoke("POST", "/api/gsc/urls", {
        body: {
          kind: "inspect",
          items: [
            { assetId: property.id, url: "https://fixture.example.invalid/" },
          ],
        },
      })
    ).code,
  ).toBe(404);
  expect(calls).toHaveLength(0);
});
it("paginates and searches 1,000 seeded locations and sites server-side; bulk enqueues without Google calls", async () => {
  await pool.query(
    "INSERT INTO business_locations(user_id,business_name,website) SELECT $1,'Agency fixture '||lpad(i::text,4,'0'),'https://site'||i||'.example.invalid' FROM generate_series(1,1000) i",
    [user],
  );
  await pool.query(
    "INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status) SELECT $1,$2,'gsc','sc-domain:site'||i||'.example.invalid','Agency fixture '||lpad(i::text,4,'0'),'site'||i||'.example.invalid','siteFullUser' FROM generate_series(1,1000) i",
    [user, gsc.id],
  );
  const first = await listAssets(user, "gsc", { q: "Agency fixture", page: 1 }),
    last = await listAssets(user, "gsc", { q: "Agency fixture", page: 40 });
  expect(first.total).toBe(1000);
  expect(first.items).toHaveLength(25);
  expect(last.items).toHaveLength(25);
  expect(last.items[24].name).toBe("Agency fixture 1000");
  expect((await listAssets(other, "gsc", {})).total).toBe(0);
  const locations = await invoke("GET", "/api/gsc/locations", {
    query: { q: "Agency fixture", page: 40 },
  });
  expect(locations.body.total).toBe(1000);
  expect(locations.body.items).toHaveLength(25);
  const r = await invoke("POST", "/api/gsc/sync", {
    body: { allMatching: true, q: "Agency fixture" },
  });
  expect(r.code).toBe(202);
  expect(r.body.queued).toBe(1000);
  expect(calls).toHaveLength(0);
  await pool.query("DELETE FROM edge_jobs WHERE user_id=$1", [user]);
});
it("isolates the GSC grant from GBP and maps only the owner’s exact website domain", async () => {
  await pool.query(
    "INSERT INTO gbp_grants(user_id,google_subject,email,scopes,access_token) VALUES($1,'fixture','agency@example.invalid',ARRAY['gbp'],$2)",
    [user, encryptToken("untouched-gbp")],
  );
  await saveGscGrant(
    user,
    { sub: "fixture", email: "agency@example.invalid", email_verified: true },
    { scope: GSC_SCOPE, access_token: "fixture-google", expires_in: 3600 },
  );
  expect(
    decryptToken(
      (
        await pool.query(
          "SELECT access_token FROM gbp_grants WHERE user_id=$1",
          [user],
        )
      ).rows[0].access_token,
    ),
  ).toBe("untouched-gbp");
  expect(
    (
      await pool.query("SELECT * FROM edge_location_links WHERE asset_id=$1", [
        property.id,
      ])
    ).rows.map((r) => r.location_id),
  ).toEqual([loc]);
  await pool.query("DELETE FROM edge_jobs WHERE user_id=$1", [user]);
});
it("rejects forged OAuth state without exchange and validates granted scope", async () => {
  const r = await invoke("GET", "/api/gsc/callback", {
    query: { code: "fake", state: "fake" },
    session: {
      gscOAuth: { state: "real", userId: user, expires: Date.now() + 5000 },
    },
  });
  expect(r.redirectTo).toContain("failed");
  expect(calls).toHaveLength(0);
  await expect(
    saveGscGrant(
      user,
      { sub: "x", email: "x@example.invalid", email_verified: true },
      { scope: "calendar", access_token: "x" },
    ),
  ).rejects.toThrow("incomplete");
});
it("validates property URLs, reads real mocked metrics and weights CTR; inspection stays queued", async () => {
  expect(
    withinProperty("sc-domain:example.com", "https://evil-example.com/"),
  ).toBe(false);
  expect(
    withinProperty("https://example.com/blog/", "https://example.com/other"),
  ).toBe(false);
  expect(
    withinProperty("sc-domain:example.com", "https://a.example.com/x"),
  ).toBe(true);
  await analyticsPage(
    gsc,
    property,
    { dimension: "date", start: "2026-09-01", end: "2026-09-02", offset: 0 },
    http,
  );
  const r = await invoke("GET", "/api/gsc/assets/:id/analytics", {
    params: { id: property.id },
    query: { start: "2026-09-01", end: "2026-09-02" },
  });
  expect(r.body.items[0]).toMatchObject({
    clicks: 3,
    impressions: 30,
    ctr: 0.1,
    position: 2,
  });
  const bad = await invoke("POST", "/api/gsc/urls", {
    body: {
      kind: "inspect",
      items: [{ assetId: property.id, url: "https://foreign.invalid/" }],
    },
  });
  expect(bad.code).toBe(400);
  calls.length = 0;
  const good = await invoke("POST", "/api/gsc/urls", {
    body: {
      kind: "inspect",
      items: [
        { assetId: property.id, url: "https://fixture.example.invalid/" },
      ],
    },
  });
  expect(good.code).toBe(202);
  expect(calls).toHaveLength(0);
  await runEdgeJob(http, user);
  expect(
    (
      await pool.query("SELECT * FROM gsc_inspections WHERE asset_id=$1", [
        property.id,
      ])
    ).rows,
  ).toHaveLength(1);
});
it("enforces inspection quota before calling Google", async () => {
  await pool.query(
    "INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,1900) ON CONFLICT(key,period) DO UPDATE SET used=1900",
    [
      `gsc:inspection:${property.external_id}`,
      String(Math.floor(Date.now() / 86400000)),
    ],
  );
  await expect(
    inspectUrl(gsc, property, "https://fixture.example.invalid/other", http),
  ).rejects.toMatchObject({ status: 429 });
  expect(calls).toHaveLength(0);
  await pool.query("DELETE FROM growth_budgets WHERE key=$1", [
    `gsc:inspection:${property.external_id}`,
  ]);
});
it("requires a one-use confirmed preview, applies incremental rules, and reverses only its rules", async () => {
  const p = await invoke("POST", "/api/cloudflare/preview", {
    body: { ids: [asset.id], kind: "ips", ips: ["192.0.2.2"] },
  });
  expect(p.code).toBe(200);
  expect(calls).toHaveLength(0);
  const action = p.body.items[0];
  authUser = other;
  expect(
    (
      await invoke("POST", "/api/cloudflare/confirm", {
        body: { ids: [action.id] },
      })
    ).code,
  ).toBe(404);
  authUser = user;
  expect(
    (
      await invoke("POST", "/api/cloudflare/confirm", {
        body: { ids: [action.id] },
      })
    ).code,
  ).toBe(202);
  expect(
    (
      await invoke("POST", "/api/cloudflare/confirm", {
        body: { ids: [action.id] },
      })
    ).code,
  ).toBe(409);
  await runEdgeJob(http, user);
  let saved = (
    await pool.query("SELECT * FROM edge_actions WHERE id=$1", [action.id])
  ).rows[0];
  expect(saved.state).toBe("applied");
  expect(saved.remote).toHaveLength(1);
  sets.http_request_firewall_custom.rules.push({
    id: "unrelated",
    ref: "manual",
  });
  expect(
    (
      await invoke("POST", "/api/cloudflare/undo", {
        body: { ids: [action.id] },
      })
    ).code,
  ).toBe(202);
  await runEdgeJob(http, user);
  saved = (
    await pool.query("SELECT * FROM edge_actions WHERE id=$1", [action.id])
  ).rows[0];
  expect(saved.state).toBe("reverted");
  expect(sets.http_request_firewall_custom.rules).toEqual([
    { id: "unrelated", ref: "manual" },
  ]);
  expect(() => rulePack("ips", "/ads", ["bad-ip"])).toThrow();
  expect(() => rulePack("ads-door", '/ads" or true')).toThrow();
});
it("never retries an uncertain external write automatically", async () => {
  await queue(user, gsc.id, property.id, "sitemap", {
    url: "https://fixture.example.invalid/sitemap.xml",
  });
  const failed = (async () => {
    throw Error(rawKey);
  }) as typeof fetch;
  await runEdgeJob(failed, user);
  const j = (
    await pool.query(
      "SELECT * FROM edge_jobs WHERE user_id=$1 AND kind='sitemap' ORDER BY id DESC LIMIT 1",
      [user],
    )
  ).rows[0];
  expect(j.state).toBe("uncertain");
  expect(j.error).not.toContain(rawKey);
});
it("accepts only an explicitly onboarded agency account with mocked membership API and sink email", async () => {
  vi.stubEnv("CLOUDFLARE_AGENCY_USER_ID", String(user));
  vi.stubEnv("CLOUDFLARE_AGENCY_TOKEN", "fixture-agency");
  vi.stubEnv("CLOUDFLARE_AGENCY_EMAIL", "agency@example.invalid");
  const {
    rows: [inv],
  } = await pool.query(
    "INSERT INTO edge_invites(user_id,provider,email,domain,account_id,connection_id) VALUES($1,'cloudflare','client@example.invalid','fixture.example.invalid',$2,$3) RETURNING id",
    [user, "c".repeat(32), cf.id],
  );
  await memberships(cf, http);
  expect(
    calls.some(
      (c) => c.method === "PUT" && c.path === "/memberships/membership",
    ),
  ).toBe(true);
  expect(
    (await pool.query("SELECT state FROM edge_invites WHERE id=$1", [inv.id]))
      .rows[0].state,
  ).toBe("accepted");
  vi.unstubAllEnvs();
  await pool.query("DELETE FROM edge_jobs WHERE user_id=$1", [user]);
});
it("disconnect wipes local cached data while reporting required manual token revocation", async () => {
  const c = (
    await pool.query(
      "INSERT INTO edge_connections(user_id,provider,subject,token,token_id,created_token,method) VALUES($1,'cloudflare','disconnect',$2,$3,true,'exchange') RETURNING *",
      [user, encryptToken(scoped), tokenId],
    )
  ).rows[0];
  const r = await invoke("POST", "/api/cloudflare/disconnect", {
    body: { ids: [c.id] },
  });
  expect(r.code).toBe(200);
  expect(r.body.results[0].revoked).toBe(true);
  expect(
    (await pool.query("SELECT id FROM edge_connections WHERE id=$1", [c.id]))
      .rows,
  ).toHaveLength(0);
});

it("keeps office exemptions outside every generated rule and accepts documented Write permission names", () => {
  const rules = rulePack("ads-door", "/ads", [], ["192.0.2.9"]);
  expect(rules).toHaveLength(3);
  for (const rule of rules)
    expect(rule.rule.expression).toContain("and not ip.src in {192.0.2.9}");
  expect(rules[0].rule.expression).toContain('http.request.uri.args["gclid"]');
  expect(() => rulePack("ips", "/ads", ["192.0.2.8"], ["invalid"])).toThrow();
  const groups = ZONE_PERMISSIONS.map((name, i) => ({
    name: name.replace(/ Edit$/, " Write"),
    id: String(i),
    scopes: ["com.cloudflare.api.account.zone"],
  }));
  expect(tokenPolicies(groups, [zone])[0].permission_groups).toHaveLength(3);
});
it("exposes cached Site Scan indexing only to the scan owner", async () => {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO sitescan_jobs(id,user_id,url,page_cap,state,status) VALUES($1,$2,$3,1,$4,'completed')",
    [
      id,
      user,
      "https://fixture.example.invalid/",
      JSON.stringify({ pages: [{ url: "https://fixture.example.invalid/" }] }),
    ],
  );
  const r = await invoke("GET", "/api/gsc/scans/:id/indexing", {
    params: { id },
  });
  expect(r.code).toBe(200);
  expect(r.body.items[0].result.indexStatusResult.verdict).toBe("PASS");
  authUser = other;
  expect(
    (await invoke("GET", "/api/gsc/scans/:id/indexing", { params: { id } }))
      .code,
  ).toBe(404);
  expect(calls).toHaveLength(0);
});

it("keeps rotating GSC refresh credentials encrypted and consistent across successive refreshes", async () => {
  const id = await saveGscGrant(
    user,
    {
      sub: "refresh-fixture",
      email: "refresh@example.invalid",
      email_verified: true,
    },
    {
      scope: GSC_SCOPE,
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_in: 1,
    },
  );
  const c = (
    await pool.query("SELECT * FROM edge_connections WHERE id=$1", [id])
  ).rows[0];
  let calls = 0;
  const tokenHttp = (async (_url: any, init: any) => {
    calls++;
    expect(init.body.get("refresh_token")).toBe(
      calls === 1 ? "old-refresh" : "new-refresh-1",
    );
    return json({
      access_token: `new-access-${calls}`,
      refresh_token: `new-refresh-${calls}`,
      expires_in: 3600,
      scope: GSC_SCOPE,
    });
  }) as typeof fetch;
  expect(await gscToken(c, tokenHttp)).toBe("new-access-1");
  c.expires_at = new Date(0);
  expect(await gscToken(c, tokenHttp)).toBe("new-access-2");
  const saved = (
    await pool.query(
      "SELECT token,refresh_token FROM edge_connections WHERE id=$1",
      [id],
    )
  ).rows[0];
  expect(saved.token).toBe(c.token);
  expect(decryptToken(saved.refresh_token)).toBe("new-refresh-2");
  await pool.query("DELETE FROM edge_connections WHERE id=$1", [id]);
});

it("reads Cloudflare traffic with the documented GraphQL zone scalar and keeps missing bot data unavailable", async () => {
  const result = await cloudflareAnalytics(cf, asset, http);
  expect(result.traffic[0].sum.requests).toBe(10);
  expect(result.traffic[0].uniq.uniques).toBe(5);
  expect(result.botShare).toBeNull();
  expect(result.events[0]).toMatchObject({
    action: "block",
    source: "firewallCustom",
  });
  expect(calls.filter((c) => c.path === "/graphql")).toHaveLength(2);
  for (const call of calls) expect(call.body.query).toContain("$zone:string!");
});
