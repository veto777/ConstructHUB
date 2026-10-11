// Round-4 Social lane verification. Drives the lane dev server (port 8458, lane DB sample data)
// and writes screenshots + a JSON verdict to /tmp/r4-social/.
//   node script/r4-social/verify.mjs
// Self-contained: inserts its own clearly-marked fixture posts, probes, then deletes them — the
// lane DB is shared with sibling lanes whose automation cancels queued/draft seed posts, so the
// script never depends on seeded draft/queued rows existing.
import { chromium } from "playwright";
import fs from "node:fs";
import pg from "pg";

const BASE = "http://localhost:8458";
const OUT = "/tmp/r4-social";
fs.mkdirSync(OUT, { recursive: true });
const verdict = {};
const FIX = "r4-social-verify";
const DB = new pg.Client({ connectionString: fs.readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length) });

const fixture = (id, state, businessId, text, accountId, platform, req) => ({
  id, state, businessId, text, accountId, platform, req,
  payload: JSON.stringify({ post: { target: { targetType: platform }, content: { text, platform, mediaUrls: [] }, accountId } }),
});

const DRAFT = fixture(crypto.randomUUID(), "draft", 910001, "R4FIXDRAFT fixture draft — edit me", "fs-b-fb", "facebook", `${FIX}-draft`);
const Q1 = fixture(crypto.randomUUID(), "queued", 92003, "R4FIXPOST queued fixture one", "fs-b-ig", "instagram", `${FIX}-q1`);
const Q2 = fixture(crypto.randomUUID(), "queued", 92003, "R4FIXPOST queued fixture two", "fs-b-ig", "instagram", `${FIX}-q2`);
const Q3 = fixture(crypto.randomUUID(), "queued", 910001, "R4FIXPOST queued fixture three", "fs-b-fb", "facebook", `${FIX}-q3`);

async function seedFixtures() {
  await DB.query("DELETE FROM social_posts WHERE request_id LIKE $1", [`${FIX}-%`]);
  for (const f of [DRAFT, Q1, Q2, Q3])
    await DB.query(
      "INSERT INTO social_posts(id,user_id,request_id,destination_key,payload,state,due_at,scheduled_at,ai_generated,auto_generated,created_at,updated_at,notified_at,business_id) VALUES($1,1,$2,$3,$4,$5,now()+interval '2 days',now()+interval '2 days',false,false,now(),now(),now(),$6)",
      [f.id, f.req, `${f.accountId}::`, f.payload, f.state, f.businessId],
    );
}
const clearFixtures = () => DB.query("DELETE FROM social_posts WHERE request_id LIKE $1", [`${FIX}-%`]);

await DB.connect();
await seedFixtures();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
await ctx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
await ctx.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {} });
const HIDE = `[data-testid="hub-launcher"], [data-testid="hub-welcome-bubble"], [data-testid="button-open-chat"], [data-testid="cookie-consent-banner"] { display: none !important; }
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }`;

