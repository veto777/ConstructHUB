import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, sweepPage, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm/migrate", () => {
  test("curated: upload customers CSV → preview → import → rows in /crm/clients", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/migrate");
    await expect(page.locator("h1")).toContainText("Bring your data with you");

    // The assisted card is honest copy, always rendered.
    await expect(page.getByText("Coming from Jobber, Leap, or QuickBooks Online?")).toBeVisible();
    await expect(page.getByTestId("button-request-assisted")).toBeVisible();

    // Upload a Jobber-flavoured CSV: quoted name with a comma, two fresh rows.
    // Phones derive from the clock — a fixed "555-0101" would dedupe-skip
    // against the previous run's own imported rows.
    const stamp = Date.now().toString(36);
    const phoneDigits = String(Date.now()).slice(-7);
    const nameA = `Mig Alpha ${stamp}`;
    const nameB = `Mig Beta ${stamp}`;
    const csv = [
      "Name,Email,Phone,Address,Notes",
      `"${nameA}",mig-a-${stamp}@example.com,202-${phoneDigits},"123 Main St, Apt 2","from Jobber"`,
      `${nameB},mig-b-${stamp}@example.com,203-${phoneDigits},456 Oak Ave,`,
    ].join("\n");
    await page.getByTestId("input-migrate-file").setInputFiles({
      name: "jobber-clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    // Preview: auto-mapping lands, both rows valid.
    await page.getByTestId("button-preview").click();
    await expect(page.getByTestId("text-preview-summary")).toContainText("2 rows");
    await expect(page.getByTestId("text-preview-summary")).toContainText("all rows valid");
    await expect(page.getByTestId("preview-row-1")).toContainText(nameA);

    // Import: two created, none skipped.
    await page.getByTestId("button-run-import").click();
    await expect(page.getByTestId("card-import-result")).toBeVisible();
    await expect(page.getByTestId("text-import-summary")).toContainText("2 created");
    await expect(page.getByTestId("text-import-summary")).toContainText("0 errors");

    // The imported clients are real rows in /crm/clients.
    await page.getByTestId("link-view-clients").click();
    await expect(page).toHaveURL(/\/crm\/clients/);
    const search = page.getByTestId("input-search-clients");
    await search.fill(nameA);
    await expect(page.locator('[data-testid^="client-"]').first()).toContainText(nameA);
    await search.fill(nameB);
    await expect(page.locator('[data-testid^="client-"]').first()).toContainText(nameB);

    // Re-importing the same file skips both rows on the email match.
    await gotoCrm(page, "/crm/migrate");
    await page.getByTestId("input-migrate-file").setInputFiles({
      name: "jobber-clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByTestId("button-preview").click();
    await expect(page.getByTestId("text-preview-summary")).toContainText("2 rows");
    await page.getByTestId("button-run-import").click();
    await expect(page.getByTestId("text-import-summary")).toContainText("0 created");
    await expect(page.getByTestId("text-import-summary")).toContainText("2 skipped");

    guards.assertClean("migrate curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/migrate", {
      ready: 'h1:has-text("Bring your data with you")',
      // The assisted button deliberately emails the team (and 502s without
      // SMTP in dev) — a click-through has no business sending real mail.
      skip: ({ testid }) => testid === "button-request-assisted",
    });
    console.log(`migrate sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(4);
  });
});
