/**
 * Price book: categories, materials, labor rates, assemblies, accessories,
 * packages — plus the expander that turns "32 squares of re-roof" into the ten
 * lines a real estimate needs.
 *
 * Design notes in analysis/PRICE-BOOK-RESEARCH.md. Short version: HCP's
 * cost+price assembly spine, Leap's formula engine, and an explicit waste factor
 * that neither of them has.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmPbCategories, crmPbLaborRates, crmPbMaterials, crmPbItems, crmPbItemParts,
  crmPbItemAccessories, crmPbPackages, crmPbPackageItems, crmEstimates, crmEstimateItems,
  crmEstimateOptions,
  CRM_PB_PRICING_MODES, CRM_PB_UNITS, CRM_PB_SYMBOLS,
  crmMeasurements, CRM_MEASUREMENT_PROVIDERS,
  crmOrgs,
} from "@shared/schema";
import { and, eq, asc, desc, ilike, or, sql } from "drizzle-orm";
import { requireOrg, requireOwnerRole, requirePermission, type OrgContext } from "./tenancy";
import { logActivity } from "./activity";
import { evalFormula, validateFormula, formulaSymbols, FormulaError } from "./formula";
import { priceFloorLockOf } from "./price-floor";

type GetUser = (req: any, res: any) => any;

/** Cost is privileged; price is not. Same rule as everywhere else. */
const presentMaterial = (m: any, ctx: OrgContext) => ({
  ...m, costCents: ctx.permissions.seeCosts ? m.costCents : undefined,
  priceCents: ctx.permissions.seePrices ? m.priceCents : undefined,
});
const presentLabor = (l: any, ctx: OrgContext) => ({
  ...l, hourlyCostCents: ctx.permissions.seeCosts ? l.hourlyCostCents : undefined,
  hourlyPriceCents: ctx.permissions.seePrices ? l.hourlyPriceCents : undefined,
});

export type ExpandedLine = {
  kind: string; name: string; description: string | null;
  quantityMilli: number; unit: string | null;
  unitPriceCents: number; unitCostCents: number | null;
  taxable: boolean; costCodeId: string | null; source: string;
};

/**
 * Expand one assembly into estimate lines.
 *
 * `qty` is how many of the assembly's own unit (e.g. 32 squares). Each part's
 * quantity is per-one-assembly-unit, optionally overridden by a per-part
 * formula, then multiplied by the material's waste factor.
 */
