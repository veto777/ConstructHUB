import { describe, expect, it } from "vitest";
import {
  BudgetError, HF_BASE, PHASE2, PILOT, assertWithinBudget, charged, emptyLedger, estimate, generate, phase2Cap, pilotCap, redact, spent, uploadInput,
  type Creds, type Fetch, type GenerateInput, type Io, type Ledger,
} from "../../scripts/gator/higgsfield";
import { CONCEPTS, FINALS, PHASE2_IDS, SAMPLES, VOICE_DESCRIPTION, conceptById, lintConcept, motionPrompt, postsOf, stillPrompt } from "../../scripts/gator/concepts";
import { LIVE_CONCEPTS } from "../../scripts/gator/concepts-live";
import { plan as replayPlan } from "../../scripts/gator/replay";
import { boardMd, byStyle, due, engagementRate, parseManual, percentiles, postedOf, rank, recommend, type Metrics, type Posted } from "../../scripts/gator/scoreboard";
import { STYLES } from "../../scripts/gator/styles";
import { schedule, stylesMd, DOC as STYLES_DOC } from "../../scripts/gator/styles-doc";
import { BAND, REFERENCE, analyse, compare, pitchCorrection } from "../../scripts/gator/voiceprint";
import { END_TAG_SEC, H, LOGO_RECT, MAX_SEC, MIN_PX, W, ZONES, assFile, layoutBeat, wrapCaption, type Beat } from "../../scripts/gator/layout";
import { automaticChecks, mayPost, nextInQueue, type Queue } from "../../scripts/gator/daily";
import { VOICE, voiceFilter, voiceKey } from "../../scripts/gator/voice";
import { accountTimes, nextAllowed, rateRefusal } from "../../scripts/tutorials/social-rate";
import { bandFault, clipSpent, hatRow, lineBeats, peaksOf, plainWords, saysTheLine, subtitleBeats, timeline } from "../../scripts/gator/make";
import fs from "fs";
import { DOC, conceptsMd } from "../../scripts/gator/concepts-doc";
import { mediaKey, planAsap, plannedMediaUrl, viralMain } from "../../scripts/gator/post";
import { RATE, synth, toPcm } from "../../scripts/gator/sound";
import { VIRAL_RULES, emptyViralLedger, planViral, slotFor, weekOf, type ViralClip, type ViralLedgerPost, type ViralTarget } from "../../scripts/gator/stream";
import { buildPost, emptyLedger as emptySocialLedger, planPosts, type LedgerPost, type SocialLedger, type VideoForPost } from "../../scripts/tutorials/social-post-lib";
import { SAFE_AREA, inside, overlaps, safeRect } from "../../scripts/tutorials/social-lib";
import { uploadSessionRequest } from "../youtube/client";
import { zoneTime } from "../youtube/schedule";

/**
 * The gator shorts (scripts/gator): the money rules of the generation client, the caption layout, the
 * house rules of the concepts, and the cadence of the "viral" stream. Higgsfield is a mock here — no
 * request leaves the test and nothing is spent.
 */
const CREDS: Creds = { id: "hfk_ID_0123456789", secret: "hfs_SECRET_abcdefghij" };
const NOW = new Date("2026-10-08T15:00:00Z");

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
/** A Higgsfield that prices by model, accepts, and completes after `pollsUntilDone` status reads. */
function mock(o: { price?: Record<string, number | "unpriced">; pollsUntilDone?: number; end?: string; submit?: (n: number) => "ok" | "throw" | 500 | 400 } = {}) {
  const calls: Call[] = [], files = new Map<string, Buffer>(), byKey = new Map<string, string>();
  let polls = 0, submits = 0, downloads = 0;
  const fetch: Fetch = async (url, init) => {
    const c: Call = { method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body };
    calls.push(c);
    const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
    if (url.startsWith(`${HF_BASE}/estimate/`)) {
      const p = o.price?.[url.slice(`${HF_BASE}/estimate/`.length)] ?? 2;
      return p === "unpriced" ? json(200, { type: "description", pricing_description: "Token-metered pricing." }) : json(200, { type: "estimate", credits: p.toFixed(3), usd: (p * 0.0625).toFixed(3), discount: null });
    }
    if (url === `${HF_BASE}/files/generate-upload-url`) return json(200, { public_url: "https://cdn.example.com/in/ref.png", upload_url: "https://storage.example.com/put?sig=1", upload_headers: { "Content-Type": "image/png", "x-amz-tagging": "retention=temporary" } });
    if (url.startsWith("https://storage.example.com/")) return json(200, {});
    if (url.includes("/requests/")) { polls++; return json(200, polls > (o.pollsUntilDone ?? 1) ? ((o.end ?? "completed") === "completed" ? { status: "completed", video: { url: "https://cdn.example.com/out/clip.mp4" } } : { status: o.end, error: "moderated" }) : { status: "in_progress" }); }
    // A generation: the paid call.
    submits++;
    const how = o.submit?.(submits) ?? "ok";
    if (how === "throw") throw new Error(`socket hang up (Key ${CREDS.id}:${CREDS.secret})`);
    if (how === 500) return json(502, { detail: "bad gateway" });
    if (how === 400) return json(400, { detail: "Maximum number of concurrent requests (4) has been reached" });
    const idem = c.headers["Idempotency-Key"];
    if (!byKey.has(idem)) byKey.set(idem, `req-${byKey.size + 1}`);
    const id = byKey.get(idem)!;
    return json(200, { status: "queued", request_id: id, status_url: `${HF_BASE}/requests/${id}/status`, cancel_url: `${HF_BASE}/requests/${id}/cancel` });
  };
  const logs: string[] = [];
  const io: Io = {
    fetch, sleep: async () => {}, now: () => NOW, log: (l) => logs.push(l),
    download: async () => { downloads++; return Buffer.from("the finished clip"); },
    write: (f, d) => { files.set(f, d); }, exists: (f) => files.has(f),
  };
  const paid = () => calls.filter((c) => c.method === "POST" && !c.url.includes("/estimate/") && !c.url.includes("/files/") && c.url.startsWith(HF_BASE));
  return { io, calls, files, logs, paid, distinctRequests: () => byKey.size, downloads: () => downloads };
}
const VIDEO = "kling-video/v2.5-turbo/standard/image-to-video";
const shot = (key: string, extra: Record<string, unknown> = {}): GenerateInput => ({ key, kind: "video", model: VIDEO, params: { prompt: "he drives", image_url: "https://cdn.example.com/still.png", duration: 5, ...extra }, file: `${key}.mp4` });
const run = (m: ReturnType<typeof mock>, ledger: Ledger, input: GenerateInput) => generate({ input, ledger, save: () => {}, creds: CREDS, io: m.io });

describe("gator shorts — the budget", () => {
  it("the pilot's cap is twelve videos and twelve images at the estimated prices", () => {
    const cap = pilotCap(NOW);
    expect(cap.credits).toBe(57.6);
    expect(cap.usd).toBe(3.6);
    expect(cap.credits).toBeCloseTo(PILOT.videos * PILOT.video.credits + PILOT.images * PILOT.image.credits, 6);
    expect(cap.derivation).toMatch(/12 × 3\.36 credits.*12 × 1\.44 credits/);
    expect(emptyLedger(NOW).balance.before).toMatch(/no balance endpoint/);
  });
  it("refuses a call that would pass the cap — before anything paid is sent", async () => {
    const m = mock({ price: { [VIDEO]: 3.36 } }), ledger = emptyLedger(NOW);
    ledger.cap.credits = 10;
    await run(m, ledger, shot("a/s1/video/still1-take1"));
    await run(m, ledger, shot("a/s2/video/still1-take1"));
    expect(spent(ledger).credits).toBe(6.72);
    await expect(run(m, ledger, shot("a/s3/video/still1-take1"))).rejects.toThrow(BudgetError);
    await expect(run(m, ledger, shot("a/s3/video/still1-take1"))).rejects.toThrow(/would pass the cap of 10 credits/);
    expect(m.paid()).toHaveLength(2);
    expect(ledger.entries).toHaveLength(2);
    // Exactly at the cap is allowed; a hair over is not.
    ledger.cap.credits = 10.08;
    await run(m, ledger, shot("a/s3/video/still1-take1"));
    expect(spent(ledger)).toMatchObject({ credits: 10.08, videos: 3, images: 0 });
    expect(() => assertWithinBudget(ledger, 0.01, "one more")).toThrow(BudgetError);
  });
  it("refuses a model Higgsfield gives no fixed price for, and a price that is not a number", async () => {
    const m = mock({ price: { "bytedance/seedance-2.0/image-to-video": "unpriced" } }), ledger = emptyLedger(NOW);
    await expect(run(m, ledger, { ...shot("a/s1/video/still1-take1"), model: "bytedance/seedance-2.0/image-to-video" })).rejects.toThrow(/no fixed price/);
    expect(m.paid()).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => assertWithinBudget(ledger, bad, "x")).toThrow(/price is not known/);
  });
  it("what was not charged does not count: failed, moderated and cancelled requests", async () => {
    const m = mock({ end: "nsfw" }), ledger = emptyLedger(NOW);
    await expect(run(m, ledger, shot("a/s1/video/still1-take1"))).rejects.toThrow(/ended as nsfw.*not charged/);
    expect(ledger.entries[0].status).toBe("nsfw");
    expect(charged(ledger.entries[0])).toBe(false);
    expect(spent(ledger).credits).toBe(0);
    // …and it is never retried by itself under the same key: a new take is a decision.
    await expect(run(mock(), ledger, shot("a/s1/video/still1-take1"))).rejects.toThrow(/ask for a new take/);
  });
  it("a request Higgsfield did not accept is recorded as not charged", async () => {
    const m = mock({ submit: () => 400 }), ledger = emptyLedger(NOW);
    await expect(run(m, ledger, shot("a/s1/video/still1-take1"))).rejects.toThrow(/did not accept.*concurrent/);
    expect(ledger.entries[0]).toMatchObject({ status: "failed", requestId: null });
    expect(spent(ledger).credits).toBe(0);
  });
});

