import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

// Seeded demo project: "Kane — whole-house hardwood" (in_progress).
const PROJECT_ID = "d41ab284-c52d-430d-ba18-1fb20a4ef16b";
const URL = `/crm/projects/${PROJECT_ID}`;

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("data-state", "active");
}

test.describe("/crm/projects/:id", () => {
  test("curated: every tab renders, every add form submits", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = Date.now().toString(36);
    await gotoCrm(page, URL);
    await expect(page.locator("h1")).toContainText("whole-house hardwood");

    // Costing tab (default) renders the budget table or an empty state.
    await expect(page.getByRole("tab", { name: "Costing" })).toHaveAttribute("data-state", "active");

    // Change orders: add one.
    await openTab(page, "Change orders");
    await page.getByTestId("input-co-title").fill(`E2E change order ${stamp}`);
    await page.getByTestId("button-add-co").click();
    await expect(page.getByText("Change order added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E change order ${stamp}`)).toBeVisible();

    // Punch list: add one.
    await openTab(page, "Punch list");
    await page.getByTestId("input-punch-title").fill(`E2E punch item ${stamp}`);
    await page.getByTestId("button-add-punch").click();
    await expect(page.getByText("Punch item added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E punch item ${stamp}`)).toBeVisible();

    // Daily logs: file one.
    await openTab(page, "Daily logs");
    await page.getByTestId("input-log-work").fill(`E2E log entry ${stamp}`);
    await page.getByTestId("button-add-log").click();
    await expect(page.getByText("Log filed", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E log entry ${stamp}`)).toBeVisible();

    // Selections: add one.
    await openTab(page, "Selections");
    await page.getByTestId("input-sel-name").fill(`E2E selection ${stamp}`);
    await page.getByTestId("button-add-sel").click();
    await expect(page.getByText("Selection added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E selection ${stamp}`)).toBeVisible();

    // Permits: renders (portals list, jurisdiction message, or honest empty state).
    await openTab(page, "Permits");
    await expect(page.getByText(/Permits & inspections/)).toBeVisible();

    guards.assertClean("project curated");
  });

  // One sweep per tab so add-form buttons on non-default tabs get clicked too.
  for (const tab of ["Costing", "Change orders", "Punch list", "Daily logs", "Selections", "Permits"]) {
    test(`sweep: every button and link (${tab} tab)`, async ({ page }) => {
      const { clicked } = await sweepPage(page, URL, {
        ready: "h1",
        beforeEach: async (p) => openTab(p, tab),
        skip: ({ href }) => href.startsWith("http"), // permit portal links leave the app
      });
      console.log(`project ${tab} sweep clicked ${clicked}`);
      expect(clicked).toBeGreaterThanOrEqual(10);
    });
  }
});
