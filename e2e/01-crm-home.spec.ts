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

  test("curated: headline stat cards land on their own filtered lists", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");

    // "Open estimates" counts sent+viewed — its list must open with exactly
    // those boxes ticked (regression: it linked the unfiltered list, so the
    // tile said 2,315 and the list showed everything).
    await page.getByTestId("card-stat-open-estimates").click();
    await expect(page).toHaveURL(/\/crm\/estimates\?status=sent%2Cviewed/);
    await expect(page.getByTestId("filter-status-sent")).toBeChecked();
    await expect(page.getByTestId("filter-status-viewed")).toBeChecked();
    await expect(page.getByTestId("filter-status-draft")).not.toBeChecked();

    // "Open invoices" counts sent+partial — same contract.
    await gotoCrm(page, "/crm");
    await page.getByTestId("card-stat-open-invoices").click();
    await expect(page).toHaveURL(/\/crm\/invoices\?status=sent%2Cpartial/);
    await expect(page.getByTestId("filter-status-sent")).toBeChecked();
    await expect(page.getByTestId("filter-status-partial")).toBeChecked();
    await expect(page.getByTestId("filter-status-paid")).not.toBeChecked();

    guards.assertClean("home stat card links");
  });

  test("curated: the desktop sidebar links to the schedule", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");

    // Regression: Schedule existed and the mobile ribbon had it, but the
    // desktop nav didn't — the page was unreachable without the URL.
    const schedule = page.getByTestId("link-portal-nav-schedule");
    await expect(schedule).toBeVisible();
    await expect(schedule).toContainText("Schedule");
    await schedule.click();
    await expect(page).toHaveURL(/\/crm\/schedule/);
    await expect(page.getByTestId("calendar-month")).toBeVisible();

    guards.assertClean("sidebar schedule link");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm", {
      ready: "h1",
    });
    console.log(`home sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(8);
  });
});
