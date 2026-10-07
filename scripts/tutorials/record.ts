/**
 * Walkthrough recorder — stage 1 of docs/tutorials/VIDEO-PIPELINE.md.
 *
 *   tsx scripts/tutorials/record.ts docs/tutorials/scripts/<helpKey>.json [--base http://127.0.0.1:8168]
 *        [--out analysis/video-out/<helpKey>] [--pad 450] [--lead 150] [--label "Demo Account"]
 *        [--shots] [--no-narration]
 *
 * Plays the step script in headless Chromium with Playwright's `recordVideo`, and writes
 *   raw.webm      the screen capture (with a pre-roll that mux.ts cuts off)
 *   timings.json  where every step starts and ends in it
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
 */
import fs from "fs";
import path from "path";
import { chromium, type Locator, type Page } from "playwright";
import type { TutorialStep } from "../../shared/help/step-script";
import { flagNum, flagStr, loadScript, outDir, parseArgs, sleep, type NarrationIndex, type StepTiming, type Timings } from "./lib";

/** Injected into every document of the recording context. Plain JS: it runs in the page. */
function overlay() {
  const w = window as any;
  if (w.__tut) return;
  const css = `
    #__tut{position:fixed;inset:0;pointer-events:none;z-index:2147483647;--tut-accent:Highlight;font-family:inherit}
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
    #__tut .sync{position:absolute;inset:0;background:#000;display:none}
    #__tut .sync.on{display:block}
    .__tut-blur{filter:blur(7px)!important}
    /* The assistant launcher and its welcome bubble are not part of any feature being taught. */
    [data-testid="hub-launcher"],[data-testid="hub-welcome-bubble"],[data-testid="hub-panel"]{display:none!important}
  `;
  const root = document.createElement("div");
  root.id = "__tut";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<style>${css}</style><div class="ring"></div><div class="url"></div>
    <svg class="cur" viewBox="0 0 26 26"><path d="M5 3v18.2l4.7-4.4 3 7 3.1-1.3-3-6.9H19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="sync"></div>`;
  const ring = root.querySelector(".ring") as HTMLElement, cur = root.querySelector(".cur") as HTMLElement;
  const url = root.querySelector(".url") as HTMLElement;
  let pos = { x: Math.round(innerWidth * 0.93), y: Math.round(innerHeight * 0.55) }; // the page's empty right margin
  try { const saved = JSON.parse(sessionStorage.getItem("__tut_xy") || "null"); if (saved) pos = saved; } catch { /* first document */ }
  const place = () => { cur.style.transform = `translate(${pos.x}px,${pos.y}px)`; };
  place();
  let target: Element | null = null, pad = 6;
  const accent = () => {
    const from = (target && target.closest(".g-surface")) || document.querySelector(".g-surface") || document.documentElement;
    const v = getComputedStyle(from).getPropertyValue("--g-accent").trim();
    if (v) root.style.setProperty("--tut-accent", v);
  };
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
  addEventListener("mousedown", () => {
    const rip = document.createElement("div");
    rip.className = "rip"; rip.style.left = `${pos.x}px`; rip.style.top = `${pos.y}px`;
    root.appendChild(rip); setTimeout(() => rip.remove(), 600);
  }, true);
  const mount = () => { if (!root.isConnected) document.documentElement.appendChild(root); accent(); };
  if (document.documentElement) mount();
  document.addEventListener("DOMContentLoaded", mount);
  w.__tut = {
    ring(el: Element | null, padding = 6) { mount(); target = el; pad = padding; accent(); ring.classList.toggle("on", !!el); },
    blur(el: Element) { el.classList.add("__tut-blur"); },
    /** A full black frame: the mark mux.ts looks for to line the video's clock up with the recorder's. */
    sync(on: boolean) { mount(); (root.querySelector(".sync") as HTMLElement).classList.toggle("on", on); },
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Player {
  private pos: { x: number; y: number };
  constructor(private page: Page, private viewport: { width: number; height: number }) {
    this.pos = { x: Math.round(viewport.width * 0.93), y: Math.round(viewport.height * 0.55) };
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
      const due = started + (duration * i) / n;
      if (due > Date.now()) await sleep(due - Date.now());
    }
    this.pos = to;
  }

  async ring(target: Locator | null) {
    if (target) await target.evaluate((el) => (window as any).__tut?.ring(el));
    else await this.page.evaluate(() => (window as any).__tut?.ring(null)).catch(() => {});
  }

  /** Bring the target on screen and return the point to aim at (inside it, never over its far edge). */
  private async aim(target: Locator): Promise<{ x: number; y: number }> {
    await target.waitFor({ state: "visible", timeout: 20_000 });
    await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 50) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    // Wait for a smooth scroll (or a list that is still settling) to stop moving the target.
    let last = await target.boundingBox();
    for (let i = 0; i < 20; i++) {
      await sleep(120);
      const box = await target.boundingBox();
      if (box && last && Math.abs(box.y - last.y) < 0.5 && Math.abs(box.x - last.x) < 0.5) { last = box; break; }
      last = box;
    }
    if (!last) throw new Error("target has no box");
    const wide = last.width > 320;
    return {
      x: Math.round(last.x + (wide ? Math.min(last.width * 0.3, 220) : last.width / 2)),
      y: Math.round(last.y + (last.height > 120 ? last.height * 0.6 : last.height / 2)),
    };
  }

  async play(step: TutorialStep, base: string) {
    const page = this.page;
    const fill = (v: string) => v.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
      const value = process.env[name];
      if (value === undefined) throw new Error(`The script needs ${name} in the environment`);
      return value;
    });
    if (step.action === "goto") {
      await this.ring(null);
      await page.goto(new URL(step.url!, base).toString(), { waitUntil: "domcontentloaded" });
      await settle(page);
      return;
    }
    if (step.action === "wait") return;
    if (step.action === "press") { await page.keyboard.press(step.value!); return; }

    const target = page.locator(fill(step.selector!)).first();
    const point = await this.aim(target);
    if (step.redact) await target.evaluate((el) => (window as any).__tut?.blur(el));
    if (step.action === "scroll") { await this.ring(target); return; }
    await this.ring(target);
    await this.glide(point);
    switch (step.action) {
      case "highlight": break;
      case "hover": await page.mouse.move(point.x, point.y); break;
      case "click":
        await sleep(350);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        break;
      case "type":
        await sleep(250);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        // Typing replaces what the field holds, the way a person selects it all and types over it.
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
          for (let i = 0; i < 400 && at.off !== 0; i++) { await page.mouse.wheel(0, at.off * 16); await sleep(16); at = await inside(); }
          if (at.off !== 0) throw new Error(`Could not scroll to the option “${value}”`);
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
        break;
      }
    }
  }
}

