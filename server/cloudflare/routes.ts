import { flaggedIpsForZone } from "./hooks";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireRecentAuth } from "../account-security";
import { logActivity, notifyUser } from "../account-events";
import { rateLimit } from "../growth-limits";
import { requireModule } from "../entitlements";
import { CloudflareClient } from "./client";
import { exchangeKey, saveConnection, cfFor, rulePack } from "./service";
import {
  ProviderError,
  idInput,
  idsInput,
  listInput,
  listAssets,
  ownedAsset,
  ownedConnection,
  budget,
  queue,
  domain,
} from "./common";
export type Auth = (req: any, res: any) => any;
export function routeFor(app: Express, auth: Auth) {
  return (
    method: "get" | "post" | "delete",
    path: string,
    fn: (req: Request, res: Response, user: number) => Promise<any>,
  ) => {
    app[method](path, async (req, res) => {
      const u = auth(req, res);
      if (!u) return;
      try {
        await fn(req, res, u.id);
      } catch (e) {
        res
          .status(
            e instanceof z.ZodError
              ? 400
              : e instanceof ProviderError
                ? e.status
                : 500,
          )
          .json({
            message:
              e instanceof z.ZodError
                ? "Invalid input"
                : e instanceof ProviderError
                  ? e.message
                  : "Site integration operation failed",
          });
      } finally {
        // In particular, the Global Key is never retained beyond the request.
        if (path.includes("/cloudflare/") && req.body) {
          delete req.body.key;
          delete req.body.token;
          req.rawBody = undefined;
        }
      }
    });
  };
}
const cfId = z.string().regex(/^[a-f0-9]{32}$/);
const credential = z.string().min(10).max(512);
const globalInput = z.object({
  email: z.string().email().max(254),
  key: credential,
});
export async function connectionNotice(
  req: Request,
  user: number,
  provider: string,
  connected: boolean,
  label: string,
) {
  const kind =
    provider === "gsc"
      ? connected
        ? "google.connected"
        : "google.disconnected"
      : connected
        ? "cloudflare.connected"
        : "cloudflare.disconnected";
  await logActivity(req, user, kind, { integration: provider, label });
  await notifyUser(user, kind, {
    title: `${provider === "gsc" ? "Search Console" : "Cloudflare"} ${connected ? "connected" : "disconnected"}`,
    body: label,
    link: "/settings?tab=security",
    actionUrl: "/settings?tab=security",
  });
}
export function registerAssetRoutes(
  app: Express,
  auth: Auth,
  provider: "cloudflare" | "gsc",
  http: typeof fetch = fetch,
) {
  const route = routeFor(app, auth),
    base = `/api/${provider}`;
  // Agency-only module (Cloudflare + Search Console): every /api/cloudflare and /api/gsc route answers
  // 402 plan_required unless the plan includes it, except removing saved connections (list + disconnect),
  // which an account without the plan must still be able to do.
  const gate = requireModule("cloudflareSearchConsole"),
    removal = (req: Request) =>
      (req.method === "GET" && req.path === "/saved-connections") ||
      (req.method === "POST" && req.path === "/disconnect");
  app.use(
    base,
    rateLimit(`site-integrations-${provider}`, 200, 400),
    (req: Request, res: Response, next: NextFunction) =>
      removal(req) ? next() : gate(req, res, next),
  );
  // Only what identifies each saved connection (for the plan_required card's Disconnect buttons).
  route("get", `${base}/saved-connections`, async (_req, res, user) => {
    const { rows } = await pool.query(
      "SELECT id,COALESCE(email,subject) label FROM edge_connections WHERE user_id=$1 AND provider=$2 ORDER BY id LIMIT 100",
      [user, provider],
    );
    res.json({ items: rows });
  });
  // Sites tab list: edge_assets of this user+provider (?q name, ?status, 25/page) with
  // linked-location counts. Both provider pages — site-connections.tsx.
  route("get", `${base}/assets`, async (req, res, user) =>
    res.json(await listAssets(user, provider, req.query)),
  );
  // Connections tab list: edge_connections (?q, 25/page) + worker/agency flags that drive
  // the "background processing is disabled" and agency-membership notices.
  // Both provider pages — site-connections.tsx.
  route("get", `${base}/connections`, async (req, res, user) => {
    const p = listInput.parse(req.query),
      v = [user, provider, `%${p.q}%`];
    const { rows } = await pool.query(
      `SELECT id,email,subject,token_name,permissions,method,created_at FROM edge_connections WHERE user_id=$1 AND provider=$2 AND COALESCE(email,subject) ILIKE $3 ORDER BY id LIMIT $4 OFFSET $5`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      "SELECT count(*)::int total FROM edge_connections WHERE user_id=$1 AND provider=$2 AND COALESCE(email,subject) ILIKE $3",
      v,
    );
    res.json({
      items: rows,
      total: n.total,
      page: p.page,
      agencyEmail:
        provider === "cloudflare"
          ? (process.env.CLOUDFLARE_AGENCY_EMAIL ?? null)
          : null,
      workerEnabled: process.env.EDGE_SEARCH_WORKER_ENABLED === "true",
    });
  });
  // One site's detail row (owned edge_assets), opened by clicking its name in the Sites
  // tab. Details panel — site-connections.tsx.
  route("get", `${base}/assets/:id`, async (req, res, user) => {
    const a = await ownedAsset(user, idInput.parse(req.params.id), provider);
    res.json(a);
  });
  // Re-imports sites/properties from the chosen connections (queued 'discover' /
  // 'memberships' jobs into edge_jobs). "Discover sites" — site-connections.tsx.
  route("post", `${base}/discover`, async (req, res, user) => {
    const p = z.object({ connectionIds: idsInput }).parse(req.body);
    await budget(user, "discover", p.connectionIds.length);
    const { rows } = await pool.query(
      "SELECT id,method FROM edge_connections WHERE user_id=$1 AND provider=$2 AND id=ANY($3::int[])",
      [user, provider, [...new Set(p.connectionIds)]],
    );
    if (rows.length !== new Set(p.connectionIds).size)
      throw new ProviderError("Connection not found", 404);
    for (const c of rows)
      await queue(
        user,
        c.id,
        null,
        c.method === "agency" ? "memberships" : "discover",
      );
    res.status(202).json({ queued: rows.length });
  });
  // Queues background analytics syncs for the selected sites or everything matching
  // ?q/?status (GSC: ?start/?end within the last 16 months), deduped against running
  // jobs in edge_jobs. "Sync selected / Sync all matching" — site-connections.tsx.
  route("post", `${base}/sync`, async (req, res, user) => {
    const p = z
      .object({
        ids: idsInput.optional(),
        allMatching: z.boolean().optional(),
        q: z.string().max(200).default(""),
        status: z.string().max(80).default(""),
        start: z.string().date().optional(),
        end: z.string().date().optional(),
      })
      .parse(req.body);
    if (!p.ids && !p.allMatching)
      throw new ProviderError("Select sites or all matching sites", 400);
    const floor = new Date();
    floor.setUTCMonth(floor.getUTCMonth() - 16);
    if (
      p.start &&
      (p.start < floor.toISOString().slice(0, 10) ||
        p.start > (p.end ?? new Date().toISOString().slice(0, 10)))
    )
      throw new ProviderError("Choose a date range within 16 months", 400);
    if (p.end && p.end > new Date().toISOString().slice(0, 10))
      throw new ProviderError("End date must not be in the future", 400);
    await budget(user, "sync");
    const {
      rows: [pending],
    } = await pool.query(
      "SELECT count(*)::int n FROM edge_jobs WHERE user_id=$1 AND state IN ('queued','running')",
      [user],
    );
    if (pending.n > 10000)
      throw new ProviderError("Let queued work finish first", 429);
    const result = await pool.query(
      `INSERT INTO edge_jobs(user_id,connection_id,asset_id,kind,payload)
      SELECT user_id,connection_id,id,'sync',$5 FROM edge_assets a WHERE user_id=$1 AND provider=$2
      AND (($3::int[] IS NOT NULL AND id=ANY($3)) OR ($3::int[] IS NULL AND name ILIKE $4)) AND ($6='' OR status=$6)
      AND NOT EXISTS(SELECT 1 FROM edge_jobs j WHERE j.asset_id=a.id AND j.kind='sync' AND j.state IN ('queued','running')) ON CONFLICT DO NOTHING`,
      [
        user,
        provider,
        p.allMatching ? null : p.ids,
        `%${p.q.replace(/[\\%_]/g, "\\$&")}%`,
        JSON.stringify({ start: p.start, end: p.end }),
        p.status,
      ],
    );
    res.status(202).json({ queued: result.rowCount });
  });
  // Work queue tab: edge_jobs of this user+provider (?q kind/error, ?state, 25/page).
  // Both provider pages — site-connections.tsx.
  route("get", `${base}/jobs`, async (req, res, user) => {
    const p = listInput.parse(req.query);
    const where = `j.user_id=$1 AND c.provider=$2 AND ($3='' OR j.state=$3) AND (j.kind ILIKE $4 OR COALESCE(j.error,'') ILIKE $4)`;
    const values = [user, provider, p.status, `%${p.q}%`];
    const { rows } = await pool.query(
      `SELECT j.id,j.asset_id,j.kind,j.state,j.error,j.started_at,j.finished_at FROM edge_jobs j JOIN edge_connections c ON c.id=j.connection_id WHERE ${where} ORDER BY j.id DESC LIMIT $5 OFFSET $6`,
      [...values, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM edge_jobs j JOIN edge_connections c ON c.id=j.connection_id WHERE ${where}`,
      values,
    );
    res.json({ items: rows, total: n.total });
  });
  // Removes saved connections: deletes edge_invites + edge_connections (revoking a
  // ConstructHUB-created Cloudflare token when possible) with per-connection guidance.
  // Disconnect buttons — site-connections.tsx (+ the plan_required card).
  route("post", `${base}/disconnect`, async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    const { ids } = z.object({ ids: idsInput }).parse(req.body);
    await budget(user, "disconnect", ids.length);
    const results = [];
    for (const id of [...new Set(ids)]) {
      const db = await pool.connect();
      try {
        await db.query("SELECT pg_advisory_lock(8275,$1)", [id]);
        const c = await ownedConnection(user, id, provider);
        let revoked = !c.created_token;
        if (provider === "cloudflare" && c.created_token) {
          try {
            await cfFor(c, http).call(`/user/tokens/${c.token_id}`, "DELETE");
            revoked = true;
          } catch {
            revoked = false;
          }
        }
        await db.query(
          "DELETE FROM edge_invites WHERE user_id=$1 AND connection_id=$2",
          [user, id],
        );
        await db.query(
          "DELETE FROM edge_connections WHERE user_id=$1 AND id=$2",
          [user, id],
        );
        await connectionNotice(
          req,
          user,
          provider,
          false,
          c.email ?? c.subject,
        );
        results.push({
          id,
          revoked,
          message:
            provider === "gsc"
              ? "Local Search Console data deleted. Google account-wide revocation may also disconnect GBP/calendar; manage access in your Google Account."
              : revoked
                ? "Disconnected locally. Previously applied edge rules remain; manage them in Cloudflare."
                : "Local data deleted. Revoke the ConstructHUB token in Cloudflare → My Profile → API Tokens. Applied rules remain.",
        });
      } finally {
        await db.query("SELECT pg_advisory_unlock(8275,$1)", [id]);
        db.release();
      }
    }
    res.json({ results });
  });
  // Sends client onboarding invitations: INSERT edge_invites rows (each client must be an
  // owned location with a website; Cloudflare also needs the account ID + agency env) and
  // queues an invite job per row. "Send onboarding emails" — site-connections.tsx.
  route("post", `${base}/invites`, async (req, res, user) => {
    const p = z
      .object({
        connectionId: idInput,
        clients: z
          .array(
            z.object({
              email: z.string().email().max(254),
              locationId: idInput,
              accountId: cfId.optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    const c = await ownedConnection(user, p.connectionId, provider);
    await budget(user, "invites", p.clients.length);
    const records = [];
    for (const input of p.clients) {
      const {
        rows: [l],
      } = await pool.query(
        "SELECT website FROM business_locations WHERE id=$1 AND user_id=$2",
        [input.locationId, user],
      );
      if (!l?.website)
        throw new ProviderError(
          "An owned location with a website is required",
          400,
        );
      if (
        provider === "cloudflare" &&
        (!input.accountId ||
          !process.env.CLOUDFLARE_AGENCY_EMAIL ||
          user !== Number(process.env.CLOUDFLARE_AGENCY_USER_ID))
      )
        throw new ProviderError(
          "Agency email, owner and client account ID must be configured",
          400,
        );
      records.push({ ...input, domain: domain(l.website) });
    }
    for (const input of records) {
      const {
        rows: [i],
      } = await pool.query(
        "INSERT INTO edge_invites(user_id,provider,email,domain,account_id,connection_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          user,
          provider,
          input.email,
          input.domain,
          input.accountId ?? null,
          c.id,
        ],
      );
      await queue(user, c.id, null, "invite", { inviteId: i.id });
    }
    await logActivity(req, user, `${provider}.invited`, {
      count: records.length,
    });
    res.status(202).json({ queued: records.length });
  });
  // Onboarding tab location picker: business_locations of this user (?q name, 25/page)
  // for composing invitation lines. Both provider pages — site-connections.tsx.
  route("get", `${base}/locations`, async (req, res, user) => {
    const p = listInput.parse(req.query),
      v = [user, `%${p.q}%`];
    const { rows } = await pool.query(
      `SELECT id,business_name,website FROM business_locations WHERE user_id=$1 AND business_name ILIKE $2 ORDER BY id LIMIT $3 OFFSET $4`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      "SELECT count(*)::int total FROM business_locations WHERE user_id=$1 AND business_name ILIKE $2",
      v,
    );
    res.json({ items: rows, total: n.total });
  });
  // Onboarding tab invitation list: edge_invites of this user+provider (?q email/domain,
  // ?state pending/accepted, 25/page). Both provider pages — site-connections.tsx.
  route("get", `${base}/invites`, async (req, res, user) => {
    const p = listInput.parse(req.query),
      v = [user, provider, `%${p.q}%`, p.status];
    const where =
      "user_id=$1 AND provider=$2 AND (email ILIKE $3 OR domain ILIKE $3) AND ($4='' OR state=$4)";
    const { rows } = await pool.query(
      `SELECT id,email,domain,state,created_at FROM edge_invites WHERE ${where} ORDER BY id DESC LIMIT $5 OFFSET $6`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM edge_invites WHERE ${where}`,
      v,
    );
    res.json({ items: rows, total: n.total });
  });
}
export function registerCloudflareRoutes(
  app: Express,
  auth: Auth,
  http: typeof fetch = fetch,
) {
  registerAssetRoutes(app, auth, "cloudflare", http);
  const route = routeFor(app, auth);
  const secure = (req: Request) => {
    if (process.env.NODE_ENV === "production" && !req.secure)
      throw new ProviderError("HTTPS is required for credentials", 400);
  };
  // Raw analytics lists behind the details panel ("Flagged IPs / traffic / events / paths /
  // bots / countries"): expands edge_assets.data->field (?q, 25/page). site-connections.tsx.
  route("get", "/api/cloudflare/assets/:id/cache", async (req, res, user) => {
    const a = await ownedAsset(
      user,
      idInput.parse(req.params.id),
      "cloudflare",
    );
    const p = listInput
      .extend({
        field: z.enum(["traffic", "events", "paths", "bots", "countries"]),
      })
      .parse(req.query);
    const values = [a.id, user, p.field, `%${p.q}%`];
    const from =
      "FROM edge_assets a,jsonb_array_elements(COALESCE(NULLIF(a.data->$3,'null'::jsonb),'[]')) value WHERE a.id=$1 AND a.user_id=$2 AND value::text ILIKE $4";
    const { rows } = await pool.query(
      `SELECT value ${from} LIMIT $5 OFFSET $6`,
      [...values, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(`SELECT count(*)::int total ${from}`, values);
    res.json({ items: rows.map((r) => r.value), total: n.total });
  });
  // Global-Key connect step 1: verifies the email+key with Cloudflare and lists accounts/
  // zones to pick from (50/page). The key is wiped from the request afterwards.
  // "Verify and choose zones" — site-connections.tsx.
  route("post", "/api/cloudflare/key-discovery", async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    secure(req);
    await budget(user, "connect");
    const p = globalInput
      .extend({
        page: z.number().int().min(1).max(10000).default(1),
        q: z.string().max(200).default(""),
        accountId: cfId.optional(),
      })
      .parse(req.body);
    const client = new CloudflareClient({ email: p.email, key: p.key }, http);
    await client.call("/user");
    const q = new URLSearchParams({ page: String(p.page), per_page: "50" });
    if (p.q) q.set("name", p.q);
    if (p.accountId) q.set("account.id", p.accountId);
    const accounts = await client.call(`/accounts?page=${p.page}&per_page=50`),
      zones = await client.call(`/zones?${q}`);
    res.json({
      accounts: accounts.result.map((a: any) => ({ id: a.id, name: a.name })),
      zones: zones.result.map((a: any) => ({
        id: a.id,
        name: a.name,
        accountId: a.account?.id,
        status: a.status,
      })),
      total: zones.result_info?.total_count ?? zones.result.length,
      page: p.page,
    });
  });
  // Global-Key connect step 2: mints a limited ConstructHUB token (Zone Read, Analytics
  // Read, Zone WAF Edit) scoped to the picked zones and saves edge_connections.
  // "Create limited key" — site-connections.tsx.
  route("post", "/api/cloudflare/exchange", async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    secure(req);
    await budget(user, "connect");
    const p = globalInput
      .extend({ zones: z.array(cfId).min(1).max(100) })
      .parse(req.body);
    const result = await exchangeKey(
      user,
      p.email,
      p.key,
      [...new Set(p.zones)],
      http,
    );
    await connectionNotice(req, user, "cloudflare", true, p.email);
    res.json(result);
  });
  // Fallback connect path: verifies a manually created scoped token and saves
  // edge_connections (method 'paste'). "Connect scoped token" — site-connections.tsx.
  route("post", "/api/cloudflare/token", async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    secure(req);
    await budget(user, "connect");
    const p = z.object({ token: credential }).parse(req.body),
      client = new CloudflareClient({ token: p.token }, http);
    const v = (await client.call("/user/tokens/verify")).result;
    if (v?.status !== "active" || !v.id)
      throw new ProviderError("Cloudflare token is not active", 400);
    await client.call("/zones?per_page=1");
    const id = await saveConnection(user, {
      subject: v.id,
      token: p.token,
      tokenId: v.id,
      method: "paste",
      permissions: ["Token-supplied permissions; verify in Cloudflare"],
    });
    await connectionNotice(req, user, "cloudflare", true, "Scoped token");
    res.json({ id });
  });
  // Ops-only agency-membership connect: saves a preconfigured agency connection
  // (env CLOUDFLARE_AGENCY_*) and queues a memberships job; 503 unless that env is set.
  // "Enable agency membership connection" — site-connections.tsx.
  route("post", "/api/cloudflare/agency", async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    if (
      user !== Number(process.env.CLOUDFLARE_AGENCY_USER_ID) ||
      !process.env.CLOUDFLARE_AGENCY_TOKEN ||
      !process.env.CLOUDFLARE_AGENCY_EMAIL
    )
      throw new ProviderError(
        "Agency owner, token and email are not configured",
        503,
      );
    await budget(user, "connect");
    const v = (
      await new CloudflareClient(
        { token: process.env.CLOUDFLARE_AGENCY_TOKEN },
        http,
      ).call("/user/tokens/verify")
    ).result;
    if (v?.status !== "active")
      throw new ProviderError("Agency token is not active", 400);
    const {
      rows: [c],
    } = await pool.query(
      `INSERT INTO edge_connections(user_id,provider,subject,email,method) VALUES($1,'cloudflare','agency-memberships',$2,'agency') ON CONFLICT(user_id,provider,subject) DO UPDATE SET email=$2 RETURNING id`,
      [user, process.env.CLOUDFLARE_AGENCY_EMAIL],
    );
    await queue(user, c.id, null, "memberships");
    await connectionNotice(
      req,
      user,
      "cloudflare",
      true,
      process.env.CLOUDFLARE_AGENCY_EMAIL,
    );
    res.json({ id: c.id });
  });
  // "Flagged IPs" list in the zone details panel: Click Guard blocked_ips + VPN Shield
  // vpn_visits for the zone's domain. site-connections.tsx.
  route(
    "get",
    "/api/cloudflare/assets/:id/flagged-ips",
    async (req, res, user) =>
      res.json(
        await flaggedIpsForZone(user, idInput.parse(req.params.id), req.query),
      ),
  );
  // Builds the chosen rule pack for the selected zones and stores a state='preview'
  // edge_actions row per zone for review before anything touches Cloudflare.
  // "Preview rules" — site-connections.tsx.
  route("post", "/api/cloudflare/preview", async (req, res, user) => {
    const p = z
      .object({
        ids: idsInput,
        kind: z.enum(["ips", "ads-door", "bad-ua"]),
        path: z.string().max(160).default("/ads"),
        ips: z.array(z.string().max(64)).max(100).default([]),
        officeIps: z.array(z.string().max(64)).max(100).default([]),
      })
      .parse(req.body);
    const assets = await Promise.all(
        [...new Set(p.ids)].map((id) => ownedAsset(user, id, "cloudflare")),
      ),
      rules = rulePack(p.kind, p.path, p.ips, p.officeIps),
      items = [];
    for (const a of assets) {
      const preview = {
        zone: a.name,
        rules,
        warning:
          "Review exemptions before confirming. Blocks affect real visitors. Ads rate limiting depends on your Cloudflare plan. High security level must be reviewed in Cloudflare; it is not changed by this pack.",
        before: a.data ?? null,
      };
      const {
        rows: [action],
      } = await pool.query(
        "INSERT INTO edge_actions(user_id,asset_id,kind,preview) VALUES($1,$2,$3,$4) RETURNING id",
        [user, a.id, p.kind, JSON.stringify(preview)],
      );
      items.push({ id: action.id, ...preview });
    }
    res.json({ items });
  });
  // confirm: queues previewed edge changes for the worker (state 'queued' + 'apply' job;
  // previews expire after 1h). undo: queues removal of ConstructHUB-managed rules for
  // applied/uncertain actions ('reverting' + 'undo' job). Both buttons — site-connections.tsx.
  for (const op of ["confirm", "undo"] as const)
    route("post", `/api/cloudflare/${op}`, async (req, res, user) => {
      if (!requireRecentAuth(req, res)) return;
      const p = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
        .parse(req.body);
      await budget(user, op, p.ids.length);
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const { rows } = await db.query(
          "SELECT * FROM edge_actions WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",
          [user, [...new Set(p.ids)]],
        );
        if (rows.length !== new Set(p.ids).size)
          throw new ProviderError("Preview not found", 404);
        if (
          rows.some((a) =>
            op === "confirm"
              ? a.state !== "preview" ||
                Date.now() - new Date(a.created_at).getTime() > 3600000
              : !["applied", "uncertain"].includes(a.state),
          )
        )
          throw new ProviderError(
            "Preview expired or action is already queued; refresh the audit list",
            409,
          );
        for (const a of rows) {
          await db.query("UPDATE edge_actions SET state=$1 WHERE id=$2", [
            op === "confirm" ? "queued" : "reverting",
            a.id,
          ]);
          await db.query(
            `INSERT INTO edge_jobs(user_id,connection_id,asset_id,kind,payload) SELECT user_id,connection_id,id,$1,$2 FROM edge_assets WHERE id=$3 AND user_id=$4`,
            [
              op === "confirm" ? "apply" : "undo",
              JSON.stringify({ actionId: a.id }),
              a.asset_id,
              user,
            ],
          );
        }
        await db.query("COMMIT");
        await logActivity(req, user, "cloudflare.edge_confirmed", {
          actionIds: p.ids,
          operation: op,
        });
        res.status(202).json({ queued: rows.length });
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    });
  // Edge audit tab: every previewed/applied edge change (edge_actions joined with
  // edge_assets, ?q zone name, ?state, 25/page). Cloudflare page — site-connections.tsx.
  route("get", "/api/cloudflare/actions", async (req, res, user) => {
    const p = listInput.parse(req.query),
      v = [user, `%${p.q}%`, p.status],
      where = "x.user_id=$1 AND a.name ILIKE $2 AND ($3='' OR x.state=$3)";
    const { rows } = await pool.query(
      `SELECT x.*,a.name,a.data AS after FROM edge_actions x JOIN edge_assets a ON a.id=x.asset_id WHERE ${where} ORDER BY x.created_at DESC LIMIT $4 OFFSET $5`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM edge_actions x JOIN edge_assets a ON a.id=x.asset_id WHERE ${where}`,
      v,
    );
    res.json({ items: rows, total: n.total });
  });
}
