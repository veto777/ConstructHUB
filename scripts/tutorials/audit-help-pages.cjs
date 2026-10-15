// Browser audit for the help system: open each route, find the page's "i" (help-button-* / help-play-* /
// info-tip-*), open it, play the film when the panel offers one and make sure a <video> appears inside the panel.
// Console errors are recorded and every page is screenshotted with its panel open.
//
//   NODE_PATH=/home/veto/ConstructHUB-debug/node_modules node scripts/tutorials/audit-help-pages.cjs \
//     http://127.0.0.1:8203 [--out DIR] [--portal-base URL] [--routes-file FILE] [--list] /search /crm/clients …
//
//   routes      one or more page paths (":id"-style parameters already replaced), or --routes-file with one per line
//               (the output of `tsx scripts/tutorials/audit-help-routes.ts --list`), or --list to run that script here.
//   --out       where screenshots and audit.json go (default: ./tmp/help-audit).
//   --portal-base  the CRM host for /crm routes; by default the base URL with ?portal=1 (local dev renders the CRM
//               on the bare host with that flag — client/src/lib/site.ts).
//
// Exit 1 when a route has no "i", its panel does not open, or it offers a film that does not play.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const base = argv.find((a) => /^https?:\/\//.test(a));
if (!base) { console.error("usage: audit-help-pages.cjs <baseUrl> [--out DIR] [--portal-base URL] [--routes-file FILE | --list] route…"); process.exit(2); }
const out = flag("--out") ?? path.resolve("tmp/help-audit");
const portalBase = flag("--portal-base");
const FLAGS_WITH_VALUE = ["--out", "--portal-base", "--routes-file"];
const flagValues = new Set(FLAGS_WITH_VALUE.map(flag).filter(Boolean));
let routes = argv.filter((a) => a.startsWith("/") && !flagValues.has(a));
if (flag("--routes-file")) routes.push(...fs.readFileSync(flag("--routes-file"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")));
if (argv.includes("--list")) routes.push(...execFileSync("npx", ["tsx", path.join(__dirname, "audit-help-routes.ts"), "--list"], { encoding: "utf8" }).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")));
routes = [...new Set(routes)];
if (!routes.length) { console.error("no routes given"); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const isCrm = (r) => r === "/crm" || r.startsWith("/crm/");
const urlFor = (route) => {
  if (isCrm(route) && portalBase) return portalBase.replace(/\/$/, "") + route;
  const u = new URL(route, base);
  if (isCrm(route)) u.searchParams.set("portal", "1");
  return u.toString();
};
const slug = (route) => route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

(async () => {
  const browser = await chromium.launch({ channel: "chromium-headless-shell" }).catch(() => chromium.launch());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const results = [];
  for (const route of routes) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
    const r = { route, url: urlFor(route), control: null, key: null, panel: false, film: null, video: null, errors, ok: false, note: "" };
    try {
      await page.goto(r.url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => page.waitForTimeout(3000));
      // The registry chunk loads on demand: give the "i" a moment to appear.
      const any = page.locator('[data-testid^="help-button-"], [data-testid^="help-play-"], [data-testid^="info-tip-"]');
      await any.first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
      const buttons = page.locator('[data-testid^="help-button-"]');
      const crumb = await page.locator('[data-testid="tool-crumb-help"]').count();
      if (await buttons.count()) {
        const btn = buttons.first();
        r.key = (await btn.getAttribute("data-testid")).replace("help-button-", "");
        r.control = crumb && (await page.locator(`[data-testid="tool-crumb-help"] [data-testid="help-button-${r.key}"]`).count()) ? "help-button (shell crumb fallback)" : "help-button";
        await btn.scrollIntoViewIfNeeded(); await btn.click();
        const panel = page.locator(`[data-testid="help-panel-${r.key}"]`);
        await panel.waitFor({ state: "visible", timeout: 5_000 });
        r.panel = true;
        const watch = panel.locator(`[data-testid="help-watch-${r.key}"]`);
        if (await watch.count()) {
          r.film = (await watch.getAttribute("data-video-source")) ?? "unknown";
          await watch.click();
          const video = panel.locator(`[data-testid="help-inline-video-${r.key}"] video`);
          await video.waitFor({ state: "attached", timeout: 5_000 });
          r.video = (await video.count()) > 0;
          const src = await video.locator("source").first().getAttribute("src").catch(() => null);
          r.note = src ? `plays ${src}` : "";
          r.ok = r.video;
        } else {
          r.film = null; r.ok = true;
          r.note = (await panel.locator(`[data-testid="help-video-soon-${r.key}"]`).count()) ? "no film: panel says coming soon" : "no film";
        }
      } else if (await page.locator('[data-testid^="info-tip-"]').count()) {
        const tip = page.locator('[data-testid^="info-tip-"]').first();
        r.key = (await tip.getAttribute("data-testid")).replace("info-tip-", "");
        r.control = "info-tip";
        await tip.click();
        await page.locator(`[data-testid="info-dialog-${r.key}"]`).waitFor({ state: "visible", timeout: 5_000 });
        r.panel = true;
        const play = page.locator('[data-testid^="help-play-"]');
        r.note = (await play.count()) ? "walkthrough button beside the ⓘ" : "InfoTip only";
        r.ok = true;
      } else if (await page.locator('[data-testid^="help-play-"]').count()) {
        r.control = "help-play"; r.key = (await page.locator('[data-testid^="help-play-"]').first().getAttribute("data-testid")).replace("help-play-", "");
        r.ok = true; r.panel = true; r.note = "play button only";
      } else {
        r.note = `no help control on the page (title: ${JSON.stringify((await page.title()).slice(0, 60))})`;
      }
    } catch (e) {
      r.note = `${r.note} ${String(e.message).split("\n")[0]}`.trim();
    }
    await page.screenshot({ path: path.join(out, `${slug(route)}.png`) }).catch(() => {});
    await page.close();
    results.push(r);
    console.log(`${r.ok ? "ok  " : "FAIL"} ${route.padEnd(34)} ${(r.control ?? "-").padEnd(34)} ${(r.key ?? "-").padEnd(26)} ${r.film ? `${r.film} film: ${r.video ? "plays" : "NO VIDEO"}` : "no film"}  ${r.note}${errors.length ? `  [${errors.length} console error(s)]` : ""}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(out, "audit.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} routes: ${results.length - failed.length} ok, ${failed.length} failed. Screenshots and audit.json in ${out}`);
  if (failed.length) { for (const r of failed) console.log(`  ${r.route}: ${r.note}`); process.exit(1); }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
