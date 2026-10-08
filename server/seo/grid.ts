/**
 * Local grid: where a business shows up in Google's local results for one search, checked
 * from a square of points laid over its service area (3x3, 5x5 or 7x7, a chosen distance apart).
 * Each point is one Google local search made as if standing there (the local finder with the
 * searcher's coordinates — NOT a map view centred there: a map view only lists what is inside
 * the picture, so a business two miles off looked "not found"; measured 2026-10-08). The business is recognised by
 * its Google listing id, else its website, else its name. Scans are kept, so one can be
 * compared with the last. Charged to SEO data like every other lookup (server/seo/budget.ts).
 */
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, taskItems, safeDomain, normalizeBusinessName, type DfsTask } from "./dataforseo";
import { publicNote } from "./public-errors";

export const GRID_SIZES = [3, 5, 7] as const;
/** Miles between neighbouring points. */
export const GRID_SPACINGS = [1, 2, 3, 5, 10] as const;
/** One local search for one point (measured 2026-10-08). */
export const GRID_POINT_USD = 0.002;
/** How far down the local results we look; a business not in these is "not in the first 20". */
export const GRID_DEPTH = 20;
/** Lookups in flight at once. One takes 5–30 seconds, so a 7 x 7 scan takes a minute or two. */
const GRID_PARALLEL = 12;
/** A scan still "running" after this long was interrupted (a restart); it is closed as failed. */
export const GRID_STALE_MINUTES = 12;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/**
 * What is held while a scan of `points` points runs. The customer pays only for points that returned
 * (at most points x GRID_POINT_USD), so this always covers their charge; a second try at a point that timed out is ours.
 */
export const gridEstimateUsd = (points: number) => round6(points * GRID_POINT_USD * 1.25);

export const gridDeps = { request };

const literal = <T extends readonly number[]>(values: T) => z.number().refine((n): n is T[number] => (values as readonly number[]).includes(n), "Not one of the choices");
export const scanInput = z.object({
  keyword: z.string().trim().min(1).max(120),
  size: literal(GRID_SIZES).default(5),
  spacing: literal(GRID_SPACINGS).default(2),
}).strict();
export const locateInput = z.object({ query: z.string().trim().min(2).max(160) }).strict();
export const pinInput = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(300).nullable().default(null),
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
  /** Google's id for the listing, when the search gave one. */
  cid: z.string().regex(/^\d{1,25}$/).nullable().default(null),
  /** The website shown on the listing (it may differ from the tracked site's). */
  domain: z.string().max(253).nullable().default(null).transform((d) => safeDomain(d)),
}).strict();
export type GridPin = z.infer<typeof pinInput>;

