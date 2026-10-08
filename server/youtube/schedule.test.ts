/**
 * The YouTube publishing schedule, against temp dirs and a mocked fetch:
 * nothing here reaches Google or the database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_YOUTUBE_CHANNEL_ID, YT_FORCE_SSL_SCOPE, YT_READONLY_SCOPE, YT_UPLOAD_SCOPE, type Deps, type YoutubeGrant } from "./client";
import {
  MIN_GAP_MINUTES, ROTATION, SLOT_POOLS, addDays, calendarMarkdown, easternLabel, findCandidates, interleave, planSchedule, readLedger, readOrder,
  reconcile, retryThumbnails, runUploads, timesForDate, trackOf, updateDescriptions, writeLedger, zoneTime, zonedToUtc, manifestShaIn, masterChangedLines, type Describe, type Ledger, type LedgerEntry, type Track,
} from "./schedule";

/** Wednesday 2026-10-07, 20:30 Eastern — already Thursday the 8th in UTC, which is what the host clock shows. */
const NOW = Date.UTC(2026, 9, 8, 0, 30, 0);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
/**
 * A YouTube that answers by URL: uploads get ids vid_0001, vid_0002 …; `on` can
 * answer (or refuse) any call first. Every write is recorded.
 */
function fakeYoutube(on: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined = () => undefined) {
  const calls: Call[] = [];
  let n = 0;
  const http = (async (url: any, init: any = {}) => {
    const c: Call = { url: String(url), method: init.method ?? "GET", body: init.body, headers: { ...(init.headers ?? {}) } };
    calls.push(c);
    const reply = on(c) ?? (() => {
      if (c.method === "POST" && c.url.includes("/upload/youtube/v3/videos?uploadType=resumable")) return { headers: { location: `https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s${n + 1}` } };
      if (c.method === "PUT" && c.url.includes("upload_id=")) { n++; return { json: { id: `vid_${String(n).padStart(4, "0")}`, status: { privacyStatus: "private", uploadStatus: "uploaded", publishAt: JSON.parse(calls.filter((x) => x.method === "POST" && x.url.includes("uploadType=resumable")).pop()!.body).status.publishAt } } }; }
      if (c.url.includes("/captions?")) return { json: { id: "cap1" } };
      if (c.url.includes("/thumbnails/set")) return { json: { items: [] } };
      if (c.method === "GET" && c.url.includes("/playlists?")) return { json: { items: [{ id: "PL1", snippet: { title: "ConstructHUB CRM tutorials" } }] } };
      if (c.url.includes("/playlistItems?")) return { json: { id: "pli" } };
      throw new Error(`unexpected request: ${c.method} ${c.url}`);
    })();
    const status = reply.status ?? 200, text = reply.json === undefined ? "" : JSON.stringify(reply.json);
    return { status, ok: status >= 200 && status < 300, headers: new Headers(reply.headers ?? {}), json: async () => JSON.parse(text || "null"), text: async () => text } as unknown as Response;
  }) as typeof fetch;
  const grant: YoutubeGrant = {
    channelId: DEFAULT_YOUTUBE_CHANNEL_ID, refreshToken: "refresh-fixture", accessToken: "access-fixture", expiresAt: new Date(NOW + 3_600_000),
    scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_FORCE_SSL_SCOPE], needsReconnect: false,
  };
  const deps: Deps = { http, now: () => NOW, retryDelayMs: 0, store: { load: async () => grant, saveAccess: async () => undefined, markNeedsReconnect: async () => undefined } };
  const uploads = () => calls.filter((c) => c.method === "POST" && c.url.includes("uploadType=resumable")).map((c) => JSON.parse(c.body));
  return { deps, calls, uploads };
}

let root = "", out = "", manifests = "", ledgerFile = "";
beforeAll(() => { root = fs.mkdtempSync(path.join(tmpdir(), "chub-ytsched-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  out = path.join(dir, "video-out"); manifests = path.join(dir, "videos"); ledgerFile = path.join(dir, "youtube-schedule.json");
  fs.mkdirSync(out); fs.mkdirSync(manifests);
});

/** One production folder; `merged` writes its manifest too. */
function produce(helpKey: string, o: { merged?: boolean; bytes?: string; thumbnail?: boolean; srt?: boolean; meta?: boolean; dir?: string; extra?: Record<string, unknown> } = {}) {
  const dir = path.join(o.dir ?? out, helpKey);
  fs.mkdirSync(dir, { recursive: true });
  const video = Buffer.from(o.bytes ?? `video of ${helpKey}`);
  fs.writeFileSync(path.join(dir, "walkthrough.mp4"), video);
  if (o.srt !== false) fs.writeFileSync(path.join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:02,000\nHello\n");
  if (o.thumbnail !== false) fs.writeFileSync(path.join(dir, "thumbnail.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  if (o.meta !== false) fs.writeFileSync(path.join(dir, "youtube.json"), JSON.stringify({
    helpKey, channel: { id: DEFAULT_YOUTUBE_CHANNEL_ID }, title: `How to ${helpKey}`, description: "A walkthrough.", tags: ["crm"],
    playlist: "ConstructHUB CRM tutorials", madeForKids: false, defaultLanguage: "en",
    files: { video: "walkthrough.mp4", captions: "captions.srt", thumbnail: "thumbnail.jpg" }, video: { sha256: sha(video) }, ...o.extra,
  }));
  if (o.merged !== false) fs.writeFileSync(path.join(manifests, `${helpKey}.json`), JSON.stringify({ helpKey, video: { sha256: sha(video) } }));
  return dir;
}
const published = (helpKey: string, videoId: string, at: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  helpKey, title: helpKey, videoId, url: `https://www.youtube.com/watch?v=${videoId}`, status: "published", publishAt: at, publishAtEastern: easternLabel(at),
  uploadedAt: at, sha256: null, captions: "ok", thumbnail: "ok", playlist: "ok", ...extra,
});
const ledgerOf = (...videos: LedgerEntry[]): Ledger => ({ version: 1, timezone: "America/New_York", channelId: DEFAULT_YOUTUBE_CHANNEL_ID, videos });
/** One a day unless a test says otherwise (the three-a-day default has its own tests). */
const plan = (o: Partial<Parameters<typeof planSchedule>[0]> = {}) =>
  planSchedule({ ledger: fs.existsSync(ledgerFile) ? readLedger(ledgerFile) : ledgerOf(), candidates: findCandidates([out], manifests).eligible, tracks: [], now: new Date(NOW), perDay: 1, ...o });
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);