export async function expandItem(
  orgId: string, itemId: string, qtyMilli: number, symbols: Record<string, number> = {},
): Promise<{ lines: ExpandedLine[]; totalPriceCents: number; totalCostCents: number; warnings: string[] }> {
  const warnings: string[] = [];
  const [item] = await db.select().from(crmPbItems)
    .where(and(eq(crmPbItems.orgId, orgId), eq(crmPbItems.id, itemId))).limit(1);
  if (!item) throw new Error("Price book item not found");

  const qty = qtyMilli / 1000;
  const baseSymbols: Record<string, number> = { QTY: qty, ...symbols };

  // formula mode recomputes the assembly quantity itself
  let effectiveQty = qty;
  if (item.pricingMode === "formula" && item.qtyFormula) {
    try {
      effectiveQty = evalFormula(item.qtyFormula, baseSymbols);
    } catch (e: any) {
      warnings.push(`Formula on "${item.name}" failed (${e.message}); used the raw quantity.`);
    }
  }

  const lines: ExpandedLine[] = [];

  // Flat and percentage assemblies are a single line — no expansion.
  if (item.pricingMode === "flat" || item.pricingMode === "percentage") {
    const unitPrice = item.flatPriceCents ?? 0;
    lines.push({
      kind: "labor", name: item.name, description: item.description,
      quantityMilli: Math.round(effectiveQty * 1000), unit: item.unit,
      unitPriceCents: unitPrice, unitCostCents: item.flatCostCents ?? null,
      taxable: item.taxable, costCodeId: item.costCodeId, source: `item:${item.id}`,
    });
  } else {
    const parts = await db.select().from(crmPbItemParts)
      .where(and(eq(crmPbItemParts.orgId, orgId), eq(crmPbItemParts.itemId, item.id)))
      .orderBy(asc(crmPbItemParts.sortOrder));
    if (!parts.length) {
      warnings.push(`"${item.name}" has no materials or labor yet, so it expanded to nothing.`);
    }
    for (const p of parts) {
      let perUnit = p.quantityMilli / 1000;
      if (p.qtyFormula) {
        try { perUnit = evalFormula(p.qtyFormula, baseSymbols); }
        catch (e: any) { warnings.push(`Part formula failed (${e.message}); used its fixed quantity.`); }
      }
      if (p.materialId) {
        const [m] = await db.select().from(crmPbMaterials).where(eq(crmPbMaterials.id, p.materialId)).limit(1);
        if (!m) { warnings.push("A material on this assembly no longer exists and was skipped."); continue; }
        // Waste applies to QUANTITY, not price — that's what a waste factor is.
        const waste = 1 + (m.wasteFactorBps ?? 0) / 10000;
        lines.push({
          kind: "material", name: m.name,
          description: [m.sku, m.description].filter(Boolean).join(" · ") || null,
          quantityMilli: Math.round(effectiveQty * perUnit * waste * 1000),
          unit: m.unit, unitPriceCents: m.priceCents, unitCostCents: m.costCents,
          taxable: m.taxable, costCodeId: item.costCodeId, source: `material:${m.id}`,
        });
      } else if (p.laborRateId) {
        const [l] = await db.select().from(crmPbLaborRates).where(eq(crmPbLaborRates.id, p.laborRateId)).limit(1);
        if (!l) { warnings.push("A labor rate on this assembly no longer exists and was skipped."); continue; }
        const hours = (p.hoursMilli ?? p.quantityMilli) / 1000;
        lines.push({
          kind: "labor", name: `${l.name} — ${item.name}`, description: null,
          quantityMilli: Math.round(effectiveQty * hours * 1000), unit: "hr",
          unitPriceCents: l.hourlyPriceCents, unitCostCents: l.hourlyCostCents,
          taxable: item.taxable, costCodeId: item.costCodeId, source: `labor:${l.id}`,
        });
      }
    }
  }

  let totalPriceCents = lines.reduce((s, l) => s + Math.round((l.unitPriceCents * l.quantityMilli) / 1000), 0);
  const totalCostCents = lines.reduce((s, l) => s + Math.round(((l.unitCostCents ?? 0) * l.quantityMilli) / 1000), 0);

  // Markup only applies when the parts priced to nothing — otherwise the
  // material/labor prices already carry the margin and marking up again would
  // double-charge.
  if (item.markupBps && totalPriceCents === 0 && totalCostCents > 0) {
    totalPriceCents = Math.round(totalCostCents * (1 + item.markupBps / 10000));
    if (lines.length) lines[0].unitPriceCents = Math.round((totalPriceCents * 1000) / (lines[0].quantityMilli || 1000));
  }
  if (item.minChargeCents && totalPriceCents < item.minChargeCents) {
    warnings.push(`Minimum charge of $${(item.minChargeCents / 100).toFixed(2)} applied to "${item.name}".`);
    lines.push({
      kind: "fee", name: `Minimum charge — ${item.name}`, description: null,
      quantityMilli: 1000, unit: "job",
      unitPriceCents: item.minChargeCents - totalPriceCents, unitCostCents: 0,
      taxable: item.taxable, costCodeId: item.costCodeId, source: `min:${item.id}`,
    });
    totalPriceCents = item.minChargeCents;
  }

  return { lines, totalPriceCents, totalCostCents, warnings };
}