export type GridCell = { row: number; col: number; lat: number; lng: number };
/** The points of a size x size square centred on the pin; row 0 is the northern edge, column 0 the western. Always valid coordinates. */
export function gridPoints(center: { lat: number; lng: number }, size: number, spacingMiles: number): GridCell[] {
  const half = (size - 1) / 2;
  const dLat = spacingMiles / 69.0, dLng = spacingMiles / (69.172 * Math.max(0.05, Math.cos((center.lat * Math.PI) / 180)));
  const out: GridCell[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const lat = Math.min(89, Math.max(-89, center.lat + (half - row) * dLat));
    // Past the date line the longitude wraps round rather than leaving the map.
    const lng = ((((center.lng + (col - half) * dLng) + 180) % 360) + 360) % 360 - 180;
    out.push({ row, col, lat: round6(lat), lng: round6(lng) });
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export type MapListing = { name: string; rank: number; cid: string | null; domain: string | null; address: string | null; lat: number | null; lng: number | null; rating: number | null; reviews: number | null };
/** The businesses in one Google Maps or local-finder result, in order. Ads and anything without a name are left out. */
export function parseMapListings(items: any[]): MapListing[] {
  const out: MapListing[] = [];
  for (const i of items) {
    if ((i?.type !== "maps_search" && i?.type !== "local_pack") || i.is_paid === true) continue;
    const name = str(i.title);
    if (!name) continue;
    out.push({
      name: name.slice(0, 200), rank: out.length + 1, cid: typeof i.cid === "string" && /^\d{1,25}$/.test(i.cid) ? i.cid : null, domain: safeDomain(i.domain),
      address: str(i.address)?.slice(0, 300) ?? null, lat: num(i.latitude), lng: num(i.longitude), rating: num(i.rating?.value), reviews: num(i.rating?.votes_count),
    });
  }
  return out;
}

export type GridTarget = { cid: string | null; /** The tracked site. */ domain: string; /** The website on the pinned listing, when it differs. */ pinDomain?: string | null; name: string | null };
export type MatchKind = "id" | "website" | "name";
/**
 * Is this listing the business, and how sure is that? Google's listing id settles it either way when both sides
 * have one. Without it we fall back to the website (the tracked site's or the pinned listing's), then — only for a
 * listing that shows no website — the exact name. A fallback match is reported as such: another branch of the same
 * business shares the website, and an unrelated business can share a name.
 */
export function matchKind(l: MapListing, t: GridTarget): MatchKind | null {
  if (t.cid && l.cid) return l.cid === t.cid ? "id" : null;
  if (l.domain) return l.domain === t.domain || l.domain.endsWith(`.${t.domain}`) || (!!t.pinDomain && l.domain === t.pinDomain) ? "website" : null;
  const ours = normalizeBusinessName(t.name);
  return ours.length >= 4 && normalizeBusinessName(l.name) === ours ? "name" : null;
}
export const isTarget = (l: MapListing, t: GridTarget) => matchKind(l, t) !== null;

export type GridPointResult = GridCell & {
  /** Position in the local results there; null = not in the first 20. */
  rank: number | null;
  /** The lookup for this point failed; its position is unknown (not "not found"). */
  failed?: true;
  /** How the business was recognised there (absent when it was not found). Anything but "id" is a fallback. */
  by?: MatchKind;
  /** The first three businesses shown there. */
  top: { name: string; rank: number }[];
};
export type GridRival = { name: string; ours: boolean; domain: string | null; rating: number | null; reviews: number | null; /** Points where it is in the first three. */ top3: number; /** Points where it shows at all. */ found: number; /** Average position where it shows. */ avgRank: number };
export type GridSummary = {
  points: number; checked: number; found: number; top3: number;
  /** A score, not a measured rank: the average over the points checked, counting "not in the first 20" as 21. */
  avgRank: number | null;
  /** Points where the business was recognised by website or name rather than Google's listing id. */
  unsure: number;
};
export type GridScan = {
  keyword: string; size: number; spacing: number; center: { lat: number; lng: number; name: string; cid: string | null };
  points: GridPointResult[]; rivals: GridRival[]; summary: GridSummary; fetchedAt: string;
};

export function summarise(points: GridPointResult[]): GridSummary {
  const checked = points.filter((p) => !p.failed);
  const found = checked.filter((p) => p.rank !== null);
  return {
    points: points.length, checked: checked.length, found: found.length, top3: found.filter((p) => p.rank! <= 3).length,
    avgRank: checked.length ? Math.round((checked.reduce((a, p) => a + (p.rank ?? GRID_DEPTH + 1), 0) / checked.length) * 10) / 10 : null,
    unsure: found.filter((p) => p.by !== undefined && p.by !== "id").length,
  };
}

/** Who shows up across the area: every business seen, by how many points it leads at. Ours is always in the list. A business counts once per point. */
export function rivalsOf(perPoint: MapListing[][], target: GridTarget, keep = 10): GridRival[] {
  const seen = new Map<string, { l: MapListing; ours: boolean; ranks: number[] }>();
  for (const listings of perPoint) {
    const here = new Set<string>();
    for (const l of listings) {
      const ours = isTarget(l, target);
      const key = ours ? "ours" : l.cid ?? `${normalizeBusinessName(l.name)}|${l.domain ?? ""}`;
      if (here.has(key)) continue; // its best position at this point is the one already counted
      here.add(key);
      const row = seen.get(key) ?? { l, ours, ranks: [] };
      row.ranks.push(l.rank); seen.set(key, row);
    }
  }
  const rows = [...seen.values()].map(({ l, ours, ranks }): GridRival => ({
    name: l.name, ours, domain: l.domain, rating: l.rating, reviews: l.reviews, top3: ranks.filter((r) => r <= 3).length, found: ranks.length,
    avgRank: Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10,
  })).sort((a, b) => b.top3 - a.top3 || b.found - a.found || a.avgRank - b.avgRank || a.name.localeCompare(b.name));
  const top = rows.slice(0, keep);
  const us = rows.find((r) => r.ours);
  return us && !top.includes(us) ? [...top, us] : top;
}

/** Assemble a scan from what each point returned (null = that lookup failed). Pure. */
export function buildScan(input: { keyword: string; size: number; spacing: number; pin: GridPin; domain: string }, cells: GridCell[], results: (MapListing[] | null)[], fetchedAt = new Date().toISOString()): GridScan {
  const target: GridTarget = { cid: input.pin.cid, domain: input.domain, pinDomain: input.pin.domain ?? null, name: input.pin.name };
  const points = cells.map((c, i): GridPointResult => {
    const listings = results[i];
    if (!listings) return { ...c, rank: null, failed: true, top: [] };
    // The listing with the pinned id wherever it is in the list; only without one does the first website / name match count.
    const hit = listings.find((l) => matchKind(l, target) === "id") ?? listings.find((l) => isTarget(l, target));
    return { ...c, rank: hit?.rank ?? null, ...(hit ? { by: matchKind(hit, target)! } : {}), top: listings.slice(0, 3).map((l) => ({ name: l.name, rank: l.rank })) };
  });
  return {
    keyword: input.keyword, size: input.size, spacing: input.spacing, center: { lat: input.pin.lat, lng: input.pin.lng, name: input.pin.name, cid: input.pin.cid },
    points, rivals: rivalsOf(results.filter((r): r is MapListing[] => !!r), target), summary: summarise(points), fetchedAt,
  };
}

async function mapLookup(path: string, body: Record<string, unknown>): Promise<{ listings: MapListing[]; costUsd: number }> {
  const task: DfsTask = assertOk(await gridDeps.request("POST", path, [body]), { treatNoResultsAsEmpty: true });
  return { listings: parseMapListings(taskItems(task)), costUsd: typeof task.cost === "number" ? task.cost : 0 };
}

/** The local search made from one point: the searcher's own coordinates, no map view. */
export const pointRequest = (keyword: string, cell: { lat: number; lng: number }) => ({ keyword, location_coordinate: `${cell.lat},${cell.lng}`, language_code: "en", depth: GRID_DEPTH });

/** Find the business on Google Maps by name (and town), to choose the pin the grid is centred on. */
export async function locateBusiness(query: string): Promise<{ data: MapListing[]; costUsd: number }> {
  const { listings, costUsd } = await mapLookup("/serp/google/maps/live/advanced", { keyword: query, location_code: 2840, language_code: "en", depth: 10 });
  return { data: listings.filter((l) => l.lat !== null && l.lng !== null).slice(0, 8), costUsd };
}

/**
 * Run every point, several at a time. A point that fails is tried once more, then marked unknown; if every point fails
 * the scan fails. Three sums are kept apart:
 *   customerUsd — the lookups that returned: all the customer pays for;
 *   costUsd     — everything it cost us, including failed tries the source billed and an allowance for tries whose
 *                 cost we never learned (a timeout may still have been billed).
 */
export async function fetchGrid(input: { keyword: string; size: number; spacing: number; pin: GridPin; domain: string }): Promise<{ data: GridScan; costUsd: number; customerUsd: number; costUnknown: false }> {
  const cells = gridPoints(input.pin, input.size, input.spacing);
  const results: (MapListing[] | null)[] = new Array(cells.length).fill(null);
  let known = 0, customerUsd = 0, unknownTries = 0, next = 0;
  let firstError: unknown = null;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= cells.length) return;
      for (let attempt = 1; attempt <= 2 && results[i] === null; attempt++) {
        try {
          const r = await mapLookup("/serp/google/local_finder/live/advanced", pointRequest(input.keyword, cells[i]));
          known += r.costUsd; customerUsd += r.costUsd; results[i] = r.listings;
        } catch (e: any) {
          firstError ??= e;
          const reported = typeof e?.costUsd === "number" ? e.costUsd : 0;
          known += reported;
          if (e?.code === "timeout" || (e?.code === "upstream" && !(reported > 0))) unknownTries++;
          // Only a lookup that may simply have been slow is worth a second go.
          if (e?.code !== "timeout" && e?.code !== "upstream" && e?.code !== "rate_limited") break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GRID_PARALLEL, cells.length) }, worker));
  // What we could not learn is already in the figure (one lookup's price per such try), so the ledger is told the cost
  // is known: it must not swap this for the whole estimate.
  const costUsd = round6(known + unknownTries * GRID_POINT_USD);
  if (results.every((r) => r === null))
    throw Object.assign(new Error((firstError as any)?.message ?? "The local searches failed."), { costUsd, costUnknown: false, cause: firstError });
  return { data: buildScan(input, cells, results), costUsd, customerUsd: round6(customerUsd), costUnknown: false };
}

