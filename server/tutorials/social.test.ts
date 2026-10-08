import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  CAP_MARGIN_MS, CUT_NAMES, LAYOUTS, MAX_PHRASE_WORDS, MAX_SPEED, SAFE_AREA, assFile, cameraExpr, cameraKeyframes, captionEvents, captionInkHeight, chunkCaption, cropOf,
  findGaps, findRing, inside, isRingBlue, keptEndMs, maxCropW, overlaps, planCut, safeRect, shotAt, shotFor, stepFocus, textWidth, wordTimes, type CutStepInput,
} from "../../scripts/tutorials/social-lib";
import { PLATFORM_RULES, SOCIAL_PLATFORMS, buildSocialText, lintPost, sameThing } from "../../scripts/tutorials/social-text";
import { socialKey } from "../../scripts/tutorials/social-upload";
import { TUTORIAL_FILE, TUTORIAL_PREFIX } from "@shared/help/videos";
import { helpEntry } from "@shared/help/registry";

/**
 * The social cuts (scripts/tutorials/social.ts, docs/tutorials/PRODUCER-GUIDE.md "Social cuts"): the
 * decisions that do not need an encoder — safe areas, what a cut keeps, caption phrases, the camera,
 * finding the ring, and what a post may say. Static: no ffmpeg, no browser, no network.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = { width: 1920, height: 1080 };

describe("layouts and platform safe areas", () => {
  it("is 1080×1920 capped at 59 s and 1080×1350 capped at 89 s, each with a 2 s end card", () => {
    expect([LAYOUTS.vertical.width, LAYOUTS.vertical.height, LAYOUTS.vertical.maxSec, LAYOUTS.vertical.endCardSec]).toEqual([1080, 1920, 59, 2]);
    expect([LAYOUTS.feed.width, LAYOUTS.feed.height, LAYOUTS.feed.maxSec, LAYOUTS.feed.endCardSec]).toEqual([1080, 1350, 89, 2]);
  });
  it("keeps captions and the headline out of what Reels / TikTok draw over: top 14%, bottom 22%, the right-hand buttons", () => {
    const l = LAYOUTS.vertical, safe = safeRect(l);
    expect(SAFE_AREA.vertical).toMatchObject({ top: 0.14, bottom: 0.22 });
    expect(safe.y).toBe(Math.round(1920 * 0.14));
    expect(safe.y + safe.h).toBeLessThanOrEqual(Math.round(1920 * 0.78) + 1);
    expect(inside(l.captions, safe)).toBe(true);
    expect(l.captions.x + l.captions.w).toBeLessThanOrEqual(1080 * (1 - SAFE_AREA.vertical.right) + 1);
    // The headline band: under the top strip, above the recording (the button column starts lower down).
    expect(l.header.y).toBeGreaterThanOrEqual(safe.y);
    expect(l.header.y + l.header.h).toBeLessThanOrEqual(l.panel.y);
  });
  it("never lays captions over the recording, and two caption lines fit their strip", () => {
    for (const name of CUT_NAMES) {
      const l = LAYOUTS[name];
      expect(overlaps(l.captions, l.panel), name).toBe(false);
      expect(overlaps(l.captions, l.header), name).toBe(false);
      expect(l.captions.y, name).toBeGreaterThanOrEqual(l.bar.y + l.bar.h);
      expect(captionInkHeight(l), name).toBeLessThanOrEqual(l.captions.h);
      expect(inside(l.captions, safeRect(l)), name).toBe(true);
      expect(inside(l.panel, { x: 0, y: 0, w: l.width, h: l.height }), name).toBe(true);
      expect(l.panel.w, name).toBe(l.width); // the recording is full width, not letterboxed
    }
  });
  it("shows about 900–1100 master pixels across the phone's width in a normal shot", () => {
    for (const name of CUT_NAMES) {
      const shot = shotFor({ x: 800, y: 500, w: 200, h: 60 }, LAYOUTS[name], SRC);
      expect(shot.cropW).toBeGreaterThanOrEqual(900);
      expect(shot.cropW).toBeLessThanOrEqual(1100);
    }
  });
});

/** n steps of `speechMs` each, recorded the way record.ts does: 150 ms lead, the line, 450 ms pad, the hold. */
const steps = (n: number, speechMs: number, o: { holdMs?: number; chapters?: number[]; actionMs?: number } = {}): CutStepInput[] => {
  let t = 2000;
  return Array.from({ length: n }, (_x, i) => {
    const startMs = t, narrationStartMs = t + 150, endMs = Math.max(narrationStartMs + speechMs + 450, startMs + (o.actionMs ?? 0)) + (o.holdMs ?? 0);
    t = endMs;
    return { index: i, startMs, narrationStartMs, narrationMs: speechMs, endMs, holdMs: o.holdMs, chapter: o.chapters?.includes(i) };
  });
};

