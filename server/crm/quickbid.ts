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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { resolveEstimateTaxRate } from "./tax";
import { logEvent, presentEstimate, presentEstimateItem, recalcEstimate } from "./entities";
import { inferSqftMetric, quickBidLine, type SqftMetric } from "./quickbid-math";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");

export type { SqftMetric } from "./quickbid-math";
export { inferSqftMetric, quickBidLine } from "./quickbid-math";

/** "2,210 sq ft siding area from the hover report + 12% waste × $4.50/sq ft" */
function lineDescription(args: {
  sqftMilli: number; metric: SqftMetric; provider: string;
  wasteBps: number | null; rateCentsPerSqft: number;
}): string {
  const sqft = (args.sqftMilli / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const waste = args.wasteBps ? ` + ${(args.wasteBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% waste` : "";
  const rate = (args.rateCentsPerSqft / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  return `${sqft} sq ft ${args.metric} area from the ${args.provider} report${waste} × $${rate}/sq ft`;
}

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
      const { quantityMilli, lineTotalCents } = quickBidLine({
        rateCentsPerSqft: item.rateCentsPerSqft, sqftMilli, wasteBps: m.wasteSuggestionBps,
      });
      lines.push({ item, metric, quantityMilli, lineTotalCents });
    }

    // Tax resolves exactly the way the estimate-create route resolves it
    // (the tax.ts hook only fires on POST /api/crm/estimates, so do it here).
    const tax = await resolveEstimateTaxRate(ctx.org.id, { customerId: cust.id });

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmEstimates)
      .where(eq(crmEstimates.orgId, ctx.org.id));
    const names = lines.map((l) => l.item.name);
    const title = (p.data.title?.trim() || `Quick Bid — ${names.join(" + ")}`).slice(0, 200);

    const [est] = await db.insert(crmEstimates).values({
      orgId: ctx.org.id, customerId: cust.id, projectId: null,
      number: `E-${1000 + n + 1}`, title,
      introText: null, termsText: ctx.org.termsAndConditions ?? null,
      taxRateBps: tax.bps, publicToken: token(), createdByMemberId: ctx.member.id,
      customFields: {
        quickBid: { measurementId: m.id, provider: m.provider, itemIds: p.data.itemIds },
        taxSource: { source: tax.source, bps: tax.bps, matchedCity: tax.matchedCity ?? null },
      },
    } as any).returning();

    await db.insert(crmEstimateItems).values(lines.map((l, idx) => ({
      orgId: ctx.org.id, estimateId: est.id, sortOrder: idx,
      kind: "labor", name: l.item.name,
      description: lineDescription({
        sqftMilli: (l.metric === "roof" ? m.roofAreaSfMilli : m.wallAreaSfMilli) ?? 0,
        metric: l.metric, provider: m.provider,
        wasteBps: m.wasteSuggestionBps, rateCentsPerSqft: l.item.rateCentsPerSqft ?? 0,
      }),
      quantityMilli: l.quantityMilli, unit: "sf",
      unitPriceCents: l.item.rateCentsPerSqft ?? 0,
      unitCostCents: l.item.flatCostCents ?? null,
      taxable: l.item.taxable,
    })) as any);

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
