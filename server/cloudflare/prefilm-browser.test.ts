import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";
import { LESSON_MODULES } from "../master-class/lessons";
import stateSteps from "../data/state-guide-steps.json";

// Test fixtures only; no database, provider requests, or changes to learner progress.
let server: ViteDevServer, browser: Browser, origin: string;
const shots = "/tmp/r6-prefilm-screens";
beforeAll(async () => {
  await fs.mkdir(shots, { recursive: true });
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: "/tmp/r6-prefilm-vite", resolve: { alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "prefilm-fixture", configureServer(s) { s.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/fixture")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/client/src/components/site-connections/prefilm.harness.tsx"></script></body></html>');
  }); } }] });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const refresh = (page: Page, prefix: string) => page.evaluate(prefix => (window as any).prefilm.refresh(prefix), prefix);
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

it("phone report unsorts its URL, reselects the new maximum, and consolidates failed polls", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = false;
  await page.route("**/api/test/**", route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { message: "Test refresh failure" } : { total: 60, items: [{ date: "2026-06-01", key: "Saved report row", clicks: 9 }] } }));
  try {
    await page.goto(`${origin}/fixture?sort.Search+analytics=clicks&dir.Search+analytics=desc&page.Search+analytics=2`);
    await page.getByLabel("Sort Search analytics by").selectOption("");
    const url = new URL(page.url());
    expect(url.searchParams.has("sort.Search analytics")).toBe(false);
    expect(url.searchParams.has("dir.Search analytics")).toBe(false);
    expect(url.searchParams.get("page.Search analytics")).toBe("1");
    await expect.poll(() => page.getByTestId("text-trend-selection").innerText()).toContain("2026-08-29: 90");
    const initialBar = await page.locator("button[data-trend-index][aria-pressed=true]").boundingBox();
    expect(initialBar!.x).toBeGreaterThanOrEqual(0);
    expect(initialBar!.x + initialBar!.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Change periods" }).click();
    await expect.poll(() => page.getByTestId("text-trend-selection").innerText()).toContain("2026-06-01: 90");
    const selected = page.locator("button[data-trend-index][aria-pressed=true]");
    await selected.focus(); await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.getByTestId("text-trend-selection").innerText()).toContain("2026-06-02: 89");
    fail = true; await refresh(page, "/api/test/");
    await expect.poll(() => page.getByTestId("strip-saved-data").count()).toBe(1);
    expect(await page.getByRole("button", { name: "Retry all", exact: true }).count()).toBe(1);
    expect(await page.getByText("Saved report row", { exact: true }).count()).toBe(2);
    await fits(page);
    await page.screenshot({ path: `${shots}/reports-phone.png`, fullPage: true });
    fail = false; await page.getByRole("button", { name: "Retry all", exact: true }).click();
    await page.getByTestId("strip-saved-data").waitFor({ state: "hidden" });
  } finally { await page.close(); }
}, 30000);

