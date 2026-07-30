import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

/**
 * The whole money pipeline in one continuous flow, all through the real UI
 * except where the public API is the honest stand-in for a second browser:
 * add client → estimate → line item → options → send → public approve →
 * invoice → record payment (paid) → second invoice → void (confirm dialog).
 */
test("pipeline: client → estimate → approve → invoice → payment → void", async ({ page }) => {
  test.setTimeout(180_000);
  const guards = watchPage(page);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const clientName = `E2E Flow ${stamp}`;

  // ── Add the client ────────────────────────────────────────────────────────
  await gotoCrm(page, "/crm/clients");
  await page.getByTestId("button-new-client").click();
  await page.getByTestId("input-client-name").fill(clientName);
  await page.getByTestId("input-client-email").fill(`e2e-flow-${stamp}@example.com`);
  await page.getByTestId("button-save-client").click();
  await expect(page.getByText("Client created", { exact: true })).toBeVisible();
  await page.getByTestId("input-search-clients").fill(clientName);
  await page.locator('[data-testid^="client-"]').first().click();
  await expect(page.locator("h1")).toContainText(clientName);
  const customerId = page.url().split("/crm/clients/")[1];

  // ── Estimate with a line item ─────────────────────────────────────────────
  await page.getByTestId("button-new-estimate").click();
  await page.getByTestId("input-estimate-title").fill("Flow estimate");
  const row = page.getByTestId("line-item-0");
  await row.locator("input").first().fill("Flow line item");
  await row.locator('input[type="number"]').first().fill("3");
  await row.locator('input[type="number"]').nth(1).fill("200");
  await page.getByTestId("button-save-estimate").click();
  await expect(page.getByText("Estimate created", { exact: true })).toBeVisible();

  const est = page.locator('[data-testid^="estimate-"]', { hasText: "Flow estimate" });
  const estId = (await est.getAttribute("data-testid"))!.replace("estimate-", "");

  // ── Options dialog ────────────────────────────────────────────────────────
  await page.getByTestId(`button-options-${estId}`).click();
  await page.getByTestId("input-option-name").fill("Good");
  await page.getByTestId("input-option-total").fill("600");
  await page.getByTestId("button-save-option").click();
  await expect(page.getByText("Option added", { exact: true })).toBeVisible();
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // ── Send (email fails in dev; the fallback toast is the expected path) ────
  await page.getByTestId(`button-send-${estId}`).click();
  await expect(
    page.getByText("Estimate sent", { exact: true })
      .or(page.getByText("Email failed — link copied", { exact: true })),
  ).toBeVisible();

  // ── Public approve ────────────────────────────────────────────────────────
  const [{ public_token: estToken }] = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estId]);
  await gotoCrm(page, `/e/${estToken}`);
  await page.getByTestId("input-signature").fill("Flow Signer");
  await page.getByTestId("button-approve").click();
  await expect(page.getByText(/Approved — thank you!/)).toBeVisible();

  // ── Back in the CRM the estimate shows approved; convert to invoice ───────
  await gotoCrm(page, `/crm/clients/${customerId}`);
  await expect(est).toContainText("approved");
  await page.getByTestId(`button-convert-${estId}`).click();
  await expect(page.getByText("Invoice created from the approved estimate", { exact: true })).toBeVisible();

  const inv = page.locator('[data-testid^="invoice-"]').first();
  await expect(inv).toBeVisible();
  const invId = (await inv.getAttribute("data-testid"))!.replace("invoice-", "");

  // ── Send the invoice, then record a full payment ─────────────────────────
  await page.getByTestId(`button-send-invoice-${invId}`).click();
  await expect(
    page.getByText("Invoice sent", { exact: true })
      .or(page.getByText("Email failed — payment link copied", { exact: true })),
  ).toBeVisible();

  await page.getByTestId(`button-record-payment-${invId}`).click();
  await page.getByTestId("select-payment-method").click();
  await page.getByRole("option", { name: "Check" }).click();
  await page.getByTestId("button-save-payment").click();
  await expect(page.getByText("Payment recorded", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-testid="invoice-${invId}"]`)).toContainText("paid");

  // ── Second invoice (API-built): void through the confirm dialog ──────────
  const est2 = await page.request.post("/api/crm/estimates", {
    data: {
      customerId, title: "Flow estimate 2", introText: null, taxRateBps: 0,
      items: [{ kind: "labor", name: "Void me", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: 50_00, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    },
  });
  const est2Id = (await est2.json()).id;
  const [{ public_token: est2Token }] = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [est2Id]);
  const approve2 = await page.request.post(`/api/public/estimates/${est2Token}/respond`, {
    data: { decision: "approve", signatureName: "Flow Signer" },
  });
  expect(approve2.ok()).toBeTruthy();
  const conv2 = await page.request.post(`/api/crm/estimates/${est2Id}/invoice`, { data: {} });
  expect(conv2.ok()).toBeTruthy();

  await gotoCrm(page, `/crm/clients/${customerId}`);
  const inv2 = page.locator('[data-testid^="invoice-"]', { hasText: "Flow estimate 2" });
  await expect(inv2).toBeVisible();
  const inv2Id = (await inv2.getAttribute("data-testid"))!.replace("invoice-", "");
  await page.getByTestId(`button-void-invoice-${inv2Id}`).click(); // window.confirm auto-accepted
  await expect(page.getByText("Invoice voided", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-testid="invoice-${inv2Id}"]`)).toContainText("void");

  guards.assertClean("pipeline flow");
});
