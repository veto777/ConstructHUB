/**
 * Permit alert matching — pure functions over a normalized PermitRecord and a
 * watch's params. No DB, no network: server/permits/matching.test.ts covers it.
 */
import { createHash } from "node:crypto";
import { TRADES, type TradeKey, type WatchKind, type WatchParams } from "@shared/permit-alerts";
import type { PermitRecord } from "../scrapers/types";

// ── Address normalization ───────────────────────────────────────────────────
const STREET_WORDS: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", boulevard: "blvd", boul: "blvd", drive: "dr", driv: "dr",
  road: "rd", lane: "ln", court: "ct", circle: "cir", place: "pl", terrace: "ter", terr: "ter", parkway: "pkwy",
  highway: "hwy", trail: "trl", way: "way", loop: "loop", square: "sq", point: "pt", pike: "pike",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  apartment: "apt", suite: "ste", unit: "unit", building: "bldg", floor: "fl",
};
const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th",
  eighth: "8th", ninth: "9th", tenth: "10th",
};

/**
 * "123 North Main Street, Apt 4, Springfield" → "123 n main st apt 4 springfield".
 * Punctuation out, street words abbreviated, whitespace collapsed. Good enough for equality.
 */
export function normalizeAddress(input: string | null | undefined): string {
  if (!input) return "";
  const tokens = input
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_WORDS[t] ?? ORDINALS[t] ?? t);
  return tokens.join(" ");
}

/** The house number + street part only (before any unit/city), for a looser equality. */
export function streetKey(norm: string): string {
  const m = norm.match(/^(\d+[a-z]?)\s+(.+?)(?:\s+(?:apt|ste|unit|bldg|fl)\b.*)?$/);
  if (!m) return norm;
  // Drop a trailing city/state tail after a street suffix when present.
  const words = m[2].split(" ");
  const suffixes = new Set(Object.values(STREET_WORDS));
  const idx = words.findIndex((w, i) => i > 0 && suffixes.has(w));
  const street = idx >= 0 ? words.slice(0, idx + 1).join(" ") : m[2];
  return `${m[1]} ${street}`;
}

export function addressesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeAddress(a), nb = normalizeAddress(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ka = streetKey(na), kb = streetKey(nb);
  return ka.length > 3 && ka === kb;
}

