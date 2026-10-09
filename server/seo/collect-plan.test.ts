/**
 * The rank collector's closing rule (server/seo/collect-plan.ts; reliability review H2): a run past its window is
 * closed only when every remaining paid result was asked for; unread results are never thrown away, and a backlog
 * near the window raises a warning.
 */
import { describe, expect, it } from "vitest";
import { BACKLOG_WARN_RATIO, RUN_WINDOW_MS, backlogWarning, closeDecision } from "./collect-plan";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const startedAgo = (ms: number) => new Date(NOW - ms).toISOString();

describe("closeDecision", () => {
  it("closes a run with nothing left, inside or past the window", () => {
    expect(closeDecision({ remaining: 0, unasked: 0, startedAt: startedAgo(60_000), now: NOW })).toEqual({ close: true, expired: false, heldOpen: false });
    expect(closeDecision({ remaining: 0, unasked: 0, startedAt: startedAgo(RUN_WINDOW_MS + 1), now: NOW })).toEqual({ close: true, expired: true, heldOpen: false });
  });

  it("keeps a run open inside its window while results are pending", () => {
    expect(closeDecision({ remaining: 12, unasked: 0, startedAt: startedAgo(RUN_WINDOW_MS - 1), now: NOW })).toEqual({ close: false, expired: false, heldOpen: false });
    expect(closeDecision({ remaining: 12, unasked: 12, startedAt: startedAgo(10 * 60_000), now: NOW })).toEqual({ close: false, expired: false, heldOpen: false });
  });

  it("past the window: closes when every remaining result was asked for; holds open when some were not", () => {
    expect(closeDecision({ remaining: 3, unasked: 0, startedAt: startedAgo(RUN_WINDOW_MS + 1), now: NOW })).toEqual({ close: true, expired: true, heldOpen: false });
    expect(closeDecision({ remaining: 300, unasked: 250, startedAt: startedAgo(2 * RUN_WINDOW_MS), now: NOW })).toEqual({ close: false, expired: true, heldOpen: true });
  });

  it("a run without a start (taken over before posting finished) is never expired", () => {
    expect(closeDecision({ remaining: 5, unasked: 5, startedAt: null, now: NOW }).close).toBe(false);
  });
});

describe("backlogWarning", () => {
  it("is quiet when everything was asked for, or the oldest waiting run is young", () => {
    expect(backlogWarning({ unasked: 0, oldestStartedAt: startedAgo(RUN_WINDOW_MS), now: NOW, budgetMs: 40_000 })).toBeNull();
    expect(backlogWarning({ unasked: 40, oldestStartedAt: startedAgo(RUN_WINDOW_MS * BACKLOG_WARN_RATIO - 60_000), now: NOW, budgetMs: 40_000 })).toBeNull();
    expect(backlogWarning({ unasked: 40, oldestStartedAt: null, now: NOW, budgetMs: 40_000 })).toBeNull();
  });

  it("names the count, the age and the knobs once the oldest unread run nears its window", () => {
    const line = backlogWarning({ unasked: 1200, oldestStartedAt: startedAgo(70 * 60_000), now: NOW, budgetMs: 40_000 });
    expect(line).toContain("1200 paid rank result(s) were not asked for");
    expect(line).toContain("70 min into its 90-min window");
    expect(line).toContain("SEO_COLLECT_BUDGET_MS");
    expect(line).toContain("never discarded unread");
  });
});
