/**
 * Quick Bid — the owner's "price book that prices per sqft" flow.
 *
 * Pick one or more per_sqft SKUs on the client page; the server pulls the
 * customer's LATEST ready measurement report (HOVER/CladAI/manual), takes the
 * sqft metric each SKU prices against (siding jobs → wall area, roofing →
 * roof area), applies the report's waste factor to the QUANTITY (never the
 * price — same rule as the price book expander), and creates a draft estimate
 * with tax auto-resolved by tax.ts. The UI then shows an edit-first review
 * and the standard send dialog.
 *
 * The pure math lives in quickbid-math.ts (quickBidLine/inferSqftMetric),
 * unit-tested in quickbid.test.ts; the endpoint is exercised against the dev
 * server there too, and end-to-end in e2e/36-quick-bid.spec.ts.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmCustomers, crmEstimates, crmEstimateItems, crmMeasurements, crmPbItems,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { divisionScopeOf } from "./divisions";
import { resolveEstimateTaxRate } from "./tax";
import { logEvent, presentEstimate, presentEstimateItem, recalcEstimate } from "./entities";
import { estimateDefaultsFromOrg } from "./doc-defaults";
import { inferSqftMetric, quickBidLine, quickBidLineDescription, type SqftMetric } from "./quickbid-math";
import { nextDocNumber } from "./doc-number";
import { attachDefaultFilesToEstimate } from "./estimate-default-files";
import { readTakeoffRules, takeoffOfRow } from "./hover-file";
import type { HoverTakeoff } from "@shared/hover-takeoff";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");

export type { SqftMetric } from "./quickbid-math";
export { inferSqftMetric, quickBidLine, quickBidLineDescription } from "./quickbid-math";


/** A HOVER report's quote quantity for a metric: siding rounded up, roof with waste (shared/hover-takeoff.ts). */
const takeoffQuote = (t: HoverTakeoff | null, metric: SqftMetric) =>
  (metric === "roof" ? t?.roof.quantitySqft : t?.siding.quantitySqft) ?? null;
/** The takeoff's own numbers for the line label (null without a takeoff quote). */
const takeoffQuoteDetail = (t: HoverTakeoff | null, metric: SqftMetric) => {
  const area = metric === "roof" ? t?.roof.areaSqft : t?.siding.areaSqft;
  const qty = takeoffQuote(t, metric);
  return t && area != null && qty !== null ? { areaSqft: area, quantitySqft: qty, wastePct: t.roof.wastePct } : null;
};

