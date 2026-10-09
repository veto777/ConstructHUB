/** The public-API allowances in the price book and how entitlements expose them (pure). */
import { describe, expect, it } from "vitest";
import { ADDONS, PLANS, PLAN_KEYS, type AddonKey } from "@shared/plans";
import { allowancesFor, cheapestPlanWhere } from "../entitlements";

describe("public API plan limits", () => {
  it("Starter and Team have no API; Pro 50k, Agency 250k, Unlimited uncapped; 60 requests a minute (120 on Unlimited)", () => {
    expect(PLAN_KEYS.map((k) => [k, PLANS[k].limits.apiUnitsPerMonth])).toEqual([["starter", 0], ["team", 0], ["pro", 50_000], ["growth", 250_000], ["agency", -1]]);
    for (const k of PLAN_KEYS) expect(PLANS[k].limits.apiRatePerMinute).toBe(k === "agency" ? 120 : 60);
  });

  it("entitlement allowances carry them and no add-on raises them", () => {
    const everyAddon = Object.fromEntries((Object.keys(ADDONS) as AddonKey[]).map((k) => [k, 5]));
    for (const k of PLAN_KEYS) {
      const a = allowancesFor(k, everyAddon);
      expect(a.apiUnitsPerMonth).toBe(PLANS[k].limits.apiUnitsPerMonth);
      expect(a.apiRatePerMinute).toBe(PLANS[k].limits.apiRatePerMinute);
    }
    for (const addon of Object.values(ADDONS)) {
      expect(addon.grants).not.toHaveProperty("apiUnitsPerMonth");
      expect(addon.grants).not.toHaveProperty("apiRatePerMinute");
    }
  });

  it("Pro is the cheapest plan with API access (the 402 names it)", () => {
    expect(cheapestPlanWhere((l) => l.apiUnitsPerMonth > 0)).toBe("pro");
  });
});
