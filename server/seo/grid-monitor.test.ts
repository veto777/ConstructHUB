import { describe, expect, it } from "vitest";
import { gridChange, watchInput } from "./grid-monitor";

const f = (top3: number, checked: number, avgRank: number | null, points = 25) => ({ top3, checked, points, avgRank });

describe("repeating local grids", () => {
  it("only the offered shapes and periods can repeat", () => {
    expect(watchInput.safeParse({ keyword: "roof repair", size: 5, spacing: 2, every: "monthly" }).success).toBe(true);
    expect(watchInput.safeParse({ keyword: "roof repair", size: 5, spacing: 2, every: "daily" }).success).toBe(false);
    expect(watchInput.safeParse({ keyword: "roof repair", size: 9, spacing: 2, every: "weekly" }).success).toBe(false);
    expect(watchInput.safeParse({ keyword: "", size: 5, spacing: 2, every: "weekly" }).success).toBe(false);
  });
  it("alerts on a clear change, in either direction", () => {
    expect(gridChange(f(12, 25, 6.2), f(20, 25, 2.1))).toBe("grid_down"); // 80% -> 48% of points in the first three
    expect(gridChange(f(20, 25, 2.1), f(12, 25, 6.2))).toBe("grid_up");
    expect(gridChange(f(10, 25, 9.0), f(10, 25, 6.5))).toBe("grid_down"); // same share, but two and a half places worse overall
    expect(gridChange(f(10, 25, 4.0), f(10, 25, 6.5))).toBe("grid_up");
  });
  it("says nothing about small movement", () => {
    expect(gridChange(f(18, 25, 2.6), f(20, 25, 2.1))).toBeNull(); // 80% -> 72%
    expect(gridChange(f(20, 25, 2.1), f(20, 25, 2.1))).toBeNull();
    expect(gridChange(f(21, 25, 3.5), f(20, 25, 2.1))).toBeNull();
  });
  it("says nothing when either scan checked too few of its points to prove anything", () => {
    expect(gridChange(f(5, 15, 9), f(20, 25, 2.1))).toBeNull(); // 15 of 25 checked
    expect(gridChange(f(12, 25, 6.2), f(8, 12, 2.1))).toBeNull();
    expect(gridChange(f(0, 0, null), f(20, 25, 2.1))).toBeNull();
  });
  it("mixed signals are not called a fall", () => {
    // More points in the first three, yet a worse score because a few far points dropped out: not a clear fall.
    expect(gridChange(f(22, 25, 4.5), f(20, 25, 2.1))).toBeNull();
  });
});
