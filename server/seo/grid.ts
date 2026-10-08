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

export const GRID_SIZES = [3, 5, 7] as const;
/** Miles between neighbouring points. */
export const GRID_SPACINGS = [1, 2, 3, 5, 10] as const;
/** One local search for one point (measured 2026-10-08). */
export const GRID_POINT_USD = 0.002;
/** How far down the local results we look; a business not in these is "not in the top 20". */
export const GRID_DEPTH = 20;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** The most a scan of `points` points can cost us (held while it runs). */
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
}).strict();
export type GridPin = z.infer<typeof pinInput>;

export type GridCell = { row: number; col: number; lat: number; lng: number };
/** The points of a size x size square centred on the pin; row 0 is the northern edge, column 0 the western. */
export function gridPoints(center: { lat: number; lng: number }, size: number, spacingMiles: number): GridCell[] {
  const half = (size - 1) / 2;
  const dLat = spacingMiles / 69.0, dLng = spacingMiles / (69.172 * Math.max(0.05, Math.cos((center.lat * Math.PI) / 180)));
  const out: GridCell[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++)
    out.push({ row, col, lat: round6(center.lat + (half - row) * dLat), lng: round6(center.lng + (col - half) * dLng) });
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

export type GridTarget = { cid: string | null; domain: string; name: string | null };
/** Is this listing the business? Its Google id settles it; without one, its website; without that, its exact name. */
export function isTarget(l: MapListing, t: GridTarget): boolean {
  if (t.cid && l.cid) return l.cid === t.cid;
  if (l.domain) return l.domain === t.domain || l.domain.endsWith(`.${t.domain}`);
  const ours = normalizeBusinessName(t.name);
  return ours.length >= 4 && normalizeBusinessName(l.name) === ours;
}

export type GridPointResult = GridCell & {
  /** Position in the map results there; null = not in the top 20. */
  rank: number | null;
  /** The lookup for this point failed; its position is unknown (not "not found"). */
  failed?: true;
  /** The first three businesses shown there. */
  top: { name: string; rank: number }[];
};
export type GridRival = { name: string; ours: boolean; domain: string | null; rating: number | null; reviews: number | null; /** Points where it is in the first three. */ top3: number; /** Points where it shows at all. */ found: number; /** Average position where it shows. */ avgRank: number };
export type GridSummary = { points: number; checked: number; found: number; top3: number; /** Average position over the points checked, counting "not in the top 20" as 21. */ avgRank: number | null };
export type GridScan = {
  keyword: string; size: number; spacing: number; center: { lat: number; lng: number; name: string };
  points: GridPointResult[]; rivals: GridRival[]; summary: GridSummary; fetchedAt: string;
};

export function summarise(points: GridPointResult[]): GridSummary {
  const checked = points.filter((p) => !p.failed);
  const found = checked.filter((p) => p.rank !== null);
  return {
    points: points.length, checked: checked.length, found: found.length, top3: found.filter((p) => p.rank! <= 3).length,
    avgRank: checked.length ? Math.round((checked.reduce((a, p) => a + (p.rank ?? GRID_DEPTH + 1), 0) / checked.length) * 10) / 10 : null,
  };
}

/** Who shows up across the area: every business seen, by how many points it leads at. Ours is always in the list. */
export function rivalsOf(perPoint: MapListing[][], target: GridTarget, keep = 10): GridRival[] {
  const seen = new Map<string, { l: MapListing; ours: boolean; ranks: number[] }>();
  for (const listings of perPoint) for (const l of listings) {
    const ours = isTarget(l, target);
    const key = ours ? "ours" : l.cid ?? `${normalizeBusinessName(l.name)}|${l.domain ?? ""}`;
    const row = seen.get(key) ?? { l, ours, ranks: [] };
    row.ranks.push(l.rank); seen.set(key, row);
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
  const target: GridTarget = { cid: input.pin.cid, domain: input.domain, name: input.pin.name };
  const points = cells.map((c, i): GridPointResult => {
    const listings = results[i];
    if (!listings) return { ...c, rank: null, failed: true, top: [] };
    return { ...c, rank: listings.find((l) => isTarget(l, target))?.rank ?? null, top: listings.slice(0, 3).map((l) => ({ name: l.name, rank: l.rank })) };
  });
  return {
    keyword: input.keyword, size: input.size, spacing: input.spacing, center: { lat: input.pin.lat, lng: input.pin.lng, name: input.pin.name },
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

/** Run every point, a few at a time. A point that fails is marked unknown; if every point fails the scan fails. */
export async function fetchGrid(input: { keyword: string; size: number; spacing: number; pin: GridPin; domain: string }): Promise<{ data: GridScan; costUsd: number; costUnknown: boolean }> {
  const cells = gridPoints(input.pin, input.size, input.spacing);
  const results: (MapListing[] | null)[] = new Array(cells.length).fill(null);
  let costUsd = 0, costUnknown = false, next = 0;
  let firstError: unknown = null;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= cells.length) return;
      try {
        const r = await mapLookup("/serp/google/local_finder/live/advanced", pointRequest(input.keyword, cells[i]));
        costUsd += r.costUsd; results[i] = r.listings;
      } catch (e: any) {
        firstError ??= e;
        costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
        if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, cells.length) }, worker));
  if (results.every((r) => r === null))
    throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError ?? "The map lookups failed.")), { costUsd: round6(costUsd), costUnknown });
  return { data: buildScan(input, cells, results), costUsd: round6(costUsd), costUnknown };
}

