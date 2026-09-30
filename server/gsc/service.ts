import { pool } from "../db";
import { decryptToken, encryptToken } from "../gbp/token-crypto";
import { SearchConsoleClient, GSC_SCOPE } from "./client";
import {
  ProviderError,
  domain,
  queue,
  mapLocations,
  withinProperty,
} from "../cloudflare/common";
import { takeBudget } from "../growth-limits";
export async function gscToken(c: any, http: typeof fetch = fetch) {
  if (c.token && new Date(c.expires_at).getTime() > Date.now() + 60000)
    return decryptToken(c.token)!;
  if (!c.refresh_token)
    throw new ProviderError("Reconnect Search Console", 401);
  let r: Response, t: any;
  try {
    r = await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: decryptToken(c.refresh_token)!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(20000),
    });
    t = await r.json();
  } catch {
    throw new ProviderError("Search Console token refresh unavailable");
  }
  if (
    !r.ok ||
    !t.access_token ||
    (t.scope && !t.scope.split(" ").includes(GSC_SCOPE))
  )
    throw new ProviderError("Reconnect Search Console", 401);
  const expires = new Date(Date.now() + Number(t.expires_in || 3600) * 1000);
  const encryptedAccess = encryptToken(t.access_token),
    encryptedRefresh = encryptToken(t.refresh_token);
  const updated = await pool.query(
    "UPDATE edge_connections SET token=$1,expires_at=$2,refresh_token=COALESCE($3,refresh_token) WHERE id=$4 AND user_id=$5 AND refresh_token IS NOT DISTINCT FROM $6 AND token IS NOT DISTINCT FROM $7 RETURNING id",
    [
      encryptedAccess,
      expires,
      encryptedRefresh,
      c.id,
      c.user_id,
      c.refresh_token,
      c.token,
    ],
  );
  if (!updated.rowCount)
    throw new ProviderError("Search Console connection changed; retry", 409);
  c.token = encryptedAccess;
  c.refresh_token = encryptedRefresh ?? c.refresh_token;
  c.expires_at = expires;
  return t.access_token;
}
export const gscFor = (c: any, http: typeof fetch = fetch) =>
  new SearchConsoleClient(() => gscToken(c, http), http);
