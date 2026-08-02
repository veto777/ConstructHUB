import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Client-selectable estimate options — the full client journey on the gated
 * public page: scopes render as checkboxes, the total tallies live (with a
 * ticked discount), the review step strikes unchosen scopes, and generating
 * lands on a NEW estimate with exactly the chosen scopes, which the normal
 * approve flow then signs.
 *
 * Parallel-phase safe: every row is throwaway (unique stamp), no shared state
 * is flipped.
 */

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

const money = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Throwaway estimate with three priced scope-options and one discount offer. */
async function makeOptionEstimate(page: Page) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cust = await page.request.post("/api/crm/customers", {
    data: { displayName: `E2E optsel ${stamp}`, email: `e2e-optsel-${stamp}@example.com` },
  });
  if (!cust.ok()) throw new Error(`create customer: ${cust.status()} ${await cust.text()}`);
  const customer = await cust.json();

  const est = await page.request.post("/api/crm/estimates", {
    data: {
      customerId: customer.id,
      title: "E2E option estimate",
      taxRateBps: 1000, // 10%
      items: [{
        kind: "labor", name: "E2E base line", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: 100_00, taxable: true, hiddenFromClient: false, sortOrder: 0,
      }],
    },
  });
  if (!est.ok()) throw new Error(`create estimate: ${est.status()} ${await est.text()}`);
  const estimate = await est.json();

  const scope = (name: string, cents: number) => ({
    kind: "labor", name, quantityMilli: 1000, unitPriceCents: cents, taxable: true,
  });
  const options: { id: string; name: string; cents: number }[] = [];
  for (const [tier, name, cents] of [
    [1, "ColorPlus siding", 5000_00],
    [2, "Primed siding + paint", 4200_00],
    [3, "Shingle upgrade", 1800_00],
  ] as const) {
    const r = await page.request.post(`/api/crm/estimates/${estimate.id}/options`, {
      data: { name, tier, items: [scope(name, cents)] },
    });
    if (!r.ok()) throw new Error(`create option: ${r.status()} ${await r.text()}`);
    options.push({ id: (await r.json()).id, name, cents });
  }

  const off = await page.request.put(`/api/crm/estimates/${estimate.id}/discounts`, {
    data: { offers: [{ code: "marketing", label: "Marketing discount", percentBps: 100, enabled: true }] },
  });
  if (!off.ok()) throw new Error(`put offers: ${off.status()} ${await off.text()}`);

  const rows = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estimate.id]);
  return { customerId: customer.id as string, estimateId: estimate.id as string, token: rows[0].public_token, options };
}

test.describe("client-selectable estimate options", () => {
  test("tick 2 of 3 scopes → live total → review strikes the third → generate → approve", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, token, options } = await makeOptionEstimate(page);
    const [colorplus, primed, shingle] = options;

    // The client opens the gated document.
    await grantClientSession(page, [customerId]);
    await page.goto(`/e/${token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("public-estimate-root")).toBeVisible();

    // Scopes render as checkboxes.
    await expect(page.getByTestId("options-checklist")).toBeVisible();
    await expect(page.getByTestId(`checkbox-option-${colorplus.id}`)).toBeVisible();
    await expect(page.getByTestId("text-options-total")).toHaveText(money(0));

    // Tick ColorPlus + Shingle, plus the marketing discount (1%).
    await page.getByTestId(`checkbox-option-${colorplus.id}`).click();
    await page.getByTestId(`checkbox-option-${shingle.id}`).click();
    await page.getByTestId("check-discount-marketing").click();
    // subtotal 6800.00, discount 68.00, tax (6800−68)×10% = 673.20 → 7405.20.
    await expect(page.getByTestId("text-options-total")).toHaveText(money(7405_20));

    // Review: the unchosen scope shows struck through; totals recompute.
    await page.getByTestId("button-review-selection").click();
    await expect(page.getByTestId(`struck-option-${primed.id}`)).toBeVisible();
    await expect(page.getByTestId("text-review-subtotal")).toHaveText(money(6800_00));
    await expect(page.getByTestId("text-review-discount")).toHaveText(`−${money(68_00)}`);
    await expect(page.getByTestId("text-review-tax")).toHaveText(money(673_20));
    await expect(page.getByTestId("text-review-total")).toHaveText(money(7405_20));

    // Generate → land on the NEW estimate: quoted total has no optional
    // discount baked in (6800 + 680 tax), but the marketing offer is
    // pre-ticked, so the live total matches the review.
    const beforeGenerate = page.url();
    await page.getByTestId("button-generate-estimate").click();
    await page.waitForURL((url) => url.pathname.startsWith("/e/") && url.toString() !== beforeGenerate, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("public-estimate-root")).toBeVisible();
    await expect(page.getByTestId("doc-total")).toHaveText(money(7405_20));
    await expect(page.getByText("ColorPlus siding", { exact: true })).toBeVisible();
    await expect(page.getByText("Shingle upgrade", { exact: true })).toBeVisible();
    await expect(page.getByText("Primed siding + paint", { exact: true })).toHaveCount(0);
    // …and the document is the selection copy, not the original.
    await expect(page.getByTestId("estimate-document")).toContainText("your selections");

    // The normal approve flow signs it (discount already pre-ticked).
    await page.getByTestId("input-signature").fill("E2E Homeowner");
    await page.getByTestId("button-approve").click();
    await expect(page.getByText("Approved — thank you!")).toBeVisible();

    guards.assertClean("option selection");
  });
});
