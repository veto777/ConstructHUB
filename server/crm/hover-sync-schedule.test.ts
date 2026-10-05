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
