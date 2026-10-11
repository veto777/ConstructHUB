// Round-5 sitecx lane verification: drives the lane dev server (sample data only,
// user 1 = "Sam Rivera" / "Summit Roofing Co." via DEV_AUTH_BYPASS_USER1) and proves
// the five r5 fixes live, at 390px where the acceptance asks for it.
//   node script/r5-sitecx/verify.mjs [baseURL]
// Never point this at anything but a local lane server.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8461";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error("verify only runs against a local lane server");
const OUT = "/tmp/r5-sitecx";
fs.mkdirSync(OUT, { recursive: true });

const GSC_SITE = 930121; // sc-domain:summitroofing.example (37 analytics rows)
const CF_SITE = 930111; // summitroofing.example Cloudflare zone
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "light",
});
await ctx.addInitScript(() => {
  try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {}
});
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

// ─────────────────────────────────────────────────────────────────────────────
// 1. REGRESSION — Esc / X / overlay on the review dialog must keep the URL rows.
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/search-console?site=${GSC_SITE}`, { waitUntil: "networkidle" });
await page.getByText(/results/).first().waitFor();
const urlInput = page.getByPlaceholder("https://your-site.com/sitemap.xml");
await urlInput.fill("https://summitroofing.example/about");
await page.getByRole("button", { name: "Review inspections" }).click();
await page.getByRole("heading", { name: "Queue URL inspections" }).waitFor();
await page.screenshot({ path: `${OUT}/1-dialog-open.png` });
// Esc:
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(
  "Esc keeps the URL row",
  (await urlInput.inputValue()) === "https://summitroofing.example/about" &&
    (await page.getByRole("heading", { name: "Queue URL inspections" }).count()) === 0,
);
// Overlay click (outside the dialog content):
await page.getByRole("button", { name: "Review inspections" }).click();
await page.getByRole("heading", { name: "Queue URL inspections" }).waitFor();
await page.mouse.click(10, 300);
await page.waitForTimeout(300);
check(
  "overlay click keeps the URL row",
  (await urlInput.inputValue()) === "https://summitroofing.example/about" &&
    (await page.getByRole("heading", { name: "Queue URL inspections" }).count()) === 0,
);
// X button:
await page.getByRole("button", { name: "Review inspections" }).click();
await page.getByRole("heading", { name: "Queue URL inspections" }).waitFor();
await page.getByRole("button", { name: "Close" }).click();
await page.waitForTimeout(300);
check(
  "X keeps the URL row",
  (await urlInput.inputValue()) === "https://summitroofing.example/about",
);
// Successful submit (mocked so no lane job is queued) clears the row:
await page.route("**/api/gsc/urls", (route) =>
  route.fulfill({ json: { queued: 1 } }),
);
await page.getByRole("button", { name: "Review inspections" }).click();
await page.getByRole("heading", { name: "Queue URL inspections" }).waitFor();
await page.getByTestId("button-confirm-queue").click();
await page.waitForTimeout(500);
check(
  "successful submit clears the row",
  (await urlInput.count()) === 0 || (await urlInput.inputValue()) === "",
);
await page.unroute("**/api/gsc/urls");

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mobile report table: every cell labelled; visible Sort by + Direction control
//    driving the existing server sort / URL state; multi-page sort.
// ─────────────────────────────────────────────────────────────────────────────
// Sections are anchored on their (unique) mobile sort control, not a heading — two
// headings contain "search analytics" ("Import search analytics" in Dataset status).
const analytics = page
  .getByLabel("Sort Search analytics by")
  .locator("xpath=ancestor::section[1]");
const analyticsRows = analytics.locator(
  "table.g-table--report tbody tr td:first-child",
);
// Every td carries data-label + headers association.
const cellInfo = await page.evaluate(() => {
  const tds = [...document.querySelectorAll("table.g-table--report td")];
  return {
    cells: tds.length,
    labelled: tds.filter((td) => td.getAttribute("data-label")).length,
    associated: tds.filter(
      (td) =>
        td.getAttribute("headers") &&
        document.getElementById(td.getAttribute("headers")),
    ).length,
    firstBefore: tds.length
      ? getComputedStyle(tds[0], "::before").content
      : "none",
  };
});
check(
  "every cell has a metric label + header association",
  cellInfo.cells > 0 &&
    cellInfo.labelled === cellInfo.cells &&
    cellInfo.associated === cellInfo.cells &&
    cellInfo.firstBefore !== "none",
  JSON.stringify(cellInfo),
);
await analytics.getByLabel("Sort Search analytics by").selectOption("clicks");
await analyticsRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const ascUrl = page.url();
const ascFirst = await analyticsRows.allTextContents();
const ascDisclosure = await analytics
  .getByText(/Sorted by Clicks ascending, across all \d+ rows/)
  .count();
await analytics.getByLabel("Sort direction for Search analytics").selectOption("desc");
await analyticsRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const descUrl = page.url();
const descFirst = await analyticsRows.allTextContents();
const descNote = await analytics
  .getByText(/Sorted by Clicks descending, across all \d+ rows/)
  .count();
check(
  "mobile Sort by + Direction drive the server sort and persist in the URL",
  ascUrl.includes("sort.Search+analytics=clicks") &&
    ascUrl.includes("dir.Search+analytics=asc") &&
    descUrl.includes("dir.Search+analytics=desc") &&
    ascDisclosure === 1 &&
    descNote === 1,
  `asc first row ${ascFirst[0]} → desc first row ${descFirst[0]}`,
);
check(
  "sort order actually changes (asc ≠ desc first row)",
  ascFirst[0] !== descFirst[0],
  `${ascFirst[0]} vs ${descFirst[0]}`,
);
// Multi-page: page 2 keeps the whole-report sort + disclosure.
await analytics.getByRole("button", { name: "Next" }).click();
await analyticsRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const page2First = await analyticsRows.allTextContents();
const page2Note = await analytics
  .getByText(/Sorted by Clicks descending, across all \d+ rows/)
  .count();
check(
  "multi-page report sorts across pages with the disclosure kept",
  page2Note === 1 && page2First[0] !== descFirst[0],
  `page 2 starts ${page2First[0]}`,
);
await page.screenshot({ path: `${OUT}/2-mobile-report-sorted.png` });

// ─────────────────────────────────────────────────────────────────────────────
// 5a. GSC abort mid-poll BEFORE touching the range: everything is cached, so no
//     NEW alert may appear and every surface keeps its rows under a strip. (The
//     static "Background processing is disabled" warning is a pre-existing alert.)
// ─────────────────────────────────────────────────────────────────────────────
const gscBaselineAlerts = await page.locator('[role="alert"]').count();
await page.route("**/api/gsc/**", (route) => route.abort());
await page.waitForTimeout(17000); // one 15s poll tick
const gscStrip = await page.getByTestId("strip-saved-data").count();
const gscRows = await page.locator("table.g-table--report tbody tr").count();
const gscBareAlert = await page.locator('[role="alert"]').count();
const gscFailedFetches = await page.getByText(/Failed to fetch/).count();
await page.unroute("**/api/gsc/**");
check(
  "GSC page: abort mid-poll keeps rows under saved-data strips, no bare error",
  gscStrip >= 1 &&
    gscRows > 0 &&
    gscBareAlert === gscBaselineAlerts &&
    gscFailedFetches === 0,
  JSON.stringify({ strips: gscStrip, rows: gscRows, alerts: `${gscBareAlert}/${gscBaselineAlerts}` }),
);
await page.screenshot({ path: `${OUT}/4-gsc-saved-data-strip.png` });
await page.getByTestId("button-retry-saved-data").first().click().catch(() => {});
await page.waitForTimeout(1500);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Trend: tap selects a bar with a persistent date:value readout; arrows move;
//    one Tab stop; >90-day ranges aggregate to weeks.
// ─────────────────────────────────────────────────────────────────────────────
const tabStops = await page.locator('button[data-trend-index][tabindex="0"]').count();
const bars = await page.locator("button[data-trend-index]").count();
check("trend is one Tab stop across its bars", tabStops === 1 && bars > 1, `${tabStops}/${bars}`);
const readout = page.getByTestId("text-trend-selection");
const defaultReadout = await readout.textContent();
const bar0 = page.locator('button[data-trend-index="0"]');
await bar0.click();
const clickedReadout = await readout.textContent();
await bar0.press("ArrowRight");
await page.waitForTimeout(200);
const arrowReadout = await readout.textContent();
check(
  "click selects a bar and shows a persistent date: value readout; arrows move it",
  /\d{4}-\d{2}-\d{2}: [\d,]+/.test(clickedReadout) &&
    clickedReadout !== defaultReadout &&
    arrowReadout !== clickedReadout,
  `${defaultReadout} → click ${clickedReadout} → arrow ${arrowReadout}`,
);
// Long range → weekly aggregation, judged against the SELECTED range. (Default is 31 days = daily.)
const from = page.getByLabel("From", { exact: true });
await from.fill("2026-06-01");
await from.press("Tab");
await page.getByText(/each bar totals one week/).waitFor({ timeout: 15000 });
const weeklyBars = await page.locator("button[data-trend-index]").count();
const weeklyReadout = await readout.textContent();
check(
  "ranges over 90 days aggregate to weeks (selected range drives it)",
  weeklyBars > 0 &&
    weeklyBars < 40 &&
    /^Week of \d{4}-\d{2}-\d{2}: [\d,]+/.test(weeklyReadout),
  `${weeklyBars} weekly bars, readout ${weeklyReadout}`,
);
await page.screenshot({ path: `${OUT}/3-trend-weekly.png` });

// ─────────────────────────────────────────────────────────────────────────────
// 3 + 5b. Cloudflare: whole-result server sort wired to the same table controls;
//         abort mid-poll keeps every dataset under strips, no bare alert.
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/cloudflare?site=${CF_SITE}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
// Events dataset: sort by Time descending via the mobile control.
const events = page.getByLabel("Sort Events by").locator("xpath=ancestor::section[1]");
const eventRows = events.locator("table.g-table--report tbody tr td:first-child");
await events.getByLabel("Sort Events by").selectOption("datetime");
await eventRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const cfAsc = page.url();
const cfFirstAsc = await eventRows.allTextContents();
await events.getByLabel("Sort direction for Events").selectOption("desc");
await eventRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const cfFirstDesc = await eventRows.allTextContents();
const cfNote = await events
  .getByText(/Sorted by Time descending, across all \d+ rows/)
  .count();
check(
  "Cloudflare events sort by the server across the whole dataset",
  cfAsc.includes("sort.Events=datetime") &&
    cfNote === 1 &&
    cfFirstAsc[0] !== cfFirstDesc[0],
  `asc ${cfFirstAsc[0]} → desc ${cfFirstDesc[0]}`,
);
// Countries: numeric sort on requests (whole-result order, not page-local).
const countries = page
  .getByLabel("Sort Countries by")
  .locator("xpath=ancestor::section[1]");
const countryRows = countries.locator("table.g-table--report tbody tr");
await countries.getByLabel("Sort Countries by").selectOption("requests");
await countries.getByLabel("Sort direction for Countries").selectOption("desc");
await countryRows.first().waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
const cfCountries = await countryRows.allTextContents();
const requests = await countries
  .locator("table.g-table--report tbody tr td:nth-child(2)")
  .allTextContents();
const numericDesc = requests.every(
  (v, i) => i === 0 || Number(requests[i - 1]) >= Number(v),
);
check(
  "Cloudflare countries sort numerically (requests desc)",
  cfCountries.length > 1 && numericDesc,
  cfCountries.slice(0, 2).join(" | ") + ` numeric=${numericDesc}`,
);
await page.screenshot({ path: `${OUT}/5-cloudflare-sorted.png` });
// Every Cloudflare dataset cell is labelled too (traffic/events/paths/bots/countries).
const cfCellInfo = await page.evaluate(() => {
  const tds = [...document.querySelectorAll("table.g-table--report td")];
  return {
    cells: tds.length,
    labelled: tds.filter((td) => td.getAttribute("data-label")).length,
  };
});
check(
  "Cloudflare tables label every cell at 390px",
  cfCellInfo.cells > 0 && cfCellInfo.labelled === cfCellInfo.cells,
  JSON.stringify(cfCellInfo),
);
// Abort mid-poll on the Cloudflare page too.
const cfBaselineAlerts = await page.locator('[role="alert"]').count();
await page.route("**/api/cloudflare/**", (route) => route.abort());
await page.waitForTimeout(17000);
const cfStrip = await page.getByTestId("strip-saved-data").count();
const cfRows = await page.locator("table.g-table--report tbody tr").count();
const cfBareAlert = await page.locator('[role="alert"]').count();
const cfFailedFetches = await page.getByText(/Failed to fetch/).count();
await page.unroute("**/api/cloudflare/**");
check(
  "Cloudflare page: abort mid-poll keeps rows under saved-data strips, no bare error",
  cfStrip >= 1 &&
    cfRows > 0 &&
    cfBareAlert === cfBaselineAlerts &&
    cfFailedFetches === 0,
  JSON.stringify({ strips: cfStrip, rows: cfRows, alerts: `${cfBareAlert}/${cfBaselineAlerts}` }),
);
await page.screenshot({ path: `${OUT}/6-cloudflare-saved-data-strip.png` });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
