/**
 * The customer's SEO data history: every lookup, what it was and what it cost
 * them, newest first — read from the reservation rows the ledger already keeps
 * (server/seo/budget.ts). Amounts are the customer's price; our own cost never
 * leaves the server.
 */
import { pool } from "../db";
import { retailCents } from "@shared/seo-credits";

export type UsageRow = {
  id: string; at: string; what: string;
  /** charged = paid for; free = it failed or returned nothing billable; running = not finished yet. */
  status: "charged" | "free" | "running";
  cents: number;
  /** Where the money came from: the month's included data and/or purchased credit. */
  fromIncluded: number; fromPurchased: number;
};

/** One reservation row as the customer sees it. Pure, for tests. */
export function usageRow(r: { id: string; label: string | null; created_at: string | Date; settled_at: string | Date | null; estimate_usd: string | number; customer_usd: string | number | null; credit: { fromIncluded?: number; fromWallet?: number } | null; refunded_cents?: number | null }): UsageRow {
  const at = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
  const what = r.label?.trim() || "SEO data lookup";
  const held = (r.credit?.fromIncluded ?? 0) + (r.credit?.fromWallet ?? 0);
  if (!r.settled_at) return { id: r.id, at, what, status: "running", cents: held, fromIncluded: r.credit?.fromIncluded ?? 0, fromPurchased: r.credit?.fromWallet ?? 0 };
  // An account with unlimited data holds no credit: nothing was charged to it.
  const cents = r.credit ? Math.max(0, retailCents(Number(r.customer_usd ?? 0)) - Number(r.refunded_cents ?? 0)) : 0;
  // Purchased credit is given back first when a lookup costs less than was held, so what is left came from the allowance first.
  // Once settled, the row's credit is what the lookup took (less any refund), split by where it came from.
  const fromIncluded = Math.min(cents, r.credit?.fromIncluded ?? 0);
  return { id: r.id, at, what, status: cents > 0 ? "charged" : "free", cents, fromIncluded, fromPurchased: cents - fromIncluded };
}

export async function usageHistory(userId: number, limit = 200): Promise<{ rows: UsageRow[]; purchases: { at: string; cents: number }[]; months: { month: string; cents: number; lookups: number }[] }> {
  const [{ rows }, { rows: purchases }, { rows: months }] = await Promise.all([
    pool.query("SELECT id, label, created_at, settled_at, estimate_usd, customer_usd, credit, refunded_cents FROM seo_reservations WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2", [userId, limit]),
    pool.query(`SELECT created_at AS at, cents FROM seo_credit_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [userId]),
    pool.query(`SELECT month, (included_cents + wallet_cents)::int AS cents, requests::int AS lookups FROM seo_credit_usage WHERE user_id=$1 ORDER BY month DESC LIMIT 12`, [userId]),
  ]);
  return { rows: rows.map(usageRow), purchases, months };
}
