/**
 * Walkthrough recorder — stage 1 of docs/tutorials/VIDEO-PIPELINE.md.
 *
 *   tsx scripts/tutorials/record.ts docs/tutorials/scripts/<helpKey>.json [--base http://portal.constructhub.us:8181]
 *        [--out analysis/video-out/<helpKey>] [--pad 450] [--lead 150] [--label "Demo Account"]
 *        [--company "Aspire Interiors"] [--shots] [--no-narration] [--dry]
 *
 * Plays the step script in headless Chromium, films it from Chromium's own screencast, and writes
 *   raw.mkv       the screen capture at device pixels (with a pre-roll that mux.ts cuts off)
 *   timings.json  where every step starts and ends in it — and what it pointed at (the target's box,
 *                 when its ring left, the pointer's path), which social.ts uses to frame the phone cuts
 *
 * Run narrate.ts FIRST: each step is held for its measured narration clip plus a short pad, so the
 * picture and the voice line up without editing. (--no-narration estimates the lengths from the
 * text — for trying a script out, never for a video that ships.)
 *
 * What the recorder adds to the page, in the recording context ONLY (nothing here ships in the app):
 *   · a visible cursor that glides, a click ripple, and a highlight ring that follows its target
 *   · the address of the link under the cursor, bottom-left, the way a desktop browser shows it
 *   · cookie `ch_consent=denied` (no cookie banner), the assistant bubble hidden, and the signed-in
 *     account shown as "Demo Account" with a customer's menu and no unread notifications (the
 *     responses of /api/auth/me and /api/notifications are relabelled / emptied on their way to the
 *     page — the database is never written to).
 * Everything else on screen is the product as it runs against the dev database.
 *
 * MORE THAN ONE PERSON. A `session` step switches the camera to another person's browser — the
 * homeowner on the client portal's host, or a team member really signed in as themselves — each a
 * separate browser context with its own cookies and its own cursor. Only the session on camera is
 * filmed. `upload` chooses demo files from scripts/tutorials/assets/ (never anything else), `drag`
 * carries a card with the pointer, `fixture` calls a tutorial fixture helper of the slot app
 * (docs/tutorials/FIXTURES.md — recording slots only), `wait-for` waits for something to appear.
 *
 * A page that loads whole (a link to a new document, Back, a redirect through checkout) is not
 * filmed while it is blank: the capture HOLDS the last frame of the page before it until the new
 * one has drawn. A target that sits in the caption strip inside a dialog that cannot scroll is
 * brought up by moving the dialog itself, before the ring is drawn.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from "playwright";
import type { TutorialStep } from "../../shared/help/step-script";
import { ROOT, flagNum, flagStr, loadScript, outDir, parseArgs, sleep, type NarrationIndex, type StepTiming, type Timings } from "./lib";

/** The only place an `upload` step may take files from: generated demo files (gen-assets.ts). */
export const ASSETS_DIR = path.join(ROOT, "scripts", "tutorials", "assets");
import { isCrmRoute } from "../../shared/help/registry";
import { CARD_SAFE, cardHtml } from "./card";