/** The page has stopped loading: network quiet, fonts in, one more beat for the first paint. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
  await sleep(500);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["shots", "no-narration"]);
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/record.ts <script.json> [--base URL] [--out DIR]");
  const { script } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const base = flagStr(args, "base", process.env.TUTORIAL_BASE_URL ?? "http://127.0.0.1:8168")!;
  const pad = flagNum(args, "pad", 450), lead = flagNum(args, "lead", 150);
  const label = flagStr(args, "label", "Demo Account")!;

  let clipMs: number[];
  if (args.flags["no-narration"]) {
    clipMs = script.steps.map((s) => Math.round(s.narration.length * 62));
    console.warn("! --no-narration: step lengths are ESTIMATES. Do not ship this recording.");
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

  const videoDir = path.join(dir, "_capture");
  fs.rmSync(videoDir, { recursive: true, force: true });
  const shotsDir = path.join(dir, "steps");
  if (args.flags.shots) { fs.rmSync(shotsDir, { recursive: true, force: true }); fs.mkdirSync(shotsDir, { recursive: true }); }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: script.viewport, deviceScaleFactor: 1, locale: "en-US", timezoneId: "America/New_York",
    recordVideo: { dir: videoDir, size: script.viewport },
  });
  const origin = new URL(base);
  await context.addCookies([{ name: "ch_consent", value: "denied", domain: origin.hostname, path: "/" }]);
  // tsx compiles with esbuild's keepNames, which wraps functions in a __name() helper the page does not have.
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  await context.addInitScript(overlay);
  await context.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch { /* storage off */ } });
  // Presentation only: the account label a viewer sees. The session, the plan and the data are untouched.
  await context.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    let body: any = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    if (!body || typeof body !== "object") return route.fulfill({ response });
    return route.fulfill({
      response,
      json: { ...body, displayName: label, email: "demo@example.com", avatarUrl: null, companyName: "Demo Company", companyLogoUrl: null, isPlatformAdmin: false },
    });
  });

  // …and its notification bell: the dev account's unread alerts are not part of any feature being taught.
  await context.route("**/api/notifications", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { unread: 0, notifications: [] } }) : route.fallback());

  const page = await context.newPage();
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  page.on("pageerror", (e) => console.warn(`  page error: ${e.message}`));

  // The video's clock starts when Chromium delivers its first frame — some hundreds of ms after this
  // one, and later still on a cold start. Two black "sync" frames at known times let mux.ts measure
  // the difference: this one in the pre-roll, and one after the last step (both are cut from the video).
  const flash = async (): Promise<number> => {
    await page.evaluate(() => (window as any).__tut.sync(true));
    const at = now();
    await sleep(600);
    await page.evaluate(() => (window as any).__tut.sync(false));
    await sleep(400);
    return at;
  };
  await page.setContent(`<body style="margin:0;background:#fff"></body>`);
  await sleep(1500);
  const syncStartMs = await flash();

  const player = new Player(page, script.viewport);
  const steps: StepTiming[] = [];
  let trimStartMs = 0;
  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    // The opening page load is pre-roll too: the video starts on a finished page.
    if (i === 0 && step.action === "goto") { await player.play(step, base); trimStartMs = now(); }
    else if (i === 0) trimStartMs = now();
    const startMs = now();
    if (!(i === 0 && step.action === "goto")) await player.play(step, base);
    const narrationStartMs = startMs + lead;
    const until = Math.max(now(), narrationStartMs + clipMs[i] + pad) + (step.holdMs ?? 0);
    await sleep(until - now());
    if (args.flags.shots) await page.screenshot({ path: path.join(shotsDir, `${String(i).padStart(2, "0")}.png`) });
    const endMs = now();
    steps.push({ index: i, action: step.action, caption: step.caption, startMs, narrationStartMs, narrationMs: clipMs[i], endMs });
    console.log(`  step ${String(i).padStart(2)} ${step.action.padEnd(9)} ${(startMs / 1000).toFixed(2)}s → ${(endMs / 1000).toFixed(2)}s  ${step.caption}`);
  }
  await sleep(700);
  const endMs = now();
  await player.ring(null);
  const syncEndMs = await flash();
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = path.join(dir, "raw.webm");
  fs.renameSync(await video!.path(), raw);
  fs.rmSync(videoDir, { recursive: true, force: true });

  const timings: Timings = { helpKey: script.helpKey, viewport: script.viewport, base, recordedAt: new Date().toISOString(), syncStartMs, syncEndMs, trimStartMs, endMs, steps };
  fs.writeFileSync(path.join(dir, "timings.json"), JSON.stringify(timings, null, 2) + "\n");
  console.log(`raw.webm ${(fs.statSync(raw).size / 1e6).toFixed(1)} MB · ${((endMs - trimStartMs) / 1000).toFixed(1)} s of walkthrough → ${dir}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
