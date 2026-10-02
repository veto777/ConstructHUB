/**
 * Service-area helpers for the Agent Studio (SPEC.md § The profile → serviceArea).
 * OWNER: studio-backend lane.
 *
 * Counties come from the `counties` table (server/seed-all-counties.ts) and are
 * never typed by hand. Region shortcuts are a static list here: the Studio's
 * county picker offers "add all counties in <region>" and the server resolves
 * the region's county NAMES against the DB rows for that state, so the ids in
 * the profile are always real `counties.id`s. A region whose county names are
 * not all found is still returned, with the ones that matched (and `missing`
 * listing the rest) — the picker shows that honestly rather than inventing.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export type CountyRef = { id: number; name: string; stateCode: string };

export type RegionShortcut = {
  /** Stable id the client sends back ("wa-border-to-tacoma"). */
  id: string;
  name: string;
  stateCode: string;
  /** County names as the `counties` table spells them (no "County" suffix). */
  countyNames: readonly string[];
  /** Spoken description the Studio shows beside the shortcut. */
  description: string;
};

/** Static shortcuts. Owner-stated regions first (2026-10-01), then common metro areas. */
export const REGION_SHORTCUTS: readonly RegionShortcut[] = [
  { id: "wa-border-to-tacoma", name: "Canadian border to Tacoma", stateCode: "WA", description: "Whatcom, San Juan, Skagit, Island, Snohomish, King and Pierce counties",
    countyNames: ["Whatcom", "San Juan", "Skagit", "Island", "Snohomish", "King", "Pierce"] },
  { id: "wa-puget-sound", name: "Puget Sound", stateCode: "WA", description: "King, Pierce, Snohomish, Kitsap and Thurston counties",
    countyNames: ["King", "Pierce", "Snohomish", "Kitsap", "Thurston"] },
  { id: "fl-tampa-bay", name: "Tampa Bay", stateCode: "FL", description: "Pinellas, Hillsborough, Manatee and Sarasota counties",
    countyNames: ["Pinellas", "Hillsborough", "Manatee", "Sarasota"] },
  { id: "fl-orlando", name: "Orlando", stateCode: "FL", description: "Orange, Seminole and Osceola counties",
    countyNames: ["Orange", "Seminole", "Osceola"] },
  { id: "fl-south", name: "South Florida", stateCode: "FL", description: "Miami-Dade, Broward and Palm Beach counties",
    countyNames: ["Miami-Dade", "Broward", "Palm Beach"] },
  { id: "tx-dfw", name: "Dallas–Fort Worth", stateCode: "TX", description: "Dallas, Tarrant, Collin, Denton, Rockwall, Ellis, Johnson, Kaufman and Parker counties",
    countyNames: ["Dallas", "Tarrant", "Collin", "Denton", "Rockwall", "Ellis", "Johnson", "Kaufman", "Parker"] },
  { id: "tx-houston", name: "Greater Houston", stateCode: "TX", description: "Harris, Fort Bend, Montgomery, Brazoria and Galveston counties",
    countyNames: ["Harris", "Fort Bend", "Montgomery", "Brazoria", "Galveston"] },
  { id: "az-phoenix", name: "Phoenix metro", stateCode: "AZ", description: "Maricopa and Pinal counties", countyNames: ["Maricopa", "Pinal"] },
  { id: "ca-bay-area", name: "Bay Area", stateCode: "CA", description: "San Francisco, San Mateo, Santa Clara, Alameda, Contra Costa and Marin counties",
    countyNames: ["San Francisco", "San Mateo", "Santa Clara", "Alameda", "Contra Costa", "Marin"] },
  { id: "ca-socal", name: "Southern California", stateCode: "CA", description: "Los Angeles, Orange, San Diego, Riverside, San Bernardino and Ventura counties",
    countyNames: ["Los Angeles", "Orange", "San Diego", "Riverside", "San Bernardino", "Ventura"] },
  { id: "co-front-range", name: "Denver metro", stateCode: "CO", description: "Denver, Jefferson, Arapahoe, Adams, Douglas, Boulder and Broomfield counties",
    countyNames: ["Denver", "Jefferson", "Arapahoe", "Adams", "Douglas", "Boulder", "Broomfield"] },
  { id: "ga-atlanta", name: "Metro Atlanta", stateCode: "GA", description: "Fulton, DeKalb, Cobb, Gwinnett, Clayton and Cherokee counties",
    countyNames: ["Fulton", "DeKalb", "Cobb", "Gwinnett", "Clayton", "Cherokee"] },
];

