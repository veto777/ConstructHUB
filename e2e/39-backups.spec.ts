import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, watchPage } from "./helpers";

/**
 * Auto-backup (Settings, owner only).
 *
 *   1. The owner enables auto-backup, picks frequency/format/recipient, saves,
 *      hits "Send backup now" — a toast reports the row counts and the org's
 *      custom_fields->backup.lastSentAt is set in the DB. The prior backup
 *      config is restored afterwards.
 *   2. An admin does NOT see the card at all (the server 403s too — the UI
 *      simply never offers it). Role is flipped and restored.
 */
test.describe("auto-backup settings", () => {
  test("owner configures a backup and sends one now", async ({ page }) => {
    const guards = watchPage(page);
    const me = await (await page.request.get("/api/crm/me")).json();
    const orgId = me.org.id as string;
    const priorBackup = (me.org.customFields as any)?.backup ?? null;
    const recipient = `e2e-backup-${Date.now().toString(36)}@example.com`;

    try {
      await gotoCrm(page, "/crm/settings");
      await expect(page.getByTestId("card-backup")).toBeVisible();
      await expect(page.getByTestId("text-backup-last-sent")).toBeVisible();

      // Enable + configure.
      const toggle = page.getByTestId("switch-backup-enabled");
      if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();

      await page.getByTestId("select-backup-frequency").click();
      await page.getByRole("option", { name: "Every 2 weeks" }).click();

      await page.getByTestId("select-backup-format").click();
      await page.getByRole("option", { name: "CSV (three files)" }).click();

      await page.getByTestId("input-backup-email").fill(recipient);
      await page.getByTestId("button-save-backup").click();
      await expect(page.getByText("Backup settings saved", { exact: true })).toBeVisible();

      // Persisted: a reload shows the same choices.
      await gotoCrm(page, "/crm/settings");
      await expect(page.getByTestId("switch-backup-enabled")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("select-backup-frequency")).toContainText("Every 2 weeks");
      await expect(page.getByTestId("input-backup-email")).toHaveValue(recipient);

      // Send now → toast with the row counts, DB lastSentAt set.
      await page.getByTestId("button-send-backup-now").click();
      await expect(page.getByText("Backup sent", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/\d+ clients, \d+ estimates, \d+ invoices/).first()).toBeVisible();

      const rows = await q<{ last: string | null }>(
        `select custom_fields->'backup'->>'lastSentAt' as last from crm_orgs where id = $1`, [orgId]);
      expect(rows[0].last).toBeTruthy();
      await expect(page.getByTestId("text-backup-last-sent")).toContainText("Last sent");

      guards.assertClean("backup owner flow");
    } finally {
      // Restore the org's backup config exactly as found.
      if (priorBackup === null) {
        await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'backup' where id = $1`, [orgId]);
      } else {
        await q(
          `update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{backup}', $2::jsonb) where id = $1`,
          [orgId, JSON.stringify(priorBackup)],
        );
      }
    }
  });

  test("backup card hidden for non-owner (role flipped, then restored)", { tag: "@serial" }, async ({ page }) => {
    const guards = watchPage(page);
    const me = await (await page.request.get("/api/crm/me")).json();
    const orgId = me.org.id as string;

    try {
      await q(`update crm_members set role = 'admin' where org_id = $1 and user_id = 1`, [orgId]);

      // Admins still have manageSettings, so the page itself renders…
      await gotoCrm(page, "/crm/settings");
      await expect(page.locator("h1")).toContainText("Settings");
      // …but the owner-only card (and the price-lock card) never show.
      await expect(page.getByTestId("card-backup")).toHaveCount(0);

      // The API agrees.
      const denied = await page.request.post("/api/crm/backups/send-now", { data: {} });
      expect(denied.status()).toBe(403);
    } finally {
      await q(`update crm_members set role = 'owner' where org_id = $1 and user_id = 1`, [orgId]);
    }

    // The restore actually took: the owner sees the card again.
    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("card-backup")).toBeVisible();
    guards.assertClean("backup card hidden for admin");
  });
});