it("course retains same-account access, closes on denial/switch, protects reset and missing lessons", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let accessStatus = 200, missing = false;
  const access = { all: true, any: true, signedIn: true, included: true, purchases: [], devPreview: false, unlocked: { licensing: true, gmb: true, website: true, seo: true } };
  await page.route("**/api/course-access", route => route.fulfill({ status: accessStatus, json: accessStatus === 200 ? access : { message: "Test access failure" } }));
  await page.route("**/api/course-catalog", route => route.fulfill({ status: 503, json: { message: "Catalog unavailable in isolated fixture" } }));
  await page.route("**/api/state-guides", route => route.fulfill({ json: [] }));
  await page.route("**/api/master-class/lessons/seo", route => route.fulfill({ json: { module: "seo", ...LESSON_MODULES.seo, lessons: missing ? LESSON_MODULES.seo.lessons.filter(l => l.id !== "search-console") : LESSON_MODULES.seo.lessons, footer: LESSON_MODULES.seo.footer ?? [] } }));
  try {
    await page.goto(`${origin}/fixture?fixture=course&tab=seo`);
    const box = page.getByTestId("checkbox-search-console-done");
    await box.waitFor(); await box.click();
    page.once("dialog", dialog => { expect(dialog.message()).toContain("1 completed lesson"); expect(dialog.message()).toContain("SEO"); void dialog.dismiss(); });
    await page.getByTestId("button-lessons-reset").click();
    expect(await box.isChecked()).toBe(true);
    page.once("dialog", dialog => void dialog.accept());
    await page.getByTestId("button-lessons-reset").click();
    expect(await box.isChecked()).toBe(false);
    const service = page.getByTestId("badge-service-press-releases");
    await service.focus(); await page.keyboard.press("Space");
    expect(await service.getAttribute("aria-pressed")).toBe("true");
    expect(await service.evaluate(el => el.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press("Enter");
    expect(await service.getAttribute("aria-pressed")).toBe("false");
    accessStatus = 503; await refresh(page, "/api/course-access");
    await page.getByText("Access refresh failed", { exact: true }).waitFor();
    expect(await box.count()).toBe(1);
    missing = true; await refresh(page, "/api/master-class/lessons");
    expect(await box.isDisabled()).toBe(true);
    missing = false; await page.getByRole("button", { name: "Reload lesson", exact: true }).click();
    await expect.poll(() => box.isEnabled()).toBe(true);
    await fits(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${shots}/course-phone.png` });
    accessStatus = 403; await refresh(page, "/api/course-access");
    await box.waitFor({ state: "hidden" });
    accessStatus = 503; await refresh(page, "/api/course-access");
    expect(await box.count()).toBe(0);
    accessStatus = 200; await refresh(page, "/api/course-access");
    await box.waitFor();
    accessStatus = 503;
    await page.evaluate(() => (window as any).prefilm.switchUser(202));
    await box.waitFor({ state: "hidden" });
  } finally { await page.close(); }
}, 30000);

it("Cloudflare uses the selected range and keeps cached reports under one failed-poll warning", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = false;
  const traffic = [{ dimensions: { date: "2026-06-01" }, sum: { requests: 14, pageViews: 7, threats: 2 }, uniq: { uniques: 3 } }];
  await page.route("**/api/cloudflare/assets/1**", route => {
    const url = new URL(route.request().url());
    const json = url.pathname.endsWith("/1") ? { data: { since: "2026-06-01T00:00:00Z", until: "2026-10-01T00:00:00Z", traffic } }
      : { total: url.searchParams.get("field") === "traffic" ? 1 : 0, items: url.searchParams.get("field") === "traffic" ? traffic : [] };
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { message: "Test poll failure" } : json });
  });
  try {
    await page.goto(`${origin}/fixture?fixture=cloudflare`);
    await page.getByText("Requests by UTC day · weekly periods").waitFor();
    expect(await page.getByTestId("text-trend-selection").innerText()).toContain("14 (partial week)");
    fail = true; await refresh(page, "/api/cloudflare/");
    await expect.poll(() => page.getByTestId("strip-saved-data").count()).toBe(1);
    expect(await page.getByLabel("Sort Traffic by").count()).toBe(1);
    await fits(page);
    await page.screenshot({ path: `${shots}/cloudflare-phone.png`, fullPage: true });
    fail = false; await page.getByRole("button", { name: "Retry all", exact: true }).click();
    await page.getByTestId("strip-saved-data").waitFor({ state: "hidden" });
  } finally { await page.close(); }
}, 30000);

it("spam polling retains the saved ledger and call rows with Retry at phone width", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = false;
  await page.route("**/api/crm/voice/**", route => {
    const ledger = new URL(route.request().url()).pathname.endsWith("/spam");
    const json = ledger ? { entries: [{ id: 1, phoneNumber: "+18135550100", strikes: 2, calls: 3, lastReason: "Test spam", lastSeenAt: "2026-10-01T12:00:00Z" }], blocked: 0, thisMonth: { spamCalls: 3, rejected: 0, freeSpamCalls: 3, freeSpamCallsLimit: 5 } }
      : { calls: [{ id: "saved", callerName: "Saved spam caller", callerPhone: "+18135550100", startedAt: "2026-10-01T12:00:00Z", outcome: "spam" }], total: 1, page: 1, limit: 25 };
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { message: "Test poll failure" } : json });
  });
  try {
    await page.goto(`${origin}/fixture?fixture=spam`);
    await page.getByTestId("table-spam-ledger").waitFor();
    await page.getByTestId("table-spam-calls").waitFor();
    fail = true; await refresh(page, "/api/crm/voice/");
    expect(await page.getByText("Showing saved data — refresh failed", { exact: true }).count()).toBe(2);
    expect(await page.getByTestId("table-spam-ledger").count()).toBe(1);
    expect(await page.getByTestId("table-spam-calls").count()).toBe(1);
    await fits(page);
    await page.screenshot({ path: `${shots}/spam-phone.png`, fullPage: true });
    fail = false; await page.getByRole("button", { name: "Retry", exact: true }).first().click();
    await expect.poll(() => page.getByText("Showing saved data — refresh failed", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 30000);

async function filmSites(page: Page, provider: "cloudflare" | "gsc") {
  const asset = { id: 1, name: provider === "gsc" ? "sc-domain:summitroofing.example" : "summitroofing.example", external_id: "sc-domain:summitroofing.example", status: provider === "gsc" ? "siteOwner" : "active", locations: 3, data: { traffic: [{ dimensions: { date: "2026-10-10" }, sum: { requests: 22010, threats: 263, pageViews: 6823 } }] } };
  await page.route(`**/api/${provider}/**`, route => {
    const url = new URL(route.request().url()), p = url.pathname;
    let json: any = { items: [], total: 0 };
    if (p.endsWith("/assets")) json = { items: [asset], total: 1 };
    else if (p.endsWith("/assets/1")) json = asset;
    else if (p.endsWith("/flagged-ips")) json = { items: [{ ip_address: "192.0.2.1", source: "Sample", reason: "Sample flagged IP" }], total: 1 };
    else if (p.endsWith("/preview")) json = { items: [{ id: "test-preview", zone: asset.name, warning: "Rules affect real visitors.", rules: [{ rule: { description: "Sample preview", expression: "ip.src in {192.0.2.1}" } }] }] };
    else if (p.endsWith("/overview")) json = { summary: { clicks: 200, impressions: 1000, ctr: .2, position: 3 }, trend: [] };
    else if (p.endsWith("/analytics")) json = { items: [{ date: "2026-10-10", key: "roof repair", clicks: 200, impressions: 1000, ctr: .2, position: 3 }], total: 1 };
    return route.fulfill({ json });
  });
}

it.each([390, 1280])("film preview focuses its heading, keeps tabs visible, and never overlays review at %ipx", async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await filmSites(page, "cloudflare");
    await page.goto(`${origin}/fixture?fixture=sites-cf&site=1`);
    await page.getByRole("definition").filter({ hasText: "22,010" }).waitFor();
    await page.getByRole("button", { name: "Add to preview", exact: true }).click();
    const heading = page.getByText("Preview edge protection for selected zones", { exact: true });
    await expect.poll(() => heading.evaluate(el => el === document.activeElement)).toBe(true);
    const bounds = await heading.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThan(900);
    const tabs = await page.getByRole("group", { name: "Selected site views" }).boundingBox();
    expect(tabs!.y).toBeGreaterThanOrEqual(0);
    expect(await page.getByLabel("Ads path", { exact: true }).count()).toBe(0);
    await page.getByLabel("Rule pack").selectOption("ads-door");
    expect(await page.getByLabel("Ads path", { exact: true }).count()).toBe(1);
    await page.getByLabel("Rule pack").selectOption("bad-ua");
    expect(await page.getByLabel("Ads path", { exact: true }).count()).toBe(0);
    await page.getByLabel("Rule pack").selectOption("ips");
    await page.getByRole("button", { name: "Preview rules", exact: true }).click();
    await page.getByRole("heading", { name: "Review before applying" }).waitFor();
    expect(await page.getByText("Preview ready", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Preview ready", { exact: true }).evaluate(el => el.parentElement?.textContent?.includes("Review before applying"))).toBe(true);
    await page.getByRole("heading", { name: "Review before applying" }).scrollIntoViewIfNeeded();
    await fits(page);
    await page.screenshot({ path: `${shots}/r7-preview-${width}.png` });
  } finally { await page.close(); }
}, 30000);

it.each([390, 1280])("film Search Console labels, defaults, sorting, and URL layout at %ipx", async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await filmSites(page, "gsc");
    await page.goto(`${origin}/fixture?fixture=sites-gsc`);
    await page.getByTestId("list-sites-gsc").waitFor();
    expect(await page.getByTestId("list-sites-gsc").innerText()).toContain("Owner");
    expect(await page.getByTestId("list-sites-gsc").innerText()).not.toContain("siteOwner");
    const property = page.getByRole("combobox", { name: /^Property/ });
    expect(await property.getAttribute("title")).toBe("sc-domain:summitroofing.example");
    await fits(page);
    await page.getByRole("button", { name: "sc-domain:summitroofing.example", exact: true }).click();
    await page.getByLabel("Breakdown", { exact: true }).selectOption("query");
    expect(await page.getByLabel("Group", { exact: true }).inputValue()).toBe("total");
    if (width < 640) {
      await page.getByLabel("Sort Search analytics by").selectOption("clicks");
    } else {
      await page.getByRole("button", { name: "Clicks", exact: true }).click();
    }
    expect(new URL(page.url()).searchParams.get("dir.Search analytics")).toBe("desc");
    if (width < 640) await page.getByLabel("Sort Search analytics by").selectOption("key");
    else await page.getByRole("button", { name: "Breakdown", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("dir.Search analytics")).toBe("asc");
    await page.getByLabel("Group", { exact: true }).selectOption("day");
    expect(new URL(page.url()).searchParams.get("group")).toBe("day");
    const note = page.getByText(/Coverage summarizes inspected URLs only/);
    const heading = page.getByRole("heading", { name: "Sitemaps and URL inspections" });
    const a = await note.boundingBox(), b = await heading.boundingBox();
    expect(b!.y - a!.y - a!.height).toBeGreaterThanOrEqual(24);
    await heading.scrollIntoViewIfNeeded();
    await fits(page);
    await page.screenshot({ path: `${shots}/r7-search-${width}.png` });
  } finally { await page.close(); }
}, 30000);

it.each([390, 1280])("Mark done retains the checkbox and scroll position at %ipx", async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const access = { all: true, any: true, signedIn: true, included: true, purchases: [], devPreview: false, unlocked: { licensing: true, gmb: true, website: true, seo: true } };
  await page.route("**/api/course-access", route => route.fulfill({ json: access }));
  await page.route("**/api/course-catalog", route => route.fulfill({ status: 503, json: { message: "Test catalog unavailable" } }));
  await page.route("**/api/state-guides", route => route.fulfill({ json: [] }));
  await page.route("**/api/master-class/lessons/seo", route => route.fulfill({ json: { module: "seo", ...LESSON_MODULES.seo, footer: LESSON_MODULES.seo.footer ?? [] } }));
  try {
    await page.goto(`${origin}/fixture?fixture=course&tab=seo`);
    const box = page.getByTestId("checkbox-search-console-done");
    await box.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await box.evaluate(el => el.scrollIntoView({ block: "center" }));
    const before = await box.boundingBox(), scroll = await page.evaluate(() => scrollY);
    await box.click();
    await expect.poll(() => box.isChecked()).toBe(true);
    const after = await box.boundingBox();
    expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(before!.x - after!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(scroll - await page.evaluate(() => scrollY))).toBeLessThanOrEqual(1);
    await box.click();
    expect(await box.isChecked()).toBe(false);
    expect(Math.abs(scroll - await page.evaluate(() => scrollY))).toBeLessThanOrEqual(1);
    await fits(page);
    await page.screenshot({ path: `${shots}/r7-progress-${width}.png` });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.getByTestId("lesson-outline").innerText()).toContain("Progress is saved in this browser for your account only.");
  } finally { await page.close(); }
}, 30000);

it.each([390, 1280].flatMap(width => ["FL", "WA"].map(code => ({ width, code }))))("state copy and completion work at $width px for $code", async ({ width, code }) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const access = { all: true, any: true, signedIn: true, included: true, purchases: [], devPreview: false, unlocked: { licensing: true, gmb: true, website: true, seo: true } };
  const sourceSteps = stateSteps.filter(step => step.state_code === code);
  const state = { id: code === "FL" ? 9 : 47, stateCode: code, stateName: code === "FL" ? "Florida" : "Washington", sosName: "Division of Corporations", licensingRequired: null, workersCompType: null, salesTaxOnLabor: null, bAndOTax: null, bondRequired: null, linksCheckedAt: null, stepCount: sourceSteps.length, walkthrough: "written" };
  await page.route("**/api/course-access", route => route.fulfill({ json: access }));
  await page.route("**/api/course-catalog", route => route.fulfill({ status: 503, json: { message: "Test catalog unavailable" } }));
  await page.route("**/api/state-guides", route => route.fulfill({ json: [state] }));
  await page.route(`**/api/state-guides/${code}`, route => route.fulfill({ json: { ...state, steps: sourceSteps.map(step => ({ stepNumber: step.step_number, title: step.title, description: step.description, category: step.category, isRequired: step.is_required, tips: step.tips, url: step.url, urlLabel: step.url_label })), checklist: [] } }));
  await page.route("**/api/master-class/lessons/licensing", route => route.fulfill({ json: { module: "licensing", ...LESSON_MODULES.licensing, footer: LESSON_MODULES.licensing.footer ?? [] } }));
  try {
    await page.goto(`${origin}/fixture?fixture=course&tab=state-guide&state=${code}`);
    const box = page.getByTestId("checkbox-step-1");
    await box.waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const step of sourceSteps) {
      expect(await page.getByText(step.description, { exact: true }).count()).toBe(1);
      expect(await page.getByText(step.tips, { exact: true }).count()).toBe(1);
    }
    await box.focus();
    expect(await box.evaluate(el => el.matches(":focus-visible"))).toBe(true);
    await box.evaluate(el => el.scrollIntoView({ block: "center" }));
    const before = await box.boundingBox(), scroll = await page.evaluate(() => scrollY);
    await box.click();
    await expect.poll(() => box.isChecked()).toBe(true);
    const after = await box.boundingBox();
    expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(scroll - await page.evaluate(() => scrollY))).toBeLessThanOrEqual(1);
    await fits(page);
    await page.screenshot({ path: `${shots}/r7-state-progress-${code}-${width}.png` });
  } finally { await page.close(); }
}, 30000);
