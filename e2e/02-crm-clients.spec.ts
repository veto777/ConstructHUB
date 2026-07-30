import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm/clients", () => {
  test("curated: search, create client, open detail", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/clients");
    await expect(page.locator("h1")).toContainText("Clients");

    // Seeded clients render.
    const search = page.getByTestId("input-search-clients");
    await expect(search).toBeVisible();
    const rows = page.locator('[data-testid^="client-"]');
    await expect(rows.first()).toBeVisible();

    // Search narrows the list.
    await search.fill("zzz-no-such-client");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No clients yet")).toBeVisible();
    await search.fill("");
    await expect(rows.first()).toBeVisible();

    // Create a client through the dialog.
    const stamp = Date.now().toString(36);
    const name = `E2E Client ${stamp}`;
    await page.getByTestId("button-new-client").click();
    await page.getByTestId("input-client-name").fill(name);
    await page.getByTestId("input-client-email").fill(`e2e-${stamp}@example.com`);
    await page.getByTestId("button-save-client").click();
    await expect(page.getByText("Client created", { exact: true })).toBeVisible();
    // New client appears and its row navigates to the detail page.
    await search.fill(name);
    const row = page.locator('[data-testid^="client-"]').first();
    await expect(row).toContainText(name);
    await row.click();
    await expect(page).toHaveURL(/\/crm\/clients\/[0-9a-f-]+/);
    await expect(page.locator("h1")).toContainText(name);

    guards.assertClean("clients curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/clients", {
      ready: 'h1:has-text("Clients")',
    });
    console.log(`clients sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(12);
  });
});