// ── Saved pins and scans ────────────────────────────────────────────────────

const INTERRUPTED = "The scan was interrupted before it finished. Lookups it had not made were not charged.";
export const GRID_SCHEMA_DDL = [
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS grid_pin jsonb`,
  `CREATE TABLE IF NOT EXISTS seo_grid_scans (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     keyword text NOT NULL,
     size integer NOT NULL,
     spacing numeric NOT NULL,
     scan jsonb,
     status text NOT NULL DEFAULT 'done',
     error text,
     avg_rank numeric,
     points integer NOT NULL DEFAULT 0,
     checked integer NOT NULL DEFAULT 0,
     found integer NOT NULL DEFAULT 0,
     top3 integer NOT NULL DEFAULT 0,
     cost_usd numeric NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS seo_grid_scans_site ON seo_grid_scans(site_id, created_at DESC)`,
  `ALTER TABLE seo_grid_scans ALTER COLUMN scan DROP NOT NULL`,
  `ALTER TABLE seo_grid_scans ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done'`,
  `ALTER TABLE seo_grid_scans ADD COLUMN IF NOT EXISTS error text`,
  // One scan at a time per site is the database's rule (two server processes cannot both start one). Any older
  // "running" row that would break the rule is closed first, so creating it can never fail on existing rows.
  // Done as ONE step under a lock (a DO block is a single transaction): no other writer can slip a second running row
  // in between the clean-up and the rule being made.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'seo_grid_scans_active') THEN
       LOCK TABLE seo_grid_scans IN SHARE ROW EXCLUSIVE MODE;
       UPDATE seo_grid_scans SET status='failed', error='${INTERRUPTED}' WHERE status='running' AND id NOT IN (SELECT max(id) FROM seo_grid_scans WHERE status='running' GROUP BY site_id);
       CREATE UNIQUE INDEX seo_grid_scans_active ON seo_grid_scans(site_id) WHERE status='running';
     END IF;
   END $$`,
];

export function readPin(v: unknown): GridPin | null {
  const p = pinInput.safeParse(v);
  return p.success ? p.data : null;
}
export async function savePin(userId: number, siteId: number, pin: GridPin): Promise<void> {
  await pool.query("UPDATE seo_sites SET grid_pin=$3 WHERE id=$1 AND user_id=$2", [siteId, userId, JSON.stringify(pin)]);
}
/** Close scans that have been "running" too long to still be running (the process that ran them is gone). */
const closeStale = (siteId: number) =>
  pool.query(`UPDATE seo_grid_scans SET status='failed', error=$2 WHERE site_id=$1 AND status='running' AND created_at < now() - interval '${GRID_STALE_MINUTES} minutes'`, [siteId, INTERRUPTED]);
/**
 * A scan runs in the background (it can take a couple of minutes); this opens its row. One at a time per site: if
 * one is already running, that one's id comes back with `existing`.
 */
export async function beginScan(userId: number, siteId: number, input: { keyword: string; size: number; spacing: number }): Promise<{ id: number; existing: boolean }> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query(
    `INSERT INTO seo_grid_scans(user_id, site_id, keyword, size, spacing, status, points) VALUES($1,$2,$3,$4,$5,'running',$6)
     ON CONFLICT (site_id) WHERE status='running' DO NOTHING RETURNING id`,
    [userId, siteId, input.keyword, input.size, input.spacing, input.size * input.size]);
  if (row) return { id: row.id, existing: false };
  const { rows: [running] } = await pool.query("SELECT id FROM seo_grid_scans WHERE site_id=$1 AND user_id=$2 AND status='running' ORDER BY id DESC LIMIT 1", [siteId, userId]);
  if (!running) throw new Error("Could not start the scan.");
  return { id: running.id, existing: true };
}
/** The scan a site has running now, if any. */
export async function runningScan(userId: number, siteId: number): Promise<{ id: number; keyword: string; size: number; spacing: number; at: string } | null> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query(
    `SELECT id, keyword, size, spacing::float8 AS spacing, created_at AS at FROM seo_grid_scans WHERE site_id=$1 AND user_id=$2 AND status='running' ORDER BY id DESC LIMIT 1`, [siteId, userId]);
  return row ?? null;
}
/** Write the results. Only a row that is still running is finished, and it says whether it was. */
export async function finishScan(id: number, scan: GridScan, costUsd: number): Promise<boolean> {
  const s = scan.summary;
  const { rowCount } = await pool.query(`UPDATE seo_grid_scans SET status='done', scan=$2, avg_rank=$3, points=$4, checked=$5, found=$6, top3=$7, cost_usd=$8 WHERE id=$1 AND status='running'`,
    [id, JSON.stringify(scan), s.avgRank, s.points, s.checked, s.found, s.top3, costUsd]);
  return (rowCount ?? 0) > 0;
}
export async function failScan(id: number, message: string): Promise<void> {
  await pool.query(`UPDATE seo_grid_scans SET status='failed', error=$2 WHERE id=$1 AND status='running'`, [id, message.slice(0, 300)]);
}
export type ScanRow = { id: number; keyword: string; size: number; spacing: number; status: "done" | "failed"; error: string | null; center: GridScan["center"] | null; avgRank: number | null; points: number; checked: number; found: number; top3: number; at: string };
/** Finished and failed scans, newest first (a failed one is shown as such, never hidden). */
export async function listScans(userId: number, siteId: number, limit = 40): Promise<ScanRow[]> {
  const { rows } = await pool.query(
    `SELECT id, keyword, size, spacing::float8 AS spacing, status, error, scan->'center' AS center, avg_rank::float8 AS "avgRank", points, checked, found, top3, created_at AS at
       FROM seo_grid_scans WHERE site_id=$1 AND user_id=$2 AND status IN ('done','failed') ORDER BY created_at DESC, id DESC LIMIT $3`, [siteId, userId, limit]);
  // A failed scan's note is shown in the history: made safe on the way out, like getScan's.
  return rows.map((r: any) => ({ ...r, error: r.status === "failed" ? publicNote(r.error, "The scan could not be completed.") ?? "The scan could not be completed." : null }));
}
export type ScanState = { id: number; status: "running" | "done" | "failed"; scan: (GridScan & { id: number }) | null; error: string | null };
export async function getScan(userId: number, siteId: number, scanId: number): Promise<ScanState | null> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query(`SELECT id, scan, status, error FROM seo_grid_scans WHERE id=$1 AND site_id=$2 AND user_id=$3`, [scanId, siteId, userId]);
  if (!row) return null;
  // The note is made safe on the way out (server/seo/public-errors.ts): rows saved by earlier versions are shown neutral, never rewritten.
  return { id: row.id, status: row.status, scan: row.status === "done" && row.scan ? { ...(row.scan as GridScan), id: row.id } : null, error: row.status === "failed" ? publicNote(row.error, "The scan could not be completed.") ?? "The scan could not be completed." : null };
}
