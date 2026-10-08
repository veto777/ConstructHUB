/**
 * The stills of a social cut (scripts/tutorials/social.ts), in the look of the YouTube thumbnail
 * (brand.ts): the blue field with faint rays, Anton capitals with a dark-blue edge, one word on an
 * orange pill, the standing gator (never redrawn, recoloured or stretched) and the CHUB logo.
 *
 *   frameHtml   the frame around the screen recording — see-through where the recording and the
 *               progress bar show: kicker + hook headline above, mascot + address below
 *   hookHtml    the first second and a half: the headline, large, over the moving recording
 *   endHtml     the 2 s end card
 *   coverHtml   the cover image of a cut (what a profile grid shows)
 *
 * Deterministic, nothing fetched: our own artwork and the bundled font only.
 */
import { pathToFileURL } from "url";
import { BASE_CSS, GATOR, LOGO, esc, headlineLines } from "./brand";
import type { Layout } from "./social-lib";

export type HookSpec = { headline: string; accent?: string; kicker: string };
export const SITE = "constructhub.us/tutorials";

const FIELD = "radial-gradient(circle at 30% 30%,#3d9bff 0%,#1a73e8 40%,#0b3fa8 100%)";
const doc = (l: Layout, body: string, css: string, opts: { transparent?: boolean; width?: number; height?: number } = {}) => {
  const w = opts.width ?? l.width, h = opts.height ?? l.height;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html{background:transparent}
body{width:${w}px;height:${h}px;background:${opts.transparent ? "transparent" : FIELD}}
.pill{position:absolute;font-family:Anton;color:#0b2f7a;background:#fff;border-radius:999px;white-space:nowrap;box-shadow:0 6px 0 rgba(0,0,0,.25)}
${css}</style></head><body>${body}</body></html>`;
};
const headlineHtml = (h: HookSpec, lines: boolean): string => {
  const acc = h.accent?.toLowerCase();
  const mark = (w: string) => (w.toLowerCase() === acc ? `<span class="o">${esc(w)}</span>` : esc(w));
  return lines ? headlineLines(h.headline, h.accent).map((line) => line.split(/\s+/).map(mark).join(" ")).join("<br>") : h.headline.trim().split(/\s+/).map(mark).join(" ");
};

/** The frame: opaque brand field above and below, a hole where the recording and the progress bar are. */
export function frameHtml(l: Layout, h: HookSpec): string {
  const below = l.bar.y + l.bar.h, vertical = l.name === "vertical";
  // Each block shows its own part of ONE field the size of the canvas, so the blue reads as continuous.
  const block = (top: number, height: number, inner: string) => `<div class="blk" style="top:${top}px;height:${height}px"><div class="fld" style="top:${-top}px"><div class="rays"></div></div>${inner}</div>`;
  const kickerH = vertical ? 54 : 46;
  const head = `
    <div class="pill" style="left:${l.header.x}px;top:${l.header.y}px;font-size:${vertical ? 30 : 26}px;letter-spacing:3px;text-transform:uppercase;padding:${vertical ? "6px 22px 8px" : "5px 18px 6px"}">${esc(h.kicker)}</div>
    <h1 data-fit="${l.header.w},${l.header.h - kickerH - 10},${vertical ? 124 : 104}" style="left:${l.header.x}px;top:${l.header.y + kickerH + 6}px;width:${l.header.w}px;line-height:1.04">${headlineHtml(h, false)}</h1>
    ${vertical ? `<img class="logo" src="${LOGO}" style="left:${l.width / 2 - 96}px;top:160px;height:44px;padding:9px 16px;border-radius:12px">` : ""}
    <div class="rule" style="bottom:0"></div>`;
  const fy = l.footer.y - below;
  const foot = vertical
    ? `<img class="gator" src="${GATOR}" style="left:26px;top:${fy + 40}px;height:330px">
       <div class="pill" style="left:330px;top:${fy + 150}px;font-size:44px;padding:10px 30px 14px">${SITE}</div>
       <div class="more" style="left:336px;top:${fy + 92}px">MORE TUTORIALS</div>`
    : `<img class="gator" src="${GATOR}" style="left:14px;top:${fy - 26}px;height:160px;filter:drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff)">
       <div class="pill" style="left:190px;top:${fy + 34}px;font-size:40px;padding:8px 28px 12px">${SITE}</div>
       <img class="logo" src="${LOGO}" style="right:40px;top:${fy + 30}px;height:46px;padding:10px 18px;border-radius:12px">`;
  return doc(l, `${block(0, l.panel.y, head)}${block(below, l.height - below, foot)}`, `
    .blk{position:absolute;left:0;width:${l.width}px;overflow:hidden}
    .fld{position:absolute;left:0;width:${l.width}px;height:${l.height}px;background:${FIELD}}
    .rule{position:absolute;left:0;width:100%;height:6px;background:#fff}
    .more{position:absolute;font-size:34px;letter-spacing:4px;color:#fff;text-shadow:0 3px 0 #082a70}`, { transparent: true });
}

/** The hook: the headline large over the recording (a see-through blue wash keeps the motion visible), the gator leaning in. */
export function hookHtml(l: Layout, h: HookSpec): string {
  const W = l.panel.w, H = l.panel.h;
  return doc(l, `
    <div class="wash"></div>
    <img class="gator" src="${GATOR}" style="right:-36px;bottom:-44px;height:${Math.round(H * 0.8)}px">
    <div class="pill" style="left:44px;top:40px;font-size:34px;letter-spacing:3px;text-transform:uppercase;padding:6px 24px 8px">${esc(h.kicker)}</div>
    <h1 data-fit="${W - 410},${H - 190},190" style="left:44px;top:118px;width:${W - 410}px">${headlineHtml(h, true)}</h1>`, `
    .wash{position:absolute;inset:0;background:linear-gradient(100deg,rgba(8,42,112,.9) 0%,rgba(11,63,168,.78) 55%,rgba(26,115,232,.45) 100%)}`, { transparent: true, width: W, height: H });
}

/** The end card (2 s). A cut that stops before the master does says where the rest is. */
export function endHtml(l: Layout, truncated: boolean): string {
  const vertical = l.name === "vertical", top = vertical ? 300 : 56, cx = l.width / 2;
  const title = truncated ? "Full walkthrough<br>on <span class=\"o\">YouTube</span>" : "More <span class=\"o\">tutorials</span> at";
  const fitH = truncated ? (vertical ? 330 : 270) : (vertical ? 190 : 160);
  const gatorTop = top + 96 + fitH + (vertical ? 170 : 140), gatorH = (vertical ? 1500 : l.height + 20) - gatorTop;
  return doc(l, `<div class="rays"></div>
    <div class="burst" style="left:${cx - 520}px;top:${gatorTop + 60}px;width:1040px;height:1040px;border-radius:50%;box-shadow:0 0 0 16px rgba(255,255,255,.95),0 0 0 30px rgba(11,63,168,.55)"></div>
    <img class="logo" src="${LOGO}" style="left:${cx - 124}px;top:${top}px;height:60px;padding:12px 20px">
    <h1 data-fit="${l.width - 110},${fitH},170" style="left:55px;top:${top + 104}px;width:${l.width - 110}px;text-align:center">${title}</h1>
    <div class="pillrow" style="top:${top + 112 + fitH}px"><div class="pill" style="position:static;font-size:${vertical ? 62 : 58}px;padding:12px 38px 18px">${SITE}</div></div>
    <img class="gator" src="${GATOR}" style="left:${cx - gatorH / 2}px;top:${gatorTop}px;height:${gatorH}px">`, `
    .pillrow{position:absolute;left:0;width:100%;display:flex;justify-content:center}`);
}

export type CoverSpec = HookSpec & {
  /** The screenshot and, in its own pixels, the key element (null: none). */
  shot: string; shotSize: { width: number; height: number }; ring: { x: number; y: number; width: number; height: number } | null;
};
/** The cover of a cut: the thumbnail's parts restacked for a tall frame, everything that matters inside the centre a grid shows. */
export function coverHtml(l: Layout, c: CoverSpec): string {
  const vertical = l.name === "vertical";
  const W = vertical ? 700 : 640, H = vertical ? 470 : 420;
  const cropW = Math.min(c.shotSize.width, Math.max(900, (c.ring?.width ?? 0) * 2.2)), cropH = (cropW * H) / W, k = W / cropW;
  const cx = c.ring ? c.ring.x + c.ring.width / 2 : c.shotSize.width / 2, cy = c.ring ? c.ring.y + c.ring.height / 2 : c.shotSize.height / 2;
  const x0 = Math.max(0, Math.min(c.shotSize.width - cropW, cx - cropW * 0.4)), y0 = Math.max(0, Math.min(c.shotSize.height - cropH, cy - cropH * 0.5));
  const ring = c.ring ? `<div class="ring" style="left:${(c.ring.x - x0) * k - 10}px;top:${(c.ring.y - y0) * k - 10}px;width:${c.ring.width * k + 20}px;height:${c.ring.height * k + 20}px"></div>` : "";
  const top = vertical ? 300 : 44, headH = vertical ? 500 : 400, shotTop = top + 80 + headH + (vertical ? 40 : 26);
  const gatorH = vertical ? 820 : 700, gatorTop = vertical ? 1500 - gatorH + 60 : l.height - gatorH + 30;
  return doc(l, `<div class="rays"></div>
    <div class="burst" style="right:-240px;top:${gatorTop + 60}px;width:820px;height:820px;border-radius:50%;box-shadow:0 0 0 16px rgba(255,255,255,.95),0 0 0 30px rgba(11,63,168,.55)"></div>
    <div class="shot" style="left:44px;top:${shotTop}px;width:${W}px;height:${H}px;transform:rotate(-4deg)">
      <img src="${pathToFileURL(c.shot).href}" style="position:absolute;left:${-x0 * k}px;top:${-y0 * k}px;width:${c.shotSize.width * k}px">${ring}</div>
    <img class="gator" src="${GATOR}" style="right:-70px;top:${gatorTop}px;height:${gatorH}px">
    <div class="pill" style="left:54px;top:${top}px;font-size:38px;letter-spacing:3px;text-transform:uppercase;padding:7px 26px 9px">${esc(c.kicker)}</div>
    <h1 data-fit="${l.width - 100},${headH},200" style="left:50px;top:${top + 80}px;width:${l.width - 100}px">${headlineHtml(c, true)}</h1>
    <img class="logo" src="${LOGO}" style="left:54px;top:${vertical ? 1400 : l.height - 120}px;height:56px;padding:11px 20px">`, `
    .shot{position:absolute;overflow:hidden;border-radius:18px;border:8px solid #fff;box-shadow:0 26px 50px rgba(0,0,0,.5);background:#fff}
    .ring{position:absolute;border:7px solid #f97316;border-radius:16px;box-shadow:0 0 0 5px rgba(249,115,22,.3),0 0 26px rgba(249,115,22,.7)}`);
}
