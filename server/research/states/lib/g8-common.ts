/**
 * Small helpers shared by the g8 state packs (OR, WA, MT, WY, AK, HI). No source data lives here.
 */
import { politeFetch } from "../../http";
import { clean } from "../../bulk";
import { tokens } from "../../licenses";

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

/** "MM/DD/YYYY" (any time after it ignored), "YYYY-MM-DD…" or "M-D-YY" → YYYY-MM-DD; anything else → null. */
export function anyDay(v: unknown): string | null {
  const s = clean(v == null ? null : String(v));
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]) >= 1900 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return Number(m[3]) >= 1900 ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m) { const y = Number(m[3]); return `${y >= 70 ? 1900 + y : 2000 + y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return null;
}

/** A positive dollar amount, else null. */
export const money = (v: unknown): number | null => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null; };
export const usd = (n: number | null) => (n == null ? null : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** "LAST, FIRST M" → "FIRST M LAST" (names without a comma are returned as given). */
export function flip(v: string | null | undefined): string | null {
  const m = v?.match(/^([^,]+),\s*(.+)$/);
  return m ? clean(`${m[2]} ${m[1]}`) : clean(v);
}

/**
 * Words that mark a business name in a list that mixes companies and people (debarment and discipline lists name
 * both). Used only to decide which names are indexed for company searches; a name without one is treated as a person
 * and is never indexed (companies only, FCRA).
 */
const ENTITY = /\b(L\.?\s?L\.?\s?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LLP|L\.?P|PLLC|DBA|D\/B\/A|ENTERPRISES?|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|BUILDING|ELECTRIC|ELECTRICAL|PLUMBING|ROOFING|MECHANICAL|SERVICES?|SOLAR|GROUP|HOMES?|EXCAVATION|EXCAVATING|CONCRETE|DRYWALL|PAINTING|FLOORING|LANDSCAPING|MANAGEMENT|SYSTEMS|INDUSTRIES|ASSOCIATES|PARTNERS|HOLDINGS|TRUCKING|FLAGGING|JANITORIAL|CREATIONS|SUPPLY|DESIGNS?|REMODELING|RESTORATION|PROPERTIES)\b/i;
export const looksLikeBusiness = (v: string | null | undefined): boolean => !!v && ENTITY.test(v);

const SUFFIX_ONLY = /^(L\.?\s?L\.?\s?C\.?|INC\.?|CORP\.?|LTD\.?|CO\.?|LLP\.?|L\.?P\.?|PLLC\.?)$/i;

/**
 * The business names in a respondent line like "Acme LLC dba Acme Roofing and John Q. Smith": people are dropped
 * ("John Q. Smith"), trade names after "dba" are kept. A line with no person in it comes back whole.
 */
export function businessParts(v: string | null | undefined): string[] {
  const whole = clean((v ?? "").replace(/\*/g, "").replace(/\s*\((?:Hawai[^)]*|Maui|O[^)]*ahu|Kauai|Kaua[^)]*|Molokai|Moloka[^)]*|Lanai|L[^)]*na[^)]*i|Big Island)\)\s*$/i, ""));
  if (!whole) return [];
  const raw = whole.split(/\s+and\s+|,\s+|;\s*/);
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
      if (dbas.map(clean).includes(p) || looksLikeBusiness(p)) out.push(p);
      else droppedPerson = true;
    }
  }
  if (!droppedPerson) return [whole];
  return Array.from(new Set(out));
}
