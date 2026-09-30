import { test, expect } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
const env = parseEnv(readFileSync(".env", "utf8"));
const url = process.env.DATABASE_URL || env.DATABASE_URL;
if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(url).pathname)) throw new Error("Wrong review test database");
const pool = new pg.Pool({ connectionString: url });
const tokens: string[] = [];
async function review() {
  const token = randomUUID(); tokens.push(token);
  await pool.query(`insert into review_requests(user_id,client_name,client_email,company_name,google_profile_url,token)
    values(1,'Audit customer',$2,'Local test company','https://www.google.com/', $1)`, [token, `${token}@example.invalid`]);
  return token;
}
// The rating flow for 9-10 depends on the dev user's referral offer; run with it off and restore it after.
let savedReferral: { enabled: boolean; offer: string } | undefined;
test.beforeAll(async () => {
  savedReferral = (await pool.query("select enabled, offer from review_referral_settings where user_id=1")).rows[0];
  if (savedReferral) await pool.query("update review_referral_settings set enabled=false where user_id=1");
});
test.afterAll(async () => {
  if (savedReferral) await pool.query("update review_referral_settings set enabled=$1 where user_id=1", [savedReferral.enabled]);
  await pool.query("delete from review_recipient_preferences where user_id=1 and email=any($1::text[])", [tokens.map(t => `${t}@example.invalid`)]);
  await pool.query("delete from review_requests where token = any($1::text[])", [tokens]);
  await pool.end();
});
for (const width of [1440, 375]) {
  for (let rating = 1; rating <= 10; rating++) {
    test(`anonymous rating ${rating} has Google option at ${width}px`, async ({ page, request }) => {
      expect(await (await request.get("/api/auth/me")).json()).toBeNull();
      await page.setViewportSize({ width, height: 900 });
      const token = await review();
      await page.goto(`/review/${token}`);
      const google = page.getByTestId("link-google-review-always");
      await expect(google).toBeVisible();
      await expect(google).toHaveAttribute("href", "https://www.google.com/");
      await page.getByTestId(`button-rating-${rating}`).click();
      await page.getByTestId("button-submit-rating").click();
      if (rating < 9) await expect(page.getByTestId("text-improvement-heading")).toBeVisible();
      else { await expect(page.getByTestId("input-review-highlights")).toBeVisible(); await expect(page.getByTestId("text-referral-heading")).toHaveCount(0); }
      await expect(google).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (rating < 9) {
        await page.getByTestId("button-improvement-draft").click();
        await expect(page.getByTestId("input-review-highlights")).toBeVisible();
        await expect(google).toBeVisible();
      }
      if (rating === 1) await page.screenshot({ path: `test-results/review-anonymous-${width}.png`, fullPage: true });
    });
  }
  test(`anonymous unsubscribe at ${width}px`, async ({ page, request }) => {
    const token = await review();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/review/${token}/unsubscribe`);
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();
    await expect(page.getByTestId("button-submit-feedback-unsubscribe")).toBeVisible();
    await page.getByTestId("button-submit-feedback-unsubscribe").click();
    await expect(page.getByTestId("text-unsubscribed")).toBeVisible();
    await expect.poll(async () => (await (await request.get(`/api/review/${token}/unsubscribe-info`)).json()).unsubscribed).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test("RFC 8058 one-click unsubscribe POST", async ({ request }) => {
  const token = await review();
  const res = await request.post(`/review/${token}/unsubscribe`, { form: { "List-Unsubscribe": "One-Click" } });
  expect(res.status()).toBe(200);
  expect((await (await request.get(`/api/review/${token}/unsubscribe-info`)).json()).unsubscribed).toBe(true);
  expect((await request.post(`/review/${randomUUID()}/unsubscribe`, { form: { "List-Unsubscribe": "One-Click" } })).status()).toBe(404);
});
test("failed feedback stays on the rating form", async ({ page }) => {
  const token = await review();
  await page.route(`**/api/review/${token}/feedback`, route => route.fulfill({ status: 500, json: { message: "Test failure" } }));
  await page.goto(`/review/${token}`);
  await page.getByTestId("button-rating-1").click();
  await page.getByTestId("button-submit-rating").click();
  await expect(page.getByRole("alert")).toContainText("Please try again");
  await expect(page.getByTestId("text-rating-heading")).toBeVisible();
  await expect(page.getByTestId("link-google-review-always")).toBeVisible();
});
