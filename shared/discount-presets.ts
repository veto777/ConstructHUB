/**
 * The preset discount offers (Settings → Bid discounts starts from these; the per-estimate Discounts dialog and the
 * New estimate dialog tick them). Shared so the client can show them before an estimate exists.
 * The creator ticks which of these to offer. Price-match is OFF by default —
 * matching a competitor's number is a bad sales tactic; offering it at all is
 * a deliberate choice, and the client must provide the competing bid.
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
    conditions: "Siding + roofing + windows — all three required; gutters/paint don't count as a scope.",
    defaultEnabled: true,
  },
  {
    code: "price_match",
    label: "Price match",
    percentBps: 0, // creator sets the concession when enabling it
    conditions: "To qualify, we need to see a copy of the estimate we're price matching so we can compare apples to apples: the same scope of work, materials and warranty.",
    defaultEnabled: false,
  },
] as const;
