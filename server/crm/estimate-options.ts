/**
 * Estimate options, duplicates and templates (owner, 2026-10-21, after Housecall Pro's "Option #1 | Add option"
 * screen: "make sure we can duplicate options, save as template, etc").
 *
 * Options build on crm_estimate_options (the client-selectable scopes the public page already offers):
 *   - The popup edits all options as tabs. With two or more, every tab is an option row — Option 1 included
 *     (is_main), whose lines are also the estimate's own lines, so the document "as written" is Option 1.
 *     PUT /api/crm/estimates/:id/option-set replaces the tabbed set in one go (autosave), keeping row ids.
 *     Rows the set doesn't manage (legacy display tiers without lines) are left alone.
 *   - Cancel option: cancelled_at — hidden from the client, kept and struck through for the team.
 *   - Rename / duplicate (deep copy, new id) / copy to a new estimate (same or another client) / delete.
 *   - Customer can approve "Only one option" or "Any options" (custom_fields.optionApproval, default any): the
 *     public page lets the client pick accordingly and select-options (portal.ts) enforces it.
 *   - Duplicate estimate / copy to another client: a new DRAFT with the lines, options, discount offers and message.
 *
 * Templates: crm_estimate_templates per org — name, title, message, lines (scopes included), discount offers and
 * the contractor discount. A separate table from the price-book packages on purpose: a package is a list of
 * price-book item ids priced live when used; a template is a frozen document (free-typed lines, scope text, adjusted
 * prices, discounts, message) — the two do different jobs, so packages are untouched.
 */
import { cleanOfferConditions } from "@shared/discount-presets";
import type { Express } from "express";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { db, pool } from "../db";
import {
  CRM_LINE_ITEM_KINDS, crmCustomers, crmEstimateDiscounts, crmEstimateItems, crmEstimateOptions, crmEstimates,
} from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { logEvent, nextDocNumber, presentEstimate, recalcEstimate } from "./entities";
import { computeApprovalTotals } from "@shared/estimate-totals";
import { SCOPE_CATEGORIES } from "@shared/scope-category";
import { estimateDefaultsFromOrg } from "./doc-defaults";
import { resolveEstimateTaxRate, taxSourceRecord } from "./tax";
import { logActivity } from "./activity";

type GetUser = (req: any, res: any) => any;

export { ESTIMATE_OPTIONS_DDL } from "./estimate-options-schema";


export const optionLineSchema = z.object({
  kind: z.enum(CRM_LINE_ITEM_KINDS as unknown as [string, ...string[]]).default("labor"),
  name: z.string().min(1).max(300),
  description: z.string().max(8000).nullable().optional(),
  quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
  unit: z.string().max(20).nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(1_000_000_00).default(0),
  unitCostCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  taxable: z.boolean().default(true),
  hiddenFromClient: z.boolean().default(false),
  pricebookItemId: z.string().max(64).nullable().optional(),
  scopeCategory: z.enum(SCOPE_CATEGORIES as unknown as [string, ...string[]]).nullable().optional(),
});
type OptionLine = z.infer<typeof optionLineSchema>;

const offerSchema = z.object({
  code: z.string().min(1).max(40), label: z.string().min(1).max(120),
  percentBps: z.number().int().min(0).max(10_000), conditions: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true), rule: z.any().optional(),
});

/** Totals of one option at the estimate's tax rate (shared math: tax after line discounts). */
export function optionTotals(items: OptionLine[], taxRateBps: number) {
  const t = computeApprovalTotals(items.map((i) => ({
    kind: i.kind, unitPriceCents: i.unitPriceCents, quantityMilli: i.quantityMilli, taxable: i.taxable !== false,
  })), taxRateBps, []);
  return { subtotalCents: t.subtotalCents, totalCents: t.totalCents };
}

/** Deep copy of option lines (fresh objects; nothing shared with the source). */
const copyLines = (items: unknown): OptionLine[] =>
  (Array.isArray(items) ? items : []).map((i: any) => optionLineSchema.parse({ ...i, name: String(i?.name ?? "Item").slice(0, 300) || "Item" }));

const editGuard = (est: typeof crmEstimates.$inferSelect, res: any): boolean => {
  if (est.approvedAt || est.declinedAt) {
    res.status(409).json({ message: "This estimate has already been responded to and can no longer be edited." });
    return false;
  }
  return true;
};

