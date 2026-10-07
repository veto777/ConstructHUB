/**
 * HOVER auto-sync scheduling + failure reasons (issue desk #332). Pure — no
 * database or dev server: an org whose HOVER connection fails must be retried
 * at its cadence, not on every 10-minute scheduler tick, and the card must say
 * WHY the jobs list failed instead of a bare "network".
 */
import { describe, it, expect } from "vitest";
import { hoverSyncDue, hoverListFailureReason } from "./hover";

const now = new Date("2026-10-05T04:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("hoverSyncDue", () => {
  it("is due when the org never synced", () => {
    expect(hoverSyncDue({}, now)).toBe(true);
  });

  it("waits the cadence after a success", () => {
    expect(hoverSyncDue({ lastSyncAt: hoursAgo(5) }, now)).toBe(false);
    expect(hoverSyncDue({ lastSyncAt: hoursAgo(6) }, now)).toBe(true);
    expect(hoverSyncDue({ lastSyncAt: hoursAgo(1.5), syncEveryHours: 1 }, now)).toBe(true);
  });

  it("waits the cadence after a FAILED attempt too (no retry every tick)", () => {
    // Last success months ago, last attempt 10 minutes ago → not due.
    expect(hoverSyncDue({ lastSyncAt: "2026-08-11T22:19:52.274Z", lastSyncAttemptAt: hoursAgo(1 / 6) }, now)).toBe(false);
    expect(hoverSyncDue({ lastSyncAt: "2026-08-11T22:19:52.274Z", lastSyncAttemptAt: hoursAgo(6) }, now)).toBe(true);
  });

  it("treats an unparseable timestamp as never", () => {
    expect(hoverSyncDue({ lastSyncAttemptAt: "garbage" }, now)).toBe(true);
  });
});

describe("hoverListFailureReason", () => {
  it("reports the HTTP status when HOVER answered", () => {
    expect(hoverListFailureReason(401, null)).toBe("401");
  });

  it("reports the thrown cause (e.g. a dead refresh token) instead of 'network'", () => {
    expect(hoverListFailureReason(0, "HOVER token refresh failed: 400")).toBe("HOVER token refresh failed: 400");
  });

  it("falls back to 'network' when nothing was thrown", () => {
    expect(hoverListFailureReason(0, null)).toBe("network");
  });
});

/**
 * An expired HOVER sign-in (production, 2026-10-07: "HOVER token refresh failed: 400" on every attempt since
 * 2026-08-11) is something only the customer can fix, by reconnecting. It must not be retried or sent to the
 * issue desk; anything else still is.
 */
import { hoverSignInExpired, hoverReconnectNeeded, hoverConnNeedsReconnect, HoverReconnectError, HOVER_RECONNECT_MESSAGE } from "./hover";

describe("an expired HOVER sign-in", () => {
  it("is a 400 or 401 from the refresh, nothing else", () => {
    expect(hoverSignInExpired(400)).toBe(true);
    expect(hoverSignInExpired(401)).toBe(true);
    for (const s of [0, 403, 404, 429, 500, 502, 503]) expect(hoverSignInExpired(s)).toBe(false);
  });

  it("is recognised directly and when the jobs-list error wraps it", () => {
    expect(hoverReconnectNeeded(new HoverReconnectError(400))).toBe(true);
    expect(hoverReconnectNeeded(new Error("Could not list HOVER jobs: HOVER token refresh failed: 400"))).toBe(true);
    expect(hoverReconnectNeeded(new Error("Could not list HOVER jobs: HOVER token refresh failed: 401"))).toBe(true);
  });

  it("does not swallow failures that may pass on their own", () => {
    expect(hoverReconnectNeeded(new Error("Could not list HOVER jobs: HOVER token refresh failed: 503"))).toBe(false);
    expect(hoverReconnectNeeded(new Error("Could not list HOVER jobs: 500"))).toBe(false);
    expect(hoverReconnectNeeded(new Error("Could not list HOVER jobs: network"))).toBe(false);
  });

  it("tells the customer what to do", () => {
    expect(HOVER_RECONNECT_MESSAGE).toMatch(/Reconnect HOVER/);
  });
});

describe("hoverConnNeedsReconnect", () => {
  it("follows the flag", () => {
    expect(hoverConnNeedsReconnect({ needsReconnect: true })).toBe(true);
    expect(hoverConnNeedsReconnect({ needsReconnect: false, lastError: "jobs list failed (HOVER token refresh failed: 400)" })).toBe(false);
  });
  it("recognises the error recorded before the flag existed", () => {
    expect(hoverConnNeedsReconnect({ lastError: "jobs list failed (HOVER token refresh failed: 400)" })).toBe(true);
    expect(hoverConnNeedsReconnect({ lastError: "token refresh failed (401)" })).toBe(true);
  });
  it("leaves every other state alone", () => {
    expect(hoverConnNeedsReconnect(null)).toBe(false);
    expect(hoverConnNeedsReconnect({})).toBe(false);
    expect(hoverConnNeedsReconnect({ lastError: "token refresh failed (503)" })).toBe(false);
    expect(hoverConnNeedsReconnect({ lastError: "jobs list failed (network)" })).toBe(false);
    expect(hoverConnNeedsReconnect({ lastError: "jobs list failed (4001)" })).toBe(false);
  });
});
