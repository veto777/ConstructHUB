import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, makeEstimate, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/portal/:token (client portal)", () => {
  test("curated: renders estimates needing action, estimate link navigates", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId } = await makeEstimate(page);
    // Only sent estimates are client-visible.
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();
    const rows = await q<{ portal_token: string }>(
      `select portal_token from crm_customers where id = $1`, [customerId]);
    const token = rows[0].portal_token;
    expect(token).toBeTruthy();

    await gotoCrm(page, `/portal/${token}`);
    // The portal greets the client and shows the estimate that needs action.
    await expect(page.getByText(/Welcome,/)).toBeVisible();
    await expect(page.getByText(/estimate to review/)).toBeVisible();
    await expect(page.getByText(/Your estimates/)).toBeVisible();

    // The review link goes to the public estimate page.
    await page.getByTestId(`portal-estimate-${estimateId}`).click();
    await expect(page).toHaveURL(/\/e\//);
    await expect(page.getByText("E2E throwaway estimate")).toBeVisible();

    guards.assertClean("public portal curated");
  });

  test("curated: invalid token renders the error card", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/portal/not-a-real-token");
    await expect(page.getByText("This link isn't valid")).toBeVisible();
    guards.assertClean("public portal invalid token");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { customerId, estimateId } = await makeEstimate(page);
    await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    const rows = await q<{ portal_token: string }>(
      `select portal_token from crm_customers where id = $1`, [customerId]);
    const { clicked, labels } = await sweepPage(page, `/portal/${rows[0].portal_token}`, {
      ready: 'a:has-text("E2E throwaway estimate")',
    });
    console.log(`public portal sweep clicked ${clicked}: ${labels.join(" | ")}`);
    // Full-bleed client page: no app chrome — the estimate-to-review link,
    // its Review button, and the estimates-list link are the controls.
    expect(clicked).toBeGreaterThanOrEqual(3);
  });
});
