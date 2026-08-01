/**
 * Optional, client-selected discount offers on an estimate.
 *
 * The CREATOR decides which offers to extend (usually by ticking presets);
 * they appear as checkboxes on the gated public estimate page. The client's
 * ticking is a preview only — on approve the SERVER re-computes everything
 * from the line items and the enabled offers it has on file:
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
 * All integer cents, rounded once per step (same rule as recalcEstimate in
 * entities.ts). Client-supplied totals are never trusted; the result is
 * persisted as approvedTotalCents + selectedDiscounts on the estimate.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { crmEstimateDiscounts, crmEstimateItems, crmEstimates } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { logActivity } from "./activity";

type GetUser = (req: any, res: any) => any;

// ── Preset templates ────────────────────────────────────────────────────────
// The creator ticks which of these to offer. Price-match is OFF by default —
// matching a competitor's number is a bad sales tactic; offering it at all is
// a deliberate choice, and the client must provide the competing bid.
export const DISCOUNT_PRESETS = [
  {
    code: "marketing",
    label: "Marketing discount",
    percentBps: 100, // 1%
    conditions: "Yard signage during the job + 1 month after, and an honest review (unless the experience was genuinely bad).",
    defaultEnabled: true,
  },
  {
    code: "military",
    label: "Military discount",
    percentBps: 200, // 2%
    conditions: "Military ID required — family members don't count.",
    defaultEnabled: true,
  },
  {
    code: "pay_in_full",
    label: "Pay-in-full discount",
    percentBps: 500, // 5%
    conditions: "Paid in full immediately.",
    defaultEnabled: true,
  },
  {
    code: "bundle",
    label: "Bundle discount",
    percentBps: 500, // 5%
    conditions: "Siding + roofing + windows — all three required; gutters/paint don't count as a scope.",
    defaultEnabled: true,
  },
  {
    code: "price_match",
    label: "Price match",
    percentBps: 0, // creator sets the concession when enabling it
    conditions: "Requires providing the competing bid. Off by default — price matching is a bad sales tactic.",
    defaultEnabled: false,
  },
] as const;

// ── The math (pure — unit-tested in discounts.test.ts) ─────────────────────

export type DiscountableLine = {
  kind: string;
  unitPriceCents: number;
  quantityMilli: number;
  taxable: boolean;
};

export type SelectedOffer = { percentBps: number };

export type ApprovalTotals = {
  subtotalCents: number;
  lineDiscountCents: number;
  taxableBaseCents: number;
  optionalDiscountBps: number;
  optionalDiscountCents: number;
  taxCents: number;
  totalCents: number;
};

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
  let subtotal = 0, lineDiscount = 0, taxable = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { lineDiscount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const taxableBase = Math.max(0, taxable - lineDiscount);
  // The combined concession can never exceed the base it applies to.
  const optBps = Math.min(10_000, selected.reduce((s, o) => s + Math.max(0, o.percentBps), 0));
  const optDiscount = Math.round((taxableBase * optBps) / 10_000);
  const tax = Math.round(((taxableBase - optDiscount) * Math.max(0, taxRateBps)) / 10_000);
  const total = Math.max(0, subtotal - lineDiscount - optDiscount + tax);
  return {
    subtotalCents: subtotal,
    lineDiscountCents: lineDiscount,
    taxableBaseCents: taxableBase,
    optionalDiscountBps: optBps,
    optionalDiscountCents: optDiscount,
    taxCents: tax,
    totalCents: total,
  };
}

// ── Server-side selection resolution ────────────────────────────────────────

export type SelectionRecord = {
  id: string;
  code: string;
  label: string;
  percentBps: number;
  conditions: string | null;
};

/**
 * Load the estimate's enabled offers and keep only the ones the client
 * ticked (by id). Anything unknown or disabled is silently dropped — the
 * client can choose from what's on offer, never invent a discount.
 */
