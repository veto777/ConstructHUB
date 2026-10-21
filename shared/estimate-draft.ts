/**
 * The New estimate dialog never loses work (owner, 2026-10-21: "make sure it saves the estimates no matter what
 * stage you are at"). Pure pieces shared by the dialog (client/src/components/estimate-autosave.ts) and the tests:
 *
 *  - draftHasContent: once anything is typed, an outside click / Esc no longer closes the dialog, the X asks
 *    "Save as draft / Discard / Keep editing", and the draft is autosaved to the server as a DRAFT estimate.
 *  - autosavePayload: what the autosave sends (POST once, then PATCH). A line with a price or scope but no name
 *    yet is kept as "Untitled item" so nothing typed is dropped.
 *  - the localStorage mirror (key per org + client): written on every change, restored after a refresh or a
 *    failed server save, cleared once the estimate is created or the draft is discarded.
 */

export const DEFAULT_ESTIMATE_TITLE = "Estimate";
export const UNTITLED_LINE = "Untitled item";

export type DraftLine = {
  kind: string;
  name: string;
  description?: string | null;
  quantityMilli: number;
  unit?: string | null;
  unitPriceCents: number;
  taxable: boolean;
  /** The price-book item a line was picked from, when it was. */
  pricebookItemId?: string | null;
};

export type EstimateDraftSnapshot = {
  title: string;
  /** True while the title is generated from the lines (the user hasn't typed in it). */
  autoTitle?: boolean;
  intro: string;
  taxPct: string;
  taxTouched: boolean;
  items: DraftLine[];
};

const lineHasContent = (l: DraftLine) =>
  !!(l.name?.trim() || l.description?.trim() || l.unitPriceCents > 0 || (l.unit ?? "").trim());

/** Anything worth keeping: a title other than the default, any line content, or the message to the client. */
export function draftHasContent(s: EstimateDraftSnapshot | null | undefined): boolean {
  if (!s) return false;
  const title = s.title.trim();
  if (title && title !== DEFAULT_ESTIMATE_TITLE && !s.autoTitle) return true;
  if (s.intro.trim()) return true;
  return s.items.some(lineHasContent);
}

export const pctTextToBps = (t: string): number => {
  const n = parseFloat(t || "0");
  return Number.isFinite(n) ? Math.min(3000, Math.max(0, Math.round(n * 100))) : 0;
};

/** The body for POST /api/crm/estimates (with customerId) or PATCH /api/crm/estimates/:id. */
export function autosavePayload(s: EstimateDraftSnapshot) {
  return {
    title: (s.title.trim() || DEFAULT_ESTIMATE_TITLE).slice(0, 200),
    introText: s.intro.trim() ? s.intro : null,
    taxRateBps: pctTextToBps(s.taxPct),
    items: s.items.filter(lineHasContent).map((l, idx) => ({
      kind: l.kind || "labor",
      name: (l.name.trim() || UNTITLED_LINE).slice(0, 300),
      description: l.description?.trim() ? l.description : null,
      quantityMilli: Math.max(0, Math.round(l.quantityMilli || 0)),
      unit: l.unit?.trim() ? l.unit.trim().slice(0, 20) : null,
      unitPriceCents: Math.max(0, Math.round(l.unitPriceCents || 0)),
      taxable: l.taxable !== false,
      sortOrder: idx,
    })),
  };
}

// ── localStorage mirror ─────────────────────────────────────────────────────

export type DraftMirror = EstimateDraftSnapshot & {
  v: 1;
  /** The server draft this mirrors, once created. */
  draftId: string | null;
  /** The dialog was open (reopen it after a refresh). */
  open: boolean;
  updatedAt: number;
};

export const draftMirrorKey = (orgId: string, customerId: string) => `ch:estimate-draft:${orgId}:${customerId}`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storage = (s?: StorageLike | null): StorageLike | null => {
  if (s) return s;
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

export function readDraftMirror(key: string, s?: StorageLike | null): DraftMirror | null {
  try {
    const raw = storage(s)?.getItem(key);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || m.v !== 1 || !Array.isArray(m.items) || typeof m.title !== "string") return null;
    return m as DraftMirror;
  } catch {
    return null;
  }
}

export function writeDraftMirror(key: string, m: Omit<DraftMirror, "v" | "updatedAt">, s?: StorageLike | null): void {
  try { storage(s)?.setItem(key, JSON.stringify({ ...m, v: 1, updatedAt: Date.now() })); } catch { /* full / blocked */ }
}

export function clearDraftMirror(key: string, s?: StorageLike | null): void {
  try { storage(s)?.removeItem(key); } catch { /* blocked */ }
}

/** A server estimate row back into the dialog's form (continue an autosaved draft). */
export function snapshotFromEstimate(
  e: { title?: string | null; introText?: string | null; taxRateBps?: number | null; customFields?: unknown },
  items: Array<Partial<DraftLine> & { name?: string | null }>,
): EstimateDraftSnapshot {
  return {
    title: e.title ?? DEFAULT_ESTIMATE_TITLE,
    intro: e.introText ?? "",
    taxPct: String(Number(((e.taxRateBps ?? 0) / 100).toFixed(2))),
    taxTouched: true,
    items: items.length
      ? items.map((i) => ({
        kind: i.kind ?? "labor", name: i.name === UNTITLED_LINE ? "" : i.name ?? "", description: i.description ?? "",
        quantityMilli: i.quantityMilli ?? 1000, unit: i.unit ?? "", unitPriceCents: i.unitPriceCents ?? 0,
        taxable: i.taxable ?? true, pricebookItemId: i.pricebookItemId ?? null,
      }))
      : [],
  };
}