describe("what a cut keeps", () => {
  it("only tightens pauses when that is enough: normal speed, every step, cuts after the line", () => {
    const s = steps(10, 3000, { holdMs: 800 }), plan = planCut(s, { maxSec: 59, endCardSec: 2 });
    expect(plan.speed).toBe(1);
    expect(plan.truncated).toBe(false);
    expect(plan.steps).toEqual(s.map((x) => x.index));
    plan.segments.forEach((g, i) => {
      expect(g.srcStartMs).toBe(s[i].startMs);
      expect(g.srcEndMs).toBeGreaterThanOrEqual(s[i].narrationStartMs + s[i].narrationMs); // never inside a sentence
      expect(g.srcEndMs).toBeLessThanOrEqual(s[i].endMs);
      expect(g.speechEndMs).toBeLessThanOrEqual(g.outEndMs);
    });
    // 800 ms of hold and half the pad are gone from every step but the last.
    expect(plan.bodyMs).toBeLessThan(s[9].endMs - s[0].startMs - 9 * 900);
  });
  it("speeds speech up by 8% at most, and only as much as it needs", () => {
    const s = steps(16, 3400), plan = planCut(s, { maxSec: 59, endCardSec: 2 });
    expect(plan.truncated).toBe(false);
    expect(plan.speed).toBeGreaterThan(1);
    expect(plan.speed).toBeLessThanOrEqual(MAX_SPEED);
    expect(plan.totalMs).toBeLessThanOrEqual(59_000 - CAP_MARGIN_MS + 1);
    expect(plan.totalMs).toBeGreaterThan(58_000);
  });
  it("keeps the opening steps when the walkthrough cannot fit, under the hard cap, and says so", () => {
    const s = steps(30, 3400), plan = planCut(s, { maxSec: 59, endCardSec: 2 });
    expect(plan.truncated).toBe(true);
    expect(plan.speed).toBe(MAX_SPEED);
    expect(plan.steps[0]).toBe(0);
    expect(plan.steps).toEqual(plan.steps.map((_x, i) => i)); // continuous, from the start
    expect(plan.steps.length).toBeLessThan(30);
    expect(plan.totalMs).toBeLessThanOrEqual(59_000);
    // One more step would not have fitted.
    expect(() => planCut(s.slice(0, plan.steps.length + 1), { maxSec: 59, endCardSec: 2, maxSpeed: MAX_SPEED })).not.toThrow();
    expect(planCut(s.slice(0, plan.steps.length + 1), { maxSec: 59, endCardSec: 2 }).truncated).toBe(true);
  });
  it("prefers to stop at a chapter boundary near the end", () => {
    const s = steps(30, 3400, { chapters: [0, 6, 13, 22] }), free = planCut(steps(30, 3400), { maxSec: 59, endCardSec: 2 }), plan = planCut(s, { maxSec: 59, endCardSec: 2 });
    expect(free.steps.length).toBeGreaterThan(13);
    expect(plan.steps.length).toBe(13); // ends just before the chapter that starts at step 13
  });
  it("keeps an action that ran longer than its line (typing, a page loading)", () => {
    const [s] = steps(1, 1000, { actionMs: 5000, holdMs: 300 });
    expect(keptEndMs(s)).toBeGreaterThan(s.narrationStartMs + s.narrationMs + 2000);
    expect(keptEndMs(s)).toBeLessThanOrEqual(s.endMs);
  });
  it("ends every kept step on a frame of the master when given its grid", () => {
    const grid = 1000 / 30, s = steps(8, 2777).map((x) => ({ ...x, startMs: Math.round(x.startMs / grid) * grid, endMs: Math.round(x.endMs / grid) * grid }));
    for (const g of planCut(s, { maxSec: 59, endCardSec: 2, gridMs: grid }).segments) expect(Math.abs(g.srcEndMs / grid - Math.round(g.srcEndMs / grid))).toBeLessThan(1e-6);
  });
  it("the feed cut keeps a walkthrough the vertical one has to shorten", () => {
    const s = steps(22, 3000);
    expect(planCut(s, { maxSec: LAYOUTS.vertical.maxSec, endCardSec: 2 }).truncated).toBe(true);
    const feed = planCut(s, { maxSec: LAYOUTS.feed.maxSec, endCardSec: 2 });
    expect(feed.truncated).toBe(false);
    expect(feed.totalMs).toBeLessThanOrEqual(89_000);
  });
});

