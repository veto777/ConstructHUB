/**
 * The final crawl (owner, 2026-10-04: "once this entire thing is completed and fully debugged you take one last
 * crawl at the entire thing"). Visits every route as a desktop browser, a phone browser and the iPhone app, and
 * reports per page: uncaught script errors, console errors, failed same-origin requests (>= 500 always; 4xx except
 * the expected 401/402/403 gates), sideways scrolling at 390 px, broken in-page links (same-origin hrefs that 404),
 * and — in app mode only — sales text (prices to ConstructHUB, plan names to buy, upgrade/trial/checkout).
 *
 * Run (dev servers: platform on PLATFORM, CRM portal on PORTAL, signed out on ANON):
 *   NODE_PATH=node_modules node script/crawl-all.cjs <out.json>
 *   env: PLATFORM=http://127.0.0.1:8199 PORTAL=http://127.0.0.1:8179 ANON=http://127.0.0.1:8198
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");

const OUT = process.argv[2] || "crawl-report.json";
const PLATFORM = process.env.PLATFORM || "http://127.0.0.1:8199";
const PORTAL = process.env.PORTAL || "http://127.0.0.1:8179";
const ANON = process.env.ANON || "http://127.0.0.1:8198";

const PLATFORM_ROUTES = ["/", "/search", "/databases", "/property", "/schedules", "/history", "/photos", "/media-library",
  "/gmb-monitor", "/google-profile", "/ranking-grid", "/competitors", "/agency", "/locations", "/domains", "/mail-alerts",
  "/gbp-content", "/social-media", "/guides", "/cloudflare", "/search-console", "/site-scan", "/google-ads", "/ads-manager",
  "/google-ad-fraud", "/google-ads-guide", "/lsa-guide", "/lsa-leads", "/lsa-account-manager", "/ip-tracker", "/vpn-shield",
  "/google-reviews", "/call-assistant", "/call-assistant?tab=numbers", "/call-assistant?tab=studio", "/call-assistant?tab=simulator",
  "/call-assistant?tab=calls", "/settings", "/settings?tab=security", "/settings?tab=notifications", "/settings?tab=phone-bar",
  "/settings?tab=billing", "/settings?tab=limits", "/settings?tab=api-keys", "/settings?tab=audit-log", "/settings?tab=integrations",
  "/developers", "/admin/access", "/admin/issues", "/admin/feature-pages", "/account/delete", "/free-site-scan"];
const PUBLIC_ROUTES = ["/", "/pricing", "/features", "/done-for-you", "/call-assistant", "/landing", "/guides", "/master-class",
  "/reinstatement", "/auth", "/privacy", "/terms", "/databases", "/property", "/search", "/google-ads-guide", "/lsa-guide",
  "/google-ad-fraud", "/google-business", "/free-site-scan", "/developers", "/no-such-page-xyz"];
const CRM_ROUTES = ["/", "/crm/clients", "/crm/estimates", "/crm/estimates/new", "/crm/invoices", "/crm/payments", "/crm/pipeline",
  "/crm/schedule", "/crm/inbox", "/crm/pricebook", "/crm/reports", "/crm/team", "/crm/settings", "/crm/integrations",
  "/crm/migrate", "/account/delete"];

const SALES = /\$\s?\d[\d,]*(\.\d\d)?\s*(\/\s?(mo|month|yr|year)|per\s+(month|year|minute))|\b(upgrade|free trial|start (your|my) trial|subscribe|checkout|add to cart|choose a (plan|tier)|see plans|compare tiers|talk to (a )?sales)\b|\b(Starter|Pro|Growth|Agency|Lite|Solo|Crew|Fleet)\s+(plan|tier)\b/i;
const EXPECTED_STATUS = new Set([401, 402, 403]);

async function crawl(browser, { name, base, routes, ctxOpts, appMode }) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addCookies([{ name: "ch_consent", value: "denied", url: base }]);
  const results = [];
  for (const route of routes) {
    const page = await ctx.newPage();
    const r = { surface: name, route, errors: [], console: [], failed: [], overflow: 0, brokenLinks: [], sales: [] };
    page.on("pageerror", (e) => r.errors.push(String(e.message || e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") r.console.push(m.text().slice(0, 300)); });
    page.on("response", (res) => {
      const u = res.url();
      if (!u.startsWith(base)) return;
      const s = res.status();
      if (s >= 500 || (s >= 400 && !EXPECTED_STATUS.has(s) && !(s === 404 && route === "/no-such-page-xyz"))) r.failed.push(`${s} ${u.replace(base, "")}`);
    });
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1200);
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        text: document.body.innerText,
        links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/api/")),
      }));
      r.overflow = info.overflow;
      if (appMode) {
        for (const line of info.text.split("\n")) if (SALES.test(line)) r.sales.push(line.trim().slice(0, 200));
      }
      const uniq = [...new Set(info.links.map((h) => h.split("#")[0]).filter(Boolean))].slice(0, 60);
      for (const h of uniq) {
        const res = await ctx.request.get(base + h, { maxRedirects: 5 }).catch(() => null);
        if (res && res.status() === 404) r.brokenLinks.push(h);
      }
    } catch (e) { r.errors.push(`navigation: ${String(e.message || e).slice(0, 200)}`); }
    await page.close();
    results.push(r);
    process.stdout.write(`${name} ${route} err=${r.errors.length} con=${r.console.length} fail=${r.failed.length} ovf=${r.overflow} links=${r.brokenLinks.length} sales=${r.sales.length}\n`);
  }
  await ctx.close();
  return results;
}

(async () => {
  const browser = await chromium.launch();
  const phone = devices["iPhone 13"];
  const app = (token) => ({ ...phone, userAgent: `${phone.userAgent} ${token}/1.0` });
  const runs = [
    { name: "platform-desktop", base: PLATFORM, routes: PLATFORM_ROUTES, ctxOpts: { viewport: { width: 1440, height: 900 } } },
    { name: "platform-phone", base: PLATFORM, routes: PLATFORM_ROUTES, ctxOpts: phone },
    { name: "platform-app", base: PLATFORM, routes: PLATFORM_ROUTES, ctxOpts: app("ConstructHUBApp"), appMode: true },
    { name: "public-desktop", base: ANON, routes: PUBLIC_ROUTES, ctxOpts: { viewport: { width: 1440, height: 900 } } },
    { name: "public-phone", base: ANON, routes: PUBLIC_ROUTES, ctxOpts: phone },
    { name: "public-app", base: ANON, routes: PUBLIC_ROUTES, ctxOpts: app("ConstructHUBApp"), appMode: true },
    { name: "crm-desktop", base: PORTAL, routes: CRM_ROUTES, ctxOpts: { viewport: { width: 1440, height: 900 } } },
    { name: "crm-phone", base: PORTAL, routes: CRM_ROUTES, ctxOpts: phone },
    { name: "crm-app", base: PORTAL, routes: CRM_ROUTES, ctxOpts: app("ConstructHUBCRM"), appMode: true },
  ];
  const all = [];
  for (const run of runs) all.push(...await crawl(browser, run));
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  const bad = all.filter((r) => r.errors.length || r.failed.length || r.overflow > 2 || r.brokenLinks.length || r.sales.length);
  console.log(`\n${all.length} page visits; ${bad.length} with findings → ${OUT}`);
})();
