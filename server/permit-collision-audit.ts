/**
 * Audit of the "city shares its name with a county it is not in" class (Austin, TX is in Travis County, not
 * Austin County) for the CRM permit matcher — see permit-jurisdiction.ts.
 *
 * Works on the data the app ships (server/data/all-cities.json, permit-portals.json, permit-routing.json) so it
 * needs no database; scripts/audit-city-county-collisions.ts can also run it over a real directory (--db).
 * Read-only: nothing here writes data.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  legacySubstringMatch, looseKey, officeUsable, placeKeys, resolvePermitOffices, rowKeys, rowsForPlace, splitJurisdiction,
  type DirectoryRow, type PermitResolution,
} from "./permit-jurisdiction";

const COUNTY_LIKE = /^(.*) (County|Parish|Borough|Census Area|Municipality|City and Borough)$/;

/** "Austin County" → "Austin"; "City of Staunton" (a Virginia independent city) → "Staunton"; a plain city → null. */
export function countyNameOf(base: string): string | null {
  const m = base.match(COUNTY_LIKE);
  if (m) return m[1];
  return /^City of /.test(base) ? base.replace(/^City of /, "") : null;
}

type City = { city: string; county: string; stateCode: string };
type Portal = { jurisdiction: string; url: string | null; linkStatus?: string };
type Route = { jurisdiction: string; issuedBy: string; sourceUrl: string };

/** The permit directory as the seed data describes it (one city row per county a city lies in, like the seeder). */
export function seedDirectoryRows(dataDir = join(process.cwd(), "server", "data")): DirectoryRow[] {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  const cities = read<City[]>("all-cities.json");
  const portals = read<Portal[]>("permit-portals.json");
  const routes = read<Route[]>("permit-routing.json");

  const countyIds = new Map<string, number>();
  const countyId = (name: string, st: string) => {
    const k = `${looseKey(name)}|${st}`;
    if (!countyIds.has(k)) countyIds.set(k, countyIds.size + 1);
    return countyIds.get(k)!;
  };
  const portalBy = new Map(portals.map((p) => [p.jurisdiction, p]));
  // The seeder also applies a portal to the one city row with the same letters ("Mckinney, TX" ← "McKinney, TX").
  const cityPortalLoose = new Map<string, Portal[]>();
  for (const p of portals) {
    const j = splitJurisdiction(p.jurisdiction);
    if (!j || countyNameOf(j.base)) continue;
    const k = `${looseKey(j.base)}|${j.stateCode}`;
    cityPortalLoose.set(k, [...(cityPortalLoose.get(k) || []), p]);
  }
  const routeBy = new Map(routes.map((r) => [r.jurisdiction, r]));
  const link = (p?: Portal) => ({
    portalUrl: p?.url ?? null, searchUrl: p?.url ?? null,
    isActive: !!p?.url && ["live", "verified", "unconfirmed"].includes(p?.linkStatus || ""),
    linkStatus: p?.url ? (p.linkStatus || "unchecked") : "none",
  });

  const rows: DirectoryRow[] = [];
  let id = 0;
  const seen = new Set<string>();
  for (const c of cities) {
    const jurisdiction = `${c.city}, ${c.stateCode}`;
    const loose = cityPortalLoose.get(`${looseKey(c.city)}|${c.stateCode}`);
    const p = portalBy.get(jurisdiction) ?? (loose?.length === 1 ? loose[0] : undefined);
    const name = p?.jurisdiction ?? jurisdiction;
    const r = routeBy.get(name) ?? routeBy.get(jurisdiction);
    rows.push({
      id: ++id, name, jurisdiction: name, jurisdictionType: "city",
      countyId: countyId(c.county, c.stateCode), countyName: c.county, countyStateCode: c.stateCode,
      ...link(p), issuedBy: r?.issuedBy ?? null, issuedBySource: r?.sourceUrl ?? null,
    });
    seen.add(name);
  }
  for (const p of portals) {
    if (seen.has(p.jurisdiction)) continue;
    const j = splitJurisdiction(p.jurisdiction);
    if (!j) continue;
    const county = countyNameOf(j.base);
    const r = routeBy.get(p.jurisdiction);
    rows.push({
      id: ++id, name: p.jurisdiction, jurisdiction: p.jurisdiction, jurisdictionType: county ? "county" : "city",
      countyId: county ? countyId(county, j.stateCode) : null, countyName: county, countyStateCode: county ? j.stateCode : null,
      ...link(p), issuedBy: r?.issuedBy ?? null, issuedBySource: r?.sourceUrl ?? null,
    });
  }
  return rows;
}

