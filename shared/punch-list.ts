/**
 * Punch list & final walkthrough (owner, 2026-10-17): one section per SCOPE of the approved work — windows, siding
 * and roofing approved means three walkthroughs to complete before the job reads Closed out. Scopes are derived from
 * the approved estimates (titles and line items matched against the trades below; anything unmatched is "General")
 * and a person can add or remove one by hand. Pure helpers here; storage is crm_punch_scopes (server/crm/punch-list.ts).
 */
export const PUNCH_TRADES: { key: string; label: string; pattern: RegExp }[] = [
  { key: "siding", label: "Siding", pattern: /\bsiding|hardie|lap board|board\s*&?\s*batten|clapboard|vinyl siding/i },
  { key: "roofing", label: "Roofing", pattern: /\broof|shingle|ridge cap|underlayment|flashing/i },
  { key: "windows", label: "Windows", pattern: /\bwindow|glazing|casement|double[- ]hung/i },
  { key: "doors", label: "Doors", pattern: /\bdoors?\b|entry door|slider|patio door|garage door/i },
  { key: "paint", label: "Paint", pattern: /\bpaint|painting|stain(ing)?\b|primer/i },
  { key: "gutters", label: "Gutters", pattern: /\bgutter|downspout|leaf guard/i },
  { key: "soffit_fascia", label: "Soffit & fascia", pattern: /\bsoffit|fascia|eave/i },
  { key: "decks", label: "Decks", pattern: /\bdeck|railing|balusters?|composite board/i },
];
export const GENERAL_SCOPE = { key: "general", label: "General" } as const;

export type PunchItem = { id: string; text: string; doneAt: string | null };
export type PunchScope = {
  scope: string; label: string; items: PunchItem[];
  walkthroughDoneAt: string | null; walkthroughDoneBy?: string | null;
};

/** The trade a line of text names, if any (first trade wins — a "roof and siding" title lists under both via deriveScopes). */
export function tradesIn(text: string | null | undefined): string[] {
  const s = String(text ?? "");
  return PUNCH_TRADES.filter((t) => t.pattern.test(s)).map((t) => t.key);
}

/**
 * The scopes an approved job's estimates describe, in trade order. An estimate whose title and items name no trade
 * contributes "General"; an empty input yields a single General scope (a walkthrough always has at least one section).
 */
export function deriveScopes(estimates: { title?: string | null; items?: { name?: string | null; description?: string | null }[] }[]): { scope: string; label: string }[] {
  const found = new Set<string>();
  let general = false;
  for (const e of estimates) {
    const hits = new Set<string>(tradesIn(e.title));
    for (const it of e.items ?? []) for (const k of tradesIn(`${it.name ?? ""} ${it.description ?? ""}`)) hits.add(k);
    if (hits.size) for (const k of hits) found.add(k); else general = true;
  }
  const out = PUNCH_TRADES.filter((t) => found.has(t.key)).map((t) => ({ scope: t.key, label: t.label }));
  if (general || !out.length) out.push({ scope: GENERAL_SCOPE.key, label: GENERAL_SCOPE.label });
  return out;
}

/** A hand-typed scope name as a stored key ("Soffit & fascia" → "soffit_fascia"); empty when nothing usable is left. */
export function scopeKeyOf(label: string): string {
  const known = PUNCH_TRADES.find((t) => t.label.toLowerCase() === label.trim().toLowerCase());
  if (known) return known.key;
  return label.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
let seq = 0;
export const newPunchId = () => `${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, "0")}`;

/**
 * Items as stored: text trimmed and capped, blanks dropped, ids kept when well-formed (minted otherwise), doneAt a
 * valid ISO date or null. Never throws — a bad row is dropped, never the whole list. Capped at 200 per scope.
 */
export function normalizePunchItems(raw: unknown): PunchItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PunchItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const text = String((r as any).text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!text) continue;
    let id = String((r as any).id ?? "");
    if (!ID_RE.test(id) || seen.has(id)) id = newPunchId();
    seen.add(id);
    const d = (r as any).doneAt;
    const doneAt = d && !Number.isNaN(new Date(d).getTime()) ? new Date(d).toISOString() : null;
    out.push({ id, text, doneAt });
    if (out.length >= 200) break;
  }
  return out;
}

/** "2 of 3 walkthroughs not done" — the close-out confirm's warning (empty when every walkthrough is complete). */
export function openWalkthroughs(scopes: { walkthroughDoneAt?: string | null }[]): { open: number; total: number } {
  return { open: scopes.filter((s) => !s.walkthroughDoneAt).length, total: scopes.length };
}

/** The stage tag + scope a punch-list photo carries in its stored name: "punchlist--siding--IMG_1.jpg". */
export function punchPhotoName(scope: string, fileName: string, projectId?: string | null): string {
  // "punchlist--<scope>--@<project id>--<name>": the project rides in the name so a repeat client's jobs keep
  // their own walkthrough photos apart (older names without it belong to whichever job shows them).
  return `punchlist--${scope}--${projectId ? `@${projectId}--` : ""}${fileName}`;
}
export function parsePunchPhotoName(fileName: string): { scope: string; displayName: string; projectId: string | null } | null {
  const m = /^punchlist--([a-z0-9_]{1,40})--(?:@([0-9a-f-]{36})--)?(.+)$/.exec(fileName);
  if (m) return { scope: m[1], displayName: m[3], projectId: m[2] ?? null };
  if (fileName.startsWith("punchlist--")) return { scope: GENERAL_SCOPE.key, displayName: fileName.slice(11) || fileName, projectId: null };
  return null;
}