/** Injected into every document of the recording context. Plain JS: it runs in the page. */
function overlay() {
  const w = window as any;
  if (w.__tut) return;
  const css = `
    #__tut{position:fixed;inset:0;pointer-events:none;z-index:2147483647;--tut-accent:hsl(25 95% 53%);font-family:inherit}
    #__tut *{box-sizing:border-box}
    #__tut .cur{position:absolute;left:0;top:0;width:26px;height:26px;margin:-3px 0 0 -5px;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
    #__tut .ring{position:absolute;left:0;top:0;border:3px solid var(--tut-accent);border-radius:12px;opacity:0;
      box-shadow:0 0 0 5px color-mix(in srgb,var(--tut-accent) 22%,transparent),0 0 22px color-mix(in srgb,var(--tut-accent) 35%,transparent);
      transition:opacity .28s ease}
    #__tut .ring.on{opacity:1;animation:__tutPulse 1.8s ease-in-out infinite}
    @keyframes __tutPulse{50%{box-shadow:0 0 0 9px color-mix(in srgb,var(--tut-accent) 12%,transparent),0 0 30px color-mix(in srgb,var(--tut-accent) 30%,transparent)}}
    #__tut .rip{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid var(--tut-accent);
      background:color-mix(in srgb,var(--tut-accent) 18%,transparent);animation:__tutRip .5s ease-out forwards}
    @keyframes __tutRip{from{transform:scale(.25);opacity:.95}to{transform:scale(1.15);opacity:0}}
    #__tut .url{position:absolute;left:0;bottom:0;max-width:70%;padding:5px 12px 6px;border-top-right-radius:8px;background:#f1f3f4;color:#3c4043;
      border:1px solid #dadce0;border-left:0;border-bottom:0;font:13px/1.3 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .15s}
    #__tut .url.on{opacity:1}
    #__tut .veil{position:absolute;inset:0;background:#fff;opacity:1;transition:opacity .18s ease}
    #__tut .veil.off{opacity:0}
    #__tut .sync{position:absolute;inset:0;background:#000;display:none}
    #__tut .sync.on{display:block}
    .__tut-blur{filter:blur(7px)!important}
    #__tut .card{position:absolute;inset:0;display:none}
    #__tut.carding .card{display:block}
    #__tut.carding .cur,#__tut.carding .ring,#__tut.carding .url{display:none}
    /* The assistant launcher and its welcome bubble are not part of any feature being taught. */
    [data-testid="hub-launcher"],[data-testid="hub-welcome-bubble"],[data-testid="hub-panel"]{display:none!important}
    /* …nor is the unread count on the CRM's bell. */
    [data-testid="badge-notifications-unread"]{display:none!important}
    #__tut.shot .cur{display:none}
    #__tut .ghost{position:absolute;left:0;top:0;opacity:.88;border-radius:10px;overflow:hidden;box-shadow:0 14px 34px rgba(0,0,0,.28);will-change:transform;rotate:2deg}
    #__tut .ghost>*{margin:0!important;width:100%!important;height:100%!important}
  `;
  const root = document.createElement("div");
  root.id = "__tut";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<style>${css}</style><div class="veil"></div><div class="ring"></div><div class="url"></div>
    <div class="card"></div><svg class="cur" viewBox="0 0 26 26"><path d="M5 3v18.2l4.7-4.4 3 7 3.1-1.3-3-6.9H19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="sync"></div>`;
  const ring = root.querySelector(".ring") as HTMLElement, cur = root.querySelector(".cur") as HTMLElement;
  const url = root.querySelector(".url") as HTMLElement;
  let pos = { x: Math.round(innerWidth * 0.93), y: Math.round(innerHeight * 0.55) }; // the page's empty right margin
  try { const saved = JSON.parse(sessionStorage.getItem("__tut_xy") || "null"); if (saved) pos = saved; } catch { /* first document */ }
  const place = () => { cur.style.transform = `translate(${pos.x}px,${pos.y}px)`; };
  place();
  let target: Element | null = null, pad = 6;
  // One ring colour everywhere — the brand orange — so it reads the same on the blue and on the dark surfaces.
  const accent = () => {};
  const frame = () => {
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      ring.style.transform = `translate(${r.left - pad}px,${r.top - pad}px)`;
      ring.style.width = `${r.width + pad * 2}px`;
      ring.style.height = `${r.height + pad * 2}px`;
    } else if (target) { target = null; ring.classList.remove("on"); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener("mousemove", (e) => {
    pos = { x: e.clientX, y: e.clientY }; place();
    try { sessionStorage.setItem("__tut_xy", JSON.stringify(pos)); } catch { /* storage off */ }
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    // Only for a link that leaves the site: where it goes is the point of hovering it.
    if (a && /^https?:/.test(a.href) && a.origin !== location.origin) { url.textContent = a.href; url.classList.add("on"); } else url.classList.remove("on");
  }, true);
  // A native drag sends no mousemove: the pointer is followed from the drag events, and the thing
  // being carried is drawn (a headless browser has no drag image of its own).
  let ghost: HTMLElement | null = null, grab = { x: 0, y: 0 };
  const carry = () => { if (ghost) ghost.style.transform = `translate(${pos.x - grab.x}px,${pos.y - grab.y}px)`; };
  addEventListener("dragstart", (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    grab = { x: pos.x - r.left, y: pos.y - r.top };
    ghost = document.createElement("div");
    ghost.className = "ghost"; ghost.style.width = `${r.width}px`; ghost.style.height = `${r.height}px`;
    const copy = el.cloneNode(true) as HTMLElement; copy.removeAttribute("data-testid"); copy.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
    ghost.appendChild(copy); root.appendChild(ghost); carry();
    target = null; ring.classList.remove("on");
  }, true);
  for (const type of ["dragover", "drag"]) addEventListener(type, (e) => {
    const d = e as DragEvent;
    if (!d.clientX && !d.clientY) return; // the last `drag` of a gesture reports 0,0
    pos = { x: d.clientX, y: d.clientY }; place(); carry();
    try { sessionStorage.setItem("__tut_xy", JSON.stringify(pos)); } catch { /* storage off */ }
  }, true);
  for (const type of ["dragend", "drop"]) addEventListener(type, () => { ghost?.remove(); ghost = null; }, true);
  // One tab is filmed: a link that would open a new one opens here instead (the script comes back with `back`).
  addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[target]") as HTMLAnchorElement | null;
    if (a && a.target && a.target !== "_self") a.target = "_self";
  }, true);
  addEventListener("mousedown", () => {
    const rip = document.createElement("div");
    rip.className = "rip"; rip.style.left = `${pos.x}px`; rip.style.top = `${pos.y}px`;
    root.appendChild(rip); setTimeout(() => rip.remove(), 600);
  }, true);
  // A page that loads whole (a link that opens a new document, Back) first shows the plain text the
  // server sends for search engines, for as long as the app takes to start. A white veil covers that
  // moment; it lifts when the app has drawn something of its own (or after six seconds, whatever).
  const veil = root.querySelector(".veil") as HTMLElement;
  const veilFrom = Date.now();
  let veilGone = false;
  const lift = () => {
    if (document.querySelector("[data-testid]:not(#__tut *)") || Date.now() - veilFrom > 6000 || location.protocol === "about:") { veil.classList.add("off"); setTimeout(() => { veil.remove(); veilGone = true; }, 250); return; }
    requestAnimationFrame(lift);
  };
  requestAnimationFrame(lift);
  const mount = () => { if (!root.isConnected) document.documentElement.appendChild(root); accent(); };
  if (document.documentElement) mount();
  document.addEventListener("DOMContentLoaded", mount);
  w.__tut = {
    ring(el: Element | null, padding = 6) { mount(); target = el; pad = padding; accent(); ring.classList.toggle("on", !!el); },
    has() { return !!(target && target.isConnected); },
    /** True once the app has drawn (the veil is gone): a page that loaded whole may be filmed again. */
    drawn() { return veilGone; },
    /** Make the compositor produce a frame (the screencast only sends one when something changed). */
    nudge() { mount(); cur.style.opacity = cur.style.opacity === "0.999" ? "1" : "0.999"; },
    blur(el: Element) { el.classList.add("__tut-blur"); },
    /** A full-screen card over the page (markup from scripts/tutorials/card.ts), or null to take it away. Whole figures count up. */
    card(html: string | null) {
      mount();
      const box = root.querySelector(".card") as HTMLElement;
      root.classList.toggle("carding", !!html);
      box.innerHTML = html ?? "";
      for (const el of Array.from(box.querySelectorAll("[data-count]")) as HTMLElement[]) {
        const full = el.getAttribute("data-count")!, pre = full.startsWith("$") ? "$" : "", end = Number(full.replace("$", "")), t0 = performance.now(), wait = 260, dur = 620;
        if (!Number.isFinite(end)) continue;
        el.textContent = `${pre}0`;
        const tick = (t: number) => {
          const u = Math.min(1, Math.max(0, (t - t0 - wait) / dur)), e = 1 - Math.pow(1 - u, 3);
          el.textContent = `${pre}${Math.round(end * e)}`;
          if (u < 1 && el.isConnected) requestAnimationFrame(tick); else if (el.isConnected) el.textContent = full;
        };
        requestAnimationFrame(tick);
      }
    },
    /**
     * Push in on an element (the page is scaled about its centre), or null to come back out. The
     * overlay is not inside <body>, so the ring and the cursor keep their size and follow the element.
     */
    punch(el: Element | null, scale = 1.35) {
      const b = document.body;
      if (!b) return;
      b.style.transition = "transform .5s cubic-bezier(.2,.8,.2,1)";
      if (!el) { b.style.transform = ""; setTimeout(() => { if (!b.style.transform) { b.style.transformOrigin = ""; b.style.transition = ""; } }, 560); return; }
      const r = el.getBoundingClientRect(), o = b.getBoundingClientRect();
      b.style.transformOrigin = `${r.left + r.width / 2 - o.left}px ${r.top + r.height / 2 - o.top}px`;
      b.style.transform = `scale(${scale})`;
    },
    /** A full black frame: the mark mux.ts looks for to line the video's clock up with the recorder's. */
    sync(on: boolean) { mount(); (root.querySelector(".sync") as HTMLElement).classList.toggle("on", on); },
    /** For the thumbnail's screenshot: the cursor off, and where the ring is (CSS px), or null. */
    shot(on: boolean) {
      root.classList.toggle("shot", on);
      if (!target || !target.isConnected) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
  };
}

