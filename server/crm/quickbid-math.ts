/**
 * Quick Bid pricing math — pure, no db/tenancy imports, so vitest can unit
 * test it without booting server modules (see quickbid.test.ts; the endpoint
 * itself lives in quickbid.ts).
 */

export type SqftMetric = "roof" | "siding";

/**
 * "2,210 sq ft siding area from the hover report + 12% waste × $4.50/sq ft".
 * With a HOVER takeoff quote the label comes from the TAKEOFF (its measured area, its waste %, its quantity),
 * never from the measurement columns, which can lag behind a rules change.
 */
export function quickBidLineDescription(args: {
  sqftMilli: number; metric: SqftMetric; provider: string;
  wasteBps: number | null; rateCentsPerSqft: number;
  /** HOVER takeoff quote (already rounded / with waste), when the report has one. */
  quote?: { areaSqft: number; quantitySqft: number; wastePct: number } | null;
}): string {
  const f = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const rate = (args.rateCentsPerSqft / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  if (args.quote) {
    const q = args.quote;
    const how = args.metric === "roof"
      ? ` + ${q.wastePct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% waste = ${f(q.quantitySqft)} sq ft`
      : `, rounded up to ${f(q.quantitySqft)} sq ft`;
    return `${f(q.areaSqft)} sq ft ${args.metric} area from the ${args.provider} report${how} × $${rate}/sq ft`;
  }
  const sqft = f(args.sqftMilli / 1000);
  const waste = args.wasteBps ? ` + ${(args.wasteBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% waste` : "";
  return `${sqft} sq ft ${args.metric} area from the ${args.provider} report${waste} × $${rate}/sq ft`;
}

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
