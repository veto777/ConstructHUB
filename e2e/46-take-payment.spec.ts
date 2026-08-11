/**
 * Lane a3 — the client page as the HUB, and "take a payment" from both doors:
 * the client page's payment section and the Payments page's select-a-client
 * card. The owner's note: "how do I actually take a payment? I can't figure
 * it out." These specs prove both paths record a manual payment and reflect
 * it in history + balance, and that the online checkout-link path either
 * hands back a hosted Stripe URL (session creation only, never a capture) or
 * the designed "not set up yet" message when no Stripe account is connected.
 */
import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

/** Throwaway client + one open invoice for $123.45, via the real API. */
async function makeClientWithInvoice(page: Page): Promise<{ customerId: string; invoiceId: string }> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cust = await page.request.post("/api/crm/customers", {
    data: { displayName: `E2E Pay ${stamp}`, email: `e2e-pay-${stamp}@example.com` },
  });
  if (!cust.ok()) throw new Error(`create customer: ${cust.status()} ${await cust.text()}`);
  const customer = await cust.json();

  const inv = await page.request.post("/api/crm/invoices", {
    data: {
      customerId: customer.id, title: "E2E take-payment invoice", taxRateBps: 0,
      items: [{ kind: "labor", name: "E2E line", quantityMilli: 1000, unitPriceCents: 123_45, taxable: false }],
    },
  });
  if (!inv.ok()) throw new Error(`create invoice: ${inv.status()} ${await inv.text()}`);
  const invoice = await inv.json();
  return { customerId: customer.id, invoiceId: invoice.id };
}

test.describe("client page = the HUB", () => {
  test("take a payment from the client page: manual record lands in history and zeroes the balance", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId } = await makeClientWithInvoice(page);

    await gotoCrm(page, `/crm/clients/${customerId}`);

    // The hub quick actions are right under the identity card.
    await expect(page.getByTestId("client-quick-actions")).toBeVisible();
    await expect(page.getByTestId("text-outstanding-balance")).toHaveText("$123.45");

    await page.getByTestId("button-take-payment").click();
    const dialog = page.getByTestId("dialog-take-payment");
    await expect(dialog).toBeVisible();

    // Manual rail: amount defaults to the full due; method defaults to check.
    await expect(dialog.getByTestId("input-take-amount")).toHaveValue("123.45");
    await dialog.getByTestId("input-take-note").fill("Check #1042");
    await dialog.getByTestId("button-record-manual-payment").click();

    // History row + zeroed balance, without leaving the client's page.
    await expect(page.getByTestId("text-outstanding-balance")).toHaveText("$0.00");
    const row = page.locator('[data-testid^="client-payment-"]').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("$123.45");
    await expect(row).toContainText("check");
    await expect(row).toContainText("Check #1042");

    guards.assertClean("client-page manual payment");
  });

  test("online rail: checkout link is created, or the designed not-set-up message", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId } = await makeClientWithInvoice(page);

    await gotoCrm(page, `/crm/clients/${customerId}`);
    await page.getByTestId("button-take-payment").click();
    const dialog = page.getByTestId("dialog-take-payment");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("button-create-checkout-link").click();

    // Two honest outcomes: a connected Stripe account yields a hosted checkout
    // URL (session CREATION only — the client completes the charge); without
    // one the server answers 503 and the UI says exactly why.
    const linkInput = dialog.getByTestId("input-checkout-link");
    const notSetup = page.getByText(/isn't set up yet|isn't available/i);
    await expect(linkInput.or(notSetup)).toBeVisible();
    if (await linkInput.isVisible().catch(() => false)) {
      await expect(linkInput).toHaveValue(/^https:\/\//);
    }
    await page.keyboard.press("Escape");

    guards.assertClean("client-page checkout link");
  });

  test("schedule an appointment from the client page — it lands in the Schedule section", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cust = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E Appt ${stamp}`, email: `e2e-appt-${stamp}@example.com` },
    });
    const customer = await cust.json();

    await gotoCrm(page, `/crm/clients/${customer.id}`);
    await page.getByTestId("button-schedule-appointment").click();
    const dialog = page.getByTestId("dialog-schedule-appointment");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("input-appointment-title").fill(`E2E site visit ${stamp}`);
    // Start/end default to tomorrow 09:00–10:00 local.
    await dialog.getByTestId("button-save-appointment").click();

    const appt = page.locator('[data-testid^="appointment-"]').first();
    await expect(appt).toBeVisible();
    await expect(appt).toContainText(`E2E site visit ${stamp}`);

    guards.assertClean("client-page schedule appointment");
  });
});

test.describe("payments page = select a client", () => {
  test("pick a client, record a manual payment, see it in recent payments", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId } = await makeClientWithInvoice(page);

    await gotoCrm(page, "/crm/payments");
    await expect(page.locator("h1")).toContainText("Payments");

    await page.getByTestId("select-take-client").click();
    await page.getByTestId(`take-client-${customerId}`).click();
    await page.getByTestId("button-open-take-payment").click();

    const dialog = page.getByTestId("dialog-take-payment");
    await expect(dialog).toBeVisible();

    // Partial payment this time: $50.00 of the $123.45 due.
    await dialog.getByTestId("input-take-amount").fill("50.00");
    await dialog.getByTestId("select-take-method").click();
    await page.getByRole("option", { name: "Cash" }).click();
    await dialog.getByTestId("button-record-manual-payment").click();

    // The recent-payments card lists it (dialog closes on success).
    const row = page.locator('[data-testid^="payment-"]').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("$50.00");
    await expect(row).toContainText("cash");

    guards.assertClean("payments-page manual payment");
  });
});
