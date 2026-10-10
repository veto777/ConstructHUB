/**
 * The "Compare" section of a feature page (FeaturePage.compare): named
 * competitors with the price their own pricing page lists, what we do that
 * they don't (only claims the page itself makes), an honest line on what they
 * do that we don't, and "one of a kind" wording where no comparable product
 * was found. Prices are stored in cents and formatted here — a content file
 * never types a "$" figure (server/feature-pages.test.ts).
 *
 * Source: ~/codex-audits/a-la-carte-competitors.md (vendor pricing pages read
 * on 2026-10-10); each competitor carries the page it was read from. Vendors
 * change prices: the section says when they were checked.
 */
import { formatUsd } from "../plan-copy";
import type { CompetitorPrice, FeatureCompetitor } from "./types";

/** "$39/mo", "$39/mo billed annually", "from $10/mo", "$31–$750/mo", "$279/yr", "$365 one-time", "$0.10 per location", "Quote only". */
export function competitorPriceLabel(price: CompetitorPrice): string {
  switch (price.kind) {
    case "monthly": return `${formatUsd(price.cents)}/mo${price.billed === "annually" ? " billed annually" : ""}`;
    case "monthly_from": return `from ${formatUsd(price.cents)}/mo`;
    case "monthly_range": return `${formatUsd(price.fromCents)}–${formatUsd(price.toCents)}/mo`;
    case "annual": return `${formatUsd(price.cents)}/yr`;
    case "one_time": return `${formatUsd(price.cents)} one-time`;
    case "per_unit": return `${formatUsd(price.cents)} per ${price.unit}`;
    case "quote": return "Quote only";
  }
}

/** "Localo Single Business — $39/mo billed annually, 1 location" (the row a page prints). */
export function competitorLine(c: FeatureCompetitor): string {
  const name = c.plan ? `${c.name} ${c.plan}` : c.name;
  const per = c.per ? ` ${c.per}` : "";
  const reported = c.reported ? " · reported by a third-party listing" : "";
  return `${name} — ${competitorPriceLabel(c.price)}${per}${c.note ? ` (${c.note})` : ""}${reported}`;
}

/** The line under the table: when the prices were read, and that they change. */
export const comparePricesNote = (checkedOn: string) =>
  `Competitor prices are the list prices on each company's own pricing page as of ${checkedOn}; they change, so check before you decide. No affiliation.`;
