import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

/** Create a throwaway customer + estimate with an explicit tax rate (the
 *  shared makeEstimate helper always sends taxRateBps 0). */
async function makeTaxedEstimate(
  page: Page,
  opts: { unitPriceCents?: number; taxRateBps?: number } = {},
): Promise<{ customerId: string; estimateId: string; token: string }> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cust = await page.request.post("/api/crm/customers", {
    data: { displayName: `E2E Discounts ${stamp}`, email: `e2e-disc-${stamp}@example.com` },
  });
  if (!cust.ok()) throw new Error(`create customer: ${cust.status()} ${await cust.text()}`);
  const customer = await cust.json();

  const est = await page.request.post("/api/crm/estimates", {
    data: {
      customerId: customer.id,
      title: "E2E discount estimate",
      taxRateBps: opts.taxRateBps ?? 1000, // 10%
      items: [{
        kind: "labor", name: "E2E discount line", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: opts.unitPriceCents ?? 100_00,
        taxable: true, hiddenFromClient: false, sortOrder: 0,
      }],
    },
  });
  if (!est.ok()) throw new Error(`create estimate: ${est.status()} ${await est.text()}`);
  const estimate = await est.json();
  const rows = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estimate.id]);
  return { customerId: customer.id, estimateId: estimate.id, token: rows[0].public_token };
}

/** Attach offers directly through the creator API (the UI path is curated in
 *  the first test). Returns the offers as the server stored them. */
async function putOffers(page: Page, estimateId: string, offers: any[]): Promise<any[]> {
  const r = await page.request.put(`/api/crm/estimates/${estimateId}/discounts`, { data: { offers } });
  if (!r.ok()) throw new Error(`put offers: ${r.status()} ${await r.text()}`);
  return (await r.json()).offers;
}

const MARKETING = {
  code: "marketing", label: "Marketing discount", percentBps: 100,
  conditions: "Yard signage during the job + 1 month after, and an honest review.", enabled: true,
};
const MILITARY = {
  code: "military", label: "Military discount", percentBps: 200,
  conditions: "Military ID required — family members don't count.", enabled: true,
};

