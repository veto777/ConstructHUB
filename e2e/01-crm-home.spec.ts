import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm home", () => {
  test("curated: renders workspace, cards navigate, setup actions work", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");

    // Header shell and workspace title.
    await expect(page.getByTestId("link-portal-home")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();

    // The three destination cards navigate somewhere valid.
    await page.getByTestId("card-clients").click();
    await expect(page).toHaveURL(/\/crm\/clients/);
    await expect(page.locator("h1")).toContainText("Clients");

    await gotoCrm(page, "/crm");
    await page.getByTestId("card-team").click();
    await expect(page).toHaveURL(/\/crm\/team\?tab=team/);

    await gotoCrm(page, "/crm");
    await page.getByTestId("card-company").click();
    await expect(page).toHaveURL(/\/crm\/team\?tab=company/);

    // Setup card: whatever state onboarding is in, its primary action works.
    await gotoCrm(page, "/crm");
    const setup = page.getByTestId("card-setup");
    if (await setup.isVisible().catch(() => false)) {
      const cont = page.getByTestId("button-continue-setup");
      const finish = page.getByTestId("button-finish-setup");
      if (await cont.isVisible().catch(() => false)) {
        await cont.click();
        // Lands on the next step's page and renders.
        await expect(page.locator("h1")).toBeVisible();
      } else if (await finish.isVisible().catch(() => false)) {
        await finish.click();
        await expect(setup).toBeHidden({ timeout: 10_000 });
      }
    }

    guards.assertClean("home curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm", {
      ready: "h1",
    });
    console.log(`home sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(8);
  });
});
