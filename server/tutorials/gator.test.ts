import { describe, expect, it } from "vitest";
import {
  BudgetError, HF_BASE, PILOT, assertWithinBudget, charged, emptyLedger, estimate, generate, pilotCap, redact, spent, uploadInput,
  type Creds, type Fetch, type GenerateInput, type Io, type Ledger,
} from "../../scripts/gator/higgsfield";
import { CONCEPTS, lintConcept, motionPrompt, postsOf, stillPrompt } from "../../scripts/gator/concepts";
import { END_TAG_SEC, H, LOGO_RECT, MAX_SEC, MIN_PX, W, ZONES, assFile, layoutBeat, wrapCaption, type Beat } from "../../scripts/gator/layout";
import { timeline } from "../../scripts/gator/make";
import fs from "fs";
import { DOC, conceptsMd } from "../../scripts/gator/concepts-doc";
import { viralMain } from "../../scripts/gator/post";
import { RATE, synth, toPcm } from "../../scripts/gator/sound";
import { VIRAL_RULES, emptyViralLedger, planViral, slotFor, weekOf, type ViralClip, type ViralLedgerPost, type ViralTarget } from "../../scripts/gator/stream";
import { buildPost, emptyLedger as emptySocialLedger, type LedgerPost, type SocialLedger } from "../../scripts/tutorials/social-post-lib";
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
      expect(t.totalSec - t.bodySec).toBe(END_TAG_SEC);
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
  it("the viral stream is a dry run: --go is refused", async () => {
    const err = console.error; let said = "";
    console.error = (s: string) => { said += s; };
    try { expect(await viralMain(["--stream", "viral", "--go"])).toBe(1); } finally { console.error = err; }
    expect(said).toMatch(/dry run only/);
  });
});
