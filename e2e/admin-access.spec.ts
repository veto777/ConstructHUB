import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { q } from "./db";

/**
 * /admin/access: a platform admin finds an account, grants it Pro for 30 days,
 * sees it under Active grants, revokes it and sees it under Recently ended —
 * at 1440 and 390. Plus Settings → Admin: Trial Management making a 1000-day
 * code. See playwright.admin-access.config.ts for the env. (The admin second
 * factor is the identity check apiRequest already asks for; the server tests
 * pin the 403 reauth answer.)
 */
const BASE = process.env.AA_BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT ?? "8502"}`;
const SHOTS = process.env.AA_SCREENSHOT_DIR;
const startedAt = new Date();

const fixtures: number[] = [];
async function fixtureAccount(): Promise<{ id: number; email: string }> {
  const email = `aa-${randomUUID().slice(0, 8)}@example.invalid`;
  const [u] = await q<{ id: number }>("insert into users(email, display_name, company_name, email_verified) values($1, 'Dennis Fixture', 'Fixture Roofing LLC', true) returning id", [email]);
  fixtures.push(u.id);
  return { id: u.id, email };
}

test.afterAll(async () => {
  if (fixtures.length) {
    await q("delete from admin_audit_log where target_account_name in (select email from users where id = any($1::int[]))", [fixtures]);
    await q("delete from email_log where user_id = any($1::int[])", [fixtures]);
    await q("delete from admin_access_grants where user_id = any($1::int[])", [fixtures]);
    await q("delete from subscriptions where user_id = any($1::int[])", [fixtures]);
    await q("delete from account_activity where user_id = any($1::int[])", [fixtures]);
    await q("delete from users where id = any($1::int[])", [fixtures]);
  }
  await q("delete from beta_access_codes where created_by_user_id = 1 and trial_days = 1000 and created_at >= $1", [startedAt]);
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function shot(page: Page, name: string, height = 2200) {
  if (!SHOTS) return;
  const { width } = page.viewportSize()!;
  // The app frame scrolls inside <main>: a tall viewport shows the whole page.
  await page.setViewportSize({ width, height });
  await page.addStyleTag({ content: "[data-testid=cookie-consent-banner],[data-testid=hub-launcher]{display:none!important}" });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function openAccessPage(page: Page) {
  await page.goto(`${BASE}/admin/access`);
  await expect(page.getByTestId("page-admin-access")).toBeVisible({ timeout: 60_000 });
}

async function findAccount(page: Page, account: { id: number; email: string }) {
  await page.getByTestId("input-access-search").fill(account.email);
  await expect(page.getByTestId(`row-account-${account.id}`)).toBeVisible();
  await expect(page.getByTestId("list-access-accounts").locator("> li")).toHaveCount(1);
  await expect(page.getByTestId(`badge-access-source-${account.id}`)).toHaveText("No plan");
}

test("grant 30 days, see it active, revoke it, see it ended (1440)", async ({ page }) => {
  const errors = watchErrors(page);
  const account = await fixtureAccount();
  await openAccessPage(page);
  const nav = page.getByTestId("link-nav-admin-access");
  await expect(nav).toHaveAttribute("href", "/admin/access");
  await expect(nav).toContainText("Access grants");
  await expect(nav).toContainText("ADMIN");

  await findAccount(page, account);
  await page.getByTestId(`button-open-grant-${account.id}`).click();
  await page.getByTestId(`select-grant-plan-${account.id}`).click();
  await page.getByTestId("option-grant-plan-pro").click();
  await page.getByTestId(`button-grant-days-30-${account.id}`).click();
  await expect(page.getByTestId(`input-grant-days-${account.id}`)).toHaveValue("30");
  await expect(page.getByTestId(`text-grant-ends-${account.id}`)).toContainText("30 days from now");
  // The bounds: 0 and 1001 are refused before anything is sent.
  await page.getByTestId(`input-grant-days-${account.id}`).fill("1001");
  await expect(page.getByTestId(`button-grant-${account.id}`)).toBeDisabled();
  await page.getByTestId(`input-grant-days-${account.id}`).fill("0");
  await expect(page.getByTestId(`button-grant-${account.id}`)).toBeDisabled();
  await page.getByTestId(`button-grant-days-30-${account.id}`).click();
  await page.getByTestId(`input-grant-note-${account.id}`).fill("GBP import help");
  await shot(page, "admin-access-1440-form", 1300);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByTestId(`button-grant-${account.id}`).click();
  const confirm = page.getByTestId("dialog-confirm-grant");
  await expect(confirm).toContainText(`Give ${account.email} Pro access?`);
  await confirm.getByTestId("button-confirm-grant").click();
  await expect(page.getByText(`Pro access granted to ${account.email}`)).toBeVisible();

  const [grant] = await q<{ id: number }>("select id from admin_access_grants where user_id = $1", [account.id]);
  const row = page.getByTestId(`row-active-grant-${grant.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(account.email);
  await expect(row).toContainText("Pro");
  await expect(row).toContainText("GBP import help");
  await expect(page.getByTestId(`text-grant-days-left-${grant.id}`)).toHaveText("30");
  await expect(page.getByTestId(`badge-access-source-${account.id}`)).toHaveText("Granted");
  const [sub] = await q("select plan, status, stripe_subscription_id from subscriptions where user_id = $1", [account.id]);
  expect(sub).toEqual({ plan: "pro", status: "active", stripe_subscription_id: null });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "admin-access-1440");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByTestId(`button-revoke-grant-${grant.id}`).click();
  const revoke = page.getByTestId("dialog-confirm-revoke");
  await expect(revoke).toContainText(`Revoke ${account.email}'s Pro access?`);
  await revoke.getByTestId("button-confirm-revoke").click();
  await expect(page.getByText(`Pro access for ${account.email} has ended.`)).toBeVisible();
  await expect(revoke).toBeHidden();
  await expect(page.getByTestId(`row-active-grant-${grant.id}`)).toHaveCount(0);
  const ended = page.getByTestId(`row-ended-grant-${grant.id}`);
  await expect(ended).toBeVisible();
  await expect(ended).toHaveAttribute("data-status", "revoked");
  await expect(page.getByTestId(`badge-ended-status-${grant.id}`)).toHaveText("Revoked");
  await expect(page.getByTestId(`badge-access-source-${account.id}`)).toHaveText("No plan");
  const [after] = await q("select status from subscriptions where user_id = $1", [account.id]);
  expect(after.status).toBe("canceled");
  await shot(page, "admin-access-1440-ended");
  expect(errors).toEqual([]);
});

