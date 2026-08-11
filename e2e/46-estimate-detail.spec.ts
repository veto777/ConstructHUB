import { expect, test } from "@playwright/test";
import { gotoCrm, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * The estimate detail page (/crm/estimates/:id) — the owner's two loudest
 * complaints covered end to end:
 *   1. scope/descriptions typed into the editor SAVE and render back;
 *   2. a SENT estimate can still be edited, and deleted from the UI.
 */
test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("estimate detail page", () => {
  test("curated: open from the list → edit → save → scope text persists", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId } = await makeEstimate(page);

    // The Documents Center row action carries you to the detail page.
    const cust = await page.request.get(`/api/crm/customers/${customerId}`).then((r) => r.json());
    await gotoCrm(page, "/crm/estimates");
    await page.getByTestId("input-search").fill(cust.customer.displayName);
    await page.getByTestId(`button-open-doc-${estimateId}`).click();
    await expect(page).toHaveURL(new RegExp(`/crm/estimates/${estimateId}`));
    await expect(page.getByTestId("estimate-detail")).toBeVisible();

    // Edit: title + long-form scope text on the line.
    await page.getByTestId("button-edit-estimate").click();
    await expect(page.getByTestId("estimate-editor")).toBeVisible();
    await page.getByTestId("input-edit-title").fill("E2E revised title");
    const scope = "Tear off existing siding\n• Install weather barrier\n• Install HardiePlank";
    await page.getByTestId("edit-line-scope-0").fill(scope);
    await page.getByTestId("button-save-estimate-edit").click();

    // Read mode shows exactly what was typed — and it really persisted.
    await expect(page.getByTestId("estimate-detail")).toBeVisible();
    await expect(page.locator("h1")).toContainText("E2E revised title");
    await expect(page.getByTestId("detail-line-0")).toContainText("Install HardiePlank");
    const det = await page.request.get(`/api/crm/estimates/${estimateId}`).then((r) => r.json());
    expect(det.estimate.title).toBe("E2E revised title");
    expect(det.items[0].description).toBe(scope);

    guards.assertClean("estimate detail edit");
  });

  test("curated: a SENT estimate still edits and deletes from the UI", async ({ page }) => {
    const guards = watchPage(page);
    const { estimateId } = await makeEstimate(page);

    // Send it (email is force-sunk in this lane), then edit AFTER send.
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    if (!send.ok()) throw new Error(`send: ${send.status()} ${await send.text()}`);

    await gotoCrm(page, `/crm/estimates/${estimateId}`);
    await expect(page.getByTestId("estimate-detail")).toBeVisible();

    await page.getByTestId("button-edit-estimate").click();
    await page.getByTestId("input-edit-title").fill("Edited after send");
    await page.getByTestId("button-save-estimate-edit").click();
    await expect(page.getByTestId("estimate-detail")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Edited after send");
    await expect(page.locator("h1")).toContainText("sent"); // still sent — editing never un-sends

    // Delete it from the same page.
    await page.getByTestId("button-delete-estimate").click();
    await page.getByTestId("button-confirm-delete-estimate").click();
    await expect(page).toHaveURL(/\/crm\/estimates$/);
    const gone = await page.request.get(`/api/crm/estimates/${estimateId}`);
    expect(gone.status()).toBe(404);

    guards.assertClean("estimate detail edit-after-send + delete");
  });
});
