import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * The global Create menu + quick Message flow.
 *
 *   - Sidebar (and mobile ribbon More sheet) Create button opens Estimate /
 *     Invoice / Lead / Message / Customer.
 *   - Lead creates the client + a project in the FIRST pipeline stage — the
 *     Lead swimlane IS the lead list; there is no lead entity by design.
 *   - Message composes to any client: Email always works; Text is grayed out
 *     with a pointer to Settings → Integrations while SMS is unconfigured in
 *     dev — never a clickable dead button.
 */
test.describe("create menu + quick message", () => {
  test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

  test("sidebar Create opens with every item; Estimate navigates to the new-estimate flow", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/home");

    await page.getByTestId("button-create").click();
    await expect(page.getByTestId("create-menu")).toBeVisible();
    await expect(page.getByTestId("create-item-estimate")).toBeVisible();
    await expect(page.getByTestId("create-item-invoice")).toBeVisible();
    await expect(page.getByTestId("create-item-lead")).toBeVisible();
    await expect(page.getByTestId("create-item-message")).toBeVisible();
    await expect(page.getByTestId("create-item-customer")).toBeVisible();

    await page.getByTestId("create-item-estimate").click();
    await expect(page).toHaveURL(/\/crm\/estimates\/new/);

    guards.assertClean("create menu opens");
  });

  test("lead flow creates the client + a project in the pipeline's first swimlane", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = `E2E Lead ${stamp}`;

    await gotoCrm(page, "/crm/home");
    await page.getByTestId("button-create").click();
    await page.getByTestId("create-item-lead").click();

    await expect(page.getByTestId("dialog-create-lead")).toBeVisible();
    await page.getByTestId("input-lead-name").fill(name);
    await page.getByTestId("input-lead-email").fill(`e2e-lead-${stamp}@example.com`);
    // Unique per run — the CRM refuses duplicate phones (409) by design.
    await page.getByTestId("input-lead-phone").fill(`+1 555 ${String(Math.floor(1000000 + Math.random() * 8999999))}`);
    await page.getByTestId("input-lead-addr").fill("1200 Pine St");
    await page.getByTestId("input-lead-note").fill("Soffit repair, called twice.");
    await page.getByTestId("button-save-lead").click();

    // Lands on the pipeline; the card sits in the Lead swimlane.
    await expect(page).toHaveURL(/\/crm\/pipeline/, { timeout: 15_000 });
    const leadCol = page.getByTestId("stage-col-lead");
    await expect(leadCol).toBeVisible({ timeout: 15_000 });
    await expect(leadCol.getByText(name, { exact: false })).toBeVisible({ timeout: 15_000 });

    // The DB agrees: the project is in the first stage, on the new client.
    const rows = await q<{ status: string; display_name: string }>(
      `select p.status, c.display_name from crm_projects p
       join crm_customers c on c.id = p.customer_id
       where c.display_name = $1 order by p.created_at desc limit 1`,
      [name]);
    expect(rows[0]?.status).toBe("lead");

    guards.assertClean("lead flow");
  });

  test("message composer grays Text out with the settings hint; Email sends and lands on the timeline", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cust = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E QM ${stamp}`, email: `e2e-qm-${stamp}@example.com` },
    });
    expect(cust.ok()).toBeTruthy();
    const customer = await cust.json();

    await gotoCrm(page, "/crm/home");
    await page.getByTestId("button-create").click();
    // The Message item itself stays enabled — email always works.
    await page.getByTestId("create-item-message").click();

    await expect(page.getByTestId("dialog-quick-message")).toBeVisible();
    await page.getByTestId("input-message-client-search").fill(customer.displayName);
    await page.getByTestId(`pick-client-${customer.id}`).click();
    await expect(page.getByTestId("picked-client")).toContainText(customer.displayName);

    // THE GRAY-OUT: SMS is unconfigured in dev — Text is disabled with the
    // way to turn it on, not a dead button. Email stays fully usable.
    await expect(page.getByTestId("channel-text")).toBeDisabled();
    await expect(page.getByTestId("text-texting-off-hint")).toContainText("Texting is off");
    const enableLink = page.getByTestId("link-enable-texting");
    await expect(enableLink).toContainText("Settings → Integrations");
    await expect(enableLink).toHaveAttribute("href", "/crm/settings");
    await expect(page.getByTestId("channel-email")).toBeEnabled();

    // Email sends and is recorded on the client's timeline.
    await page.getByTestId("input-message-body").fill("The crew starts Monday at 8am.");
    await page.getByTestId("button-send-message").click();
    await expect(page.getByText("Email sent")).toBeVisible({ timeout: 10_000 });

    await gotoCrm(page, `/crm/clients/${customer.id}`);
    const timeline = page.getByTestId("section-timeline");
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    await expect(timeline.getByText(/Message sent via email to e2e-qm-/)).toBeVisible({ timeout: 15_000 });
    await expect(timeline.getByText(/The crew starts Monday at 8am/)).toBeVisible();

    guards.assertClean("quick message");
  });

  test("mobile ribbon More sheet carries the same Create menu", async ({ page }) => {
    const guards = watchPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCrm(page, "/crm/home");

    await page.getByTestId("ribbon-tab-more").click();
    await expect(page.getByTestId("ribbon-more-sheet")).toBeVisible();
    await page.getByTestId("ribbon-button-create").click();
    await expect(page.getByTestId("create-item-estimate")).toBeVisible();
    await expect(page.getByTestId("create-item-message")).toBeVisible();
    await expect(page.getByTestId("create-item-lead")).toBeVisible();

    guards.assertClean("ribbon create menu");
  });
});
