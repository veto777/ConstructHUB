import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/crm/payments", () => {
  test("curated: status, connect state, recent payments, disclosure render", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/payments");
    await expect(page.locator("h1")).toContainText("Payments");

    // Account card: either a connected account or a connect control. In the dev
    // sandbox Stripe isn't configured, so the button must explain itself
    // (disabled with a visible "not configured" card) rather than dead-click.
    const connect = page.getByTestId("button-connect-stripe");
    if (await connect.isVisible().catch(() => false)) {
      if (await connect.isEnabled()) {
        // Configured: clicking starts Stripe onboarding — assert the mutation
        // fires without a server error; don't follow the external redirect.
        await Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/crm/payments/connect/stripe")),
          connect.click(),
        ]);
      } else {
        await expect(page.getByText(/Not configured on this server/)).toBeVisible();
      }
    }

    // Recent payments from the seeded invoices render, or the honest empty state.
    const anyPayment = page.locator('[data-testid^="payment-"]').first();
    const empty = page.getByText(/Nothing yet\. Payments appear here/);
    await expect(anyPayment.or(empty)).toBeVisible();

    // The written disclosure always renders.
    await expect(page.getByText(/What we promise, in writing/)).toBeVisible();

    guards.assertClean("payments curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/payments", {
      ready: 'h1:has-text("Payments")',
      // Connect Stripe redirects off-site when configured.
      skip: ({ testid }) => testid === "button-connect-stripe",
    });
    console.log(`payments sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(8);
  });
});
