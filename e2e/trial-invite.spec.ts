/**
 * The trial invite link (/invite/<code>): owner, 2026-10-02 — "you aren't emailing someone else a code. You are
 * emailing them an invite or the system creates a code that can be redeemed".
 *   INVITE_SIGNED_IN_URL   a dev server with DEV_AUTH_BYPASS_USER1=true  (default http://127.0.0.1:8199)
 *   INVITE_SIGNED_OUT_URL  a dev server with the bypass off             (default http://127.0.0.1:8198)
 */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { q } from "./db";

const SIGNED_IN = process.env.INVITE_SIGNED_IN_URL || "http://127.0.0.1:8199";
const SIGNED_OUT = process.env.INVITE_SIGNED_OUT_URL || "http://127.0.0.1:8198";
const CODE = `TRIAL-E2E${randomUUID().slice(0, 6).toUpperCase()}`;

test.beforeAll(async () => {
  await q(`INSERT INTO beta_access_codes (code, created_by_user_id, expires_at, trial_days, recipient_email, recipient_name, revoked)
           VALUES ($1, 1, now() + interval '30 days', 30, 'invitee@example.com', 'Invitee', false)`, [CODE]);
});
test.afterAll(async () => { await q(`DELETE FROM beta_access_codes WHERE code = $1`, [CODE]); });

test("signed out: the invite explains itself and both buttons come back to the invite", async ({ page }) => {
  await page.goto(`${SIGNED_OUT}/invite/${CODE}`);
  await expect(page.getByTestId("text-invite-title")).toHaveText("You're invited to ConstructHUB");
  await expect(page.getByTestId("header-public-page")).toBeVisible();
  const back = encodeURIComponent(`/invite/${CODE}`);
  await expect(page.getByTestId("button-invite-signup")).toHaveAttribute("href", `/auth?mode=signup&next=${back}`);
  await expect(page.getByTestId("button-invite-signin")).toHaveAttribute("href", `/auth?next=${back}`);
  await page.getByTestId("button-invite-signin").click();
  await expect(page).toHaveURL(new RegExp(`/auth\\?next=${back.replace(/%/g, "%")}`));
});

test("signed in: one click on the account shown, never silently", async ({ page }) => {
  await page.goto(`${SIGNED_IN}/invite/${CODE}`);
  await expect(page.getByTestId("text-invite-title")).toHaveText("Accept your free trial");
  await expect(page.getByTestId("text-invite-account")).toContainText("@");
  await expect(page.getByTestId("button-invite-accept")).toBeEnabled();
  const [row] = await q<{ redeemed_by_user_id: number | null }>(`SELECT redeemed_by_user_id FROM beta_access_codes WHERE code = $1`, [CODE]);
  expect(row.redeemed_by_user_id).toBeNull();
});

test("a broken link says so", async ({ page }) => {
  await page.goto(`${SIGNED_OUT}/invite/%20`);
  await expect(page.getByTestId("card-invite")).toBeVisible();
});