export interface CollisionCase {
  city: string;
  stateCode: string;
  /** The same-named county's row, e.g. "Austin County, TX". */
  sameNameCounty: string;
  sameNameCountyUsable: boolean;
  /** Counties the city is on record in. */
  actualCounties: string[];
  /** true when the city really is in the county that shares its name (Dallas, TX in Dallas County). */
  inSameNameCounty: boolean;
  routedTo: string | null;
  legacy: string[];
  legacyReturnedSameNameCounty: boolean;
  now: { basis: PermitResolution["basis"]; offices: string[] };
  /** true when the same-named county is (still) returned although nothing on record ties the city to it. */
  wrongNow: boolean;
  wrongBefore: boolean;
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

function byState(rows: DirectoryRow[]): Map<string, DirectoryRow[]> {
  const m = new Map<string, DirectoryRow[]>();
  for (const r of rows) {
    const st = splitJurisdiction(r.jurisdiction)?.stateCode;
    if (!st) continue;
    const l = m.get(st); if (l) l.push(r); else m.set(st, [r]);
  }
  return m;
}

/** Per-state lookup so the audit is not cities × rows: the rows a resolution can reach (the place, its issuers, the state's counties). */
function stateIndex(stateRows: DirectoryRow[]) {
  const byKey = new Map<string, DirectoryRow[]>();
  const byName = new Map<string, DirectoryRow[]>();
  const add = (m: Map<string, DirectoryRow[]>, k: string, r: DirectoryRow) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const r of stateRows) { for (const k of rowKeys(r)) add(byKey, k, r); add(byName, r.jurisdiction, r); }
  const countyRows = stateRows.filter((r) => r.jurisdictionType === "county");
  return (city: string): DirectoryRow[] => {
    const mine = placeKeys(city).flatMap((k) => byKey.get(k) || []);
    const issuers = mine.flatMap((r) => (r.issuedBy ? byName.get(r.issuedBy) || [] : []));
    return Array.from(new Set([...mine, ...issuers, ...countyRows]));
  };
}

/** Every city whose name equals a county's name in the same state, with what the old and new matchers return. */
export function enumerateCollisions(rows: DirectoryRow[]): CollisionCase[] {
  const out: CollisionCase[] = [];
  for (const [st, stateRows] of byState(rows)) {
    const countyRows = new Map<string, DirectoryRow[]>();
    for (const r of stateRows) {
      if (r.jurisdictionType !== "county") continue;
      const name = countyNameOf(splitJurisdiction(r.jurisdiction)!.base);
      // "City of X, VA" is the city X itself, not a county that merely shares its name.
      if (!name || /^City of /.test(r.jurisdiction)) continue;
      const k = looseKey(name);
      countyRows.set(k, [...(countyRows.get(k) || []), r]);
    }
    const cityNames = new Map<string, string>();
    for (const r of stateRows) if (r.jurisdictionType === "city") cityNames.set(looseKey(splitJurisdiction(r.jurisdiction)!.base), splitJurisdiction(r.jurisdiction)!.base);
    const reach = stateIndex(stateRows);
    for (const [key, city] of cityNames) {
      const same = countyRows.get(key);
      if (!same) continue;
      const mine = rowsForPlace(city, st, reach(city)).filter((r) => r.jurisdictionType === "city");
      const actual = uniq(mine.filter((r) => r.countyName && r.countyStateCode === st).map((r) => r.countyName!));
      const inSame = actual.some((c) => looseKey(c) === key);
      const routedTo = mine.find((r) => r.issuedBy)?.issuedBy ?? null;
      const sameNames = new Set(same.map((r) => r.jurisdiction));
      const legacy = legacySubstringMatch(city, st, stateRows);
      const now = resolvePermitOffices(city, st, reach(city));
      const justified = inSame || (routedTo !== null && sameNames.has(routedTo));
      const legacyHit = legacy.some((r) => sameNames.has(r.jurisdiction));
      out.push({
        city, stateCode: st, sameNameCounty: same[0].jurisdiction, sameNameCountyUsable: same.some(officeUsable),
        actualCounties: actual, inSameNameCounty: inSame, routedTo,
        legacy: uniq(legacy.map((r) => r.jurisdiction)), legacyReturnedSameNameCounty: legacyHit,
        now: { basis: now.basis, offices: uniq(now.offices.map((r) => r.jurisdiction)) },
        wrongBefore: legacyHit && !justified,
        wrongNow: now.offices.some((r) => sameNames.has(r.jurisdiction)) && !justified,
      });
    }
  }
  return out.sort((a, b) => `${a.stateCode}${a.city}`.localeCompare(`${b.stateCode}${b.city}`));
}

