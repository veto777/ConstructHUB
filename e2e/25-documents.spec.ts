import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

/**
 * Documents Center — /crm/estimates and /crm/invoices. The owner's #1 HCP
 * complaint was no filtering, and their migrated estimates were invisible
 * because lists were per-client only. These specs pin: checkbox multi-status
 * filters combine (OR), date ranges narrow, search matches number AND
 * customer, sort orders, and rows navigate to the client detail.
 *
 * Ground truth comes from the API itself (same session cookies), so the UI
 * assertions never hardcode seeded counts.
 */

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function docQuery(page: Page, endpoint: string, params = "") {
  const r = await page.request.get(`${endpoint}?sort=newest${params}`);
  if (!r.ok()) throw new Error(`${endpoint} ${params}: ${r.status()} ${await r.text()}`);
  return (await r.json()) as { rows: any[]; total: number; filtered: number };
}

// @serial: asserts live document counts in the Aspire org — concurrent specs
// creating estimates/invoices there would shift the totals mid-test.
test.describe("/crm/estimates", { tag: "@serial" }, () => {
  test("curated: status checkboxes combine, date range narrows, search matches, sort orders, rows navigate", async ({ page }) => {
    const guards = watchPage(page);

    const all = await docQuery(page, "/api/crm/estimates");
    const drafts = await docQuery(page, "/api/crm/estimates", "&status=draft");
    const sent = await docQuery(page, "/api/crm/estimates", "&status=sent");
    const both = await docQuery(page, "/api/crm/estimates", "&status=draft,sent");
    expect(both.filtered).toBe(drafts.filtered + sent.filtered);

    await gotoCrm(page, "/crm/estimates");
    await expect(page.locator("h1")).toContainText("Estimates");
    const summary = page.getByTestId("text-count-summary");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // One checkbox narrows; a second combines (OR); unchecking widens back.
    await page.getByTestId("filter-status-draft").check();
    await expect(summary).toHaveText(`${drafts.filtered} of ${all.total}`);
    await page.getByTestId("filter-status-sent").check();
    await expect(summary).toHaveText(`${both.filtered} of ${all.total}`);
    await page.getByTestId("filter-status-draft").uncheck();
    await expect(summary).toHaveText(`${sent.filtered} of ${all.total}`);
    await page.getByTestId("filter-status-sent").uncheck();
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Custom date range in the far future narrows to nothing — with the
    // honest empty state, not a crash.
    await page.getByTestId("select-date-range").selectOption("custom");
    await page.getByTestId("input-date-from").fill("2099-01-01");
    await expect(summary).toHaveText(`0 of ${all.total}`);
    await expect(page.getByTestId("empty-docs")).toBeVisible();
    await page.getByTestId("select-date-range").selectOption("any");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Search by document number.
    const first = all.rows[0];
    const byNumber = await docQuery(page, "/api/crm/estimates", `&q=${encodeURIComponent(first.number)}`);
    await page.getByTestId("input-search").fill(first.number);
    await expect(summary).toHaveText(`${byNumber.filtered} of ${all.total}`);
    await expect(page.locator('[data-testid^="doc-row-"]').first()).toContainText(first.number);

    // Search by customer name.
    const byCustomer = await docQuery(page, "/api/crm/estimates", `&q=${encodeURIComponent(first.customerName)}`);
    await page.getByTestId("input-search").fill(first.customerName);
    await expect(summary).toHaveText(`${byCustomer.filtered} of ${all.total}`);
    await expect(page.locator('[data-testid^="doc-row-"]').first()).toContainText(first.customerName);
    await page.getByTestId("input-search").fill("");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Sort: largest first puts the API's biggest document on top.
    const largest = await page.request.get("/api/crm/estimates?sort=largest").then((r) => r.json());
    await page.getByTestId("select-sort").selectOption("largest");
    await expect(page.locator('[data-testid^="doc-row-"]').first()).toHaveAttribute(
      "data-testid", `doc-row-${largest.rows[0].id}`,
    );

    // A row carries you to that client.
    await page.getByTestId(`doc-link-${largest.rows[0].id}`).click();
    await expect(page).toHaveURL(new RegExp(`/crm/clients/${largest.rows[0].customerId}`));
    await expect(page.locator("h1")).toContainText(largest.rows[0].customerName ?? "", { timeout: 15_000 });

    guards.assertClean("estimates curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/estimates", {
      ready: 'h1:has-text("Estimates")',
    });
    console.log(`estimates sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(12);
  });
});

test.describe("/crm/invoices", { tag: "@serial" }, () => {
  test("curated: status checkboxes combine, overdue derives, date range narrows, search matches, rows navigate", async ({ page }) => {
    const guards = watchPage(page);

    const all = await docQuery(page, "/api/crm/invoices");
    const paid = await docQuery(page, "/api/crm/invoices", "&status=paid");
    const voided = await docQuery(page, "/api/crm/invoices", "&status=void");
    const overdue = await docQuery(page, "/api/crm/invoices", "&status=overdue");

    await gotoCrm(page, "/crm/invoices");
    await expect(page.locator("h1")).toContainText("Invoices");
    const summary = page.getByTestId("text-count-summary");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Checkbox filters combine here too.
    await page.getByTestId("filter-status-paid").check();
    await expect(summary).toHaveText(`${paid.filtered} of ${all.total}`);
    await page.getByTestId("filter-status-void").check();
    await expect(summary).toHaveText(`${paid.filtered + voided.filtered} of ${all.total}`);
    await page.getByTestId("filter-status-paid").uncheck();
    await page.getByTestId("filter-status-void").uncheck();
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // "Overdue" isn't a stored status — it's derived server-side from due
    // date + balance. The checkbox must match the API's derivation exactly.
    await page.getByTestId("filter-status-overdue").check();
    await expect(summary).toHaveText(`${overdue.filtered} of ${all.total}`);
    if (overdue.filtered === 0) {
      await expect(page.getByTestId("empty-docs")).toBeVisible();
    } else {
      await expect(page.locator('[data-testid^="doc-row-"]').first()).toContainText("Overdue");
    }
    await page.getByTestId("filter-status-overdue").uncheck();

    // Date range narrows (far-future custom range → nothing).
    await page.getByTestId("select-date-range").selectOption("custom");
    await page.getByTestId("input-date-from").fill("2099-01-01");
    await expect(summary).toHaveText(`0 of ${all.total}`);
    await page.getByTestId("select-date-range").selectOption("any");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Search by invoice number.
    const first = all.rows[0];
    const byNumber = await docQuery(page, "/api/crm/invoices", `&q=${encodeURIComponent(first.number)}`);
    await page.getByTestId("input-search").fill(first.number);
    await expect(summary).toHaveText(`${byNumber.filtered} of ${all.total}`);
    await page.getByTestId("input-search").fill("");
    await expect(summary).toHaveText(`${all.total} of ${all.total}`);

    // Sort largest → API's biggest invoice on top; clicking the ROW (not the
    // link) also navigates to the client.
    const largest = await page.request.get("/api/crm/invoices?sort=largest").then((r) => r.json());
    await page.getByTestId("select-sort").selectOption("largest");
    await expect(page.locator('[data-testid^="doc-row-"]').first()).toHaveAttribute(
      "data-testid", `doc-row-${largest.rows[0].id}`,
    );
    await page.locator('[data-testid^="doc-row-"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/crm/clients/${largest.rows[0].customerId}`));
    await expect(page.locator("h1")).toContainText(largest.rows[0].customerName ?? "", { timeout: 15_000 });

    guards.assertClean("invoices curated");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/invoices", {
      ready: 'h1:has-text("Invoices")',
    });
    console.log(`invoices sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(12);
  });
});
