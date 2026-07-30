import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/crm/pipeline", () => {
  test("curated: stage Select moves a card, card links to project", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/pipeline");
    await expect(page.locator("h1")).toContainText("Pipeline");

    // Seeded projects render in their stage columns.
    const firstCard = page.locator('[data-testid^="card-project-"]').first();
    await expect(firstCard).toBeVisible();
    const projectId = (await firstCard.getAttribute("data-testid"))!.replace("card-project-", "");

    // Move it to a different stage via the Select.
    const select = page.getByTestId(`select-stage-${projectId}`);
    const currentStage = (await select.innerText()).trim();
    await select.click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();
    const texts = await options.allInnerTexts();
    const otherIdx = texts.findIndex((t) => t.trim() !== currentStage);
    expect(otherIdx).toBeGreaterThanOrEqual(0);
    await options.nth(otherIdx).click();
    await expect(page.getByText("Stage updated", { exact: true })).toBeVisible();

    // Card title links through to the project detail page.
    await page.getByTestId(`card-project-${projectId}`).locator("a").first().click();
    await expect(page).toHaveURL(new RegExp(`/crm/projects/${projectId}`));
    await expect(page.locator("h1")).toBeVisible();

    guards.assertClean("pipeline curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/pipeline", {
      ready: 'h1:has-text("Pipeline")',
    });
    console.log(`pipeline sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(15);
  });
});