test.describe("optional discounts on the gated public estimate", () => {
  test("creator ticks presets in the UI → client selects 2 → approve persists server-recomputed totals", async ({ page }) => {
    const guards = watchPage(page);
    // $100.00 taxable line at 10% tax → quoted $110.00.
    const { customerId, estimateId, token } = await makeTaxedEstimate(page);

    // ── The creator adds the offers through the CRM UI. ──────────────────
    await gotoCrm(page, `/crm/clients/${customerId}`);
    await page.getByTestId(`button-discounts-${estimateId}`).click();
    await expect(page.getByTestId("preset-marketing")).toBeVisible();
    // Price-match ships OFF — ticking it must not show it to the client.
    await page.getByTestId("check-preset-price_match").click();
    await expect(page.getByTestId("switch-offer-price_match")).not.toBeChecked();
    await page.getByTestId("check-preset-marketing").click();
    await page.getByTestId("check-preset-military").click();
    await page.getByTestId("button-save-discounts").click();
    await expect(page.getByText("Discount offers saved")).toBeVisible();

    // ── The gated public page lists the offers as checkboxes. ────────────
    await grantClientSession(page, [customerId]);
    await gotoCrm(page, `/e/${token}`);
    const section = page.getByTestId("discounts-section");
    await expect(section).toBeVisible();
    await expect(section.getByText(/Yard signage during the job/)).toBeVisible();
    await expect(section.getByText(/Military ID required/)).toBeVisible();
    // Disabled offers never reach the client.
    await expect(section.getByText(/Price match/)).toHaveCount(0);
    await expect(page.getByText("Total $110.00", { exact: true })).toBeVisible();

    // ── Select 2 → the total previews live (1% + 2% = 3% off the taxable
    //    base → −$3.00; tax re-charged on $97 → $9.70; total $106.70). ────
    await page.getByTestId("check-discount-marketing").click();
    await page.getByTestId("check-discount-military").click();
    await expect(page.getByTestId("row-optional-discount")).toContainText("$3.00");
    await expect(page.getByText("Total $106.70", { exact: true })).toBeVisible();

    // ── Approve → the server re-computes and persists. ───────────────────
    await page.getByTestId("input-signature").fill("Mary Homeowner");
    await page.getByTestId("button-approve").click();
    await expect(page.getByText(/Approved — thank you!/)).toBeVisible();
    // The signed page shows the approved total and which offers applied.
    await expect(page.getByText("Total $106.70", { exact: true })).toBeVisible();
    await expect(page.getByTestId("row-applied-discounts")).toContainText("Marketing discount");
    await expect(page.getByTestId("row-applied-discounts")).toContainText("Military discount");

    const [row] = await q<{
      total_cents: number; approved_total_cents: number; selected_discounts: any[];
    }>(`select total_cents, approved_total_cents, selected_discounts from crm_estimates where id = $1`, [estimateId]);
    expect(row.total_cents).toBe(110_00);            // the quote, unchanged
    expect(row.approved_total_cents).toBe(106_70);   // server-recomputed
    expect(row.selected_discounts.map((d: any) => d.code).sort()).toEqual(["marketing", "military"]);

    // A second response is refused — approval never recomputes twice.
    const again = await page.request.post(`/api/public/estimates/${token}/respond`, {
      data: { decision: "approve", signatureName: "Mary Homeowner", selectedDiscounts: [] },
    });
    expect(again.status()).toBe(409);
    const [after] = await q<{ approved_total_cents: number }>(
      `select approved_total_cents from crm_estimates where id = $1`, [estimateId]);
    expect(after.approved_total_cents).toBe(106_70);

    guards.assertClean("discounts approve flow");
  });

  test("expired estimate never recomputes (410, nothing persisted)", async ({ page }) => {
    const { customerId, estimateId, token } = await makeTaxedEstimate(page);
    const offers = await putOffers(page, estimateId, [MARKETING, MILITARY]);

    // Send it, then age it past expiry directly in the DB.
    await q(`update crm_estimates set sent_at = now() - interval '10 days',
             expires_at = now() - interval '3 days', status = 'sent' where id = $1`, [estimateId]);

    await grantClientSession(page, [customerId]);
    const r = await page.request.post(`/api/public/estimates/${token}/respond`, {
      data: {
        decision: "approve", signatureName: "Mary Homeowner",
        selectedDiscounts: offers.map((o: any) => o.id),
      },
    });
    expect(r.status()).toBe(410);
    const [row] = await q<{ approved_total_cents: number | null; approved_at: string | null }>(
      `select approved_total_cents, approved_at from crm_estimates where id = $1`, [estimateId]);
    expect(row.approved_at).toBeNull();
    expect(row.approved_total_cents).toBeNull();
  });

  test("declined estimate never recomputes (409, nothing persisted)", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeTaxedEstimate(page);
    const offers = await putOffers(page, estimateId, [MARKETING]);

    await grantClientSession(page, [customerId]);
    await gotoCrm(page, `/e/${token}`);
    await page.getByTestId("button-show-decline").click();
    await page.locator("#why").fill("Too expensive");
    await page.getByTestId("button-decline").click();
    await expect(page.getByText(/Estimate declined/)).toBeVisible();

    const r = await page.request.post(`/api/public/estimates/${token}/respond`, {
      data: {
        decision: "approve", signatureName: "Mary Homeowner",
        selectedDiscounts: offers.map((o: any) => o.id),
      },
    });
    expect(r.status()).toBe(409);
    const [row] = await q<{ approved_total_cents: number | null; approved_at: string | null }>(
      `select approved_total_cents, approved_at from crm_estimates where id = $1`, [estimateId]);
    expect(row.approved_at).toBeNull();
    expect(row.approved_total_cents).toBeNull();

    guards.assertClean("discounts decline flow");
  });
});
