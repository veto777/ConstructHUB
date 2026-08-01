import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

/**
 * Measurement report imports: paste a HOVER-style report, review the parse,
 * confirm — the client lands on /crm/clients, and the report shows up in the
 * homeowner's own client portal next to their estimates and invoices.
 */

const reportText = (name: string, email: string, phone: string) => `HOVER Inc.
Measurements Report

Prepared for: ${name}
Property Address:
1420 Palma Sola Blvd
Bradenton, FL 34209

Contact: ${email}
Phone: ${phone}

Roof Measurements
Total Roof Area: 3,245.6 SF
Roof Facets: 14
Predominant Pitch: 6/12
Suggested Waste: 12%
`;

// Phone dedupe matches on digits, so it must be as unique per run as the email.
const uniquePhone = () => {
  const n = String(Math.floor(100000 + Math.random() * 900000));
  return `(941) 5${n.slice(0, 2)}-${n.slice(2)}`;
};

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm/reports", () => {
  test("curated: paste → preview → confirm → client created → client portal shows the report", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = `E2E Report ${stamp}`;
    const email = `e2e-report-${stamp}@example.com`;

    await gotoCrm(page, "/crm/reports");
    await expect(page.locator("h1")).toContainText("Measurement reports");

    // Paste the report text — the always-works path.
    await page.getByTestId("textarea-report-text").fill(reportText(name, email, uniquePhone()));
    await page.getByTestId("button-parse-report").click();

    // Preview shows what was parsed BEFORE anything is created.
    const preview = page.getByTestId("report-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("preview-name")).toHaveText(name);
    await expect(preview).toContainText(email);
    await expect(preview).toContainText("1420 Palma Sola Blvd");
    await expect(preview).toContainText("32.46 squares");
    await expect(preview).toContainText("6/12");
    await expect(page.getByTestId("pill-provider")).toHaveText("hover");

    // Confirm creates the client and files the report.
    await page.getByTestId("button-confirm-report").click();
    await expect(page.getByText("Client created", { exact: true })).toBeVisible();
    await expect(page.getByTestId("report-confirmed")).toBeVisible();

    // The client is on the Clients page.
    await gotoCrm(page, "/crm/clients");
    await page.getByTestId("input-search-clients").fill(name);
    await expect(page.locator('[data-testid^="client-"]').first()).toContainText(name);

    // …and the report is in the client's own portal.
    const rows = await q<{ id: string }>(`select id from crm_customers where lower(email) = $1`, [email]);
    expect(rows.length).toBe(1);
    await grantClientSession(page, [rows[0].id]);
    await gotoCrm(page, "/?client=1");
    // Measurement reports live behind their own sidebar view in the portal.
    await page.getByTestId("portal-nav-reports").click();
    const reports = page.getByTestId("section-reports");
    await expect(reports).toBeVisible({ timeout: 15_000 });
    await expect(reports).toContainText("hover report");
    await expect(reports).toContainText("1420 Palma Sola Blvd");
    await expect(reports).toContainText("32.46 sq");

    guards.assertClean("reports curated");
  });

  test("curated: a same-email report matches the existing client instead of duplicating", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = `E2E Match ${stamp}`;
    const email = `e2e-match-${stamp}@example.com`;

    for (const [i, n] of [`${name} One`, `${name} Two`].entries()) {
      await gotoCrm(page, "/crm/reports");
      await page.getByTestId("textarea-report-text").fill(reportText(n, email, uniquePhone()));
      await page.getByTestId("button-parse-report").click();
      await expect(page.getByTestId("report-preview")).toBeVisible();
      await page.getByTestId("button-confirm-report").click();
      await expect(
        page.getByText(i === 0 ? "Client created" : "Existing client matched", { exact: true }),
      ).toBeVisible();
    }

    // Exactly ONE customer row carries that email.
    const rows = await q<{ id: string }>(`select id from crm_customers where lower(email) = $1`, [email]);
    expect(rows.length).toBe(1);

    guards.assertClean("reports dedupe");
  });

  test("sweep: every button and link", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/reports", {
      ready: 'h1:has-text("Measurement reports")',
      // Download links are Content-Disposition attachments, not pages.
      skip: ({ testid }) => testid.startsWith("report-download-"),
    });
    console.log(`reports sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(8);
  });
});
