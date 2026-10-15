/**
 * Identifiers a report can search and cross-reference besides names: license numbers, phone numbers and street
 * addresses. Each normalizes to an index key, so "(206) 555-0142", "206.555.0142" and "+1 206 555 0142" are one
 * phone, and "123 N. Main St., Ste 4, Seattle WA 98101" and "123 MAIN STREET" are one address.
 *
 *   l:<license, letters and digits only>       e.g. l:CGC1512345
 *   t:<10-digit US phone>                      e.g. t:2065550142
 *   a:<house number> <first street word>       e.g. a:123 MAIN    (a PO box: a:POBOX 77); finds candidates only:
 *                                              addressMatches compares the whole street, suffix, direction, city and ZIP
 *   z:<5-digit ZIP>                            e.g. z:98101       (narrows an address search when it's given)
 */

export type IdKeys = { licenses?: (string | null | undefined)[]; phones?: (string | null | undefined)[]; addresses?: (string | null | undefined)[] };
export type IdQuery = { type: "license" | "phone" | "address"; value: string };

export function normLicense(v: string | null | undefined): string | null {
  const t = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t.length >= 3 && /\d/.test(t) ? t : null;
}

export function normPhone(v: string | null | undefined): string | null {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10 || /^(\d)\1+$/.test(d) || /^[01]/.test(d)) return null;
  return d;
}

