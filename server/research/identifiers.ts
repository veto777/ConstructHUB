/**
 * Identifiers a report can search and cross-reference besides names: license numbers, phone numbers and street
 * addresses. Each normalizes to an index key, so "(206) 555-0142", "206.555.0142" and "+1 206 555 0142" are one
 * phone, and "123 N. Main St., Ste 4, Seattle WA 98101" and "123 MAIN STREET" are one address.
 *
 *   l:<license, letters and digits only>       e.g. l:CGC1512345
 *   t:<10-digit US phone>                      e.g. t:2065550142
 *   a:<house number> <first street word>       e.g. a:123 MAIN    (a PO box: a:POBOX 77)
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

const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST", "NORTHEAST", "NORTHWEST", "SOUTHEAST", "SOUTHWEST"]);

/** "a:" and "z:" keys of a street address; [] when it has no house number (a city alone is not an address). */
export function addressKeys(v: string | null | undefined): string[] {
  const t = (v ?? "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  const box = t.match(/\bP\s?O\s?BOX\s+(\d+)/) ?? t.match(/\bBOX\s+(\d+)/);
  if (box) out.push(`a:POBOX ${box[1]}`);
  else {
    // A hyphenated number ("251-21", Queens) is one building: kept whole.
    const m = t.match(/^(\d+[A-Z]?(?:-(?:\d+[A-Z]?|[A-Z]))?)\s+(.+)$/);
    if (m) {
      const word = m[2].split(" ").find((w) => !DIRECTIONS.has(w) && /[A-Z0-9]/.test(w));
      if (word) out.push(`a:${m[1]} ${word}`);
    }
  }
  if (!out.length) return [];
  const zips = Array.from(t.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)).map((z) => z[1]);
  const zip = zips.length && !t.startsWith(zips[zips.length - 1] + " ") ? zips[zips.length - 1] : null;
  if (zip) out.push(`z:${zip}`);
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

/** A record's address is the query's: same house number and street word, and the same ZIP when both have one. */
export function addressMatches(query: string, address: string | null | undefined): boolean {
  const q = addressKeys(query), a = addressKeys(address);
  const qa = q.find((k) => k.startsWith("a:")), aa = a.find((k) => k.startsWith("a:"));
  if (!qa || qa !== aa) return false;
  const qz = q.find((k) => k.startsWith("z:")), az = a.find((k) => k.startsWith("z:"));
  return !qz || !az || qz === az;
}
