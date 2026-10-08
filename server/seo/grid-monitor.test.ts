import { describe, expect, it } from "vitest";
import { compareScans, nextDue, watchInput } from "./grid-monitor";

type P = { row: number; col: number; rank: number | null; failed?: true };
/** A 5 x 5 square from a list of 25 ranks: a number, null (not in the first 20) or "x" (the lookup failed). */
const square = (ranks: (number | null | "x")[]): P[] => ranks.map((r, i) => ({ row: Math.floor(i / 5), col: i % 5, rank: r === "x" ? null : r, ...(r === "x" ? { failed: true as const } : {}) }));
const fill = (n: number, v: number | null | "x") => Array.from({ length: n }, () => v);

describe("repeating local grids", () => {
  it("only the offered shapes and periods can repeat", () => {
    expect(watchInput.safeParse({ keyword: "roof repair", size: 5, spacing: 2, every: "monthly" }).success).toBe(true);
    expect(watchInput.safeParse({ keyword: "roof repair", size: 5, spacing: 2, every: "daily" }).success).toBe(false);
    expect(watchInput.safeParse({ keyword: "roof repair", size: 9, spacing: 2, every: "weekly" }).success).toBe(false);
    expect(watchInput.safeParse({ keyword: "", size: 5, spacing: 2, every: "weekly" }).success).toBe(false);
  });
  it("the schedule is counted from its anchor, so a late run or a short month never moves it", () => {
    const d = (s: string) => new Date(s);
    // Monthly on the 31st: the last day of shorter months, and back to the 31st afterwards.
    const a = d("2026-01-31T13:00:00Z");
    expect(nextDue(a, "monthly", d("2026-01-31T13:05:00Z")).toISOString()).toBe("2026-02-28T13:00:00.000Z");
    expect(nextDue(a, "monthly", d("2026-02-28T15:00:00Z")).toISOString()).toBe("2026-03-31T13:00:00.000Z");
    expect(nextDue(a, "monthly", d("2026-04-02T00:00:00Z")).toISOString()).toBe("2026-04-30T13:00:00.000Z");
    // A run that finished three days late does not push every later run three days on.
    const w = d("2026-10-08T09:00:00Z");
    expect(nextDue(w, "weekly", d("2026-10-18T10:00:00Z")).toISOString()).toBe("2026-10-22T09:00:00.000Z");
    expect(nextDue(w, "weekly", d("2026-10-08T09:00:00Z")).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    // Not yet at the anchor: the anchor itself.
    expect(nextDue(w, "monthly", d("2026-10-01T00:00:00Z")).toISOString()).toBe(w.toISOString());
    // Skipped periods are skipped, not run one after another.
    expect(nextDue(w, "monthly", d("2027-03-20T00:00:00Z")).toISOString()).toBe("2027-04-08T09:00:00.000Z");
  });
  it("alerts on a clear change, in either direction", () => {
    const good = square(fill(25, 1)), bad = square([...fill(12, 1), ...fill(13, 9)]);
    expect(compareScans(bad, good).kind).toBe("grid_down");
    expect(compareScans(good, bad).kind).toBe("grid_up");
    // Same share in the first three, but two and a half places worse overall.
    expect(compareScans(square([...fill(10, 1), ...fill(15, 11)]), square([...fill(10, 1), ...fill(15, 6)])).kind).toBe("grid_down"); // score 7.0 against 4.0
  });
  it("says nothing about small movement", () => {
    expect(compareScans(square([...fill(23, 1), ...fill(2, 5)]), square(fill(25, 1))).kind).toBeNull(); // 100% -> 92%
    expect(compareScans(square(fill(25, 2)), square(fill(25, 2))).kind).toBeNull();
  });
  it("compares only the points both scans checked: a point that failed says nothing", () => {
    // Twenty points rank first and five are not found. Next time those five fail to load: nothing changed, so no "better".
    const before = square([...fill(20, 1), ...fill(5, null)]), now = square([...fill(20, 1), ...fill(5, "x")]);
    const c = compareScans(now, before);
    expect([c.kind, c.common, c.now.top3, c.before.top3, c.now.avgRank, c.before.avgRank]).toEqual([null, 20, 20, 20, 1, 1]);
    // Too little in common proves nothing either way.
    expect(compareScans(square([...fill(15, 9), ...fill(10, "x")]), square(fill(25, 1)))).toMatchObject({ kind: null, common: 15 });
    expect(compareScans([], square(fill(25, 1))).kind).toBeNull();
  });
  it("a collapse is not hidden by one more point in the first three", () => {
    // One point in the first three and 24 in fourth place; then two in the first three and 23 not found at all.
    const before = square([1, ...fill(24, 4)]), now = square([1, 1, ...fill(23, null)]);
    const c = compareScans(now, before);
    expect(c.kind).toBe("grid_down");
    expect(c.now.avgRank! - c.before.avgRank!).toBeGreaterThan(10);
  });
  it("better needs a clear signal and nothing saying worse", () => {
    // More points in the first three, but far worse overall: that is worse, not better.
    expect(compareScans(square([...fill(8, 1), ...fill(17, null)]), square([...fill(4, 1), ...fill(21, 5)])).kind).toBe("grid_down");
    expect(compareScans(square([...fill(8, 1), ...fill(17, 5)]), square([...fill(4, 1), ...fill(21, 5)])).kind).toBe("grid_up");
  });
});
