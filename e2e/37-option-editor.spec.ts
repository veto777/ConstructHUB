import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Contractor-side options editor (crm-client.tsx EstimateOptionsDialog) — the
 * UI half of the client-selectable scopes flow that 36-option-selection
 * exercises from the public page. The contractor builds an estimate on the
 * client page, then in the Options dialog:
 *   1. adds an option whose LINES come from the price-book search (tap-to-add
 *      cart, editable qty, computed lines total — the typed-total field is
 *      disabled while lines ride along),
 *   2. adds a whole price-book PACKAGE as a second scoped option,
 *   3. adds and REMOVES a legacy itemless display tier (the two flavours
 *      coexist, labelled honestly),
 * then sends the estimate and the client runs the full checkbox → review →
 * generate → approve flow on the public page.
 *
 * Parallel-phase safe: every row (client, estimate, price-book items,
 * package, options) is throwaway with a unique stamp.
 */

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

const money = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

test("contractor builds client-selectable options from the estimate UI", async ({ page }) => {
  const guards = watchPage(page);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // ── Fixture: two flat price-book items + a package containing them ──────
  // A $100 taxable, B $50 non-taxable. (Setup, not the journey under test.)
  const mkItem = async (name: string, cents: number, taxable: boolean) => {
    const r = await page.request.post("/api/crm/pricebook/items", {
      data: { name: `${name} ${stamp}`, pricingMode: "flat", flatPriceCents: cents, unit: "job", taxable },
    });
    if (!r.ok()) throw new Error(`create pb item: ${r.status()} ${await r.text()}`);
    return (await r.json()).id as string;
  };
  const itemA = await mkItem("E2E37 Item A", 100_00, true);
  const itemB = await mkItem("E2E37 Item B", 50_00, false);
  const pkgRes = await page.request.post("/api/crm/pricebook/packages", {
    data: {
      name: `E2E37 Package ${stamp}`, tier: 1,
      items: [
        { itemId: itemA, quantityMilli: 1000 },
        { itemId: itemB, quantityMilli: 2000 },
      ],
    },
  });
  if (!pkgRes.ok()) throw new Error(`create package: ${pkgRes.status()} ${await pkgRes.text()}`);
  const packageId = (await pkgRes.json()).id as string;

  // ── Contractor: create the client through the UI ────────────────────────
  const clientName = `E2E37 Client ${stamp}`;
  await gotoCrm(page, "/crm/clients");
  await page.getByTestId("button-new-client").click();
  await page.getByTestId("input-client-name").fill(clientName);
  await page.getByTestId("input-client-email").fill(`e2e37-${stamp}@example.com`);
  await page.getByTestId("button-save-client").click();
  await expect(page.getByText("Client created", { exact: true })).toBeVisible();
  await page.locator("tr", { hasText: clientName }).first().click();
  await expect(page.locator("h1")).toContainText(clientName);
  const customerId = page.url().split("/crm/clients/")[1];

  // ── Contractor: build the estimate (10% tax keeps the math honest) ──────
  await page.getByTestId("button-new-estimate").click();
  await page.getByTestId("input-estimate-title").fill(`E2E37 estimate ${stamp}`);
  await page.locator("#e-tax").fill("10");
  const row0 = page.getByTestId("line-item-0");
  await row0.locator("input").first().fill("Base scope");
  await row0.locator('input[type="number"]').nth(1).fill("100");
  await page.getByTestId("button-save-estimate").click();
  await expect(page.getByText("Estimate created", { exact: true })).toBeVisible();
  const est = page.locator('[data-testid^="estimate-"]', { hasText: `E2E37 estimate ${stamp}` });
  const estId = (await est.getAttribute("data-testid"))!.replace("estimate-", "");

  // ── Option 1: lines from the price-book search ──────────────────────────
  await page.getByTestId(`button-options-${estId}`).click();
  const dlg = page.locator('[role="dialog"]');
  await page.getByTestId("input-option-name").fill("Better");
  await page.getByTestId("input-option-item-search").fill(stamp);
  await expect(page.getByTestId(`option-pb-row-${itemA}`)).toBeVisible();
  await page.getByTestId(`button-option-pb-add-${itemA}`).click();
  await page.getByTestId(`button-option-pb-add-${itemB}`).click();
  // Bump A to qty 2: 2×$100 + 1×$50 = $250 lines total; the typed-total
  // field is disabled while lines ride along (the server computes).
  await page.getByTestId(`input-option-line-qty-${itemA}`).fill("2");
  await expect(page.getByTestId("text-option-lines-total")).toHaveText(money(250_00));
  await expect(page.getByTestId("input-option-total")).toBeDisabled();
  await page.getByTestId("check-option-recommended").click();
  await page.getByTestId("button-save-option").click();
  await expect(page.getByText("Option added", { exact: true })).toBeVisible();
  const optRowA = dlg.locator('[data-testid^="option-"]', { hasText: "Better" });
  await expect(optRowA).toContainText("client picks · 2 lines");
  // 10% tax on the taxable $200 → $270.
  await expect(optRowA).toContainText(money(270_00));
  const optionAId = (await optRowA.getAttribute("data-testid"))!.replace("option-", "");

  // ── Option 2: a whole package becomes a scoped option in one click ──────
  await page.getByTestId("select-option-package").click();
  await page.getByTestId(`package-item-${packageId}`).click();
  await page.getByTestId("button-add-package-option").click();
  await expect(page.getByText("Option added", { exact: true })).toBeVisible();
  const optRowB = dlg.locator('[data-testid^="option-"]', { hasText: `E2E37 Package ${stamp}` });
  await expect(optRowB).toContainText("client picks · 2 lines");
  // Package: 1×$100 taxable + 2×$50 non-taxable = $200 + $10 tax → $210.
  await expect(optRowB).toContainText(money(210_00));
  const optionBId = (await optRowB.getAttribute("data-testid"))!.replace("option-", "");

  // ── Legacy itemless tier: coexists (labelled), removable pre-approval ───
  await page.getByTestId("input-option-name").fill("Scratch tier");
  await page.getByTestId("input-option-total").fill("299");
  await page.getByTestId("button-save-option").click();
  await expect(page.getByText("Option added", { exact: true })).toBeVisible();
  const scratch = dlg.locator('[data-testid^="option-"]', { hasText: "Scratch tier" });
  await expect(scratch).toContainText("display tier");
  const scratchId = (await scratch.getAttribute("data-testid"))!.replace("option-", "");
  await page.getByTestId(`button-remove-option-${scratchId}`).click();
  await expect(page.getByText("Option removed", { exact: true })).toBeVisible();
  await expect(dlg.locator('[data-testid^="option-"]', { hasText: "Scratch tier" })).toHaveCount(0);

  // Close the dialog (toast sits above it in Radix's dismissable stack).
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  // ── Send ────────────────────────────────────────────────────────────────
  await page.getByTestId(`button-send-${estId}`).click();
  await expect(page.getByText("Estimate sent", { exact: true })).toBeVisible();
  const [{ public_token: token }] = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estId]);

  // ── Client: checkboxes render; select both → review → generate → approve ─
  await grantClientSession(page, [customerId]);
  await page.goto(`/e/${token}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("public-estimate-root")).toBeVisible();
  await expect(page.getByTestId("options-checklist")).toBeVisible();
  await expect(page.getByTestId(`checkbox-option-${optionAId}`)).toBeVisible();
  await expect(page.getByTestId(`checkbox-option-${optionBId}`)).toBeVisible();

  await page.getByTestId(`checkbox-option-${optionAId}`).click();
  await page.getByTestId(`checkbox-option-${optionBId}`).click();
  // $270 + $210.
  await expect(page.getByTestId("text-options-total")).toHaveText(money(480_00));

  await page.getByTestId("button-review-selection").click();
  // subtotal $250 + $200 = $450; tax on the taxable $300 at 10% = $30.
  await expect(page.getByTestId("text-review-subtotal")).toHaveText(money(450_00));
  await expect(page.getByTestId("text-review-tax")).toHaveText(money(30_00));
  await expect(page.getByTestId("text-review-total")).toHaveText(money(480_00));

  const beforeGenerate = page.url();
  await page.getByTestId("button-generate-estimate").click();
  await page.waitForURL((url) => url.pathname.startsWith("/e/") && url.toString() !== beforeGenerate, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("public-estimate-root")).toBeVisible();
  await expect(page.getByTestId("doc-total")).toHaveText(money(480_00));
  // Both selected scopes contain the fixture items, so each name appears
  // once per scope on the regenerated document.
  await expect(page.getByText(`E2E37 Item A ${stamp}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`E2E37 Item B ${stamp}`, { exact: true }).first()).toBeVisible();

  await page.getByTestId("input-signature").fill("E2E37 Homeowner");
  await page.getByTestId("button-approve").click();
  await expect(page.getByText("Approved — thank you!")).toBeVisible();

  guards.assertClean("option editor");
});
