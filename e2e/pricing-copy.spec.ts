import { expect, test, type Page } from "@playwright/test";
import { PLANS, PLAN_KEYS } from "../shared/plans";
import { SALES_REP_LABEL, planPriceLine } from "../shared/plan-copy";

/**
 * Pricing p5 (copy): pages outside /pricing describe the 2026-09-30 price book.
 * Run against the lane's own dev server (dev bypass signs in as user 1):
 *   E2E_PORT=8255 E2E_DB=constructhub_dev_a6 npx playwright test -c playwright.pricing-copy.config.ts
 */

const LEGACY = /\bPlatinum\b|\bGold (and|&) Platinum\b|\$995|\$499\/mo|Unlimited everything|billed separately|Separate membership|\$29,999|\$5,500|\$15,000|\$7,500|\$2,499/;

const PAGES = [
  "/", "/landing", "/terms", "/crm-app", "/crm-terms", "/master-class-landing", "/master-class", "/master-class?tab=pricing",
  "/competitors-landing", "/permits-landing", "/google-ads-landing", "/reinstatement", "/privacy",
];

async function bodyText(page: Page) {
  await page.waitForLoadState("networkidle");
  return page.locator("body").innerText();
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const path of PAGES) {
      test(`${path} shows no legacy plan or price and fits the screen`, async ({ page }) => {
        await page.goto(path);
        const text = await bodyText(page);
        expect(text).not.toMatch(LEGACY);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
}

test("Terms list the new plans, add-ons, trial and sales-rep services", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByTestId("text-effective-date")).toHaveText("Last updated: September 30, 2026");
  const plans = page.getByTestId("list-plans");
  for (const key of PLAN_KEYS) await expect(plans).toContainText(`${PLANS[key].name} — ${planPriceLine(key)}`);
  await expect(page.getByTestId("section-subscription-plans")).toContainText("1-day trial");
  await expect(page.getByTestId("section-subscription-plans")).toContainText("There is no free plan");
  await expect(page.getByTestId("section-add-ons")).toContainText("Extra seat — $15/month");
  await expect(page.getByTestId("section-done-for-you")).toContainText("$1,000 or more");
  await expect(page.getByTestId("section-done-for-you")).toContainText(SALES_REP_LABEL);
  await expect(page.getByTestId("section-consulting")).not.toContainText("$250");
});

test("landing: plans from the price book, services go to a sales rep", async ({ page }) => {
  await page.goto("/landing");
  for (const key of PLAN_KEYS) await expect(page.getByTestId(`card-plan-${key}`)).toContainText(PLANS[key].name);
  await expect(page.getByTestId("card-plan-starter")).toContainText("$29/month");
  await expect(page.getByTestId("text-agency-modules")).toContainText("Google Ads & LSA manager");
  await expect(page.getByTestId("text-dfy-sales")).toHaveCount(3);
  await expect(page.getByTestId("link-dfy-pricing")).toHaveAttribute("href", "/pricing#services");
  await expect(page.getByText("Create a Free Account")).toHaveCount(0);
});

test("Master Class: modules and bundle at $1,000+ are sold through a sales rep", async ({ page }) => {
  await page.goto("/master-class?tab=pricing");
  await expect(page.getByTestId("text-bundle-price")).toHaveCount(0);
  await expect(page.getByTestId("link-bundle-sales")).toHaveAttribute("href", "/pricing#services");
  await expect(page.locator('[data-testid^="link-module-sales-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="button-add-cart-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="button-enroll-"]')).toHaveCount(0);
  await page.goto("/master-class-landing");
  await expect(page.getByTestId("link-hero-enroll")).toHaveAttribute("href", "/pricing#services");
  await expect(page.getByTestId("link-hero-enroll")).toContainText(SALES_REP_LABEL);
});

test("CRM gateway says the CRM is included in every plan", async ({ page }) => {
  await page.goto("/crm-app");
  await expect(page.getByTestId("text-crm-included")).toContainText("included with every ConstructHUB plan");
  await expect(page.getByTestId("text-crm-included")).toContainText("Starter 1, Pro 3, Growth 10 and Agency 10");
});

test("Competitor Intel: a 402 plan_required shows an honest upgrade prompt", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({
      status: 402, contentType: "application/json",
      body: JSON.stringify({ code: "plan_required", requiredPlan: "pro", message: "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it." }),
    })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("text-plan-required")).toHaveText("Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it.");
  await expect(page.getByTestId("button-upgrade-plan")).toHaveText(/See the Pro plan/);
  await expect(page.getByText("Pro, Growth and Agency")).toBeVisible();
  await expect(page.getByTestId("button-start-scan")).toHaveCount(0);
});

test("Competitor Intel: an entitled account gets the scan form", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("button-start-scan")).toBeVisible();
  await expect(page.getByTestId("text-plan-required")).toHaveCount(0);
});

test("Competitor Intel: the pre-entitlements 403 shows the same prompt, not the retired plan names", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({
      status: 403, contentType: "application/json",
      body: JSON.stringify({ message: "Competitor Intelligence requires a Gold or Platinum membership. Upgrade your plan to access this feature." }),
    })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("text-plan-required")).toHaveText("Your plan does not include Competitor Intel.");
  await expect(page.getByTestId("button-upgrade-plan")).toHaveText(/See plans/);
  await expect(page.getByTestId("button-start-scan")).toHaveCount(0);
  expect(await bodyText(page)).not.toMatch(LEGACY);
});
