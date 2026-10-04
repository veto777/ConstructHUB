import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("/portal/:token (client portal)", () => {
  test("curated: renders estimates needing action, estimate link navigates", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId } = await makeEstimate(page);
    // Only sent estimates are client-visible.
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();
    // The portal page itself is token-authorised; the estimate it links to is
    // email-gated, so the client arrives with a verified session.
    await grantClientSession(page, [customerId]);
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

  test("curated: the license badge renders when the company has one on file", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId } = await makeEstimate(page);
    const rows = await q<{ portal_token: string }>(
      `select portal_token from crm_customers where id = $1`, [customerId]);
    const token = rows[0].portal_token;

    // Park a license on the org, render, then put the column back.
    const [before] = await q<{ license_number: string | null; license_state: string | null }>(
      `select license_number, license_state from crm_orgs where id = $1`, [ORGS.aspire]);
    await q(`update crm_orgs set license_number = 'E2E-LIC-777', license_state = 'WA' where id = $1`, [ORGS.aspire]);
    try {
      await gotoCrm(page, `/portal/${token}`);
      await expect(page.getByText(/License E2E-LIC-777 \(WA\)/)).toBeVisible();
    } finally {
      await q(`update crm_orgs set license_number = $1, license_state = $2 where id = $3`,
        [before.license_number, before.license_state, ORGS.aspire]);
    }
    guards.assertClean("public portal license badge");
  });

  test("curated: expired and cancelled estimates are not advertised as 'to review'", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId } = await makeEstimate(page);
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();
    // Let the estimate lapse — the /e page would now show only an expiry notice.
    await q(`update crm_estimates set expires_at = now() - interval '1 day' where id = $1`, [estimateId]);
    try {
      const rows = await q<{ portal_token: string }>(
        `select portal_token from crm_customers where id = $1`, [customerId]);
      await gotoCrm(page, `/portal/${rows[0].portal_token}`);
      // The action banner must not count an estimate the client can't act on…
      await expect(page.getByText(/estimate to review/)).toHaveCount(0);
      await expect(page.locator('[data-testid^="portal-estimate-"]')).toHaveCount(0);
      // …but the estimate itself stays listed in the history.
      await expect(page.getByText(/Your estimates/)).toBeVisible();
      await expect(page.getByText("E2E throwaway estimate").first()).toBeVisible();
    } finally {
      await q(`update crm_estimates set expires_at = now() + interval '30 days' where id = $1`, [estimateId]);
    }
    guards.assertClean("public portal expired banner");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { customerId, estimateId } = await makeEstimate(page);
    await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    await grantClientSession(page, [customerId]); // the /e/ link the sweep clicks is gated
    const rows = await q<{ portal_token: string }>(
      `select portal_token from crm_customers where id = $1`, [customerId]);
    const { clicked, labels } = await sweepPage(page, `/portal/${rows[0].portal_token}`, {
      ready: 'a:has-text("E2E throwaway estimate")',
    });
    console.log(`public portal sweep clicked ${clicked}: ${labels.join(" | ")}`);
    // Full-bleed client page: no app chrome — the estimate-to-review link (its
    // "Review" label is part of the link, not a nested button) and the
    // estimates-list link are the controls.
    expect(clicked).toBeGreaterThanOrEqual(2);
  });
});