describe("Eastern time", () => {
  it("turns an Eastern wall time into UTC on both sides of the 1 November 2026 fall-back", () => {
    expect(zonedToUtc("2026-10-31", "06:00").toISOString()).toBe("2026-10-31T10:00:00.000Z"); // EDT, UTC-4
    expect(zonedToUtc("2026-11-01", "06:00").toISOString()).toBe("2026-11-01T11:00:00.000Z"); // EST, UTC-5: the clocks went back at 02:00
    expect(zonedToUtc("2026-11-02", "19:30").toISOString()).toBe("2026-11-03T00:30:00.000Z");
    expect(zonedToUtc("2027-03-14", "06:00").toISOString()).toBe("2027-03-14T10:00:00.000Z"); // spring forward that morning
    expect(zonedToUtc("2027-03-13", "18:30").toISOString()).toBe("2027-03-13T23:30:00.000Z");
  });
  it("reads an instant back as the Eastern date, time, weekday and zone", () => {
    expect(zoneTime("2026-11-01T11:00:00Z")).toEqual({ date: "2026-11-01", time: "06:00", weekday: "Sunday", abbr: "EST" });
    expect(zoneTime("2026-10-08T00:08:28Z")).toEqual({ date: "2026-10-07", time: "20:08", weekday: "Wednesday", abbr: "EDT" });
    expect(easternLabel("2026-10-31T10:00:00Z")).toBe("2026-10-31 06:00 EDT (Saturday)");
  });
  it("does not care what time zone the host is in", () => {
    const before = process.env.TZ;
    try {
      for (const host of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
        process.env.TZ = host;
        expect(zonedToUtc("2026-11-01", "06:00").toISOString(), host).toBe("2026-11-01T11:00:00.000Z");
        expect(zoneTime("2026-10-08T00:08:28Z"), host).toEqual({ date: "2026-10-07", time: "20:08", weekday: "Wednesday", abbr: "EDT" });
        expect(addDays("2026-10-31", 1), host).toBe("2026-11-01");
      }
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  it("does calendar arithmetic without a clock", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => addDays("2026-02-30", 1)).toThrow(/not a date/);
  });
});

describe("the times of day for a date", () => {
  const year = Array.from({ length: 400 }, (_, i) => addDays("2026-10-08", i));
  it("three a day: one morning, one midday, one late, at least three hours apart, across the fall-back too", () => {
    for (const d of year) {
      const [a, b, c] = timesForDate(d);
      expect(timesForDate(d, 3)).toEqual([a, b, c]);
      expect(SLOT_POOLS.morning as readonly string[], d).toContain(a);
      expect(SLOT_POOLS.midday as readonly string[], d).toContain(b);
      expect(SLOT_POOLS.late as readonly string[], d).toContain(c);
      expect(mins(b) - mins(a), d).toBeGreaterThanOrEqual(MIN_GAP_MINUTES);
      expect(mins(c) - mins(b), d).toBeGreaterThanOrEqual(MIN_GAP_MINUTES);
      // …and in real elapsed time, on the 25-hour day as well
      const at = [a, b, c].map((t) => zonedToUtc(d, t).getTime());
      expect(at[1] - at[0], d).toBeGreaterThanOrEqual(MIN_GAP_MINUTES * 60_000);
      expect(at[2] - at[1], d).toBeGreaterThanOrEqual(MIN_GAP_MINUTES * 60_000);
    }
  });
  it("never repeats a slot's time on consecutive days, uses every time of every pool, and has no fixed cycle", () => {
    const days = year.map((d) => timesForDate(d));
    for (const slot of [0, 1, 2]) {
      const times = days.map((t) => t[slot]);
      for (let i = 1; i < times.length; i++) expect(times[i], `${year[i]} slot ${slot}`).not.toBe(times[i - 1]);
      expect(new Set(times).size).toBe(5);
      for (const period of [2, 4, 6, 7, 14]) expect(times.slice(0, 90).every((t, i) => i < period || t === times[i - period])).toBe(false);
    }
    expect(new Set(days.map((t) => t.join())).size).toBeGreaterThan(15);
  });
  it("two a day is morning + late; one a day rotates through the owner's ten times, never the same two days running", () => {
    for (const d of year.slice(0, 120)) {
      const [a, c, ...rest] = timesForDate(d, 2);
      expect(rest).toEqual([]);
      expect(SLOT_POOLS.morning as readonly string[]).toContain(a);
      expect(SLOT_POOLS.late as readonly string[]).toContain(c);
    }
    const two = year.map((d) => timesForDate(d, 2));
    for (let i = 1; i < two.length; i++) { expect(two[i][0]).not.toBe(two[i - 1][0]); expect(two[i][1]).not.toBe(two[i - 1][1]); }
    const one = year.map((d) => timesForDate(d, 1));
    expect(one.every((t) => t.length === 1 && (ROTATION as readonly string[]).includes(t[0]))).toBe(true);
    for (let i = 1; i < one.length; i++) expect(one[i][0], year[i]).not.toBe(one[i - 1][0]);
    expect(new Set(one.map((t) => t[0])).size).toBe(ROTATION.length);
    expect(() => timesForDate("2026-10-09", 4)).toThrow(/1, 2 or 3/);
  });
  it("is the same every time it is asked", () => {
    expect(year.map((d) => timesForDate(d))).toEqual(year.map((d) => timesForDate(d)));
  });
});

describe("which videos are eligible", () => {
  it("needs the mp4, the captions, youtube.json and the merged manifest", () => {
    produce("crm-ready");
    produce("crm-unmerged", { merged: false });
    produce("crm-no-captions", { srt: false });
    produce("crm-no-meta", { meta: false });
    produce("crm-no-thumb", { thumbnail: false });
    produce("crm-other-encode", { extra: { video: { sha256: "0".repeat(64) } } });
    fs.writeFileSync(path.join(out, "build.log"), "not a production");
    const { eligible, skipped } = findCandidates([out, path.join(root, "no-such-dir")], manifests);
    expect(eligible.map((c) => c.helpKey)).toEqual(["crm-no-thumb", "crm-ready"]);
    expect(eligible[0].thumbnail).toBeNull();
    expect(eligible[1].sha256).toBe(sha("video of crm-ready"));
    const reason = (k: string) => skipped.find((s) => s.helpKey === k)?.reason;
    expect(reason("crm-unmerged")).toMatch(/not merged yet/);
    expect(reason("crm-no-captions")).toMatch(/captions\.srt is missing/);
    expect(reason("crm-no-meta")).toMatch(/no youtube\.json/);
    expect(reason("crm-other-encode")).toMatch(/not the encode/);
    expect(findCandidates([out], manifests, { includeUnmerged: true }).eligible.map((c) => c.helpKey)).toContain("crm-unmerged");
  });
  it("takes the copy that matches the manifest when two out-dirs hold the same key", () => {
    const other = path.join(path.dirname(out), "other-out");
    produce("crm-twice", { bytes: "the merged cut" });
    produce("crm-twice", { bytes: "a stale cut", dir: other, merged: false });
    const { eligible, skipped } = findCandidates([other, out], manifests);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].dir).toBe(path.join(out, "crm-twice"));
    expect(skipped.find((s) => s.helpKey === "crm-twice")?.reason).toMatch(/another copy is used/);
  });
});

