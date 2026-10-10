// Feature-page screenshots: drives the lane app (sample data only) and writes
// client/public/feature-shots/<key>-<n>.webp. Never point it at production.
//   node script/feature-shots/capture.mjs <shots.json> [only-key]
// shots.json: [{ key, n, route, alt, caption, wait?, actions?: [{click|fill|press|hover|scroll|wait, value?}], clip?: css, keepHub?, signedOut?, skip? }]
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SHOTS_BASE || "http://localhost:8489";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error("capture only runs against a local lane server");
const OUT = path.resolve("client/public/feature-shots");
const RAW = process.env.SHOTS_RAW || "/tmp/chx_fs_raw";
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(RAW, { recursive: true });
const shots = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((s) => !process.argv[3] || s.key === process.argv[3]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
// The prod build only issues its (Secure) session cookie over HTTPS; the lane says so through the proxy header,
// and Chromium treats localhost as a secure origin, so the cookie is sent back over plain http.
await ctx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
// One login per run is plenty, and the server allows 10 per account per 15 minutes: reuse the last session while it works.
const SESSION = process.env.SHOTS_SESSION || "/tmp/chx_fs_session.json";
const signedIn = async () => (await (await ctx.request.get(BASE + "/api/auth/me")).json().catch(() => null)) !== null;
if (process.env.SHOTS_EMAIL) {
  try { await ctx.addCookies(JSON.parse(fs.readFileSync(SESSION, "utf8"))); } catch { /* no saved session */ }
  if (!(await signedIn())) {
    const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email: process.env.SHOTS_EMAIL, password: process.env.SHOTS_PASSWORD } });
    if (!r.ok()) throw new Error("lane login failed: " + r.status());
    fs.writeFileSync(SESSION, JSON.stringify(await ctx.cookies(BASE)), { mode: 0o600 });
  }
}
await ctx.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {} });
// Gabe's corner launcher and welcome bubble sit over every app screen; a shot of Gabe himself sets "keepHub".
const HIDE_HUB = `[data-testid="hub-launcher"], [data-testid="hub-welcome-bubble"], [data-testid="button-open-chat"] { display: none !important; }`;
const HIDE = `[data-testid="cookie-consent-banner"] { display: none !important; }
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }`;
const outCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await outCtx.addCookies([{ name: "ch_consent", value: "denied", url: BASE }]);
await outCtx.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch {} });
for (const s of shots.filter((x) => !x.skip)) {
  const page = await (s.signedOut ? outCtx : ctx).newPage();
  try {
    await page.goto(BASE + s.route, { waitUntil: "networkidle", timeout: 45000 });
    await page.addStyleTag({ content: s.keepHub ? HIDE : HIDE + HIDE_HUB });
    if (s.wait) await page.getByText(s.wait, { exact: false }).first().waitFor({ timeout: 15000 });
    for (const a of s.actions || []) {
      if (a.click) await page.locator(a.click).first().click();
      else if (a.fill) await page.locator(a.fill).first().fill(a.value ?? "");
      else if (a.press) await page.keyboard.press(a.press);
      else if (a.hover) await page.locator(a.hover).first().hover();
      else if (a.scroll) await page.locator(a.scroll).first().scrollIntoViewIfNeeded();
      else if (a.evaluate) await page.evaluate(a.evaluate);
      else if (a.wait) await page.waitForTimeout(Number(a.wait));
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    await page.waitForTimeout(800);
    const raw = `${RAW}/${s.key}-${s.n}.png`;
    if (s.clip) await page.locator(s.clip).first().screenshot({ path: raw });
    else await page.screenshot({ path: raw, fullPage: !!s.fullHeight });
    const out = `${OUT}/${s.key}-${s.n}.webp`;
    const info = await sharp(raw).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
    console.log(`ok ${s.key}-${s.n} ${info.width}x${info.height} ${Math.round(info.size / 1024)}KB  ${s.route}`);
  } catch (e) {
    console.log(`FAIL ${s.key}-${s.n} ${s.route}: ${String(e.message).split("\n")[0].slice(0, 160)}`);
  } finally { await page.close(); }
}
await browser.close();