describe("captions", () => {
  const l = LAYOUTS.vertical, maxW = l.captions.w - 24;
  const lines = [
    "Let's write an estimate and send it to a client. Start on the Estimates page.",
    "Set the quantity. This kitchen needs thirty square feet, and the total updates.",
    "Choose Add. The item comes in with its price and its scope of work.",
    "You'll find the Database Directory in the menu, under Permits and Databases. It's free to browse.",
  ];
  it("chunks narration into phrases of two lines at most that fit the strip, in order, never across a sentence", () => {
    for (const text of lines) {
      const phrases = chunkCaption(text, maxW, l.captionPx);
      expect(phrases.flatMap((p) => p.words).join(" ")).toBe(text.replace(/\s+/g, " "));
      for (const p of phrases) {
        expect(p.lines.length).toBeLessThanOrEqual(2);
        expect(p.words.length).toBeLessThanOrEqual(MAX_PHRASE_WORDS);
        expect(p.lines.flat()).toEqual(p.words);
        for (const line of p.lines) expect(textWidth(line.join(" "), l.captionPx)).toBeLessThanOrEqual(maxW);
        // A sentence end is only ever the last word of a phrase.
        p.words.slice(0, -1).forEach((w) => expect(/[.!?]$/.test(w), `${w} in “${p.words.join(" ")}”`).toBe(false));
      }
    }
    expect(() => chunkCaption("Pneumonoultramicroscopicsilicovolcanoconiosisandmore", 300, 78)).toThrow(/wider than a caption line/);
  });
  it("measures capitals with Anton's own widths", () => {
    expect(textWidth("mm", 100)).toBeCloseTo(149.2, 1);
    expect(textWidth("il", 100)).toBeLessThan(textWidth("mw", 100) / 2);
  });
  it("times every word inside its clip, in order, and starts sentences at the clip's own pauses", () => {
    const text = "Step one is the client. Search by name, email or phone.";
    const plain = wordTimes(text, 1000, 4000);
    expect(plain.map((w) => w.word).join(" ")).toBe(text);
    plain.forEach((w, i) => { expect(w.startMs).toBeGreaterThanOrEqual(i ? plain[i - 1].startMs : 1000); expect(w.endMs).toBeLessThanOrEqual(5001); expect(w.endMs).toBeGreaterThan(w.startMs); });
    // With the silence between the two sentences known, "Search" starts when that silence ends.
    const timed = wordTimes(text, 1000, 4000, [{ startMs: 1500, endMs: 1800 }, { startMs: 2600, endMs: 2650 }]);
    expect(timed.find((w) => w.word === "Search")!.startMs).toBe(2800);
    expect(timed.find((w) => w.word === "client.")!.endMs).toBeLessThanOrEqual(2501);
    // A pause that is nowhere near the sentence break is not believed.
    expect(wordTimes(text, 0, 4000, [{ startMs: 3500, endMs: 3700 }]).find((w) => w.word === "Search")!.startMs).toBe(plain.find((w) => w.word === "Search")!.startMs - 1000);
  });
  it("finds the silences in a clip", () => {
    const pcm = new Int16Array(48000).fill(5000);
    pcm.fill(0, 9600, 19200); pcm.fill(0, 30000, 31000);
    expect(findGaps(pcm, 48000)).toEqual([{ startMs: 200, endMs: 400 }]);
  });
  it("shows one phrase at a time with exactly one active word, never past the end, never two at once", () => {
    const clips = [{ text: lines[0], startMs: 150, endMs: 4200 }, { text: "Choose New estimate.", startMs: 4500, endMs: 5600 }];
    const ev = captionEvents(clips, maxW, l.captionPx, 6000);
    expect(ev.length).toBe(lines[0].split(" ").length + 3);
    ev.forEach((e, i) => {
      expect(e.endMs).toBeGreaterThan(e.startMs);
      if (i) expect(e.startMs).toBeGreaterThanOrEqual(ev[i - 1].endMs);
      expect(e.active).toBeLessThan(e.lines.flat().length);
      expect(e.endMs).toBeLessThanOrEqual(6000);
    });
    const ass = assFile(ev, l);
    expect(ass).toContain("Style: Cap,Anton,");
    expect(ass).toContain("&H1673F9&"); // the brand orange #f97316, as ASS writes it
    // Every line is placed inside the caption strip.
    for (const m of ass.matchAll(/\\pos\((\d+),(\d+)\)/g)) {
      expect(+m[1]).toBe(Math.round(l.captions.x + l.captions.w / 2));
      expect(+m[2]).toBeGreaterThan(l.captions.y + 30);
      expect(+m[2]).toBeLessThan(l.captions.y + l.captions.h - 30);
    }
    expect(ass).toMatch(/\{\\1c&H1673F9&\}LET'S\{\\1c&HFFFFFF&\} WRITE AN/);
  });
});

describe("the camera", () => {
  const l = LAYOUTS.vertical;
  const inFrame = (c: { x: number; y: number; w: number; h: number }) => c.x >= -0.01 && c.y >= -0.01 && c.x + c.w <= SRC.width + 0.01 && c.y + c.h <= SRC.height + 0.01;
  it("frames the target, inside the master, wider only for a wide target", () => {
    for (const box of [{ x: 10, y: 10, w: 200, h: 60 }, { x: 1700, y: 1000, w: 200, h: 60 }, { x: 648, y: 572, w: 1060, h: 112 }, { x: 0, y: 0, w: 1920, h: 1080 }]) {
      const shot = shotFor(box, l, SRC), c = cropOf(shot, l);
      expect(inFrame(c), JSON.stringify(box)).toBe(true);
      expect(c.w / c.h).toBeCloseTo(l.panel.w / l.panel.h, 5);
      if (box.w <= 800 && box.h <= 400) expect(c.x <= box.x && c.x + c.w >= box.x + box.w && c.y <= box.y && c.y + c.h >= box.y + box.h, JSON.stringify(box)).toBe(true);
    }
    expect(shotFor({ x: 648, y: 572, w: 1060, h: 112 }, l, SRC).cropW).toBeGreaterThan(1200);
    expect(shotFor(null, l, SRC).cropW).toBeGreaterThan(l.baseCropW);
    expect(maxCropW(l.panel, SRC)).toBe(Math.floor((1080 * 1080) / 780));
    // An older 1280×720 master is framed the same way.
    expect(inFrame(cropOf(shotFor({ x: 390, y: 356, w: 300, h: 52 }, l, { width: 1280, height: 720 }), l))).toBe(true);
  });
  const focus = [
    { step: 0, box: null, outStartMs: 0, outEndMs: 4000 },
    { step: 1, box: { x: 1568, y: 152, w: 328, h: 96 }, ringOffMs: 5200, outStartMs: 4000, outEndMs: 6500 },
    { step: 2, box: { x: 648, y: 478, w: 1060, h: 134 }, outStartMs: 6500, outEndMs: 10000 },
    { step: 3, box: { x: 660, y: 490, w: 1040, h: 120 }, outStartMs: 10000, outEndMs: 12000 },
  ];
  it("opens wide and pushes in during the hook, follows each step, moves on after a click, skips moves too small to matter", () => {
    const cam = cameraKeyframes(focus, l, SRC);
    expect(cam.start.cropW).toBe(maxCropW(l.panel, SRC));
    expect(cam.keys[0].atMs).toBeLessThan(200);
    expect(cam.keys[0].atMs + cam.keys[0].durMs).toBeLessThanOrEqual(1500); // motion through the hook
    expect(cam.keys.map((k) => Math.round(k.atMs))).toEqual([60, 4040, 5320]); // step 2's shot was reached after the click; step 3 is the same place
    expect(shotAt(cam, 4900).cx).toBeCloseTo(shotFor(focus[1].box, l, SRC).cx, 3);
    expect(shotAt(cam, 9000)).toEqual(shotFor(focus[2].box, l, SRC));
    for (let ms = 0; ms <= 12000; ms += 50) expect(inFrame(cropOf(shotAt(cam, ms), l)), `at ${ms}`).toBe(true);
  });
  it("writes ffmpeg expressions that compute the same path", () => {
    const cam = cameraKeyframes(focus, l, SRC), expr = cameraExpr(cam, l);
    const run = (e: string, t: number) => new Function("t", "clip", `return ${e};`)(t, (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))) as number;
    for (const t of [0, 0.5, 1.2, 3, 4.3, 5.5, 5.9, 8, 11]) {
      const s = shotAt(cam, t * 1000), z = l.panel.w / s.cropW, zx = run(expr.zoom, t);
      // Zoom, x and y are eased separately, so between two shots the path differs a little from the eased crop; at rest it is exact.
      const moving = cam.keys.some((k) => t * 1000 > k.atMs && t * 1000 < k.atMs + k.durMs);
      if (!moving) {
        expect(zx).toBeCloseTo(z, 3);
        expect(run(expr.x, t)).toBeCloseTo((s.cx - s.cropW / 2) * z, 0);
        expect(run(expr.y, t)).toBeCloseTo((s.cy - (s.cropW * l.panel.h) / l.panel.w / 2) * z, 0);
      }
      // …and it never shows anything outside the master.
      expect(run(expr.x, t)).toBeGreaterThanOrEqual(-0.5);
      expect(run(expr.x, t) + l.panel.w).toBeLessThanOrEqual(SRC.width * zx + 0.5);
      expect(run(expr.y, t)).toBeGreaterThanOrEqual(-0.5);
      expect(run(expr.y, t) + l.panel.h).toBeLessThanOrEqual(SRC.height * zx + 0.5);
    }
  });
});

