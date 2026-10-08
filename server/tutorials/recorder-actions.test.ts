import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { parseTutorialScript, tutorialStepSchema, STEP_ACTIONS } from "@shared/help/step-script";
import { ASSETS_DIR, CAPTION_SAFE, MIN_PAGE_DWELL_MS, Player, RING_OFF_AFTER_CLICK_MS, assetFiles, dwellLeft, fill, hostFor, redactCss, screenshot } from "../../scripts/tutorials/record";
import { CARD_SAFE, cardHtml } from "../../scripts/tutorials/card";
import { lastFrameSeekSec } from "../../scripts/tutorials/lib";
import { tutorialCardSchema } from "@shared/help/step-script";
import { SLOT_MAX, SLOT_PORT, isSlot } from "../../scripts/tutorials/app";

/**
 * The recorder's newer actions (scripts/tutorials/record.ts): upload, drag, session, fixture,
 * wait-for — their schema, the demo files an upload may use, and the rules that keep a script from
 * reaching outside the demo. Static: no browser is started.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const step = (s: Record<string, unknown>) => tutorialStepSchema.safeParse({ caption: "c", narration: "n", ...s });
const ok = (s: Record<string, unknown>) => expect(step(s).success, JSON.stringify(s)).toBe(true);
const bad = (s: Record<string, unknown>) => expect(step(s).success, JSON.stringify(s)).toBe(false);

describe("step-script schema", () => {
  it("knows the five new actions, and the JSON Schema twin agrees", () => {
    for (const a of ["upload", "drag", "session", "fixture", "wait-for"]) expect(STEP_ACTIONS).toContain(a);
    const schema = JSON.parse(read("shared/help/step-script.schema.json")).properties.steps.items;
    expect(schema.properties.action.enum).toEqual([...STEP_ACTIONS]);
    for (const f of ["files", "to", "session", "fixture", "input", "open", "text", "state", "timeoutMs"]) expect(schema.properties[f], f).toBeTruthy();
  });

  it("upload takes demo files by a plain relative name — nothing that climbs out of the assets folder", () => {
    ok({ action: "upload", selector: "[data-testid=x]", files: ["photos/site-02.jpg", "care-guide.pdf"] });
    bad({ action: "upload", selector: "[data-testid=x]" });
    bad({ action: "upload", files: ["photos/site-02.jpg"] });
    for (const f of ["../../.env", "/etc/passwd", "photos/../../x.jpg", "~/x.png", "C:\\x.png", "photos/Site 02.jpg", ".env", "photos/"]) bad({ action: "upload", selector: "x", files: [f] });
    bad({ action: "click", selector: "x", files: ["care-guide.pdf"] });
  });

  it("drag needs where from and where to", () => {
    ok({ action: "drag", selector: "[data-testid^=card-project-]", to: "[data-testid=stage-col-approved]" });
    bad({ action: "drag", selector: "x" }); bad({ action: "drag", to: "y" }); bad({ action: "highlight", selector: "x", to: "y" });
  });

  it("session is the owner, the homeowner, or a named team member — opened at a path or at a fixture's address", () => {
    ok({ action: "session", session: "owner" });
    ok({ action: "session", session: "client", url: "/" });
    ok({ action: "session", session: "member:Marco Delgado" });
    ok({ action: "session", session: "client", fixture: "email.signIn", input: { to: "kane@example.com" } });
    for (const s of ["admin", "member:", "client:kane@example.com", "user:1", "member:<script>"]) bad({ action: "session", session: s });
    bad({ action: "session" });
    bad({ action: "session", session: "client", url: "/", fixture: "email.signIn" });
    bad({ action: "session", session: "client", url: "https://example.com/" });
    bad({ action: "click", selector: "x", session: "client" });
  });

  it("fixture names a helper as provider.action; wait-for needs something to wait for", () => {
    ok({ action: "fixture", fixture: "sms.inbound", input: { from: "+19415550134", body: "STOP" } });
    ok({ action: "fixture", fixture: "email.link", input: { to: "kane@example.com" }, open: true });
    ok({ action: "fixture", fixture: "google-calendar.events" });
    for (const f of ["stripe", "../x", "stripe.pay; rm", "Stripe.pay", "http://x.y"]) bad({ action: "fixture", fixture: f });
    bad({ action: "fixture" }); bad({ action: "goto", url: "/crm", open: true }); bad({ action: "click", selector: "x", input: { a: 1 } });
    ok({ action: "wait-for", selector: "[data-testid=x]" }); ok({ action: "wait-for", text: "Paid", timeoutMs: 30000 }); ok({ action: "wait-for", text: "processing", state: "hidden" });
    bad({ action: "wait-for" }); bad({ action: "wait-for", text: "x", timeoutMs: 600000 }); bad({ action: "wait", text: "x" }); bad({ action: "wait-for", text: "x", state: "gone" });
  });

  it("a thumbnail step is still one that keeps its ring", () => {
    const base = { helpKey: "crm-x", title: "x", viewport: { width: 1024, height: 576 } };
    for (const action of ["session", "fixture", "wait-for", "upload", "drag"]) {
      const s = { caption: "c", narration: "n", action, selector: "x", files: ["care-guide.pdf"], to: "y", session: "client", fixture: "email.count", text: "t" } as Record<string, unknown>;
      for (const k of ["files", "to", "session", "fixture", "text"]) if (!({ upload: ["files"], drag: ["to"], session: ["session"], fixture: ["fixture"], "wait-for": ["text"] } as Record<string, string[]>)[action].includes(k)) delete s[k];
      if (["session", "fixture"].includes(action)) delete s.selector;
      expect(() => parseTutorialScript({ ...base, steps: [s], thumbnail: { headline: "Send estimates fast", step: 0 } }), action).toThrow(/thumbnail/);
    }
  });
});

describe("the demo files an upload may use", () => {
  it("are all there, small, and what they say they are", () => {
    const magic = (f: string, n: number) => fs.readFileSync(path.join(ASSETS_DIR, f)).subarray(0, n);
    const photos = fs.readdirSync(path.join(ASSETS_DIR, "photos")).filter((f) => f.endsWith(".jpg")).sort();
    expect(photos).toEqual(Array.from({ length: 11 }, (_x, i) => `site-${String(i + 1).padStart(2, "0")}.jpg`));
    for (const p of photos) { expect([...magic(`photos/${p}`, 3)]).toEqual([0xff, 0xd8, 0xff]); expect(fs.statSync(path.join(ASSETS_DIR, "photos", p)).size).toBeLessThan(200_000); }
    expect(magic("logo-aspire-interiors.png", 4).toString("latin1")).toBe("\x89PNG");
    expect(magic("care-guide.pdf", 5).toString("latin1")).toBe("%PDF-");
    expect(magic("clip-floor-walkthrough.mp4", 12).subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(fs.statSync(path.join(ASSETS_DIR, "clip-floor-walkthrough.mp4")).size).toBeLessThan(600_000);
    const csv = read("scripts/tutorials/assets/clients-import.csv").trim().split("\n");
    expect(csv[0]).toBe("Name,Email,Phone,Address,City,State,Zip,Notes");
    expect(csv).toHaveLength(7);
    expect(new Set(csv.slice(1).map((l) => l.split(",")[5]))).toEqual(new Set(["FL", "NY", "TX"]));
    // Drawn by scripts/tutorials/gen-assets.ts: no photograph, nothing fetched.
    const gen = read("scripts/tutorials/gen-assets.ts");
    expect(gen).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("an upload step can only name a file inside the assets folder that exists", () => {
    expect(assetFiles(["photos/site-01.jpg", "care-guide.pdf"])).toEqual([path.join(ASSETS_DIR, "photos/site-01.jpg"), path.join(ASSETS_DIR, "care-guide.pdf")]);
    expect(() => assetFiles(["../seed-demo.ts"])).toThrow(/outside/);
    expect(() => assetFiles(["photos/site-99.jpg"])).toThrow(/does not exist/);
  });

  it("every upload step of every committed script names files that exist", () => {
    const dir = path.join(ROOT, "docs/tutorials/scripts");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const { $schema: _s, ...json } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const s of parseTutorialScript(json).steps) {
        if (s.action === "upload") expect(() => assetFiles(s.files!), f).not.toThrow();
        // A fixture step only ever names a fictional recipient.
        for (const v of Object.values(s.input ?? {})) if (typeof v === "string" && v.includes("@")) expect(v, f).toMatch(/@([a-z0-9-]+\.)*example\.com$/);
      }
    }
  });
});

describe("the recorder", () => {
  const src = read("scripts/tutorials/record.ts");
  it("fills dates and refuses a placeholder it was not given", () => {
    expect(fill("{{DATE}}")).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(new Date(fill("{{DATE+2}}")).getTime() - new Date(fill("{{DATE}}")).getTime()).toBe(2 * 86400000);
    expect(() => fill("{{NOT_IN_THE_ENVIRONMENT_XYZ}}")).toThrow(/needs NOT_IN_THE_ENVIRONMENT_XYZ/);
    expect(CAPTION_SAFE(576)).toBe(98);
  });
  it("films only the session on camera and holds the last frame while a page loads whole", () => {
    expect(src).toContain("if (current !== session || held) return;");
    expect(src).toMatch(/page\.on\("request", \(request\) => \{\s*if \(current !== session \|\| !request\.isNavigationRequest\(\) \|\| request\.frame\(\) !== page\.mainFrame\(\)\) return;/);
    expect(src).toContain('for (let i = 0; held && i < 100; i++) await sleep(100); // never while the capture is holding a frame');
  });
  it("lifts a dialog whose target sits in the caption strip, before the ring is drawn", () => {
    const aim = src.slice(src.indexOf("private async aim("), src.indexOf("async play(step"));
    expect(aim).toContain("host.style.translate = `0 ${-total}px`;");
    expect(aim).toMatch(/closest\('\[role="dialog"\],\[role="alertdialog"\]'\)/);
    // aim() runs before ring() in every pointing action.
    expect(src).toMatch(/const point = await this\.aim\(target\);[\s\S]{0,400}await this\.ring\(target\);/);
  });
  it("keeps fixture helpers on this machine and relabels only the owner's own account", () => {
    expect(src).toContain("fetch(`http://127.0.0.1:${port}/__tutorial/action/${name}`");
    expect(src).toMatch(/if \(name === "owner"\) \{[\s\S]{0,400}await context\.route\("\*\*\/api\/auth\/me"/);
    expect(src).toContain("MAP portal.constructhub.us 127.0.0.1, MAP client.constructhub.us 127.0.0.1");
  });
  it("lists file inputs and draggable things in a dry run", () => {
    expect(src).toContain(`document.querySelectorAll('input[type="file"]')`);
    expect(src).toContain('el.getAttribute("draggable") === "true" ? "⇄" : " "');
  });
});

describe("the recorder's ring, dwell and hosts", () => {
  /** A page and an element that only record what the overlay is told: "on:<name>" / "off". */
  const stage = () => {
    const calls: string[] = [];
    const page = { evaluate: async () => { calls.push("off"); } } as any;
    const el = (name: string) => ({ evaluate: async () => { calls.push(`on:${name}`); }, boundingBox: async () => ({ x: 1, y: 2, width: 3, height: 4 }) }) as any;
    return { calls, player: new Player(page, { width: 1024, height: 576 }, () => 0), el };
  };

  it("a click's delayed ring-off never wipes the next step's ring", async () => {
    vi.useFakeTimers();
    try {
      const { calls, player, el } = stage();
      await player.ring(el("save"));
      player.ringOffSoon();                    // the click on "save"
      await vi.advanceTimersByTimeAsync(200);  // the next step starts 200 ms later…
      await player.ring(el("next"));           // …and rings its own target
      await vi.advanceTimersByTimeAsync(RING_OFF_AFTER_CLICK_MS * 3);
      expect(calls).toEqual(["on:save", "on:next"]); // no "off" after "on:next"
      expect((await player.endStep()).target).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    } finally { vi.useRealTimers(); }
  });

  it("still takes the click's ring away when nothing else is ringed, once, and a second click restarts the wait", async () => {
    vi.useFakeTimers();
    try {
      const { calls, player, el } = stage();
      await player.ring(el("open"));
      player.ringOffSoon();
      await vi.advanceTimersByTimeAsync(RING_OFF_AFTER_CLICK_MS - 50);
      player.ringOffSoon();
      await vi.advanceTimersByTimeAsync(RING_OFF_AFTER_CLICK_MS - 50);
      expect(calls).toEqual(["on:open"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toEqual(["on:open", "off"]);
      await vi.advanceTimersByTimeAsync(RING_OFF_AFTER_CLICK_MS * 3);
      expect(calls).toEqual(["on:open", "off"]);
    } finally { vi.useRealTimers(); }
  });

  it("a page a step opened whole stays on screen a minimum time before a back or a goto leaves it", () => {
    expect(MIN_PAGE_DWELL_MS).toBeGreaterThanOrEqual(1500);
    expect(dwellLeft(null, 5000)).toBe(0);                       // the page was there all along
    expect(dwellLeft(10_000, 10_300)).toBe(MIN_PAGE_DWELL_MS - 300); // drawn 0.3 s ago: wait the rest
    expect(dwellLeft(10_000, 10_000 + MIN_PAGE_DWELL_MS + 1)).toBe(0);
    const src = read("scripts/tutorials/record.ts");
    expect(src).toMatch(/session\.shownAtMs = now\(\)/);                                   // stamped when the new page has drawn
    expect(src).toMatch(/step\.action === "back" \|\| step\.action === "goto"\) && !dry\) await sleep\(dwellLeft\(/);
    expect(src).toMatch(/opened \+ MIN_PAGE_DWELL_MS/);                                     // …and the step that opened it is held that long
    expect(src).not.toMatch(/setTimeout\(\(\) => \{ void this\.ring\(null\); \}/);       // the uncancellable timer is gone
  });

  it("a goto crosses hosts: /crm… on the CRM host, anything else on the main host — and the homeowner's browser stays where it is", () => {
    for (const base of ["http://portal.constructhub.us:8186", "http://127.0.0.1:8186"]) {
      expect(hostFor("/crm/pipeline", base)).toBe("http://portal.constructhub.us:8186/crm/pipeline");
      expect(hostFor("/crm", base)).toBe("http://portal.constructhub.us:8186/crm");
      expect(hostFor("/databases?state=TX", base)).toBe("http://127.0.0.1:8186/databases?state=TX");
      expect(hostFor("/", base)).toBe("http://127.0.0.1:8186/");
    }
    expect(hostFor("/crmish", "http://portal.constructhub.us:8186")).toBe("http://127.0.0.1:8186/crmish");
    expect(hostFor("/invoices", "http://client.constructhub.us:8186")).toBe("http://client.constructhub.us:8186/invoices");
    expect(hostFor("/crm", "http://client.constructhub.us:8186")).toBe("http://client.constructhub.us:8186/crm");
  });

  it("keeps every capability of the lines that were merged into it", () => {
    const src = read("scripts/tutorials/record.ts");
    for (const action of ["upload", "drag", "session", "fixture", "wait-for"]) expect(src, action).toContain(`step.action === "${action}"`);
    expect(src).toMatch(/held\+\+/);                    // frame-hold on whole-page loads
    expect(src).toMatch(/host\.style\.translate/);      // dialog lifting
    expect(src).toMatch(/this\.aimed = last/);          // target box for the social cuts…
    expect(src).toMatch(/target: pointed\.target, ringOffMs: pointed\.ringOffMs, cursor: pointed\.cursor/); // …saved with the cursor path
    expect(src).toMatch(/page\.goto\(hostFor\(step\.url!, base\)/); // host-switching goto
  });
});

describe("cards, scroll-to, confirm boxes and blur-from-load", () => {
  const them = { title: "Them", value: "$99", unit: "a month", lines: ["One line"] }, us = { title: "Us", value: "$49", us: true };

  it("the schema knows the two new actions and their fields, and the JSON Schema twin agrees", () => {
    for (const a of ["scroll-to", "card"]) expect(STEP_ACTIONS).toContain(a);
    const twin = JSON.parse(read("shared/help/step-script.schema.json"));
    for (const f of ["offset", "card", "dialog", "punch"]) expect(twin.properties.steps.items.properties[f], f).toBeTruthy();
    expect(twin.properties.redactSelectors).toBeTruthy();
    ok({ action: "scroll-to", selector: "[data-testid=card-defaults]" }); ok({ action: "scroll-to", selector: "x", offset: 120 });
    bad({ action: "scroll-to" }); bad({ action: "highlight", selector: "x", offset: 10 });
    ok({ action: "click", selector: "x", dialog: "accept" }); bad({ action: "highlight", selector: "x", dialog: "accept" });
    ok({ action: "highlight", selector: "x", punch: 1.4 }); bad({ action: "click", selector: "x", punch: 1.4 }); bad({ action: "highlight", selector: "x", punch: 3 });
    ok({ action: "card", card: { headline: "Five apps to run one job?" } });
    bad({ action: "card" }); bad({ action: "card", selector: "x", card: { headline: "Hello there" } }); bad({ action: "highlight", selector: "x", card: { headline: "Hello there" } });
  });

  it("a card that shows a price must say whose price and as of when; a stat and columns do not mix", () => {
    const card = (c: Record<string, unknown>) => tutorialCardSchema.safeParse(c).success;
    expect(card({ headline: "Five seats", stat: { value: "5", label: "seats on Essentials" } })).toBe(true);
    expect(card({ headline: "Them vs us", columns: [them, us] })).toBe(false);                                  // a price, no footnote
    expect(card({ headline: "Them vs us", columns: [them, us], footnote: "List prices, month to month." })).toBe(false); // no date
    expect(card({ headline: "Them vs us", columns: [them, us], footnote: "List prices, month to month, as of October 2026. Different features — check both." })).toBe(true);
    expect(card({ headline: "$94 for five", footnote: "ConstructHUB CRM Essentials, list price, October 2026" })).toBe(true);
    expect(card({ headline: "$94 for five" })).toBe(false);
    expect(card({ headline: "Both", stat: { value: "5", label: "seats" }, columns: [them, us], footnote: "2026" })).toBe(false);
    expect(card({ headline: "One", columns: [them] })).toBe(false);
    expect(card({ headline: "Stop overpaying", accent: "cheaper" })).toBe(false);
  });

  it("draws a card from its spec alone: every word escaped, nothing fetched, the content inside the column every cut shows", () => {
    const a = { font: "data:font/ttf;base64,AAAA", gator: "data:image/webp;base64,BBBB" };
    const html = cardHtml({ kicker: "As of <October> 2026", headline: "Half the price?", accent: "half", columns: [{ ...them, title: "A & B <Co>" }, us], footnote: "List \"price\", 2026", mascot: true }, a);
    expect(html).toContain("A &amp; B &lt;Co&gt;");
    expect(html).toContain("As of &lt;October&gt; 2026");
    expect(html).toContain("List &quot;price&quot;, 2026");
    expect(html).toContain(`<span class="o">Half</span> the price?`);
    expect(html).toContain(`<div class="col us">`);
    expect(html).toContain(`data-count="$49"`);
    expect(html).toContain(`src="${a.gator}"`);
    expect(html.split(a.font).join("").split(a.gator).join("")).not.toMatch(/https?:\/\/|file:/); // nothing fetched: the font and the mascot are inlined
    expect(html.match(/url\(/g)).toHaveLength(1);
    expect(cardHtml({ headline: "No gator here" }, a)).not.toContain("<img");
    // The middle column fits the widest shot a phone cut can take of a 1024×576 page (social-lib maxCropW: 1495 master px = 797 CSS px), clear of the caption strip.
    expect(CARD_SAFE.width).toBeLessThanOrEqual(797);
    expect(CARD_SAFE.x * 2 + CARD_SAFE.width).toBe(1024);
    expect(CARD_SAFE.y + CARD_SAFE.height + 26).toBeLessThanOrEqual(576 - CAPTION_SAFE(576));
    const src = read("scripts/tutorials/record.ts");
    expect(src).toMatch(/this\.aimed = \{ \.\.\.CARD_SAFE \}/); // …and that column is what the recorder reports as the step's target
  });

  it("blurs a script's redactSelectors from page load — a stylesheet, in place before the page draws", () => {
    expect(redactCss(['[data-testid="text-new-api-key"] code', ".join-link"])).toBe('[data-testid="text-new-api-key"] code,.join-link{filter:blur(9px)!important;user-select:none!important}');
    const script = (redactSelectors: string[]) => { try { parseTutorialScript({ helpKey: "x", title: "t", viewport: { width: 1024, height: 576 }, steps: [{ action: "goto", url: "/", caption: "c", narration: "n" }], redactSelectors }); return true; } catch { return false; } };
    expect(script(['[data-testid="text-new-api-key"] code'])).toBe(true);
    for (const sel of ["text=Secret", "div >> code", 'p:has-text("key")', "a{color:red}", "x</style>"]) expect(script([sel]), sel).toBe(false);
    const src = read("scripts/tutorials/record.ts");
    expect(src).toMatch(/addInitScript\(redactFromLoad, redactCss\(script\.redactSelectors\)\)/);
    expect(src).toMatch(/step\.dialog === "accept" \? d\.accept\(\) : d\.dismiss\(\)/);
  });

  it("finds a video's last frame by counting frames, never from the file's length", () => {
    expect(lastFrameSeekSec(1800, 30)).toBeCloseTo(59.95, 6);        // the last frame starts at 59.9667 s: the seek is before it and after frame 1798
    expect(lastFrameSeekSec(1800, 30)).toBeGreaterThan(1798 / 30);
    expect(lastFrameSeekSec(1800, 30)).toBeLessThan(1799 / 30);
    expect(lastFrameSeekSec(1, 30)).toBe(0);
    expect(() => lastFrameSeekSec(0, 30)).toThrow();
    expect(read("scripts/tutorials/check.ts")).not.toMatch(/seconds \* 1000 - 60\]/);
  });
});

describe("under load", () => {
  it("a refused screenshot is asked for again, and only gives up after several tries", async () => {
    let calls = 0;
    const page = { screenshot: async () => { if (++calls < 3) throw new Error("Page.captureScreenshot: Unable to capture screenshot"); return Buffer.alloc(0); }, waitForTimeout: async () => {} } as any;
    await screenshot(page, "/dev/null");
    expect(calls).toBe(3);
    const dead = { screenshot: async () => { calls++; throw new Error("Unable to capture screenshot"); }, waitForTimeout: async () => {} } as any;
    calls = 0;
    await expect(screenshot(dead, "/dev/null", 4)).rejects.toThrow(/Unable to capture/);
    expect(calls).toBe(4);
  });

  it("a click waits for what it asked the server for, instead of a fixed pause", async () => {
    const handlers: Record<string, ((x: any) => void)[]> = {};
    const page = { on: (e: string, f: (x: any) => void) => { (handlers[e] ??= []).push(f); }, mainFrame: () => "main" } as any;
    const player = new Player(page, { width: 1024, height: 576 }, () => 0).watchNetwork();
    const emit = (e: string, x: any) => handlers[e].forEach((f) => f(x));
    const req = { resourceType: () => "fetch" }, image = { resourceType: () => "image" };
    // Nothing in flight: back after the calm time, long before the limit.
    let t = Date.now(); await player.quiet(120, 2000); expect(Date.now() - t).toBeLessThan(700);
    // An image does not count; a fetch does, until it finishes.
    emit("request", image); emit("request", req);
    setTimeout(() => emit("requestfinished", req), 400);
    t = Date.now(); await player.quiet(120, 3000);
    expect(Date.now() - t).toBeGreaterThanOrEqual(480); expect(Date.now() - t).toBeLessThan(1500);
    // A request that never ends (an event stream) cannot hold a recording for ever.
    emit("request", { resourceType: () => "fetch" });
    t = Date.now(); await player.quiet(120, 600); expect(Date.now() - t).toBeLessThan(1200);
    const src = read("scripts/tutorials/record.ts");
    expect(src.match(/await this\.quiet\(\)/g)!.length).toBeGreaterThanOrEqual(2); // after a click and after a choice
  });

  it("produce.ts keeps the capture until mux and check have passed, tries those again, and can finish a kept capture", () => {
    const src = read("scripts/tutorials/produce.ts");
    expect(src.indexOf('twice("check"')).toBeGreaterThan(src.indexOf('twice("mux"'));
    expect(src.indexOf('fs.rmSync(path.join(out, f)')).toBeGreaterThan(src.indexOf('twice("check"')); // deleted only after the check
    expect(src.match(/fs\.rmSync\(path\.join\(out, f\)/g)).toHaveLength(1);
    expect(src).toMatch(/args\.flags\["from-raw"\]/);
    expect(src).toMatch(/--from-raw: .* is not there/);
  });
});

describe("slots", () => {
  it("are 1 to 8, on ports 8181–8188, one lock each; the voice and encode locks stay global", () => {
    expect(SLOT_MAX).toBe(8);
    expect([0, 1, 4, 5, 8, 9, 1.5, NaN].map(isSlot)).toEqual([false, true, true, true, true, false, false, false]);
    expect(SLOT_PORT(1)).toBe(8181); expect(SLOT_PORT(8)).toBe(8188);
    const produce = read("scripts/tutorials/produce.ts");
    expect(produce).toContain("if (!isSlot(slot)) throw new Error(`--slot is 1 to ${SLOT_MAX}`);");
    expect(produce).toContain("withLock(path.join(WORK_DIR, `slot${slot}.lock`)");
    const lib = read("scripts/tutorials/lib.ts");
    expect(lib).toContain('export const TTS_LOCK = path.join(WORK_DIR, "tts.lock");');
    expect(lib).toContain('export const ENCODE_LOCK = path.join(WORK_DIR, "encode.lock");');
    // No slot ever means the production database or the production app.
    for (let s = 1; s <= SLOT_MAX; s++) expect([5433, 8110]).not.toContain(SLOT_PORT(s));
  });
});