export async function resolveSelectedOffers(
  orgId: string,
  estimateId: string,
  selectedIds: string[],
): Promise<SelectionRecord[]> {
  if (!selectedIds.length) return [];
  const offers = await db.select().from(crmEstimateDiscounts)
    .where(and(
      eq(crmEstimateDiscounts.orgId, orgId),
      eq(crmEstimateDiscounts.estimateId, estimateId),
      eq(crmEstimateDiscounts.enabled, true),
    ));
  const wanted = new Set(selectedIds);
  return offers
    .filter((o) => wanted.has(o.id))
    .map((o) => ({ id: o.id, code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions }));
}

/** Recompute approval totals from the DB: line items + validated selections. */
export async function recomputeApprovalTotals(
  orgId: string,
  estimateId: string,
  taxRateBps: number,
  selectedIds: string[],
): Promise<{ totals: ApprovalTotals; selections: SelectionRecord[] }> {
  const items = await db.select().from(crmEstimateItems)
    .where(and(eq(crmEstimateItems.orgId, orgId), eq(crmEstimateItems.estimateId, estimateId)));
  const selections = await resolveSelectedOffers(orgId, estimateId, selectedIds);
  const totals = computeApprovalTotals(items, taxRateBps, selections);
  return { totals, selections };
}

// ── Routes: the creator manages the offers ──────────────────────────────────

const offerSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  percentBps: z.number().int().min(0).max(10_000),
  conditions: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export function presentDiscountOffer(o: typeof crmEstimateDiscounts.$inferSelect) {
  return {
    id: o.id, code: o.code, label: o.label, percentBps: o.percentBps,
    conditions: o.conditions, enabled: o.enabled, sortOrder: o.sortOrder,
  };
}

export function registerCrmDiscountRoutes(app: Express, getDevUser: GetUser): void {
  /** The offers on one estimate + the preset templates (for the picker). */
  app.get("/api/crm/estimates/:id/discounts", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const [est] = await db.select({ id: crmEstimates.id }).from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    const offers = await db.select().from(crmEstimateDiscounts)
      .where(and(eq(crmEstimateDiscounts.orgId, ctx.org.id), eq(crmEstimateDiscounts.estimateId, est.id)))
      .orderBy(asc(crmEstimateDiscounts.sortOrder), asc(crmEstimateDiscounts.createdAt));
    res.json({
      offers: offers.map(presentDiscountOffer),
      presets: DISCOUNT_PRESETS,
    });
  });

  /**
   * Replace the offer set wholesale — the picker sends the full ticked list,
   * so save is idempotent and order-independent. Locked once the client has
   * answered: changing the offer after approval would rewrite a signed deal.
   */
  app.put("/api/crm/estimates/:id/discounts", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const parsed = z.object({ offers: z.array(offerSchema).max(20) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid discount offers", issues: parsed.error.issues });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.approvedAt) return res.status(409).json({ message: "This estimate has been approved — offers are locked." });
    if (est.declinedAt) return res.status(409).json({ message: "This estimate has been declined — offers are locked." });

    await db.delete(crmEstimateDiscounts)
      .where(and(eq(crmEstimateDiscounts.orgId, ctx.org.id), eq(crmEstimateDiscounts.estimateId, est.id)));
    if (parsed.data.offers.length) {
      await db.insert(crmEstimateDiscounts).values(
        parsed.data.offers.map((o, idx) => ({
          orgId: ctx.org.id,
          estimateId: est.id,
          code: o.code,
          label: o.label,
          percentBps: o.percentBps,
          conditions: o.conditions ?? null,
          enabled: o.enabled,
          sortOrder: o.sortOrder ?? idx,
        })) as any,
      );
    }
    const fresh = await db.select().from(crmEstimateDiscounts)
      .where(and(eq(crmEstimateDiscounts.orgId, ctx.org.id), eq(crmEstimateDiscounts.estimateId, est.id)))
      .orderBy(asc(crmEstimateDiscounts.sortOrder), asc(crmEstimateDiscounts.createdAt));
    logActivity(ctx, "discount.updated", {
      entityType: "estimate", entityId: est.id, customerId: est.customerId,
      meta: { number: est.number, offers: parsed.data.offers.map((o) => o.code) },
    });
    res.json({ offers: fresh.map(presentDiscountOffer) });
  });
}
