/**
 * The rank collector's closing rule and backlog warning (server/seo/jobs.ts collectRunningRuns), pure.
 *
 * Reliability review H2 (2026-10-09): the collector asked for a fixed 300 results a tick against a 90-minute window
 * counted from the run's start. Past ~27,000 checks in flight, the first runs ate the whole budget every tick and
 * later runs reached the window with results never asked for: closed as "never came back", the customer refunded,
 * the platform's money and the data gone. Now the pass is sized to the backlog (a time budget, oldest run first),
 * and a run is closed as expired ONLY when every one of its remaining results was asked for in the pass — a result
 * that is merely unread because the collector ran out of time is never thrown away. When unread results pile up
 * near the window, the issue desk is told (backlogWarning).
 */

/** Standard-queue tasks finish in ~5 minutes on average; after this a run closes with what it has (if all was asked for). */
export const RUN_WINDOW_MS = 90 * 60_000;
/** The backlog warning fires once unread results belong to a run this far into its window. */
export const BACKLOG_WARN_RATIO = 0.75;

export type CloseDecision = {
  /** Close the run now (done, or expired with what it has). */
  close: boolean;
  /** The run's window has passed. */
  expired: boolean;
  /** Expired, but kept open because results were left unasked this pass (said in the log, never thrown away). */
  heldOpen: boolean;
};

const ageMs = (startedAt: Date | string | null | undefined, now: number) => (startedAt ? now - new Date(startedAt).getTime() : 0);

/**
 * After one pass over a run's tasks: `remaining` results are still pending (asked and not ready, or not asked);
 * `unasked` of them were never asked for because the pass ran out of time.
 */
export function closeDecision(i: { remaining: number; unasked: number; startedAt: Date | string | null | undefined; now: number; windowMs?: number }): CloseDecision {
  const expired = ageMs(i.startedAt, i.now) > (i.windowMs ?? RUN_WINDOW_MS);
  if (i.remaining <= 0) return { close: true, expired, heldOpen: false };
  if (!expired) return { close: false, expired: false, heldOpen: false };
  // Past the window: close only when nothing paid is still unread.
  return i.unasked > 0 ? { close: false, expired: true, heldOpen: true } : { close: true, expired: true, heldOpen: false };
}

/**
 * The pass's backlog line for the issue desk, or null when the collector is keeping up: results left unasked whose
 * run is already BACKLOG_WARN_RATIO into its window (so they would be lost on the next pass that reaches the window).
 */
export function backlogWarning(i: { unasked: number; oldestStartedAt: Date | string | null | undefined; now: number; budgetMs: number; windowMs?: number }): string | null {
  if (i.unasked <= 0 || !i.oldestStartedAt) return null;
  const windowMs = i.windowMs ?? RUN_WINDOW_MS;
  const age = ageMs(i.oldestStartedAt, i.now);
  if (age < windowMs * BACKLOG_WARN_RATIO) return null;
  return `${i.unasked} paid rank result(s) were not asked for in this pass (time budget ${Math.round(i.budgetMs / 1000)}s used up); the oldest run waiting is ${Math.round(age / 60_000)} min into its ${Math.round(windowMs / 60_000)}-min window. Results are never discarded unread, but the collector is behind: raise SEO_COLLECT_BUDGET_MS or the concurrency, or check the data source's latency.`;
}