/** The stylesheet behind a script's `redactSelectors`: unreadable from the first paint, on every page of the recording. */
export const redactCss = (selectors: readonly string[]): string => `${selectors.join(",")}{filter:blur(9px)!important;user-select:none!important}`;
/** Runs in every document before any of its own scripts: the rule is in place before the app can draw the element. */
function redactFromLoad(css: string) {
  const add = () => { if (document.getElementById("__tut-redact") || !document.documentElement) return !!document.getElementById("__tut-redact"); const s = document.createElement("style"); s.id = "__tut-redact"; s.textContent = css; document.documentElement.appendChild(s); return true; };
  if (!add()) { new MutationObserver((_m, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true }); document.addEventListener("DOMContentLoaded", add); }
}

/** On a busy box Chromium now and then answers "Unable to capture screenshot": the page is fine — ask again. */
export async function screenshot(page: Pick<Page, "screenshot" | "waitForTimeout">, file: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try { await page.screenshot({ path: file }); return; }
    catch (e) { if (attempt >= attempts) throw e; await page.waitForTimeout(400 * attempt); }
  }
}

/** Width and height of a JPEG, from its SOF marker. */
function jpegSize(b: Buffer): { width: number; height: number } | null {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * {{DATE}}, {{DATE+2}}, {{DATE-1}}: a day relative to today (yyyy-mm-dd, the workspace's time zone) — the
 * demo data moves with the calendar, so a script never names a fixed date. Anything else is an env value.
 */
export const fill = (v: string) => v.replace(/\{\{DATE([+-]\d+)?\}\}/g, (_m, n?: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + Number(n ?? 0) * 86400000)),
).replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`The script needs ${name} in the environment`);
  return value;
});

/** The demo files of an `upload` step, as absolute paths — refused unless they are inside the assets folder and exist. */
export function assetFiles(names: string[]): string[] {
  return names.map((name) => {
    const file = path.resolve(ASSETS_DIR, name);
    if (!file.startsWith(ASSETS_DIR + path.sep)) throw new Error(`upload: ${name} is outside scripts/tutorials/assets/`);
    if (!fs.existsSync(file)) throw new Error(`upload: scripts/tutorials/assets/${name} does not exist (npx tsx scripts/tutorials/gen-assets.ts makes the demo files)`);
    return file;
  });
}

/** The strip at the bottom of the page (CSS px) that captions cover: ~17% of the height. */
export const CAPTION_SAFE = (height: number) => Math.round(height * 0.17);

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type TargetBox = { x: number; y: number; width: number; height: number };

/** A click's ring is taken away this long after the click (it would otherwise sit on whatever the click opened). */
export const RING_OFF_AFTER_CLICK_MS = 450;
/**
 * A page that a step OPENED WHOLE (a click on a link out of the app, a Preview, a checkout) stays on
 * screen at least this long after it has drawn, before anything leaves it again — a `back` right
 * after such a click used to show the page for under half a second.
 */
export const MIN_PAGE_DWELL_MS = 1600;
/** How much longer the page on camera must stay: `shownAtMs` is when it finished drawing (null: it was there all along). */
export const dwellLeft = (shownAtMs: number | null, nowMs: number, min: number = MIN_PAGE_DWELL_MS): number => (shownAtMs == null ? 0 : Math.max(0, shownAtMs + min - nowMs));

export class Player {
  pos: { x: number; y: number };
  /** `now` is the recording's clock (ms since the capture started): every session's player shares it. */
  constructor(private page: Page, private viewport: { width: number; height: number }, private now: () => number = () => Date.now()) {
    this.pos = { x: Math.round(viewport.width * 0.93), y: Math.round(viewport.height * 0.55) };
  }

