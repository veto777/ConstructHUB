/**
 * Pure helpers for placing seeded city/county permit rows under the right county.
 *
 * server/data/all-cities.json carries a `countyId` computed against the old Replit
 * counties table. Those ids point at unrelated counties here (Glendale, CA landed in
 * Fairfield County, CT), so the county is always resolved from the JSON's own
 * county name + state code against this database's counties table instead.
 */

export interface CountyRef { id: number; name: string; stateCode: string }

export interface CountyIndex {
  exact: Map<string, number[]>;
  loose: Map<string, number[]>;
}

/** "Saint Louis" / "St. Louis", "De Kalb" / "DeKalb", "Yukon Koyukuk" / "Yukon-Koyukuk", "Doña Ana" / "Dona Ana" → one key. */
export function looseCountyKey(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // "Doña Ana" / "Dona Ana" → one key
    .toLowerCase()
    .trim()
    .replace(/^sainte\s+/, "ste ")
    .replace(/^saint\s+/, "st ")
    .replace(/[^a-z0-9]/g, "");
}

function push(map: Map<string, number[]>, key: string, id: number) {
  const list = map.get(key);
  if (list) list.push(id); else map.set(key, [id]);
}

export function buildCountyIndex(counties: CountyRef[]): CountyIndex {
  const exact = new Map<string, number[]>();
  const loose = new Map<string, number[]>();
  for (const c of counties) {
    push(exact, `${c.name.toLowerCase().trim()}|${c.stateCode}`, c.id);
    push(loose, `${looseCountyKey(c.name)}|${c.stateCode}`, c.id);
  }
  return { exact, loose };
}

/**
 * The county id for (county name, state code), or null when it cannot be matched to
 * exactly one county. Never guesses between two candidates.
 * Order: exact name → spelling-normalized name → an independent city ("Hampton City",
 * VA) stored under its bare name, when that bare name is unique in the state.
 */
export function resolveCountyId(index: CountyIndex, county: string, stateCode: string): number | null {
  const exact = index.exact.get(`${county.toLowerCase().trim()}|${stateCode}`);
  if (exact?.length === 1) return exact[0];
  const key = looseCountyKey(county);
  const loose = index.loose.get(`${key}|${stateCode}`);
  if (loose?.length === 1) return loose[0];
  if (key.endsWith("city") && key.length > 4) {
    const bare = index.loose.get(`${key.slice(0, -4)}|${stateCode}`);
    if (bare?.length === 1) return bare[0];
  }
  return null;
}

/** Text the old seeders wrote into every placeholder row — templated, not sourced. */
export function seededCityNote(city: { city: string; county: string; state: string }): string {
  return `Contact ${city.city} Building Department for permit information. Located in ${city.county} County, ${city.state}.`;
}

export function seededCountyNote(countyName: string): string {
  return `Contact ${countyName} County Building Department for permit information.`;
}
