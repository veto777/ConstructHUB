import { planRequiredFrom } from "@/components/plan-required";

/**
 * refetchInterval for the Domains and Mail Alerts pages, sized to those routes'
 * own request budget: rateLimit("domains"|"mail-alerts", 120, 300) admits 120
 * requests per user per 10-minute window (server/growth-limits.ts), and user
 * actions (search, preview, confirm, sync, paging) spend from the same budget.
 * The pollers on each page together stay ≤ 80 requests/10 min — inventory every
 * 20 s (30) + jobs every 12 s (50) on Domains, alerts every 15 s (40) on Mail
 * Alerts — leaving ≥ 40/10 min for actions. A 429 answer means the window's
 * budget is spent: back off to `backoffMs` and retry when the window rolls,
 * instead of re-hitting the limiter on the old cadence (self-induced 429s
 * after ~10 minutes, 2026-10-11 findings).
 */
export const pollWithinBudget =
  (ms: number, backoffMs = 60_000) =>
  (query: { state: { error: unknown } }): number | false => {
    const error = query.state.error as { message?: unknown } | null;
    const message =
      error && typeof error.message === "string" ? error.message : "";
    // A plan answer is final for this page: stop polling until remount.
    if (planRequiredFrom(error)) return false;
    // 429: the limiter rejected the last fetch — idle until the window rolls.
    if (message.startsWith("429:")) return backoffMs;
    return ms;
  };
