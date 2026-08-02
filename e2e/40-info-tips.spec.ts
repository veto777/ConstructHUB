import { expect, test, type Page } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, watchPage } from "./helpers";

/**
 * The ⓘ info-tip help system: every mounted tip must open a dialog with a
 * non-empty title and plain-English body, and the dialog must close every
 * way a user would try — Esc, the X, and the backdrop. The core pages each
 * carry at least one tip; the Quick Bid tip must actually explain the
 * square-footage pricing it's selling.
 *
 * No @serial tag: the only mutation is one throwaway customer, cleaned up
 * in afterAll like the other document specs.
 */

const TIP = '[data-testid^="info-tip-"]';
const DIALOG = '[data-testid^="info-dialog-"]';
const TITLE = '[data-testid^="info-title-"]';
const BODY = '[data-testid^="info-body-"]';

let customerId = "";

test.afterAll(async () => {
  if (customerId) {
    await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [customerId]).catch(() => {});
    await q(`delete from crm_customers where id = $1`, [customerId]).catch(() => {});
  }
});

async function makeCustomer(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await page.request.post("/api/crm/customers", {
    data: { displayName: `E2E InfoTip ${stamp}`, email: `e2e-infotip-${stamp}@example.com` },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id;
}

/** Assert the currently-open tip dialog has a real title and body. */
async function expectDialogContent(page: Page) {
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(TITLE)).not.toBeEmpty();
  await expect(dialog.locator(BODY)).not.toBeEmpty();
  // Every tip gets at least one full paragraph of plain English.
  expect((await dialog.locator(BODY).innerText()).trim().length).toBeGreaterThan(40);
}

/** Open and close every mounted, visible tip on the current page. */
async function exerciseAllTips(page: Page) {
  // Re-count each iteration: opening a dialog can reflow the page.
  for (let i = 0; i < 60; i++) {
    const tips = page.locator(`${TIP}:visible`);
    if (i >= (await tips.count())) break;
    const tip = tips.nth(i);
    await tip.scrollIntoViewIfNeeded();
    await tip.click();
    await expectDialogContent(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();
  }
}

test.describe("info tips", () => {
  test("the core pages each carry at least one mounted tip", async ({ page }) => {
    const guards = watchPage(page);
    customerId = await makeCustomer(page);

    const corePages = [
      "/crm",
      "/crm/clients",
      `/crm/clients/${customerId}`,
      "/crm/pipeline",
      "/crm/estimates",
      "/crm/invoices",
      "/crm/estimates/new",
      "/crm/pricebook",
      "/crm/schedule",
      "/crm/inbox",
    ];
    for (const path of corePages) {
      await gotoCrm(page, path);
      const count = await page.locator(`${TIP}:visible`).count();
      expect(count, `${path} should mount at least one info tip`).toBeGreaterThanOrEqual(1);
    }
    guards.assertClean("core pages");
  });

  test("every mounted tip on the main pages opens a titled, written dialog", async ({ page }) => {
    const guards = watchPage(page);
    if (!customerId) customerId = await makeCustomer(page);

    const pages = [
      "/crm",
      "/crm/clients",
      `/crm/clients/${customerId}`,
      "/crm/pipeline",
      "/crm/estimates",
      "/crm/invoices",
      "/crm/estimates/new",
      "/crm/pricebook",
      "/crm/payments",
      "/crm/schedule",
      "/crm/inbox",
      "/crm/team",
      "/crm/reports",
      "/crm/migrate",
      "/crm/admin",
    ];
    for (const path of pages) {
      await gotoCrm(page, path);
      await exerciseAllTips(page);
    }
    guards.assertClean("main pages tips");
  });

  test("every settings and integrations card tip opens with content", async ({ page }) => {
    const guards = watchPage(page);

    await gotoCrm(page, "/crm/settings");
    // All ten card tips are mounted: page + company profile, theme, divisions,
    // defaults, notifications, SMS, price floor, payments, financing, calendar,
    // lead sources.
    expect(await page.locator(`${TIP}:visible`).count()).toBeGreaterThanOrEqual(10);
    await exerciseAllTips(page);

    await gotoCrm(page, "/crm/integrations");
    expect(await page.locator(`${TIP}:visible`).count()).toBeGreaterThanOrEqual(5);
    await exerciseAllTips(page);

    guards.assertClean("settings/integrations tips");
  });

  test("the dialog closes by Esc, by the X, and by the backdrop", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");

    const tip = page.getByTestId("info-tip-dashboard");

    // Esc.
    await tip.click();
    await expectDialogContent(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();

    // The X button.
    await tip.click();
    await expectDialogContent(page);
    await page.locator(DIALOG).getByRole("button", { name: "Close" }).click();
    await expect(page.locator(DIALOG)).toBeHidden();

    // The backdrop (click well outside the dialog box).
    await tip.click();
    await expectDialogContent(page);
    await page.mouse.click(12, 12);
    await expect(page.locator(DIALOG)).toBeHidden();

    guards.assertClean("close behaviours");
  });

  test("the Quick Bid tip explains square-footage pricing", async ({ page }) => {
    const guards = watchPage(page);
    if (!customerId) customerId = await makeCustomer(page);

    await gotoCrm(page, `/crm/clients/${customerId}`);
    await page.getByTestId("info-tip-quick-bid").click();
    await expectDialogContent(page);
    await expect(page.locator(BODY)).toContainText(/square footage|square feet/i);
    await page.keyboard.press("Escape");

    guards.assertClean("quick bid tip");
  });

  test("the mobile ribbon's More sheet rows each carry a working tip", async ({ page }) => {
    const guards = watchPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCrm(page, "/crm");

    await page.getByTestId("ribbon-tab-more").click();
    await expect(page.getByTestId("ribbon-more-sheet")).toBeVisible();
    // The sheet's rows (pipeline … settings) each mount one.
    expect(await page.locator(`${TIP}:visible`).count()).toBeGreaterThanOrEqual(6);

    const tip = page.getByTestId("info-tip-pipeline");
    await tip.click();
    await expectDialogContent(page);
    await expect(page.locator(TITLE)).toHaveText("Pipeline");
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();

    guards.assertClean("ribbon tips");
  });

  test("the client portal headers carry working tips", async ({ page }) => {
    const guards = watchPage(page);
    if (!customerId) customerId = await makeCustomer(page);

    await grantClientSession(page, [customerId]);
    await gotoCrm(page, "/?client=1");
    await expect(page.getByTestId("client-portal-root")).toBeVisible();

    await page.getByTestId("info-tip-portal").click();
    await expectDialogContent(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();

    // Section tips live behind the nav views.
    await page.getByTestId("portal-nav-estimates").click();
    await page.getByTestId("info-tip-portal-estimates").click();
    await expectDialogContent(page);
    await page.keyboard.press("Escape");

    guards.assertClean("portal tips");
  });
});
