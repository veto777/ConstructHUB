/**
 * The CRM day window behind the dashboard's "Today" / "Next 7 days" /
 * "Today's visits" numbers (server/dashboard/tiles/run.ts). Regression test
 * for the audit finding (2026-10-04): those tiles counted a UTC day while the
 * org's schedule page numbers local days, so for an America/Los_Angeles org
 * the "Today" tile counted tomorrow morning's visits from 5pm and dropped
 * this evening's.
 */
import { describe, expect, it } from "vitest";
import { startOfOrgDay } from "./tiles/run";

const LA = "America/Los_Angeles";

describe("startOfOrgDay (dashboard CRM day window)", () => {
  it("is the org timezone's midnight, not UTC's", () => {
    // 2026-10-04 23:30 UTC is 16:30 PDT — the same calendar day in LA.
    expect(startOfOrgDay(new Date("2026-10-04T23:30:00Z"), LA).toISOString()).toBe("2026-10-04T07:00:00.000Z");
  });

  it("late evening in LA is still the same business day", () => {
    // 2026-10-05 02:30 UTC is 2026-10-04 19:30 PDT.
    expect(startOfOrgDay(new Date("2026-10-05T02:30:00Z"), LA).toISOString()).toBe("2026-10-04T07:00:00.000Z");
  });

  it("early UTC morning, before LA wakes, is the previous LA day", () => {
    // 2026-10-04 05:00 UTC is 2026-10-03 22:00 PDT.
    expect(startOfOrgDay(new Date("2026-10-04T05:00:00Z"), LA).toISOString()).toBe("2026-10-03T07:00:00.000Z");
  });

  it("respects DST (January is PST, UTC-8)", () => {
    // 2026-01-15 05:30 UTC is 2026-01-14 21:30 PST.
    expect(startOfOrgDay(new Date("2026-01-15T05:30:00Z"), LA).toISOString()).toBe("2026-01-14T08:00:00.000Z");
  });

  it("falls back to the UTC day without a usable timezone", () => {
    const d = new Date("2026-10-05T02:30:00Z");
    expect(startOfOrgDay(d, null).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(startOfOrgDay(d, "").toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(startOfOrgDay(d, "Not/AZone").toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("covers a full 7-day window from the org midnight", () => {
    const start = startOfOrgDay(new Date("2026-10-05T02:30:00Z"), LA);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    // A visit "tomorrow morning" in LA (2026-10-05 08:00 PDT = 15:00 UTC) is inside…
    expect(new Date("2026-10-05T15:00:00Z").getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(new Date("2026-10-05T15:00:00Z").getTime()).toBeLessThan(end.getTime());
  });
});
