import { z } from "zod";
import { pool } from "../db";
import { takeBudget } from "../growth-limits";
export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export const idInput = z.coerce.number().int().positive();
export const idsInput = z.array(idInput).min(1).max(100);
export const listInput = z.object({
  q: z.string().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(80).default(""),
});
export function domain(value: string): string {
  try {
    return new URL(
      value.startsWith("sc-domain:")
        ? `https://${value.slice(10)}`
        : value.includes("://")
          ? value
          : `https://${value}`,
    ).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    throw new ProviderError("Invalid website domain", 400);
  }
}
export function withinProperty(property: string, url: string) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return false;
    if (property.startsWith("sc-domain:")) {
      const d = property.slice(10);
      return u.hostname === d || u.hostname.endsWith(`.${d}`);
    }
    const p = new URL(property);
    return u.origin === p.origin && u.pathname.startsWith(p.pathname);
  } catch {
    return false;
  }
}
export async function pace(provider: "cloudflare" | "gsc") {
  // Database-wide smooth rate: <240/min, below both providers' project limits.
  for (;;) {
    const r = await pool.query(
      `UPDATE edge_request_budget SET next_at=clock_timestamp()+interval '260 milliseconds' WHERE provider=$1 AND next_at<=clock_timestamp() RETURNING provider`,
      [provider],
    );
    if (r.rowCount) return;
    await new Promise((r) => setTimeout(r, 270));
  }
}
export async function ownedAsset(user: number, id: number, provider?: string) {
  const {
    rows: [a],
  } = await pool.query(
    "SELECT * FROM edge_assets WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR provider=$3)",
    [id, user, provider ?? null],
  );
  if (!a) throw new ProviderError("Property or zone not found", 404);
  return a;
}
export async function ownedConnection(
  user: number,
  id: number,
  provider?: string,
) {
  const {
    rows: [c],
  } = await pool.query(
    "SELECT * FROM edge_connections WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR provider=$3)",
    [id, user, provider ?? null],
  );
  if (!c) throw new ProviderError("Connection not found", 404);
  return c;
}
export async function queue(
  user: number,
  connection: number,
  asset: number | null,
  kind: string,
  payload: unknown = {},
) {
  const {
    rows: [j],
  } = await pool.query(
    `INSERT INTO edge_jobs(user_id,connection_id,asset_id,kind,payload)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [user, connection, asset, kind, JSON.stringify(payload)],
  );
  return j?.id ?? null;
}
export async function listAssets(
  user: number,
  provider: string,
  input: unknown,
) {
  const { q, page, limit, status } = listInput.parse(input),
    search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const where =
    "user_id=$1 AND provider=$2 AND name ILIKE $3 AND ($4='' OR status=$4)";
  const {
    rows: [count],
  } = await pool.query(
    `SELECT count(*)::int total FROM edge_assets WHERE ${where}`,
    [user, provider, search, status],
  );
  const { rows } = await pool.query(
    `SELECT id,connection_id,name,domain,external_id,account_id,status,synced_at,error,
    (SELECT count(*)::int FROM edge_location_links l WHERE l.asset_id=edge_assets.id AND l.user_id=$1) AS locations
    FROM edge_assets WHERE ${where} ORDER BY id LIMIT $5 OFFSET $6`,
    [user, provider, search, status, limit, (page - 1) * limit],
  );
  return { items: rows, total: count.total, page, limit };
}
export async function mapLocations(
  user: number,
  asset: number,
  website: string,
) {
  // SQL-side join keeps agency location lists out of Node memory. Exact normalized hosts only.
  await pool.query(
    `INSERT INTO edge_location_links(asset_id,user_id,location_id)
    SELECT $1,$2,id FROM business_locations WHERE user_id=$2 AND
    lower(regexp_replace(split_part(regexp_replace(website,'^https?://','','i'),'/',1),'^www\\.','','i'))=$3
    ON CONFLICT DO NOTHING`,
    [asset, user, domain(website)],
  );
}
export async function budget(user: number, name: string, amount = 1) {
  if (!(await takeBudget(`edge:${name}:${user}`, 500, amount, 3600000)))
    throw new ProviderError("Hourly work budget reached", 429);
}
