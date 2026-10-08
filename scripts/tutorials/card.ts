/**
 * Full-screen CARDS for the recorder's `card` step (docs/tutorials/PRODUCER-GUIDE.md, "Cards"): a
 * stat ("5 SEATS"), or a two-column comparison (THEM / US), in the brand's own look — the blue
 * field, Anton, the orange pill, optionally the gator. The recorder draws the card over the page it
 * is on (inside its own overlay; nothing of it ships in the app) and films it like any other step.
 *
 * Pure: `cardHtml` turns a spec into markup and escapes every word of it. What a card may SAY is not
 * decided here — a number on a card is a claim, and shared/help/step-script.ts refuses a card that
 * shows a price without a footnote saying whose price it is and as of when.
 *
 * Everything that matters sits in the middle column (CARD_SAFE): the phone cuts (social.ts) show at
 * most that much of a 16:9 frame, so the recorder reports it as the step's target box.
 */
import fs from "fs";
import path from "path";
import type { TutorialCard } from "../../shared/help/step-script";

const HERE = import.meta.dirname;
/** The part of a 1024×576 page (CSS px) that every cut shows: x, y, width, height. */
export const CARD_SAFE = { x: 122, y: 20, width: 780, height: 430 } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataUri = (file: string, mime: string) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
let assets: { font: string; gator: string } | null = null;
/** The bundled font and the mascot, inlined: a card must not fetch anything (the slot app has no such route, and a page's CSP may refuse file: URLs). */
export function cardAssets(): { font: string; gator: string } {
  return (assets ??= {
    font: dataUri(path.join(HERE, "assets", "Anton-Regular.ttf"), "font/ttf"),
    gator: dataUri(path.join(HERE, "..", "..", "client", "public", "mascot", "gator-standing-1024.v1.webp"), "image/webp"),
  });
}