export function normalizeParcel(p: string | null | undefined): string {
  return (p ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Contractor names ────────────────────────────────────────────────────────
const CORP_WORDS = new Set(["llc", "inc", "co", "corp", "corporation", "company", "ltd", "the", "and", "&", "dba", "of", "lp", "llp", "pllc", "pc", "services", "service", "construction", "contractors", "contractor", "contracting", "group", "enterprises", "enterprise"]);
export function normalizeName(n: string | null | undefined): string[] {
  if (!n) return [];
  return n.toLowerCase().replace(/[^a-z0-9&\s]/g, " ").split(/\s+/).filter((w) => w && !CORP_WORDS.has(w));
}
export function normalizeLicense(l: string | null | undefined): string {
  return (l ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when the watch's contractor name/license is the permit's, allowing for LLC/Inc noise and word order. */
export function contractorMatches(params: Pick<WatchParams, "contractorName" | "contractorLicense">, permit: Pick<PermitRecord, "contractorName" | "contractorLicense" | "applicantName">): boolean {
  const lic = normalizeLicense(params.contractorLicense);
  if (lic && normalizeLicense(permit.contractorLicense) === lic) return true;
  const want = normalizeName(params.contractorName);
  if (!want.length) return false;
  for (const candidate of [permit.contractorName, permit.applicantName]) {
    const have = normalizeName(candidate);
    if (!have.length) continue;
    const haveSet = new Set(have);
    const overlap = want.filter((w) => haveSet.has(w)).length;
    // Every significant word of the watch's name present (one-word names must match exactly).
    if (overlap === want.length && (want.length > 1 || have.length === 1)) return true;
    // Or the full normalized strings are equal after corp-word stripping.
    if (want.join(" ") === have.join(" ")) return true;
  }
  return false;
}

// ── Trades ──────────────────────────────────────────────────────────────────
export function tradeKeywords(trades: readonly TradeKey[] | undefined): string[] {
  const out: string[] = [];
  for (const t of trades ?? []) {
    const def = TRADES.find((d) => d.key === t);
    if (def) out.push(...def.keywords);
  }
  return out;
}

/** Which trade keys / keywords the permit's text contains. */
export function matchedTrades(params: Pick<WatchParams, "trades" | "keywords">, permit: Pick<PermitRecord, "permitType" | "workClass" | "description">): string[] {
  const text = ` ${[permit.permitType, permit.workClass, permit.description].filter(Boolean).join(" | ").toLowerCase()} `;
  if (!text.trim()) return [];
  const hits: string[] = [];
  for (const t of params.trades ?? []) {
    const def = TRADES.find((d) => d.key === t);
    if (def && def.keywords.some((k) => text.includes(k.toLowerCase()))) hits.push(def.label);
  }
  for (const k of params.keywords ?? []) {
    const kw = k.trim().toLowerCase();
    if (kw && text.includes(kw)) hits.push(k.trim());
  }
  return Array.from(new Set(hits));
}

// ── Geometry ────────────────────────────────────────────────────────────────
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── The decision ────────────────────────────────────────────────────────────
export type MatchInput = { kind: WatchKind; params: WatchParams };
export type MatchResult = { matched: true; reason: string } | { matched: false };

/**
 * Does this permit belong in the watch's digest? `permit` is one the poller already scoped to the watch's
 * jurisdictions (database_ids), so jurisdiction membership is not re-checked here.
 */
export function matchWatch(watch: MatchInput, permit: PermitRecord): MatchResult {
  const p = watch.params ?? {};
  switch (watch.kind) {
    case "address": {
      if (p.parcel && permit.parcel && normalizeParcel(p.parcel) === normalizeParcel(permit.parcel)) return { matched: true, reason: `Parcel ${permit.parcel}` };
      if (p.address && addressesMatch(p.address, permit.address)) return { matched: true, reason: `Address ${permit.address}` };
      return { matched: false };
    }
    case "parcel": {
      if (p.parcel && permit.parcel && normalizeParcel(p.parcel) === normalizeParcel(permit.parcel)) return { matched: true, reason: `Parcel ${permit.parcel}` };
      return { matched: false };
    }
    case "contractor": {
      if (contractorMatches(p, permit)) return { matched: true, reason: `Contractor ${permit.contractorName ?? permit.contractorLicense ?? permit.applicantName}` };
      return { matched: false };
    }
    case "trade_area": {
      const trades = matchedTrades(p, permit);
      // No trades chosen = every permit in the area.
      const anyTrade = !(p.trades?.length || p.keywords?.length);
      if (!anyTrade && !trades.length) return { matched: false };
      const hasCenter = typeof p.lat === "number" && typeof p.lng === "number" && (p.radiusMiles ?? 0) > 0;
      if (hasCenter && typeof permit.lat === "number" && typeof permit.lng === "number") {
        const miles = haversineMiles(p.lat!, p.lng!, permit.lat, permit.lng);
        if (miles > (p.radiusMiles as number)) return { matched: false };
        return { matched: true, reason: `${trades.length ? trades.join(", ") : "Permit"} · ${miles.toFixed(1)} mi away` };
      }
      // No coordinates on one side: the watch's jurisdictions are the area.
      return { matched: true, reason: `${trades.length ? trades.join(", ") : "Permit"} in ${permit.jurisdiction}` };
    }
    default:
      return { matched: false };
  }
}

/** A stable hash of the fields a change of which is worth re-checking a permit for. */
export function contentHash(r: PermitRecord): string {
  const h = createHash("sha1");
  h.update(JSON.stringify([
    r.permitNumber, r.address ?? null, r.parcel ?? null, r.permitType ?? null, r.workClass ?? null,
    r.description ?? null, r.status ?? null, r.issuedAt ?? null, r.appliedAt ?? null, r.expiresAt ?? null,
    r.valuation ?? null, r.contractorName ?? null, r.contractorLicense ?? null, r.applicantName ?? null, r.ownerName ?? null,
  ]));
  return h.digest("hex");
}
