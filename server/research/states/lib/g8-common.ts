/**
 * Small helpers shared by the g8 state packs (OR, WA, MT, WY, AK, HI). No source data lives here.
 */
import { flipPerson } from "../../person-name";
import { politeFetch } from "../../http";
import { clean } from "../../bulk";
import { tokens } from "../../licenses";
import { looksLikeBusiness as sharedLooksLikeBusiness } from "./business-name";

/** Every word of the searched name is a whole word of one of the fields (the same rule as ../../records namedIn). */
export function nameMatches(name: string, ...fields: (string | null | undefined)[]): boolean {
  const want = tokens(name);
  return want.length > 0 && fields.some((f) => { const have = new Set(tokens(f ?? "")); return want.every((w) => have.has(w)); });
}

/** JSON over politeFetch; a non-2xx answer is an error (never an empty result). */
export async function fetchJson<T = any>(url: string, init: RequestInit = {}, label = "Source", minDelayMs = 1000): Promise<T> {
  const res = await politeFetch(url, init, { minDelayMs });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`${label} returned an unexpected payload`); }
}

export const postJson = <T = any>(url: string, body: unknown, label: string, minDelayMs = 1000, headers: Record<string, string> = {}) =>
  fetchJson<T>(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json; charset=utf-8", accept: "application/json", ...headers } }, label, minDelayMs);

/**
 * "MM/DD/YYYY" (any time after it ignored) or "YYYY-MM-DD…" → YYYY-MM-DD; anything else → null. A two-digit year
 * ("M-D-YY") is null: its century would be a guess (round 2, decision 13).
 */
export function anyDay(v: unknown): string | null {
  const s = clean(v == null ? null : String(v));
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]) >= 1900 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return Number(m[3]) >= 1900 ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
  return null;
}

/** A positive dollar amount, else null. */
export const money = (v: unknown): number | null => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null; };
export const usd = (n: number | null) => (n == null ? null : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** "LAST, FIRST M" → "FIRST M LAST" (names without a comma are returned as given). */
export function flip(v: string | null | undefined): string | null {
  return flipPerson(v);
}

/**
 * A business name in a list that mixes companies and people (debarment and discipline lists name both): the shared
 * rule of ./business-name.ts (a corporate suffix, "& Sons", a dba form or a trade word that is not a surname; audit
 * 2026-10-15, decision 5), plus a few trade words these lists use. Used only to decide which names are indexed for
 * company searches; a name without one is treated as a person and is never indexed (companies only, FCRA).
 */
const EXTRA = /\b(?:FLAGGING|JANITORIAL|CREATIONS|PARTNERS|PARTNERSHIP)\b/i;
export const looksLikeBusiness = (v: string | null | undefined): boolean => !!v && (sharedLooksLikeBusiness(v) || EXTRA.test(v));
/** The same, for a piece split out of a longer line: a lone word ("John" of "John and Mary Smith") is not a trade name. */
const pieceIsBusiness = (v: string): boolean => /\s/.test(v.trim()) ? looksLikeBusiness(v) : looksLikeBusiness(`x ${v}`);

const SUFFIX_ONLY = /^(L\.?\s?L\.?\s?C\.?|INC\.?|CORP\.?|LTD\.?|CO\.?|LLP\.?|L\.?P\.?|PLLC\.?)$/i;

/**
 * The business names in a respondent line like "Acme LLC dba Acme Roofing and John Q. Smith": people are dropped
 * ("John Q. Smith"), trade names after "dba" are kept. A line with no person in it comes back whole.
 */
export function businessParts(v: string | null | undefined): string[] {
  const whole = clean((v ?? "").replace(/\*/g, "").replace(/\s*\((?:Hawai[^)]*|Maui|O[^)]*ahu|Kauai|Kaua[^)]*|Molokai|Moloka[^)]*|Lanai|L[^)]*na[^)]*i|Big Island)\)\s*$/i, ""));
  if (!whole) return [];
  // "Smith and Sons", "Jones & Associates": one business, not two parties.
  const raw = whole.replace(/\s+(?:and|&)\s+(?=(?:sons?|daughters?|associates|company|co)\b)/gi, " & ").split(/\s+and\s+|,\s+|;\s*/);
  const segs: string[] = [];
  for (const p of raw) {
    if (segs.length && SUFFIX_ONLY.test(p.trim())) segs[segs.length - 1] += `, ${p.trim()}`;
    else segs.push(p.trim());
  }
  const out: string[] = [];
  let droppedPerson = false;
  for (const seg of segs) {
    // "X dba Y": Y is a trade name (a business) even without a business word; X is one only if it looks like one.
    // "X aka Y" names the same party twice, so each alias is kept only if it looks like a business.
    const lead = /^(?:dba|d\/b\/a)\s+/i.test(seg); // "…, dba Oahu Flooring": the whole segment is a trade name
    const [owner, ...dbas] = lead ? ["", seg.replace(/^(?:dba|d\/b\/a)\s+/i, "")] : seg.split(/\s+\b(?:dba|d\/b\/a)\b\s*/i);
    const aliases = (owner ?? "").split(/\s+\b(?:aka|a\/k\/a)\b\s*/i);
    for (const p of [...aliases.map(clean), ...dbas.map(clean)].filter((x): x is string => !!x)) {
      if (dbas.map(clean).includes(p) || pieceIsBusiness(p)) out.push(p);
      else droppedPerson = true;
    }
  }
  if (!droppedPerson) return [whole];
  return Array.from(new Set(out));
}