export function presentOptionRow(o: typeof crmEstimateOptions.$inferSelect, ctx: OrgContext) {
  const prices = ctx.permissions.seePrices, costs = ctx.permissions.seeCosts;
  return {
    id: o.id, name: o.name, tier: o.tier, description: o.description, recommended: o.recommended, showTotal: o.showTotal,
    isMain: (o as any).isMain ?? false, cancelledAt: (o as any).cancelledAt ?? null, selectedAt: o.selectedAt,
    subtotalCents: prices ? o.subtotalCents : undefined, totalCents: prices ? o.totalCents : undefined,
    items: Array.isArray(o.items) ? (o.items as any[]).map((i) => ({
      ...i, unitPriceCents: prices ? i.unitPriceCents : undefined, unitCostCents: costs ? i.unitCostCents : undefined,
    })) : o.items,
  };
}

/**
 * Create a new DRAFT estimate from lines (+ options, offers, message) for a client of the org. Tax: the source's
 * rate for the same client; for another client, the rate their address resolves to (tax.ts).
 */
async function createDraftCopy(ctx: OrgContext, src: typeof crmEstimates.$inferSelect, args: {
  customerId: string; title: string; items: OptionLine[]; options?: Array<{ name: string; items: OptionLine[]; isMain: boolean; cancelledAt: Date | null; tier: number }>;
  copyOffersFrom?: string | null; reason: string;
}) {
  let taxRateBps = src.taxRateBps;
  let taxSource: unknown = (src.customFields as any)?.taxSource ?? null;
  if (args.customerId !== src.customerId) {
    const r = await resolveEstimateTaxRate(ctx.org.id, { customerId: args.customerId });
    taxRateBps = r.bps;
    taxSource = taxSourceRecord(r);
  }
  const est = await db.transaction(async (tx) => {
    const number = await nextDocNumber(tx, crmEstimates, ctx.org.id, "E");
    const [row] = await tx.insert(crmEstimates).values({
      orgId: ctx.org.id, customerId: args.customerId, projectId: args.customerId === src.customerId ? src.projectId : null,
      divisionId: src.divisionId, number, title: args.title.slice(0, 200) || "Estimate",
      introText: src.introText, termsText: src.termsText,
      ...estimateDefaultsFromOrg(ctx.org),
      taxRateBps, publicToken: randomBytes(24).toString("hex"), createdByMemberId: ctx.member.id, status: "draft",
      customFields: {
        copiedFrom: { estimateId: src.id, number: src.number ?? null, reason: args.reason },
        ...(taxSource ? { taxSource } : {}),
        ...((src.customFields as any)?.optionApproval ? { optionApproval: (src.customFields as any).optionApproval } : {}),
      },
    } as any).returning();
    return row;
  });
  if (args.items.length) {
    await db.insert(crmEstimateItems).values(args.items.map((i, idx) => ({ ...i, orgId: ctx.org.id, estimateId: est.id, sortOrder: idx })) as any);
  }
  for (const o of args.options ?? []) {
    const t = optionTotals(o.items, taxRateBps);
    await db.insert(crmEstimateOptions).values({
      orgId: ctx.org.id, estimateId: est.id, name: o.name, tier: o.tier, items: o.items, isMain: o.isMain,
      cancelledAt: o.cancelledAt, subtotalCents: t.subtotalCents, totalCents: t.totalCents, showTotal: true,
    } as any);
  }
  if (args.copyOffersFrom) {
    const offers = await db.select().from(crmEstimateDiscounts)
      .where(and(eq(crmEstimateDiscounts.orgId, ctx.org.id), eq(crmEstimateDiscounts.estimateId, args.copyOffersFrom)));
    if (offers.length) {
      await db.insert(crmEstimateDiscounts).values(offers.map((o) => ({
        orgId: ctx.org.id, estimateId: est.id, code: o.code, label: o.label, percentBps: o.percentBps,
        conditions: cleanOfferConditions(o.conditions), enabled: o.enabled, sortOrder: o.sortOrder, rule: (o as any).rule ?? null,
      })) as any);
    }
  }
  const fresh = await recalcEstimate(ctx.org.id, est.id);
  return fresh ?? est;
}

