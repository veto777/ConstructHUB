import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * Fresh-load smoke for every main CRM page.
 *
 * Motivation: a useState-after-early-return crash blanked /crm/pipeline on
 * fresh loads while cached navigation looked fine. Each navigation below is a
 * HARD load (full document fetch, empty react-query cache) — the exact
 * condition that class of bug ships under. Asserts real content renders and
 * no uncaught errors / bad API responses occur.
 */

// route → selector proving the page actually rendered its content
const PAGES: Array<[string, string]> = [
  ["/crm", "h1"],
  ["/crm/clients", "h1"],
  ["/crm/schedule", "h1"],
  ["/crm/inbox", '[data-testid="tab-inbox-messages"]'],
  ["/crm/pipeline", "h1"],
  ["/crm/estimates", "h1"],
  ["/crm/estimates/new", "h1"],
  ["/crm/invoices", "h1"],
  ["/crm/pricebook", "h1"],
  ["/crm/payments", "h1"],
  ["/crm/team", "h1"],
  ["/crm/settings", "h1"],
  ["/crm/integrations", "h1"],
  ["/crm/reports", "h1"],
  ["/crm/migrate", "h1"],
  ["/crm/admin", '[data-testid="card-admin-gate"], [data-testid="crm-admin-page"]'],
];

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("fresh-load smoke: every main CRM page renders", () => {
  for (const [path, ready] of PAGES) {
    test(`${path} hard-loads with content`, async ({ page }) => {
      const guards = watchPage(page);
      await gotoCrm(page, path);
      await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
      guards.assertClean(`smoke ${path}`);
    });
  }
});
