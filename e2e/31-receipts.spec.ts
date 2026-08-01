import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Receipts-to-date: record a payment, open the receipt preview from the
 * invoice row, send it, and see the confirmation toast naming the client's
 * address. The email attempt itself is asserted in the DB (SMTP is not
 * reliable in dev, so the toast is matched on the address either way).
 */

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("receipts", () => {
  test("record a payment → receipt button → preview → send → toast; attempt in DB", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e-receipt-${stamp}@example.com`;

    // ── Setup through the real API: customer → $1,000 invoice → $400 payment.
    const custRes = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E Receipt ${stamp}`, email },
    });
    if (!custRes.ok()) throw new Error(`create customer: ${custRes.status()} ${await custRes.text()}`);
    const customer = await custRes.json();

    const invRes = await page.request.post("/api/crm/invoices", {
      data: {
        customerId: customer.id, title: "E2E receipt invoice", taxRateBps: 0,
        items: [{ kind: "labor", name: "Labor", quantityMilli: 1000, unitPriceCents: 100000 }],
      },
    });
    if (!invRes.ok()) throw new Error(`create invoice: ${invRes.status()} ${await invRes.text()}`);
    const invoice = await invRes.json();
    expect(invoice.totalCents).toBe(100000);

    const payRes = await page.request.post(`/api/crm/invoices/${invoice.id}/payments`, {
      data: { amountCents: 40000, method: "check", note: "Check #1042" },
    });
    if (!payRes.ok()) throw new Error(`record payment: ${payRes.status()} ${await payRes.text()}`);

    // ── Click 1: the Receipt button on the client page's invoice row.
    await gotoCrm(page, `/crm/clients/${customer.id}`);
    await page.getByTestId(`button-receipt-${invoice.id}`).click();

    // The preview shows the receipt-to-date: payment with date+method, total
    // paid, and what's still owing ($1,000 − $400 = $600).
    const preview = page.getByTestId("receipt-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(invoice.number);
    await expect(preview).toContainText(`E2E Receipt ${stamp}`);
    await expect(preview).toContainText("Check #1042");
    await expect(page.getByTestId("receipt-total-paid")).toHaveText("$400.00");
    await expect(page.getByTestId("receipt-balance")).toHaveText("$600.00");

    // ── Click 2: Send. The toast names the client's address (sent or, in dev
    //    without working SMTP, an honest failure — both name the address).
    await page.getByTestId("button-send-receipt").click();
    await expect(
      page.getByText(new RegExp(`receipt to ${email.replace(/[.@-]/g, "\\$&")}`, "i")).first(),
    ).toBeVisible({ timeout: 20_000 });

    // ── DB: the email attempt was recorded on the invoice.
    const rows = await q<{ r: any }>(
      `select custom_fields->'receipt' as r from crm_invoices where id = $1`, [invoice.id]);
    expect(rows[0]?.r).toBeTruthy();
    expect(Number(rows[0].r.attempts)).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.lastTo).toBe(email);

    // ── The Documents Center invoice list exposes the same button.
    await gotoCrm(page, "/crm/invoices");
    await expect(page.getByTestId(`button-receipt-${invoice.id}`)).toBeVisible({ timeout: 15_000 });

    guards.assertClean("receipts");
  });
});
