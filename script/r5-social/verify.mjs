// Round-5 Social lane verification. Drives the lane dev server (port 8462, lane DB constructhub_dev_fs)
// and writes screenshots + a JSON verdict to /tmp/r5-social/.
//   node script/r5-social/verify.mjs
// Self-contained: inserts its own clearly-marked fixture posts, probes, then deletes them — the
// lane DB is shared with sibling lanes whose automation cancels queued/draft seed posts, so the
// script never depends on seeded draft/queued rows existing.
import { chromium } from "playwright";
import fs from "node:fs";
import pg from "pg";

const BASE = "http://localhost:8462";
const OUT = "/tmp/r5-social";
fs.mkdirSync(OUT, { recursive: true });
const verdict = {};
const FIX = "r5-social-verify";
const DB = new pg.Client({ connectionString: fs.readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length) });

const fixture = (id, state, businessId, text, accountId, platform, req) => ({
  id, state, businessId, text, accountId, platform, req,
  payload: JSON.stringify({ post: { target: { targetType: platform }, content: { text, platform, mediaUrls: [] }, accountId } }),
});

const DRAFT_SUMMIT = fixture(crypto.randomUUID(), "draft", 910001, "R5FIXDRAFT summit draft — edit me", "fs-b-fb", "facebook", `${FIX}-draft-summit`);
const DRAFT_CLEAR = fixture(crypto.randomUUID(), "draft", 92003, "R5FIXDRAFT clearpeak draft — edit me", "fs-b-ig", "instagram", `${FIX}-draft-clear`);
const Q_SUMMIT = fixture(crypto.randomUUID(), "queued", 910001, "R5FIXPOST queued summit", "fs-b-fb", "facebook", `${FIX}-q-summit`);
const Q_CLEAR = fixture(crypto.randomUUID(), "queued", 92003, "R5FIXPOST queued clearpeak", "fs-b-ig", "instagram", `${FIX}-q-clear`);

async function seedFixtures() {
  await DB.query("DELETE FROM social_posts WHERE request_id LIKE $1", [`${FIX}-%`]);
  for (const f of [DRAFT_SUMMIT, DRAFT_CLEAR, Q_SUMMIT, Q_CLEAR])
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

const fillComposer = async (page, marker) => {
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByLabel("Post text", { exact: true }).fill(marker);
  await page.getByLabel("Public media URLs", { exact: true }).fill("https://example.com/r5-fixture.jpg");
  await page.getByLabel("Schedule time", { exact: true }).fill("2030-10-05T10:00");
};

// Each check records into the verdict and never aborts the run — the script doubles as the
// before/after evidence (pre-fix it captures the losses; post-fix it must be all green).
const probe = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    verdict[name] = { ...(verdict[name] || {}), error: String(e?.message || e).slice(0, 300) };
  }
  fs.writeFileSync(`${OUT}/verdict.json`, JSON.stringify(verdict, null, 2));
};