const DIRECTIONS: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};
/** USPS street suffixes (Publication 28, the common ones) → their standard abbreviation. */
const STREET_TYPES: Record<string, string> = {
  ST: "ST", STREET: "ST", STR: "ST", AVE: "AVE", AVENUE: "AVE", AV: "AVE", RD: "RD", ROAD: "RD", DR: "DR", DRIVE: "DR",
  BLVD: "BLVD", BOULEVARD: "BLVD", LN: "LN", LANE: "LN", CT: "CT", COURT: "CT", CIR: "CIR", CIRCLE: "CIR", PL: "PL",
  PLACE: "PL", WAY: "WAY", PKWY: "PKWY", PARKWAY: "PKWY", HWY: "HWY", HIGHWAY: "HWY", TER: "TER", TERRACE: "TER",
  TRL: "TRL", TRAIL: "TRL", PIKE: "PIKE", TPKE: "TPKE", TURNPIKE: "TPKE", SQ: "SQ", SQUARE: "SQ", LOOP: "LOOP",
  ALY: "ALY", ALLEY: "ALY", PLZ: "PLZ", PLAZA: "PLZ", EXPY: "EXPY", EXPRESSWAY: "EXPY", FWY: "FWY", FREEWAY: "FWY",
  RTE: "RTE", ROUTE: "RTE", XING: "XING", CROSSING: "XING", PT: "PT", POINT: "PT", CV: "CV", COVE: "CV", RUN: "RUN",
  PATH: "PATH", ROW: "ROW", WALK: "WALK", HTS: "HTS", HEIGHTS: "HTS", CTR: "CTR", CENTER: "CTR", SPUR: "SPUR",
};
const UNIT = /^(?:STE|SUITE|APT|APARTMENT|UNIT|BLDG|BUILDING|FL|FLOOR|RM|ROOM|SPC|SPACE|LOT|DEPT|PMB|TRLR|#)$/;
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
const CITY_WORDS: Record<string, string> = { SAINT: "ST", MOUNT: "MT", FORT: "FT" };

/** A street address taken apart: house number, directions, street name words, suffix, city and ZIP (null: not given). */
export type AddressParts = {
  number: string; box: boolean; pre: string | null; name: string[]; type: string | null; post: string | null;
  city: string | null; state: string | null; zip: string | null;
};

/** Parses a free-form US street address; null when it has no house number (or PO box). */
export function parseAddress(v: string | null | undefined): AddressParts | null {
  const raw = (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const zips = Array.from(raw.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)).map((z) => z[1]);
  const zip = zips.length && !raw.startsWith(zips[zips.length - 1] + " ") && raw !== zips[zips.length - 1] ? zips[zips.length - 1] : null;
  const box = raw.match(/\bP\.?\s?O\.?\s?BOX\s+(\d+)/) ?? raw.match(/\bBOX\s+(\d+)/);
  if (box) return { number: box[1], box: true, pre: null, name: [], type: null, post: null, city: null, state: null, zip };
  // Commas mark the street's end when present ("123 Main, Springfield").
  const segs = raw.split(",").map((x) => x.replace(/[.#]/g, (c) => (c === "#" ? " # " : " ")).replace(/\s+/g, " ").trim()).filter(Boolean);
  // A hyphenated number ("251-21", Queens; "2200-B") is one building: kept whole.
  const m = (segs[0] ?? "").match(/^(\d+[A-Z]?(?:-(?:\d+[A-Z]?|[A-Z]))?)\s+(.+)$/);
  if (!m) return null;
  const words = m[2].split(" ");
  const rest = segs.slice(1).join(" ").split(" ").filter(Boolean);
  let i = 0;
  let pre: string | null = null;
  if (DIRECTIONS[words[0]] && words.length > 1) { pre = DIRECTIONS[words[0]]; i = 1; }
  const name: string[] = [];
  let type: string | null = null, post: string | null = null, typeAt = -1;
  // The suffix is a suffix word after at least one name word ("Court St": COURT is the name, ST the suffix).
  for (let j = i; j < words.length; j++) {
    if (UNIT.test(words[j])) break;
    if (j > i && STREET_TYPES[words[j]]) { type = STREET_TYPES[words[j]]; typeAt = j; break; }
    name.push(words[j]);
  }
  if (!name.length) return null;
  let tail: string[] = [];
  if (typeAt >= 0) {
    let k = typeAt + 1;
    // "Highway 50", "Route 9": the number belongs to the street.
    if ((type === "HWY" || type === "RTE") && /^\d+[A-Z]?$/.test(words[k] ?? "")) name.push(words[k++]);
    if (DIRECTIONS[words[k]]) post = DIRECTIONS[words[k++]];
    if (UNIT.test(words[k] ?? "")) k += 2;
    else if (/^#?\d+[A-Z]?$/.test(words[k] ?? "") && segs.length === 1) k += 1; // "123 Main St 4"
    tail = words.slice(k);
  } else if (segs.length > 1) {
    const u = name.findIndex((w) => UNIT.test(w));
    if (u >= 0) name.splice(u);
  } else {
    // No suffix and no comma: where the street ends is unknown, so only its first word is used.
    name.splice(1);
  }
  const cityWords: string[] = [];
  const all = [...tail, ...rest];
  for (let k = 0; k < all.length; k++) {
    if (UNIT.test(all[k])) { k++; continue; } // "Ste 4": the unit and its number
    if (/^\d{5}(?:-\d{4})?$/.test(all[k]) || (!cityWords.length && /^#?\d+[A-Z]?$/.test(all[k]))) continue;
    cityWords.push(all[k]);
  }
  let state: string | null = null;
  while (cityWords.length && (STATES.has(cityWords[cityWords.length - 1]) || /^\d+$/.test(cityWords[cityWords.length - 1]))) {
    const w = cityWords.pop()!;
    if (STATES.has(w)) state ??= w;
  }
  const city = (typeAt >= 0 || segs.length > 1) && cityWords.length ? cityWords.map((w) => CITY_WORDS[w] ?? w).join(" ") : null;
  return { number: m[1], box: false, pre, name, type, post, city, state: state && (typeAt >= 0 || segs.length > 1) ? state : null, zip };
}

/** The city, state and ZIP of an address without its street ("SEATTLE WA 98101"); null when none is readable. */
export function localityOf(v: string | null | undefined): string | null {
  const p = parseAddress(v);
  if (!p) return null;
  return [p.city, p.state, p.zip].filter(Boolean).join(" ") || null;
}

/** One canonical form of the street line: "123 N MAIN ST" (direction and suffix as USPS abbreviations). */
export function streetKey(v: string | null | undefined): string | null {
  const p = parseAddress(v);
  if (!p) return null;
  if (p.box) return `POBOX ${p.number}`;
  return [p.number, p.pre, ...p.name, p.type, p.post].filter(Boolean).join(" ");
}

/**
 * "a:" and "z:" keys of a street address; [] when it has no house number (a city alone is not an address). The "a:"
 * key (house number + first street word) only finds candidates in an index; addressMatches decides.
 */
export function addressKeys(v: string | null | undefined): string[] {
  const p = parseAddress(v);
  if (!p) return [];
  const out = [p.box ? `a:POBOX ${p.number}` : `a:${p.number} ${p.name[0]}`];
  if (p.zip) out.push(`z:${p.zip}`);
  return out;
}

/** Index keys for the identifiers of one record. */
export function idWords(keys: IdKeys | undefined): string[] {
  if (!keys) return [];
  const out = new Set<string>();
  for (const l of keys.licenses ?? []) { const n = normLicense(l); if (n) out.add(`l:${n}`); }
  for (const p of keys.phones ?? []) { const n = normPhone(p); if (n) out.add(`t:${n}`); }
  for (const a of keys.addresses ?? []) for (const k of addressKeys(a)) out.add(k);
  return Array.from(out);
}

/** The keys a query must all match ([] when the value isn't a usable identifier). */
export function queryWords(q: IdQuery): string[] {
  if (q.type === "license") { const n = normLicense(q.value); return n ? [`l:${n}`] : []; }
  if (q.type === "phone") { const n = normPhone(q.value); return n ? [`t:${n}`] : []; }
  return addressKeys(q.value);
}

/** A readable form of an identifier, for "related through …" notes. */
export function describeId(q: IdQuery): string {
  if (q.type === "phone") { const n = normPhone(q.value); return n ? `phone (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : `phone ${q.value}`; }
  if (q.type === "license") return `license number ${q.value}`;
  return `address ${q.value}`;
}

/**
 * A record's address is the query's (audit 2026-10-15, decision 6): same house number and street name; the same
 * suffix ("St" is not "Ave") and direction ("N" is not "S") when both give one; the same ZIP when both give one, and
 * the same city when both give one. A street without a suffix on one side is compared on the words it has.
 */
export function addressMatches(query: string, address: string | null | undefined): boolean {
  const q = parseAddress(query), a = parseAddress(address);
  if (!q || !a || q.box !== a.box || q.number !== a.number) return false;
  if (q.box) return !q.zip || !a.zip || q.zip === a.zip;
  const both = <T>(x: T | null, y: T | null) => x == null || y == null || x === y;
  if (!both(q.type, a.type) || !both(q.zip, a.zip) || !both(q.city, a.city)) return false;
  // A direction given on both sides must agree, wherever each puts it ("N Main St" = "Main St N").
  const qd = q.pre ?? q.post, ad = a.pre ?? a.post;
  if (!both(qd, ad)) return false;
  // Full names when both have a suffix (the street's end is known); otherwise the words the shorter one has.
  if (q.type && a.type) return q.name.join(" ") === a.name.join(" ");
  const n = Math.min(q.name.length, a.name.length);
  return q.name.slice(0, n).join(" ") === a.name.slice(0, n).join(" ");
}
