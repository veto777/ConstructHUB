/**
 * Where a rank check is run from: Google's own list of US cities, ZIP codes,
 * counties, states and metro areas. The list comes from the data source (a
 * free call), is kept in seo_locations and refreshed every 60 days, so picking
 * a city never costs anything.
 */
import { pool } from "../db";
import { request, DataForSeoError } from "./dataforseo";

export const LOCATION_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_locations (
    code integer PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS seo_locations_name ON seo_locations (lower(name) text_pattern_ops)`,
];

export const UNITED_STATES = { code: 2840, name: "United States", type: "Country" };
/** The kinds worth offering, most useful first (the order results are shown in). */
export const LOCATION_TYPES = ["City", "State", "County", "Municipality", "DMA Region", "Postal Code", "Neighborhood"] as const;
const TYPE_LABEL: Record<string, string> = { "DMA Region": "Metro area", "Postal Code": "ZIP code", Municipality: "Town" };
const REFRESH_DAYS = 60;

/** "Tampa,Florida,United States" -> "Tampa, Florida" (the country is always the US here). */
export function locationLabel(name: string): string {
  const parts = String(name ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && parts[parts.length - 1] === "United States") parts.pop();
  return parts.join(", ");
}
export const locationTypeLabel = (type: string) => TYPE_LABEL[type] ?? type;

export type LocationRow = { code: number; name: string; type: string };
/** Rows of the source's list worth keeping. Pure, for tests. */
export function usableLocations(items: any[]): LocationRow[] {
  const keep = new Set<string>(LOCATION_TYPES);
  const out: LocationRow[] = [], seen = new Set<number>();
  for (const i of Array.isArray(items) ? items : []) {
    const code = Number(i?.location_code);
    if (!Number.isInteger(code) || code <= 0 || seen.has(code) || typeof i?.location_name !== "string" || !keep.has(i?.location_type)) continue;
    seen.add(code);
    out.push({ code, name: i.location_name, type: i.location_type });
  }
  return out;
}

let loading: Promise<number> | null = null;
/** When the list was last found fresh; the database is not asked again for an hour. */
let freshUntil = 0;
/** Make sure the list is there and fresh. One load at a time; returns the number of locations (0 = known fresh, not counted). */
export async function ensureLocations(): Promise<number> {
  if (Date.now() < freshUntil) return 0;
  // The newest row says when the list was last loaded (a load rewrites every row it still has).
  const { rows: [have] } = await pool.query("SELECT (SELECT loaded_at FROM seo_locations ORDER BY loaded_at DESC LIMIT 1) AS newest, EXISTS (SELECT 1 FROM seo_locations) AS any");
  const stale = !have.newest || Date.now() - new Date(have.newest).getTime() > REFRESH_DAYS * 864e5;
  if (have.any && !stale) { freshUntil = Date.now() + 3600_000; return 0; }
  loading ??= (async () => {
    try {
      const started = new Date();
      const response = await request("GET", "/serp/google/locations/us");
      const task = response?.tasks?.[0];
      if (!response || response.status_code !== 20000 || !task || task.status_code !== 20000) throw new DataForSeoError("upstream", "The list of places could not be loaded");
      const rows = usableLocations(task.result as any[]);
      if (rows.length < 1000) throw new DataForSeoError("upstream", "The list of places came back incomplete");
      for (let i = 0; i < rows.length; i += 5000) {
        const chunk = rows.slice(i, i + 5000);
        await pool.query(
          `INSERT INTO seo_locations(code, name, type) SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
           ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, loaded_at=now()`,
          [chunk.map((r) => r.code), chunk.map((r) => r.name), chunk.map((r) => r.type)]);
      }
      // Places the source no longer lists (a complete load just rewrote all the others).
      await pool.query("DELETE FROM seo_locations WHERE loaded_at < $1", [started]).catch(() => {});
      console.info(`[seo] loaded ${rows.length} places`);
      freshUntil = Date.now() + 3600_000;
      return rows.length;
    } catch (e) {
      // A stale list is still a usable list; do not try again for an hour.
      if (have.any) { freshUntil = Date.now() + 3600_000; console.warn(`[seo] places refresh failed, keeping the saved list: ${(e as Error)?.message ?? e}`); return 0; }
      throw e;
    } finally { loading = null; }
  })();
  return loading;
}

export type LocationOption = { code: number; label: string; kind: string };

const STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia", fl: "florida",
  ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

/**
 * What a person types for a place, as the start of its name and (when given) the start of its state:
 * "Tampa", "tampa, fl", "Tampa FL", "bellingham, wash", "33602". Pure, for tests.
 */
export function parsePlaceQuery(q: string): { name: string; state: string | null } {
  const clean = String(q ?? "").toLowerCase().replace(/[%_\\]/g, "").replace(/\s+/g, " ").trim();
  let name = clean, state: string | null = null;
  const comma = clean.indexOf(",");
  if (comma >= 0) { name = clean.slice(0, comma).trim(); state = clean.slice(comma + 1).replace(/,/g, " ").trim() || null; }
  else {
    // "tampa fl": a trailing two-letter state after at least one other word
    const m = clean.match(/^(.+) ([a-z]{2})$/);
    if (m && STATES[m[2]]) { name = m[1]; state = m[2]; }
  }
  if (state) state = STATES[state] ?? state;
  return { name, state };
}

/** Places whose name starts with what was typed: cities first, then states, counties, towns, metro areas, ZIP codes. */
export async function searchLocations(q: string, limit = 12): Promise<LocationOption[]> {
  const { name, state } = parsePlaceQuery(q);
  if (name.length < 2) return [];
  await ensureLocations();
  // Stored as "Tampa,Florida,United States": the name is the part before the first comma, the state follows it.
  const { rows } = await pool.query(
    `SELECT code, name, type FROM seo_locations
      WHERE lower(name) LIKE $1 || '%' AND ($4::text IS NULL OR lower(name) LIKE '%,' || $4 || '%')
      ORDER BY array_position($2::text[], type), length(name), name LIMIT $3`, [name, [...LOCATION_TYPES], limit, state]);
  return rows.map((r: any) => ({ code: r.code, label: locationLabel(r.name), kind: locationTypeLabel(r.type) }));
}

/** The label for a code the customer picked, or null when it is not a place we offer. */
export async function locationByCode(code: number): Promise<LocationOption | null> {
  if (code === UNITED_STATES.code) return { code, label: UNITED_STATES.name, kind: "Country" };
  const { rows: [r] } = await pool.query("SELECT code, name, type FROM seo_locations WHERE code=$1", [code]);
  return r ? { code: r.code, label: locationLabel(r.name), kind: locationTypeLabel(r.type) } : null;
}
