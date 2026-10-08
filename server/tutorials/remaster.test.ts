/**
 * The repair tools for finished walkthroughs (scripts/tutorials/flash.ts, deflash.ts, remaster.ts):
 * the parts that are arithmetic. What they do to a real video is checked on real videos by check.ts.
 */
import { describe, expect, it } from "vitest";
import { LIMITS, isFallback, isFlat, lookAt, spansOf, SCAN, type FrameLook } from "../../scripts/tutorials/flash";
import { deflashPlan, extendPlan } from "../../scripts/tutorials/deflash";
import { retime } from "../../scripts/tutorials/remaster";
import type { StepTiming } from "../../scripts/tutorials/lib";

const PIXELS = SCAN.width * SCAN.height;
const page: FrameLook = { flat: 0.55, bright: 0.6, likeness: 0.1, mean: 180 };
const fallback: FrameLook = { flat: 0.93, bright: 0.95, likeness: 0.97, mean: 250 };
const blank: FrameLook = { flat: 0.999, bright: 0.999, likeness: 0, mean: 254 };
const looks = (spec: [FrameLook, number][]) => spec.flatMap(([l, n]) => Array.from({ length: n }, () => ({ ...l })));

describe("flash.ts — reading a frame", () => {
  const frame = (paint: (i: number) => number) => { const b = Buffer.alloc(PIXELS); for (let i = 0; i < PIXELS; i++) b[i] = paint(i); return b; };
  const text = frame((i) => (Math.floor(i / SCAN.width) > 10 && Math.floor(i / SCAN.width) < 30 && i % SCAN.width > 20 && i % SCAN.width < 110 && Math.floor(i / SCAN.width) % 4 === 0 ? 120 : 255));
  it("a white page is flat, and not the fallback", () => {
    const l = lookAt(frame(() => 255), 0, [text]);
    expect(isFlat(l)).toBe(true);
    expect(isFallback(l)).toBe(false);
  });
  it("the fallback is recognised, also washed out and with a pointer on it", () => {
    expect(isFallback(lookAt(text, 0, [text]))).toBe(true);
    const washed = frame((i) => Math.round(text[i] + (255 - text[i]) * 0.5));
    expect(isFallback(lookAt(washed, 0, [text]))).toBe(true);
    const pointer = Buffer.from(text); for (let y = 80; y < 86; y++) for (let x = 100; x < 104; x++) pointer[y * SCAN.width + x] = 20;
    expect(isFallback(lookAt(pointer, 0, [text]))).toBe(true);
  });
  it("an app page is neither", () => {
    const app = frame((i) => (i % SCAN.width < 30 ? 30 : (Math.floor(i / SCAN.width) % 9 < 2 ? 140 : 250)));
    const l = lookAt(app, 0, [text]);
    expect(isFlat(l)).toBe(false);
    expect(isFallback(l)).toBe(false);
    expect(l.likeness).toBeLessThan(LIMITS.likeness);
  });
});

describe("flash.ts — spans", () => {
  const body = { first: 54, last: 400 };
  it("finds the fallback and the blank page after it as one span", () => {
    const l = looks([[page, 100], [fallback, 8], [blank, 30], [page, 300]]);
    const spans = spansOf(l, 30, body);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ from: 100, to: 137, kind: "fallback+blank", fallbackFrames: 8, blankFrames: 30 });
    expect(spans[0].ms).toBe(Math.round((38 * 1000) / 30));
  });
  it("one frame of the fallback is enough", () => {
    expect(spansOf(looks([[page, 100], [fallback, 1], [page, 300]]), 30, body)).toHaveLength(1);
  });
  it("a flat page counts only when it lasts longer than 200 ms", () => {
    expect(spansOf(looks([[page, 100], [blank, 6], [page, 300]]), 30, body)).toHaveLength(0);
    expect(spansOf(looks([[page, 100], [blank, 7], [page, 300]]), 30, body)).toHaveLength(1);
  });
  it("ignores the intro and end cards, however flat", () => {
    const l = looks([[blank, 54], [page, 347], [blank, 120]]);
    expect(spansOf(l, 30, body)).toHaveLength(0);
  });
  it("takes in the frames still fading in from white after it", () => {
    const fade = [250, 240, 225, 205, 190].map((mean) => ({ ...page, mean }));
    const l = [...looks([[page, 100], [blank, 20]]), ...fade, ...looks([[{ ...page, mean: 180 }, 300]])];
    const [span] = spansOf(l, 30, body);
    expect(span.from).toBe(100);
    expect(span.washFrames).toBeGreaterThanOrEqual(4);
    expect(span.to).toBeGreaterThanOrEqual(123);
  });
});

