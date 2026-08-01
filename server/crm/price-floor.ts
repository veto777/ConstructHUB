/**
 * Price-floor lock — reps can price ABOVE the floor, never below it.
 *
 * The owner's switch lives in crm_orgs.custom_fields->'priceFloorLock':
 *   { enabled: boolean, floorBps?: number }
 * Default OFF. When ON, estimate create/update (entities.ts) and the discount
 * offers (discounts.ts) reject below-floor pricing with a 422 — for everyone
 * except the owner, who sets the prices and is always exempt.
 *
 * The floor per line item, first match wins:
 *   1. floorBps set and a cost exists → cost × (1 + bps/10000)  (margin variant)
 *   2. the item matches a pricebook SKU (by SKU token or exact name) → the
 *      SKU's CURRENT unit price
 *   3. the item carries a cost → that cost (never sell below cost)
 *   4. otherwise there is no floor — custom lines stay free.
 *
 * Estimate items don't store which SKU they came from, so "built from a SKU"
 * is resolved by matching: a SKU token at the start of the description (the
 * assembly expander writes "SKU · notes"), else an exact case-insensitive
 * name match against active pricebook materials and flat-priced items.
 */
import { db } from "../db";
import { crmPbItems, crmPbMaterials } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { OrgContext } from "./tenancy";

export type PriceFloorLock = { enabled: boolean; floorBps?: number };

/** Read custom_fields->'priceFloorLock', tolerating junk. Default OFF. */
export function priceFloorLockOf(customFields: unknown): PriceFloorLock {
  const raw = (customFields as Record<string, unknown> | null | undefined)?.priceFloorLock;
  if (!raw || typeof raw !== "object") return { enabled: false };
  const o = raw as Record<string, unknown>;
  const lock: PriceFloorLock = { enabled: o.enabled === true };
  if (typeof o.floorBps === "number" && Number.isInteger(o.floorBps) && o.floorBps >= 0 && o.floorBps <= 10_000) {
    lock.floorBps = o.floorBps;
  }
  return lock;
}

// ── The pricebook index ─────────────────────────────────────────────────────

type PricedRow = { priceCents: number; costCents: number | null };

export type PricebookIndex = {
  /** lowercased trim(name) → current price (materials and flat-priced items). */
  byName: Map<string, PricedRow>;
  /** lowercased trim(sku) → current price (materials only). */
  bySku: Map<string, PricedRow>;
};

export async function loadPricebookIndex(orgId: string): Promise<PricebookIndex> {
  const byName = new Map<string, PricedRow>();
  const bySku = new Map<string, PricedRow>();
  const [materials, items] = await Promise.all([
    db.select({
      name: crmPbMaterials.name, sku: crmPbMaterials.sku,
      priceCents: crmPbMaterials.priceCents, costCents: crmPbMaterials.costCents,
    }).from(crmPbMaterials)
      .where(and(eq(crmPbMaterials.orgId, orgId), eq(crmPbMaterials.active, true))),
    db.select({
      name: crmPbItems.name, flatPriceCents: crmPbItems.flatPriceCents, flatCostCents: crmPbItems.flatCostCents,
    }).from(crmPbItems)
      .where(and(eq(crmPbItems.orgId, orgId), eq(crmPbItems.active, true))),
  ]);
  for (const m of materials) {
    const row = { priceCents: m.priceCents, costCents: m.costCents };
    byName.set(m.name.trim().toLowerCase(), row);
    if (m.sku) bySku.set(m.sku.trim().toLowerCase(), row);
  }
  // Computed assemblies have no single unit price without expanding them —
  // only flat-priced ones can be a floor.
  for (const i of items) {
    if (i.flatPriceCents == null) continue;
    byName.set(i.name.trim().toLowerCase(), { priceCents: i.flatPriceCents, costCents: i.flatCostCents });
  }
  return { byName, bySku };
}

// ── Floor resolution ────────────────────────────────────────────────────────

export type FloorLine = {
  kind?: string;
  name: string;
  description?: string | null;
  unit?: string | null;
  unitPriceCents: number;
  unitCostCents?: number | null;
  quantityMilli?: number;
};

function matchSku(line: FloorLine, index: PricebookIndex): PricedRow | null {
  // The assembly expander writes material descriptions as "SKU · notes".
  const desc = (line.description ?? "").trim();
  if (desc) {
    const token = desc.split("·")[0].trim().toLowerCase();
    const hit = token ? index.bySku.get(token) : undefined;
    if (hit) return hit;
  }
  return index.byName.get(line.name.trim().toLowerCase()) ?? null;
}

/** The per-unit floor for one line, in cents. 0 means "no floor". */
export function floorCentsForLine(line: FloorLine, index: PricebookIndex, lock: PriceFloorLock): number {
  const sku = matchSku(line, index);
  const cost = line.unitCostCents ?? sku?.costCents ?? null;
  if (lock.floorBps != null && cost != null && cost > 0) {
    return Math.ceil((cost * (10_000 + lock.floorBps)) / 10_000);
  }
  if (sku) return sku.priceCents;
  if (cost != null && cost > 0) return cost;
  return 0;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "Price lock: 'Labor' can't go below $4.50/sqft — the floor set by the owner" */
export function priceLockMessage(line: FloorLine, floorCents: number): string {
  const perUnit = line.unit ? `/${line.unit}` : "";
  return `Price lock: '${line.name}' can't go below ${formatCents(floorCents)}${perUnit} — the floor set by the owner`;
}

/**
 * The honest rejection for a set of estimate lines, or null when pricing is
 * allowed. Only called when the lock is ON and the actor is not the owner.
 */
export function belowFloorLine(
  lines: FloorLine[],
  index: PricebookIndex,
  lock: PriceFloorLock,
): { line: FloorLine; floorCents: number } | null {
  for (const line of lines) {
    // Discount lines are reductions, not priced work — they carry no floor.
    if (line.kind === "discount") continue;
    const floor = floorCentsForLine(line, index, lock);
    if (floor > 0 && line.unitPriceCents < floor) return { line, floorCents: floor };
  }
  return null;
}

/**
 * Estimate create/update hook (entities.ts): the 422 message for the first
 * below-floor line, or null when the lock is off, the actor is the owner, or
 * everything is at/above floor.
 */
export async function priceFloorViolation(ctx: OrgContext, lines: FloorLine[]): Promise<string | null> {
  const lock = priceFloorLockOf(ctx.org.customFields);
  if (!lock.enabled || ctx.member.role === "owner") return null;
  const hit = belowFloorLine(lines, await loadPricebookIndex(ctx.org.id), lock);
  return hit ? priceLockMessage(hit.line, hit.floorCents) : null;
}

/**
 * Sum of line floors (floor × quantity) for an estimate's items — the bar a
 * discount selection may never take the pre-tax total below.
 */
export function floorTotalCents(lines: FloorLine[], index: PricebookIndex, lock: PriceFloorLock): number {
  return lines.reduce(
    (s, l) => s + Math.round((floorCentsForLine(l, index, lock) * (l.quantityMilli ?? 1000)) / 1000),
    0,
  );
}
