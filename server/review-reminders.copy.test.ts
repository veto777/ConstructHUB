import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { businessToolsMatrix } from "../shared/plan-matrix";
import { PLANS } from "../shared/plans";

describe("review reminder channel promises", () => {
  it("advertises email with text coming soon, while keeping email live on Team+", () => {
    const row = businessToolsMatrix().flatMap(section => section.rows)
      .find(row => row.key === "reviewReminders");
    expect(row?.label).toBe("Review reminders to customers (email; text coming soon)");
    expect(row?.cells).toEqual({ starter: false, team: true, pro: true, growth: true, agency: true });
    expect(row?.coming).toBeUndefined();
  });

  it("qualifies the Team reminder bullet inherited by higher plans", () => {
    expect(PLANS.team.features).toContain("Review reminders to your customers (email; text coming soon)");
    const bullets = Object.values(PLANS).flatMap(plan => plan.features).filter(bullet => /review reminders/i.test(bullet));
    expect(bullets).toEqual(["Review reminders to your customers (email; text coming soon)"]);
  });

  it("publishes the same channel qualification and entitlements in the generated matrix", () => {
    const doc = readFileSync(new URL("../docs/pricing/PLAN-MATRIX.md", import.meta.url), "utf8");
    expect(doc.split("\n").filter(line => line.startsWith("| Review reminders"))).toEqual([
      "| Review reminders to customers (email; text coming soon) | ❌ | ✅ | ✅ | ✅ | ✅ |",
    ]);
  });
});
