import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";
import { LESSON_MODULES } from "../master-class/lessons";

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