describe("gator shorts — never pay twice for the same shot", () => {
  it("a finished shot is not asked for again", async () => {
    const m = mock(), ledger = emptyLedger(NOW);
    const first = await run(m, ledger, shot("a/s1/video/still1-take1"));
    const again = await run(m, ledger, shot("a/s1/video/still1-take1"));
    expect(first.paid).toBe(true);
    expect(again.paid).toBe(false);
    expect(m.paid()).toHaveLength(1);
    expect(ledger.entries).toHaveLength(1);
    expect(spent(ledger).credits).toBe(2);
    expect(ledger.entries[0]).toMatchObject({ status: "completed", requestId: "req-1", outputUrl: "https://cdn.example.com/out/clip.mp4", file: "a/s1/video/still1-take1.mp4" });
    expect(m.downloads()).toBe(1);
  });
  it("the ledger is saved before the request leaves, and after its answer", async () => {
    const m = mock(), ledger = emptyLedger(NOW), saved: string[] = [];
    await generate({ input: shot("a/s1/video/still1-take1"), ledger, save: (l) => saved.push(`${l.entries[0].status}:${m.paid().length}`), creds: CREDS, io: m.io });
    expect(saved[0]).toBe("reserved:0");
    expect(saved).toContain("submitted:1");
    expect(saved[saved.length - 1]).toBe("completed:1");
  });
  it("a request whose answer was lost is sent again with the SAME Idempotency-Key and body", async () => {
    const m = mock({ submit: (n) => (n === 1 ? "throw" : n === 2 ? 500 : "ok") }), ledger = emptyLedger(NOW);
    await expect(run(m, ledger, shot("a/s1/video/still1-take1"))).rejects.toThrow(/no answer from Higgsfield.*reserved/);
    expect(ledger.entries[0].status).toBe("reserved");
    expect(spent(ledger).credits).toBe(2);                      // it may have left: it counts
    await expect(run(m, ledger, shot("a/s1/video/still1-take1"))).rejects.toThrow(/502.*reserved/);
    const r = await run(m, ledger, shot("a/s1/video/still1-take1"));
    expect(r.paid).toBe(false);
    const paid = m.paid();
    expect(paid).toHaveLength(3);
    expect(new Set(paid.map((c) => c.headers["Idempotency-Key"])).size).toBe(1);
    expect(new Set(paid.map((c) => JSON.stringify(c.body))).size).toBe(1);
    expect(m.distinctRequests()).toBe(1);                        // Higgsfield made one generation
    expect(ledger.entries).toHaveLength(1);
    expect(spent(ledger).credits).toBe(2);
  });
  it("a submitted request is only polled when the run is repeated", async () => {
    const m = mock({ pollsUntilDone: 3 }), ledger = emptyLedger(NOW);
    let t = NOW.getTime();
    m.io.now = () => new Date((t += 60_000));
    await expect(generate({ input: { ...shot("a/s1/video/still1-take1"), timeoutMs: 30_000 }, ledger, save: () => {}, creds: CREDS, io: m.io })).rejects.toThrow(/stays “submitted”/);
    expect(ledger.entries[0].status).toBe("submitted");
    const r = await generate({ input: { ...shot("a/s1/video/still1-take1"), timeoutMs: 3_600_000 }, ledger, save: () => {}, creds: CREDS, io: m.io });
    expect(r.paid).toBe(false);
    expect(m.paid()).toHaveLength(1);
    expect(r.entry.status).toBe("completed");
  });
  it("the same key with other parameters is refused: a changed prompt is a new take", async () => {
    const m = mock(), ledger = emptyLedger(NOW);
    await run(m, ledger, shot("a/s1/video/still1-take1"));
    await expect(run(m, ledger, shot("a/s1/video/still1-take1", { prompt: "he flies" }))).rejects.toThrow(/other parameters.*new take/);
    await expect(run(m, ledger, { ...shot("a/s1/video/still1-take1"), model: "kling-video/v3.0/std/image-to-video" })).rejects.toThrow(/other parameters/);
    expect(m.paid()).toHaveLength(1);
    // A new take is a new entry and a new charge — on purpose.
    await run(m, ledger, shot("a/s1/video/still1-take2", { prompt: "he flies" }));
    expect(m.paid()).toHaveLength(2);
    expect(new Set(m.paid().map((c) => c.headers["Idempotency-Key"])).size).toBe(2);
  });
  it("an input uploaded again (a new address) is still the same shot", async () => {
    const m = mock(), ledger = emptyLedger(NOW);
    const still = (url: string): GenerateInput => ({ key: "a/s1/still/take1", kind: "image", model: "xai/grok-imagine-image-2.0", params: { prompt: "p", image_urls: [url] }, identity: { prompt: "p", image_urls: ["sha-of-the-artwork"] }, file: "a-s1.png" });
    await run(m, ledger, still("https://cdn.example.com/in/1.png"));
    const again = await run(m, ledger, still("https://cdn.example.com/in/2.png"));
    expect(again.paid).toBe(false);
    expect(m.paid()).toHaveLength(1);
    expect(spent(ledger)).toMatchObject({ images: 1, videos: 0 });
  });
  it("a finished file that went missing is fetched again, not generated again", async () => {
    const m = mock(), ledger = emptyLedger(NOW);
    await run(m, ledger, shot("a/s1/video/still1-take1"));
    m.files.clear();
    const r = await run(m, ledger, shot("a/s1/video/still1-take1"));
    expect(r.paid).toBe(false);
    expect(m.paid()).toHaveLength(1);
    expect(m.downloads()).toBe(2);
  });
  it("the key goes to Higgsfield's host only, and never into a log, an error or the ledger", async () => {
    const m = mock({ submit: () => "throw" }), ledger = emptyLedger(NOW);
    const err = await run(m, ledger, shot("a/s1/video/still1-take1")).catch((e: Error) => e.message);
    expect(err).not.toContain(CREDS.secret);
    expect(err).not.toContain(CREDS.id);
    expect(JSON.stringify(ledger)).not.toContain(CREDS.secret);
    expect(redact(`Key ${CREDS.id}:${CREDS.secret}`, CREDS)).toBe("Key [key]:[key]");
    // A status address on another host is refused before the key is sent.
    const l2 = emptyLedger(NOW), m2 = mock();
    l2.entries.push({ key: "a/s9/video/still1-take1", kind: "video", model: VIDEO, params: shot("x").params, paramsSha256: "", idempotencyKey: "k", credits: 2, usd: 0.1, status: "submitted", requestId: "r", statusUrl: "https://evil.example.com/requests/r/status", createdAt: NOW.toISOString() });
    l2.entries[0].paramsSha256 = (await import("../../scripts/gator/higgsfield")).sha((await import("../../scripts/gator/higgsfield")).canonical({ model: VIDEO, params: shot("x").params }));
    await expect(run(m2, l2, shot("a/s9/video/still1-take1"))).rejects.toThrow(/refusing to send the key to evil\.example\.com/);
    expect(m2.calls).toHaveLength(0);
    // The presigned upload gets the file and its own headers, not our Authorization.
    const m3 = mock();
    expect(await uploadInput(m3.io, CREDS, Buffer.from("png"), "image/png")).toBe("https://cdn.example.com/in/ref.png");
    const put = m3.calls.find((c) => c.method === "PUT")!;
    expect(put.headers.Authorization).toBeUndefined();
    expect(put.headers["x-amz-tagging"]).toBe("retention=temporary");
    expect((await estimate(m3.io, CREDS, VIDEO, {})).credits).toBe(2);
    expect(m3.calls.filter((c) => c.url.startsWith(HF_BASE)).every((c) => c.headers.Authorization === `Key ${CREDS.id}:${CREDS.secret}`)).toBe(true);
  });
});