test("phone width: search, the grant form and the lists fit (390)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const account = await fixtureAccount();
  // One active grant so the list shows a row at this width too.
  const other = await fixtureAccount();
  await openAccessPage(page);
  await findAccount(page, other);
  await page.getByTestId(`button-open-grant-${other.id}`).click();
  await page.getByTestId(`button-grant-days-90-${other.id}`).click();
  await page.getByTestId(`button-grant-${other.id}`).click();
  await page.getByTestId("button-confirm-grant").click();
  await expect(page.getByText(`Starter access granted to ${other.email}`)).toBeVisible();

  await findAccount(page, account);
  await page.getByTestId(`button-open-grant-${account.id}`).click();
  await page.getByTestId(`button-grant-days-365-${account.id}`).click();
  await expect(page.getByTestId(`text-grant-ends-${account.id}`)).toContainText("365 days from now");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "admin-access-390-form", 1500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId(`button-open-grant-${account.id}`).click();
  const [g] = await q<{ id: number }>("select id from admin_access_grants where user_id = $1", [other.id]);
  await expect(page.getByTestId(`row-active-grant-${g.id}`)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "admin-access-390", 2400);
  expect(errors).toEqual([]);
});

test("Settings trial codes: 1–1000 days", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${BASE}/settings`);
  const card = page.getByTestId("card-admin-beta");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("button-toggle-create-trial").click();
  await page.getByTestId("input-trial-days").fill("1001");
  await expect(page.getByTestId("button-generate-trial")).toBeDisabled();
  await page.getByTestId("button-trial-days-1000").click();
  await expect(page.getByTestId("text-trial-days")).toHaveText("1,000 days");
  await expect(page.getByTestId("button-generate-trial")).toHaveText("Create 1,000-Day Trial");
  await page.getByTestId("button-generate-trial").click();
  await expect(page.getByText(/Trial Code Created/).first()).toBeVisible();
  const [code] = await q<{ id: number; trial_days: number }>(
    "select id, trial_days from beta_access_codes where created_by_user_id = 1 and created_at >= $1 order by id desc limit 1", [startedAt]);
  expect(code.trial_days).toBe(1000);
  const row = page.getByTestId(`row-beta-code-${code.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("1000d");
  await expect(page.getByTestId("text-trial-codes-gate")).toHaveCount(0);
  await shot(page, "settings-trial-codes-1440", 1800);
  expect(errors).toEqual([]);
});