describe("slot assignment", () => {
  const keys = Array.from({ length: 30 }, (_, i) => `crm-v${String(i).padStart(2, "0")}`);
  it("gives one video per Eastern day from tomorrow, at varied times, across the fall-back", () => {
    keys.forEach((k) => produce(k));
    const p = plan().planned;
    expect(p).toHaveLength(30);
    expect(p.map((x) => x.date)).toEqual(keys.map((_, i) => addDays("2026-10-08", i)));
    for (let i = 1; i < p.length; i++) expect(p[i].time).not.toBe(p[i - 1].time);
    expect(new Set(p.map((x) => x.time)).size).toBeGreaterThanOrEqual(6);
    for (const x of p) {
      expect(ROTATION as readonly string[]).toContain(x.time);
      expect(zoneTime(x.publishAt)).toEqual({ date: x.date, time: x.time, weekday: x.weekday, abbr: x.abbr });
      expect(x.publishAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    }
    const oct31 = p.find((x) => x.date === "2026-10-31")!, nov1 = p.find((x) => x.date === "2026-11-01")!;
    expect(oct31.abbr).toBe("EDT");
    expect(nov1.abbr).toBe("EST");
    expect(nov1.weekday).toBe("Sunday");
    expect(nov1.publishAt).toBe(zonedToUtc("2026-11-01", nov1.time).toISOString().replace(".000Z", "Z"));
    expect((Date.parse(nov1.publishAt) - Date.parse(zonedToUtc("2026-10-31", nov1.time).toISOString())) / 3_600_000).toBe(25);
  });
  it("starts the day after the last date in the ledger, and never fills a day twice", () => {
    produce("crm-a"); produce("crm-b");
    writeLedger(ledgerFile, ledgerOf(published("old-1", "old_00001", "2026-10-08T00:08:00Z"), published("old-2", "old_00002", zonedToUtc("2026-10-12", "09:00").toISOString(), { status: "scheduled" })));
    expect(plan().planned.map((x) => x.date)).toEqual(["2026-10-13", "2026-10-14"]);
    // --start before the last date: the free days are filled, the taken one is stepped over
    expect(plan({ start: "2026-10-11" }).planned.map((x) => x.date)).toEqual(["2026-10-11", "2026-10-13"]);
    // --per-day 2 on a ledger made one a day: the last day gets a second post only if it is three hours from the first
    const two = plan({ perDay: 2 }).planned;
    expect(two.map((x) => x.date)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(SLOT_POOLS.late as readonly string[]).toContain(two[0].time);
    expect(SLOT_POOLS.morning as readonly string[]).toContain(two[1].time);
  });
  it("never hands out a time that is too close, even with --start today", () => {
    produce("crm-a");
    const p = plan({ start: "2026-10-07" }).planned[0]; // it is 20:30 on the 7th: every slot of that day has passed
    expect(p.date).toBe("2026-10-08");
    // "tomorrow" is tomorrow in Eastern: at 00:30 UTC on the 8th it is still the 7th there, so the 8th is tomorrow, not today
    expect(plan().planned[0].date).toBe("2026-10-08");
    expect(planSchedule({ ledger: ledgerOf(), candidates: findCandidates([out], manifests).eligible, tracks: [], now: new Date("2026-10-08T03:59:00Z") }).planned[0].date).toBe("2026-10-08");
    expect(planSchedule({ ledger: ledgerOf(), candidates: findCandidates([out], manifests).eligible, tracks: [], now: new Date("2026-10-08T04:01:00Z") }).planned[0].date).toBe("2026-10-09");
    expect(plan({ start: "2026-10-01" }).problems.join()).toMatch(/in the past/);
  });
});

describe("three a day", () => {
  const tracks: Track[] = [
    { name: "clients", keys: ["cl-1", "cl-2", "cl-3", "cl-4"] }, { name: "estimates", keys: ["es-1", "es-2", "es-3", "es-4"] },
    { name: "schedule", keys: ["sc-1", "sc-2"] }, { name: "projects", keys: ["pr-1", "pr-2", "pr-3"] },
  ];
  const all = tracks.flatMap((t) => t.keys);
  const three = (o: Partial<Parameters<typeof planSchedule>[0]> = {}) => plan({ tracks, perDay: undefined, ...o });

  it("is the default: three per Eastern day from tomorrow, in the date's three slots, across the fall-back", () => {
    Array.from({ length: 81 }, (_, i) => produce(`crm-v${String(i).padStart(2, "0")}`));
    const p = plan({ perDay: undefined }).planned;
    expect(p).toHaveLength(81);
    const days = [...new Set(p.map((x) => x.date))];
    expect(days).toEqual(Array.from({ length: 27 }, (_, i) => addDays("2026-10-08", i)));
    for (const d of days) {
      const day = p.filter((x) => x.date === d);
      expect(day.map((x) => x.time), d).toEqual(timesForDate(d));
      expect(Date.parse(day[1].publishAt) - Date.parse(day[0].publishAt)).toBeGreaterThanOrEqual(3 * 3_600_000);
      expect(Date.parse(day[2].publishAt) - Date.parse(day[1].publishAt)).toBeGreaterThanOrEqual(3 * 3_600_000);
      for (const x of day) expect(zoneTime(x.publishAt)).toEqual({ date: d, time: x.time, weekday: x.weekday, abbr: x.abbr });
    }
    const nov1 = p.filter((x) => x.date === "2026-11-01");
    expect(nov1.map((x) => x.abbr)).toEqual(["EST", "EST", "EST"]);
    expect(p.filter((x) => x.date === "2026-10-31").map((x) => x.abbr)).toEqual(["EDT", "EDT", "EDT"]);
    expect(nov1[0].publishAt).toBe(`2026-11-01T${String(+nov1[0].time.slice(0, 2) + 5).padStart(2, "0")}:${nov1[0].time.slice(3)}:00Z`);
  });

  it("takes one video from each area in turn, each area in its own order", () => {
    expect(interleave(all.map((helpKey) => ({ helpKey })), tracks).map((x) => x.helpKey))
      .toEqual(["cl-1", "es-1", "sc-1", "pr-1", "cl-2", "es-2", "sc-2", "pr-2", "cl-3", "es-3", "pr-3", "cl-4", "es-4"]);
    expect(interleave([{ helpKey: "zeta" }, { helpKey: "es-2" }, { helpKey: "alpha" }, { helpKey: "cl-3" }, { helpKey: "es-1" }], tracks).map((x) => x.helpKey))
      .toEqual(["cl-3", "es-1", "alpha", "es-2", "zeta"]);
    expect(trackOf("zeta", tracks)).toBe("other");

    [...all].reverse().forEach((k) => produce(k));
    const p = three().planned;
    for (const d of new Set(p.map((x) => x.date))) {
      const areas = p.filter((x) => x.date === d).map((x) => trackOf(x.helpKey, tracks));
      if (d < "2026-10-11") expect(new Set(areas).size, d).toBe(3); // while three areas still have something
    }
    for (const t of tracks) expect(p.filter((x) => t.keys.includes(x.helpKey)).map((x) => x.helpKey)).toEqual(t.keys);
  });

  it("keeps a missing key's place, fills a half-full day first, carries the turn on, and moves nothing already scheduled", async () => {
    ["cl-1", "cl-3", "es-1", "es-2", "sc-1"].forEach((k) => produce(k)); // cl-2 is not produced yet
    const yt = fakeYoutube();
    const first = three().planned;
    expect(first.map((x) => [x.helpKey, x.date])).toEqual([["cl-1", "2026-10-08"], ["es-1", "2026-10-08"], ["sc-1", "2026-10-08"], ["cl-3", "2026-10-09"], ["es-2", "2026-10-09"]]);
    await runUploads({ ledgerFile, planned: first, deps: yt.deps, max: 4 }); // stops one short: the 9th has one of its three
    const frozen = readLedger(ledgerFile).videos.map((v) => [v.helpKey, v.publishAt]);
    expect(frozen.map(([k]) => k)).toEqual(["cl-1", "es-1", "sc-1", "cl-3"]);

    ["cl-2", "pr-1", "sc-2"].forEach((k) => produce(k));
    const second = three().planned;
    // the last scheduled video was a clients one, so the turn goes on with estimates; cl-2 arrives late and takes the next free slot
    expect(second.map((x) => [x.helpKey, x.date])).toEqual([["es-2", "2026-10-09"], ["sc-2", "2026-10-09"], ["pr-1", "2026-10-10"], ["cl-2", "2026-10-10"]]);
    expect([first[3].time, second[0].time, second[1].time]).toEqual(timesForDate("2026-10-09"));
    await runUploads({ ledgerFile, planned: second, deps: yt.deps });
    const after = readLedger(ledgerFile).videos;
    expect(after.filter((v) => frozen.some(([k]) => k === v.helpKey)).map((v) => [v.helpKey, v.publishAt])).toEqual(frozen);
    expect(new Set(after.map((v) => v.publishAt)).size).toBe(8);
    expect(three().planned).toEqual([]);
  });

  it("reads the order file as tracks (and an old flat list as one track)", () => {
    const f = path.join(path.dirname(ledgerFile), "order.json");
    fs.writeFileSync(f, JSON.stringify({ tracks: [{ name: "a", keys: ["x", "y"] }, { name: "b", keys: ["y", "z"] }] }));
    expect(readOrder(f)).toEqual([{ name: "a", keys: ["x", "y"] }, { name: "b", keys: ["z"] }]);
    fs.writeFileSync(f, JSON.stringify({ order: ["b", "a", "b"] }));
    expect(readOrder(f)).toEqual([{ name: "all", keys: ["b", "a"] }]);
    expect(readOrder(path.join(root, "none.json"))).toEqual([]);
    fs.writeFileSync(f, JSON.stringify({ tracks: [{ keys: ["x"] }] }));
    expect(() => readOrder(f)).toThrow(/tracks/);
  });
});

describe("the learning order, one a day", () => {
  it("keeps a missing key's place for later and never moves a scheduled day", () => {
    const tracks: Track[] = [{ name: "all", keys: ["crm-home", "crm-clients", "crm-estimates", "crm-invoices"] }];
    produce("crm-invoices"); produce("crm-home"); produce("zeta"); // crm-clients and crm-estimates are not produced yet
    const first = plan({ tracks });
    expect(first.planned.map((x) => [x.helpKey, x.date])).toEqual([["crm-home", "2026-10-08"], ["zeta", "2026-10-09"], ["crm-invoices", "2026-10-10"]]);
    writeLedger(ledgerFile, ledgerOf(...first.planned.map((x, i) => published(x.helpKey, `sched_000${i}`, x.publishAt, { status: "scheduled", sha256: x.candidate.sha256 }))));

    produce("crm-estimates"); produce("crm-clients"); // they arrive later: next free days, in order, nothing moved
    const second = plan({ tracks });
    expect(second.planned.map((x) => [x.helpKey, x.date])).toEqual([["crm-clients", "2026-10-11"], ["crm-estimates", "2026-10-12"]]);
    expect(second.alreadyPosted.sort()).toEqual(["crm-home", "crm-invoices", "zeta"]);
    expect(readLedger(ledgerFile).videos.map((v) => zoneTime(v.publishAt!).date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
  });
});

describe("uploading", () => {
  it("uploads private with publishAt, adds captions, thumbnail and playlist, and writes the ledger after every step", async () => {
    produce("crm-a"); produce("crm-b", { extra: { categoryId: 28 } });
    const p = plan().planned;
    const seen: { url: string; ledger: LedgerEntry[] }[] = [];
    const yt = fakeYoutube((c) => { if (c.method !== "GET") seen.push({ url: c.url, ledger: fs.existsSync(ledgerFile) ? readLedger(ledgerFile).videos : [] }); return undefined; });
    const res = await runUploads({ ledgerFile, planned: p, deps: yt.deps });
    expect(res).toMatchObject({ stopped: null, warnings: [], deleteByHand: [] });
    expect(res.uploaded.map((u) => u.videoId)).toEqual(["vid_0001", "vid_0002"]);

    const [a, b] = yt.uploads();
    expect(a.status).toEqual({ privacyStatus: "private", publishAt: p[0].publishAt, selfDeclaredMadeForKids: false });
    expect(a.snippet).toMatchObject({ title: "How to crm-a", categoryId: "26", defaultLanguage: "en", tags: ["crm"] });
    expect(b.snippet.categoryId).toBe("28");
    expect(b.status.publishAt).toBe(p[1].publishAt);

    // By the time the captions of video 1 are sent, video 1 is already in the ledger; by the time video 2 starts, video 1 is complete.
    const captions1 = seen.find((s) => s.url.includes("/captions?"))!;
    expect(captions1.ledger).toMatchObject([{ helpKey: "crm-a", videoId: "vid_0001", status: "scheduled", captions: "pending", thumbnail: "pending", playlist: "pending" }]);
    const upload2 = seen.filter((s) => s.url.includes("uploadType=resumable"))[1];
    expect(upload2.ledger).toMatchObject([{ helpKey: "crm-a", captions: "ok", thumbnail: "ok", playlist: "ok" }]);

    const ledger = readLedger(ledgerFile);
    expect(ledger.channelId).toBe(DEFAULT_YOUTUBE_CHANNEL_ID);
    expect(ledger.videos[0]).toEqual({
      helpKey: "crm-a", title: "How to crm-a", videoId: "vid_0001", url: "https://www.youtube.com/watch?v=vid_0001", status: "scheduled",
      publishAt: p[0].publishAt, publishAtEastern: easternLabel(p[0].publishAt), uploadedAt: new Date(NOW).toISOString(), sha256: sha("video of crm-a"),
      captions: "ok", thumbnail: "ok", playlist: "ok",
    });
    expect(yt.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("is idempotent: a second run plans nothing and uploads nothing", async () => {
    produce("crm-a"); produce("crm-b");
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    const before = fs.readFileSync(ledgerFile, "utf8"), calls = yt.calls.length;
    const again = plan();
    expect(again.planned).toEqual([]);
    expect(again.alreadyPosted).toEqual(["crm-a", "crm-b"]);
    await runUploads({ ledgerFile, planned: again.planned, deps: yt.deps });
    // even a stale plan (made before the first run) uploads nothing the ledger already has
    fs.rmSync(ledgerFile);
    const stale = plan().planned;
    fs.writeFileSync(ledgerFile, before);
    expect((await runUploads({ ledgerFile, planned: stale, deps: yt.deps })).uploaded).toEqual([]);
    expect(yt.calls.length).toBe(calls);
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(before);
  });

  it("stops after --max uploads and carries on from there on the next run", async () => {
    ["crm-a", "crm-b", "crm-c"].forEach((k) => produce(k));
    const yt = fakeYoutube();
    const first = await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps, max: 2 });
    expect(first.uploaded).toHaveLength(2);
    expect(first.stopped).toMatch(/--max 2/);
    const rest = plan().planned;
    expect(rest.map((x) => [x.helpKey, x.date])).toEqual([["crm-c", "2026-10-10"]]);
    await runUploads({ ledgerFile, planned: rest, deps: yt.deps, max: 2 });
    expect(readLedger(ledgerFile).videos.map((v) => zoneTime(v.publishAt!).date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
  });

  it("records a refused thumbnail as a failure, a missing thumbnail file as pending, keeps the video scheduled, and --retry-thumbnails fixes both", async () => {
    produce("crm-a"); produce("crm-b", { thumbnail: false });
    let refuse = true;
    const yt = fakeYoutube((c) => (c.url.includes("/thumbnails/set") && refuse ? { status: 403, json: { error: { errors: [{ reason: "forbidden" }] } } } : undefined));
    const res = await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    expect(res.stopped).toBeNull();
    expect(res.uploaded).toHaveLength(2);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/crm-a \(vid_0001\): thumbnail failed: .*403 forbidden/);
    let v = readLedger(ledgerFile).videos;
    expect(v[0]).toMatchObject({ helpKey: "crm-a", status: "scheduled", captions: "ok", playlist: "ok" });
    expect(v[0].thumbnail).toMatch(/^failed: /);
    expect(v[1]).toMatchObject({ helpKey: "crm-b", status: "scheduled", thumbnail: "pending", playlist: "ok" });

    const sent = () => yt.calls.filter((c) => c.url.includes("/thumbnails/set")).length;
    const n = sent();
    expect(await retryThumbnails({ ledgerFile, outDirs: [out], deps: yt.deps, go: false })).toEqual([
      { helpKey: "crm-a", videoId: "vid_0001", file: path.join(out, "crm-a", "thumbnail.jpg"), result: "would try" },
      { helpKey: "crm-b", videoId: "vid_0002", file: null, result: "pending" },
    ]);
    expect(sent()).toBe(n);

    await retryThumbnails({ ledgerFile, outDirs: [out], deps: yt.deps, go: true }); // still refused
    expect(readLedger(ledgerFile).videos[0].thumbnail).toMatch(/^failed: /);
    refuse = false;
    fs.writeFileSync(path.join(out, "crm-b", "thumbnail.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const fixed = await retryThumbnails({ ledgerFile, outDirs: [out], deps: yt.deps, go: true });
    expect(fixed.map((r) => r.result)).toEqual(["ok", "ok"]);
    v = readLedger(ledgerFile).videos;
    expect(v.map((x) => x.thumbnail)).toEqual(["ok", "ok"]);
    expect(await retryThumbnails({ ledgerFile, outDirs: [out], deps: yt.deps, go: true })).toEqual([]);
    expect(yt.uploads()).toHaveLength(2);
  });

  it("ends the run on a failed upload so the next video does not jump into its day, and plans the key again", async () => {
    produce("crm-a"); produce("crm-b");
    let fail = true;
    const yt = fakeYoutube((c) => (fail && c.method === "POST" && c.url.includes("uploadType=resumable") ? { status: 400, json: { error: { errors: [{ reason: "invalidTitle" }] } } } : undefined));
    const res = await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    expect(res.uploaded).toEqual([]);
    expect(res.stopped).toMatch(/crm-a: upload failed/);
    expect(readLedger(ledgerFile).videos).toMatchObject([{ helpKey: "crm-a", status: "failed", videoId: null }]);
    fail = false;
    const again = plan().planned;
    expect(again.map((x) => [x.helpKey, x.date])).toEqual([["crm-a", "2026-10-08"], ["crm-b", "2026-10-09"]]);
    await runUploads({ ledgerFile, planned: again, deps: yt.deps });
    expect(readLedger(ledgerFile).videos.map((v) => [v.helpKey, v.status, v.videoId])).toEqual([["crm-a", "scheduled", "vid_0001"], ["crm-b", "scheduled", "vid_0002"]]);
  });

  it("stops on the daily quota without recording a failure, and refuses another channel", async () => {
    produce("crm-a");
    const quota = fakeYoutube((c) => (c.url.includes("uploadType=resumable") ? { status: 403, json: { error: { errors: [{ reason: "quotaExceeded" }] } } } : undefined));
    expect((await runUploads({ ledgerFile, planned: plan().planned, deps: quota.deps })).stopped).toMatch(/daily limit/);
    expect(fs.existsSync(ledgerFile) ? readLedger(ledgerFile).videos : []).toEqual([]);
    writeLedger(ledgerFile, { ...ledgerOf(), channelId: "UCsomeoneelse000000000000" });
    await expect(runUploads({ ledgerFile, planned: plan().planned, deps: fakeYoutube().deps })).rejects.toThrow(/ledger is for channel/);
  });
});

describe("the built description", () => {
  const describe_: Describe = (helpKey) => (helpKey === "crm-none" ? null : { title: `Built ${helpKey}`, description: `Long description of ${helpKey}`, tags: ["one", "two words"] });

  it("is what an upload sends, and the ledger keeps the text, its length, its hash and the tags", async () => {
    produce("crm-a");
    const yt = fakeYoutube();
    const res = await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps, describe: describe_ });
    expect(res.stopped).toBeNull();
    expect(yt.uploads()[0].snippet).toMatchObject({ title: "Built crm-a", description: "Long description of crm-a", tags: ["one", "two words"] });
    expect(readLedger(ledgerFile).videos[0]).toMatchObject({
      helpKey: "crm-a", title: "Built crm-a", description: "Long description of crm-a", descriptionLength: 25,
      descriptionSha256: sha("Long description of crm-a"), tags: ["one", "two words"],
    });
  });

  it("does not upload a video whose description cannot be built", async () => {
    produce("crm-none");
    const yt = fakeYoutube();
    const res = await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps, describe: describe_ });
    expect(res.stopped).toMatch(/no step script/);
    expect(yt.uploads()).toHaveLength(0);
    expect(fs.existsSync(ledgerFile)).toBe(false);
  });

  it("--update-descriptions: dry sends nothing; --go rewrites the snippet (category kept) and the ledger; the same text again is left alone", async () => {
    const at = "2026-10-08T00:08:51Z";
    writeLedger(ledgerFile, ledgerOf(published("crm-a", "vid_aaaaa", at), published("crm-b", "vid_bbbbb", at), published("crm-none", "vid_ccccc", at)));
    const yt = fakeYoutube((c) => {
      if (c.method === "GET" && c.url.includes("/videos?part=snippet&id=")) return { json: { items: [{ snippet: { title: "old", categoryId: "28", defaultLanguage: "en" } }] } };
      if (c.method === "PUT" && c.url.endsWith("/videos?part=snippet")) return { json: JSON.parse(c.body) };
      return undefined;
    });
    const dry = await updateDescriptions({ ledgerFile, describe: describe_, go: false });
    expect(dry.map((r) => [r.helpKey, r.result])).toEqual([["crm-a", "would update"], ["crm-b", "would update"], ["crm-none", "no source: no step script or narration for this key in the checkouts"]]);
    expect(dry[0]).toMatchObject({ title: "Built crm-a", oldTitle: "crm-a", length: 25, first: "Long description of crm-a", tags: 2 });
    expect(yt.calls).toHaveLength(0);
    expect(readLedger(ledgerFile).videos[0].description).toBeUndefined();

    const done = await updateDescriptions({ ledgerFile, keys: ["crm-a"], describe: describe_, deps: yt.deps, go: true });
    expect(done.map((r) => [r.helpKey, r.result])).toEqual([["crm-a", "updated"]]);
    const puts = yt.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0].body)).toEqual({ id: "vid_aaaaa", snippet: { title: "Built crm-a", description: "Long description of crm-a", categoryId: "28", tags: ["one", "two words"], defaultLanguage: "en" } });
    expect(yt.calls.every((c) => c.method === "GET" || c.method === "PUT")).toBe(true); // nothing uploaded, nothing deleted
    const a = readLedger(ledgerFile).videos.find((e) => e.helpKey === "crm-a")!;
    expect(a).toMatchObject({ title: "Built crm-a", status: "published", publishAt: "2026-10-08T00:08:51Z", descriptionLength: 25, descriptionSha256: sha("Long description of crm-a"), descriptionUpdatedAt: new Date(NOW).toISOString() });
    expect(readLedger(ledgerFile).videos.find((e) => e.helpKey === "crm-b")!.description).toBeUndefined();

    const again = await updateDescriptions({ ledgerFile, keys: ["crm-a"], describe: describe_, deps: yt.deps, go: true });
    expect(again[0].result).toBe("unchanged");
    expect(yt.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    await expect(updateDescriptions({ ledgerFile, keys: ["crm-zzz"], describe: describe_, go: false })).rejects.toThrow(/Not posted/);
  });

  it("records a refused rewrite and leaves the ledger as it was", async () => {
    writeLedger(ledgerFile, ledgerOf(published("crm-a", "vid_aaaaa", "2026-10-08T00:08:51Z")));
    const yt = fakeYoutube((c) => (c.url.includes("/videos?part=snippet") ? { status: 403, json: { error: { errors: [{ reason: "forbidden" }] } } } : undefined));
    const rows = await updateDescriptions({ ledgerFile, describe: describe_, deps: yt.deps, go: true });
    expect(rows[0].result).toMatch(/^failed: /);
    expect(readLedger(ledgerFile).videos[0].descriptionSha256).toBeUndefined();
  });
});

describe("a changed file and --replace", () => {
  it("reports a changed mp4 and does not upload it again", async () => {
    produce("crm-a");
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    produce("crm-a", { bytes: "a new cut of crm-a" });
    const p = plan();
    expect(p.planned).toEqual([]);
    expect(p.hashChanged).toEqual([{ helpKey: "crm-a", videoId: "vid_0001", uploadedSha256: sha("video of crm-a"), fileSha256: sha("a new cut of crm-a"), dir: path.join(out, "crm-a") }]);
    expect(yt.uploads()).toHaveLength(1);
  });

  it("uploads the new file to the same slot, keeps the old id for deletion by hand, and deletes nothing", async () => {
    produce("crm-a"); produce("crm-b");
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    const slot = readLedger(ledgerFile).videos[0].publishAt!;

    expect(plan({ replace: ["crm-a"] }).problems.join()).toMatch(/nothing to replace/);
    expect(plan({ replace: ["crm-nope"] }).problems.join()).toMatch(/no eligible video/);

    produce("crm-a", { bytes: "a new cut of crm-a" });
    const p = plan({ replace: ["crm-a"] });
    expect(p.planned).toMatchObject([{ helpKey: "crm-a", publishAt: slot, replaces: "vid_0001" }]);
    const res = await runUploads({ ledgerFile, planned: p.planned, deps: yt.deps });
    expect(res.uploaded).toEqual([{ helpKey: "crm-a", videoId: "vid_0003", publishAt: slot }]);
    expect(res.deleteByHand).toEqual([{ helpKey: "crm-a", videoId: "vid_0001", url: "https://www.youtube.com/watch?v=vid_0001", stillScheduledFor: slot }]);
    const v = readLedger(ledgerFile).videos;
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ helpKey: "crm-a", videoId: "vid_0003", publishAt: slot, sha256: sha("a new cut of crm-a"), status: "scheduled" });
    expect(v[0].replaced).toEqual([{ videoId: "vid_0001", url: "https://www.youtube.com/watch?v=vid_0001", sha256: sha("video of crm-a"), replacedAt: new Date(NOW).toISOString() }]);
    expect(v[0].note).toMatch(/delete it by hand/);
    expect(v[1]).toMatchObject({ helpKey: "crm-b", videoId: "vid_0002" });
    expect(yt.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(plan({ replace: [] }).planned).toEqual([]);
  });

  it("gives a replacement of an already-published video the next free day", () => {
    produce("crm-a", { bytes: "a new cut" });
    writeLedger(ledgerFile, ledgerOf(published("crm-a", "old_00001", "2026-10-08T00:08:00Z", { sha256: sha("the first cut") })));
    expect(plan({ replace: ["crm-a"] }).planned).toMatchObject([{ helpKey: "crm-a", date: "2026-10-08", replaces: "old_00001" }]);
  });
});

describe("a re-recorded in-app video (the merged master changed)", () => {
  const merged = (o: Partial<Parameters<typeof planSchedule>[0]> = {}) => plan({ manifestSha: manifestShaIn(manifests), ...o });
  /** A producer re-records: a new mp4 in a NEW out-dir (the old one is still on disk), and the manifest now names the new file. */
  const rerecord = (helpKey: string, bytes: string, o: { withFile?: boolean } = {}) => {
    if (o.withFile !== false) produce(helpKey, { bytes, merged: false, dir: path.join(path.dirname(out), "video-out-2") });
    fs.writeFileSync(path.join(manifests, `${helpKey}.json`), JSON.stringify({ helpKey, video: { sha256: sha(bytes) } }));
  };
  const dirs = () => [out, path.join(path.dirname(out), "video-out-2")];
  const found = () => findCandidates(dirs(), manifests).eligible;

  it("says so in the dry run for a video that is scheduled and not out yet — and uploads nothing by itself", async () => {
    produce("crm-a"); produce("crm-b");
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    expect(merged().masterChanged).toEqual([]);
    const before = fs.readFileSync(ledgerFile, "utf8"), slot = readLedger(ledgerFile).videos[0].publishAt!;

    rerecord("crm-a", "crm-a, recorded again");
    const p = merged({ candidates: found() });
    expect(p.planned).toEqual([]);
    expect(p.masterChanged).toEqual([{ helpKey: "crm-a", videoId: "vid_0001", status: "scheduled", pending: true, publishAt: slot, uploadedSha256: sha("video of crm-a"), manifestSha256: sha("crm-a, recorded again"), fileReady: true }]);
    expect(p.hashChanged).toEqual([]); // said once, not twice
    const [line] = masterChangedLines(p);
    expect(line).toMatch(/^!!!! crm-a: master changed since upload — run --replace crm-a \(vid_0001 is STILL SCHEDULED for /);
    expect(line).toContain(easternLabel(slot));
    expect(line).not.toMatch(/not in the out-dirs/);
    expect(yt.uploads()).toHaveLength(2);
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(before);
  });

  it("tells a public video from a pending one, and says when the new master is not on this machine", async () => {
    produce("crm-a");
    writeLedger(ledgerFile, ledgerOf(published("crm-a", "pub_00001", "2026-10-07T13:00:00Z", { sha256: sha("video of crm-a") })));
    rerecord("crm-a", "crm-a, recorded again", { withFile: false });
    const p = merged();
    expect(p.masterChanged).toMatchObject([{ helpKey: "crm-a", videoId: "pub_00001", status: "published", pending: false, fileReady: false }]);
    expect(masterChangedLines(p)[0]).toMatch(/^! crm-a: master changed since upload — run --replace crm-a \(pub_00001 is public with the old cut.*not in the out-dirs yet/);
    // --replace with only the OLD file on disk must not put the old cut up again, nor any file that is not the merged master.
    const r = merged({ replace: ["crm-a"] });
    expect(r.planned).toEqual([]);
    expect(r.problems.join("\n")).toMatch(/--replace crm-a: the mp4 in .* is not the merged master/);
  });

  it("says nothing for a video that is not in the ledger: a held or unscheduled video simply takes the new master", () => {
    produce("crm-a"); produce("brand-film");
    rerecord("crm-a", "crm-a, recorded again"); rerecord("brand-film", "the film, recorded again");
    const p = merged({ candidates: found(), held: ["brand-film"] });
    expect(p.masterChanged).toEqual([]);
    expect(p.held).toEqual(["brand-film"]);
    expect(p.planned.map((x) => [x.helpKey, x.candidate.sha256])).toEqual([["crm-a", sha("crm-a, recorded again")]]);
  });

  it("--replace, end to end: the new master goes into the same slot with captions, thumbnail and playlist; the old id is named; nothing is deleted", async () => {
    produce("crm-a"); produce("crm-b");
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: plan().planned, deps: yt.deps });
    const [a0, b0] = readLedger(ledgerFile).videos;
    rerecord("crm-a", "crm-a, recorded again");

    const p = merged({ candidates: found(), replace: ["crm-a"] });
    expect(p.masterChanged).toEqual([]); // being dealt with by this very run
    expect(p.problems).toEqual([]);
    expect(p.planned).toMatchObject([{ helpKey: "crm-a", publishAt: a0.publishAt, replaces: "vid_0001", candidate: { sha256: sha("crm-a, recorded again"), dir: path.join(path.dirname(out), "video-out-2", "crm-a") } }]);
    const from = yt.calls.length;
    const res = await runUploads({ ledgerFile, planned: p.planned, deps: yt.deps });
    expect(res).toMatchObject({ stopped: null, warnings: [], uploaded: [{ helpKey: "crm-a", videoId: "vid_0003", publishAt: a0.publishAt }] });
    expect(res.deleteByHand).toEqual([{ helpKey: "crm-a", videoId: "vid_0001", url: "https://www.youtube.com/watch?v=vid_0001", stillScheduledFor: a0.publishAt }]);

    // What went over the wire for the replacement: an upload (private, the same publish time), its bytes, captions, thumbnail, playlist — and that is all.
    const sent = yt.calls.slice(from);
    expect(JSON.parse(sent.find((c) => c.url.includes("uploadType=resumable"))!.body).status).toMatchObject({ privacyStatus: "private", publishAt: a0.publishAt });
    expect(sent.some((c) => c.method === "PUT" && c.url.includes("upload_id="))).toBe(true);
    expect(sent.filter((c) => c.url.includes("/captions?"))).toHaveLength(1);
    expect(sent.filter((c) => c.url.includes("/thumbnails/set"))).toHaveLength(1);
    expect(sent.filter((c) => c.method === "POST" && c.url.includes("/playlistItems?"))).toHaveLength(1);
    // Nothing is ever deleted or changed on the old video: no DELETE anywhere, and no request names vid_0001.
    expect(yt.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(sent.some((c) => c.url.includes("vid_0001") || String(c.body ?? "").includes("vid_0001"))).toBe(false);

    const v = readLedger(ledgerFile).videos;
    expect(v).toHaveLength(2);
    expect(v.find((e) => e.helpKey === "crm-a")).toMatchObject({ videoId: "vid_0003", status: "scheduled", publishAt: a0.publishAt, sha256: sha("crm-a, recorded again"), captions: "ok", thumbnail: "ok", playlist: "ok",
      replaced: [{ videoId: "vid_0001", url: "https://www.youtube.com/watch?v=vid_0001", sha256: sha("video of crm-a") }] });
    expect(v.find((e) => e.helpKey === "crm-a")!.note).toMatch(/vid_0001.*STILL SCHEDULED.*delete it by hand/);
    expect(v.find((e) => e.helpKey === "crm-b")).toEqual(b0); // the neighbour is untouched

    // Afterwards the plan is quiet, and running --replace again does nothing.
    const again = merged({ candidates: found(), replace: ["crm-a"] });
    expect(again.planned).toEqual([]);
    expect(again.problems.join()).toMatch(/nothing to replace/);
    expect(merged({ candidates: found() })).toMatchObject({ planned: [], masterChanged: [], hashChanged: [] });
    expect(yt.uploads()).toHaveLength(3);
  });
});

describe("held for owner approval", () => {
  it("never plans a held video — first upload or replacement — until it is released, and says which are held", async () => {
    produce("crm-a"); produce("brand-film");
    const p = plan({ held: ["brand-film", "brand-not-made-yet"] });
    expect(p.planned.map((x) => x.helpKey)).toEqual(["crm-a"]);
    expect(p.held).toEqual(["brand-film"]);
    const yt = fakeYoutube();
    await runUploads({ ledgerFile, planned: p.planned, deps: yt.deps });
    expect(readLedger(ledgerFile).videos.map((e) => e.helpKey)).toEqual(["crm-a"]);

    const released = plan({ held: ["brand-film"], release: ["brand-film"] });
    expect(released.held).toEqual([]);
    expect(released.planned.map((x) => x.helpKey)).toEqual(["brand-film"]);
    expect(plan({ release: ["crm-a"] }).problems.join()).toMatch(/--release crm-a: that key is not held/);

    // Once the owner has released it and it is up, a new cut is held again.
    await runUploads({ ledgerFile, planned: released.planned, deps: yt.deps });
    produce("brand-film", { bytes: "a new cut of the film" });
    const again = plan({ held: ["brand-film"], replace: ["brand-film"] });
    expect(again.planned).toEqual([]);
    expect(again.held).toEqual(["brand-film"]);
    expect(again.problems.join()).toMatch(/--replace brand-film: held for owner approval — add --release brand-film/);
    expect(plan({ held: ["brand-film"], replace: ["brand-film"], release: ["brand-film"] }).planned).toMatchObject([{ helpKey: "brand-film", replaces: "vid_0002" }]);
    expect(yt.uploads()).toHaveLength(2);
  });

  it("the registry holds both overview films, and nothing else", async () => {
    const { heldHelpKeys, helpEntry } = await import("../../shared/help/registry");
    expect(heldHelpKeys().sort()).toEqual(["brand-tour-crm", "brand-vs-housecall-pro", "brand-vs-jobber", "brand-vs-leap", "brand-what-is-constructhub", "brand-why-constructhub"]);
    // …and the named comparisons are not in the app at all until they are released.
    const { HELP_FEATURES } = await import("../../shared/help/registry");
    expect(HELP_FEATURES.filter((f) => f.key.startsWith("brand-vs-")).map((f) => f.key)).toEqual([]);
    for (const k of ["brand-vs-housecall-pro", "brand-vs-jobber", "brand-vs-leap"]) { expect(helpEntry(k)!.unlisted, k).toBe(true); expect(helpEntry(k)!.video, `${k} has no manifest in the app`).toBeNull(); }
    for (const k of heldHelpKeys()) expect(helpEntry(k)!.group).toBe("Start here");
  });
});

describe("reconcile", () => {
  const item = (status: Record<string, unknown>, snippet: Record<string, unknown> = {}) =>
    ({ json: { items: [{ status: { uploadStatus: "processed", ...status }, snippet: { title: "T", publishedAt: "2026-10-07T12:00:00Z", thumbnails: { default: {}, maxres: {} }, ...snippet }, processingDetails: { processingStatus: "succeeded" } }] } });
  const past = "2026-10-07T13:00:00Z", future = zonedToUtc("2026-10-09", "09:00").toISOString().replace(".000Z", "Z");
  const scheduled = (k: string, id: string, at: string) => published(k, id, at, { status: "scheduled" });

  it("reads each video's real state and brings the ledger in line", async () => {
    writeLedger(ledgerFile, ledgerOf(
      scheduled("went-out", "vid_public", past), scheduled("waiting", "vid_waiting", future), scheduled("gone", "vid_gone00", future),
      scheduled("stuck", "vid_stuck0", past), scheduled("moved", "vid_moved0", future), published("live", "vid_live00", past),
    ));
    const answers: Record<string, any> = {
      vid_public: item({ privacyStatus: "public" }), vid_waiting: item({ privacyStatus: "private", publishAt: future }), vid_gone00: { json: { items: [] } },
      vid_stuck0: item({ privacyStatus: "private" }), vid_moved0: item({ privacyStatus: "private", publishAt: "2026-10-10T16:00:00Z" }), vid_live00: item({ privacyStatus: "public" }),
    };
    const yt = fakeYoutube((c) => answers[new URL(c.url).searchParams.get("id") ?? ""]);
    const before = fs.readFileSync(ledgerFile, "utf8");
    const dry = await reconcile({ ledgerFile, deps: yt.deps, write: false });
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(before);
    expect(yt.calls.every((c) => c.method === "GET" && c.url.includes("/videos?part=status%2Csnippet%2CprocessingDetails&id="))).toBe(true);
    const of = (k: string) => dry.find((r) => r.helpKey === k)!;
    expect(of("went-out")).toMatchObject({ status: "published", loud: false, verdict: "published (was scheduled)" });
    expect(of("waiting")).toMatchObject({ status: "scheduled", loud: false, verdict: "still scheduled" });
    expect(of("gone")).toMatchObject({ status: "failed", loud: true });
    expect(of("gone").verdict).toMatch(/MISSING/);
    expect(of("stuck")).toMatchObject({ status: "failed", loud: true });
    expect(of("stuck").verdict).toMatch(/LOCKED PRIVATE/);
    expect(of("moved").loud).toBe(true);
    expect(of("live")).toMatchObject({ status: "published", loud: false, verdict: "published" });
    expect(of("live").youtube).toMatchObject({ privacyStatus: "public", processingStatus: "succeeded", thumbnailSizes: ["default", "maxres"] });

    await reconcile({ ledgerFile, deps: yt.deps, write: true });
    const v = Object.fromEntries(readLedger(ledgerFile).videos.map((e) => [e.helpKey, e]));
    expect(v["went-out"].status).toBe("published");
    expect(v.waiting).toMatchObject({ status: "scheduled", publishAt: future });
    expect(v.gone.status).toBe("failed");
    expect(v.stuck.note).toMatch(/LOCKED PRIVATE/);
    expect(v.moved).toMatchObject({ status: "scheduled", publishAt: "2026-10-10T16:00:00Z", publishAtEastern: "2026-10-10 12:00 EDT (Saturday)" });
    expect(v.live.checkedAt).toBe(new Date(NOW).toISOString());
    // a missing video is never re-uploaded on its own: its key stays taken
    produce("gone");
    expect(plan().planned).toEqual([]);
  });

  it("waits out the first half hour after a publish time, and flags a schedule that was removed", async () => {
    writeLedger(ledgerFile, ledgerOf(scheduled("just-due", "vid_due000", new Date(NOW - 10 * 60_000).toISOString()), scheduled("unscheduled", "vid_unsch0", future)));
    const yt = fakeYoutube(() => item({ privacyStatus: "private" }));
    const rows = await reconcile({ ledgerFile, deps: yt.deps, write: true });
    expect(rows[0]).toMatchObject({ helpKey: "just-due", status: "scheduled", loud: false });
    expect(rows[1]).toMatchObject({ helpKey: "unscheduled", status: "scheduled", loud: true });
    expect(rows[1].verdict).toMatch(/NO SCHEDULE/);
  });
});

describe("the calendar", () => {
  it("lists what is posted and what is planned, in Eastern time", () => {
    produce("crm-a");
    const ledger = ledgerOf(published("database-directory", "AOXDXMcGM_I", "2026-10-08T00:08:00Z", { title: "Find a permit | office" }));
    const md = calendarMarkdown(ledger, plan({ ledger }).planned, "America/New_York", new Date(NOW));
    expect(md).toContain("| **2026-10-07** | Wednesday | 20:08 EDT | Find a permit \\| office | [AOXDXMcGM_I](https://www.youtube.com/watch?v=AOXDXMcGM_I) | published |");
    expect(md).toMatch(/\| \*\*2026-10-08\*\* \| Thursday \| \d\d:\d\d EDT \| How to crm-a \| — \| planned \(not uploaded yet\) \|/);
    produce("crm-b"); produce("crm-c"); produce("crm-d");
    const three = calendarMarkdown(ledgerOf(), plan({ ledger: ledgerOf(), perDay: 3 }).planned, "America/New_York", new Date(NOW)).split("\n").filter((l) => l.includes("How to"));
    expect(three.map((l) => l.split("|")[1].trim())).toEqual(["**2026-10-08**", "", "", "**2026-10-09**"]); // all three of a day, the date once
  });
});
