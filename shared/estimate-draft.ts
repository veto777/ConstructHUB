/**
 * The New estimate dialog never loses work (owner, 2026-10-21: "make sure it saves the estimates no matter what
 * stage you are at"). Pure pieces shared by the dialog (client/src/components/estimate-autosave.tsx) and the tests:
 *
 *  - draftHasContent: once anything is typed, an outside click / Esc no longer closes the dialog, the X asks
 *    "Save as draft / Discard / Keep editing", and the draft is autosaved to the server as a DRAFT estimate.
 *  - autosavePayload: what the autosave (and Create) sends. A line with a price or scope but no name yet is kept as
 *    "Untitled item" so nothing typed is dropped. The contractor's own discount becomes a kind:"discount" line, so
 *    recalcEstimate / shared/estimate-totals.ts handle it (tax after the discount) — no second totals math here.
 *  - autoTitleFrom: while the user hasn't typed a title, it follows the lines live ("A + B", "A + B + 1 more").
 *  - the localStorage mirror (key per org + client): written on every change, restored after a refresh or a
 *    failed server save, cleared once the estimate is created or the draft is discarded.
 */
import { lineBases } from "./estimate-totals";
import { orgDiscountRule } from "./scope-category";

export const DEFAULT_ESTIMATE_TITLE = "Estimate";
export const UNTITLED_LINE = "Untitled item";
export const TITLE_MAX = 200;

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
  /** That item's list price when picked (client-side only: drives "Update price book to $X"). */
  listPriceCents?: number | null;
  /** Kept as loaded when an existing estimate is edited in the dialog (the dialog has no control for them). */
  hiddenFromClient?: boolean;
  unitCostCents?: number | null;
  /** Scope category for bundle discounts (shared/scope-category.ts); null/absent = from the name. */
  scopeCategory?: string | null;
  /** Which list price "Update price book" writes: the flat price or the per-sq-ft rate (client-side only). */
  listField?: "flatPriceCents" | "rateCentsPerSqft" | null;
};

/** A preset / org-default discount the client may choose on the estimate page (crm_estimate_discounts). */
export type DraftOffer = { code: string; label: string; percentBps: number; conditions: string | null; enabled: boolean; rule?: unknown };

/** The contractor's own discount on this estimate: a dollar amount or a percent of the subtotal. */
export type ContractorDiscount = { mode: "amount" | "percent"; value: string; label: string };

export type EstimateDraftSnapshot = {
  title: string;
  /** True while the title is generated from the lines (the user hasn't typed in it). Missing = true. */
  autoTitle?: boolean;
  intro: string;
  taxPct: string;
  taxTouched: boolean;
  items: DraftLine[];
  offers?: DraftOffer[];
  contractorDiscount?: ContractorDiscount | null;
  /** Option 2+ tabs (the dialog's own shape); their lines count as content too. */
  optionTabs?: { extra?: Array<{ items?: DraftLine[]; discount?: ContractorDiscount | null }> } | null;
  /** An existing (non-autosave) estimate opened in the dialog, so a refresh restores it as that estimate. */
  editing?: { id: string; number: string | null; autosave: boolean } | null;
  /** The tax rate the opened estimate was saved with (bps), for the note under Tax %. */
  savedTaxBps?: number | null;
};

export const lineHasContent = (l: DraftLine) =>
  !!(l.name?.trim() || l.description?.trim() || l.unitPriceCents > 0 || (l.unit ?? "").trim());

