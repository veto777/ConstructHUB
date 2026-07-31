import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/crm/settings", () => {
  test("curated: company save, defaults save, notification toggle persists, api key + webhook lifecycle, logout", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/settings");
    await expect(page.locator("h1")).toContainText("Settings");

    // Company profile: edit a field and save.
    await page.getByTestId("input-company-phone").fill("555-0300");
    await page.getByTestId("button-save-company").click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();

    // Document defaults: edit and save.
    await page.getByTestId("textarea-estimate-footer").fill("E2E estimate footer");
    await page.getByTestId("button-save-defaults").click();
    await expect(page.getByText("Defaults saved", { exact: true })).toBeVisible();

    // Notifications: turn one off, prove it survives a reload, turn it back on.
    const viewedSwitch = page.getByTestId("switch-notif-estimateViewed");
    await expect(viewedSwitch).toHaveAttribute("aria-checked", "true");
    await viewedSwitch.click();
    await expect(page.getByText("Notification preferences saved", { exact: true })).toBeVisible();
    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("switch-notif-estimateViewed")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("switch-notif-estimateViewed").click();
    await expect(page.getByText("Notification preferences saved", { exact: true })).toBeVisible();

    // API keys: create (key shown once), then revoke.
    const keyName = `E2E key ${Date.now().toString(36)}`;
    await page.getByTestId("input-api-key-name").fill(keyName);
    await page.getByTestId("button-create-api-key").click();
    await expect(page.getByTestId("text-new-api-key")).toBeVisible();
    await expect(page.getByTestId("text-new-api-key")).toContainText("chk_");
    const keyRow = page.locator('[data-testid^="row-api-key-"]', { hasText: keyName });
    await expect(keyRow).toBeVisible();
    const keyId = (await keyRow.getAttribute("data-testid"))!.replace("row-api-key-", "");
    await page.getByTestId(`button-revoke-api-key-${keyId}`).click();
    await expect(page.getByText("API key revoked", { exact: true })).toBeVisible();
    await expect(keyRow).toHaveCount(0);

    // Webhooks: add (secret shown once), then delete.
    await page.getByTestId("input-webhook-url").fill("https://example.com/e2e-webhook");
    await page.getByTestId("checkbox-webhook-event-estimate.approved").click();
    await page.getByTestId("button-create-webhook").click();
    await expect(page.getByTestId("text-new-webhook-secret")).toBeVisible();
    await expect(page.getByTestId("text-new-webhook-secret")).toContainText("whsec_");
    const hookRow = page.locator('[data-testid^="row-webhook-"]', { hasText: "example.com/e2e-webhook" });
    await expect(hookRow).toBeVisible();
    const hookId = (await hookRow.getAttribute("data-testid"))!.replace("row-webhook-", "");
    await page.getByTestId(`button-delete-webhook-${hookId}`).click();
    await expect(page.getByText("Webhook deleted", { exact: true })).toBeVisible();
    await expect(hookRow).toHaveCount(0);

    // Lead sources render from seeded data.
    await expect(page.locator('[data-testid^="row-lead-source-"]').first()).toBeVisible();

    guards.assertClean("settings curated");

    // Logout: clears the session and lands on /auth. (The dev bypass
    // re-authenticates on the next request; the navigation itself is what's
    // under test here.)
    await page.getByTestId("button-logout").click();
    await page.waitForURL("**/auth**");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked } = await sweepPage(page, "/crm/settings", {
      ready: 'h1:has-text("Settings")',
    });
    console.log(`settings sweep clicked ${clicked}`);
    expect(clicked).toBeGreaterThanOrEqual(10);
  });

  test("shell: settings nav item routes and shows the active pill", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/clients");
    await page.getByTestId("link-nav-settings").click();
    await page.waitForURL("**/crm/settings**");
    await expect(page.locator("h1")).toContainText("Settings");
    await expect(page.getByTestId("text-crm-section")).toHaveText("Settings");
    guards.assertClean("settings nav");
  });
});