/** The headline with its accent word(s) on the orange pill. The accent is matched as written, once. */
function headline(text: string, accent?: string): string {
  if (!accent) return esc(text);
  const i = text.toLowerCase().indexOf(accent.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<span class="o">${esc(text.slice(i, i + accent.length))}</span>${esc(text.slice(i + accent.length))}`;
}

export const CARD_CSS = (font: string) => `
@font-face{font-family:TutAnton;src:url("${font}") format("truetype");font-display:block}
.tc{position:absolute;inset:0;overflow:hidden;color:#fff;font-family:TutAnton,Impact,"Arial Black",sans-serif;
  background:radial-gradient(circle at 28% 30%,#3d9bff 0%,#1a73e8 40%,#0b3fa8 100%)}
.tc *{box-sizing:border-box;margin:0}
.tc .rays{position:absolute;inset:-20%;background:repeating-conic-gradient(from 0deg at 40% 40%,rgba(255,255,255,.07) 0 6deg,transparent 6deg 14deg);animation:tcSpin 40s linear infinite}
@keyframes tcSpin{to{transform:rotate(360deg)}}
.tc .in{position:absolute;left:${CARD_SAFE.x}px;top:${CARD_SAFE.y}px;width:${CARD_SAFE.width}px;height:${CARD_SAFE.height}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center}
.tc .k{font-size:17px;letter-spacing:2px;color:#0b2f7a;background:#fff;padding:3px 14px 4px;border-radius:999px;text-transform:uppercase;box-shadow:0 4px 0 rgba(0,0,0,.25);animation:tcDrop .35s cubic-bezier(.2,1.4,.4,1) both}
.tc h1{font-weight:400;font-size:62px;line-height:1.02;text-transform:uppercase;letter-spacing:.5px;text-shadow:0 .055em 0 #082a70,0 .09em .17em rgba(0,0,0,.45);-webkit-text-stroke:.02em #082a70;paint-order:stroke fill;animation:tcPop .4s cubic-bezier(.2,1.5,.4,1) both}
.tc h1.s{font-size:44px}
.tc h1 .o{display:inline-block;background:#f97316;padding:0 .15em .04em;border-radius:.09em;transform:rotate(-2deg);-webkit-text-stroke:0;text-shadow:0 .04em 0 #9a3c06;box-shadow:0 .065em 0 #9a3c06,0 0 0 .04em #fff;margin:.03em 0 .1em}
.tc .stat{display:flex;flex-direction:column;align-items:center;gap:2px;animation:tcPop .45s .18s cubic-bezier(.2,1.5,.4,1) both}
.tc .stat b{font-weight:400;font-size:128px;line-height:.95;color:#fff;background:linear-gradient(160deg,#ffa23a,#f97316 55%,#ea580c);padding:0 .16em .05em;border-radius:.08em;transform:rotate(-2deg);box-shadow:0 .06em 0 #9a3c06,0 0 0 .035em #fff}
.tc .stat span{font-size:26px;text-transform:uppercase;letter-spacing:1px;margin-top:12px;text-shadow:0 2px 0 #082a70}
.tc .cols{display:flex;gap:18px;width:100%;align-items:stretch}
.tc .col{flex:1;border-radius:16px;padding:12px 14px 14px;display:flex;flex-direction:column;align-items:center;gap:4px;background:#e9eef6;color:#28364d;box-shadow:0 7px 0 rgba(0,0,0,.28);animation:tcSlideL .4s .15s cubic-bezier(.2,1.2,.4,1) both}
.tc .col.us{background:#fff;color:#0b2f7a;box-shadow:0 0 0 5px #f97316,0 9px 0 5px #9a3c06;animation:tcSlideR .4s .3s cubic-bezier(.2,1.2,.4,1) both}
.tc .col .t{font-size:19px;text-transform:uppercase;letter-spacing:1px;opacity:.9}
.tc .col .v{font-size:66px;line-height:1}
.tc .col.us .v{color:#f97316;text-shadow:0 3px 0 #9a3c0633}
.tc .col .u{font:600 13px/1.25 system-ui,"Segoe UI",sans-serif;opacity:.85;margin-bottom:4px}
.tc .col ul{list-style:none;padding:0;width:100%;display:flex;flex-direction:column;gap:3px}
.tc .col li{font:600 14.5px/1.25 system-ui,"Segoe UI",sans-serif;padding:4px 8px;border-radius:8px;background:rgba(11,47,122,.07)}
.tc .col.us li{background:rgba(249,115,22,.13)}
.tc .f{position:absolute;left:${CARD_SAFE.x}px;width:${CARD_SAFE.width}px;top:${CARD_SAFE.y + CARD_SAFE.height - 4}px;text-align:center;font:500 11.5px/1.3 system-ui,"Segoe UI",sans-serif;color:#e6efff;opacity:.95}
.tc .g{position:absolute;right:-6px;bottom:-26px;height:330px;filter:drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff) drop-shadow(0 10px 14px rgba(0,0,0,.45));animation:tcGator .5s .35s cubic-bezier(.2,1.6,.4,1) both}
@keyframes tcPop{from{transform:scale(.6);opacity:0}}
@keyframes tcDrop{from{transform:translateY(-30px);opacity:0}}
@keyframes tcSlideL{from{transform:translateX(-70px);opacity:0}}
@keyframes tcSlideR{from{transform:translateX(70px);opacity:0}}
@keyframes tcGator{from{transform:translateY(120px) rotate(8deg);opacity:0}}
`;

/** The card's markup (its own <style> included). `a` = cardAssets(); tests pass stand-ins. */
export function cardHtml(card: TutorialCard, a: { font: string; gator: string } = cardAssets()): string {
  const cols = card.columns?.map((c) => `<div class="col${c.us ? " us" : ""}"><div class="t">${esc(c.title)}</div>${c.value ? `<div class="v"${/^\$?\d+$/.test(c.value) ? ` data-count="${esc(c.value)}"` : ""}>${esc(c.value)}</div>` : ""}${c.unit ? `<div class="u">${esc(c.unit)}</div>` : ""}`
    + `${c.lines?.length ? `<ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}</div>`).join("") ?? "";
  const small = !!card.columns || (!!card.stat && card.headline.length > 18) || card.headline.length > 34;
  return `<div class="tc"><style>${CARD_CSS(a.font)}</style><div class="rays"></div>`
    + `<div class="in">${card.kicker ? `<div class="k">${esc(card.kicker)}</div>` : ""}<h1${small ? ` class="s"` : ""}>${headline(card.headline, card.accent)}</h1>`
    + `${card.stat ? `<div class="stat"><b${/^\$?\d+$/.test(card.stat.value) ? ` data-count="${esc(card.stat.value)}"` : ""}>${esc(card.stat.value)}</b><span>${esc(card.stat.label)}</span></div>` : ""}`
    + `${cols ? `<div class="cols">${cols}</div>` : ""}</div>`
    + `${card.footnote ? `<div class="f">${esc(card.footnote)}</div>` : ""}${card.mascot ? `<img class="g" alt="" src="${a.gator}">` : ""}</div>`;
}