describe("finding the recorder's ring in a frame", () => {
  const W = 640, H = 360;
  const frame = () => Buffer.alloc(W * H * 3, 250);
  const fill = (b: Buffer, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) b.set(rgb, (y * W + x) * 3); };
  const ring = (b: Buffer, x: number, y: number, w: number, h: number, rgb: [number, number, number] = [246, 114, 15], t = 5) => {
    fill(b, x + 14, y, w - 28, t, rgb); fill(b, x + 14, y + h - t, w - 28, t, rgb); // straight edges stop short of the round corners
    fill(b, x, y + 14, t, h - 28, rgb); fill(b, x + w - t, y + 14, t, h - 28, rgb);
  };
  it("finds the hollow orange ring and ignores the app's solid orange buttons", () => {
    const b = frame();
    fill(b, 20, 40, 180, 50, [249, 115, 22]); // the Create button
    fill(b, 20, 250, 180, 40, [249, 115, 22]); // the selected menu item
    expect(findRing(b, W, H)).toBeNull();
    ring(b, 300, 120, 220, 70);
    const box = findRing(b, W, H)!;
    expect(box).not.toBeNull();
    expect(Math.abs(box.x - 300)).toBeLessThanOrEqual(8);
    expect(Math.abs(box.x + box.w - 520)).toBeLessThanOrEqual(8);
    expect([box.y, box.h]).toEqual([120, 70]);
  });
  it("needs all four sides, and finds the first video's blue ring only when asked for blue", () => {
    const b = frame();
    fill(b, 300, 120, 220, 5, [246, 114, 15]); fill(b, 300, 185, 220, 5, [246, 114, 15]); // two rules, no sides
    expect(findRing(b, W, H)).toBeNull();
    const c = frame();
    ring(c, 100, 100, 300, 60, [26, 115, 232], 3);
    expect(findRing(c, W, H)).toBeNull();
    expect(findRing(c, W, H, isRingBlue)).toMatchObject({ y: 100, h: 60 });
  });
  it("turns the samples of a step into its target and the moment a click's ring left", () => {
    const box = { x: 100, y: 100, w: 200, h: 60 };
    const samples = [0, 250, 500, 750, 1000, 1250, 1500, 1750].map((ms) => ({ ms, box: ms >= 250 && ms <= 1000 ? box : null }));
    expect(stepFocus(samples, 0, 2000)).toEqual({ box, ringOffMs: 1250 });
    expect(stepFocus(samples.map((s) => ({ ...s, box: s.ms >= 250 ? box : null })), 0, 2000)).toEqual({ box, ringOffMs: null });
    expect(stepFocus(samples, 1250, 2000)).toEqual({ box: null, ringOffMs: null });
  });
});

