import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

// Seeded client in the Alpine org.
const CLIENT_ID = "2c25304d-e441-4df7-8e45-27282d4c2c74"; // Joe & Mary Kane
const URL = `/crm/clients/${CLIENT_ID}`;

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm/clients/:id", () => {
  test("curated: estimate builder — lines, create, options dialog", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, URL);
    await expect(page.locator("h1")).toContainText("Joe & Mary Kane");

    // Portal link copy works (clipboard permission granted in config).
    await page.getByTestId("button-copy-portal").click();
    await expect(page.getByText("Client portal link copied", { exact: true })).toBeVisible();

    // New estimate: two lines, remove one, create.
    const title = `E2E detail estimate ${Date.now().toString(36)}`;
    await page.getByTestId("button-new-estimate").click();
    await page.getByTestId("input-estimate-title").fill(title);
    const firstRow = page.getByTestId("line-item-0");
    await firstRow.locator("input").first().fill("Tear off existing roof");
    await page.getByTestId("button-add-item").click();
    const secondRow = page.getByTestId("line-item-1");
    await secondRow.locator("input").first().fill("Install architectural shingles");
    // Qty 2 @ $150 on line 2.
    await secondRow.locator('input[type="number"]').first().fill("2");
    await secondRow.locator('input[type="number"]').nth(1).fill("150");
    // Remove the first line again — the remove control must work.
    await page.getByTestId("button-remove-item-0").click();
    await expect(page.getByTestId("line-item-1")).toHaveCount(0);
    await page.getByTestId("button-save-estimate").click();
    await expect(page.getByText("Estimate created", { exact: true })).toBeVisible();

    // The new estimate shows up with Options and Send actions.
    const est = page.locator('[data-testid^="estimate-"]', { hasText: title });
    await expect(est).toBeVisible();
    const estId = (await est.getAttribute("data-testid"))!.replace("estimate-", "");

    // Options dialog: add a Good/Better/Best tier.
    await page.getByTestId(`button-options-${estId}`).click();
    await page.getByTestId("input-option-name").fill("Good");
    await page.getByTestId("input-option-total").fill("299");
    await page.getByTestId("check-option-recommended").click();
    await page.getByTestId("button-save-option").click();
    await expect(page.getByText("Option added", { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid^="option-"]').first()).toContainText("Good");
    // The toast sits above the dialog in Radix's dismissable-layer stack, so
    // the first Escape closes the toast, the next closes the dialog.
    for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await expect(page.locator('[role="dialog"]')).toBeHidden();

    // New project dialog on the same page.
    await page.getByTestId("button-new-project").click();
    await page.getByTestId("input-project-name").fill("E2E detail project");
    await page.getByTestId("button-save-project").click();
    await expect(page.getByText("Project created", { exact: true })).toBeVisible();

    // The accountability feed folds into the client timeline: the estimate
    // this test just created shows up as a "who did what" audit entry.
    await gotoCrm(page, URL);
    await expect(page.getByTestId("section-timeline")).toContainText("created estimate");

    guards.assertClean("client detail curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    // The ⓘ info tips added ~8 controls (each opening a dialog the sweep
    // closes) to what was already the suite's slowest sweep — it now needs
    // more than the default 240s at 4 workers.
    test.slow();
    const { clicked, labels } = await sweepPage(page, URL, {
      ready: "h1",
    });
    console.log(`client detail sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(15);
  });
});
