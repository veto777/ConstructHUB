import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * SMS (Twilio) + engagement re-engagement alerts.
 *
 * No Twilio credentials exist in dev — the whole point is that the feature is
 * honest about that: the Settings card names the missing env vars, the
 * reminder still emails (and RECORDS the text via the log provider), and the
 * "client is reviewing their bid again" alert fires email + a recorded text.
 *
 * @serial: temporarily sets the shared owner member's phone (restored after)
 * and asserts outbox files the parallel lanes also append to.
 */
const EMAIL_OUTBOX = path.join(process.cwd(), "tmp", "email-outbox.jsonl");
const SMS_OUTBOX = path.join(process.cwd(), "tmp", "sms-outbox.jsonl");

const markerOf = async (estimateId: string) =>
  (await q<{ m: any }>(`select custom_fields->'reengagementAlerts' as m from crm_estimates where id = $1`, [estimateId]))[0]?.m ?? null;

test.describe("sms + engagement alerts", { tag: "@serial" }, () => {
  test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

  test("settings: the SMS card is honestly not-configured", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/settings");

    await expect(page.getByTestId("card-sms")).toBeVisible();
    await expect(page.getByTestId("pill-sms-status")).toHaveText("Not configured");
    await expect(page.getByTestId("text-sms-not-configured")).toBeVisible();
    // The card names exactly which env vars are missing, Stripe-style.
    const missing = await page.getByTestId("text-sms-missing").innerText();
    expect(missing).toContain("TWILIO_ACCOUNT_SID");
    expect(missing).toContain("TWILIO_AUTH_TOKEN");
    expect(missing).toContain("TWILIO_FROM_NUMBER");
    // The test-send control is disabled rather than pretending it could work.
    await expect(page.getByTestId("button-sms-test-send")).toBeDisabled();

    // …and the re-engagement notification switch exists (default ON).
    await expect(page.getByTestId("switch-notif-clientReengaged")).toBeVisible();
    guards.assertClean("settings sms card");
  });

  test("remind button emails the client and records the reminder (merge, never clobber)", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId } = await makeEstimate(page);
    // Give the client a mobile so the SMS leg runs (recorded by the log
    // provider — Twilio is unconfigured in dev).
    await q(`update crm_customers set phone = '+15550119988' where id = $1`, [customerId]);

    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();

    await gotoCrm(page, `/crm/clients/${customerId}`);
    const btn = page.getByTestId(`button-remind-${estimateId}`);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByText("Reminder recorded")).toBeVisible({ timeout: 10_000 });

    // The server recorded who/when/channel on the estimate itself.
    await expect.poll(async () => {
      const rows = await q<{ r: any[] }>(`select custom_fields->'reminders' as r from crm_estimates where id = $1`, [estimateId]);
      return rows[0]?.r?.length ?? 0;
    }, { timeout: 10_000 }).toBe(1);
    const rows = await q<{ r: any[] }>(`select custom_fields->'reminders' as r from crm_estimates where id = $1`, [estimateId]);
    expect(rows[0].r[0].channel).toBe("email+sms");
    expect(rows[0].r[0].by).toBeTruthy();
    expect(rows[0].r[0].at).toBeTruthy();

    // The text went to the log provider (Twilio unconfigured) — not to Twilio.
    const smsLog = fs.readFileSync(SMS_OUTBOX, "utf8");
    expect(smsLog).toContain('"provider":"log"');
    expect(smsLog).toContain("+15550119988");
    expect(smsLog).toContain("is waiting");

    guards.assertClean("reminder");
  });

  test("second gated open fires the 'client is reviewing their bid' alert — once", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();

    // The alert text goes to the estimate creator's member phone — set one on
    // the shared owner member and restore it afterwards.
    const prior = await q<{ phone: string | null }>(
      `select phone from crm_members where id = (select created_by_member_id from crm_estimates where id = $1)`, [estimateId]);
    const priorPhone = prior[0]?.phone ?? null;
    await q(
      `update crm_members set phone = '+15550100001' where id = (select created_by_member_id from crm_estimates where id = $1)`,
      [estimateId]);

    try {
      await grantClientSession(page, [customerId]);

      // First gated open: the page starts engagement session #1. No alert —
      // the first open is the "opened" notification's job.
      const start1 = page.waitForResponse((r) => r.url().includes("/api/public/engagement/start"));
      await gotoCrm(page, `/e/${token}`);
      expect((await (await start1).json()).sessionId).toBeTruthy();
      await page.waitForTimeout(800);
      expect(await markerOf(estimateId)).toBeNull();

      // Second distinct session (a real reload): the client is back → alert.
      const start2 = page.waitForResponse((r) => r.url().includes("/api/public/engagement/start"));
      await gotoCrm(page, `/e/${token}`);
      expect((await (await start2).json()).sessionId).toBeTruthy();

      await expect.poll(() => markerOf(estimateId), { timeout: 12_000 }).toBeTruthy();
      const marker = await markerOf(estimateId);
      expect(marker.count).toBe(1);
      expect(marker.lastDay).toBe(new Date().toISOString().slice(0, 10));
      expect(marker.smsProvider).toBe("log"); // recorded, not sent — Twilio unconfigured
      expect(marker.textedTo).toBe("+15550100001");

      // The email attempt landed in the dev outbox…
      const emailLog = fs.readFileSync(EMAIL_OUTBOX, "utf8");
      expect(emailLog).toContain("is reviewing estimate");
      // …and the text was recorded by the log provider.
      const smsLog = fs.readFileSync(SMS_OUTBOX, "utf8");
      expect(smsLog).toContain("is reviewing estimate");
      expect(smsLog).toContain("good time to call");

      // Once per estimate per day: a third session stays quiet.
      const start3 = page.waitForResponse((r) => r.url().includes("/api/public/engagement/start"));
      await gotoCrm(page, `/e/${token}`);
      await start3;
      await page.waitForTimeout(1500);
      expect((await markerOf(estimateId)).count).toBe(1);

      guards.assertClean("reengagement alert");
    } finally {
      await q(
        `update crm_members set phone = $2 where id = (select created_by_member_id from crm_estimates where id = $1)`,
        [estimateId, priorPhone]);
    }
  });
});