export async function saveGscGrant(user: number, identity: any, tokens: any) {
  if (
    !identity.sub ||
    !identity.email ||
    !identity.email_verified ||
    !tokens.access_token ||
    !String(tokens.scope).split(" ").includes(GSC_SCOPE)
  )
    throw new ProviderError(
      "Search Console consent or identity is incomplete",
      400,
    );
  const {
    rows: [c],
  } = await pool.query(
    `INSERT INTO edge_connections(user_id,provider,subject,email,token,refresh_token,expires_at,method,permissions)
    VALUES($1,'gsc',$2,$3,$4,$5,$6,'oauth',$7) ON CONFLICT(user_id,provider,subject) DO UPDATE SET
    email=$3,token=$4,refresh_token=COALESCE($5,edge_connections.refresh_token),expires_at=$6,permissions=$7 RETURNING id`,
    [
      user,
      identity.sub,
      identity.email,
      encryptToken(tokens.access_token),
      encryptToken(tokens.refresh_token),
      new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      JSON.stringify([GSC_SCOPE]),
    ],
  );
  await queue(user, c.id, null, "discover");
  return c.id;
}
export async function discoverProperties(c: any, http: typeof fetch = fetch) {
  const data = await gscFor(c, http).call("/sites");
  const sites = (data.siteEntry ?? []).filter((s: any) =>
    ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(
      s.permissionLevel,
    ),
  );
  // sites.list has no provider pagination. One provider request, then set-based database import.
  const records = sites.map((s: any) => ({
    external_id: s.siteUrl,
    name: s.siteUrl,
    domain: domain(s.siteUrl),
    status: s.permissionLevel,
  }));
  const { rows } = await pool.query(
    `INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status)
    SELECT $1,$2,'gsc',external_id,name,domain,status FROM jsonb_to_recordset($3::jsonb) AS r(external_id text,name text,domain text,status text)
    ON CONFLICT(connection_id,external_id) DO UPDATE SET status=EXCLUDED.status RETURNING id,external_id`,
    [c.user_id, c.id, JSON.stringify(records)],
  );
  for (const a of rows) await mapLocations(c.user_id, a.id, a.external_id);
  await pool.query(
    `UPDATE edge_assets SET status='access_removed' WHERE connection_id=$1 AND user_id=$2 AND NOT(external_id=ANY($3::text[]))`,
    [c.id, c.user_id, sites.map((s: any) => s.siteUrl)],
  );
}
export const dimensions = [
  "date",
  "query",
  "page",
  "device",
  "country",
] as const;
export async function syncProperty(
  c: any,
  a: any,
  p: any,
  http: typeof fetch = fetch,
) {
  const data = await gscFor(c, http).call(
    `/sites/${encodeURIComponent(a.external_id)}/sitemaps`,
  );
  await pool.query(
    "UPDATE edge_assets SET data=$1,synced_at=now(),error=NULL WHERE id=$2 AND user_id=$3",
    [
      JSON.stringify({
        sitemaps: data.sitemap ?? [],
        source: "Google Search Console",
      }),
      a.id,
      c.user_id,
    ],
  );
  const end =
    p.end ?? new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const start =
    p.start ?? new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
  // Month-sized windows keep the expensive query/page reports out of one large request.
  for (let cursor = new Date(start); cursor <= new Date(end); ) {
    const from = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 28);
    const to = new Date(
      Math.min(new Date(end).getTime(), cursor.getTime() - 86400000),
    )
      .toISOString()
      .slice(0, 10);
    for (const dimension of dimensions)
      await queue(c.user_id, c.id, a.id, "analytics", {
        dimension,
        start: from,
        end: to,
        offset: 0,
      });
  }
}
export async function analyticsPage(
  c: any,
  a: any,
  p: any,
  http: typeof fetch = fetch,
) {
  const dims = p.dimension === "date" ? ["date"] : ["date", p.dimension];
  const d = await gscFor(c, http).call(
    `/sites/${encodeURIComponent(a.external_id)}/searchAnalytics/query`,
    "POST",
    {
      startDate: p.start,
      endDate: p.end,
      dimensions: dims,
      rowLimit: 25000,
      startRow: p.offset,
      type: "web",
      dataState: "final",
    },
  );
  const rows = (d.rows ?? []).map((r: any) => ({
    date: r.keys[0],
    key: r.keys[1] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position,
  }));
  if (
    rows.some(
      (r: any) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
        ![r.clicks, r.impressions, r.position].every(Number.isFinite),
    )
  )
    throw new ProviderError("Invalid Search Analytics response");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (p.offset === 0)
      await db.query(
        "DELETE FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date BETWEEN $3 AND $4",
        [a.id, p.dimension, p.start, p.end],
      );
    await db.query(
      `INSERT INTO gsc_analytics(asset_id,dimension,date,key,clicks,impressions,position)
      SELECT $1,$2,date,key,clicks,impressions,position FROM jsonb_to_recordset($3::jsonb) AS r(date date,key text,clicks float8,impressions float8,position float8)
      ON CONFLICT(asset_id,dimension,date,key) DO UPDATE SET clicks=EXCLUDED.clicks,impressions=EXCLUDED.impressions,position=EXCLUDED.position`,
      [a.id, p.dimension, JSON.stringify(rows)],
    );
    if (rows.length === 25000)
      await db.query(
        `INSERT INTO edge_jobs(user_id,connection_id,asset_id,kind,payload) VALUES($1,$2,$3,'analytics',$4) ON CONFLICT DO NOTHING`,
        [
          c.user_id,
          c.id,
          a.id,
          JSON.stringify({ ...p, offset: p.offset + 25000 }),
        ],
      );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function inspectUrl(
  c: any,
  a: any,
  url: string,
  http: typeof fetch = fetch,
) {
  if (!withinProperty(a.external_id, url))
    throw new ProviderError(
      "URL must belong to the selected Search Console property",
      400,
    );
  // Daily quota is shared across grants/owners for the same Google property.
  if (!(await takeBudget(`gsc:inspection:${a.external_id}`, 1900, 1, 86400000)))
    throw new ProviderError("Property inspection daily quota reached", 429);
  if (
    !(await takeBudget(`gsc:inspection:minute:${a.external_id}`, 500, 1, 60000))
  )
    throw new ProviderError("Property inspection minute quota reached", 429);
  const d = await gscFor(c, http).call("/urlInspection/index:inspect", "POST", {
    siteUrl: a.external_id,
    inspectionUrl: url,
    languageCode: "en-US",
  });
  if (!d.inspectionResult)
    throw new ProviderError("Inspection result unavailable");
  await pool.query(
    `INSERT INTO gsc_inspections(asset_id,url,result) VALUES($1,$2,$3) ON CONFLICT(asset_id,url) DO UPDATE SET result=$3,inspected_at=now()`,
    [a.id, url, JSON.stringify(d.inspectionResult)],
  );
}
/** Read-only hooks for Site Scan and Locations Insights; no Google requests. */
export async function indexingForUrls(
  user: number,
  location: number,
  urls: string[],
) {
  const { rows } = await pool.query(
    `SELECT i.url,i.result,i.inspected_at FROM gsc_inspections i JOIN edge_location_links l ON l.asset_id=i.asset_id
    JOIN business_locations b ON b.id=l.location_id AND b.user_id=l.user_id WHERE l.user_id=$1 AND l.location_id=$2 AND i.url=ANY($3::text[]) ORDER BY inspected_at DESC LIMIT 100`,
    [user, location, urls.slice(0, 100)],
  );
  return rows;
}
export async function locationSearchClicks(user: number, location: number) {
  // Prefer one property per location to avoid double counting URL-prefix/domain properties.
  const {
    rows: [r],
  } = await pool.query(
    `SELECT a.external_id,sum(m.clicks) clicks,sum(m.impressions) impressions FROM edge_location_links l JOIN edge_assets a ON a.id=l.asset_id
    JOIN gsc_analytics m ON m.asset_id=a.id AND m.dimension='date' AND m.date>=current_date-30
    JOIN business_locations b ON b.id=l.location_id AND b.user_id=l.user_id
    WHERE l.user_id=$1 AND l.location_id=$2 GROUP BY a.id ORDER BY a.id LIMIT 1`,
    [user, location],
  );
  return r ?? null;
}
