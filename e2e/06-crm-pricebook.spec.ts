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

    // Price Chart: preview expands one SKU into priced lines.
    await openTab(page, "Price Chart");
    const previewBtn = page.locator('[data-testid^="button-preview-"]').first();
    if (await previewBtn.isVisible().catch(() => false)) {
      const itemId = (await previewBtn.getAttribute("data-testid"))!.replace("button-preview-", "");
      await page.getByTestId(`input-qty-${itemId}`).fill("10");
      await previewBtn.click();
      await expect(page.getByTestId(`pb-item-${itemId}`).locator("table")).toBeVisible();
    }

    // Price Chart: add a SKU, edit it, delete it — the full lifecycle.
    await page.getByTestId("button-add-item").click();
    await page.getByTestId("input-item-name").fill(`E2E SKU ${stamp}`);
    await page.getByTestId("button-save-item").click();
    await expect(page.getByText("SKU added", { exact: true })).toBeVisible();
    const row = page.locator('[data-testid^="pb-item-"]', { hasText: `E2E SKU ${stamp}` });
    await expect(row).toBeVisible();
    const skuId = (await row.getAttribute("data-testid"))!.replace("pb-item-", "");

    await page.getByTestId(`button-edit-item-${skuId}`).click();
    await page.getByTestId("input-item-name").fill(`E2E SKU ${stamp} v2`);
    await page.getByTestId("button-save-item").click();
    await expect(page.getByText("SKU updated", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`pb-item-${skuId}`)).toContainText(`E2E SKU ${stamp} v2`);

    await page.getByTestId(`button-delete-item-${skuId}`).click(); // confirm auto-accepted
    await expect(page.getByText("SKU deleted", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`pb-item-${skuId}`)).toHaveCount(0);

    guards.assertClean("pricebook curated");
  });

  for (const tab of ["Price Chart", "Materials", "Labor", "Formulas"]) {
    test(`sweep: every button and link (${tab} tab)`, async ({ page }) => {
      const { clicked } = await sweepPage(page, "/crm/pricebook", {
        ready: 'h1:has-text("Price book")',
        beforeEach: async (p) => openTab(p, tab),
        // Delete is curated above — a sweep would empty the whole price chart.
        skip: ({ testid }) => testid.startsWith("button-delete-item-"),
      });
      console.log(`pricebook ${tab} sweep clicked ${clicked}`);
      expect(clicked).toBeGreaterThanOrEqual(10);
    });
  }
});
