import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("data-state", "active");
}

test.describe("/crm/pricebook", () => {
  test("curated: add material, add labor rate, test formula, preview assembly", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/pricebook");
    await expect(page.locator("h1")).toContainText("Price book");

    // Materials: add one.
    await openTab(page, "Materials");
    const stamp = Date.now().toString(36);
    await page.getByTestId("input-mat-name").fill(`E2E material ${stamp}`);
    await page.getByTestId("button-add-material").click();
    await expect(page.getByText("Material added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E material ${stamp}`)).toBeVisible();

    // Labor: add a rate.
    await openTab(page, "Labor");
    await page.getByTestId("input-lab-name").fill(`E2E crew ${stamp}`);
    await page.getByTestId("button-add-labor").click();
    await expect(page.getByText("Labor rate added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E crew ${stamp}`)).toBeVisible();

    // Formulas: the tester evaluates without eval.
    await openTab(page, "Formulas");
    await page.getByTestId("input-formula").fill("ceil([SQUARES] * (1 + [WASTE]/100))");
    await page.getByTestId("button-test-formula").click();
    await expect(page.getByTestId("text-formula-result")).toContainText("= 36");

    // Assemblies: preview expands one into priced lines.
    await openTab(page, "Assemblies");
    const previewBtn = page.locator('[data-testid^="button-preview-"]').first();
    if (await previewBtn.isVisible().catch(() => false)) {
      const itemId = (await previewBtn.getAttribute("data-testid"))!.replace("button-preview-", "");
      await page.getByTestId(`input-qty-${itemId}`).fill("10");
      await previewBtn.click();
      await expect(page.getByTestId(`pb-item-${itemId}`).locator("table")).toBeVisible();
    }

    guards.assertClean("pricebook curated");
  });

  for (const tab of ["Assemblies", "Materials", "Labor", "Formulas"]) {
    test(`sweep: every button and link (${tab} tab)`, async ({ page }) => {
      const { clicked } = await sweepPage(page, "/crm/pricebook", {
        ready: 'h1:has-text("Price book")',
        beforeEach: async (p) => openTab(p, tab),
      });
      console.log(`pricebook ${tab} sweep clicked ${clicked}`);
      expect(clicked).toBeGreaterThanOrEqual(10);
    });
  }
});
