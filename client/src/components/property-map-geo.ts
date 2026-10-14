/**
 * Pure geography for the Property records county map (components/property-map.tsx).
 *
 * Offices are joined to us-atlas county shapes (client/public/us-counties-10m.json, us-atlas 3.0.1 =
 * Census cartographic boundaries) by REAL identifiers only: the state's FIPS code (from its USPS code)
 * plus the county name, normalised. Nothing is guessed: an office whose name has no single county of
 * that name in its state stays unmatched and is shown in the list only.
 *
 * Name rules (each one a fact about how the two sources spell the same place):
 *  - case, accents (Doña Ana), punctuation and spaces are ignored (Prince Georges = Prince George's,
 *    DeKalb = De Kalb, LaSalle = La Salle);
 *  - "St." / "St" = "Saint" and "Ste." = "Sainte" (Ste. Genevieve);
 *  - a trailing County / Parish / Borough / Census Area / Municipality / City and Borough is dropped
 *    (us-atlas names carry no suffix; the counties table stores Juneau/Sitka/Wrangell/Yakutat as
 *    "<name> City and", a truncated "City and Borough");
 *  - independent cities (FIPS county code 510 and up: Virginia's cities, Baltimore, St. Louis, Carson
 *    City) share a name with a county in four places (Richmond, Roanoke, Franklin, Fairfax VA, plus
 *    Baltimore MD and St. Louis MO). "<name> City" means the city; a bare name means the county. Charles
 *    City and James City are counties and match by their full name first.
 * Not handled, on purpose: an Alaska "(City of)" office is a city inside a borough, a New England town
 * is not a county, a split-district office ("Arkansas (Northern District)") is part of one, and the 2019
 * Chugach / Copper River census areas and Connecticut's 2022 planning regions have no shape in this
 * vintage of the atlas (it still draws Valdez-Cordova and the eight old Connecticut counties).
 */
import { FIPS_USPS } from "./permit-map-geo";

/** USPS code -> state FIPS, for the 50 states and DC the map can draw. */
export const USPS_FIPS: Record<string, string> = Object.fromEntries(Object.entries(FIPS_USPS).map(([fips, usps]) => [usps, fips]));

const SUFFIX = /\s+(county|parish|borough|census area|municipality|city and borough|city and)$/;

/** A county name reduced to the letters and digits both sources agree on. */
export function normalizeCountyName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bste\.?(?=\s)/g, "sainte")
    .replace(/\bst\.?(?=\s)/g, "saint")
    .replace(/\s+/g, " ").trim()
    .replace(SUFFIX, "")
    .replace(/[^a-z0-9]/g, "");
}

/** A shape's join keys: its 5-digit FIPS id and its name. */
export interface CountyShape { id: string; name: string }

/** stateFips -> normalised name -> FIPS ids with that name (more than one only where a city shares a county's name). */
export type CountyIndex = Map<string, Map<string, string[]>>;

export function buildCountyIndex(shapes: CountyShape[]): CountyIndex {
  const index: CountyIndex = new Map();
  for (const s of shapes) {
    if (!/^\d{5}$/.test(s.id) || !s.name) continue;
    const st = s.id.slice(0, 2);
    if (!FIPS_USPS[st]) continue; // territories: geoAlbersUsa cannot draw them
    let byName = index.get(st);
    if (!byName) index.set(st, (byName = new Map()));
    const key = normalizeCountyName(s.name);
    byName.set(key, [...(byName.get(key) ?? []), s.id]);
  }
  return index;
}

const isIndependentCity = (fips: string) => Number(fips.slice(2)) >= 510;

/** The FIPS id of the one county shape this (state, county name) names, or null. */
export function matchCountyFips(index: CountyIndex, stateCode: string | null | undefined, countyName: string | null | undefined): string | null {
  const st = stateCode ? USPS_FIPS[stateCode.toUpperCase()] : undefined;
  if (!st || !countyName) return null;
  const byName = index.get(st);
  if (!byName) return null;
  const key = normalizeCountyName(countyName);
  if (!key) return null;
  const exact = byName.get(key) ?? [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    // A bare name shared by a county and an independent city names the county.
    const counties = exact.filter((id) => !isIndependentCity(id));
    return counties.length === 1 ? counties[0] : null;
  }
  // "<name> City": the independent city of that name.
  if (key.endsWith("city")) {
    const cities = (byName.get(key.slice(0, -4)) ?? []).filter(isIndependentCity);
    if (cities.length === 1) return cities[0];
  }
  return null;
}

/**
 * What a county gets shaded by. Mirrors the list row exactly (pages/property.tsx PropertyOfficeRow):
 * "site" when the row shows an Open portal / Search records pill, "phone" when it shows only Call, and
 * "none" when only the honest web-search fallback is left.
 */
export type OfficeShade = "site" | "phone" | "none";
export const SHADE_RANK: Record<OfficeShade, number> = { none: 0, phone: 1, site: 2 };

/**
 * New England assesses property by town, not county (Connecticut has had no county government since
 * 1960 and its census units are now planning regions). The offices we hold there are town assessors
 * filed under a same-named county row ("Worcester Township Assessor" on Worcester County), so shading the
 * county would claim the whole county is covered by one town's site. These states stay list-only.
 */
export const TOWN_ASSESSED_STATES = new Set(["CT", "MA", "ME", "NH", "RI", "VT"]);

/** "Richmond County", "Richmond (city)", "Orleans Parish", "Juneau" (Alaska keeps its own names). */
export function countyDisplayName(fips: string, name: string): string {
  const usps = FIPS_USPS[fips.slice(0, 2)];
  if (usps === "AK" || usps === "DC" || /city$/i.test(name)) return name;
  if (isIndependentCity(fips)) return `${name} (city)`;
  return `${name} ${usps === "LA" ? "Parish" : "County"}`;
}

export type MapOffice = { county?: { name: string; stateCode: string } | null };
export interface CountyCoverage<T> { offices: T[]; shade: OfficeShade }
export interface CoverageSummary<T> {
  /** FIPS -> the offices on that county shape and its best shade. */
  byFips: Map<string, CountyCoverage<T>>;
  /** Offices whose county name matches no single shape: list only. */
  unmatched: T[];
  /** Offices in TOWN_ASSESSED_STATES: list only, by design. */
  townAssessed: T[];
}

export function summarizeCoverage<T extends MapOffice>(offices: T[], index: CountyIndex, shadeOf: (o: T) => OfficeShade): CoverageSummary<T> {
  const byFips = new Map<string, CountyCoverage<T>>();
  const unmatched: T[] = [], townAssessed: T[] = [];
  for (const o of offices) {
    const st = o.county?.stateCode?.toUpperCase();
    if (st && TOWN_ASSESSED_STATES.has(st)) { townAssessed.push(o); continue; }
    const fips = matchCountyFips(index, st, o.county?.name);
    if (!fips) { unmatched.push(o); continue; }
    const shade = shadeOf(o);
    const c = byFips.get(fips);
    if (!c) byFips.set(fips, { offices: [o], shade });
    else { c.offices.push(o); if (SHADE_RANK[shade] > SHADE_RANK[c.shade]) c.shade = shade; }
  }
  return { byFips, unmatched, townAssessed };
}
