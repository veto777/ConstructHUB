import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

// The public pages are email-gated: every browse below happens with a client
// session for the estimate's customer (the anonymous challenge flow is
// curated in 20-link-gating.spec.ts).
test.describe("/e/:token (public estimate)", () => {
  test("curated: full approve flow on a throwaway estimate", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);

    await gotoCrm(page, `/e/${token}`);
    // Company header, line items and total render.
    await expect(page.getByText("E2E throwaway estimate")).toBeVisible();
    await expect(page.getByText("E2E line item")).toBeVisible();
    await expect(page.getByText("Total $123.45", { exact: true })).toBeVisible();

    // Approve with a typed signature.
    await page.getByTestId("input-signature").fill("Mary Homeowner");
    await page.getByTestId("button-approve").click();
    await expect(page.getByText(/Approved — thank you!/)).toBeVisible();

    // Deposit card appears; with no Stripe account the pay button must fail
    // gracefully (toast), never crash.
    const pay = page.getByTestId("button-pay");
    await expect(pay).toBeVisible();
    await pay.click();
    await expect(page.getByText("Payment unavailable", { exact: true })).toBeVisible();

    guards.assertClean("public estimate approve");
  });

  test("curated: decline flow with a reason", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);

    await gotoCrm(page, `/e/${token}`);
    await page.getByTestId("button-show-decline").click();
    await page.locator("#why").fill("Going with another contractor");
    await page.getByTestId("button-decline").click();
    await expect(page.getByText(/Estimate declined/)).toBeVisible();

    guards.assertClean("public estimate decline");
  });

  test("curated: invalid token renders the error card", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/e/not-a-real-token");
    await expect(page.getByText("This link isn't valid")).toBeVisible();
    guards.assertClean("public estimate invalid token");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { customerId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);
    const { clicked, labels } = await sweepPage(page, `/e/${token}`, {
      ready: '[data-testid="input-signature"]',
    });
    console.log(`public estimate sweep clicked ${clicked}: ${labels.join(" | ")}`);
    // Full-bleed client page: no app chrome, so only the page's own controls
    // (Decline toggle) are swept. The estimate's approve button is disabled
    // until a signature is typed, which the sweep doesn't do.
    expect(clicked).toBeGreaterThanOrEqual(1);
  });
});
