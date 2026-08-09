import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * Layout sweep: every main CRM page at phone (375px) and desktop (1280px)
 * widths. Asserts the page renders content and never grows a horizontal
 * scrollbar — the objective signal for clipped layouts and unreachable
 * controls (a footer was clipped once already; this hunts the siblings).
 */

const PAGES = [
  "/crm",
  "/crm/clients",
  "/crm/schedule",
  "/crm/inbox",
  "/crm/pipeline",
  "/crm/estimates",
  "/crm/estimates/new",
  "/crm/invoices",
  "/crm/pricebook",
  "/crm/payments",
  "/crm/team",
  "/crm/settings",
  "/crm/integrations",
  "/crm/reports",
  "/crm/migrate",
];

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("layout sweep: no horizontal scroll, content renders", () => {
  for (const width of [375, 1280]) {
    for (const path of PAGES) {
      test(`${path} @ ${width}px`, async ({ page }) => {
        const guards = watchPage(page);
        await page.setViewportSize({ width, height: 800 });
        await gotoCrm(page, path);
        await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

        // Let late-loading queries settle their layout, then measure.
        await page.waitForTimeout(800);
        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
        });
        expect(
          overflow.scrollWidth,
          `horizontal overflow: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);

        guards.assertClean(`layout ${path} @ ${width}`);
      });
    }
  }
});
