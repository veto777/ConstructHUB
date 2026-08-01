import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, makeEstimate, watchPage } from "./helpers";

/**
 * Owner-only hard deletes (test-document cleanup).
 *
 *   1. The owner deletes a throwaway estimate from the Documents Center —
 *      the confirm dialog names the document, the row and the record go.
 *   2. The owner deletes a throwaway client (with a document) from the client
 *      page — the dialog spells out the tree, ?force=1 takes it all down.
 *   3. An admin sees NO delete buttons anywhere (the server would 403 too;
 *      the UI simply never offers it).
 *
 * @serial: test 3 re-roles the dev-bypass user to admin and back — every
 * other suite expects owner, so this cannot run beside them.
 */
test.describe("owner-only delete", { tag: "@serial" }, () => {
  test("owner deletes a test estimate from the Documents Center", async ({ page }) => {
    const guards = watchPage(page);
    const { estimateId } = await makeEstimate(page);

    await gotoCrm(page, "/crm/estimates");
    const row = page.getByTestId(`doc-row-${estimateId}`);
    await expect(row).toBeVisible();

    await page.getByTestId(`button-delete-doc-${estimateId}`).click();
    const dlg = page.getByTestId("dialog-delete-doc");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("E-"); // names the exact estimate number
    await expect(dlg).toContainText("cannot be undone");

    await page.getByTestId("button-confirm-delete-doc").click();
    await expect(row).toHaveCount(0);
    const check = await page.request.get(`/api/crm/estimates/${estimateId}`);
    expect(check.status()).toBe(404);
    guards.assertClean("owner estimate delete");
  });

  test("owner deletes a test client with force from the client page", async ({ page }) => {
    const guards = watchPage(page);
    // A client WITH a document — the plain delete would 409, so the dialog
    // must spell out that the whole tree goes.
    const { customerId } = await makeEstimate(page);

    await gotoCrm(page, `/crm/clients/${customerId}`);
    await page.getByTestId("button-delete-client").click();
    const dlg = page.getByTestId("dialog-delete-client");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("entire tree");
    await expect(dlg).toContainText("1 estimate(s)");
    await expect(dlg).toContainText("cannot be undone");

    await page.getByTestId("button-confirm-delete-client").click();
    await page.waitForURL("**/crm/clients");
    const check = await page.request.get(`/api/crm/customers/${customerId}`);
    expect(check.status()).toBe(404);
    guards.assertClean("owner client force delete");
  });

  test("admin sees no delete buttons (role flipped, then restored)", async ({ page }) => {
    const guards = watchPage(page);
    const { estimateId, customerId } = await makeEstimate(page);
    const me = await (await page.request.get("/api/crm/me")).json();
    const orgId = me.org.id as string;

    try {
      await q(`update crm_members set role = 'admin' where org_id = $1 and user_id = 1`, [orgId]);

      await gotoCrm(page, "/crm/estimates");
      await expect(page.getByTestId(`doc-row-${estimateId}`)).toBeVisible();
      await expect(page.getByTestId(`button-delete-doc-${estimateId}`)).toHaveCount(0);

      await gotoCrm(page, "/crm/invoices");
      await expect(page.locator('[data-testid^="button-delete-doc-"]')).toHaveCount(0);

      await gotoCrm(page, `/crm/clients/${customerId}`);
      await expect(page.getByTestId("button-delete-client")).toHaveCount(0);
    } finally {
      await q(`update crm_members set role = 'owner' where org_id = $1 and user_id = 1`, [orgId]);
    }

    // The restore actually took: the owner sees the button again.
    await gotoCrm(page, `/crm/clients/${customerId}`);
    await expect(page.getByTestId("button-delete-client")).toBeVisible();
    guards.assertClean("admin sees no delete buttons");

    // Clean up the fixture (owner again, force the tree down).
    const cleanup = await page.request.delete(`/api/crm/customers/${customerId}?force=1`);
    expect(cleanup.ok()).toBeTruthy();
  });
});
