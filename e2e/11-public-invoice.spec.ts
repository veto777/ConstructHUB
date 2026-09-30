import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

/** Create an invoice from a freshly approved throwaway estimate. The public
 *  approve is email-gated, so the browser gets a client session first —
 *  page.request shares the context's cookies. */
async function makeInvoice(page: any): Promise<{ invoiceId: string; token: string }> {
  const { customerId, estimateId, token: estToken } = await makeEstimate(page);
  await grantClientSession(page, [customerId]);
  const respond = await page.request.post(`/api/public/estimates/${estToken}/respond`, {
    data: { decision: "approve", signatureName: "Mary Homeowner" },
  });
  if (!respond.ok()) throw new Error(`approve: ${respond.status()} ${await respond.text()}`);
  const conv = await page.request.post(`/api/crm/estimates/${estimateId}/invoice`, { data: {} });
  if (!conv.ok()) throw new Error(`convert: ${conv.status()} ${await conv.text()}`);
  const invoice = await conv.json();
  const rows = await q<{ public_token: string }>(
    `select public_token from crm_invoices where id = $1`, [invoice.id ?? invoice.invoice?.id]);
  return { invoiceId: invoice.id ?? invoice.invoice?.id, token: rows[0].public_token };
}

test.describe("/i/:token (public invoice)", () => {
  test("curated: open invoice renders, and says so honestly when it can't be paid online", async ({ page }) => {
    const guards = watchPage(page);
    const { token } = await makeInvoice(page);

    await gotoCrm(page, `/i/${token}`);
    await expect(page.getByText("E2E line item")).toBeVisible();
    await expect(page.getByText(/Due now/)).toBeVisible();

    // No Stripe account (the e2e lanes): pay-info says neither card nor bank
    // transfer is offered, so the page tells the client how to pay instead of
    // showing a Pay button that could only fail. With a rail, a pay button is
    // there (not clicked: it would leave for Stripe checkout).
    const info = await (await page.request.get(`/api/public/invoices/${token}/pay-info`)).json();
    if (!info.cardAvailable && !info.achAvailable) {
      await expect(page.getByTestId("text-online-pay-unavailable")).toBeVisible();
      await expect(page.getByTestId("text-online-pay-unavailable")).toContainText("Online payment isn't available");
      await expect(page.locator('[data-testid^="button-pay-invoice"]')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-testid^="button-pay-invoice"]').first()).toBeVisible();
    }

    guards.assertClean("public invoice pay");
  });

  test("curated: paid invoice shows the paid state", async ({ page }) => {
    const guards = watchPage(page);
    const paid = await q<{ public_token: string; customer_id: string }>(
      `select public_token, customer_id from crm_invoices where status = 'paid' and public_token is not null limit 1`);
    expect(paid.length).toBeGreaterThan(0);
    await grantClientSession(page, [paid[0].customer_id]);
    await gotoCrm(page, `/i/${paid[0].public_token}`);
    await expect(page.getByText(/Paid — thank you!/)).toBeVisible();
    guards.assertClean("public invoice paid");
  });

  test("curated: invalid token renders the error card", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/i/not-a-real-token");
    await expect(page.getByText("This link isn't valid")).toBeVisible();
    guards.assertClean("public invoice invalid token");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { token } = await makeInvoice(page);
    // makeInvoice left a client session on this context, so pay-info answers.
    const info = await (await page.request.get(`/api/public/invoices/${token}/pay-info`)).json();
    const noOnlineRail = !info.cardAvailable && !info.achAvailable;
    const { clicked, labels } = await sweepPage(page, `/i/${token}`, {
      // The settled pay state: the honest "Online payment isn't available"
      // card when no rail is offered (the e2e lanes), else a pay button.
      ready: noOnlineRail
        ? '[data-testid="text-online-pay-unavailable"]'
        : '[data-testid^="button-pay-invoice"]',
    });
    console.log(`public invoice sweep clicked ${clicked}: ${labels.join(" | ")}`);
    // Full-bleed client page: no app chrome — only the page's own controls.
    // With no online rail the only controls are the company's tel:/mailto:
    // links, which the sweep never follows; otherwise the pay button is one.
    expect(clicked).toBeGreaterThanOrEqual(noOnlineRail ? 0 : 1);
  });
});