describe("what a post says", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/tutorials/youtube-schedule.json"), "utf8")).videos as { helpKey: string; title: string }[];
  const keys = fs.readdirSync(path.join(ROOT, "docs/tutorials/scripts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((k) => helpEntry(k));
  const build = (k: string) => {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/tutorials/scripts", `${k}.json`), "utf8"));
    return buildSocialText({ helpKey: k, title: s.youtube?.title ?? ledger.find((v) => v.helpKey === k)?.title ?? s.title, headline: s.thumbnail?.headline, entry: helpEntry(k) as any });
  };
  it("keeps to each platform's limit and hashtag count for every recorded script in the repo", () => {
    expect(keys.length).toBeGreaterThan(8);
    for (const k of keys) {
      const t = build(k);
      for (const p of SOCIAL_PLATFORMS) {
        const post = t.platforms[p], rule = PLATFORM_RULES[p];
        expect(post.length, `${k} ${p}`).toBe(post.text.length);
        expect(post.length, `${k} ${p}`).toBeLessThanOrEqual(rule.max);
        expect(rule.max).toBeLessThanOrEqual(rule.limit);
        const tags = post.text.match(/#[A-Za-z][A-Za-z0-9_]*/g) ?? [];
        expect(tags.length, `${k} ${p}`).toBeGreaterThanOrEqual(rule.hashtags.min);
        expect(tags.length, `${k} ${p}`).toBeLessThanOrEqual(rule.hashtags.max);
        expect(lintPost(p, post.text, JSON.stringify(helpEntry(k))), `${k} ${p}`).toEqual([]);
        expect(post.text, `${k} ${p}`).not.toMatch(/portal\.constructhub|included with|\$\d/i);
        expect(post.cut).toBe(rule.cut);
      }
      expect(t.platforms.twitter.length, k).toBeLessThanOrEqual(270);
      expect(t.platforms.threads.length, k).toBeLessThanOrEqual(500);
      expect(t.platforms.linkedin.text, k).toContain("https://constructhub.us/tutorials");
      expect(t.platforms.instagram.text, k).toContain("Full tutorial: link in bio / constructhub.us/tutorials");
    }
  });
  it("the platform limits are the published ones", () => {
    expect(Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, PLATFORM_RULES[p].limit]))).toEqual({ instagram: 2200, tiktok: 2200, linkedin: 3000, facebook: 63206, twitter: 280, threads: 500 });
    expect(PLATFORM_RULES.instagram.hashtags.max).toBe(5); // Instagram's cap since December 2025
    expect(PLATFORM_RULES.threads.cut).toBe("vertical"); // 60 s at most through Blotato
  });
  it("gives the four published videos a full Instagram caption and a LinkedIn post of the asked length, each its own", () => {
    const four = ["database-directory", "crm-clients", "crm-create-estimate", "crm-schedule"].map(build);
    for (const t of four) {
      expect(t.platforms.instagram.length, t.helpKey).toBeGreaterThanOrEqual(1200);
      expect(t.platforms.instagram.length, t.helpKey).toBeLessThanOrEqual(1800);
      expect(t.platforms.linkedin.length, t.helpKey).toBeGreaterThanOrEqual(900);
      expect(t.platforms.linkedin.length, t.helpKey).toBeLessThanOrEqual(1400);
      expect((t.platforms.tiktok.text.match(/#/g) ?? []).length, t.helpKey).toBeGreaterThanOrEqual(4);
      expect(t.platforms.instagram.text.split("\n")[0], t.helpKey).toContain(t.hook);
    }
    // CRM posts say what the CRM is and that the screen is a demo; the permit directory is real data and is not called a demo.
    expect(four[1].platforms.linkedin.text).toContain("The CRM is a separate product with its own plans.");
    expect(four[1].platforms.instagram.text).toContain("demo workspace");
    expect(four[0].platforms.instagram.text).not.toContain("demo workspace");
    expect(four[0].platforms.instagram.text).toMatch(/permit/i);
    for (let i = 0; i < four.length; i++) for (let j = i + 1; j < four.length; j++) {
      const a = new Set(four[i].platforms.instagram.text.split("\n")), same = four[j].platforms.instagram.text.split("\n").filter((x) => x && a.has(x));
      expect(same.length, `${four[i].helpKey} / ${four[j].helpKey}: ${same.join(" | ")}`).toBeLessThanOrEqual(4);
    }
  });
  it("refuses a post with a price, a vendor, a promise, another address or a claim about real results", () => {
    const ok = "Send estimates fast. Full tutorial: https://constructhub.us/tutorials #contractors #estimating #ConstructHUB";
    expect(lintPost("linkedin", ok)).toEqual([]);
    expect(lintPost("linkedin", `${ok} Only $49 a month.`).join()).toMatch(/price/);
    expect(lintPost("linkedin", `${ok} Only $49 a month.`, "Costs $49 a month.")).toEqual([]);
    expect(lintPost("linkedin", `${ok} Powered by OpenAI.`).join()).toMatch(/vendor/);
    expect(lintPost("linkedin", `${ok} The best CRM, guaranteed.`).join()).toMatch(/best/);
    expect(lintPost("linkedin", `${ok} Log in at portal.constructhub.us`).join()).toMatch(/portal\.constructhub|address/);
    expect(lintPost("linkedin", `${ok} See example.com`).join()).toMatch(/address other than constructhub\.us/);
    expect(lintPost("linkedin", `${ok} Real results from our customers.`).join()).toMatch(/real results/);
    expect(lintPost("twitter", "x".repeat(271)).join()).toMatch(/over 270/);
    expect(lintPost("instagram", `${ok} #a1 #b2 #c3`).join()).toMatch(/6 hashtags/);
  });
  it("does not say the same thing twice", () => {
    expect(sameThing("Every client automatically gets a private portal page.", "Every client automatically gets a private portal page, and you can open it the way they see it.")).toBe(true);
    expect(sameThing("Notes are private to your team.", "Search finds a client by name, email, phone or address.")).toBe(false);
  });
  it("names a cut's object so the media route as deployed serves it", () => {
    const key = socialKey("crm-create-estimate", "vertical-tiktok.mp4", "0123abcd".repeat(8));
    expect(key).toBe("tutorials/crm-create-estimate.social-tiktok.0123abcd.mp4");
    for (const f of ["vertical.mp4", "feed.mp4", "cover-vertical.jpg", "cover-feed.jpg"]) expect(TUTORIAL_FILE.test(socialKey("database-directory", f, "ab".repeat(32)).slice(TUTORIAL_PREFIX.length)), f).toBe(true);
    expect(() => socialKey("cloudflare.connections", "feed.mp4", "ab".repeat(32))).toThrow(/media route/);
    expect(() => socialKey("crm-clients", "../x.mp4", "ab".repeat(32))).toThrow(/not a social file/);
  });
});
