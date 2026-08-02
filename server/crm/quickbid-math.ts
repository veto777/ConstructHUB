/**
 * Quick Bid pricing math — pure, no db/tenancy imports, so vitest can unit
 * test it without booting server modules (see quickbid.test.ts; the endpoint
 * itself lives in quickbid.ts).
 */

export type SqftMetric = "roof" | "siding";

/**
 * Which measurement metric an item prices against when the row doesn't say.
 * Anything roof-flavoured prices roof area; everything else on an exterior
 * report is wall/siding area.
 */
export function inferSqftMetric(name: string): SqftMetric {
  return /roof/i.test(name) ? "roof" : "siding";
}

/**
 * One quick-bid line, cents-exact.
 *
 * sqftMilli is the report's area in thousandths of a sq ft (2000 sq ft =
 * 2_000_000). Waste multiplies the QUANTITY, so the homeowner sees the real
 * material/area number and the rate stays the honest per-sqft price.
 */
export function quickBidLine(args: {
  rateCentsPerSqft: number;
  sqftMilli: number;
  wasteBps: number | null;
}): { quantityMilli: number; lineTotalCents: number } {
  const quantityMilli = Math.round((args.sqftMilli * (10000 + (args.wasteBps ?? 0))) / 10000);
  const lineTotalCents = Math.round((args.rateCentsPerSqft * quantityMilli) / 1000);
  return { quantityMilli, lineTotalCents };
}
