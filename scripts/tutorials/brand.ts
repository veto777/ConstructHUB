/**
 * The branded stills of a walkthrough — the intro card, the end card and the YouTube thumbnail — as
 * HTML/CSS rendered by headless Chromium. Deterministic: the same script gives the same pixels.
 *
 * Everything on them is ours: the CHUB logo (client/public/chub-logo-trimmed.png), the standing
 * gator (client/public/mascot/gator-standing-1024.v1.webp — the brand mascot, client/src/components/
 * mascot.tsx; never redrawn, recoloured or stretched) and the Anton typeface, bundled in ./assets
 * under the SIL Open Font License (assets/Anton-OFL.txt) so nothing is fetched at render time.
 * No vendor names, no third-party logos, no music.
 *
 * Brand colours: blue #1a73e8 (deeper #0b3fa8, brighter #3d9bff) and orange hsl(25 95% 53%) = #f97316.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { chromium } from "playwright";
import { ROOT } from "./lib";

const ASSET = (p: string) => pathToFileURL(path.join(ROOT, p)).href;
export const FONT = ASSET("scripts/tutorials/assets/Anton-Regular.ttf");
export const LOGO = ASSET("client/public/chub-logo-trimmed.png");
export const GATOR = ASSET("client/public/mascot/gator-standing-1024.v1.webp");
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Shared look: the blue field with faint rays, the heavy white type with a dark-blue edge, the white outline round the gator. */
export const BASE_CSS = `
@font-face{font-family:Anton;src:url("${FONT}") format("truetype");font-display:block}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;position:relative;font-family:Anton,Impact,"Arial Black",sans-serif;
  background:radial-gradient(circle at 30% 35%,#3d9bff 0%,#1a73e8 38%,#0b3fa8 100%)}
.rays{position:absolute;inset:0;background:repeating-conic-gradient(from 0deg at 30% 35%,rgba(255,255,255,.07) 0 6deg,transparent 6deg 14deg)}
.burst{position:absolute;background:linear-gradient(160deg,#ffa23a,#f97316 55%,#ea580c)}
.gator{position:absolute;filter:drop-shadow(0 0 0 #fff) drop-shadow(6px 0 0 #fff) drop-shadow(-6px 0 0 #fff) drop-shadow(0 6px 0 #fff) drop-shadow(0 -6px 0 #fff) drop-shadow(0 18px 24px rgba(0,0,0,.45))}
.kicker{position:absolute;font-size:34px;letter-spacing:3px;color:#0b2f7a;background:#fff;padding:6px 24px 8px;border-radius:999px;text-transform:uppercase;box-shadow:0 6px 0 rgba(0,0,0,.25);white-space:nowrap}
h1{position:absolute;font-weight:400;line-height:1.0;color:#fff;text-transform:uppercase;letter-spacing:1px;
  text-shadow:0 .055em 0 #082a70,0 .09em .17em rgba(0,0,0,.45);-webkit-text-stroke:.02em #082a70;paint-order:stroke fill}
h1 .o{display:inline-block;background:#f97316;color:#fff;padding:0 .15em .04em;border-radius:.09em;transform:rotate(-2deg);-webkit-text-stroke:0;
  text-shadow:0 .04em 0 #9a3c06;box-shadow:0 .065em 0 #9a3c06,0 0 0 .04em #fff;margin:.03em 0 .1em}
.logo{position:absolute;height:64px;background:#fff;padding:12px 20px;border-radius:14px;box-shadow:0 6px 0 rgba(0,0,0,.25)}
`;
/** Shrink a headline until it fits its box (runs in the page). */
const FIT_JS = `
for (const el of document.querySelectorAll("[data-fit]")) {
  const [maxW, maxH, start] = el.getAttribute("data-fit").split(",").map(Number);
  let size = start; el.style.fontSize = size + "px";
  while (size > 30 && (el.scrollWidth > maxW || el.offsetHeight > maxH)) { size -= 2; el.style.fontSize = size + "px"; }
}`;

/**
 * Render one 1280×720-designed page at `width` pixels wide to a PNG or JPEG. The social cuts
 * (social-brand.ts) design at their own size: `size` is then the page's size in real pixels, and
 * `transparent` keeps the page's see-through parts see-through (PNG only).
 */