/** The generic "all counties in <state>" shortcut id the client may send. */
export const ALL_COUNTIES_REGION_PREFIX = "all-";
export const allCountiesRegionId = (stateCode: string) => `${ALL_COUNTIES_REGION_PREFIX}${stateCode.toLowerCase()}`;

export const isStateCode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{2}$/.test(v);

/** Every county in a state, name-sorted. */
export async function listCounties(stateCode: string): Promise<CountyRef[]> {
  if (!isStateCode(stateCode)) return [];
  const { rows } = await db.execute(sql`select id, name, state_code from counties where state_code = ${stateCode} order by name`);
  return (rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name), stateCode: String(r.state_code) }));
}

export type ResolvedRegion = {
  id: string;
  name: string;
  stateCode: string;
  description: string;
  counties: CountyRef[];
  /** Names the static list has that the `counties` table does not (should be empty). */
  missing: string[];
};

/** Region shortcuts for a state resolved against its real county rows, plus the "all counties" shortcut. */
export function resolveRegions(stateCode: string, counties: CountyRef[]): ResolvedRegion[] {
  if (!isStateCode(stateCode)) return [];
  const byName = new Map(counties.map((c) => [c.name.toLowerCase(), c]));
  const out: ResolvedRegion[] = REGION_SHORTCUTS.filter((r) => r.stateCode === stateCode).map((r) => {
    const found: CountyRef[] = [], missing: string[] = [];
    for (const n of r.countyNames) {
      const c = byName.get(n.toLowerCase());
      if (c) found.push(c); else missing.push(n);
    }
    return { id: r.id, name: r.name, stateCode, description: r.description, counties: found, missing };
  });
  out.push({
    id: allCountiesRegionId(stateCode), name: `All counties in ${stateCode}`, stateCode,
    description: `${counties.length} ${counties.length === 1 ? "county" : "counties"}`, counties, missing: [],
  });
  return out;
}

/** What GET /api/crm/voice/counties?state=XX answers. */
export async function countiesForState(stateCode: string): Promise<{ counties: CountyRef[]; regions: ResolvedRegion[] }> {
  const counties = await listCounties(stateCode);
  return { counties, regions: resolveRegions(stateCode, counties) };
}

/**
 * Re-checks the county refs a profile carries against the table (a saved
 * profile may be edited by hand or restored from an old version). Refs whose
 * id is unknown or whose name/state moved are returned under `unknown`; the
 * caller decides whether to reject (PUT) or just warn (preview).
 */
/** The real rows for a set of ids (the picker sends bare `counties.id`s), keyed by id; unknown ids are absent. */
export async function countiesById(ids: number[]): Promise<Map<number, CountyRef>> {
  const want = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!want.length) return new Map();
  const { rows } = await db.execute(sql`select id, name, state_code from counties where id in (${sql.join(want.map((id) => sql`${id}`), sql`, `)})`);
  return new Map((rows as any[]).map((r) => [Number(r.id), { id: Number(r.id), name: String(r.name), stateCode: String(r.state_code) }]));
}

export async function verifyCountyRefs(refs: CountyRef[]): Promise<{ ok: CountyRef[]; unknown: CountyRef[] }> {
  if (!refs.length) return { ok: [], unknown: [] };
  const real = await countiesById(refs.map((r) => r.id));
  const ok: CountyRef[] = [], unknown: CountyRef[] = [];
  for (const r of refs) {
    const c = real.get(r.id);
    if (c && c.stateCode === r.stateCode) ok.push(c); else unknown.push(r);
  }
  return { ok, unknown };
}
