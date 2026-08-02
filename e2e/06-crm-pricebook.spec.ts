import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";
import { q, ASPIRE_ORG } from "./db";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("data-state", "active");
}

test.describe("/crm/pricebook", () => {
  test("curated: add material, add labor rate, test formula, preview assembly", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/pricebook");
    await expect(page.locator("h1")).toContainText("Price book");

    // Materials: add one.
    await openTab(page, "Materials");
    const stamp = Date.now().toString(36);
    await page.getByTestId("input-mat-name").fill(`E2E material ${stamp}`);
    await page.getByTestId("button-add-material").click();
    await expect(page.getByText("Material added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E material ${stamp}`)).toBeVisible();

    // Labor: add a rate.
    await openTab(page, "Labor");
    await page.getByTestId("input-lab-name").fill(`E2E crew ${stamp}`);
    await page.getByTestId("button-add-labor").click();
    await expect(page.getByText("Labor rate added", { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E crew ${stamp}`)).toBeVisible();

    // Formulas: the tester evaluates without eval.
    await openTab(page, "Formulas");
    await page.getByTestId("input-formula").fill("ceil([SQUARES] * (1 + [WASTE]/100))");
    await page.getByTestId("button-test-formula").click();
    await expect(page.getByTestId("text-formula-result")).toContainText("= 36");

    // Price Chart: preview expands one SKU into priced lines.
    await openTab(page, "Price Chart");
    const previewBtn = page.locator('[data-testid^="button-preview-"]').first();
    if (await previewBtn.isVisible().catch(() => false)) {
      const itemId = (await previewBtn.getAttribute("data-testid"))!.replace("button-preview-", "");
      await page.getByTestId(`input-qty-${itemId}`).fill("10");
      await previewBtn.click();
      await expect(page.getByTestId(`pb-item-${itemId}`).locator("table")).toBeVisible();
    }

    // Price Chart: add a SKU, edit it, delete it — the full lifecycle.
    await page.getByTestId("button-add-item").click();
    await page.getByTestId("input-item-name").fill(`E2E SKU ${stamp}`);
    await page.getByTestId("button-save-item").click();
    await expect(page.getByText("SKU added", { exact: true })).toBeVisible();
    const row = page.locator('[data-testid^="pb-item-"]', { hasText: `E2E SKU ${stamp}` });
    await expect(row).toBeVisible();
    const skuId = (await row.getAttribute("data-testid"))!.replace("pb-item-", "");

    await page.getByTestId(`button-edit-item-${skuId}`).click();
    await page.getByTestId("input-item-name").fill(`E2E SKU ${stamp} v2`);
    await page.getByTestId("button-save-item").click();
    await expect(page.getByText("SKU updated", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`pb-item-${skuId}`)).toContainText(`E2E SKU ${stamp} v2`);

    await page.getByTestId(`button-delete-item-${skuId}`).click(); // confirm auto-accepted
    await expect(page.getByText("SKU deleted", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`pb-item-${skuId}`)).toHaveCount(0);

    guards.assertClean("pricebook curated");
  });

  for (const tab of ["Price Chart", "Materials", "Labor", "Formulas"]) {
    test(`sweep: every button and link (${tab} tab)`, async ({ page }) => {
      const { clicked } = await sweepPage(page, "/crm/pricebook", {
        ready: 'h1:has-text("Price book")',
        beforeEach: async (p) => openTab(p, tab),
        // Delete is curated above — a sweep would empty the whole price chart.
        skip: ({ testid }) => testid.startsWith("button-delete-item-"),
      });
      console.log(`pricebook ${tab} sweep clicked ${clicked}`);
      expect(clicked).toBeGreaterThanOrEqual(10);
    });
  }
});

// @serial: re-roles the dev-bypass user to admin (the owner is exempt from the
// lock, so a below-floor rejection needs a non-owner seat) and restores it in
// a finally — every other suite depends on that owner seat.
test.describe("price-floor lock", { tag: "@serial" }, () => {
  test("settings toggle persists; a non-owner below the floor is rejected with the lock message", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const skuName = `E2E FloorMat ${stamp}`;
    const estimateIds: string[] = [];

    // Read the prior lock so it can be restored exactly.
    const orgRes = await page.request.get("/api/crm/org");
    const priorLock = (await orgRes.json()).customFields?.priceFloorLock ?? null;

    // A throwaway SKU ($5.00 price) for the floor to bite on.
    const mat = await page.request.post("/api/crm/pricebook/materials", {
      data: { name: skuName, sku: `EFM-${stamp}`, unit: "sf", costCents: 300, priceCents: 500 },
    });
    expect(mat.status()).toBe(201);

    try {
      // ── Settings UI: the owner-only card renders and the toggle persists. ──
      await gotoCrm(page, "/crm/settings");
      await expect(page.getByTestId("card-price-lock")).toBeVisible();
      await expect(page.getByTestId("input-price-floor-bps")).toBeVisible();
      const sw = page.getByTestId("switch-price-lock");
      await expect(sw).toBeVisible();
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      await expect
        .poll(async () => (await (await page.request.get("/api/crm/org")).json()).customFields?.priceFloorLock?.enabled)
        .toBe(true);

      // ── Below-floor pricing: the owner is exempt, a non-owner gets 422. ──
      const cust = await page.request.post("/api/crm/customers", {
        data: { displayName: `E2E Floor ${stamp}` },
      });
      expect(cust.status()).toBe(201);
      const customerId = (await cust.json()).id;
      const items = (price: number) => [{
        kind: "material", name: skuName, unit: "sf", quantityMilli: 1000, unitPriceCents: price,
      }];

      await q(`update crm_members set role = 'admin' where org_id = $1 and user_id = 1`, [ASPIRE_ORG]);

      const below = await page.request.post("/api/crm/estimates", {
        data: { customerId, title: `E2E floor ${stamp}`, items: items(499) },
      });
      expect(below.status()).toBe(422);
      const belowBody = await below.json();
      expect(belowBody.message).toContain("Price lock:");
      expect(belowBody.message).toContain(skuName);
      expect(belowBody.message).toContain("$5.00/sf");

      // At the floor, the same rep prices freely.
      const atFloor = await page.request.post("/api/crm/estimates", {
        data: { customerId, title: `E2E floor ${stamp}`, items: items(500) },
      });
      expect(atFloor.status()).toBe(201);
      estimateIds.push((await atFloor.json()).id);
    } finally {
      // ALWAYS restore the owner seat, then the prior lock, then the docs.
      await q(`update crm_members set role = 'owner', division_id = null where org_id = $1 and user_id = 1`, [ASPIRE_ORG]);
      await page.request.put("/api/crm/org/price-floor-lock", {
        data: priorLock && typeof priorLock === "object"
          ? { enabled: priorLock.enabled === true, floorBps: priorLock.floorBps ?? null }
          : { enabled: false },
      });
      for (const id of estimateIds) {
        await page.request.delete(`/api/crm/estimates/${id}`).catch(() => {});
      }
    }
  });
});
