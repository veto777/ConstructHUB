/**
 * ConstructHUB SEO data credit — what a customer pays for SEO data.
 *
 * Owner decisions (2026-10-07, and 2026-10-08 for who has the tools):
 *   - Every lookup is priced at SEO_MARKUP x what the data source charges us.
 *   - The SEO tools are included with the Agency plan, with a monthly
 *     allowance at that customer price (shared/plans.ts `seoCreditCents`:
 *     $40). It resets on the 1st (UTC) and does not roll over. An account that
 *     had the tools on Starter, Pro or Growth before 2026-10-08 keeps its old
 *     allowance (shared/plans.ts SEO_GRANDFATHERED_LIMITS).
 *   - Beyond the allowance a customer buys prepaid credit in packs
 *     (SEO_CREDIT_PACKS). Purchased credit is spent only after the month's
 *     allowance is used up, and it does not expire.
 *
 * Money is in cents at the customer's price. The wholesale cost never appears
 * in a customer response (server/seo/credits.ts keeps the two apart).
 */
export const SEO_MARKUP = 4;

/** Prepaid packs, in cents: what the customer pays is the credit they get. */
export const SEO_CREDIT_PACKS: readonly number[] = [2500, 5000, 10000];
export const isSeoCreditPack = (cents: unknown): cents is number =>
  typeof cents === "number" && SEO_CREDIT_PACKS.includes(cents);

/** Customer price in cents for a wholesale cost in dollars: rounded UP to the cent, and never free. */
export function retailCents(wholesaleUsd: number): number {
  if (!(wholesaleUsd > 0)) return 0;
  return Math.max(1, Math.ceil(wholesaleUsd * SEO_MARKUP * 100 - 1e-9));
}

export const creditUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type SeoCredits = {
  /** The plan's monthly allowance in cents; -1 = unlimited (platform staff). */
  includedCents: number;
  includedUsedCents: number;
  /** Purchased credit left. */
  walletCents: number;
  /** What can still be spent right now (allowance left + purchased); -1 = unlimited. */
  availableCents: number;
};

/** How a charge is split: the month's allowance first, then purchased credit. Pure. */
export function splitCharge(cents: number, allowanceLeftCents: number, walletCents: number): { fromIncluded: number; fromWallet: number; short: number } {
  const fromIncluded = Math.max(0, Math.min(cents, allowanceLeftCents));
  const rest = cents - fromIncluded;
  const fromWallet = Math.max(0, Math.min(rest, walletCents));
  return { fromIncluded, fromWallet, short: rest - fromWallet };
}