describe("gator shorts — captions and safe areas", () => {
  const frame = { x: 0, y: 0, w: W, h: H }, safe = safeRect({ name: "vertical", width: W, height: H });
  it("the caption zones and the logo are clear of what the platforms draw over a vertical video", () => {
    const S = SAFE_AREA.vertical;
    expect(ZONES.top.y).toBeGreaterThanOrEqual(H * S.top);                       // under the tabs
    expect(ZONES.top.x).toBeGreaterThanOrEqual(W * S.left);
    expect(ZONES.top.x + ZONES.top.w).toBeLessThanOrEqual(W * (1 - S.left));
    expect(ZONES.top.y + ZONES.top.h).toBeLessThan(H / 2);                       // the top zone is above the button column
    expect(inside(ZONES.low, safe)).toBe(true);                                  // clear of the caption, the audio line and the buttons
    expect(inside(LOGO_RECT, safe)).toBe(true);
    expect(overlaps(LOGO_RECT, ZONES.low)).toBe(false);
    expect(overlaps(ZONES.top, ZONES.low)).toBe(false);
    expect(inside(ZONES.top, frame) && inside(ZONES.low, frame)).toBe(true);
  });
  it("every beat of every concept fits its zone at a size a phone can read", () => {
    let n = 0;
    for (const c of CONCEPTS) for (const b of timeline(c).beats) {
      const box = layoutBeat(b);
      expect(inside(box.rect, ZONES[b.pos]), `${c.id}: “${b.text}”`).toBe(true);
      expect(box.px, `${c.id}: “${b.text}”`).toBeGreaterThanOrEqual(80);
      expect(box.lines.length).toBeLessThanOrEqual(3);
      expect(box.lines.join(" ")).toBe(b.text.toUpperCase());
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });
  it("a top caption hangs from the top of its zone; a low one stands on the bottom of its", () => {
    const beat = (pos: "top" | "low"): Beat => ({ at: 0, until: 2, text: "Day 9.", pos });
    expect(layoutBeat(beat("top")).rect.y).toBe(ZONES.top.y);
    const low = layoutBeat(beat("low"));
    expect(low.rect.y + low.rect.h).toBe(ZONES.low.y + ZONES.low.h);
    expect(low.rect.x + low.rect.w).toBeLessThanOrEqual(W * (1 - SAFE_AREA.vertical.right));
  });
  it("words that cannot be read at a phone's size are refused, not shrunk", () => {
    expect(() => layoutBeat({ at: 0, until: 2, pos: "low", text: "When the homeowner says while you are here could you also take a quick look at the gutters the fence and the garage door" })).toThrow(/does not fit/);
    expect(wrapCaption("supercalifragilisticexpialidociousness", 300, 120)).toBeNull();
    expect(MIN_PX).toBeGreaterThanOrEqual(64);
  });
  it("no line is left with one orphan word when the line above can spare one", () => {
    const lines = wrapCaption("Driving to the two-day job", 600, 120)!;
    expect(lines[lines.length - 1].split(" ").length).toBeGreaterThan(1);
  });
  it("the ASS file: Anton, white with a black edge, the accent word orange, a pop-in", () => {
    const ass = assFile([layoutBeat({ at: 0, until: 3.4, text: "Driving to the “two-day” job", accent: "“two-day”", pos: "top" }), layoutBeat({ at: 3.4, until: 6.4, text: "Day 9.", accent: "9.", pos: "top" })]);
    expect(ass).toContain(`PlayResX: ${W}`);
    expect(ass).toContain("Style: Meme,Anton,");
    expect(ass).toContain("&H00FFFFFF,&H00FFFFFF,&H00000000");            // white fill, black outline
    expect(ass).toContain("{\\c&H1673F9&}“TWO-DAY”{\\c&HFFFFFF&}");       // #f97316, as ASS writes a colour
    expect(ass).toContain("{\\c&H1673F9&}9.{\\c&HFFFFFF&}");
    expect(ass).toMatch(/Dialogue: 0,0:00:00\.00,0:00:03\.40,Meme/);
    expect(ass).toMatch(/Dialogue: 0,0:00:03\.40,0:00:06\.40,Meme/);
    expect(ass).toContain("\\t(0,100,");
  });
});

describe("gator shorts — the writers' room", () => {
  it("thirty concepts, each keeping the house rules", () => {
    expect(CONCEPTS).toHaveLength(30);
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(30);
    for (const c of CONCEPTS) expect(lintConcept(c), c.id).toEqual([]);
    expect(CONCEPTS.filter((c) => c.pilot).map((c) => c.id)).toEqual(["two-day-job", "shingle-rhythm", "while-youre-here"]);
    for (const f of ["job-site pain", "POV", "satisfying work", "product tie-in"] as const) expect(CONCEPTS.some((c) => c.format === f), f).toBe(true);
    expect(CONCEPTS.some((c) => !c.evergreen && c.timing)).toBe(true);
    expect(CONCEPTS.filter((c) => !c.evergreen).every((c) => !!c.timing)).toBe(true);
  });
  it("docs/gator/CONCEPTS.md is the print-out of the data", () => {
    expect(fs.readFileSync(DOC, "utf8")).toBe(conceptsMd());
  });
  it("the hook is on screen from the first frame and is eight words at most", () => {
    for (const c of CONCEPTS) {
      expect(c.hook.trim().split(/\s+/).length, c.id).toBeLessThanOrEqual(8);
      const first = timeline(c).beats[0];
      expect(first.at).toBe(0);
      expect(first.text).toBe(c.hook);
    }
  });
  it("every clip is short, ends on the 1.5 s tag, and the tag is the short part", () => {
    for (const c of CONCEPTS) {
      const t = timeline(c);
      expect(t.totalSec - t.bodySec).toBeCloseTo(END_TAG_SEC, 6);
      expect(t.totalSec, c.id).toBeLessThanOrEqual(Math.min(MAX_SEC, 21.5));
      expect(t.bodySec, c.id).toBeGreaterThanOrEqual(4);
      expect(t.shots.reduce((n, s) => n + s.frames, 0) / 30).toBeCloseTo(t.bodySec, 6);
      for (const b of t.beats) { expect(b.until).toBeGreaterThan(b.at); expect(b.until).toBeLessThanOrEqual(t.bodySec + 1e-9); }
    }
  });
  it("every still prompt carries the mascot's description and the no-text rule; every motion prompt keeps the gear on", () => {
    for (const c of CONCEPTS) for (const s of c.shots) {
      const p = stillPrompt(s), m = motionPrompt(s);
      for (const must of ["reference images", "yellow hard hat", "sunglasses", "orange hi-vis safety vest", "black hoodie", "tool belt", "work boots", "No text", "9:16", "No people", "logos"]) expect(p, `${c.id} ${s.id}: ${must}`).toContain(must);
      expect(m).toContain("hard hat and sunglasses stay on");
      expect(p.length).toBeLessThan(4000);
    }
  });
  it("at height he is tied off (or has three points of contact) — the lint catches a prompt that forgets", () => {
    const roof = CONCEPTS.find((c) => c.id === "shingle-rhythm")!;
    for (const s of roof.shots) expect(s.scene).toMatch(/harness.*anchor/);
    const bad = { ...roof, shots: [{ ...roof.shots[0], scene: "He stands on a pitched roof holding a nail gun." }, roof.shots[1]] };
    expect(lintConcept(bad).join(" ")).toMatch(/at height without a harness/);
    expect(lintConcept({ ...roof, hook: "one two three four five six seven eight nine" }).join(" ")).toMatch(/9 words/);
    expect(lintConcept({ ...roof, caption: "Better than a Home Depot run." }).join(" ")).toMatch(/a brand/);
    expect(lintConcept({ ...roof, shots: [{ ...roof.shots[0], motion: "He takes off his sunglasses." }, roof.shots[1]] }).join(" ")).toMatch(/stay on/);
  });
  it("the posts: five hashtags, the AI note, LinkedIn only where it was written for, a #Shorts title", () => {
    for (const c of CONCEPTS) {
      const p = postsOf(c);
      expect(p.instagram!.hashtags).toHaveLength(5);
      expect((p.instagram!.text.match(/#\w+/g) ?? []).length).toBe(5);     // Instagram's own cap
      expect((p.tiktok!.text.match(/#\w+/g) ?? []).length).toBe(5);
      expect(p.instagram!.text).toContain("AI-generated");
      expect(p.youtube!.title).toMatch(/ #Shorts$/);
      expect(p.youtube!.title!.length).toBeLessThanOrEqual(100);
      expect(p.youtube!.text).toContain("AI-generated");
      expect(p.linkedin === null).toBe(c.linkedin === null);
      if (p.linkedin) { expect(p.linkedin.text).toContain("AI-generated"); expect(p.linkedin.text).toContain("https://constructhub.us"); expect((p.linkedin.text.match(/#\w+/g) ?? []).length).toBe(3); }
      for (const post of Object.values(p)) if (post) expect(post.text).not.toMatch(/https?:\/\/(?!constructhub\.us)/);
    }
    const li = CONCEPTS.filter((c) => c.linkedin).length;
    expect(li).toBeGreaterThanOrEqual(8);
    expect(li).toBeLessThan(CONCEPTS.length);                              // some jokes do not belong there
  });
  it("the sound is made here: the same cues give the same samples, and it is not silence", () => {
    const t = timeline(CONCEPTS[1]), a = synth(t.cues, t.totalSec), b = synth(t.cues, t.totalSec);
    expect(a.length).toBe(Math.ceil(t.totalSec * RATE));
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    const pcm = toPcm(a);
    let peak = 0, energy = 0;
    for (const s of pcm) { peak = Math.max(peak, Math.abs(s)); energy += s * s; }
    expect(peak).toBeGreaterThan(20000);
    expect(peak).toBeLessThanOrEqual(32767 * 0.71);
    expect(Math.sqrt(energy / pcm.length)).toBeGreaterThan(300);
    for (const c of CONCEPTS) { const tl = timeline(c); expect(toPcm(synth(tl.cues, tl.totalSec)).some((s) => Math.abs(s) > 1000), c.id).toBe(true); }
  });
});

describe("gator shorts — the viral stream in the calendar", () => {
  const IG: ViralTarget = { id: "76607", platform: "instagram", name: "constructhubapp" }, TT: ViralTarget = { id: "63054", platform: "tiktok", name: "construct.hub" };
  const LI: ViralTarget = { id: "38445", platform: "linkedin", name: "Construct HUB" }, YT: ViralTarget = { id: "youtube", platform: "youtube", name: "our channel" };
  const clip = (id: string, linkedin = true): ViralClip => ({ conceptId: id, platforms: { instagram: { text: `ig ${id}` }, tiktok: { text: `tt ${id}` }, youtube: { text: `yt ${id}`, title: `${id} #Shorts` }, ...(linkedin ? { linkedin: { text: `li ${id}` } } : {}) } });
  const CLIPS = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => clip(`clip-${x}`));
  const now = new Date("2026-10-12T13:00:00Z");                             // Monday 09:00 Eastern
  const tutorialPost = (accountId: string, platform: "instagram" | "tiktok" | "linkedin", iso: string, helpKey = `t-${iso}`): LedgerPost => ({
    helpKey, accountId, platform, account: "x", cut: "vertical.mp4", mediaUrl: "https://constructhub.us/x.mp4", mediaSha256: "", textSha256: "", textLength: 1,
    scheduledTime: iso, scheduledEastern: "", status: "scheduled", postSubmissionId: "p", createdAt: iso,
  });
  /** A tutorial cut every morning at 09:30 Eastern for `days` days on these accounts. */
  const tutorials = (ids: [string, "instagram" | "tiktok" | "linkedin"][], days: number): SocialLedger => ({ ...emptySocialLedger(), posts: ids.flatMap(([id, p]) => Array.from({ length: days }, (_x, d) => tutorialPost(id, p, new Date(Date.parse("2026-10-12T13:30:00Z") + d * 86400000).toISOString()))) });
  const day = (d: Date) => zoneTime(d).date, clock = (d: Date) => zoneTime(d).time.slice(0, 5);

  it("one gator clip per account per day, at 12:00 or 19:00 Eastern, a few minutes past the hour", () => {
    const { planned, skipped } = planViral(CLIPS, [IG, TT], { now, viral: emptyViralLedger(), tutorial: tutorials([["76607", "instagram"], ["63054", "tiktok"]], 20) });
    expect(skipped).toEqual([]);
    expect(planned).toHaveLength(16);
    for (const t of [IG, TT]) {
      const mine = planned.filter((p) => p.target.id === t.id);
      expect(new Set(mine.map((p) => day(p.at))).size).toBe(8);               // never two on a day
      expect(mine.map((p) => p.conceptId)).toEqual(CLIPS.map((c) => c.conceptId));
      for (const p of mine) {
        expect(["12:00", "19:00"]).toContain(p.slot);
        const [h, m] = clock(p.at).split(":").map(Number);
        expect(`${String(h).padStart(2, "0")}:00`).toBe(p.slot);
        expect(m).toBeGreaterThanOrEqual(VIRAL_RULES.jitter.from);
        expect(m).toBeLessThan(VIRAL_RULES.jitter.from + VIRAL_RULES.jitter.span);
      }
    }
    // The slot varies: over a fortnight an account sees both.
    const slots = new Set(Array.from({ length: 14 }, (_x, d) => slotFor(`2026-10-${String(12 + d).padStart(2, "0")}`, IG).slot));
    expect(slots.size).toBe(2);
    expect(slotFor("2026-10-14", IG)).toEqual(slotFor("2026-10-14", IG));     // the same every time it is asked
  });
  it("never back-to-back: no gator clip without a tutorial cut between it and the last one", () => {
    // Tutorial cuts only on the first three days: the fourth clip has nothing to stand behind.
    const { planned, skipped } = planViral(CLIPS, [IG], { now, viral: emptyViralLedger(), tutorial: tutorials([["76607", "instagram"]], 3) });
    expect(planned).toHaveLength(3);
    expect(skipped).toHaveLength(5);
    expect(skipped[0].reason).toMatch(/next to another gator clip.*tutorial cuts between/);
    // With no tutorial cut at all, exactly one gator clip goes out — and then the stream waits.
    expect(planViral(CLIPS, [IG], { now, viral: emptyViralLedger(), tutorial: emptySocialLedger() }).planned).toHaveLength(1);
    // On any planned timeline, the neighbours of a gator clip are tutorial cuts.
    const tut = tutorials([["76607", "instagram"]], 20), all = planViral(CLIPS, [IG], { now, viral: emptyViralLedger(), tutorial: tut }).planned;
    const line = [...tut.posts.map((p) => ({ at: Date.parse(p.scheduledTime!), viral: false })), ...all.map((p) => ({ at: p.at.getTime(), viral: true }))].sort((a, b) => a.at - b.at);
    for (let i = 1; i < line.length; i++) expect(line[i].viral && line[i - 1].viral).toBe(false);
    // Tutorial cuts planned in the same run count too.
    const joint = planViral(CLIPS, [IG], { now, viral: emptyViralLedger(), tutorial: emptySocialLedger(), alsoTutorial: Array.from({ length: 6 }, (_x, d) => ({ accountId: "76607", at: new Date(Date.parse("2026-10-12T13:30:00Z") + d * 86400000) })) });
    expect(joint.planned).toHaveLength(6);
  });
  it("keeps 45 minutes from any other post on the account", () => {
    const d = "2026-10-13", s = slotFor(d, IG), tut = tutorials([["76607", "instagram"]], 20);
    tut.posts.push(tutorialPost("76607", "instagram", new Date(s.at.getTime() + 20 * 60000).toISOString(), "clash"));
    const { planned } = planViral(CLIPS.slice(0, 3), [IG], { now, viral: emptyViralLedger(), tutorial: tut });
    expect(planned.map((p) => day(p.at))).not.toContain(d);
    for (const p of planned) for (const t of tut.posts) expect(Math.abs(Date.parse(t.scheduledTime!) - p.at.getTime())).toBeGreaterThanOrEqual(45 * 60000);
  });
  it("LinkedIn: two a week at most, weekdays at lunch, and only the clips written for it", () => {
    const clips = [...CLIPS.slice(0, 5), clip("no-linkedin", false)];
    const { planned, skipped } = planViral(clips, [LI], { now, viral: emptyViralLedger(), tutorial: tutorials([["38445", "linkedin"]], 30) });
    expect(skipped).toEqual([{ conceptId: "no-linkedin", accountId: "38445", reason: "no LinkedIn version — the joke does not belong there" }]);
    expect(planned).toHaveLength(5);
    const perWeek = new Map<string, number>();
    for (const p of planned) {
      const d = day(p.at), wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      expect(wd).toBeGreaterThanOrEqual(1); expect(wd).toBeLessThanOrEqual(5);
      expect(clock(p.at).startsWith("12:")).toBe(true);
      perWeek.set(weekOf(d), (perWeek.get(weekOf(d)) ?? 0) + 1);
    }
    expect(Math.max(...perWeek.values())).toBe(2);
    expect(perWeek.size).toBe(3);                                             // five clips need three weeks
    expect(weekOf("2026-10-18")).toBe("2026-10-12");                          // Sunday belongs to the week that began on Monday
  });
  it("a clip goes to an account once; the viral ledger is the record", () => {
    const viral = emptyViralLedger();
    const post = (conceptId: string, status: ViralLedgerPost["status"], iso: string): ViralLedgerPost => ({ ...tutorialPost("76607", "instagram", iso, `gator:${conceptId}`), status, stream: "viral", conceptId, aiGenerated: true });
    viral.posts.push(post("clip-a", "published", "2026-10-11T16:05:00Z"), post("clip-b", "sending", "2026-10-11T23:05:00Z"), post("clip-c", "failed", "2026-10-10T16:05:00Z"));
    const { planned, skipped } = planViral(CLIPS.slice(0, 4), [IG], { now, viral, tutorial: tutorials([["76607", "instagram"]], 20) });
    expect(planned.map((p) => p.conceptId)).toEqual(["clip-d"]);
    expect(skipped.map((s) => s.reason)).toEqual(["already published (p)", "already sending (p)", "failed before — it is not retried by itself"]);
  });
  it("YouTube Shorts: one a day, clear of the tutorials' publish times, labelled synthetic", () => {
    const s = slotFor("2026-10-12", YT);
    const { planned } = planViral(CLIPS.slice(0, 4), [YT], { now, viral: emptyViralLedger(), tutorial: emptySocialLedger(),
      youtubeTimes: [new Date(s.at.getTime() - 10 * 60000), ...Array.from({ length: 30 }, (_x, d) => new Date(Date.parse("2026-10-12T13:00:00Z") + d * 86400000))] });
    expect(planned).toHaveLength(4);
    expect(planned.map((p) => day(p.at))).not.toContain("2026-10-12");         // ten minutes after a tutorial: moved on
    expect(new Set(planned.map((p) => day(p.at))).size).toBe(4);
    expect(planned[0].title).toBe("clip-a #Shorts");
    const req = uploadSessionRequest({ title: planned[0].title!, description: planned[0].text, publishAt: planned[0].at.toISOString(), containsSyntheticMedia: true }, 1000, now.getTime());
    expect(req.body.status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
    // The tutorials' own uploads are unchanged: the field is absent unless asked for.
    expect("containsSyntheticMedia" in uploadSessionRequest({ title: "A tutorial" }, 1000).body.status).toBe(false);
  });
  it("TikTok carries its AI-generated label; the tutorial stream's plan is untouched by the viral one", () => {
    const body = buildPost({ id: "63054", platform: "tiktok", name: "construct.hub" }, "caption", { url: "https://constructhub.us/api/tutorials/media/gator-x.social-vertical.12345678.mp4", coverMs: 600 }, "2026-10-13T16:05:00.000Z");
    expect(body.post.target).toMatchObject({ targetType: "tiktok", isAiGenerated: true, isYourBrand: true, isBrandedContent: false, videoCoverTimestamp: 600 });
    const tut = tutorials([["76607", "instagram"]], 5), before = JSON.stringify(tut);
    planViral(CLIPS, [IG], { now, viral: emptyViralLedger(), tutorial: tut });
    expect(JSON.stringify(tut)).toBe(before);
  });
  it("posting is never “whatever is in the folder”: --go needs the clips named", async () => {
    const err = console.error; let said = "";
    console.error = (s: string) => { said += s; };
    try { expect(await viralMain(["--stream", "viral", "--go"])).toBe(1); } finally { console.error = err; }
    expect(said).toMatch(/--go needs the clips named/);
  });
  it("media names are ones the tutorials' media route serves", async () => {
    const { TUTORIAL_FILE } = await import("../../shared/help/videos");
    const sha = "0bb7606d" + "0".repeat(56);
    for (const what of ["clip", "cover"] as const) {
      expect(plannedMediaUrl("shingle-rhythm", sha, what).startsWith("https://constructhub.us/api/tutorials/media/gator-shingle-rhythm.social-")).toBe(true);
      expect(mediaKey("shingle-rhythm", sha, what).startsWith("tutorials/")).toBe(true);
      expect(TUTORIAL_FILE.test(mediaKey("shingle-rhythm", sha, what).slice("tutorials/".length))).toBe(true);
    }
  });
  it("“post these now”: per account the first at once, the next ones minutes apart, accounts a minute apart", () => {
    const r = planAsap(CLIPS.slice(0, 3), [IG, TT], emptyViralLedger(), now, 4, { overrideRate: true });
    expect(r.planned).toHaveLength(6);
    const mins = (id: string) => r.planned.filter((p) => p.target.id === id).map((p) => (p.at.getTime() - now.getTime()) / 60000);
    expect(mins("76607")).toEqual([0, 4, 8]);
    expect(mins("63054")).toEqual([1, 5, 9]);
    // A clip that is already out on an account is not sent to it again; a failed attempt may be repeated.
    const viral = emptyViralLedger();
    const post = (conceptId: string, status: ViralLedgerPost["status"]): ViralLedgerPost => ({ ...tutorialPost("76607", "instagram", "2026-10-11T16:05:00Z", `gator:${conceptId}`), status, stream: "viral", conceptId, aiGenerated: true });
    viral.posts.push(post("clip-a", "published"), post("clip-b", "failed"));
    const again = planAsap(CLIPS.slice(0, 2), [IG], viral, now, 4, { overrideRate: true });
    expect(again.planned.map((p) => p.conceptId)).toEqual(["clip-b"]);
    expect(again.skipped).toEqual([{ conceptId: "clip-a", accountId: "76607", reason: "already published" }]);
  });
});

describe("the platforms' rate rule — one allowance for both streams", () => {
  const T0 = Date.parse("2026-10-08T04:00:00Z"), h = (n: number) => T0 + n * 3600000;
  it("LinkedIn: three posts in any rolling 24 hours, then a refusal", () => {
    expect(rateRefusal("linkedin", h(3), [h(0), h(1)])).toBeNull();
    expect(rateRefusal("linkedin", h(3), [h(0), h(1), h(2)])).toMatch(/4 posts in 24 hours — 3 at most/);
    expect(rateRefusal("linkedin", h(24.1), [h(0), h(1), h(2)])).toBeNull();               // the first has left the window
    expect(rateRefusal("linkedin", h(23.9), [h(0), h(1), h(2)])).not.toBeNull();
    // A post is also refused when it would overfill the window of one already scheduled AFTER it.
    expect(rateRefusal("linkedin", h(0), [h(1), h(2), h(3)])).not.toBeNull();
    expect(rateRefusal("tiktok", h(0), Array.from({ length: 30 }, (_x, i) => h(i / 10)))).toBeNull();
  });
  it("Instagram: four in 24 hours for the account's first two weeks, then the rule lapses", () => {
    const four = [h(0), h(1), h(2), h(3)];
    expect(rateRefusal("instagram", h(4), four)).toMatch(/5 posts in 24 hours — 4 at most/);
    expect(rateRefusal("instagram", h(4), four.slice(1))).toBeNull();
    const later = [h(0), ...[0, 1, 2, 3].map((i) => h(15 * 24 + i))];
    expect(rateRefusal("instagram", h(15 * 24 + 4), later)).toBeNull();
    expect(rateRefusal("instagram", h(13 * 24 + 4), [h(0), ...[0, 1, 2, 3].map((i) => h(13 * 24 + i))])).not.toBeNull();
  });
  it("says when the account is free again, and failed posts do not count", () => {
    const free = nextAllowed("linkedin", new Date(h(3)), [h(0), h(1), h(2)])!;
    expect(free.getTime()).toBeGreaterThanOrEqual(h(24));
    expect(free.getTime()).toBeLessThan(h(24.5));
    const post = (status: string, at: number) => ({ accountId: "38445", status, scheduledTime: new Date(at).toISOString(), createdAt: new Date(at).toISOString() });
    const tutorial = { posts: [post("published", h(0)), post("failed", h(0.5)), { ...post("scheduled", h(1)), accountId: "other" }] }, viral = { posts: [post("scheduled", h(2))] };
    expect(accountTimes("38445", tutorial, viral)).toEqual([h(0), h(2)]);
  });
  it("the gator poster counts the tutorial cuts — and “now” does not mean “more than the account can take”", () => {
    const now = new Date("2026-10-08T04:30:00Z");
    const LI: ViralTarget = { id: "38445", platform: "linkedin", name: "Construct HUB" };
    const clip = (id: string): ViralClip => ({ conceptId: id, platforms: { linkedin: { text: id } } });
    const tut = (iso: string): LedgerPost => ({ helpKey: iso, accountId: "38445", platform: "linkedin", account: "x", cut: "feed.mp4", mediaUrl: "", mediaSha256: "", textSha256: "", textLength: 1, scheduledTime: iso, scheduledEastern: "", status: "published", postSubmissionId: "p", createdAt: iso });
    // The night of 2026-10-08: three tutorial cuts on LinkedIn since 22:31 Eastern, then gator clips "now".
    const tutorial: SocialLedger = { ...emptySocialLedger(), posts: [tut("2026-10-08T02:31:56Z"), tut("2026-10-08T03:14:56Z"), tut("2026-10-08T03:58:56Z")] };
    const r = planAsap([clip("a"), clip("b")], [LI], emptyViralLedger(), now, 4, { tutorial });
    expect(r.planned).toEqual([]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/3 at most.*free again 2026-10-08 22:45 EDT/);
    // The owner can still say "send it": the override is a flag, not the default.
    expect(planAsap([clip("a")], [LI], emptyViralLedger(), now, 4, { tutorial, overrideRate: true }).planned).toHaveLength(1);
    // The cadence planner keeps the rule too.
    const planned = planViral([clip("a")], [LI], { now, viral: emptyViralLedger(), tutorial }).planned;
    expect(planned).toHaveLength(1);
    expect(planned[0].at.getTime()).toBeGreaterThan(Date.parse("2026-10-09T02:31:56Z"));
  });
  it("the tutorial poster counts the gator clips", () => {
    const now = new Date("2026-10-12T13:00:00Z");
    const video = (k: string, at: string): VideoForPost => ({ helpKey: k, publishAt: at, posts: { linkedin: { text: "t", cut: "feed.mp4", media: { url: "https://constructhub.us/api/tutorials/media/x.mp4", sha256: "s" } } } });
    const target = { id: "38445", platform: "linkedin" as const, name: "Construct HUB" };
    const base = planPosts([video("v1", "2026-10-12T14:00:00Z")], [target], emptySocialLedger(), { now, perDay: 5 }).planned[0].at;
    const three = [-3, -2, -1].map((n) => ({ accountId: "38445", at: new Date(base.getTime() + n * 3600000) }));
    const pushed = planPosts([video("v1", "2026-10-12T14:00:00Z")], [target], emptySocialLedger(), { now, perDay: 5, otherPosts: three }).planned[0].at;
    expect(pushed.getTime()).toBeGreaterThan(base.getTime() + 12 * 3600000);
    expect(planPosts([video("v1", "2026-10-12T14:00:00Z")], [target], emptySocialLedger(), { now, perDay: 5, otherPosts: three.slice(1) }).planned[0].at.getTime()).toBe(base.getTime());
  });
});

describe("gator shorts — he talks", () => {
  it("one voice: the recipe is in one place, and a line's cache key changes with the recipe or the words", () => {
    expect(VOICE).toMatchObject({ persona: "marcus", kokoroVoice: "am_adam", pitch: 0.9, tempo: 1.14, rate: 48000 });
    expect(voiceFilter()).toMatch(/^asetrate=24000\*0\.9,aresample=48000,atempo=1\.14,highpass=f=70,/);
    expect(voiceKey("Two days.")).toBe(voiceKey("Two days."));
    expect(voiceKey("Two days.")).not.toBe(voiceKey("Three days."));
    expect(voiceKey("Two days.", { ...VOICE, pitch: 0.85 } as unknown as typeof VOICE)).not.toBe(voiceKey("Two days."));
    expect(fs.readFileSync("docs/gator/VOICE.md", "utf8")).toContain("`marcus` = Kokoro voice `am_adam`");
  });
  it("a talking shot uses the house method: the model's own voice, described in the same words every time", () => {
    const talkers = [...LIVE_CONCEPTS, ...FINALS].flatMap((c) => c.shots.filter((x) => x.say && x.voice !== "none").map((x) => [c, x] as const));
    expect(talkers.length).toBeGreaterThanOrEqual(8);
    for (const [c, sh] of talkers) {
      expect(sh.video, c.id).toBe("talk");
      expect(motionPrompt(sh), c.id).toContain("a gravelly baritone, dry and unhurried, with a New York / North Jersey working-class accent");
      expect(motionPrompt(sh)).toContain("No music and no other voices");
    }
    expect(VOICE_DESCRIPTION).toMatch(/about fifty.*deadpan — no laughing, no shouting/);
    // The cast speak in their own voices: the gator's description is not put in their mouths.
    const cast = LIVE_CONCEPTS.flatMap((c) => c.shots).filter((x) => x.voice === "none" && x.say);
    expect(cast.length).toBeGreaterThanOrEqual(4);
    for (const sh of cast) expect(motionPrompt(sh)).not.toContain("gravelly baritone, dry and unhurried");
    for (const c of CONCEPTS) for (const sh of c.shots.filter((x) => !x.say)) expect(motionPrompt(sh)).toContain("mouth stays closed");
    expect([...SAMPLES, ...FINALS, ...LIVE_CONCEPTS].every((c) => c.sample && !CONCEPTS.includes(c))).toBe(true);
    expect(CONCEPTS.flatMap((c) => c.shots).some((x) => x.video === "kling-voice" || x.video === "wan-talk")).toBe(false);
  });
  it("the live concepts keep the line: he is fine, nothing is burned in, the brand cues are in the prompt", () => {
    for (const c of LIVE_CONCEPTS) {
      expect(lintConcept(c), c.id).toEqual([]);
      for (const sh of c.shots.filter((x) => !x.videoFrom)) {
        const still = sh.stillFrom ? "" : stillPrompt(sh), motion = motionPrompt(sh);
        if (still && /alligator/i.test(still)) for (const must of ["hard hat", "No text"]) expect(still, `${c.id}: ${must}`).toContain(must);
        if (still) expect(still).toMatch(/[Nn]o (text|logos)/);
        expect(motion, c.id).toMatch(/[Nn]o text/);
      }
      if (c.cut === "oneshot") expect(c.shots[0].beats).toEqual([]);
      expect(postsOf(c).instagram!.text).toContain("AI-generated");
      expect(c.hashtags, c.id).toContain("aicontent");
    }
    expect(new Set(LIVE_CONCEPTS.map((c) => c.style)).size).toBeGreaterThanOrEqual(12);
  });
  it("what he is heard to say is held against the script — exactly when short, four fifths when long", () => {
    expect(saysTheLine("Two days, he says, two days.", "Two days, he says. Two days.").ok).toBe(true);
    expect(saysTheLine("Two days he said two days", "Two days, he says. Two days.").ok).toBe(false);
    expect(saysTheLine("20 years, never heard the end of that sentence.", "Twenty years. Never heard the end of that sentence.").ok).toBe(true);
    const long = saysTheLine("Guy says, tie off. I've been doing this 20 years. 20 years. Never said good years.", "Guy says tie off. I been doing this twenty years. Twenty years. Never said good years.");
    expect(long.ok).toBe(true); expect(long.match).toBeGreaterThanOrEqual(0.8);
    expect(saysTheLine("Guy says tie off and then something else entirely happens here today", "Guy says tie off. I been doing this twenty years. Twenty years. Never said good years.").ok).toBe(false);
    expect(plainWords("“While you're here.” Three words!")).toEqual(["while", "you're", "here", "three", "words"]);
  });
  it("subtitles follow the heard words: a few at a time, on screen while they are said", () => {
    const words = [["Day", 0.1, 0.3], ["one.", 0.3, 0.6], ["New", 0.9, 1.1], ["deck.", 1.1, 1.5], ["I'm", 2.0, 2.1], ["telling", 2.1, 2.4], ["you,", 2.4, 2.6], ["this", 2.6, 2.8], ["thing", 2.8, 3.0], ["ain't", 3.0, 3.2], ["going", 3.2, 3.4], ["nowhere.", 3.4, 3.9]].map(([w, start, end]) => ({ w: w as string, start: start as number, end: end as number }));
    const subs = subtitleBeats(words, 0, 10);
    expect(subs[0]).toMatchObject({ text: "Day one.", pos: "low", small: true });
    expect(subs[1].text).toBe("New deck.");
    expect(subs.map((b) => b.text).join(" ")).toBe(words.map((x) => x.w).join(" "));
    for (let i = 1; i < subs.length; i++) expect(subs[i].at).toBeGreaterThanOrEqual(subs[i - 1].until - 1e-9);
    for (const b of subs) { const box = layoutBeat(b); expect(box.px).toBeLessThanOrEqual(60); expect(box.lines.length).toBeLessThanOrEqual(2); expect(inside(box.rect, ZONES.low)).toBe(true); }
    expect(subtitleBeats(words, 5, 10)[0].at).toBeCloseTo(5.04, 6);
  });
  it("the line is burned in, sentence by sentence, for as long as it is said", () => {
    const beats = lineBeats("Closes at four. It's three fifty-nine. Fuhgeddaboudit.", 10, 3, 14);
    expect(beats.map((b) => b.text)).toEqual(["Closes at four.", "It's three fifty-nine.", "Fuhgeddaboudit."]);
    expect(beats[0].at).toBe(10);
    expect(beats.every((b) => b.pos === "low")).toBe(true);
    for (let i = 1; i < beats.length; i++) expect(beats[i].at).toBeCloseTo(beats[i - 1].until, 6);
    expect(beats[2].until).toBeCloseTo(13.7, 6);                               // it lingers 0.7 s after he stops
    expect(lineBeats("Two days, he says. Two days.", 0, 2, 5).map((b) => b.text)).toEqual(["Two days, he says. Two days."]);
    for (const b of beats) expect(layoutBeat(b).px).toBeGreaterThanOrEqual(80);
    const c = conceptById("permit-office-359"), tl = timeline(c, { s2: 2.82 });
    expect(tl.beats.filter((b) => b.pos === "low").map((b) => b.text)).toEqual(["Closes at four.", "It's three fifty-nine.", "Fuhgeddaboudit."]);
    for (const b of tl.beats) expect(inside(layoutBeat(b).rect, ZONES[b.pos])).toBe(true);
    expect(() => timeline(c, { s2: 4.4 })).toThrow(/longer than the shot/);
  });
  it("a caption stays until the next one in the same place — a low line does not wipe the hook", () => {
    const tl = timeline(SAMPLES[0], { s1: 1.73 }), hook = tl.beats.find((b) => b.pos === "top")!;
    expect(hook.until).toBeCloseTo(5, 6);
  });
});

describe("gator shorts — what the machine checks by itself", () => {
  it("foley follows the picture: bursts of motion are found, close ones merged", () => {
    const diff = Array.from({ length: 96 }, () => 1);
    for (const f of [11, 35, 36, 59, 83]) diff[f] = 9;
    diff[36] = 12;
    const peaks = peaksOf(diff, 24);
    expect(peaks.map((p) => Math.round(p.at * 24) - 1)).toEqual([11, 36, 59, 83]);
    expect(peaksOf(Array.from({ length: 50 }, () => 2), 24)).toEqual([]);
    const c = conceptById("deck-boards-rhythm"), tl = timeline(c, {}, { s1: [0.5, 1.7, 2.9] });
    expect(tl.cues.filter((q) => q.type === "pop").map((q) => q.at)).toEqual([0.5, 1.7, 2.9]);
    expect(timeline(c).cues.filter((q) => q.type === "pop").length).toBe(1);   // unsynced: the written beat (one repeating cue)
  });
  it("finds the top of his hard hat, and is not fooled by a sunset", () => {
    const w = 40, h = 60, frame = (paint: (x: number, y: number) => [number, number, number]) => { const b = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(paint(x, y), (y * w + x) * 3); return b; };
    const sky: [number, number, number] = [90, 160, 240], hat: [number, number, number] = [245, 190, 30];
    expect(hatRow(frame((x, y) => (y >= 22 && y < 30 && x >= 12 && x < 26 ? hat : sky)), w, h)).toBe(22);
    expect(hatRow(frame(() => sky), w, h)).toBeNull();
    expect(hatRow(frame((x, y) => (y < 10 ? [250, 170, 60] : y >= 40 && y < 46 && x >= 10 && x < 22 ? hat : sky)), w, h)).toBe(40);
  });
  it("sees a still that does not fill the frame", () => {
    const w = 20, h = 50, frame = (band: number) => { const b = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(y < band || y >= h - band ? [252, 250, 246] : [(x * 12) % 255, (y * 5) % 255, 90], (y * w + x) * 3); return b; };
    expect(bandFault(frame(0), w, h)).toBeNull();
    expect(bandFault(frame(1), w, h)).toBeNull();
    expect(bandFault(frame(8), w, h)).toMatch(/does not fill the frame.*16% at the top, 16% at the bottom/);
  });
  it("the experiment's cap is $100 on top of the pilot, and a clip has its own budget", () => {
    const cap = phase2Cap(NOW);
    expect(cap.credits).toBe(1641.12);
    expect(PHASE2.credits * 0.0625).toBe(100);
    const ledger = emptyLedger(NOW);
    const e = (key: string, credits: number, status: "completed" | "failed") => ({ key, kind: "video" as const, model: "m", params: {}, paramsSha256: "", idempotencyKey: key, credits, usd: credits * 0.0625, status, requestId: null, statusUrl: null, createdAt: NOW.toISOString() });
    ledger.entries.push(e("a/s1/still/take1", 1.6, "completed"), e("a/s1/video/still1-take1", 3.36, "completed"), e("a/s1/video/still1-take2", 3.36, "failed"), e("ab/s1/still/take1", 1.6, "completed"));
    expect(clipSpent(ledger, "a")).toBe(4.96);
    expect(clipSpent(ledger, "ab")).toBe(1.6);
  });
  it("the daily command: the next approved concept, and nothing posted without a reviewer", () => {
    const q: Queue = { version: 1, order: ["x-gone", "a", "b", "c"], state: { a: { status: "approved", at: "t" } } };
    expect(nextInQueue(q, ["a", "b", "c"])).toBe("b");
    expect(nextInQueue({ ...q, state: { ...q.state, b: { status: "rejected", at: "t" }, c: { status: "ready-for-review", at: "t" } } }, ["a", "b", "c"])).toBeNull();
    expect(mayPost(q, "b")).toMatch(/has not been made/);
    expect(mayPost(q, "a")).toMatch(/already approved/);
    expect(mayPost({ ...q, state: { b: { status: "rejected", at: "t", why: "two tails" } } }, "b")).toMatch(/rejected: two tails/);
    expect(mayPost({ ...q, state: { b: { status: "ready-for-review", at: "t" } } }, "b")).toBeNull();
    const c = conceptById("permit-office-359");
    const good = { clip: { width: 1080, height: 1920, fps: 30, durationSec: 9.5, lufs: -14.2, truePeakDb: -3 }, aiGenerated: true, disclosure: { tiktok: { isAiGenerated: true }, youtube: { containsSyntheticMedia: true } }, speech: { lineOverBedDb: 14 } };
    expect(automaticChecks(c, good, 14, 24).failed).toEqual([]);
    const bad = automaticChecks(c, { ...good, clip: { ...good.clip, lufs: -19 }, aiGenerated: false, speech: { lineOverBedDb: 6 } }, 30, 24).failed.join(" | ");
    expect(bad).toMatch(/-19 LUFS/); expect(bad).toMatch(/AI-generated flag is missing/); expect(bad).toMatch(/only 6 dB over the bed/); expect(bad).toMatch(/over the clip's budget/);
  });
  it("a Short goes out public, labelled synthetic, with #Shorts in its title", () => {
    const p = postsOf(conceptById("while-youre-here")).youtube!;
    const req = uploadSessionRequest({ title: p.title!, description: p.text, categoryId: "24", privacyStatus: "public", containsSyntheticMedia: true }, 5_000_000);
    expect(req.body.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(req.body.snippet.title).toMatch(/#Shorts$/);
  });
});

describe("gator shorts — measuring a voice nobody here can hear", () => {
  const tone = (hz: number, sec: number, bright = 0) => Int16Array.from({ length: Math.round(16000 * sec) }, (_x, i) => { const t = i / 16000; return Math.round(9000 * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * 2 * hz * t) + bright * Math.sin(2 * Math.PI * 3200 * t))); });
  it("finds how low a voice sits, how bright it is and when there is sound", () => {
    const quiet = new Int16Array(8000), low = analyse(Int16Array.from([...quiet, ...tone(125, 1.2), ...quiet]));
    expect(low.f0).toBeGreaterThan(118); expect(low.f0).toBeLessThan(132);
    expect(low.bursts).toHaveLength(1);
    expect(low.bursts[0].start).toBeGreaterThan(0.4); expect(low.bursts[0].end).toBeLessThan(1.85);
    const high = analyse(tone(240, 1));
    expect(high.f0).toBeGreaterThan(225); expect(high.f0).toBeLessThan(255);
    expect(analyse(tone(125, 1, 0.8)).centroid).toBeGreaterThan(analyse(tone(125, 1)).centroid * 1.5);
    expect(analyse(new Int16Array(16000)).f0).toBe(0);
  });
  it("a take is held to a band around the voice the owner approved, and pulled onto its pitch when close", () => {
    expect(REFERENCE).toEqual({ f0: 127, centroid: 1548 });
    expect(compare({ f0: 134.5, centroid: 1429 }, REFERENCE).inBand).toBe(true);
    expect(compare({ f0: 179.8, centroid: 1704 }, REFERENCE).inBand).toBe(false);
    expect(compare({ f0: 0, centroid: 0 }, REFERENCE).inBand).toBe(false);
    expect(compare({ f0: 130, centroid: 1452 }, REFERENCE).distance).toBeLessThan(compare({ f0: 155, centroid: 1617 }, REFERENCE).distance);
    expect(pitchCorrection({ f0: 134.5 }, REFERENCE)).toBeCloseTo(0.944, 3);
    expect(pitchCorrection({ f0: 280 }, REFERENCE)).toBe(0.84);                // never more than about three semitones
    expect(pitchCorrection({ f0: 0 }, REFERENCE)).toBe(1);
    expect(BAND.f0).toBeLessThanOrEqual(0.2);
    expect(fs.readFileSync("docs/gator/VOICE.md", "utf8")).toContain("127 Hz");
  });
});

describe("gator shorts — the instant replay", () => {
  it("the take, a rewind, four replays each a different way, the aftermath, a short tag", () => {
    const ed = replayPlan(10, 5.55, 0.8, 2.2);
    expect(ed.pieces.map((p) => p.name)).toEqual(["take", "rewind", "replay-1", "replay-2", "replay-3", "replay-4", "after"]);
    expect(ed.pieces[0]).toMatchObject({ srcFrom: 2.2, speed: 1 });
    expect(ed.pieces[1]).toMatchObject({ reverse: true, speed: 3 });
    expect(ed.pieces.filter((p) => p.name.startsWith("replay")).map((p) => p.speed)).toEqual([0.6, 0.6, 0.8, 0.33]);
    expect(ed.pieces[4]).toMatchObject({ mirror: true, shake: true, freeze: 0.5 });
    for (let i = 1; i < ed.pieces.length; i++) expect(ed.pieces[i].outStart).toBeCloseTo(ed.pieces[i - 1].outStart + ed.pieces[i - 1].outSec, 6);
    // Every replay shows the impact, and a hit can be laid on it.
    for (const p of ed.pieces.filter((x) => x.name.startsWith("replay"))) { expect(p.impactAt).not.toBeNull(); expect(p.impactAt!).toBeGreaterThan(p.outStart); expect(p.impactAt!).toBeLessThanOrEqual(p.outStart + p.outSec); expect(p.outSec).toBeGreaterThanOrEqual(0.8); expect(p.outSec).toBeLessThanOrEqual(3.2); }
    expect(ed.totalSec - ed.bodySec).toBeCloseTo(0.8, 6);
    expect(ed.totalSec).toBeGreaterThan(12); expect(ed.totalSec).toBeLessThan(21);
    // An impact too near either end is moved in, never out of the take.
    expect(replayPlan(10, 0.1).pieces[1].srcFrom).toBeCloseTo(0, 6);
    expect(replayPlan(10, 9.99).pieces[0].srcTo).toBeLessThanOrEqual(10);
    expect(replayPlan(6, 5.4, 0).pieces.some((p) => p.name === "after")).toBe(false);
  });
});

describe("gator shorts — the styles experiment and its scoreboard", () => {
  const post = (conceptId: string, style: number, platform: string, hoursAgo: number, now: Date): Posted => ({ conceptId, style, platform, url: `https://x/${conceptId}`, publishedAt: new Date(now.getTime() - hoursAgo * 3600000).toISOString() });
  const now = new Date("2026-10-12T16:00:00Z"), r = (views: number, likes = 0, comments = 0, shares = 0) => ({ views, likes, comments, shares, at: now.toISOString(), source: "manual" as const });
  it("fifteen styles, each with a recipe, a cost and an example; the document is their print-out", () => {
    expect(STYLES.map((s) => s.id)).toEqual(Array.from({ length: 15 }, (_x, i) => i + 1));
    for (const s of STYLES) { expect(s.definition.length).toBeGreaterThan(20); expect(s.recipe.length).toBeGreaterThan(20); expect(s.creditsPerClip).toBeGreaterThan(0); expect(s.example.length).toBeGreaterThan(5); for (const c of s.clips) expect(conceptById(c).style ?? 6, c).toBe(s.id); }
    expect(STYLES.reduce((n, s) => n + 2 * s.creditsPerClip, 0) * 0.0625).toBeLessThan(100);     // two of each fit under the cap
    expect(fs.readFileSync(STYLES_DOC, "utf8")).toBe(stylesMd());
  });
  it("the posting plan puts a style's two clips on different days and different dayparts", () => {
    const plan = schedule(STYLES);
    for (const s of STYLES) {
      const noon = plan.filter((d) => d.noon === s.id), evening = plan.filter((d) => d.evening === s.id);
      expect(noon).toHaveLength(1); expect(evening).toHaveLength(1);
      expect(noon[0].day).not.toBe(evening[0].day);
    }
    for (const d of plan) expect(d.noon).not.toBe(d.evening);
  });
  it("a reading is taken once, at the latest checkpoint that is due", () => {
    expect(due(post("a", 1, "tiktok", 1, now), undefined, now)).toEqual([]);
    expect(due(post("a", 1, "tiktok", 3, now), undefined, now)).toEqual(["2h"]);
    expect(due(post("a", 1, "tiktok", 30, now), undefined, now)).toEqual(["24h"]);          // late: one reading, not two
    expect(due(post("a", 1, "tiktok", 30, now), { "24h": r(10) }, now)).toEqual([]);
    expect(due(post("a", 1, "tiktok", 80, now), { "2h": r(1), "24h": r(10) }, now)).toEqual(["72h"]);
    expect(due(post("a", 1, "tiktok", 80, now), { "2h": r(1), "24h": r(10), "72h": r(20) }, now)).toEqual([]);
  });
  it("clips are ranked within their platform — by views and by engagement rate", () => {
    expect(engagementRate(r(200, 10, 4, 6))).toBeCloseTo(0.1, 6);
    expect(engagementRate(r(0, 5))).toBeNull();
    expect(percentiles([10, 30, 20, null])).toEqual([0, 1, 0.5, null]);
    expect(percentiles([5, 5])).toEqual([0.5, 0.5]);
    const posted = [post("a", 1, "tiktok", 80, now), post("b", 6, "tiktok", 80, now), post("a", 1, "instagram", 80, now), post("b", 6, "instagram", 80, now)];
    const metrics: Metrics = { "a@tiktok": { "72h": r(9000, 900) }, "b@tiktok": { "72h": r(1000, 20) }, "a@instagram": { "72h": r(300, 30) }, "b@instagram": { "72h": r(200, 40) } };
    const rows = rank(posted, metrics, "72h");
    // TikTok's 9,000 views do not swamp Instagram's 300: each is first in its own platform.
    expect(rows.filter((x) => x.conceptId === "a").map((x) => x.viewsPct)).toEqual([1, 1]);
    expect(rows.find((x) => x.conceptId === "b" && x.platform === "instagram")!.erPct).toBe(1);
    const styles = byStyle(rows);
    expect(styles.find((s) => s.style === 1)!.score!).toBeGreaterThan(styles.find((s) => s.style === 6)!.score!);
    expect(styles.find((s) => s.style === 1)).toMatchObject({ clips: 1, readings: 2, views: 9300 });
  });
  it("no recommendation until every style has two clips at +72 h", () => {
    const posted = [post("a1", 1, "tiktok", 80, now), post("a2", 1, "tiktok", 80, now), post("b1", 6, "tiktok", 80, now), post("b2", 6, "tiktok", 80, now), post("c1", 9, "tiktok", 80, now), post("c2", 9, "tiktok", 80, now)];
    const metrics: Metrics = { "a1@tiktok": { "72h": r(9000, 900) }, "a2@tiktok": { "72h": r(7000, 500) }, "b1@tiktok": { "72h": r(1000, 20) }, "b2@tiktok": { "72h": r(1500, 30) }, "c1@tiktok": { "72h": r(400, 4) } };
    const early = recommend([1, 6, 9], rank(posted, metrics, "72h"));
    expect(early.ready).toBe(false);
    expect(early.text).toMatch(/style 9: 1 of 2 clips have a \+72 h reading/);
    expect(recommend([1, 6, 9, 14], rank(posted, metrics, "72h")).text).toMatch(/style 14: 0 of 2 clips posted/);
    metrics["c2@tiktok"] = { "72h": r(300, 2) };
    const done = recommend([1, 6, 9], rank(posted, metrics, "72h"));
    expect(done.ready).toBe(true);
    expect(done.text).toMatch(/^Double down on styles 1 and 6.*drop style 9/);
    const md = boardMd(posted, metrics, [1, 6, 9], ["c9,instagram,24h"], now);
    expect(md).toContain("**Double down on styles 1 and 6");
    expect(md).toContain("| a1 | 1 | tiktok | 9000 | 900 |");
    expect(md).toContain("Blotato's API gives no analytics");
  });
  it("the manual sheet and the ledger are read strictly", () => {
    const m = parseManual("conceptId,platform,checkpoint,views,likes,comments,shares\n# typed from the apps\nselfie-roof,tiktok,24h,1200,80,12,30\nselfie-roof,instagram,2h,90\n", now);
    expect(m["selfie-roof@tiktok"]["24h"]).toMatchObject({ views: 1200, likes: 80, comments: 12, shares: 30, source: "manual" });
    expect(m["selfie-roof@instagram"]["2h"]).toMatchObject({ views: 90, likes: 0 });
    expect(() => parseManual("selfie-roof,tiktok,48h,1", now)).toThrow(/is not conceptId,platform,checkpoint/);
    expect(() => parseManual("selfie-roof,tiktok,24h,abc", now)).toThrow();
    const posted = postedOf({ posts: [{ conceptId: "a", platform: "tiktok", status: "published", publicUrl: "u", scheduledTime: "2026-10-08T04:17:00Z", createdAt: "x" }, { conceptId: "a", platform: "instagram", status: "failed", createdAt: "x" }], youtube: [{ conceptId: "a", status: "uploaded", videoId: "v1", url: "y", uploadedAt: "2026-10-09T00:00:00Z" }, { conceptId: "b", status: "failed", videoId: null }] }, () => 6);
    expect(posted.map((p) => `${p.conceptId}@${p.platform}`)).toEqual(["a@tiktok", "a@youtube"]);
    expect(posted[0].style).toBe(6);
  });
});
