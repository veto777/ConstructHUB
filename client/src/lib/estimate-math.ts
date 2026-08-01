/**
 * Money/qty math for the mobile estimate builder (/crm/estimates/new).
 * Pure functions, unit-tested in server/crm/mobile-estimate-math.test.ts.
 * The server recomputes everything on create (entities.ts recalcEstimate) —
 * these exist so the running total the contractor sees matches it exactly.
 */

export interface CartLine {
  quantityMilli: number;
  unitPriceCents: number;
}

/** One line, same rounding as the server: round(price × qty/1000). */
export function lineTotalCents(l: CartLine): number {
  return Math.round((l.unitPriceCents * l.quantityMilli) / 1000);
}

export function cartSubtotalCents(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + lineTotalCents(l), 0);
}

/** "2.5" → 2500. Blank/garbage → 0. Clamped to the server's item limits. */
export function qtyToMilli(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100_000_000, Math.round(n * 1000));
}

/** "185.50" → 18550. Blank/garbage → 0. Clamped to the server's item limits. */
export function priceToCents(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100_000_000, Math.round(n * 100));
}

export function milliToQty(milli: number): string {
  return (milli / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export const money = (c?: number | null): string =>
  c === null || c === undefined
    ? "—"
    : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
