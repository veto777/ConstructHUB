import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/crm/settings", () => {
  test("curated: company save, defaults save, notification toggle persists, logout", async ({ page }) => {
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

    // Notifications: flip one, prove it survives a reload, restore the ORIGINAL
    // state (the sweep clicks these switches too — never assume an initial value,
    // or the next suite run starts dirty).
    const viewedSwitch = page.getByTestId("switch-notif-estimateViewed");
    const original = await viewedSwitch.getAttribute("aria-checked");
    await viewedSwitch.click();
    await expect(page.getByText("Notification preferences saved", { exact: true })).toBeVisible();
    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("switch-notif-estimateViewed")).toHaveAttribute(
      "aria-checked",
      original === "true" ? "false" : "true",
    );
    await page.getByTestId("switch-notif-estimateViewed").click();
    await expect(page.getByText("Notification preferences saved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("switch-notif-estimateViewed")).toHaveAttribute("aria-checked", original!);

    // Owner-level switches (bid sent / member signs in / account changes /
    // website lead): same dance as estimateViewed — render, toggle, persist
    // across a reload, then restore the ORIGINAL states so the next suite
    // run (and the parallel sweep below) never starts dirty.
    const ownerKeys = ["estimateSent", "memberLogin", "memberAccountChange", "leadReceived"];
    const ownerOriginals: Record<string, string | null> = {};
    for (const key of ownerKeys) {
      const sw = page.getByTestId(`switch-notif-${key}`);
      await expect(sw).toBeVisible();
      ownerOriginals[key] = await sw.getAttribute("aria-checked");
      await sw.click();
      await expect(page.getByText("Notification preferences saved", { exact: true }).first()).toBeVisible();
    }
    await gotoCrm(page, "/crm/settings");
    for (const key of ownerKeys) {
      await expect(page.getByTestId(`switch-notif-${key}`)).toHaveAttribute(
        "aria-checked",
        ownerOriginals[key] === "true" ? "false" : "true",
      );
    }
    for (const key of ownerKeys) {
      const sw = page.getByTestId(`switch-notif-${key}`);
      await sw.click();
      await expect(page.getByText("Notification preferences saved", { exact: true }).first()).toBeVisible();
      await expect(sw).toHaveAttribute("aria-checked", ownerOriginals[key]!);
    }

    // The integrations sections moved out — the pointer card stands in their place.
    await expect(page.getByTestId("card-integrations-moved")).toBeVisible();
    await page.getByTestId("link-integrations").click();
    await page.waitForURL("**/crm/integrations**");
    await expect(page.locator("h1")).toContainText("Integrations");

    // Back on settings: lead sources render from seeded data.
    await gotoCrm(page, "/crm/settings");
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
      // Connect Google Calendar redirects off-site to the OAuth consent screen
      // (Google creds ARE set in dev), same reason 07 skips Connect Stripe.
      skip: ({ testid }) => testid === "button-connect-google-calendar",
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

test.describe("/crm/integrations", () => {
  test("curated: cards render, api key + webhook lifecycle", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/integrations");
    await expect(page.locator("h1")).toContainText("Integrations");

    // The directory: HOVER's full card plus the summary/placeholder cards.
    await expect(page.getByTestId("card-hover")).toBeVisible();
    await expect(page.getByTestId("card-stripe")).toBeVisible();
    await expect(page.getByTestId("card-google-calendar")).toBeVisible();
    await expect(page.getByTestId("card-cladai")).toBeVisible();
    await expect(page.getByTestId("pill-cladai-status")).toHaveText("Coming soon");

    // HOVER renders one of its honest states: connected pill, the connect
    // button, or the not-configured empty state (creds vary by deployment).
    const hoverState = page.locator(
      '[data-testid="pill-hover-connected"], [data-testid="button-connect-hover"]',
    );
    await expect(hoverState.first()).toBeVisible();

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

    guards.assertClean("integrations curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked } = await sweepPage(page, "/crm/integrations", {
      ready: 'h1:has-text("Integrations")',
      // Connect HOVER redirects off-site to the OAuth consent screen (real
      // OAuth app creds in .env) — same reason 14 skips Connect Google. The
      // testid sits on the <a>; its inner <button> is a separate sweep
      // candidate keyed by text, so skip that shape too.
      skip: ({ testid, text, href }) =>
        testid === "button-connect-hover" ||
        href.includes("/api/crm/integrations/hover/connect") ||
        text === "Connect HOVER",
    });
    console.log(`integrations sweep clicked ${clicked}`);
    expect(clicked).toBeGreaterThanOrEqual(10);
  });

  test("shell: integrations nav item routes and shows the active pill", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/clients");
    await page.getByTestId("link-nav-integrations").click();
    await page.waitForURL("**/crm/integrations**");
    await expect(page.locator("h1")).toContainText("Integrations");
    await expect(page.getByTestId("text-crm-section")).toHaveText("Integrations");
    guards.assertClean("integrations nav");
  });
});