  // What a step pointed at, for the social cuts (social.ts crops the recording around it): the target's
  // box where it came to rest, when its ring was taken away, and the pointer's path. Reset per step.
  private aimed: TargetBox | null = null;
  private ringOffAt: number | null = null;
  private path: [number, number, number][] = [];
  beginStep() { this.aimed = null; this.ringOffAt = null; this.path = []; }
  /** The step's record. The box is read again at the end when the ring is still on its element (it may have moved). */
  async endStep(): Promise<{ target: TargetBox | null; ringOffMs: number | null; cursor: [number, number, number][] }> {
    const round = (b: TargetBox): TargetBox => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 });
    const still = this.ringed ? await this.ringed.boundingBox({ timeout: 300 }).catch(() => null) : null;
    const box = still ?? this.aimed;
    return { target: box ? round(box) : null, ringOffMs: this.ringOffAt, cursor: this.path };
  }

  /** Move the pointer along a slightly bowed path, slow–fast–slow, so it glides instead of jumping. */
  async glide(to: { x: number; y: number }) {
    const from = this.pos, dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const duration = Math.max(450, Math.min(1100, 320 + dist * 0.9));
    const n = Math.max(14, Math.round(duration / 16));
    const bow = Math.min(40, dist * 0.07), nx = -dy / dist, ny = dx / dist;
    const started = Date.now();
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n), arc = Math.sin(Math.PI * t) * bow;
      await this.page.mouse.move(from.x + dx * t + nx * arc, from.y + dy * t + ny * arc);
      if (i % 6 === 0 || i === n) this.path.push([this.now(), Math.round(from.x + dx * t + nx * arc), Math.round(from.y + dy * t + ny * arc)]);
      const due = started + (duration * i) / n;
      if (due > Date.now()) await sleep(due - Date.now());
    }
    this.pos = to;
  }

  /**
   * Requests the page has in flight (not the long-lived ones: an event stream or a socket never ends).
   * `quiet()` waits for what a click or a choice set off to come back — on a loaded box that takes
   * anything from 50 ms to 2 s, and a fixed pause was either too short (the next step pointed at a
   * page that was not there yet; producers padded every step with holdMs 1200) or wasted time.
   */
  private inflight = new Set<unknown>();
  private lastNet = 0;
  watchNetwork() {
    const done = (r: unknown) => { if (this.inflight.delete(r)) this.lastNet = Date.now(); };
    this.page.on("request", (r) => { if (["xhr", "fetch", "document", "script"].includes(r.resourceType())) { this.inflight.add(r); this.lastNet = Date.now(); } });
    this.page.on("requestfinished", done); this.page.on("requestfailed", done);
    this.page.on("framenavigated", (f) => { if (f === this.page.mainFrame()) this.inflight.clear(); });
    return this;
  }
  /** Until nothing has been in flight for `calmMs` (at most `maxMs`; a request older than that is a stream, not an answer). */
  async quiet(calmMs = 350, maxMs = 3500) {
    const from = Date.now();
    await sleep(60); // let the click's own request start
    while (Date.now() - from < maxMs) {
      if (!this.inflight.size && Date.now() - Math.max(this.lastNet, from) >= calmMs) return;
      if (!this.inflight.size && this.lastNet < from && Date.now() - from >= calmMs) return;
      await sleep(50);
    }
  }
  /** A card is up / the page is pushed in: both are undone before the next step does anything. */
  punched = false;
  async clearStage() {
    await this.page.evaluate(() => { const t = (window as any).__tut; if (!t) return false; const had = !!document.querySelector("#__tut.carding"); t.card(null); return had; }).catch(() => false);
    if (this.punched) { this.punched = false; await this.page.evaluate(() => (window as any).__tut?.punch(null)).catch(() => {}); await sleep(520); }
  }
  private ringed: Locator | null = null;
  private ringOffTimer: ReturnType<typeof setTimeout> | null = null;
  /** After a click: the ring goes a moment later. Cancelled by the next `ring()` — it must never wipe the NEXT step's ring. */
  ringOffSoon(ms: number = RING_OFF_AFTER_CLICK_MS) {
    if (this.ringOffTimer) clearTimeout(this.ringOffTimer);
    this.ringOffTimer = setTimeout(() => { this.ringOffTimer = null; void this.ring(null).catch(() => {}); }, ms);
  }
  async ring(target: Locator | null) {
    // Whoever rings (or clears) now decides: a pending "take the click's ring away" is void.
    if (this.ringOffTimer) { clearTimeout(this.ringOffTimer); this.ringOffTimer = null; }
    if (!target && this.ringed) this.ringOffAt = this.now();
    this.ringed = target;
    if (target) await target.evaluate((el) => (window as any).__tut?.ring(el));
    else await this.page.evaluate(() => (window as any).__tut?.ring(null)).catch(() => {});
  }
  /**
   * A list that reloads replaces its rows, and the ring's element with them. Called while a step is
   * held: when the ring has lost its element, it is put back on whatever the selector matches now.
   */
  async keepRing() {
    const target = this.ringed;
    if (!target) return;
    const lost = await this.page.evaluate(() => !(window as any).__tut?.has()).catch(() => false);
    if (lost && this.ringed === target) await target.evaluate((el) => (window as any).__tut?.ring(el), undefined, { timeout: 400 }).catch(() => {});
  }

  /** Bring the target on screen and return the point to aim at (inside it, never over its far edge). */
  private async aim(target: Locator): Promise<{ x: number; y: number }> {
    await target.waitFor({ state: "visible", timeout: 20_000 });
    // The bottom of the frame belongs to the captions (the player draws them there, and so does YouTube):
    // a target that sits in it is brought up to the middle of the page first.
    const scrolled = await target.evaluate((el, safe) => {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - safe) { el.scrollIntoView({ block: "center", behavior: "smooth" }); return true; }
      return false;
    }, CAPTION_SAFE(this.viewport.height));
    // Wait for a smooth scroll (or a list that is still settling) to stop moving the target. A smooth
    // scroll can take a moment to START on a busy machine, so "has not moved yet" is not "has stopped":
    // give it time to begin, and ask for two still readings in a row.
    if (scrolled) await sleep(350);
    let last = await target.boundingBox();
    for (let i = 0, still = 0; i < 24 && still < 2; i++) {
      await sleep(120);
      const box = await target.boundingBox();
      still = box && last && Math.abs(box.y - last.y) < 0.5 && Math.abs(box.x - last.x) < 0.5 ? still + 1 : 0;
      last = box;
    }
    if (!last) throw new Error("target has no box");
    // Still in the caption strip: it is inside something that does not scroll — a dialog's row of
    // buttons, a bar fixed to the bottom. Move that whole thing up, just enough, before any ring is drawn.
    const safe = CAPTION_SAFE(this.viewport.height);
    if (last.y + last.height > this.viewport.height - safe) {
      const lifted = await target.evaluate((el, strip) => {
        const over = el.getBoundingClientRect().bottom - (innerHeight - strip - 10);
        if (over <= 0) return 0;
        let host = el.closest('[role="dialog"],[role="alertdialog"]') as HTMLElement | null;
        for (let n = el.parentElement; !host && n; n = n.parentElement) if (getComputedStyle(n).position === "fixed") host = n as HTMLElement;
        if (!host) return 0;
        const lift = Math.min(over, Math.max(0, host.getBoundingClientRect().top - 8));
        if (lift < 1) return 0;
        const total = Number(host.dataset.tutLift || 0) + lift;
        host.dataset.tutLift = String(total);
        // The `translate` property adds to whatever transform positions or animates the element (a centred
        // dialog, a sheet anchored to the bottom), so it works for both without touching their own styles.
        host.style.transition = `${host.style.transition ? `${host.style.transition}, ` : ""}translate .25s ease`;
        host.style.translate = `0 ${-total}px`;
        return lift;
      }, safe);
      if (lifted) { await sleep(380); last = (await target.boundingBox()) ?? last; }
    }
    // Where the target came to rest (after any scroll or lift): what social.ts frames the phone cuts around.
    this.aimed = last;
    const wide = last.width > 320;
    const point = {
      x: Math.round(last.x + (wide ? Math.min(last.width * 0.3, 220) : last.width / 2)),
      y: Math.round(last.y + (last.height > 120 ? last.height * 0.6 : last.height / 2)),
    };
    // A big block may run into the caption strip; what matters is where the pointer lands.
    if (point.y > this.viewport.height - CAPTION_SAFE(this.viewport.height))
      console.warn(`  ! ${String(target)} is in the caption area at the bottom and cannot scroll up — keep that line short and check the frame`);
    return point;
  }

  async play(step: TutorialStep, base: string) {
    const page = this.page;
    if (step.action === "goto") {
      await this.ring(null);
      await page.goto(hostFor(step.url!, base), { waitUntil: "domcontentloaded" });
      await settle(page);
      return;
    }
    if (step.action === "wait") return;
    if (step.action === "back") { await this.ring(null); await page.goBack({ waitUntil: "domcontentloaded" }); await settle(page); return; }
    if (step.action === "press") { await page.keyboard.press(step.value!); return; }
    if (step.action === "card") {
      await this.ring(null);
      await page.evaluate((html) => (window as any).__tut.card(html), cardHtml(step.card!));
      // What the phone cuts frame: the card's middle column, where everything that matters is.
      this.aimed = { ...CARD_SAFE };
      return;
    }
    if (step.action === "scroll-to") {
      // Open a long page AT something (a settings card), without a text-fragment address and its purple highlight.
      await this.ring(null);
      const to = page.locator(fill(step.selector!)).first();
      await to.waitFor({ state: "attached", timeout: 20_000 });
      await to.evaluate((el, offset) => {
        // The nearest thing that scrolls: the page itself, or a panel inside it.
        let host: Element | null = el.parentElement;
        while (host && !(/(auto|scroll)/.test(getComputedStyle(host).overflowY) && host.scrollHeight > host.clientHeight + 4)) host = host.parentElement;
        const top = el.getBoundingClientRect().top - (host ? host.getBoundingClientRect().top : 0) - offset;
        (host ?? document.scrollingElement ?? document.documentElement).scrollBy({ top, behavior: "smooth" });
      }, step.offset ?? 84);
      let last = await to.boundingBox();
      for (let i = 0, still = 0; i < 30 && still < 2; i++) { await sleep(120); const box = await to.boundingBox(); still = box && last && Math.abs(box.y - last.y) < 0.5 ? still + 1 : 0; last = box; }
      return;
    }

    const target = page.locator(fill(step.selector!)).first();
    if (step.action === "upload") {
      const files = assetFiles(step.files!);
      // The file input itself (usually hidden): nothing to point at — the files are simply chosen.
      if (await target.evaluate((el) => el instanceof HTMLInputElement && el.type === "file").catch(() => false)) { await target.setInputFiles(files); return; }
      // A button or a drop area: click it the way a person does and answer the file chooser it opens.
      const point = await this.aim(target);
      await this.ring(target);
      await this.glide(point);
      await sleep(350);
      const chooser = page.waitForEvent("filechooser", { timeout: 6000 });
      chooser.catch(() => {});
      await page.mouse.down(); await sleep(70); await page.mouse.up();
      const opened = await chooser.catch(() => null);
      if (!opened) throw new Error(`upload: clicking ${step.selector} opened no file chooser — point the step at the input[type=file] itself (the dry run lists them)`);
      await opened.setFiles(files);
      this.ringOffSoon();
      return;
    }
    if (step.action === "drag") {
      const dest = page.locator(fill(step.to!)).first();
      const from = await this.aim(target);
      await this.ring(target);
      await this.glide(from);
      await sleep(350);
      await page.mouse.down();
      await sleep(260);
      // A first small move starts the drag; then the card is carried over, held a beat and dropped.
      await page.mouse.move(from.x + 6, from.y + 4); await sleep(60);
      await page.mouse.move(from.x + 14, from.y + 9); await sleep(120);
      this.pos = { x: from.x + 14, y: from.y + 9 };
      await dest.waitFor({ state: "visible", timeout: 20_000 });
      const box = await dest.boundingBox();
      if (!box) throw new Error(`drag: ${step.to} has no box`);
      const to = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + Math.min(box.height / 2, 110)) };
      await this.glide(to);
      await page.mouse.move(to.x + 2, to.y + 2);
      await sleep(320);
      await page.mouse.up();
      await sleep(300);
      return;
    }
    let point = await this.aim(target);
    if (step.redact) await target.evaluate((el) => (window as any).__tut?.blur(el));
    if (step.action === "scroll") { await this.ring(target); return; }
    await this.ring(target);
    await this.glide(point);
    // The page may have moved while the pointer travelled (a bar that slid in, a late scroll): a click
    // must land on the target, not on where the target was. Look again; follow it if it moved.
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = await this.aim(target);
      if (Math.abs(now.x - point.x) < 3 && Math.abs(now.y - point.y) < 3) break;
      point = now;
      await this.glide(point);
    }
    if (step.punch && (step.action === "highlight" || step.action === "hover")) { await sleep(250); await target.evaluate((el, z) => (window as any).__tut?.punch(el, z), step.punch); this.punched = true; }
    switch (step.action) {
      case "highlight": break;
      case "hover": await page.mouse.move(point.x, point.y); break;
      case "click":
        await sleep(350);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        // The click has done its job; a ring left behind would sit on whatever the click put there (a dialog, a new page).
        this.ringOffSoon();
        // …and what it asked the server for is back before the step is counted as done.
        await this.quiet();
        break;
      case "type":
        await sleep(250);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        // Typing replaces what the field holds, the way a person selects it all and types over it.
        // A date or time field has no text to type over: its value is set whole ("2026-10-09", "13:30").
        if (await target.evaluate((el) => el instanceof HTMLInputElement && ["date", "time", "datetime-local", "month"].includes(el.type))) {
          await sleep(300);
          await target.fill(fill(step.value!));
          break;
        }
        await page.keyboard.press("ControlOrMeta+a");
        await sleep(150);
        await page.keyboard.type(fill(step.value!), { delay: 85 });
        break;
      case "select": {
        const value = fill(step.value!);
        if (await target.evaluate((el) => el.tagName === "SELECT")) { await target.selectOption({ label: value }).catch(() => target.selectOption(value)); break; }
        // A custom listbox (Radix Select): open it, then choose the option by its visible name.
        await sleep(300);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        const option = page.getByRole("option", { name: value, exact: true }).first();
        const list = page.getByRole("listbox").first();
        await option.waitFor({ state: "attached", timeout: 10_000 });
        await sleep(500);
        // A long list: go into it, wheel until the option is comfortably inside, then aim — and look
        // again after moving, because the list's own scroll arrows react to the pointer.
        const inside = async () => {
          const o = await option.boundingBox(), l = await list.boundingBox();
          if (!o || !l) throw new Error(`The option “${value}” has no box`);
          const mid = o.y + o.height / 2;
          return { o, l, off: mid < l.y + 44 ? -1 : mid > l.y + l.height - 44 ? 1 : 0 };
        };
        let at = await inside();
        if (at.off !== 0) {
          await this.glide({ x: Math.round(at.l.x + Math.min(70, at.l.width / 2)), y: Math.round(at.l.y + at.l.height / 2) });
          // A short list does not scroll: its first and last options sit near the edge and are fine where they are.
          let still = 0;
          for (let i = 0; i < 400 && at.off !== 0 && still < 12; i++) {
            const before = at.o.y;
            await page.mouse.wheel(0, at.off * 16); await sleep(16); at = await inside();
            still = Math.abs(at.o.y - before) < 0.5 ? still + 1 : 0;
          }
          if (at.off !== 0 && (at.o.y < at.l.y - 1 || at.o.y + at.o.height > at.l.y + at.l.height + 1)) throw new Error(`Could not scroll to the option “${value}”`);
          await sleep(350);
        }
        await this.ring(option);
        for (let attempt = 0; ; attempt++) {
          const { o } = await inside();
          await this.glide({ x: Math.round(o.x + Math.min(70, o.width / 2)), y: Math.round(o.y + o.height / 2) });
          await sleep(350);
          const after = (await inside()).o;
          if (Math.abs(after.y - o.y) < 2 && Math.abs(after.x - o.x) < 2) break;
          if (attempt === 5) throw new Error(`Could not settle on the option “${value}”`);
        }
        await sleep(300);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        await sleep(250);
        await this.ring(target);
        await this.quiet();
        break;
      }
    }
  }
}