// ── Saved pins and scans ────────────────────────────────────────────────────

export const GRID_SCHEMA_DDL = [
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS grid_pin jsonb`,
  `CREATE TABLE IF NOT EXISTS seo_grid_scans (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     keyword text NOT NULL,
     size integer NOT NULL,
     spacing numeric NOT NULL,
     scan jsonb NOT NULL,
     avg_rank numeric,
     points integer NOT NULL DEFAULT 0,
     checked integer NOT NULL DEFAULT 0,
     found integer NOT NULL DEFAULT 0,
     top3 integer NOT NULL DEFAULT 0,
     cost_usd numeric NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS seo_grid_scans_site ON seo_grid_scans(site_id, created_at DESC)`,
];

export function readPin(v: unknown): GridPin | null {
  const p = pinInput.safeParse(v);
  return p.success ? p.data : null;
}
export async function savePin(userId: number, siteId: number, pin: GridPin): Promise<void> {
  await pool.query("UPDATE seo_sites SET grid_pin=$3 WHERE id=$1 AND user_id=$2", [siteId, userId, JSON.stringify(pin)]);
}
export async function saveScan(userId: number, siteId: number, scan: GridScan, costUsd: number): Promise<number> {
  const s = scan.summary;
  const { rows: [row] } = await pool.query(
    `INSERT INTO seo_grid_scans(user_id, site_id, keyword, size, spacing, scan, avg_rank, points, checked, found, top3, cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [userId, siteId, scan.keyword, scan.size, scan.spacing, JSON.stringify(scan), s.avgRank, s.points, s.checked, s.found, s.top3, costUsd]);
  return row.id;
}
export type ScanRow = { id: number; keyword: string; size: number; spacing: number; avgRank: number | null; points: number; checked: number; found: number; top3: number; at: string };
export async function listScans(userId: number, siteId: number, limit = 40): Promise<ScanRow[]> {
  const { rows } = await pool.query(
    `SELECT id, keyword, size, spacing::float8 AS spacing, avg_rank::float8 AS "avgRank", points, checked, found, top3, created_at AS at
       FROM seo_grid_scans WHERE site_id=$1 AND user_id=$2 ORDER BY created_at DESC, id DESC LIMIT $3`, [siteId, userId, limit]);
  return rows;
}
export async function getScan(userId: number, siteId: number, scanId: number): Promise<(GridScan & { id: number }) | null> {
  const { rows: [row] } = await pool.query("SELECT id, scan FROM seo_grid_scans WHERE id=$1 AND site_id=$2 AND user_id=$3", [scanId, siteId, userId]);
  return row ? { ...(row.scan as GridScan), id: row.id } : null;
}
