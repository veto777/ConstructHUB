import { test, expect } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHmac, randomUUID } from "node:crypto";
const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(databaseUrl).pathname)) throw new Error("Wrong growth test database");
const pool = new pg.Pool({ connectionString: databaseUrl });
let userId: number, cookie: string, sid: string;
const tokens: string[] = [];
let queryId: number;
test.beforeAll(async () => {
  const { rows: [user] } = await pool.query("insert into users(email,display_name,email_verified) values($1,'Round 2 Browser',true) returning id", [`${randomUUID()}@example.invalid`]);
  userId = user.id; sid = randomUUID();
  await pool.query("insert into subscriptions(user_id,plan,status) values($1,'gold','active')", [userId]);
  await pool.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: userId } })]);
  const sig = createHmac("sha256", env.SESSION_SECRET).update(sid).digest("base64").replace(/=+$/, "");
  cookie = encodeURIComponent(`s:${sid}.${sig}`);
  const { rows: [q] } = await pool.query("insert into search_queries(user_id,search_type,search_value) values($1,'address','Owned browser fixture') returning id", [userId]); queryId=q.id;
});
test.afterAll(async () => {
  await pool.query("delete from competitor_listings where user_id=$1", [userId]);
  await pool.query("delete from competitor_scans where user_id=$1", [userId]);
  await pool.query("delete from review_requests where user_id=$1", [userId]);
  await pool.query("delete from review_referral_settings where user_id=$1", [userId]);
  await pool.query("delete from search_queries where user_id=$1", [userId]);
  await pool.query("delete from subscriptions where user_id=$1", [userId]);
  await pool.query("delete from session where sid=$1", [sid]);
  await pool.query("delete from users where id=$1", [userId]);
  await pool.end();
});
async function signedIn(context: any) {
  await context.addCookies([{ name: "connect.sid", value: cookie, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
test("owner history and Gold competitor UI show real provider failure", async ({ page, context, request }) => {
  await signedIn(context);
  await page.goto("/history");
  await expect(page.getByTestId(`card-query-${queryId}`)).toContainText("Owned browser fixture");
  await expect(page.locator('[data-testid^="card-query-"]')).toHaveCount(1);
  await page.goto("/schedules");
  await expect(page.getByRole("alert")).toContainText("Administrator access is required");
  await expect(page.getByTestId("button-add-schedule")).toHaveCount(0);
  await page.goto("/competitors");
  await expect(page.getByTestId("button-start-scan")).toBeVisible();
  await expect(page.getByTestId("tab-ad-spy")).toHaveCount(0);
  await page.getByTestId("select-industry").click();
  await page.getByRole("option", { name: "Roofing Contractor", exact: true }).click();
  await page.getByTestId("input-location").fill("Seattle, WA");
  const created = page.waitForResponse(r => r.url().endsWith("/api/competitors/scans") && r.request().method() === "POST");
  await page.getByTestId("button-start-scan").click();
  const scan = await (await created).json();
  // Provider key deliberately absent; running scans poll their persisted state.
  await expect(page.getByTestId(`card-scan-${scan.id}`)).toContainText("Google Places is not configured");
  expect((await request.get("/api/ad-spy/keywords")).status()).toBe(410);
});
test("contractor enables a custom referral offer; disabling hides both cards", async ({ page, context, browser }) => {
  await signedIn(context);
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Show my referral offer" });
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("Offer and terms").fill("Fixture offer: a project credit for a referred customer, unrelated to reviews.");
  await toggle.click();
  await page.getByRole("button", { name: "Save referral settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Referral settings saved");
  const token = randomUUID(); tokens.push(token);
  await pool.query("insert into review_requests(user_id,client_name,client_email,company_name,google_profile_url,token) values($1,'Browser customer','browser@example.invalid','Fixture contractor','https://www.google.com/',$2)", [userId, token]);
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  await cp.goto(`http://127.0.0.1:${process.env.E2E_PORT ?? "8149"}/review/${token}`);
  await cp.getByTestId("button-rating-10").click(); await cp.getByTestId("button-submit-rating").click();
  await expect(cp.getByTestId("text-referral-heading")).toBeVisible();
  await expect(cp.getByText(/Fixture offer:/)).toBeVisible();
  await toggle.click(); await page.getByRole("button", { name: "Save referral settings", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  // A submitted rating resumes where it left off on reload, so use a fresh request link.
  const token2 = randomUUID(); tokens.push(token2);
  await pool.query("insert into review_requests(user_id,client_name,client_email,company_name,google_profile_url,token) values($1,'Browser customer','browser2@example.invalid','Fixture contractor','https://www.google.com/',$2)", [userId, token2]);
  await cp.goto(`http://127.0.0.1:${process.env.E2E_PORT ?? "8149"}/review/${token2}`);
  await cp.getByTestId("button-rating-10").click(); await cp.getByTestId("button-submit-rating").click();
  await expect(cp.getByTestId("input-review-highlights")).toBeVisible();
  await expect(cp.getByTestId("text-referral-heading")).toHaveCount(0);
  await customer.close();
});
test("Google link click records only an open without contacting Google", async ({ page }) => {
  const token = randomUUID(); tokens.push(token);
  await pool.query("insert into review_requests(user_id,client_name,client_email,google_profile_url,token) values($1,'Browser customer','browser@example.invalid','https://www.google.com/',$2)", [userId, token]);
  await page.context().route("https://www.google.com/**", r => r.abort());
  await page.goto(`/review/${token}`);
  await page.getByTestId("link-google-review-always").click();
  await expect.poll(async () => (await pool.query("select google_link_opened from review_requests where token=$1", [token])).rows[0].google_link_opened).toBe(true);
  expect((await pool.query("select review_submitted,status from review_requests where token=$1", [token])).rows[0]).toEqual({ review_submitted: false, status: "sent" });
});

test("BS Meter shows sample size and neutral heuristic context for legacy rows", async ({ page, context }) => {
  await signedIn(context);
  const { rows: [scan] } = await pool.query("insert into competitor_scans(user_id,industry,location,status) values($1,'Fixture','Fixture market','completed') returning id", [userId]);
  const analysis = { totalAnalyzed: 5, goodReviews: 5, badReviews: 0, reviewsLookingAi: 1, reviewsGeneric: 2, reviewsWithPhotos: 0, reviewsWithRealNames: 0, blockedProfiles: 0, reviewVelocityFlag: true, reviewVelocityNote: "legacy accusation", reviews: [] };
  const { rows: [listing] } = await pool.query("insert into competitor_listings(scan_id,user_id,place_id,business_name,address,rating,review_count,bs_score,bs_reasons,review_analysis) values($1,$2,'fixture','Fixture listing','Fixture street','5',500,99,$3,$4) returning id", [scan.id, userId, JSON.stringify(["likely hired reviewers"]), JSON.stringify(analysis)]);
  await page.goto("/competitors");
  await page.getByTestId(`card-scan-${scan.id}`).click();
  await page.getByTestId(`button-review-analysis-${listing.id}`).click();
  await expect(page.getByText(/5 reviews sampled/)).toBeVisible();
  await expect(page.getByText(/Scores are not probabilities/)).toBeVisible();
  await expect(page.getByText("likely hired reviewers")).toHaveCount(0);
  await expect(page.getByText("legacy accusation")).toHaveCount(0);
});