/**
 * A tour may cross the two apps (the overview films do): a /crm path is opened on the CRM's host name,
 * any other path on the main host — same machine, same port. For a script that stays in one app this
 * is the base it was given.
 */
const CRM_HOST = "portal.constructhub.us", CLIENT_HOST = "client.constructhub.us";
export function hostFor(pathname: string, base: string): string {
  const u = new URL(base);
  // The homeowner's browser stays on the client host: its pages are not the contractor's CRM or the platform.
  if (u.hostname === CLIENT_HOST) return new URL(pathname, u).toString();
  const crm = isCrmRoute(pathname.split(/[?#]/)[0]);
  if (crm) u.hostname = CRM_HOST; else if (u.hostname === CRM_HOST) u.hostname = "127.0.0.1";
  return new URL(pathname, u).toString();
}

/** The page has stopped loading: network quiet, fonts in, one more beat for the first paint. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
  await sleep(500);
}

/** One person's browser: its own cookies, its own cursor. Only the session on camera is filmed. */
type Session = {
  name: string; base: string; context: BrowserContext; page: Page; player: Player; cdp: CDPSession | null;
  /** When the page on camera finished drawing after its last whole-page load (recording clock, ms) — see MIN_PAGE_DWELL_MS. */
  shownAtMs: number | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2), ["shots", "no-narration", "dry"]);
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/record.ts <script.json> [--base URL] [--out DIR]");
  const { script } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const base = flagStr(args, "base", process.env.TUTORIAL_BASE_URL ?? "http://127.0.0.1:8168")!;
  const pad = flagNum(args, "pad", 450), lead = flagNum(args, "lead", 150);
  const label = flagStr(args, "label", "Demo Account")!, company = flagStr(args, "company", "Aspire Interiors")!;
  // --dry: no video and no waiting — play the steps as fast as they go and keep a screenshot of each
  // (steps/NN.png). It is how a script is tried out before a voice or an encoder is spent on it.
  const dry = !!args.flags.dry;
  if (dry) { args.flags.shots = true; args.flags["no-narration"] = true; }
  const zoom = script.zoom ?? 1;
  const even = (n: number) => Math.round(n / 2) * 2;
  const video = { width: even(script.viewport.width * zoom), height: even(script.viewport.height * zoom) };
  // The slot app's port: where the other hosts of the same app are, and where its fixture helpers answer.
  const port = flagStr(args, "port", new URL(base).port || "80")!;
  const sessionBase = (name: string) => name === "client" ? `http://client.constructhub.us:${port}` : name === "owner" ? base : `http://portal.constructhub.us:${port}`;
  for (const step of script.steps) if (step.action === "upload") assetFiles(step.files!); // fail before anything is filmed

  let clipMs: number[];
  if (args.flags["no-narration"]) {
    clipMs = script.steps.map((s) => Math.round(s.narration.length * 62));
    if (!dry) console.warn("! --no-narration: step lengths are ESTIMATES. Do not ship this recording.");
  } else {
    const file = path.join(dir, "narration.json");
    if (!fs.existsSync(file)) throw new Error(`${file} is missing — run narrate.ts first (or pass --no-narration for a dry run)`);
    const index = JSON.parse(fs.readFileSync(file, "utf8")) as NarrationIndex;
    clipMs = script.steps.map((s, i) => {
      const clip = index.clips.find((c) => c.index === i);
      if (!clip || clip.text !== s.narration) throw new Error(`Step ${i}: the narration changed since narrate.ts ran — run it again`);
      return clip.durationMs;
    });
  }

  const shotsDir = path.join(dir, "steps");
  if (args.flags.shots) { fs.rmSync(shotsDir, { recursive: true, force: true }); fs.mkdirSync(shotsDir, { recursive: true }); }

  // The CRM renders only on its own host name; the name is pointed at this machine for this browser only.
  // ZOOM IS THE BROWSER'S OWN DEVICE SCALE, NOT AN EMULATED ONE. A context with `deviceScaleFactor` lays
  // the page out correctly, but Chromium's screencast (and Playwright's recordVideo) then films it at
  // CSS size — 1024×576 — and the "1080p" would be an upscale. With --force-device-scale-factor and a
  // window of the CSS size, the surface itself is 1920×1080 and so is every captured frame.
  const browser: Browser = await chromium.launch({ headless: true, args: [
    "--host-resolver-rules=MAP portal.constructhub.us 127.0.0.1, MAP client.constructhub.us 127.0.0.1", "--force-color-profile=srgb",
    `--force-device-scale-factor=${zoom}`, `--window-size=${script.viewport.width},${script.viewport.height}`, "--hide-scrollbars",
  ] });

  // THE CAPTURE. Frames are taken straight from Chromium's screencast, at device pixels (1920×1080 —
  // see the launch flags above), and written as they arrive: JPEG frames copied (not re-encoded) into raw.mkv,
  // each stamped with the time it arrived. mux.ts makes the constant-rate H.264 from that.
  // Every session has its own screencast; only the frames of the session ON CAMERA are written, and
  // none while `held` — a frame that is not written is, in the video, the previous frame held.
  const raw = path.join(dir, "raw.mkv");
  let current: Session | null = null;
  let held = 0, frames = 0, badFrames = 0;
  const writer = dry ? null : spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-use_wallclock_as_timestamps", "1", "-c:v", "mjpeg", "-i", "-", "-c", "copy", raw], { stdio: ["pipe", "ignore", "inherit"] });
  writer?.stdin.on("error", () => { /* the writer stopped; its exit code says why */ });
  const nudge = (s: Session | null) => s?.page.evaluate(() => (window as any).__tut?.nudge()).catch(() => {});
  /** Stop filming until `until` resolves (at most `maxMs`), then make sure a fresh frame arrives. */
  const hold = async (until: () => Promise<unknown>, maxMs = 9000) => {
    held++;
    try { await Promise.race([until(), sleep(maxMs)]); } catch { /* the page went away mid-wait: film what there is */ }
    finally { held--; if (!held) { await nudge(current); } }
  };
  /** The page on camera has drawn: its overlay is in and the veil of a whole-page load is gone. */
  const drawn = async (page: Page) => {
    for (let i = 0; i < 90; i++) {
      const ok = await page.evaluate(() => document.readyState !== "loading" && !!(window as any).__tut?.drawn()).catch(() => false);
      if (ok) return;
      await sleep(100);
    }
  };

  const sessions = new Map<string, Session>();
  async function openSession(name: string): Promise<Session> {
    const origin = new URL(sessionBase(name));
    const context = await browser.newContext({ viewport: null, locale: "en-US", timezoneId: "America/New_York" });
    // No cookie banner, on any of the app's hosts this person may land on (a checkout returns to the CRM host).
    // …and on the main host by address: a tour that crosses from one app to the other (hostFor) must not meet it on the way.
    await context.addCookies([...new Set([origin.hostname, "127.0.0.1", CRM_HOST, CLIENT_HOST])].map((domain) => ({ name: "ch_consent", value: "denied", domain, path: "/" })));
    // tsx compiles with esbuild's keepNames, which wraps functions in a __name() helper the page does not have.
    await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
    await context.addInitScript(overlay);
    // Secrets that appear by themselves are blurred by a stylesheet that is there before the page draws anything.
    if (script.redactSelectors?.length) await context.addInitScript(redactFromLoad, redactCss(script.redactSelectors));
    await context.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch { /* storage off */ } });
    // One tab is recorded. A button that opens a new tab (an estimate's Preview, "See what the client
    // sees") opens it in this one instead; the script comes back with a `back` step.
    await context.addInitScript(() => { window.open = ((url?: string | URL) => { if (url) location.assign(String(url)); return null; }) as typeof window.open; });
    if (name === "owner") {
      // Presentation only: the account label a viewer sees. The session, the plan and the data are untouched.
      // (A team member's session is NOT relabelled: it shows who that person really is in the demo workspace.)
      await context.route("**/api/auth/me", async (route) => {
        // route.fetch() runs in Node, which knows nothing of the browser's host mapping: the request is sent
        // to this machine by address. (Left alone it would go to the real portal host on the internet.)
        const local = new URL(route.request().url());
        local.hostname = "127.0.0.1";
        const response = await route.fetch({ url: local.toString() });
        let body: any = null;
        try { body = await response.json(); } catch { /* not JSON */ }
        if (!body || typeof body !== "object") return route.fulfill({ response });
        return route.fulfill({
          response,
          json: { ...body, displayName: label, email: "demo@example.com", avatarUrl: null, companyName: company, companyLogoUrl: null, isPlatformAdmin: false },
        });
      });
    }
    // …and the notification bell: unread alerts are not part of any feature being taught.
    await context.route("**/api/notifications", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { unread: 0, notifications: [] } }) : route.fallback());

    const page = await context.newPage();
    const got = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    if (got.w !== script.viewport.width || got.h !== script.viewport.height || Math.abs(got.dpr - zoom) > 0.001)
      throw new Error(`the browser window of "${name}" is ${got.w}x${got.h} at ${got.dpr}, the script asks for ${script.viewport.width}x${script.viewport.height} at ${zoom}`);
    page.on("pageerror", (e) => console.warn(`  page error (${name}): ${e.message}`));
    const session: Session = { name, base: sessionBase(name), context, page, player: new Player(page, script.viewport, now).watchNetwork(), cdp: null, shownAtMs: null };
    // A page that loads whole is blank, then plain text, then the app: none of that is filmed. The
    // moment the main frame asks for a new document, the capture holds what is on screen until the
    // new page has drawn.
    page.on("request", (request) => {
      if (current !== session || !request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      // …that is: until the new document has replaced this one (a redirect asks again and holds again), and then drawn.
      void hold(async () => { await page.waitForEvent("framenavigated", { predicate: (f) => f === page.mainFrame(), timeout: 8000 }).catch(() => {}); await drawn(page); session.shownAtMs = now(); });
    });
    if (writer) {
      const cdp = await context.newCDPSession(page);
      session.cdp = cdp;
      cdp.on("Page.screencastFrame", (e) => {
        cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
        if (current !== session || held) return;
        frames++;
        const jpeg = Buffer.from(e.data, "base64");
        // Every frame must be the full size: one of another size would end the picture in the encode.
        const size = jpegSize(jpeg);
        if (!size || size.width !== video.width || size.height !== video.height) { badFrames++; return; }
        writer.stdin.write(jpeg);
      });
      // EVERY compositor frame (none arrive while nothing on the page moves). Skipping frames is not an
      // option: a change that happens in one frame — a sync mark, a dialog closing — would be missed and
      // the picture would stay stale until something else moved.
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 93, maxWidth: video.width, maxHeight: video.height, everyNthFrame: 1 });
    }
    sessions.set(name, session);
    return session;
  }
  /** Put another person's browser on camera; the first time, open it (signed in as that person). */
  async function switchTo(name: string, url?: string, handed?: Record<string, any>): Promise<void> {
    await hold(async () => {
      await current?.player.ring(null);
      let session = sessions.get(name);
      const fresh = !session;
      if (!session) session = await openSession(name);
      current = session;
      const member = /^member:(.+)$/.exec(name);
      const signIn = fresh && member ? `/__tutorial/auth/as?member=${encodeURIComponent(member[1])}&next=%2Fcrm` : null;
      if (signIn) await session.page.goto(new URL(signIn, session.base).toString(), { waitUntil: "domcontentloaded" });
      const first = handed ? addressOf(handed, session) : url ?? (fresh ? (name === "client" ? "/" : name === "owner" ? null : "/crm") : null);
      if (first && !(signIn && first === "/crm")) await session.page.goto(new URL(first, session.base).toString(), { waitUntil: "domcontentloaded" });
      if (first || signIn) { await settle(session.page); await drawn(session.page); }
    }, 60_000);
  }
  /** A tutorial fixture helper of the slot app. Node-side, by address: the host names exist only inside the browser. */
  async function fixture(name: string, input: Record<string, unknown>): Promise<Record<string, any>> {
    const filled = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? fill(v) : v]));
    const r = await fetch(`http://127.0.0.1:${port}/__tutorial/action/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filled), signal: AbortSignal.timeout(30_000) });
    const body = await r.json().catch(() => ({})) as Record<string, any>;
    if (r.status === 404 && !body.message) throw new Error(`fixture ${name}: the app on :${port} has no tutorial fixtures (it was started without them, or it is not a recording slot)`);
    if (!r.ok) throw new Error(`fixture ${name}: ${body.message ?? r.status}`);
    return body;
  }
  /**
   * Where a fixture's address opens: at the very address when it is on one of this slot's own hosts
   * (a document link lives on the CRM host, the portal's sign-in on the client host — cookies are per
   * host, as in production); otherwise its path, on the session's own host.
   */
  const addressOf = (result: Record<string, any>, session: Session): string => {
    if (typeof result.url === "string") {
      try { const u = new URL(result.url); if (u.port === port && /^(portal|client)\.constructhub\.us$/.test(u.hostname)) return u.toString(); } catch { /* not an address */ }
    }
    if (typeof result.path !== "string") throw new Error("the fixture answered nothing to open (no path)");
    return new URL(result.path, session.base).toString();
  };
  async function play(step: TutorialStep): Promise<void> {
    const session = current!;
    // A card or a push-in belongs to the step that asked for it.
    if (step.action !== "card" || session.player.punched) await session.player.clearStage();
    // The page's own "are you sure?" (window.confirm): a headless browser shows no box and answers Cancel unless told otherwise.
    if (step.action === "click" && step.dialog) session.page.once("dialog", (d) => { void (step.dialog === "accept" ? d.accept() : d.dismiss()).catch(() => {}); });
    if (step.action === "session") {
      // …opened at an address a fixture helper hands over (the link in an email, a checkout link), or at `url`.
      if (!step.fixture) return switchTo(step.session!, step.url);
      const result = await fixture(step.fixture, step.input ?? {});
      return switchTo(step.session!, undefined, result);
    }
    if (step.action === "fixture") {
      const result = await fixture(step.fixture!, step.input ?? {});
      if (step.open) {
        await session.player.ring(null);
        // The emailed address, opened in THIS person's browser.
        await session.page.goto(addressOf(result, session), { waitUntil: "domcontentloaded" });
        await settle(session.page);
      }
      return;
    }
    if (step.action === "wait-for") {
      const timeout = step.timeoutMs ?? 15_000, state = step.state ?? "visible";
      if (step.selector) await session.page.locator(fill(step.selector)).first().waitFor({ state, timeout });
      if (step.text) await session.page.getByText(fill(step.text)).first().waitFor({ state, timeout });
      return;
    }
    // Leaving a page that has only just appeared (Back straight after the click that opened it): let it be seen first.
    if ((step.action === "back" || step.action === "goto") && !dry) await sleep(dwellLeft(session.shownAtMs, now()));
    return session.player.play(step, session.base);
  }

  const t0 = Date.now();
  const now = () => Date.now() - t0;
  await openSession("owner");
  current = sessions.get("owner")!;
  const firstPage = current.page;

  // The video's clock starts when Chromium delivers its first frame — some hundreds of ms after this
  // one, and later still on a cold start. Two black "sync" frames at known times let mux.ts measure
  // the difference: this one in the pre-roll, and one after the last step (both are cut from the video).
  const flash = async (page: Page): Promise<number> => {
    for (let i = 0; held && i < 100; i++) await sleep(100); // never while the capture is holding a frame
    await page.evaluate(() => (window as any).__tut.sync(true));
    const at = now();
    await sleep(600);
    await page.evaluate(() => (window as any).__tut.sync(false));
    await sleep(400);
    return at;
  };
  await firstPage.setContent(`<body style="margin:0;background:#fff"></body>`);
  // The capture's clock starts with its first frame: wait for one before showing the first sync mark.
  for (let i = 0; writer && frames === 0 && i < 100; i++) {
    await firstPage.evaluate((n) => { document.body.style.background = n % 2 ? "#fff" : "#fefefe"; }, i);
    await sleep(100);
  }
  await sleep(1500);
  const syncStartMs = await flash(firstPage);

  const steps: StepTiming[] = [];
  let trimStartMs = 0;
  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    // The opening page load is pre-roll too: the video starts on a finished page.
    if (i === 0 && step.action === "goto") { await play(step); await drawn(current!.page); trimStartMs = now(); }
    else if (i === 0) trimStartMs = now();
    const startMs = now();
    if (!(i === 0 && step.action === "goto")) {
      // Each session has its own player; a `session` step changes which one is on camera.
      const before: Session = current!;
      before.player.beginStep();
      await play(step);
      if (current !== before) current!.player.beginStep();
    }
    const page = current!.page, player = current!.player;
    const narrationStartMs = startMs + lead;
    if (dry) await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    // Never shorter than the line — and never so short after a slow action that its result is not seen:
    // a page this step opened whole (its load is not filmed) gets its minimum time on screen from when it drew.
    const opened = current!.shownAtMs != null && current!.shownAtMs >= startMs ? current!.shownAtMs : null;
    const until = dry ? now() + 350 : Math.max(now() + 700, narrationStartMs + clipMs[i] + pad, opened == null ? 0 : opened + MIN_PAGE_DWELL_MS) + (step.holdMs ?? 0);
    while (until - now() > 300) { await sleep(250); await player.keepRing(); }
    await sleep(Math.max(0, until - now()));
    if (script.thumbnail?.step === i) {
      // The thumbnail's screenshot: this frame, full resolution, the cursor off, and where its ring is.
      const ring = await page.evaluate(() => (window as any).__tut.shot(true));
      await screenshot(page, path.join(dir, "thumb-shot.png"));
      await page.evaluate(() => (window as any).__tut.shot(false));
      fs.writeFileSync(path.join(dir, "thumb-shot.json"), JSON.stringify({ step: i, zoom, viewport: script.viewport, ring }, null, 2) + "\n");
    }
    if (args.flags.shots) await screenshot(page, path.join(shotsDir, `${String(i).padStart(2, "0")}.png`));
    // A dry run also lists what can be pointed at on this screen: every visible data-testid, with its tag and
    // text; what can be dragged (⇄); and every file input, hidden ones too (⬆) — an `upload` step's target.
    if (dry) fs.writeFileSync(path.join(shotsDir, `${String(i).padStart(2, "0")}.txt`), `[${current!.name}] ` + await page.evaluate(() => {
      const rows: string[] = [];
      for (const el of Array.from(document.querySelectorAll("[data-testid]"))) {
        if (el.closest("#__tut")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const on = r.bottom > 0 && r.top < innerHeight ? " " : "↓";
        const drag = el.getAttribute("draggable") === "true" ? "⇄" : " ";
        rows.push(`${on}${drag} ${el.getAttribute("data-testid")}  <${el.tagName.toLowerCase()}>  ${(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)}`);
      }
      for (const el of Array.from(document.querySelectorAll('input[type="file"]'))) {
        const id = el.getAttribute("data-testid");
        rows.push(`⬆  file input  ${id ? `[data-testid="${id}"]` : el.id ? `#${el.id}` : `input[type="file"]`}  accept=${el.getAttribute("accept") ?? "*"}${(el as HTMLInputElement).multiple ? "  multiple" : ""}`);
      }
      return `${location.host}${location.pathname}${location.search}\n${rows.join("\n")}\n`;
    }));
    // Where the step pointed (social.ts frames the phone cuts around it). Never worth failing a recording for.
    const pointed = i === 0 && step.action === "goto" ? { target: null, ringOffMs: null, cursor: [] } : await player.endStep().catch(() => ({ target: null, ringOffMs: null, cursor: [] as [number, number, number][] }));
    const endMs = now();
    steps.push({ index: i, action: step.action, caption: step.caption, startMs, narrationStartMs, narrationMs: clipMs[i], endMs, target: pointed.target, ringOffMs: pointed.ringOffMs, cursor: pointed.cursor });
    console.log(`  step ${String(i).padStart(2)} ${step.action.padEnd(9)} ${(startMs / 1000).toFixed(2)}s → ${(endMs / 1000).toFixed(2)}s  ${step.caption}`);
  }
  await sleep(700);
  const endMs = now();
  await current!.player.ring(null);
  const syncEndMs = await flash(current!.page);
  await sleep(400);
  if (writer) {
    for (const s of sessions.values()) await s.cdp?.send("Page.stopScreencast").catch(() => {});
    await sleep(300);
    writer.stdin.end();
    const code = await new Promise<number>((r) => writer.on("close", (c) => r(c ?? 1)));
    if (code !== 0) throw new Error(`the capture writer exited ${code}`);
    if (badFrames > 3) throw new Error(`${badFrames} captured frames were not ${video.width}x${video.height} — the capture is not at device pixels`);
  }
  for (const s of sessions.values()) await s.context.close();
  await browser.close();
  if (dry) { console.log(`dry run: ${script.steps.length} steps played, screenshots → ${shotsDir}`); return; }

  const timings: Timings = { helpKey: script.helpKey, viewport: script.viewport, zoom, video, base, recordedAt: new Date().toISOString(), syncStartMs, syncEndMs, trimStartMs, endMs, steps };
  fs.writeFileSync(path.join(dir, "timings.json"), JSON.stringify(timings, null, 2) + "\n");
  console.log(`raw.mkv ${video.width}x${video.height} · ${frames} frames · ${(fs.statSync(raw).size / 1e6).toFixed(1)} MB · ${((endMs - trimStartMs) / 1000).toFixed(1)} s of walkthrough → ${dir}`);
}

// Run only when started as a program (the tests import the helpers above).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