describe("deflash.ts — the frame plan", () => {
  const body = { first: 54, last: 900 };
  it("holds the last good frame over a span and keeps the frame count", () => {
    const plan = deflashPlan(1000, [{ from: 300, to: 340, startMs: 10000, ms: 1367, kind: "fallback", fallbackFrames: 41, blankFrames: 0, washFrames: 0 }], body);
    expect(plan).toHaveLength(1000);
    for (let i = 300; i <= 340; i++) expect(plan[i]).toEqual({ src: 299 });
    expect(plan[299]).toEqual({ src: 299 });
    expect(plan[341]).toEqual({ src: 341 });
  });
  it("a span that opens the recording takes the first good frame after it, faded in from white", () => {
    const plan = deflashPlan(1000, [{ from: 56, to: 80, startMs: 1867, ms: 833, kind: "fallback", fallbackFrames: 25, blankFrames: 0, washFrames: 0 }], body);
    expect(plan).toHaveLength(1000);
    expect(plan[54]).toEqual({ src: 81, white: 1 });
    expect(plan[58].white).toBeGreaterThan(0);
    expect(plan[70]).toEqual({ src: 81 });
    expect(plan[81]).toEqual({ src: 81 });
    expect(plan[53]).toEqual({ src: 53 });
  });
  it("extends a step by holding its last frame", () => {
    const plan = extendPlan(deflashPlan(10, [], { first: 0, last: 9 }), [{ frame: 4, extra: 3 }]);
    expect(plan.map((p) => p.src)).toEqual([0, 1, 2, 3, 4, 4, 4, 4, 5, 6, 7, 8, 9]);
  });
});

describe("remaster.ts — new step times", () => {
  const step = (index: number, startMs: number, narrationMs: number, endMs: number): StepTiming => ({ index, action: "click", caption: "", startMs, narrationStartMs: startMs + 150, narrationMs, endMs });
  const steps = [step(0, 1000, 3000, 4500), step(1, 4500, 2000, 7000), step(2, 7000, 2500, 10000)];
  it("a longer clip extends its step by whole frames and moves everything after it", () => {
    const r = retime(steps, new Map([[1, 2100]]));
    expect(r.holds).toEqual([{ index: 1, frames: 3 }]);
    expect(r.shiftMs).toBeCloseTo(100, 5);
    expect(r.steps[0]).toEqual(steps[0]);
    expect(r.steps[1]).toMatchObject({ startMs: 4500, narrationStartMs: 4650, narrationMs: 2100 });
    expect(r.steps[1].endMs).toBeCloseTo(7100, 5);
    expect(r.steps[2].startMs).toBeCloseTo(7100, 5);
    expect(r.steps[2].narrationStartMs).toBeCloseTo(7250, 5);
    expect(r.steps[2].endMs).toBeCloseTo(10100, 5);
    // The pause after the line is what it was.
    expect(r.steps[1].endMs - (r.steps[1].narrationStartMs + r.steps[1].narrationMs)).toBeGreaterThanOrEqual(steps[1].endMs - (steps[1].narrationStartMs + steps[1].narrationMs));
  });
  it("a shorter clip moves nothing", () => {
    const r = retime(steps, new Map([[0, 2800]]));
    expect(r.holds).toEqual([]);
    expect(r.shiftMs).toBe(0);
    expect(r.steps[0]).toEqual({ ...steps[0], narrationMs: 2800 });
    expect(r.steps.slice(1)).toEqual(steps.slice(1));
  });
});