export function registerEstimateOptionRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }
  const loadEst = async (ctx: OrgContext, id: string) => {
    const [e] = await db.select().from(crmEstimates).where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, id))).limit(1);
    return e ?? null;
  };
  const loadOption = async (ctx: OrgContext, estId: string, optionId: string) => {
    const [o] = await db.select().from(crmEstimateOptions).where(and(
      eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, estId), eq(crmEstimateOptions.id, optionId))).limit(1);
    return o ?? null;
  };
  const customerOk = async (ctx: OrgContext, customerId: string) => {
    const [c] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, customerId))).limit(1);
    return !!c;
  };

  /**
   * The popup's tabs, saved together (autosave). `options` in tab order; the first is Option 1 (is_main). With fewer
   * than two tabs the estimate is a plain estimate again: every tabbed row is removed. Rows without lines (legacy
   * display tiers) are not touched. Returns the rows (ids for the client).
   */
  app.put("/api/crm/estimates/:id/option-set", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({
      options: z.array(z.object({
        id: z.string().max(64).nullable().optional(),
        name: z.string().min(1).max(80),
        items: z.array(optionLineSchema).max(300),
        cancelled: z.boolean().default(false),
      })).max(12),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid options", issues: parsed.error.issues });
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!editGuard(est, res)) return;
    const existing = await db.select().from(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, est.id)));
    // Every row this route wrote is managed, an empty new tab included (items = []); only legacy
    // display-only tiers (items null) are left alone. Skipping empty rows left orphan $0 options behind.
    const managed = existing.filter((o) => Array.isArray(o.items) || (o as any).isMain);
    const want = parsed.data.options.length >= 2 ? parsed.data.options : [];
    const keep = new Set(want.map((o) => o.id).filter(Boolean) as string[]);
    for (const o of managed) {
      if (!keep.has(o.id)) await db.delete(crmEstimateOptions).where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.id, o.id)));
    }
    const byId = new Map(managed.map((o) => [o.id, o]));
    for (const [idx, o] of want.entries()) {
      const t = optionTotals(o.items, est.taxRateBps);
      const values = {
        name: o.name, tier: idx + 1, items: o.items, isMain: idx === 0,
        cancelledAt: o.cancelled ? ((o.id && (byId.get(o.id) as any)?.cancelledAt) || new Date()) : null,
        subtotalCents: t.subtotalCents, totalCents: t.totalCents, showTotal: true,
      };
      if (o.id && byId.has(o.id)) {
        await db.update(crmEstimateOptions).set(values as any).where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.id, o.id)));
      } else {
        await db.insert(crmEstimateOptions).values({ ...values, orgId: ctx.org.id, estimateId: est.id } as any);
      }
    }
    const rows = await db.select().from(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, est.id)))
      .orderBy(asc(crmEstimateOptions.tier));
    res.json({ options: rows.map((o) => presentOptionRow(o, ctx)) });
  });

  /** Rename, cancel (hidden from the client) or restore one option. */
  app.patch("/api/crm/estimates/:id/options/:optionId", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ name: z.string().min(1).max(80).optional(), cancelled: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid option", issues: parsed.error.issues });
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!editGuard(est, res)) return;
    const o = await loadOption(ctx, est.id, req.params.optionId);
    if (!o) return res.status(404).json({ message: "Option not found" });
    const patch: any = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.cancelled !== undefined) patch.cancelledAt = parsed.data.cancelled ? new Date() : null;
    const [row] = await db.update(crmEstimateOptions).set(patch).where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.id, o.id))).returning();
    res.json(presentOptionRow(row, ctx));
  });

  /** Copy to a new option: a deep copy with its own id, right after the source. */
  app.post("/api/crm/estimates/:id/options/:optionId/duplicate", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!editGuard(est, res)) return;
    const o = await loadOption(ctx, est.id, req.params.optionId);
    if (!o) return res.status(404).json({ message: "Option not found" });
    const all = await db.select().from(crmEstimateOptions).where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, est.id)));
    const items = copyLines(o.items);
    const t = optionTotals(items, est.taxRateBps);
    const [row] = await db.insert(crmEstimateOptions).values({
      orgId: ctx.org.id, estimateId: est.id, name: `${o.name} (copy)`.slice(0, 80), tier: Math.max(0, ...all.map((x) => x.tier)) + 1,
      description: o.description, items, isMain: false, showTotal: o.showTotal, recommended: false,
      subtotalCents: t.subtotalCents, totalCents: t.totalCents,
    } as any).returning();
    res.status(201).json(presentOptionRow(row, ctx));
  });

  /** Copy one option to a new draft estimate — same client, or another client of the org. */
  app.post("/api/crm/estimates/:id/options/:optionId/copy-to-estimate", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ customerId: z.string().max(64).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    const o = await loadOption(ctx, est.id, req.params.optionId);
    if (!o) return res.status(404).json({ message: "Option not found" });
    const customerId = parsed.data.customerId || est.customerId;
    if (!(await customerOk(ctx, customerId))) return res.status(400).json({ message: "Client not found in this organization" });
    const fresh = await createDraftCopy(ctx, est, {
      customerId, title: o.name === "Option 1" ? est.title : o.name, items: copyLines(o.items),
      copyOffersFrom: est.id, reason: "option",
    });
    await logEvent(ctx.org.id, fresh.id, "created", ctx.member.id, req, { copiedFrom: est.number, option: o.name });
    logActivity(ctx, "estimate.created", { entityType: "estimate", entityId: fresh.id, customerId, meta: { number: fresh.number, copiedFrom: est.number } });
    res.status(201).json(presentEstimate(fresh, ctx));
  });

  /** Duplicate the whole estimate (lines, options, offers, message) — for this client or another. */
  app.post("/api/crm/estimates/:id/duplicate", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ customerId: z.string().max(64).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    const customerId = parsed.data.customerId || est.customerId;
    if (!(await customerOk(ctx, customerId))) return res.status(400).json({ message: "Client not found in this organization" });
    const items = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, est.id))).orderBy(asc(crmEstimateItems.sortOrder));
    const options = await db.select().from(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, est.id))).orderBy(asc(crmEstimateOptions.tier));
    const fresh = await createDraftCopy(ctx, est, {
      customerId, title: customerId === est.customerId ? `${est.title} (copy)` : est.title,
      items: copyLines(items),
      options: options.filter((o) => Array.isArray(o.items) && (o.items as any[]).length).map((o) => ({
        name: o.name, items: copyLines(o.items), isMain: !!(o as any).isMain, cancelledAt: (o as any).cancelledAt ?? null, tier: o.tier,
      })),
      copyOffersFrom: est.id, reason: customerId === est.customerId ? "duplicate" : "copy_to_client",
    });
    await logEvent(ctx.org.id, fresh.id, "created", ctx.member.id, req, { copiedFrom: est.number });
    logActivity(ctx, "estimate.created", { entityType: "estimate", entityId: fresh.id, customerId, meta: { number: fresh.number, copiedFrom: est.number } });
    res.status(201).json(presentEstimate(fresh, ctx));
  });

  /** Customer can approve: only one option, or any options (enforced by select-options in portal.ts). */
  app.put("/api/crm/estimates/:id/option-approval", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ mode: z.enum(["one", "any"]) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "mode must be one or any" });
    const est = await loadEst(ctx, req.params.id);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!editGuard(est, res)) return;
    await db.update(crmEstimates).set({
      customFields: { ...((est.customFields as Record<string, unknown>) ?? {}), optionApproval: parsed.data.mode },
    } as any).where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, est.id)));
    res.json({ optionApproval: parsed.data.mode });
  });

  // ── Templates ──────────────────────────────────────────────────────────────
  const templateSchema = z.object({
    name: z.string().min(1).max(120),
    title: z.string().max(200).nullable().optional(),
    introText: z.string().max(8000).nullable().optional(),
    items: z.array(optionLineSchema).max(300),
    offers: z.array(offerSchema).max(20).nullable().optional(),
    contractorDiscount: z.object({ mode: z.enum(["amount", "percent"]), value: z.string().max(20), label: z.string().max(120) }).nullable().optional(),
  });
  const presentTemplate = (t: any, ctx: OrgContext) => ({
    id: t.id, name: t.name, title: t.title, introText: t.intro_text, offers: t.offers ?? null,
    contractorDiscount: t.contractor_discount ?? null, createdAt: t.created_at, updatedAt: t.updated_at,
    items: (Array.isArray(t.items) ? t.items : []).map((i: any) => ({
      ...i, unitPriceCents: ctx.permissions.seePrices ? i.unitPriceCents : undefined, unitCostCents: ctx.permissions.seeCosts ? i.unitCostCents : undefined,
    })),
  });

  app.get("/api/crm/estimate-templates", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const r = await pool.query(`SELECT * FROM crm_estimate_templates WHERE org_id = $1 ORDER BY lower(name)`, [ctx.org.id]);
    res.json(r.rows.map((t) => presentTemplate(t, ctx)));
  });

  app.post("/api/crm/estimate-templates", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = templateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid template", issues: parsed.error.issues });
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO crm_estimate_templates (id, org_id, name, title, intro_text, items, offers, contractor_discount, created_by_member_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9) RETURNING *`,
      [randomUUID(), ctx.org.id, d.name, d.title ?? null, d.introText ?? null, JSON.stringify(d.items),
        d.offers ? JSON.stringify(d.offers) : null, d.contractorDiscount ? JSON.stringify(d.contractorDiscount) : null, ctx.member.id],
    );
    logActivity(ctx, "pricebook.updated", { entityType: "estimate_template", entityId: r.rows[0].id, meta: { change: "template_saved", name: d.name } });
    res.status(201).json(presentTemplate(r.rows[0], ctx));
  });

  app.delete("/api/crm/estimate-templates/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const r = await pool.query(`DELETE FROM crm_estimate_templates WHERE org_id = $1 AND id = $2 RETURNING id`, [ctx.org.id, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message: "Template not found" });
    res.json({ ok: true });
  });
}
