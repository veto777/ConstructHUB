/**
 * The preset discount offers (Settings → Bid discounts starts from these; the per-estimate Discounts dialog and the
 * New estimate dialog tick them). Shared so the client can show them before an estimate exists.
 * The creator ticks which of these to offer. Price-match is off by default; when offered, the client must provide
 * the competing estimate.
 */
export const DISCOUNT_PRESETS = [
  {
    code: "marketing",
    label: "Marketing discount",
    percentBps: 100, // 1%
    conditions: "Yard signage during the job + 1 month after, and an honest review (unless the experience was genuinely bad).",
    defaultEnabled: true,
  },
  {
    code: "military",
    label: "Military discount",
    percentBps: 200, // 2%
    conditions: "Military ID required — family members don't count.",
    defaultEnabled: true,
  },
  {
    code: "pay_in_full",
    label: "Pay-in-full discount",
    percentBps: 500, // 5%
    conditions: "Paid in full immediately.",
    defaultEnabled: true,
  },
  {
    code: "bundle",
    label: "Bundle discount",
    percentBps: 500, // 5%
    conditions: "Bundle two or more of siding, windows and roofing on one job. Painting, gutters and doors don't count as a scope.",
    defaultEnabled: true,
  },
  {
    code: "price_match",
    label: "Price match",
    percentBps: 0, // 0 = "we'll match it" (no fixed %); the creator may set a concession instead
    conditions: "To qualify, we need to see a copy of the estimate we're price matching so we can compare apples to apples: the same scope of work, materials and warranty.",
    defaultEnabled: false,
  },
] as const;

/** Old wording that must never reach a client (internal price-match note, the all-three bundle text); swapped on save and at render. */
export const BUNDLE_CONDITIONS = "Bundle two or more of siding, windows and roofing on one job. Painting, gutters and doors don't count as a scope.";
const LEGACY_CONDITIONS: Record<string, string> = {
  // Old bundle wording (all three required) contradicts the tiered rule shown above it.
  "Siding + roofing + windows — all three required; gutters/paint don't count as a scope.": BUNDLE_CONDITIONS,
  "Siding + roofing + windows — all three required.": BUNDLE_CONDITIONS,
  "Requires providing the competing bid. Off by default — price matching is a bad sales tactic.":
    "To qualify, we need to see a copy of the estimate we're price matching so we can compare apples to apples: the same scope of work, materials and warranty.",
};
export function cleanOfferConditions(conditions: string | null | undefined): string | null {
  if (conditions == null) return null;
  return LEGACY_CONDITIONS[conditions.trim()] ?? conditions;
}
