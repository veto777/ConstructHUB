/**
 * Which permit office serves a job in "<city>, <ST>"?
 *
 * The CRM Permits tab used to answer with `jurisdiction ILIKE '%<city>%'`, so a job in Austin, TX was shown the
 * office of Austin County, TX — a different, rural county 100 miles away (the city of Austin is in Travis County).
 * Roughly 1,500 places share their name with a county of the same state they are not in, and a substring also
 * pulled in "West Orange" for "Orange" and "Yorktown" for "York".
 *
 * A place is resolved only from facts on record, in this order, and otherwise to nothing:
 *   own     — the directory row whose name IS the place ("Austin, TX"), when it has a usable portal;
 *   routed  — the issuer named by the verified routing data (permit-routing.json → issued_by), by exact name;
 *   county  — the county that the place's own directory row sits in (all-cities.json's county, same state).
 * A county is never inferred from a shared name. Pure: the caller supplies the directory rows.
 */

export interface DirectoryRow {
  id: number;
  name: string;
  jurisdiction: string;
  jurisdictionType: string;
  countyId: number | null;
  /** The row's county, from the counties table (null when the join found none). */
  countyName: string | null;
  countyStateCode: string | null;
  portalUrl: string | null;
  searchUrl: string | null;
  isActive: boolean;
  linkStatus: string | null;
  lastVerifiedAt?: Date | string | null;
  issuedBy?: string | null;
  issuedBySource?: string | null;
}

export type PermitBasis = "own" | "routed" | "county" | "counties" | "none" | "unknown-place" | "no-city";

export interface PermitResolution {
  basis: PermitBasis;
  /** "Austin, TX" as typed on the project. */
  place: string;
  offices: DirectoryRow[];
  /** Counties the place is on record in (same state only). */
  counties: { id: number; name: string }[];
  issuedBy: string | null;
  issuedBySource: string | null;
  /** Plain-English account of what was matched and why — shown to the contractor. */
  note: string;
}

const USABLE = new Set(["live", "verified", "unconfirmed"]);

/** A row a contractor can be sent to: active, link checked, and an actual link. */
export function officeUsable(r: Pick<DirectoryRow, "isActive" | "linkStatus" | "portalUrl" | "searchUrl">): boolean {
  return r.isActive && USABLE.has(r.linkStatus || "") && !!(r.searchUrl || r.portalUrl);
}

/** "Saint Charles" / "St. Charles", "Mckinney" / "McKinney", "Coeur D Alene" / "Coeur d'Alene" → one key. */
export function looseKey(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]/g, "");
}

/** "Austin, TX" → { base: "Austin", stateCode: "TX" }; null when the string does not end in ", ST". */
export function splitJurisdiction(jurisdiction: string): { base: string; stateCode: string } | null {
  const m = jurisdiction.trim().match(/^(.*\S)\s*,\s*([A-Za-z]{2})$/);
  return m ? { base: m[1], stateCode: m[2].toUpperCase() } : null;
}

const CIVIC_PREFIX = /^(city|town|village) of\s+/i;

/**
 * The keys a typed city may be filed under. Whole-name equality only: "Austin" is "austin", never "austincounty".
 * "City of Austin" is also tried as "Austin".
 */
export function placeKeys(city: string): string[] {
  const typed = city.trim().replace(/\s*,\s*[A-Za-z]{2}$/, "");
  const keys = [looseKey(typed)];
  if (CIVIC_PREFIX.test(typed)) keys.push(looseKey(typed.replace(CIVIC_PREFIX, "")));
  return Array.from(new Set(keys.filter(Boolean)));
}

/** The keys a directory row answers to: its own name, and "Staunton" for the independent city "City of Staunton, VA". */
export function rowKeys(row: Pick<DirectoryRow, "jurisdiction">): string[] {
  const j = splitJurisdiction(row.jurisdiction);
  if (!j) return [];
  const keys = [looseKey(j.base)];
  if (CIVIC_PREFIX.test(j.base)) keys.push(looseKey(j.base.replace(CIVIC_PREFIX, "")));
  return keys;
}

/** Rows that ARE the typed place: same state, whole-name equality. */
export function rowsForPlace(city: string, stateCode: string, rows: DirectoryRow[]): DirectoryRow[] {
  const want = new Set(placeKeys(city));
  const st = stateCode.toUpperCase();
  return rows.filter((r) => splitJurisdiction(r.jurisdiction)?.stateCode === st && rowKeys(r).some((k) => want.has(k)));
}

