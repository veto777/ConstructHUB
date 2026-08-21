import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Client page → "Add to pipeline" must visibly work (prod incident: "the UI
 * showed nothing happened" — the row WAS in crm_projects).
 *
 * Root cause was session-level staleness: the query client runs with
 * staleTime: Infinity, so the pipeline board (/api/crm/projects, also the home
 * page's pipeline rollup) only ever refreshes on explicit invalidation — and
 * the client page's createProject didn't invalidate it. An owner who had the
 * pipeline open earlier in the session added the lead, came back, and saw the
 * old board until a manual reload.
 *
 * This spec reproduces the exact session shape: pipeline first (caches the
 * board), SPA-navigate to the client page, add the project, SPA-navigate back
 * — the card must be in the Lead column WITHOUT a full reload.
 */
test.describe("client page → Add to pipeline", () => {
  test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

  test("toast + client Projects section + pipeline Lead column — all without a reload", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const customerName = `E2E Pipe ${stamp}`;
    const projectName = `E2E Pipe Project ${stamp}`;

    const cust = await page.request.post("/api/crm/customers", { data: { displayName: customerName } });
    expect(cust.status()).toBe(201);
    const customer = await cust.json();
    let projectId = "";

    try {
      // Step 1: the pipeline is opened first — its query is now cached for
      // the rest of this SPA session (staleTime: Infinity).
      await gotoCrm(page, "/crm/pipeline");
      await expect(page.getByTestId("stage-col-lead")).toBeVisible();

      // Step 2: SPA-navigate to the new client's page (sidebar → row click).
      await page.locator('a[href="/crm/clients"]').first().click();
      await expect(page.getByTestId(`client-${customer.id}`)).toBeVisible();
      await page.getByTestId(`client-${customer.id}`).click();
      await expect(page.getByTestId("button-quick-pipeline")).toBeVisible();

      // Step 3: Add to pipeline.
      await page.getByTestId("button-quick-pipeline").click();
      await page.getByTestId("input-project-name").fill(projectName);
      const posted = page.waitForResponse(
        (r) => r.url().includes("/api/crm/projects") && r.request().method() === "POST");
      await page.getByTestId("button-save-project").click();
      projectId = (await (await posted).json()).id;

      // Feedback: toast + the dialog closes + the client page lists it.
      await expect(page.getByText("Project created", { exact: true })).toBeVisible();
      await expect(page.getByTestId("input-project-name")).toBeHidden();
      await expect(page.getByTestId(`project-${projectId}`)).toBeVisible();

      // Step 4: SPA-navigate BACK to the pipeline. Before the fix the Lead
      // column still showed the pre-create cache — "nothing happened".
      await page.locator('a[href="/crm/pipeline"]').first().click();
      await expect(page.getByTestId("stage-col-lead")).toBeVisible();
      const leadCol = page.getByTestId("stage-col-lead");
      await expect(leadCol.getByTestId(`card-project-${projectId}`)).toBeVisible();
      await expect(leadCol.getByText(projectName, { exact: false })).toBeVisible();

      const rows = await q(`select status from crm_projects where id = $1`, [projectId]);
      expect(rows[0]?.status).toBe("lead");
    } finally {
      if (projectId) await q(`delete from crm_projects where id = $1`, [projectId]);
      await q(`delete from crm_customers where id = $1`, [customer.id]);
    }
    guards.assertClean("client add-to-pipeline");
  });
});
