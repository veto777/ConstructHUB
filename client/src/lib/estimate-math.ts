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

/** Typed number text without thousands separators (and a leading "$" for prices). */
const numberText = (raw: string) => String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");

/** "2.5" → 2500. Blank/garbage → 0. Clamped to the server's item limits. */
export function qtyToMilli(raw: string): number {
  const n = parseFloat(numberText(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100_000_000, Math.round(n * 1000));
}

/** "185.50" / "$1,500" → cents. Blank/garbage → 0 (see priceTextError to
 *  catch garbage before it is saved). Clamped to the server's item limits. */
export function priceToCents(raw: string): number {
  const n = parseFloat(numberText(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100_000_000, Math.round(n * 100));
}

/**
 * Why a typed price is not a price, or null when it is. priceToCents turns
 * garbage into $0 silently (right for a running total mid-typing); forms use
 * this to SAY so before anything is saved or sent. Blank is allowed only
 * when `allowBlank` (a blank price field means $0 by choice).
 */
export function priceTextError(raw: string, allowBlank = false): string | null {
  const s = numberText(raw);
  if (!s) return allowBlank ? null : "Enter a price.";
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return "Enter a price in dollars, like 185.50.";
  if (Number(s) * 100 > 100_000_000) return "That price is above the $1,000,000 limit.";
  return null;
}

/** Why a typed quantity is not a quantity, or null when it is. Zero is not a line. */
export function qtyTextError(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return "Enter a quantity.";
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return "Enter a number, like 2.5.";
  if (Number(s) <= 0) return "Quantity must be more than 0.";
  if (Number(s) * 1000 > 100_000_000) return "That quantity is above the 100,000 limit.";
  return null;
}

export function milliToQty(milli: number): string {
  return (milli / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export const money = (c?: number | null): string =>
  c === null || c === undefined
    ? "—"
    : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
