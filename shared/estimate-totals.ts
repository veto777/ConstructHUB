/**
 * Estimate money math shared by the server and the client estimate page.
 *
 * ONE implementation on purpose: the public estimate page previews totals
 * while the client ticks optional discounts and scopes, and the server
 * re-computes the same numbers when the client approves (server/crm/
 * discounts.ts → recomputeApprovalTotals). The preview used to carry its own
 * copies of this arithmetic and they drifted — the page showed one total
 * next to the discount ticks and another next to the scope ticks.
 *
 *   lineTotal     = round(unitPriceCents * quantityMilli / 1000)   per line
 *   subtotal      = Σ lineTotal over non-discount lines
 *   lineDiscount  = Σ |lineTotal| over kind="discount" lines
 *   taxableBase   = max(0, Σ lineTotal over taxable non-discount lines − lineDiscount)
 *   optBps        = min(10_000, Σ percentBps of selected enabled offers)  ← cap
 *   optDiscount   = round(taxableBase * optBps / 10_000)     ← applied to the TAXABLE base
 *   taxCents      = round((taxableBase − optDiscount) * taxRateBps / 10_000)
 *   totalCents    = max(0, subtotal − lineDiscount − optDiscount + taxCents)
 *
 * Integer cents, rounded once per step. Optional discounts are percentages
 * only — there is no fixed-amount optional discount; a fixed concession is a
 * kind="discount" line item, which is the `lineDiscount` term above.
 */

export type DiscountableLine = {
  kind: string;
  unitPriceCents: number;
  quantityMilli: number;
  taxable: boolean;
};

export type SelectedOffer = { percentBps: number };

/** What a set of line items adds up to before optional discounts and tax. */
export type LineBases = {
  subtotalCents: number;
  lineDiscountCents: number;
  /** Σ taxable non-discount lines — NOT yet reduced by the line discounts. */
  taxableCents: number;
};

export type ApprovalTotals = {
  subtotalCents: number;
  lineDiscountCents: number;
  taxableBaseCents: number;
  optionalDiscountBps: number;
  optionalDiscountCents: number;
  taxCents: number;
  totalCents: number;
};

export function lineBases(items: DiscountableLine[]): LineBases {
  let subtotal = 0, lineDiscount = 0, taxable = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { lineDiscount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  return { subtotalCents: subtotal, lineDiscountCents: lineDiscount, taxableCents: taxable };
}

/** Several scopes signed together are one document: the bases simply add. */
export function sumLineBases(parts: Partial<LineBases>[]): LineBases {
  const out: LineBases = { subtotalCents: 0, lineDiscountCents: 0, taxableCents: 0 };
  for (const p of parts) {
    out.subtotalCents += p.subtotalCents ?? 0;
    out.lineDiscountCents += p.lineDiscountCents ?? 0;
    out.taxableCents += p.taxableCents ?? 0;
  }
  return out;
}

/** Combined optional concession, capped at 100% (negative offers ignored). */
export function combinedOfferBps(selected: SelectedOffer[]): number {
  return Math.min(10_000, selected.reduce((s, o) => s + Math.max(0, o.percentBps || 0), 0));
}

/** Totals from already-summed bases. */
export function totalsFromBases(bases: LineBases, taxRateBps: number, selected: SelectedOffer[]): ApprovalTotals {
  const taxableBase = Math.max(0, bases.taxableCents - bases.lineDiscountCents);
  // The combined concession can never exceed the base it applies to.
  const optBps = combinedOfferBps(selected);
  const optDiscount = Math.round((taxableBase * optBps) / 10_000);
  const tax = Math.round(((taxableBase - optDiscount) * Math.max(0, taxRateBps || 0)) / 10_000);
  const total = Math.max(0, bases.subtotalCents - bases.lineDiscountCents - optDiscount + tax);
  return {
    subtotalCents: bases.subtotalCents,
    lineDiscountCents: bases.lineDiscountCents,
    taxableBaseCents: taxableBase,
    optionalDiscountBps: optBps,
    optionalDiscountCents: optDiscount,
    taxCents: tax,
    totalCents: total,
  };
}

/**
 * Recompute the approved total. `taxRateBps` is the estimate's stored rate;
 * `selected` is the server's own enabled offers the client ticked (already
 * validated to belong to the estimate — never client-supplied percentages).
 */
export function computeApprovalTotals(
  items: DiscountableLine[],
  taxRateBps: number,
  selected: SelectedOffer[],
): ApprovalTotals {
  return totalsFromBases(lineBases(items), taxRateBps, selected);
}

/**
 * What an approved estimate asks the client to pay online: the deposit when
 * one is set, otherwise the signed total — and NEVER more than the signed
 * total. The deposit is validated against the QUOTED total when the estimate
 * is written (entities.ts depositRefusal); optional discounts ticked at
 * signing can take the approved total below it, and a deposit above the
 * whole job would bill the client more than they agreed to.
 */
export function amountDueCents(est: {
  depositCents?: number | null;
  approvedTotalCents?: number | null;
  totalCents?: number | null;
}): number {
  const signed = Math.max(0, est.approvedTotalCents ?? est.totalCents ?? 0);
  const deposit = est.depositCents ?? 0;
  return deposit > 0 ? Math.min(deposit, signed) : signed;
}

// ── The public estimate page's live preview ─────────────────────────────────

/** The estimate fields the public payload carries (server/crm/portal.ts). */
export type PublicEstimateMoney = {
  subtotalCents?: number | null;
  discountCents?: number | null;
  /** Already max(0, taxable − line discounts) — hidden lines included. */
  taxableBaseCents?: number | null;
  taxRateBps?: number | null;
};

/** A client-selectable scope as the public payload carries it. */
export type PublicScope = Partial<LineBases> & { id: string };

export type EstimatePagePreview = {
  /** The document as written, with the ticked offers applied — what
   *  "Approve this estimate" signs. */
  document: ApprovalTotals;
  /** The ticked scopes with the same offers applied — what "Generate my
   *  estimate" produces. null when no scope is ticked. */
  scopes: ApprovalTotals | null;
  /** Which of the two the "Your new total" line under Optional discounts
   *  must quote: the ticked scopes when there are any, else the document. */
  noteBasis: "document" | "scopes";
  noteTotalCents: number;
};

/**
 * Everything the page shows while the client ticks discounts and scopes.
 * `selected` are the ticked offers; `chosenScopes` the ticked scopes (pass []
 * when the scope checklist is not on offer — settled, expired, preview).
 */
export function previewEstimatePage(
  est: PublicEstimateMoney,
  chosenScopes: PublicScope[],
  selected: SelectedOffer[],
): EstimatePagePreview {
  const lineDiscount = est.discountCents ?? 0;
  const document = totalsFromBases({
    subtotalCents: est.subtotalCents ?? 0,
    lineDiscountCents: lineDiscount,
    // totalsFromBases subtracts the line discounts again; the payload's base
    // already has them out (and is clamped at 0), so add them back.
    taxableCents: (est.taxableBaseCents ?? 0) + lineDiscount,
  }, est.taxRateBps ?? 0, selected);
  const scopes = chosenScopes.length
    ? totalsFromBases(sumLineBases(chosenScopes), est.taxRateBps ?? 0, selected)
    : null;
  return {
    document, scopes,
    noteBasis: scopes ? "scopes" : "document",
    noteTotalCents: scopes ? scopes.totalCents : document.totalCents,
  };
}
