/** Run from the worktree: node e2e/r9-call-assistant-layout.mjs. No DB, no provider requests. */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const output = process.env.R9_SCREENSHOTS || "/tmp/r9-call-assistant-screens";
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false, root, cacheDir: "/tmp/r9-vite-cache",
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") }, dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 8199, strictPort: true },
  plugins: [{ name: "r9-layout-fixture", configureServer(s) {
    s.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/r9-layout")) return next();
      const html = await s.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/r9-call-assistant-layout.tsx"></script></body></html>');
      res.setHeader("Content-Type", "text/html"); res.end(html);
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.R9_CHROMIUM || undefined, args: ["--no-sandbox"] });
  for (const width of [1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:8199/") ? route.continue() : route.abort());
    await page.goto("http://127.0.0.1:8199/r9-layout");
    if (width === 390) {
      await page.getByTestId("select-studio-section").click();
      await page.getByRole("option", { name: "Persona", exact: true }).click();
    } else await page.getByTestId("studio-nav-persona").click();
    await page.getByTestId("persona-cards").waitFor();
    const sizes = await page.locator('[data-testid^="card-persona-"] span.whitespace-nowrap.font-medium').evaluateAll(nodes => nodes.map(n => ({ height: n.getBoundingClientRect().height, line: parseFloat(getComputedStyle(n).lineHeight), width: n.getBoundingClientRect().width, parent: n.parentElement.parentElement.getBoundingClientRect().width })));
    await page.screenshot({ path: `${output}/persona-${width}.png`, fullPage: true });
    assert(sizes.length > 0 && sizes.every(n => n.height <= n.line + 1 && n.width <= n.parent), `Persona names must fit on one line: ${JSON.stringify(sizes)}`);
    await page.getByTestId("card-persona-janice").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const focus = await page.getByTestId("card-persona-janice").evaluate(n => ({ visible: n.matches(":focus-visible"), shadow: getComputedStyle(n).boxShadow }));
    assert(focus.visible && focus.shadow !== "none", "Keyboard focus must be visible");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Persona page must fit phone width");
    await page.screenshot({ path: `${output}/persona-${width}.png`, fullPage: true });
    await page.goto("http://127.0.0.1:8199/r9-layout?view=call");
    const scroll = page.getByTestId("scroll-call-detail");
    await scroll.waitFor();
    await page.getByTestId("text-call-detail-title").waitFor();
    await page.waitForTimeout(550); // Let the sheet opening animation finish before measuring.
    const titleBefore = await page.getByTestId("text-call-detail-title").boundingBox();
    await scroll.evaluate(n => { n.scrollTop = n.scrollHeight; });
    const titleAfter = await page.getByTestId("text-call-detail-title").boundingBox();
    const body = await scroll.boundingBox();
    assert.equal(titleBefore.y, titleAfter.y, "Header must stay still when the body scrolls");
    assert(body.y >= titleAfter.y + titleAfter.height, "Scrolling body must not overlap header");
    assert(await scroll.evaluate(n => n.scrollWidth <= n.clientWidth), "Call detail must not overflow horizontally");
    assert.equal(await page.getByTestId("button-call-delivery-retry").count(), 0);
    await page.screenshot({ path: `${output}/call-scrolled-${width}.png` });
    await scroll.evaluate(n => { n.scrollTop = 0; });
    await page.screenshot({ path: `${output}/call-${width}.png` });
    await page.goto("http://127.0.0.1:8199/r9-layout?view=overview");
    await page.getByTestId("text-results-hangup").waitFor();
    assert.equal(await page.getByTestId("text-results-hangup").textContent(), "1");
    assert.equal(await page.getByTestId("text-results-voicemail").textContent(), "2");
    assert.equal(await page.getByTestId("text-results-alerted").textContent(), "2");
    assert(!(await page.getByTestId("text-overview-next-step").textContent()).includes("test conversation"));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Overview must fit phone width");
    await page.screenshot({ path: `${output}/overview-${width}.png`, fullPage: true });
    await page.close();
    console.log(`PASS ${width}px: names, focus, panel scroll, overflow, uncertain retry and results`);
  }
} finally {
  await browser?.close();
  await server.close();
}
