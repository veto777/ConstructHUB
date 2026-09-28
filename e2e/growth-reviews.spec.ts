import { test, expect } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
const env = parseEnv(readFileSync(".env", "utf8"));
const url = process.env.DATABASE_URL || env.DATABASE_URL;
if (new URL(url).pathname !== "/constructhub_dev_a3") throw new Error("Wrong review test database");
const pool = new pg.Pool({ connectionString: url });
const tokens: string[] = [];
async function review() {
  const token = randomUUID(); tokens.push(token);
  await pool.query(`insert into review_requests(user_id,client_name,client_email,company_name,google_profile_url,token)
    values(1,'Audit customer','customer@example.invalid','Local test company','https://www.google.com/', $1)`, [token]);
  return token;
}
test.afterAll(async () => {
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
      await expect(page.getByTestId(rating < 9 ? "text-improvement-heading" : "text-referral-heading")).toBeVisible();
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
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByRole("button", { name: /unsubscribe/i })).toBeVisible();
    await page.getByRole("button", { name: /unsubscribe/i }).click();
    await page.getByTestId("button-submit-feedback-unsubscribe").click();
    await expect.poll(async () => (await (await request.get(`/api/review/${token}/unsubscribe-info`)).json()).unsubscribed).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
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