try {
  // 1) Row edit + new composition survive leaving the page via "How it works" and browser Back.
  await probe("survivesHowItWorksAndBack", async () => {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=910001", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXDRAFT summit");
    const draft = page.getByLabel(/^Edit draft( for)?/);
    await draft.waitFor();
    const editMarker = `R5 ROW MARKER ${Date.now()}`;
    await draft.fill(editMarker);
    const composeMarker = `R5 COMPOSE MARKER ${Date.now()}`;
    await fillComposer(page, composeMarker);
    await page.screenshot({ path: `${OUT}/1a-before-leaving.png` });
    await page.getByRole("link", { name: "How it works", exact: true }).click();
    await page.waitForURL(/\/guides\?topic=social$/);
    await page.goBack();
    await page.waitForURL(/\/social-media\?business=910001/);
    await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXDRAFT summit");
    const draftAfter = await page.getByLabel(/^Edit draft( for)?/).inputValue().catch(() => null);
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    const textAfter = await page.getByLabel("Post text", { exact: true }).inputValue().catch(() => "");
    const mediaAfter = await page.getByLabel("Public media URLs", { exact: true }).inputValue().catch(() => "");
    const scheduleAfter = await page.getByLabel("Schedule time", { exact: true }).inputValue().catch(() => "");
    verdict.survivesHowItWorksAndBack = {
      rowEditKept: draftAfter === editMarker,
      textKept: textAfter === composeMarker,
      mediaKept: mediaAfter === "https://example.com/r5-fixture.jpg",
      scheduleKept: scheduleAfter === "2030-10-05T10:00",
      actual: { draftAfter, textAfter, mediaAfter, scheduleAfter },
    };
    await page.screenshot({ path: `${OUT}/1b-after-back.png` });
    await page.close();
  });

  // 2) A new composition survives switching business (per-business composer draft).
  await probe("composerSurvivesBusinessSwitch", async () => {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=910001", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    const composeMarker = `R5 BIZSWITCH MARKER ${Date.now()}`;
    await fillComposer(page, composeMarker);
    await page.getByRole("button", { name: "Change business / bulk actions", exact: true }).click();
    await page.getByRole("button", { name: /Clearpeak Exteriors/, exact: false }).first().click();
    await page.waitForURL(/business=92003/);
    await page.getByRole("button", { name: "Change business / bulk actions", exact: true }).click();
    await page.getByRole("button", { name: /Summit Roofing Co\./, exact: false }).first().click();
    await page.waitForURL(/business=910001/);
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    const textAfter = await page.getByLabel("Post text", { exact: true }).inputValue().catch(() => "");
    verdict.composerSurvivesBusinessSwitch = { kept: textAfter === composeMarker, actual: textAfter };
    await page.screenshot({ path: `${OUT}/2-business-switch.png` });
    await page.close();
  });

  // 3) All-clients calendar shows the saved-data strip + Retry on a failed background refresh.
  await probe("allClientsRefreshFailure", async () => {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByRole("heading", { name: /^All-clients calendar/ }).waitFor();
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXPOST");
    await page.waitForTimeout(400);
    await page.route("**/api/social/calendar**", (route) => route.abort());
    // The query refetches on its 15s interval; the failure must surface as a strip over saved data.
    const strip = page.getByTestId("strip-social-saved-data");
    await strip.waitFor({ timeout: 25000 });
    verdict.allClientsRefreshFailure = {
      stripShown: true,
      copy: (await strip.innerText()).replace(/\s+/g, " ").slice(0, 160),
      retryVisible: await strip.getByRole("button", { name: "Retry", exact: true }).isVisible(),
    };
    await page.screenshot({ path: `${OUT}/3a-strip.png` });
    await strip.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForTimeout(1200);
    verdict.allClientsRefreshFailure.retryWhileDownKeepsStrip = await strip.isVisible();
    await page.unroute("**/api/social/calendar**");
    await strip.getByRole("button", { name: "Retry", exact: true }).click();
    await strip.waitFor({ state: "hidden", timeout: 10000 });
    verdict.allClientsRefreshFailure.retryRecovers = true;
    await page.screenshot({ path: `${OUT}/3b-recovered.png` });
    await page.close();
  });

  // 4) Stale selection is pruned when a selected post leaves draft/queued on refetch.
  await probe("pruneOnRefetch", async () => {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXPOST queued summit");
    const checkbox = page.getByLabel(`Select post ${Q_SUMMIT.id}`);
    await checkbox.check();
    await page.getByText("1 selected", { exact: false }).first().waitFor();
    // Sibling lane / scheduler flips the post to published mid-view; on the next poll (15s) the
    // selection must prune itself — the checkbox is gone, so counting it would lie.
    await DB.query("UPDATE social_posts SET state='published' WHERE id=$1", [Q_SUMMIT.id]);
    await page.waitForFunction(() => document.body.innerText.includes("0 selected"), null, { timeout: 30000 });
    const count = await page.getByText(/selected \(up to 100 per action\)/).innerText();
    verdict.pruneOnRefetch = { countAfterTransition: count };
    await page.close();
  });

  // 5) Filtered-empty copy tells the truth; 6) unsaved gate names businesses + Discard all edits;
  //    7) unique aria-labels on draft textareas.
  await probe("filteredEmptyAndGateAndAria", async () => {
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("zzz-no-such-post-r5");
    const empty = page.getByTestId("text-social-posts-empty");
    try {
      await empty.filter({ hasText: "No posts match your search or filters." }).waitFor({ timeout: 8000 });
      verdict.filteredEmptyCopy = true;
    } catch {
      verdict.filteredEmptyCopy = false;
    }
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXDRAFT");
    await page.waitForTimeout(400);
    const labels = await page.getByLabel(/^Edit draft( for)?/).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    verdict.ariaLabels = { labels, unique: new Set(labels).size === labels.length && labels.length >= 2 };
    // Edit both drafts, select both, expect the gate to name both businesses.
    const editA = page.getByTestId(`card-post-${DRAFT_SUMMIT.id}`).getByLabel(/^Edit draft( for)?/);
    const editB = page.getByTestId(`card-post-${DRAFT_CLEAR.id}`).getByLabel(/^Edit draft( for)?/);
    await editA.fill("R5 gate edit summit");
    await editB.fill("R5 gate edit clearpeak");
    await page.getByLabel(`Select post ${DRAFT_SUMMIT.id}`).check();
    await page.getByLabel(`Select post ${DRAFT_CLEAR.id}`).check();
    const gate = page.getByTestId("text-social-unsaved-edits");
    await gate.waitFor();
    const gateText = (await gate.innerText()).replace(/\s+/g, " ");
    const discardAll = page.getByRole("button", { name: "Discard all edits", exact: true });
    verdict.unsavedGate = {
      namesSummit: gateText.includes(await businessName(910001)),
      namesClearpeak: gateText.includes(await businessName(92003)),
      discardAllVisible: await discardAll.isVisible(),
      gateText: gateText.slice(0, 240),
    };
    await page.screenshot({ path: `${OUT}/5-unsaved-gate.png`, fullPage: false });
    await discardAll.click();
    await page.waitForTimeout(500);
    verdict.unsavedGate.afterDiscard = {
      summitBackToSaved: (await editA.inputValue()) === DRAFT_SUMMIT.text,
      clearpeakBackToSaved: (await editB.inputValue()) === DRAFT_CLEAR.text,
    };
    await page.close();
  });

  // 7b) Partial bulk failure keeps the failed ids selected (published post 409s on cancel).
  await probe("partialBulkFailure", async () => {
    await DB.query("UPDATE social_posts SET state='queued' WHERE id=ANY($1)", [[Q_SUMMIT.id, Q_CLEAR.id]]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXPOST");
    await page.waitForTimeout(400);
    await page.getByLabel(`Select post ${Q_SUMMIT.id}`).check();
    await page.getByLabel(`Select post ${Q_CLEAR.id}`).check();
    await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
    await page.getByTestId("dialog-bulk-cancel-posts").waitFor();
    // Summit's post "goes published" after the dialog opens but before the bulk lands
    // (sibling worker / scheduler race) — cancel then 409s on it while Clearpeak cancels fine.
    await DB.query("UPDATE social_posts SET state='published' WHERE id=$1", [Q_SUMMIT.id]);
    await page.getByTestId("button-bulk-cancel-confirm").click();
    await page.waitForTimeout(1500);
    const count = await page.getByText(/selected \(up to 100 per action\)/).innerText();
    const errorLines = await page.getByRole("alert").allInnerTexts();
    const stillChecked = await page.getByLabel(`Select post ${Q_SUMMIT.id}`).isVisible().catch(() => false);
    const clearState = (await DB.query("SELECT state FROM social_posts WHERE id=$1", [Q_CLEAR.id])).rows[0].state;
    verdict.partialBulkFailure = {
      remainingSelection: count,
      errorShown: errorLines.some((t) => /finalized|submitted/i.test(t)),
      failedIdKeptSelected: /1 selected/.test(count),
      checkboxVisibleForFailed: stillChecked,
      clearpeakCancelled: clearState === "cancelled",
    };
    await page.screenshot({ path: `${OUT}/6-partial-bulk.png` });
    await page.close();
  });

  // 8) Phone width: the new strip and gate render without horizontal overflow.
  await probe("phoneGate", async () => {
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phoneCtx.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
    await phoneCtx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
    await phoneCtx.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {} });
    const page = await phoneCtx.newPage();
    await page.goto(BASE + "/social-media?business=all", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE });
    await page.getByLabel("Search calendar", { exact: true }).fill("R5FIXDRAFT");
    await page.waitForTimeout(400);
    const editA = page.getByTestId(`card-post-${DRAFT_SUMMIT.id}`).getByLabel(/^Edit draft( for)?/);
    await editA.fill("R5 phone edit");
    await page.getByLabel(`Select post ${DRAFT_SUMMIT.id}`).check();
    const gate = page.getByTestId("text-social-unsaved-edits");
    await gate.waitFor();
    verdict.phone = {
      gateFits: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    };
    await page.screenshot({ path: `${OUT}/7-phone-gate.png` });
    await phoneCtx.close();
  });
} finally {
  await clearFixtures();
  await DB.end();
}

async function businessName(id) {
  const { rows } = await DB.query("SELECT business_name FROM business_locations WHERE id=$1", [id]);
  return rows[0].business_name;
}

fs.writeFileSync(`${OUT}/verdict.json`, JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
await browser.close();