export function registerCrmPriceBookRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  // ── Price-floor lock (org setting, owner only) ────────────────────────────
  // Lives in custom_fields->'priceFloorLock' — merged, never a wholesale
  // replace, like notificationPrefs on PATCH /api/crm/org (routes.ts, which
  // this lane does not touch). Enforcement is in entities.ts/discounts.ts;
  // the owner's price chart and discounts stay editable regardless.
  app.put("/api/crm/org/price-floor-lock", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const p = z.object({
      enabled: z.boolean(),
      floorBps: z.number().int().min(0).max(10_000).nullable().optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid price-floor lock", issues: p.error.issues });

    const base = { ...((ctx.org.customFields as Record<string, unknown> | null) ?? {}) };
    base.priceFloorLock = {
      enabled: p.data.enabled,
      ...(p.data.floorBps != null ? { floorBps: p.data.floorBps } : {}),
    };
    const [row] = await db.update(crmOrgs)
      .set({ customFields: base, updatedAt: new Date() })
      .where(eq(crmOrgs.id, ctx.org.id))
      .returning();
    res.json({ ...row, priceFloorLock: priceFloorLockOf(row?.customFields) });
  });

  // ── Reference data ────────────────────────────────────────────────────────

  app.get("/api/crm/pricebook/meta", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    res.json({
      units: CRM_PB_UNITS, pricingModes: CRM_PB_PRICING_MODES, symbols: CRM_PB_SYMBOLS,
      formulaHelp: 'Use [SYMBOL] tokens and + - * / % ( ) with min, max, ceil, floor, round. Example: ceil([SQUARES] * (1 + [WASTE]/100))',
    });
  });

  app.get("/api/crm/pricebook/categories", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmPbCategories)
      .where(eq(crmPbCategories.orgId, ctx.org.id)).orderBy(asc(crmPbCategories.sortOrder));
    res.json(rows);
  });

  app.post("/api/crm/pricebook/categories", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = z.object({
      name: z.string().min(1).max(120),
      parentId: z.string().max(64).nullable().optional(),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid category", issues: p.error.issues });
    const [row] = await db.insert(crmPbCategories).values({ ...p.data, orgId: ctx.org.id } as any).returning();
    res.status(201).json(row);
  });

  app.get("/api/crm/pricebook/labor-rates", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmPbLaborRates)
      .where(and(eq(crmPbLaborRates.orgId, ctx.org.id), eq(crmPbLaborRates.active, true)))
      .orderBy(desc(crmPbLaborRates.isDefault), asc(crmPbLaborRates.name));
    res.json(rows.map((l) => presentLabor(l, ctx)));
  });

  app.post("/api/crm/pricebook/labor-rates", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = z.object({
      name: z.string().min(1).max(120),
      hourlyCostCents: z.number().int().min(0).max(100_000_00).default(0),
      hourlyPriceCents: z.number().int().min(0).max(100_000_00).default(0),
      isDefault: z.boolean().default(false),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid labor rate", issues: p.error.issues });
    if (p.data.isDefault) {
      await db.update(crmPbLaborRates).set({ isDefault: false }).where(eq(crmPbLaborRates.orgId, ctx.org.id));
    }
    const [row] = await db.insert(crmPbLaborRates).values({ ...p.data, orgId: ctx.org.id } as any).returning();
    res.status(201).json(presentLabor(row, ctx));
  });

  // ── Materials ─────────────────────────────────────────────────────────────

  app.get("/api/crm/pricebook/materials", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const q = String(req.query.q || "").trim();
    const where = [eq(crmPbMaterials.orgId, ctx.org.id), eq(crmPbMaterials.active, true)];
    if (q) where.push(or(ilike(crmPbMaterials.name, `%${q}%`), ilike(crmPbMaterials.sku, `%${q}%`)) as any);
    if (req.query.categoryId) where.push(eq(crmPbMaterials.categoryId, String(req.query.categoryId)));
    const rows = await db.select().from(crmPbMaterials).where(and(...where))
      .orderBy(asc(crmPbMaterials.name)).limit(500);
    res.json(rows.map((m) => presentMaterial(m, ctx)));
  });

  const materialSchema = z.object({
    name: z.string().min(1).max(200),
    sku: z.string().max(80).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    categoryId: z.string().max(64).nullable().optional(),
    unit: z.enum(CRM_PB_UNITS as unknown as [string, ...string[]]).default("ea"),
    costCents: z.number().int().min(0).max(10_000_000_00).default(0),
    priceCents: z.number().int().min(0).max(10_000_000_00).default(0),
    wasteFactorBps: z.number().int().min(0).max(10000).default(0),
    taxable: z.boolean().default(true),
    supplier: z.string().max(40).nullable().optional(),
    supplierSku: z.string().max(80).nullable().optional(),
  });

  app.post("/api/crm/pricebook/materials", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = materialSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid material", issues: p.error.issues });
    const [row] = await db.insert(crmPbMaterials)
      .values({ ...p.data, orgId: ctx.org.id, costUpdatedAt: new Date() } as any).returning();
    res.status(201).json(presentMaterial(row, ctx));
  });

  app.patch("/api/crm/pricebook/materials/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = materialSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid material", issues: p.error.issues });
    const patch: any = { ...p.data, updatedAt: new Date() };
    if (p.data.costCents !== undefined) patch.costUpdatedAt = new Date();
    const [row] = await db.update(crmPbMaterials).set(patch)
      .where(and(eq(crmPbMaterials.orgId, ctx.org.id), eq(crmPbMaterials.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Material not found" });
    res.json(presentMaterial(row, ctx));
  });

  /** Bulk price/cost adjustment — HCP's "Service Price Adjuster". */
  app.post("/api/crm/pricebook/materials/adjust", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = z.object({
      field: z.enum(["price", "cost"]).default("price"),
      direction: z.enum(["increase", "decrease"]).default("increase"),
      percentBps: z.number().int().min(0).max(50000),
      categoryId: z.string().max(64).nullable().optional(),
      roundToDollar: z.boolean().default(false),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid adjustment", issues: p.error.issues });
    const f = p.data.field === "price" ? crmPbMaterials.priceCents : crmPbMaterials.costCents;
    const mult = 1 + (p.data.direction === "increase" ? 1 : -1) * p.data.percentBps / 10000;
    const where = [eq(crmPbMaterials.orgId, ctx.org.id), eq(crmPbMaterials.active, true)];
    if (p.data.categoryId) where.push(eq(crmPbMaterials.categoryId, p.data.categoryId));
    // The multiplier must be cast to numeric explicitly: Drizzle infers the
    // bind type from the integer column and Postgres then rejects "1.07".
    const m = sql`${String(mult)}::numeric`;
    const expr = p.data.roundToDollar
      ? sql`greatest(0, round(${f}::numeric * ${m} / 100.0) * 100)::int`
      : sql`greatest(0, round(${f}::numeric * ${m}))::int`;
    const rows = await db.update(crmPbMaterials)
      .set(p.data.field === "price" ? { priceCents: expr as any, updatedAt: new Date() }
                                    : { costCents: expr as any, updatedAt: new Date() })
      .where(and(...where)).returning({ id: crmPbMaterials.id });
    res.json({ ok: true, updated: rows.length });
  });

  // ── Assemblies ────────────────────────────────────────────────────────────

  const itemSchema = z.object({
    name: z.string().min(1).max(200),
    code: z.string().max(60).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    categoryId: z.string().max(64).nullable().optional(),
    unit: z.enum(CRM_PB_UNITS as unknown as [string, ...string[]]).default("ea"),
    pricingMode: z.enum(CRM_PB_PRICING_MODES as unknown as [string, ...string[]]).default("computed"),
    flatPriceCents: z.number().int().min(0).nullable().optional(),
    flatCostCents: z.number().int().min(0).nullable().optional(),
    percentBps: z.number().int().min(0).max(100000).nullable().optional(),
    qtyFormula: z.string().max(500).nullable().optional(),
    placeholders: z.array(z.object({
      symbol: z.string().max(30), label: z.string().max(80).optional(),
      defaultValue: z.number().optional(),
    })).max(20).nullable().optional(),
    markupBps: z.number().int().min(0).max(100000).default(0),
    minChargeCents: z.number().int().min(0).nullable().optional(),
    taxable: z.boolean().default(true),
    costCodeId: z.string().max(64).nullable().optional(),
    parts: z.array(z.object({
      materialId: z.string().max(64).nullable().optional(),
      laborRateId: z.string().max(64).nullable().optional(),
      quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
      hoursMilli: z.number().int().min(0).max(100_000_000).nullable().optional(),
      qtyFormula: z.string().max(500).nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
    })).max(200).optional(),
  });

  app.get("/api/crm/pricebook/items", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const q = String(req.query.q || "").trim();
    const where = [eq(crmPbItems.orgId, ctx.org.id), eq(crmPbItems.active, true)];
    if (q) where.push(or(ilike(crmPbItems.name, `%${q}%`), ilike(crmPbItems.code, `%${q}%`)) as any);
    if (req.query.categoryId) where.push(eq(crmPbItems.categoryId, String(req.query.categoryId)));
    const rows = await db.select().from(crmPbItems).where(and(...where))
      .orderBy(asc(crmPbItems.name)).limit(500);
    res.json(rows.map((i) => ({
      ...i,
      flatPriceCents: ctx.permissions.seePrices ? i.flatPriceCents : undefined,
      flatCostCents: ctx.permissions.seeCosts ? i.flatCostCents : undefined,
      formulaSymbols: i.qtyFormula ? formulaSymbols(i.qtyFormula) : [],
    })));
  });

  app.post("/api/crm/pricebook/items", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = itemSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid item", issues: p.error.issues });
    // Validate the formula before it can poison an estimate.
    if (p.data.qtyFormula) {
      const v = validateFormula(p.data.qtyFormula);
      if (!v.ok) return res.status(400).json({ message: `Formula error: ${v.error}` });
    }
    const { parts, ...item } = p.data;
    // SKU number: absent a typed code, assign the org's next sequential number
    // (1, 2, 3…). Custom text codes are left exactly as entered.
    let code = item.code?.trim() || null;
    if (!code) {
      const [r] = await db.select({ n: sql<number>`coalesce(max(${crmPbItems.code}::int), 0)` })
        .from(crmPbItems)
        .where(and(eq(crmPbItems.orgId, ctx.org.id), sql`${crmPbItems.code} ~ '^[0-9]{1,9}$'`));
      code = String(Number(r?.n ?? 0) + 1);
    }
    const [row] = await db.insert(crmPbItems).values({ ...item, code, orgId: ctx.org.id } as any).returning();
    if (parts?.length) {
      const bad = parts.find((x) => x.qtyFormula && !validateFormula(x.qtyFormula).ok);
      if (bad) return res.status(400).json({ message: `Part formula error in "${bad.qtyFormula}"` });
      await db.insert(crmPbItemParts).values(parts.map((x, i) => ({
        ...x, orgId: ctx.org.id, itemId: row.id, sortOrder: i,
      })) as any);
    }
    logActivity(ctx, "pricebook.updated", {
      entityType: "pricebook_item", entityId: row.id,
      meta: { change: "created", name: row.name, code: row.code },
    });
    res.status(201).json(row);
  });

  app.get("/api/crm/pricebook/items/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [item] = await db.select().from(crmPbItems)
      .where(and(eq(crmPbItems.orgId, ctx.org.id), eq(crmPbItems.id, req.params.id))).limit(1);
    if (!item) return res.status(404).json({ message: "Item not found" });
    const parts = await db.select().from(crmPbItemParts)
      .where(and(eq(crmPbItemParts.orgId, ctx.org.id), eq(crmPbItemParts.itemId, item.id)))
      .orderBy(asc(crmPbItemParts.sortOrder));
    const accessories = await db.select().from(crmPbItemAccessories)
      .where(and(eq(crmPbItemAccessories.orgId, ctx.org.id), eq(crmPbItemAccessories.itemId, item.id)));
    res.json({
      item: { ...item, formulaSymbols: item.qtyFormula ? formulaSymbols(item.qtyFormula) : [] },
      parts, accessories,
    });
  });

  app.patch("/api/crm/pricebook/items/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = itemSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid item", issues: p.error.issues });
    // Validate the formula before it can poison an estimate.
    if (p.data.qtyFormula) {
      const v = validateFormula(p.data.qtyFormula);
      if (!v.ok) return res.status(400).json({ message: `Formula error: ${v.error}` });
    }
    const { parts, ...patch } = p.data;
    const [row] = await db.update(crmPbItems).set({ ...patch, updatedAt: new Date() } as any)
      .where(and(eq(crmPbItems.orgId, ctx.org.id), eq(crmPbItems.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Item not found" });
    // Parts are replaced wholesale when supplied — a partial merge of "the
    // shingles line" against "the underlayment line" would be guesswork.
    if (parts) {
      const bad = parts.find((x) => x.qtyFormula && !validateFormula(x.qtyFormula).ok);
      if (bad) return res.status(400).json({ message: `Part formula error in "${bad.qtyFormula}"` });
      await db.delete(crmPbItemParts)
        .where(and(eq(crmPbItemParts.orgId, ctx.org.id), eq(crmPbItemParts.itemId, row.id)));
      if (parts.length) {
        await db.insert(crmPbItemParts).values(parts.map((x, i) => ({
          ...x, orgId: ctx.org.id, itemId: row.id, sortOrder: i,
        })) as any);
      }
    }
    logActivity(ctx, "pricebook.updated", {
      entityType: "pricebook_item", entityId: row.id,
      meta: { change: "updated", name: row.name, fields: Object.keys(patch) },
    });
    res.json(row);
  });

  /**
   * Soft delete. Estimate lines are value copies, but packages and accessories
   * reference the item by id and expandItem doesn't filter on active — so the
   * row stays and just leaves the active list, same rule as materials.
   */
  app.delete("/api/crm/pricebook/items/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const [row] = await db.update(crmPbItems).set({ active: false, updatedAt: new Date() })
      .where(and(eq(crmPbItems.orgId, ctx.org.id), eq(crmPbItems.id, req.params.id),
        eq(crmPbItems.active, true))).returning({ id: crmPbItems.id, name: crmPbItems.name });
    if (!row) return res.status(404).json({ message: "Item not found" });
    logActivity(ctx, "pricebook.updated", {
      entityType: "pricebook_item", entityId: row.id,
      meta: { change: "deleted", name: row.name },
    });
    res.json({ ok: true });
  });

  /**
   * Accessories — optional add-ons offered with a parent item (Leap's
   * accessories). The table existed and was read by GET items/:id but had no
   * write path; these two routes are it.
   */
  app.post("/api/crm/pricebook/items/:id/accessories", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = z.object({
      accessoryItemId: z.string().min(1),
      defaultIncluded: z.boolean().default(false),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid accessory", issues: p.error.issues });
    if (p.data.accessoryItemId === req.params.id) {
      return res.status(400).json({ message: "An item can't be its own accessory." });
    }
    // Both the parent and the accessory must be real items in this org.
    const items = await db.select({ id: crmPbItems.id }).from(crmPbItems)
      .where(and(eq(crmPbItems.orgId, ctx.org.id),
        or(eq(crmPbItems.id, req.params.id), eq(crmPbItems.id, p.data.accessoryItemId)) as any));
    if (items.length !== 2) return res.status(404).json({ message: "Item not found" });
    const dupe = await db.select({ id: crmPbItemAccessories.id }).from(crmPbItemAccessories)
      .where(and(eq(crmPbItemAccessories.orgId, ctx.org.id),
        eq(crmPbItemAccessories.itemId, req.params.id),
        eq(crmPbItemAccessories.accessoryItemId, p.data.accessoryItemId))).limit(1);
    if (dupe.length) return res.status(409).json({ message: "That accessory is already on this item." });
    const [row] = await db.insert(crmPbItemAccessories).values({
      ...p.data, orgId: ctx.org.id, itemId: req.params.id,
    } as any).returning();
    res.status(201).json(row);
  });

  app.delete("/api/crm/pricebook/items/:id/accessories/:accessoryId", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const gone = await db.delete(crmPbItemAccessories)
      .where(and(eq(crmPbItemAccessories.orgId, ctx.org.id),
        eq(crmPbItemAccessories.itemId, req.params.id),
        eq(crmPbItemAccessories.id, req.params.accessoryId))).returning({ id: crmPbItemAccessories.id });
    if (!gone.length) return res.status(404).json({ message: "Accessory not found" });
    res.json({ ok: true });
  });

  /** Dry-run an assembly. Lets the UI preview before anything is committed. */
  app.post("/api/crm/pricebook/items/:id/preview", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!ctx.permissions.seePrices) return res.status(403).json({ message: "Requires permission: seePrices" });
    const p = z.object({
      quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
      symbols: z.record(z.number()).optional(),
    }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Invalid preview request" });
    try {
      const r = await expandItem(ctx.org.id, req.params.id, p.data.quantityMilli, p.data.symbols ?? {});
      res.json({
        lines: r.lines.map((l) => ({ ...l, unitCostCents: ctx.permissions.seeCosts ? l.unitCostCents : undefined })),
        totalPriceCents: r.totalPriceCents,
        totalCostCents: ctx.permissions.seeCosts ? r.totalCostCents : undefined,
        marginBps: ctx.permissions.seeCosts && r.totalPriceCents > 0
          ? Math.round(((r.totalPriceCents - r.totalCostCents) / r.totalPriceCents) * 10000) : undefined,
        warnings: r.warnings,
      });
    } catch (e: any) {
      res.status(e instanceof FormulaError ? 400 : 500).json({ message: String(e?.message || e) });
    }
  });

  /** Test a formula without saving it. */
  app.post("/api/crm/pricebook/formula/test", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const p = z.object({
      formula: z.string().max(500),
      symbols: z.record(z.number()).default({}),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid request" });
    const v = validateFormula(p.data.formula);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
    try {
      res.json({ ok: true, result: evalFormula(p.data.formula, p.data.symbols),
                 symbols: formulaSymbols(p.data.formula) });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── Push an assembly onto an estimate ─────────────────────────────────────

  app.post("/api/crm/estimates/:id/add-item", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const p = z.object({
      itemId: z.string().min(1),
      quantityMilli: z.number().int().min(1).max(100_000_000).default(1000),
      symbols: z.record(z.number()).optional(),
      collapse: z.boolean().default(false),   // one summary line instead of the detail
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid request", issues: p.error.issues });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.approvedAt) return res.status(409).json({ message: "This estimate has been approved and can no longer be edited." });

    let r;
    try {
      r = await expandItem(ctx.org.id, p.data.itemId, p.data.quantityMilli, p.data.symbols ?? {});
    } catch (e: any) {
      return res.status(e instanceof FormulaError ? 400 : 404).json({ message: String(e?.message || e) });
    }

    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(sort_order),-1)+1` })
      .from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, est.id)));

    if (p.data.collapse) {
      const [pbItem] = await db.select().from(crmPbItems).where(eq(crmPbItems.id, p.data.itemId)).limit(1);
      await db.insert(crmEstimateItems).values({
        orgId: ctx.org.id, estimateId: est.id, sortOrder: Number(n) || 0,
        kind: "labor", name: pbItem?.name ?? "Assembly",
        description: pbItem?.description ?? null,
        quantityMilli: p.data.quantityMilli, unit: pbItem?.unit ?? null,
        unitPriceCents: Math.round((r.totalPriceCents * 1000) / (p.data.quantityMilli || 1000)),
        unitCostCents: Math.round((r.totalCostCents * 1000) / (p.data.quantityMilli || 1000)),
        taxable: pbItem?.taxable ?? true,
      } as any);
    } else {
      await db.insert(crmEstimateItems).values(r.lines.map((l, i) => ({
        orgId: ctx.org.id, estimateId: est.id, sortOrder: (Number(n) || 0) + i,
        kind: l.kind, name: l.name, description: l.description,
        quantityMilli: l.quantityMilli, unit: l.unit,
        unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents,
        taxable: l.taxable,
      })) as any);
    }

    const { recalcEstimate } = await import("./entities");
    const fresh = await recalcEstimate(ctx.org.id, est.id);
    res.status(201).json({
      linesAdded: p.data.collapse ? 1 : r.lines.length,
      warnings: r.warnings,
      estimateTotalCents: ctx.permissions.seePrices ? fresh?.totalCents : undefined,
    });
  });

  // ── Packages (good / better / best) ───────────────────────────────────────

  app.get("/api/crm/pricebook/packages", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmPbPackages)
      .where(and(eq(crmPbPackages.orgId, ctx.org.id), eq(crmPbPackages.active, true)))
      .orderBy(asc(crmPbPackages.tier));
    res.json(rows);
  });

  app.post("/api/crm/pricebook/packages", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const p = z.object({
      name: z.string().min(1).max(120), tier: z.number().int().min(1).max(9).default(1),
      description: z.string().max(4000).nullable().optional(),
      items: z.array(z.object({
        itemId: z.string().min(1), quantityMilli: z.number().int().min(1).default(1000),
      })).max(200).default([]),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid package", issues: p.error.issues });
    const { items, ...pkg } = p.data;
    const [row] = await db.insert(crmPbPackages).values({ ...pkg, orgId: ctx.org.id } as any).returning();
    if (items.length) {
      await db.insert(crmPbPackageItems).values(items.map((x, i) => ({
        ...x, orgId: ctx.org.id, packageId: row.id, sortOrder: i,
      })) as any);
    }
    res.status(201).json(row);
  });

  /**
   * Instantiate a package as a good/better/best option on an estimate — the
   * write side of the tier loop. The public estimate page already renders
   * options; until now they could only be created one-by-one by hand.
   * Prices the tier by expanding every package item, cents-exact, with tax on
   * the taxable base at the estimate's own rate.
   */
  app.post("/api/crm/estimates/:id/options/from-package", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const p = z.object({
      packageId: z.string().min(1),
      symbols: z.record(z.number()).optional(),
      recommended: z.boolean().default(false),
      // Default false, same as the manual options route: showing tier totals
      // up front leaked pricing and scared clients off (Leap's mistake).
      showTotal: z.boolean().default(false),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid request", issues: p.error.issues });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.approvedAt || est.declinedAt) {
      return res.status(409).json({ message: "This estimate has already been responded to and can no longer be edited." });
    }
    if (est.expiresAt && est.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "This estimate has expired." });
    }

    const [pkg] = await db.select().from(crmPbPackages)
      .where(and(eq(crmPbPackages.orgId, ctx.org.id), eq(crmPbPackages.id, p.data.packageId))).limit(1);
    if (!pkg) return res.status(404).json({ message: "Package not found" });
    const pkgItems = await db.select().from(crmPbPackageItems)
      .where(and(eq(crmPbPackageItems.orgId, ctx.org.id), eq(crmPbPackageItems.packageId, pkg.id)))
      .orderBy(asc(crmPbPackageItems.sortOrder));
    if (!pkgItems.length) return res.status(400).json({ message: "That package has no items." });

    let subtotal = 0, taxable = 0;
    const warnings: string[] = [];
    for (const pi of pkgItems) {
      let r;
      try {
        r = await expandItem(ctx.org.id, pi.itemId, pi.quantityMilli, p.data.symbols ?? {});
      } catch (e: any) {
        return res.status(400).json({ message: `A package item could not be priced: ${String(e?.message || e)}` });
      }
      warnings.push(...r.warnings);
      for (const l of r.lines) {
        const line = Math.round((l.unitPriceCents * l.quantityMilli) / 1000);
        subtotal += line;
        if (l.taxable) taxable += line;
      }
    }
    const tax = Math.round((taxable * (est.taxRateBps || 0)) / 10000);
    const [row] = await db.insert(crmEstimateOptions).values({
      orgId: ctx.org.id, estimateId: est.id, name: pkg.name, tier: pkg.tier,
      description: pkg.description ?? null, recommended: p.data.recommended,
      showTotal: p.data.showTotal, subtotalCents: subtotal, totalCents: subtotal + tax,
    } as any).returning();
    res.status(201).json({ option: row, warnings });
  });

  /** Seed a starter price book so the feature is usable before data entry. */
  app.post("/api/crm/pricebook/seed", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "managePriceBook");
    if (!ctx) return;
    const [cat] = await db.insert(crmPbCategories)
      .values({ orgId: ctx.org.id, name: "Roofing", sortOrder: 1 } as any).returning();
    const [labor] = await db.insert(crmPbLaborRates).values({
      orgId: ctx.org.id, name: "Roofing crew", hourlyCostCents: 4500,
      hourlyPriceCents: 9500, isDefault: true,
    } as any).returning();
    // Illustrative numbers only — the operator replaces these with real ones.
    const mats = await db.insert(crmPbMaterials).values([
      { orgId: ctx.org.id, categoryId: cat.id, name: "Architectural shingles", sku: "SHG-ARCH",
        unit: "sq", costCents: 11500, priceCents: 18500, wasteFactorBps: 1000, taxable: true },
      { orgId: ctx.org.id, categoryId: cat.id, name: "Synthetic underlayment", sku: "UND-SYN",
        unit: "sq", costCents: 2200, priceCents: 3800, wasteFactorBps: 500, taxable: true },
      { orgId: ctx.org.id, categoryId: cat.id, name: "Ice & water shield", sku: "IW-36",
        unit: "roll", costCents: 9800, priceCents: 15500, wasteFactorBps: 0, taxable: true },
      { orgId: ctx.org.id, categoryId: cat.id, name: "Drip edge", sku: "DRIP-10",
        unit: "lf", costCents: 180, priceCents: 320, wasteFactorBps: 500, taxable: true },
    ] as any).returning();

    const [asm] = await db.insert(crmPbItems).values({
      orgId: ctx.org.id, categoryId: cat.id, code: "RR-ARCH-1L",
      name: "Re-roof, architectural, 1 layer tear-off",
      description: "Tear off one layer, dispose, dry in, install architectural shingles.",
      unit: "sq", pricingMode: "computed", taxable: true, markupBps: 0,
    } as any).returning();

    await db.insert(crmPbItemParts).values([
      { orgId: ctx.org.id, itemId: asm.id, sortOrder: 0, materialId: mats[0].id, quantityMilli: 1000 },
      { orgId: ctx.org.id, itemId: asm.id, sortOrder: 1, materialId: mats[1].id, quantityMilli: 1000 },
      { orgId: ctx.org.id, itemId: asm.id, sortOrder: 2, laborRateId: labor.id, quantityMilli: 1600, hoursMilli: 1600 },
    ] as any);

    res.json({
      ok: true, categoryId: cat.id, assemblyId: asm.id,
      materials: mats.length,
      note: "Starter numbers are illustrative — replace them with your real costs and prices.",
    });
  });
}

/**
 * Measurements — provider-neutral.
 *
 * HOVER and EagleView are explicitly NOT planned (owner decision 2026-07-29).
 * **CladAI** becomes the provider when that project ships. Nothing here talks to
 * any provider yet; this is the seam plus manual entry, so an estimator can work
 * today and CladAI drops in behind the same shape later.
 */
export function registerCrmMeasurementRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  const measSchema = z.object({
    projectId: z.string().max(64).nullable().optional(),
    customerId: z.string().max(64).nullable().optional(),
    provider: z.enum(CRM_MEASUREMENT_PROVIDERS as unknown as [string, ...string[]]).default("manual"),
    addressLine1: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(40).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    // Accept human units; store thousandths.
    squares: z.number().min(0).max(100000).nullable().optional(),
    roofAreaSf: z.number().min(0).max(10_000_000).nullable().optional(),
    wallAreaSf: z.number().min(0).max(10_000_000).nullable().optional(),
    ridgeLf: z.number().min(0).max(1_000_000).nullable().optional(),
    hipLf: z.number().min(0).max(1_000_000).nullable().optional(),
    valleyLf: z.number().min(0).max(1_000_000).nullable().optional(),
    eaveLf: z.number().min(0).max(1_000_000).nullable().optional(),
    rakeLf: z.number().min(0).max(1_000_000).nullable().optional(),
    perimeterLf: z.number().min(0).max(1_000_000).nullable().optional(),
    predominantPitch: z.string().max(12).nullable().optional(),
    stories: z.number().int().min(0).max(20).nullable().optional(),
    facetCount: z.number().int().min(0).max(2000).nullable().optional(),
    wasteSuggestionBps: z.number().int().min(0).max(5000).nullable().optional(),
  });

  const milli = (v?: number | null) => (v === null || v === undefined ? null : Math.round(v * 1000));

  app.get("/api/crm/measurements", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmMeasurements.orgId, ctx.org.id)];
    if (req.query.projectId) where.push(eq(crmMeasurements.projectId, String(req.query.projectId)));
    const rows = await db.select().from(crmMeasurements).where(and(...where))
      .orderBy(desc(crmMeasurements.createdAt)).limit(200);
    res.json({ measurements: rows, providers: CRM_MEASUREMENT_PROVIDERS });
  });

  app.post("/api/crm/measurements", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const p = measSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid measurement", issues: p.error.issues });
    const d = p.data;
    if (d.provider === "cladai") {
      // Deliberately refused rather than silently stored as pending: the CladAI
      // integration does not exist yet, and a row claiming to be a CladAI
      // measurement would be a lie in the audit trail.
      return res.status(501).json({
        message: "CladAI measurements aren't wired up yet. Enter the numbers manually for now.",
      });
    }
    const [row] = await db.insert(crmMeasurements).values({
      orgId: ctx.org.id, projectId: d.projectId ?? null, customerId: d.customerId ?? null,
      provider: d.provider, status: "ready",
      addressLine1: d.addressLine1 ?? null, city: d.city ?? null,
      state: d.state ?? null, postalCode: d.postalCode ?? null,
      squaresMilli: milli(d.squares), roofAreaSfMilli: milli(d.roofAreaSf),
      wallAreaSfMilli: milli(d.wallAreaSf), ridgeLfMilli: milli(d.ridgeLf),
      hipLfMilli: milli(d.hipLf), valleyLfMilli: milli(d.valleyLf),
      eaveLfMilli: milli(d.eaveLf), rakeLfMilli: milli(d.rakeLf),
      perimeterLfMilli: milli(d.perimeterLf),
      predominantPitch: d.predominantPitch ?? null, stories: d.stories ?? null,
      facetCount: d.facetCount ?? null, wasteSuggestionBps: d.wasteSuggestionBps ?? null,
      requestedByMemberId: ctx.member.id, completedAt: new Date(),
    } as any).returning();
    res.status(201).json(row);
  });

  /**
   * Turn a measurement into the symbol map an assembly formula consumes, so
   * "32 squares" flows from the measurement into the estimate without retyping.
   */
  app.get("/api/crm/measurements/:id/symbols", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [m] = await db.select().from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, ctx.org.id), eq(crmMeasurements.id, req.params.id))).limit(1);
    if (!m) return res.status(404).json({ message: "Measurement not found" });
    const div = (v?: number | null) => (v === null || v === undefined ? undefined : v / 1000);
    const pitchRise = m.predominantPitch ? Number(String(m.predominantPitch).split("/")[0]) : undefined;
    const symbols: Record<string, number> = {};
    const put = (k: string, v?: number) => { if (typeof v === "number" && Number.isFinite(v)) symbols[k] = v; };
    put("SQUARES", div(m.squaresMilli));
    put("SF", div(m.roofAreaSfMilli) ?? div(m.wallAreaSfMilli));
    put("LF", div(m.perimeterLfMilli) ?? div(m.eaveLfMilli));
    put("PITCH", pitchRise);
    put("STORIES", m.stories ?? undefined);
    put("WASTE", m.wasteSuggestionBps != null ? m.wasteSuggestionBps / 100 : undefined);
    res.json({ symbols, measurementId: m.id, provider: m.provider });
  });
}