const discountCentsOf = (cd: ContractorDiscount | null | undefined, items: DraftLine[]): number => {
  if (!cd) return 0;
  const n = parseFloat(String(cd.value).replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (cd.mode === "amount") return Math.round(n * 100);
  const pct = Math.min(100, n);
  return Math.round((lineBases(items.filter((l) => l.kind !== "discount")).subtotalCents * pct) / 100);
};

/** Anything worth keeping: a typed title, any line content, the message, or a contractor discount. */
export function draftHasContent(s: EstimateDraftSnapshot | null | undefined): boolean {
  if (!s) return false;
  const title = s.title.trim();
  if (s.autoTitle === false && title && title !== DEFAULT_ESTIMATE_TITLE) return true;
  if (s.intro.trim()) return true;
  if (discountCentsOf(s.contractorDiscount, s.items) > 0) return true;
  if (s.items.some(lineHasContent)) return true;
  // Lines typed only in Option 2+ are work too (a refresh or an outside click must not lose them).
  return (s.optionTabs?.extra ?? []).some((t) => (t.items ?? []).some(lineHasContent) || discountCentsOf(t.discount, t.items ?? []) > 0);
}

/**
 * An option's saved lines back into the dialog's form: its generated contractor-discount line (the last
 * kind:"discount" line) becomes the tab's discount again — "Discount (10%)" as a percent that follows the
 * prices, anything else as a dollar amount — and is taken out of the lines.
 */
export function discountFromOptionLines<T extends { kind?: string | null; name?: string | null; unitPriceCents?: number | null }>(
  items: T[],
): { discount: ContractorDiscount | null; items: T[] } {
  const last = [...items].reverse().find((i) => i.kind === "discount");
  if (!last) return { discount: null, items };
  const rest = items.filter((i) => i !== last);
  const name = String(last.name ?? "").trim();
  const m = /^(.*?)\s*\((\d+(?:\.\d+)?)%\)$/.exec(name);
  if (m) return { discount: { mode: "percent", value: m[2], label: m[1].trim() || "Discount" }, items: rest };
  const cents = Math.max(0, Math.round(last.unitPriceCents ?? 0));
  return { discount: { mode: "amount", value: String(Number((cents / 100).toFixed(2))), label: name || "Discount" }, items: rest };
}

/**
 * The title while it is automatic: the line names in order. One line → its name; two → "A + B"; three or more →
 * "A + B + N more". Long results are cut at a word. No named line → "Estimate".
 */
export function autoTitleFrom(items: Array<{ name?: string | null; kind?: string }>): string {
  const names = items.filter((i) => i.kind !== "discount").map((i) => (i.name ?? "").trim()).filter(Boolean);
  if (!names.length) return DEFAULT_ESTIMATE_TITLE;
  const t = names.length <= 2 ? names.join(" + ") : `${names[0]} + ${names[1]} + ${names.length - 2} more`;
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/**
 * Was this title set automatically? For an estimate saved before the auto-title flag existed: the default title,
 * the title its lines give now, or the name of one of the org's price-book items (the old dialog copied the first
 * picked item's name into the title — "Seamless Gutter Installation" on a "Door Remodel" estimate). Anything else
 * was typed by someone and stays.
 */
export function titleLooksAuto(title: string | null | undefined, items: Array<{ name?: string | null; kind?: string }>, pricebookNames?: Set<string>): boolean {
  const t = (title ?? "").trim();
  if (!t || t === DEFAULT_ESTIMATE_TITLE) return true;
  if (t === autoTitleFrom(items)) return true;
  return !!pricebookNames && pricebookNames.has(t.toLowerCase());
}

export const pctTextToBps = (t: string): number => {
  const n = parseFloat(t || "0");
  return Number.isFinite(n) ? Math.min(3000, Math.max(0, Math.round(n * 100))) : 0;
};

/** The contractor discount as an estimate line (kind "discount", not taxable), or null when there is none. */
export function contractorDiscountLine(cd: ContractorDiscount | null | undefined, items: DraftLine[]) {
  const cents = discountCentsOf(cd, items);
  if (!cd || cents <= 0) return null;
  const pct = cd.mode === "percent" ? ` (${Number(parseFloat(cd.value).toFixed(2))}%)` : "";
  return {
    kind: "discount", name: `${cd.label.trim() || "Discount"}${pct}`.slice(0, 300), description: null,
    quantityMilli: 1000, unit: null, unitPriceCents: cents, taxable: false,
  };
}

/** The body for POST /api/crm/estimates (with customerId) or PATCH /api/crm/estimates/:id. */
export function autosavePayload(s: EstimateDraftSnapshot) {
  const lines = s.items.filter(lineHasContent).map((l) => ({
    kind: l.kind || "labor",
    name: (l.name.trim() || UNTITLED_LINE).slice(0, 300),
    description: l.description?.trim() ? l.description : null,
    quantityMilli: Math.max(0, Math.round(l.quantityMilli || 0)),
    unit: l.unit?.trim() ? l.unit.trim().slice(0, 20) : null,
    unitPriceCents: Math.max(0, Math.round(l.unitPriceCents || 0)),
    taxable: l.taxable !== false,
    hiddenFromClient: !!l.hiddenFromClient,
    ...(typeof l.unitCostCents === "number" ? { unitCostCents: l.unitCostCents } : {}),
    pricebookItemId: l.pricebookItemId ?? null,
    scopeCategory: l.scopeCategory ?? null,
  }));
  const disc = contractorDiscountLine(s.contractorDiscount, s.items);
  const items = [...lines, ...(disc ? [{ ...disc, pricebookItemId: null, scopeCategory: null }] : [])].map((l, idx) => ({ ...l, sortOrder: idx }));
  return {
    title: (s.title.trim() || DEFAULT_ESTIMATE_TITLE).slice(0, TITLE_MAX),
    introText: s.intro.trim() ? s.intro : null,
    taxRateBps: pctTextToBps(s.taxPct),
    items,
    // Kept on the draft (customFields.autosave.meta) so a resumed draft keeps its auto title and discount form.
    autosaveMeta: { autoTitle: s.autoTitle !== false, contractorDiscount: s.contractorDiscount ?? null },
  };
}

/** The offers to store for the estimate (PUT /api/crm/estimates/:id/discounts): every one, ticked or not. */
export const offersPayload = (offers: DraftOffer[] | undefined) =>
  (offers ?? []).map((o, idx) => ({
    code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null, enabled: o.enabled, sortOrder: idx,
    rule: o.rule ?? null,
  }));

/** The org's Bid discounts (Settings), else the presets with their default ticks. */
export function defaultOffers(
  orgCustomFields: unknown,
  presets: ReadonlyArray<{ code: string; label: string; percentBps: number; conditions: string; defaultEnabled: boolean }>,
): DraftOffer[] {
  const saved = (orgCustomFields as any)?.discountDefaults;
  if (Array.isArray(saved) && saved.length) {
    return saved
      .filter((o: any) => o && typeof o.code === "string" && typeof o.label === "string" && Number.isInteger(o.percentBps))
      .map((o: any) => ({ code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null, enabled: o.enabled !== false,
        rule: o.rule ?? orgDiscountRule(orgCustomFields, o.code) }));
  }
  return presets.map((p) => ({ code: p.code, label: p.label, percentBps: p.percentBps, conditions: p.conditions, enabled: p.defaultEnabled,
    rule: orgDiscountRule(orgCustomFields, p.code) }));
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

/** A server estimate (+ its offers) back into the dialog's form (continue an autosaved draft). */
export function snapshotFromEstimate(
  e: { title?: string | null; introText?: string | null; taxRateBps?: number | null; autosaveMeta?: any; titleAuto?: boolean | null },
  items: Array<Partial<DraftLine> & { name?: string | null }>,
  offers?: DraftOffer[],
): EstimateDraftSnapshot {
  const meta = e.autosaveMeta ?? {};
  const cd: ContractorDiscount | null = meta.contractorDiscount ?? null;
  // The contractor discount is rebuilt from the form, so its generated line is not loaded as a line.
  let rows = items;
  if (cd) {
    const lastDisc = [...items].reverse().find((i) => i.kind === "discount");
    rows = items.filter((i) => i !== lastDisc);
  }
  return {
    title: e.title ?? DEFAULT_ESTIMATE_TITLE,
    // The saved flag when there is one; else the server's titleLooksAuto verdict (GET /api/crm/estimates/:id),
    // else the same rule without price-book names. Only a title someone typed stays manual.
    autoTitle: typeof meta.autoTitle === "boolean" ? meta.autoTitle
      : typeof e.titleAuto === "boolean" ? e.titleAuto
      : titleLooksAuto(e.title, rows),
    intro: e.introText ?? "",
    taxPct: String(Number(((e.taxRateBps ?? 0) / 100).toFixed(2))),
    taxTouched: true,
    items: rows.map((i) => ({
      kind: i.kind ?? "labor", name: i.name === UNTITLED_LINE ? "" : i.name ?? "", description: i.description ?? "",
      quantityMilli: i.quantityMilli ?? 1000, unit: i.unit ?? "", unitPriceCents: i.unitPriceCents ?? 0,
      taxable: i.taxable ?? true, pricebookItemId: i.pricebookItemId ?? null,
      scopeCategory: i.scopeCategory ?? null,
      hiddenFromClient: !!i.hiddenFromClient,
      ...(typeof i.unitCostCents === "number" ? { unitCostCents: i.unitCostCents } : {}),
    })),
    ...(offers ? { offers } : {}),
    contractorDiscount: cd,
  };
}
