/**
 * Role defaults — pure permission math, no server needed.
 */
import { describe, it, expect } from "vitest";

describe("sales role defaults", () => {
  it("owns pricing and the sell path, but not scheduling or the back office", async () => {
    const { crmEffectivePermissions } = await import("@shared/schema");
    const p = crmEffectivePermissions("sales", null);
    // Sells and prices the job.
    for (const on of ["manageEstimates", "manageInvoices", "managePriceBook", "seePrices",
                      "seeCosts", "approveChangeOrders", "takePayment", "manageCustomers",
                      "viewAllJobs", "seeReporting"]) {
      expect([on, p[on as keyof typeof p]]).toEqual([on, true]);
    }
    // Not operations, not the back office.
    for (const off of ["manageJobs", "manageTeam", "manageSettings", "manageIntegrations", "exportData"]) {
      expect([off, p[off as keyof typeof p]]).toEqual([off, false]);
    }
  });
});
