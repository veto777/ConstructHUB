/**
 * The phone tab bar is the person's choice (owner, 2026-10-04: "Let the settings allow you to pick what's in your
 * lower Ribbon on mobile and app"): Settings → Phone tab bar saves it on the account and the bar follows.
 * Runs on the growth server (E2E_PORT, dev bypass user 1); resets to the default at the end.
 */
import { test, expect } from "@playwright/test";

const BASE = `http://127.0.0.1:${process.env.E2E_PORT || 8199}`;
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("pick four tabs in Settings; the bar shows them in that order; reset brings back the default", async ({ page, context }) => {
  await context.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
  await page.request.put(`${BASE}/api/account/ui-prefs`, { data: { platformTabs: null } });
  await page.goto(`${BASE}/settings?tab=phone-bar`);
  const picker = page.getByTestId("platform-tabs-picker");
  await expect(picker).toBeVisible();
  // Default: Home, Calls, Reviews, Locations. Swap Reviews and Locations for Posts and Settings.
  await picker.getByTestId("platform-tabs-option-reviews").click();
  await picker.getByTestId("platform-tabs-option-locations").click();
  await picker.getByTestId("platform-tabs-option-posts").click();
  await picker.getByTestId("platform-tabs-option-settings").click();
  await picker.getByTestId("platform-tabs-save").click();
  await expect(picker.getByTestId("platform-tabs-saved")).toBeVisible();
  const bar = page.getByTestId("app-tabbar");
  await expect(bar.locator("a")).toHaveText(["Home", "Calls", "Posts", "Settings"]);
  await expect(bar.getByTestId("tabbar-settings")).toHaveAttribute("aria-current", "page");
  // It is saved on the account: a fresh load shows the same bar.
  await page.goto(`${BASE}/`);
  await expect(page.getByTestId("app-tabbar").locator("a")).toHaveText(["Home", "Calls", "Posts", "Settings"]);
  await page.goto(`${BASE}/settings?tab=phone-bar`);
  await page.getByTestId("platform-tabs-reset").click();
  await expect(page.getByTestId("app-tabbar").locator("a")).toHaveText(["Home", "Calls", "Reviews", "Locations"]);
});
