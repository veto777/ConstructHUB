import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Lead capture — the embeddable website form on /crm/integrations.
 *
 * Card renders with the direct link + iframe snippet; the public form takes a
 * submission with no auth; the lead shows up in /crm/clients. Everything here
 * uses its own throwaway lead (unique per run), so it is parallel-phase safe.
 * The token is read from the DB (custom_fields->leadCaptureToken) — never
 * hard-coded — so a rotation by another suite can't stale this one out.
 */

/** Mint (if needed) and read the Aspire org's lead-capture token. */
async function leadToken(page: any): Promise<string> {
  const r = await page.request.get("/api/crm/integrations/lead-capture");
  if (!r.ok()) throw new Error(`lead-capture GET failed: ${r.status()} ${await r.text()}`);
  const rows = await q<{ token: string }>(
    `select custom_fields->>'leadCaptureToken' as token from crm_orgs where id = $1`,
    [ORGS.aspire],
  );
  if (!rows[0]?.token) throw new Error("leadCaptureToken missing from crm_orgs.custom_fields after GET");
  return rows[0].token;
}

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test("card: link, embed snippet, rotate and count render on /crm/integrations", async ({ page }) => {
  const guards = watchPage(page);
  await gotoCrm(page, "/crm/integrations");

  const card = page.getByTestId("card-lead-capture");
  await expect(card).toBeVisible();

  const link = page.getByTestId("input-lead-form-url");
  await expect(link).toHaveValue(/\/lead-form\/.+/);

  const embed = page.getByTestId("text-lead-embed");
  await expect(embed).toContainText("<iframe");
  await expect(embed).toContainText("/lead-form/");

  await expect(page.getByTestId("button-copy-lead-link")).toBeVisible();
  await expect(page.getByTestId("button-copy-lead-embed")).toBeVisible();
  await expect(page.getByTestId("button-rotate-lead-token")).toBeVisible();
  await expect(page.getByTestId("text-lead-count")).toContainText("last 30 days");

  guards.assertClean("lead-capture card");
});

test("public form: submit -> success -> lead visible in /crm/clients", async ({ page }) => {
  const guards = watchPage(page);
  const token = await leadToken(page);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const leadName = `E2E Lead ${stamp}`;

  // The public page needs no session at all.
  await gotoCrm(page, `/lead-form/${token}`);
  await expect(page.getByTestId("input-lead-name")).toBeVisible();
  await expect(page.locator("h1")).toContainText("Aspire Interiors");

  await page.getByTestId("input-lead-name").fill(leadName);
  await page.getByTestId("input-lead-email").fill(`e2e-lead-${stamp}@example.com`);
  await page.getByTestId("input-lead-phone").fill("555-0188");
  await page.getByTestId("textarea-lead-message").fill("E2E: two bathrooms and a kitchen.");
  await page.getByTestId("button-lead-submit").click();
  await expect(page.getByTestId("text-lead-success")).toBeVisible();
  await expect(page.getByTestId("text-lead-success")).toContainText("Thanks — we'll be in touch");

  // The lead landed in the CRM as a client.
  const rows = await q<{ id: string; tags: string[] }>(
    `select id, tags from crm_customers where org_id = $1 and display_name = $2`,
    [ORGS.aspire, leadName],
  );
  expect(rows.length).toBe(1);
  expect(rows[0].tags).toContain("website-lead");

  await gotoCrm(page, "/crm/clients");
  await page.getByTestId("input-search-clients").fill(leadName);
  await expect(page.getByTestId(`client-${rows[0].id}`)).toBeVisible();
  await expect(page.getByTestId(`client-${rows[0].id}`)).toContainText(leadName);

  guards.assertClean("lead-capture submit");

  await q(`delete from crm_customers where id = $1`, [rows[0].id]);
});