function dedupe(rows: DirectoryRow[]): DirectoryRow[] {
  const seen = new Set<string>();
  return [...rows].sort((a, b) => a.id - b.id).filter((r) => {
    const k = `${r.jurisdiction}|${r.searchUrl || r.portalUrl}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

const list = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Resolve a job's city to permit offices. `rows` may be any superset of the relevant directory rows (a whole state
 * is fine); only rows reached by an exact name, an exact issued_by, or the place's own county id are ever returned.
 */
export function resolvePermitOffices(city: string, stateCode: string, rows: DirectoryRow[]): PermitResolution {
  const st = stateCode.toUpperCase();
  const typed = city.trim().replace(/\s*,\s*[A-Za-z]{2}$/, "");
  const place = [typed, st].filter(Boolean).join(", ");
  const empty = { place, offices: [] as DirectoryRow[], counties: [] as { id: number; name: string }[], issuedBy: null, issuedBySource: null };
  if (!typed) {
    return { ...empty, basis: "no-city", note: "Add a city to the project so its permit office can be matched. We don't list offices by state alone." };
  }
  const mine = rowsForPlace(typed, st, rows);
  if (!mine.length) {
    return { ...empty, basis: "unknown-place", note: `${place} is not in our permit directory under that name, so no office is shown rather than a guess.` };
  }

  // The counties this place is on record in. A row whose county is in another state is a bad seed row, not a fact.
  const countyMap = new Map<number, string>();
  for (const r of mine) {
    if (r.countyId != null && r.countyName && r.countyStateCode?.toUpperCase() === st) countyMap.set(r.countyId, r.countyName);
  }
  const counties = Array.from(countyMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // (a) its own office.
  const own = dedupe(mine.filter(officeUsable));
  if (own.length) {
    return { ...empty, counties, basis: "own", offices: own, note: `Permit office on record for ${own[0].jurisdiction}.` };
  }

  // (b) the issuer the verified routing data names — by exact name, in the same state.
  const routes = mine.filter((r) => r.issuedBy);
  for (const route of routes) {
    const issuer = route.issuedBy!;
    if (splitJurisdiction(issuer)?.stateCode !== st) continue;
    const issuers = rows.filter((r) => r.jurisdiction === issuer && officeUsable(r));
    if (issuers.length) {
      // A county row wins when a county and a city share the exact issuer string.
      const offices = dedupe(issuers.sort((a, b) => Number(b.jurisdictionType === "county") - Number(a.jurisdictionType === "county")));
      // Two facts on record can disagree (the routing source names one county, the city list another — often two
      // places with one name). The sourced route is shown, and the disagreement is said out loud.
      const ids = new Set(counties.map((c) => c.id));
      const elsewhere = counties.length > 0 && offices.every((o) => o.jurisdictionType === "county" && o.countyId != null && !ids.has(o.countyId));
      return {
        ...empty, counties, basis: "routed", offices, issuedBy: issuer, issuedBySource: route.issuedBySource || null,
        note: `Building permits for ${route.jurisdiction} are issued by ${issuer.replace(/, [A-Z]{2}$/, "")}.`
          + (elsewhere ? ` Our city records place ${typed} in ${list(counties.map((c) => c.name))} County, though — more than one place may share this name, so check which county the job address is in.` : ""),
      };
    }
  }

  // (c) the county the place itself is on record in — never a county that merely shares its name.
  const isCityPlace = mine.some((r) => r.jurisdictionType === "city");
  if (isCityPlace && counties.length) {
    const ids = new Set(counties.map((c) => c.id));
    const offices = dedupe(rows.filter((r) => r.jurisdictionType === "county" && r.countyId != null && ids.has(r.countyId)
      && r.countyStateCode?.toUpperCase() === st && splitJurisdiction(r.jurisdiction)?.stateCode === st && officeUsable(r)));
    const names = counties.map((c) => c.name);
    const label = (r: DirectoryRow) => r.jurisdiction.replace(/, [A-Z]{2}$/, "");
    if (offices.length && counties.length === 1) {
      return {
        ...empty, counties, basis: "county", offices,
        note: `We have no permit office on record for ${place} itself. Our records place it in ${label(offices[0])}, whose office is shown — confirm it covers addresses inside the ${typed} limits before you apply.`,
      };
    }
    if (offices.length) {
      return {
        ...empty, counties, basis: "counties", offices,
        note: `We have no permit office on record for ${place} itself, and our records place it in more than one county (${list(names)}). The offices on record for those counties are shown — use the one the job address is in, and confirm it covers addresses inside the ${typed} limits.`,
      };
    }
    return {
      ...empty, counties, basis: "none",
      note: `We have no permit office on record for ${place}, or for the ${names.length > 1 ? "counties" : "county"} our records place it in (${list(names)}). No office is shown rather than a guess.`,
    };
  }
  return { ...empty, counties, basis: "none", note: `We have no permit office on record for ${place}. No office is shown rather than a guess.` };
}

/** What the old matcher returned (`jurisdiction ILIKE '%city%'` within the state) — kept for the audit script and regression tests. */
export function legacySubstringMatch(city: string, stateCode: string, rows: DirectoryRow[]): DirectoryRow[] {
  const needle = city.trim().toLowerCase();
  const st = stateCode.toUpperCase();
  return rows.filter((r) => r.jurisdiction.trim().toUpperCase().endsWith(`, ${st}`) && r.isActive && USABLE.has(r.linkStatus || "")
    && r.jurisdiction.toLowerCase().includes(needle));
}