export function registerCrmQuickBidRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /**
   * POST /api/crm/quick-bid { customerId, itemIds[] }
   *
   * Every "can't price this honestly" case is a 409 with a plain message —
   * a bid made from guessed numbers is worse than no bid.
   */
  app.post("/api/crm/quick-bid", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const p = z.object({
      customerId: z.string().min(1),
      itemIds: z.array(z.string().min(1)).min(1).max(20),
      title: z.string().max(200).optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid quick-bid request", issues: p.error.issues });

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, p.data.customerId))).limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    // The LATEST ready report wins — an older report is a different house
    // (or a worse measurement of the same one).
    const [m] = await db.select().from(crmMeasurements)
      .where(and(
        eq(crmMeasurements.orgId, ctx.org.id),
        eq(crmMeasurements.customerId, cust.id),
        eq(crmMeasurements.status, "ready"),
      ))
      .orderBy(desc(crmMeasurements.createdAt)).limit(1);
    if (!m) {
      return res.status(409).json({
        message: "Quick Bid needs a ready measurement report for this client first (HOVER, CladAI, or a manual entry).",
      });
    }

    // HOVER reports carry a takeoff: the owner's rules (siding rounded up to 100, roof + 5% waste) are the
    // quote quantity, applied once — the report's waste % is NOT stacked on top of it.
    const takeoff = m.provider === "hover" ? takeoffOfRow(m, await readTakeoffRules(ctx.org.id)) : null;

    const items = await db.select().from(crmPbItems)
      .where(and(eq(crmPbItems.orgId, ctx.org.id), inArray(crmPbItems.id, p.data.itemIds)));
    const byId = new Map(items.map((i) => [i.id, i]));

    // Validate everything before writing anything — a half-created bid is
    // worse than a refusal.
    const lines: {
      item: typeof items[number]; metric: SqftMetric;
      quantityMilli: number; lineTotalCents: number;
    }[] = [];
    for (const itemId of p.data.itemIds) {
      const item = byId.get(itemId);
      if (!item || !item.active) {
        return res.status(404).json({ message: "A selected price book item no longer exists." });
      }
      if (item.pricingMode !== "per_sqft") {
        return res.status(400).json({
          message: `"${item.name}" is not a per-sqft SKU. Quick Bid only prices items whose pricing mode is per_sqft.`,
        });
      }
      if (!item.rateCentsPerSqft || item.rateCentsPerSqft <= 0) {
        return res.status(409).json({
          message: `"${item.name}" has no per-sqft rate yet. Set its rate in the price book first.`,
        });
      }
      const metric = (item.sqftMetric as SqftMetric | null) ?? inferSqftMetric(item.name);
      const sqftMilli = metric === "roof" ? m.roofAreaSfMilli : m.wallAreaSfMilli;
      if (sqftMilli === null || sqftMilli === undefined || sqftMilli <= 0) {
        return res.status(409).json({
          message: `The latest ${m.provider} report for this client has no ${metric} square footage, so "${item.name}" can't be priced from it.`,
        });
      }
      const quote = takeoffQuote(takeoff, metric);
      const { quantityMilli, lineTotalCents } = quote !== null
        ? quickBidLine({ rateCentsPerSqft: item.rateCentsPerSqft, sqftMilli: Math.round(quote * 1000), wasteBps: 0 })
        : quickBidLine({ rateCentsPerSqft: item.rateCentsPerSqft, sqftMilli, wasteBps: m.wasteSuggestionBps });
      lines.push({ item, metric, quantityMilli, lineTotalCents });
    }

    // Tax resolves exactly the way the estimate-create route resolves it
    // (the tax.ts hook only fires on POST /api/crm/estimates, so do it here).
    const tax = await resolveEstimateTaxRate(ctx.org.id, { customerId: cust.id });

    const names = lines.map((l) => l.item.name);
    const title = (p.data.title?.trim() || `Quick Bid — ${names.join(" + ")}`).slice(0, 200);

    // Numbered and inserted in one transaction under the org's estimate-number
    // lock (doc-number.ts) — the same series and lock as every other estimate
    // create, never count(*)+1, which repeats after a delete and races.
    const est = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "E", ctx.org.id);
      const [row] = await tx.insert(crmEstimates).values({
        orgId: ctx.org.id, customerId: cust.id, projectId: null,
        number, title,
        introText: null, termsText: ctx.org.termsAndConditions ?? null,
        // Settings → Estimate & invoice defaults, snapshotted (doc-defaults.ts).
        ...estimateDefaultsFromOrg(ctx.org),
        taxRateBps: tax.bps, publicToken: token(), createdByMemberId: ctx.member.id,
        // Lands in the division workspace it was made in (null = All divisions).
        divisionId: divisionScopeOf(ctx),
        customFields: {
          quickBid: { measurementId: m.id, provider: m.provider, itemIds: p.data.itemIds },
          taxSource: { source: tax.source, bps: tax.bps, matchedCity: tax.matchedCity ?? null },
        },
      } as any).returning();
      return row;
    });

    await db.insert(crmEstimateItems).values(lines.map((l, idx) => ({
      orgId: ctx.org.id, estimateId: est.id, sortOrder: idx,
      kind: "labor", name: l.item.name,
      description: quickBidLineDescription({
        sqftMilli: (l.metric === "roof" ? m.roofAreaSfMilli : m.wallAreaSfMilli) ?? 0,
        metric: l.metric, provider: m.provider,
        wasteBps: m.wasteSuggestionBps, rateCentsPerSqft: l.item.rateCentsPerSqft ?? 0,
        quote: takeoffQuoteDetail(takeoff, l.metric),
      }),
      quantityMilli: l.quantityMilli, unit: "sf",
      unitPriceCents: l.item.rateCentsPerSqft ?? 0,
      unitCostCents: l.item.flatCostCents ?? null,
      taxable: l.item.taxable,
    })) as any);

    // The org's "Add to all future estimates" files (never fails the bid).
    await attachDefaultFilesToEstimate(ctx.org.id, est.id);
    const fresh = await recalcEstimate(ctx.org.id, est.id);
    await logEvent(ctx.org.id, est.id, "created", ctx.member.id, req, {
      quickBid: true, measurementId: m.id,
    });

    const created = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, est.id)));

    res.status(201).json({
      estimate: presentEstimate(fresh ?? est, ctx),
      items: created.map((i) => presentEstimateItem(i, ctx)),
      measurement: {
        id: m.id, provider: m.provider,
        roofSqft: m.roofAreaSfMilli === null ? null : m.roofAreaSfMilli / 1000,
        sidingSqft: m.wallAreaSfMilli === null ? null : m.wallAreaSfMilli / 1000,
        wasteBps: m.wasteSuggestionBps,
        addressLine1: m.addressLine1, city: m.city, state: m.state,
      },
      customer: { id: cust.id, displayName: cust.displayName, email: cust.email },
    });
  });
}
