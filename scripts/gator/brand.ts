/**
 * The three stills a gator short is dressed with — the small CHUB logo, the 1.5 s end tag and an
 * optional speech bubble — in the look of the tutorials' stills (scripts/tutorials/brand.ts): our own
 * logo, our own gator artwork (never redrawn), the bundled Anton. Nothing is fetched.
 */
import { BASE_CSS, GATOR, LOGO, esc } from "../tutorials/brand";
import { END_TAG } from "./concepts";
import { H, LOGO_RECT, W } from "./layout";

const doc = (w: number, h: number, body: string, css: string, transparent = false) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html{background:transparent}
body{width:${w}px;height:${h}px;${transparent ? "background:transparent" : "background:radial-gradient(circle at 30% 30%,#3d9bff 0%,#1a73e8 40%,#0b3fa8 100%)"}}
${css}</style></head><body>${body}<i style="font-family:Anton;position:absolute;left:0;top:0;opacity:0">.</i></body></html>`;

/** The logo on its white plate, exactly LOGO_RECT's size. */
export const logoHtml = () => doc(LOGO_RECT.w, LOGO_RECT.h, `<div class="plate"><img src="${LOGO}"></div>`, `
  .plate{position:absolute;inset:0;background:rgba(255,255,255,.94);border-radius:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 0 rgba(0,0,0,.25)}
  .plate img{height:${LOGO_RECT.h - 24}px}`, true);

/** The end tag: "ConstructHUB — run the whole job." and the address. Short, so the joke stays the last thing remembered. */
/**
 * `mascot: false` — the end tag of a LIVE-gator clip: wordmark, line and address only. The live-action gator
 * and the cartoon mascot are never mixed in one video (the owner, 2026-10-08); the mascot closes cartoon clips.
 */
export const endTagHtml = (mascot = true) => !mascot ? doc(W, H, `<div class="rays"></div>
  <img class="logo" src="${LOGO}" style="left:${W / 2 - 250}px;top:560px;height:128px;padding:20px 34px">
  <h1 data-fit="${W - 140},420,190" style="left:70px;top:800px;width:${W - 140}px;text-align:center">Run the<br><span class="o">whole</span> job.</h1>
  <div class="row" style="top:1270px"><div class="pill">${esc(END_TAG.site)}</div></div>`, `
  .row{position:absolute;left:0;width:100%;display:flex;justify-content:center}
  .pill{font-family:Anton;font-size:72px;color:#0b2f7a;background:#fff;border-radius:999px;padding:14px 46px 20px;box-shadow:0 6px 0 rgba(0,0,0,.25)}`) : doc(W, H, `<div class="rays"></div>
  <div class="burst" style="left:${W / 2 - 470}px;top:1010px;width:940px;height:940px;border-radius:50%;box-shadow:0 0 0 16px rgba(255,255,255,.95),0 0 0 30px rgba(11,63,168,.55)"></div>
  <img class="logo" src="${LOGO}" style="left:${W / 2 - 190}px;top:330px;height:96px;padding:16px 26px">
  <h1 data-fit="${W - 140},360,170" style="left:70px;top:520px;width:${W - 140}px;text-align:center">Run the<br><span class="o">whole</span> job.</h1>
  <div class="row" style="top:930px"><div class="pill">${esc(END_TAG.site)}</div></div>
  <img class="gator" src="${GATOR}" style="left:${W / 2 - 230}px;top:1060px;height:700px">`, `
  .row{position:absolute;left:0;width:100%;display:flex;justify-content:center}
  .pill{font-family:Anton;font-size:64px;color:#0b2f7a;background:#fff;border-radius:999px;padding:12px 40px 18px;box-shadow:0 6px 0 rgba(0,0,0,.25)}`);

/** A speech bubble, its tail pointing down-left or down-right. Rendered at its own size; placed by its centre. */
export const BUBBLE = { w: 620, h: 300 };
export const bubbleHtml = (text: string, tail: "left" | "right") => doc(BUBBLE.w, BUBBLE.h, `
  <div class="b"><span data-fit="${BUBBLE.w - 90},${BUBBLE.h - 120},84">${esc(text)}</span></div><div class="t"></div>`, `
  .b{position:absolute;left:8px;top:8px;width:${BUBBLE.w - 16}px;height:${BUBBLE.h - 70}px;background:#fff;border:8px solid #000;border-radius:60px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 30px}
  .b span{font-family:Anton;color:#111;line-height:1.05;text-transform:uppercase}
  .t{position:absolute;${tail}:120px;top:${BUBBLE.h - 78}px;width:0;height:0;border-left:${tail === "left" ? 10 : 50}px solid transparent;border-right:${tail === "left" ? 50 : 10}px solid transparent;border-top:70px solid #000}
  .t:after{content:"";position:absolute;left:${tail === "left" ? -4 : -36}px;top:-78px;border-left:${tail === "left" ? 6 : 36}px solid transparent;border-right:${tail === "left" ? 36 : 6}px solid transparent;border-top:54px solid #fff}`, true);
