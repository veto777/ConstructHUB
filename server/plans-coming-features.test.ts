import { describe, it, expect } from "vitest";
import {
  PLANS, PLAN_KEYS, COMING_MODULES, FEATURE_BULLET_MODULE, isComingFeature,
} from "../shared/plans";

/**
 * The "coming soon" mechanism for plan bullets: FEATURE_BULLET_MODULE links a
 * plan's feature bullet to the module it advertises, and a bullet wears the
 * badge only while that module sits in COMING_MODULES. These tests keep the
 * map honest, so the pricing cards and the checkout purchase review cannot
 * silently promise a feature that is not built (or keep calling a live one
 * "coming").
 */
describe("coming-soon feature bullets", () => {
  it("scheduled client email reports are live — not in COMING_MODULES", () => {
    // Built and shipping: server/seo/site-report-send.ts (sendDueReports), run by
    // server/seo/jobs.ts; schedules are saved from the SEO Reports page
    // (server/seo/routes.ts saveSchedule) and shown in client/src/pages/seo/reports.tsx.
    expect(COMING_MODULES).not.toContain("scheduledReports");
    expect(COMING_MODULES).toEqual(["csvExport", "permitAlerts"]);
  });

  it("every mapped bullet is a real bullet of a plan that grants the module", () => {
    for (const [bullet, module] of Object.entries(FEATURE_BULLET_MODULE)) {
      // The bullet text exists on at least one plan…
      const carriers = PLAN_KEYS.filter((k) => PLANS[k].features.includes(bullet));
      expect(carriers.length, bullet).toBeGreaterThan(0);
      // …and every plan that states the bullet actually grants the module behind it
      // (otherwise the badge would advertise a feature the plan does not carry).
      for (const key of carriers) expect(PLANS[key].modules[module!], `${key}: ${bullet}`).toBe(true);
    }
  });

  it("every COMING_MODULES module is advertised by a mapped bullet", () => {
    // One mechanism: a module can only be marked Coming where a bullet can carry the badge.
    for (const module of COMING_MODULES) {
      expect(Object.values(FEATURE_BULLET_MODULE), module).toContain(module);
    }
  });

  it("isComingFeature badges only the bullets whose modules are still coming", () => {
    expect(isComingFeature("CSV export of every report")).toBe(true); // Pro — csvExport is coming
    expect(isComingFeature("Permit alerts for new filings in your territory")).toBe(true); // Agency — permitAlerts is coming
    expect(isComingFeature("Scheduled client email reports")).toBe(false); // Agency — live, ships today
    expect(isComingFeature("Everything in Team")).toBe(false);
    expect(isComingFeature("Priority email support")).toBe(false);
  });
});
