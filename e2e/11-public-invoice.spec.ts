import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, makeEstimate, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

/** Create an invoice from a freshly approved throwaway estimate. */
async function makeInvoice(page: any): Promise<{ invoiceId: string; token: string }> {
  const { estimateId, token: estToken } = await makeEstimate(page);
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
  test("curated: open invoice renders, pay fails gracefully without Stripe", async ({ page }) => {
    const guards = watchPage(page);
    const { token } = await makeInvoice(page);

    await gotoCrm(page, `/i/${token}`);
    await expect(page.getByText("E2E line item")).toBeVisible();
    await expect(page.getByText(/Due now/)).toBeVisible();

    const pay = page.getByTestId("button-pay-invoice");
    await expect(pay).toBeVisible();
    await pay.click();
    await expect(page.getByText("Payment unavailable", { exact: true })).toBeVisible();

    guards.assertClean("public invoice pay");
  });

  test("curated: paid invoice shows the paid state", async ({ page }) => {
    const guards = watchPage(page);
    const paid = await q<{ public_token: string }>(
      `select public_token from crm_invoices where status = 'paid' and public_token is not null limit 1`);
    expect(paid.length).toBeGreaterThan(0);
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
    const { clicked, labels } = await sweepPage(page, `/i/${token}`, {
      ready: '[data-testid="button-pay-invoice"]',
    });
    console.log(`public invoice sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(9);
  });
});