try {
  // A) Draft text survives status-filter, tab and business-switch round trips (fixture draft).
  {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=910001", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
    await page.getByLabel("Search calendar", { exact: true }).fill("R4FIXDRAFT");
    const draft = page.getByLabel("Edit draft", { exact: true });
    await draft.waitFor();
    const marker = `R4 SOCIAL DRAFT MARKER ${Date.now()}`;
    await draft.fill(marker);
    await page.screenshot({ path: `${OUT}/A1-draft-edited.png` });
    await page.getByLabel("Post status filter", { exact: true }).selectOption("published");
    await page.waitForTimeout(400);
    await page.getByLabel("Post status filter", { exact: true }).selectOption("");
    await page.waitForTimeout(700);
    const afterFilter = await page.getByLabel("Edit draft", { exact: true }).inputValue().catch(() => null);
    const markerTab = `R4 TAB MARKER ${Date.now()}`;
    await page.getByLabel("Edit draft", { exact: true }).fill(markerTab);
    await page.getByRole("button", { name: "Auto mode", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
    await page.waitForTimeout(700);
    const afterTab = await page.getByLabel("Edit draft", { exact: true }).inputValue().catch(() => null);
    const markerBiz = `R4 BIZ MARKER ${Date.now()}`;
    await page.getByLabel("Edit draft", { exact: true }).fill(markerBiz);
    await page.getByRole("button", { name: "Change business / bulk actions", exact: true }).click();
    await page.getByRole("button", { name: /Clearpeak Exteriors/, exact: false }).first().click();
    await page.waitForURL(/business=92003/);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Change business / bulk actions", exact: true }).click();
    await page.getByRole("button", { name: /Summit Roofing Co\./, exact: false }).first().click();
    await page.waitForURL(/business=910001/);
    await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
    await page.getByLabel("Search calendar", { exact: true }).fill("R4FIXDRAFT");
    await page.waitForTimeout(700);
    const afterBiz = await page.getByLabel("Edit draft", { exact: true }).inputValue().catch(() => null);
    verdict.draftSurvival = {
      filterRoundTrip: { kept: afterFilter === marker },
      tabRoundTrip: { kept: afterTab === markerTab },
      businessSwitch: { kept: afterBiz === markerBiz },
    };
    await page.screenshot({ path: `${OUT}/A2-draft-survives.png` });
    await page.close();
  }

  // B) "How it works" opens /guides?topic=social in every mode (all-clients too).
  {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByRole("heading", { name: /^All-clients calendar/ }).waitFor();
    const how = page.getByRole("link", { name: "How it works", exact: true });
    verdict.howItWorks = { href: await how.getAttribute("href") };
    await how.click();
    await page.waitForURL(/\/guides/, { timeout: 15000 });
    await page.getByRole("region", { name: "Guides walkthroughs" }).waitFor();
    verdict.howItWorks.landsOnGuides = true;
    verdict.howItWorks.topicPreselected = await page.getByTestId("chip-topic-social").getAttribute("aria-pressed").catch(() => null);
    await page.screenshot({ path: `${OUT}/B1-how-it-works.png` });
    await page.close();
  }

  // C-phone) Same dialog at 390px first (Keep only — no mutation), then the desktop flow confirms.
  {
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phoneCtx.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
    await phoneCtx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
    await phoneCtx.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {} });
    const page = await phoneCtx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("R4FIXPOST");
    await page.getByRole("button", { name: "Select this page of posts", exact: true }).click();
    await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
    const dialog = page.locator("[role=alertdialog]");
    await dialog.waitFor();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    verdict.bulkCancelPhone = {
      dialogFits: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    };
    await page.screenshot({ path: `${OUT}/C2-bulk-cancel-phone.png` });
    await phoneCtx.close();
  }

  // C) Bulk cancel: AlertDialog naming the count and the businesses; Keep sends nothing; Confirm cancels.
  {
    const page = await ctx.newPage();
    let bulkRequests = 0;
    await page.route("**/api/social/posts/bulk-action**", async (route) => { bulkRequests++; await route.continue(); });
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("R4FIXPOST");
    await page.getByRole("button", { name: "Select this page of posts", exact: true }).click();
    await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
    const dialog = page.locator("[role=alertdialog]");
    await dialog.waitFor();
    const dialogText = await dialog.innerText();
    verdict.bulkCancel = {
      dialogText: dialogText.slice(0, 400),
      namesCount: /Cancel 3 selected posts\?/.test(dialogText),
      namesBusinesses: /Clearpeak Exteriors \(2\)/.test(dialogText) && /Summit Roofing Co\. \(1\)/.test(dialogText),
    };
    await page.screenshot({ path: `${OUT}/C1-bulk-cancel-dialog.png` });
    await dialog.getByRole("button", { name: "Keep them" }).click();
    await page.waitForTimeout(800);
    verdict.bulkCancel.keepSentNoRequest = bulkRequests === 0;
    // Confirm path actually cancels the fixtures.
    await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
    await dialog.waitFor();
    await dialog.getByTestId("button-bulk-cancel-confirm").click();
    await page.waitForTimeout(1200);
    verdict.bulkCancel.confirmFiredRequest = bulkRequests === 1;
    const states = await DB.query("SELECT state,count(*) n FROM social_posts WHERE request_id LIKE $1 GROUP BY state", [`${FIX}-q%`]);
    verdict.bulkCancel.fixtureStatesAfterConfirm = states.rows;
    await page.close();
  }

  // D) Zero-match business search says so; only a truly empty account says "No businesses yet".
  {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search businesses", { exact: true }).fill("zzz-no-such-business-r4");
    await page.waitForTimeout(800);
    verdict.emptyState = {
      accountHasBusinesses: true,
      showsNoMatch: await page.getByTestId("text-no-business-match").isVisible().catch(() => false),
      showsNoBusinessesYet: await page.getByTestId("empty-social-businesses").isVisible().catch(() => false),
    };
    await page.screenshot({ path: `${OUT}/D1-empty-search.png` });
    await page.close();
  }
} finally {
  await clearFixtures();
  await DB.end();
}

fs.writeFileSync(`${OUT}/verdict.json`, JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
await browser.close();