export async function renderStill(html: string, out: string, width = 1280, opts: { size?: { width: number; height: number }; transparent?: boolean } = {}): Promise<void> {
  const file = `${out}.html`;
  fs.writeFileSync(file, html);
  const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage(opts.size ? { viewport: opts.size, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: width / 1280 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => (document as any).fonts.ready);
    if (!(await page.evaluate(() => (document as any).fonts.check('20px Anton')))) throw new Error("the Anton font did not load");
    await page.evaluate(FIT_JS);
    const bad = await page.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
    if (bad.length) throw new Error(`images did not load: ${bad.join(", ")}`);
    // On a busy box Chromium now and then answers "Unable to capture screenshot": the page is fine, ask again.
    for (let attempt = 0; ; attempt++) {
      try { await page.screenshot(out.endsWith(".jpg") ? { path: out, type: "jpeg", quality: 90 } : { path: out, type: "png", omitBackground: !!opts.transparent }); break; }
      catch (e) { if (attempt >= 6) throw e; await page.waitForTimeout(700 * (attempt + 1)); }
    }
  } finally { await browser.close(); fs.rmSync(file, { force: true }); }
}

const page = (body: string, css = "") => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body><div class="rays"></div>${body}</body></html>`;

/** The ≤ 2 s opening card: the video's title, the kicker, the logo and the gator. */
export const introCardHtml = (title: string, kicker: string) => page(`
  <div class="burst" style="right:-190px;top:-120px;width:760px;height:1100px;transform:rotate(14deg);box-shadow:-18px 0 0 rgba(255,255,255,.95),-34px 0 0 rgba(11,63,168,.55)"></div>
  <img class="gator" src="${GATOR}" style="right:60px;bottom:-30px;height:660px">
  <div class="kicker" style="left:64px;top:150px">${esc(kicker)}</div>
  <h1 data-fit="720,300,120" style="left:60px;top:226px;max-width:720px">${esc(title)}</h1>
  <img class="logo" src="${LOGO}" style="left:64px;bottom:56px">`);

/** The ~4 s closing card. */
export const endCardHtml = () => page(`
  <div class="burst" style="left:-190px;top:-120px;width:700px;height:1100px;transform:rotate(-14deg);box-shadow:18px 0 0 rgba(255,255,255,.95),34px 0 0 rgba(11,63,168,.55)"></div>
  <img class="gator" src="${GATOR}" style="left:70px;bottom:-30px;height:660px">
  <h1 data-fit="660,260,130" style="left:590px;top:150px;max-width:660px">More<br>tutorials</h1>
  <div class="kicker" style="left:590px;top:446px;font-size:44px;letter-spacing:1px;text-transform:none;padding:10px 30px 14px">constructhub.us/tutorials</div>
  <img class="logo" src="${LOGO}" style="left:594px;bottom:56px">`, ``);

export type ThumbSpec = {
  helpKey: string; headline: string; accent?: string; kicker: string;
  /** The screenshot (PNG) and, in its own pixels, where the key element is (null: none). */
  shot: string; shotSize: { width: number; height: number }; ring: { x: number; y: number; width: number; height: number } | null;
  variant?: number;
};
export const THUMB_VARIANTS = 4;
/** The same video always gets the same layout; a channel page of many gets all four. */
export const thumbVariant = (helpKey: string): number => {
  let h = 2166136261;
  for (const c of helpKey) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % THUMB_VARIANTS;
};

/** Two or three lines: the accent word on a line of its own when there are three words or more. */
export function headlineLines(headline: string, accent?: string): string[] {
  const words = headline.trim().split(/\s+/);
  const acc = accent?.toLowerCase();
  const i = acc ? words.findIndex((w) => w.toLowerCase() === acc) : -1;
  if (i >= 0 && words.length >= 3) return [words.slice(0, i).join(" "), words[i], words.slice(i + 1).join(" ")].filter(Boolean);
  if (words.length <= 2) return words;
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/**
 * The 1280×720 YouTube thumbnail. Four layouts from one look (the hand-made Database Directory
 * thumbnail is variant 0): gator right or left, the orange panel as a tilted slab or a sun, the
 * screenshot tilted one way or the other. The bottom-right corner carries nothing that matters —
 * YouTube prints the video's length over it.
 */
export function thumbnailHtml(t: ThumbSpec): string {
  const v = t.variant ?? thumbVariant(t.helpKey);
  const right = v % 2 === 0;          // gator on the right (0, 2) or the left (1, 3)
  const sun = v >= 2;                 // the orange shape: a tilted slab (0, 1) or a sun behind the gator (2, 3)
  const acc = t.accent?.toLowerCase();
  const lines = headlineLines(t.headline, t.accent).map((l) => l.toLowerCase() === acc ? `<span class="o">${esc(l)}</span>` : esc(l)).join("<br>");

  // The screenshot crop: a 3:2 window of the shot around the key element, shown 600 px wide.
  const W = 600, H = 400, ratio = W / H;
  const cropW = Math.min(t.shotSize.width, Math.max(900, (t.ring?.width ?? 0) * 2.2)), cropH = cropW / ratio;
  const cx = t.ring ? t.ring.x + t.ring.width / 2 : t.shotSize.width / 2, cy = t.ring ? t.ring.y + t.ring.height / 2 : t.shotSize.height / 2;
  // Where in the crop the key element sits: clear of the headline and the gator. With the gator on the
  // right that is the middle of the crop; with the gator on the left (words on the right) it is the
  // lower left third, under the headline.
  const ax = right ? 0.45 : 0.33, ay = right ? 0.5 : 0.76;
  const x0 = Math.max(0, Math.min(t.shotSize.width - cropW, cx - cropW * ax)), y0 = Math.max(0, Math.min(t.shotSize.height - cropH, cy - cropH * ay));
  const k = W / cropW;
  const ring = t.ring ? `<div class="ring" style="left:${(t.ring.x - x0) * k - 10}px;top:${(t.ring.y - y0) * k - 10}px;width:${t.ring.width * k + 20}px;height:${t.ring.height * k + 20}px"></div>` : "";
  const tilt = (v === 0 || v === 3) ? -5 : 5;
  const shotLeft = right ? 430 : 400, shotTop = 286;
  const shot = `<div class="shot" style="left:${shotLeft}px;top:${shotTop}px;width:${W}px;height:${H}px;transform:rotate(${tilt}deg)">
      <img src="${pathToFileURL(t.shot).href}" style="position:absolute;left:${-x0 * k}px;top:${-y0 * k}px;width:${t.shotSize.width * k}px">${ring}</div>`;

  const burst = sun
    ? `<div class="burst" style="${right ? "right:-160px" : "left:-160px"};top:40px;width:760px;height:760px;border-radius:50%;box-shadow:0 0 0 18px rgba(255,255,255,.95),0 0 0 34px rgba(11,63,168,.55)"></div>`
    : `<div class="burst" style="${right ? "right:-180px" : "left:-180px"};top:-120px;width:900px;height:1100px;transform:rotate(${right ? 14 : -14}deg);box-shadow:${right ? "-18px 0 0 rgba(255,255,255,.95),-34px 0 0 rgba(11,63,168,.55)" : "18px 0 0 rgba(255,255,255,.95),34px 0 0 rgba(11,63,168,.55)"}"></div>`;
  const gator = `<img class="gator" src="${GATOR}" style="${right ? "right:6px" : "left:6px"};bottom:-40px;height:700px${right ? "" : ";transform:scaleX(-1)"}">`;
  // Left-gator layouts put the words on the right, ranged right, and the logo clear of the corner YouTube covers.
  const text = right
    ? `<div class="kicker" style="left:52px;top:40px">${esc(t.kicker)}</div><h1 data-fit="700,470,150" style="left:48px;top:108px">${lines}</h1><img class="logo" src="${LOGO}" style="left:52px;bottom:40px">`
    : `<div class="kicker" style="right:52px;top:40px">${esc(t.kicker)}</div><h1 data-fit="700,470,150" style="right:48px;top:108px;text-align:right">${lines}</h1><img class="logo" src="${LOGO}" style="right:250px;bottom:40px">`;
  return page(`${burst}${shot}${gator}${text}`, `
    .shot{position:absolute;overflow:hidden;border-radius:18px;border:8px solid #fff;box-shadow:0 26px 50px rgba(0,0,0,.5);background:#fff}
    .ring{position:absolute;border:7px solid #f97316;border-radius:16px;box-shadow:0 0 0 5px rgba(249,115,22,.3),0 0 26px rgba(249,115,22,.7)}`);
}
