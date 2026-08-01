import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * The mobile estimate experience, both halves, at iPhone-ish 390×844:
 *  - the contractor's three-step fast path (/crm/estimates/new), reached from
 *    the estimates list and from the ribbon's More sheet;
 *  - the client's gated public page, which must fit the viewport with no
 *    sideways scroll and approve controls sized for a thumb.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("mobile estimate builder (/crm/estimates/new)", () => {
  test("curated: client → 2 price-book items → review total → sent", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `mb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

    // Seed through the real API: one client and two flat-price price-book items.
    const custR = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E Mobile ${stamp}`, email: `e2e-${stamp}@example.com` },
    });
    if (!custR.ok()) throw new Error(`create customer: ${custR.status()} ${await custR.text()}`);
    const customer = await custR.json();

    const mkItem = async (name: string, flatPriceCents: number) => {
      const r = await page.request.post("/api/crm/pricebook/items", {
        data: { name, unit: "ea", pricingMode: "flat", flatPriceCents, taxable: true },
      });
      if (!r.ok()) throw new Error(`create pb item: ${r.status()} ${await r.text()}`);
      return r.json();
    };
    const itemA = await mkItem(`E2E Item A ${stamp}`, 10000);
    const itemB = await mkItem(`E2E Item B ${stamp}`, 25050);

    // The fast path is one tap off the estimates list.
    await gotoCrm(page, "/crm/estimates");
    await page.getByTestId("button-new-estimate").click();
    await expect(page).toHaveURL(/\/crm\/estimates\/new/);
    await expect(page.getByTestId("text-step")).toContainText("Step 1 of 3");

    // Step 1 — search and pick the client.
    await page.getByTestId("input-client-search").fill(stamp);
    await page.getByTestId(`client-row-${customer.id}`).click();
    await expect(page.getByTestId("text-step")).toContainText("Step 2 of 3");
    await expect(page.getByTestId("text-cart-customer")).toHaveText(`E2E Mobile ${stamp}`);

    // Step 2 — one tap per item; the running total follows every edit.
    await page.getByTestId("input-item-search").fill(`Item A ${stamp}`);
    await page.getByTestId(`button-add-${itemA.id}`).click();
    await expect(page.getByTestId("text-subtotal")).toHaveText("$100.00");
    await page.getByTestId("input-item-search").fill(`Item B ${stamp}`);
    await page.getByTestId(`button-add-${itemB.id}`).click();
    await expect(page.getByTestId("text-subtotal")).toHaveText("$350.50");
    // Qty is editable on a numeric keypad: 2 × $100 + 1 × $250.50.
    await page.getByTestId(`input-qty-${itemA.id}`).fill("2");
    await expect(page.getByTestId("text-subtotal")).toHaveText("$450.50");

    // Step 3 — the review shows the same total; tax is the server's job.
    await page.getByTestId("button-review").click();
    await expect(page.getByTestId("text-step")).toContainText("Step 3 of 3");
    await expect(page.getByTestId("text-review-subtotal")).toHaveText("$450.50");
    await expect(page.getByTestId("text-review-total")).toHaveText("$450.50");
    await page.getByTestId("button-send").click();

    // Done — the final total and the 7-day expiry come back from the server.
    await expect(page.getByTestId("text-sent-title")).toBeVisible();
    await expect(page.getByTestId("text-final-total")).toHaveText("$450.50");
    await expect(page.getByTestId("text-expiry")).toContainText("Valid until");

    // …and the document centre lists the new estimate.
    await page.getByTestId("link-view-estimates").click();
    await expect(page).toHaveURL(/\/crm\/estimates$/);
    await expect(page.getByText(`E2E Mobile ${stamp}`).first()).toBeVisible();

    guards.assertClean("mobile estimate builder");
  });

  test("curated: the ribbon More sheet carries the fast path", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");
    await page.getByTestId("ribbon-tab-more").click();
    const link = page.getByTestId("ribbon-more-new-estimate");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/crm\/estimates\/new/);
    await expect(page.getByTestId("step-client")).toBeVisible();
    await expect(page.getByTestId("ribbon-more-sheet")).toBeHidden();
    guards.assertClean("ribbon new estimate");
  });
});

test.describe("public estimate at 390px", () => {
  test("renders within the viewport with usable approve controls", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);

    await gotoCrm(page, `/e/${token}`);
    await expect(page.getByTestId("estimate-document")).toBeVisible();
    await expect(page.getByTestId("doc-wordmark")).toBeVisible();

    // Nothing sticks out — no horizontal scrolling for the client, ever.
    const widths = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.html).toBeLessThanOrEqual(390);
    expect(widths.body).toBeLessThanOrEqual(390);

    // The approve control fills the phone and works one-thumbed.
    const approve = page.getByTestId("button-approve");
    await expect(page.getByTestId("input-signature")).toBeVisible();
    const box = await approve.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(320);
    await page.getByTestId("input-signature").fill("Mary Homeowner");
    await approve.click();
    await expect(page.getByText(/Approved — thank you!/)).toBeVisible();

    guards.assertClean("public estimate mobile");
  });
});