export interface ExposureSummary {
  cities: number;
  /** Cities for which the old substring match returned at least one usable office. */
  legacyAnswered: number;
  /** …and at least one of those offices was a different place (not the city, its routed issuer, or its own county). */
  legacyReturnedAnotherPlace: number;
  /** …specifically a county office of a county the city is not on record in. */
  legacyReturnedWrongCounty: number;
  /** The new matcher returning any office not reachable by exact name / routing / own county — must be 0. */
  nowReturnedAnotherPlace: number;
  nowByBasis: Record<string, number>;
}

/** How many cities the old substring match sent to some other place's office (the whole class, not only same-name counties). */
export function summariseExposure(rows: DirectoryRow[]): ExposureSummary {
  const s: ExposureSummary = { cities: 0, legacyAnswered: 0, legacyReturnedAnotherPlace: 0, legacyReturnedWrongCounty: 0, nowReturnedAnotherPlace: 0, nowByBasis: {} };
  for (const [st, stateRows] of byState(rows)) {
    const cityNames = new Map<string, string>();
    for (const r of stateRows) if (r.jurisdictionType === "city") cityNames.set(looseKey(splitJurisdiction(r.jurisdiction)!.base), splitJurisdiction(r.jurisdiction)!.base);
    // One pass per state for the substring match instead of cities × rows string scans on the hot path.
    const usable = stateRows.filter((r) => r.isActive && ["live", "verified", "unconfirmed"].includes(r.linkStatus || ""))
      .map((r) => ({ r, lower: r.jurisdiction.toLowerCase() }));
    const reach = stateIndex(stateRows);
    for (const city of cityNames.values()) {
      s.cities++;
      const mine = rowsForPlace(city, st, reach(city));
      const ownIds = new Set(mine.map((r) => r.id));
      const issuers = new Set(mine.map((r) => r.issuedBy).filter(Boolean) as string[]);
      const ownCounties = new Set(mine.filter((r) => r.countyId != null && r.countyStateCode === st).map((r) => r.countyId!));
      const legit = (r: DirectoryRow) => ownIds.has(r.id) || issuers.has(r.jurisdiction)
        || (r.jurisdictionType === "county" && r.countyId != null && ownCounties.has(r.countyId));
      const needle = city.toLowerCase();
      const legacy = usable.filter((u) => u.lower.includes(needle)).map((u) => u.r);
      if (legacy.length) s.legacyAnswered++;
      const other = legacy.filter((r) => !legit(r));
      if (other.length) s.legacyReturnedAnotherPlace++;
      if (other.some((r) => r.jurisdictionType === "county")) s.legacyReturnedWrongCounty++;
      const now = resolvePermitOffices(city, st, reach(city));
      s.nowByBasis[now.basis] = (s.nowByBasis[now.basis] || 0) + 1;
      if (now.offices.some((r) => !legit(r))) s.nowReturnedAnotherPlace++;
    }
  }
  return s;
}

/** Routes that send a place to the county sharing its name while the city data puts the place in another county. */
export function suspectRoutes(rows: DirectoryRow[]): { jurisdiction: string; issuedBy: string; onRecordIn: string[] }[] {
  const out: { jurisdiction: string; issuedBy: string; onRecordIn: string[] }[] = [];
  const countiesOf = new Map<string, string[]>();
  for (const x of rows) {
    const st = splitJurisdiction(x.jurisdiction)?.stateCode;
    if (x.jurisdictionType !== "city" || !x.countyName || x.countyStateCode !== st) continue;
    countiesOf.set(x.jurisdiction, uniq([...(countiesOf.get(x.jurisdiction) || []), x.countyName]));
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.jurisdictionType !== "city" || !r.issuedBy || seen.has(r.jurisdiction)) continue;
    seen.add(r.jurisdiction);
    const issuer = splitJurisdiction(r.issuedBy);
    const issuerCounty = issuer ? countyNameOf(issuer.base) : null;
    if (!issuer || !issuerCounty || /^City of /.test(issuer.base)) continue;
    const onRecordIn = countiesOf.get(r.jurisdiction) || [];
    if (onRecordIn.length && !onRecordIn.some((c) => looseKey(c) === looseKey(issuerCounty))) out.push({ jurisdiction: r.jurisdiction, issuedBy: r.issuedBy, onRecordIn });
  }
  return out;
}
