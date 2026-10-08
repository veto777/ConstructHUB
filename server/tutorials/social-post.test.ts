import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  BLOTATO_BASE, DENYLIST, buildPost, checkAccounts, emptyLedger, followYouTube, listAccounts, looksLikeConstructHub, parseAllowlist, parsePageIds, planPosts, reconcilePosts,
  redact, sendPosts, type BlotatoAccount, type Fetch, type Io, type LedgerPost, type SocialLedger, type Target, type VideoForPost,
} from "../../scripts/tutorials/social-post-lib";
import { zoneTime } from "../youtube/schedule";

/**
 * The cross-poster (scripts/tutorials/social-post.ts): who it may post to, when, and that it can
 * never post twice or leak its key. Blotato is a mock here — no request leaves the test.
 */
const KEY = "blt_SECRET_key_0123456789abcdef";
/** The workspace as Blotato listed it on 2026-10-08. */
const ACCOUNTS: BlotatoAccount[] = [
  { id: "43689", platform: "facebook", username: "", fullname: "Veto Creed" },
  { id: "45119", platform: "youtube", username: "", fullname: "Bud Smith (Voiceban )" },
  { id: "52703", platform: "youtube", username: "", fullname: "Construct HUB (Construct HUB)" },
  { id: "76607", platform: "instagram", username: "constructhubapp", fullname: "" },
  { id: "61953", platform: "instagram", username: "voicebanapp", fullname: "" },
  { id: "38445", platform: "linkedin", username: "", fullname: "Construct HUB" },
  { id: "30778", platform: "linkedin", username: "", fullname: "Veto Kravchenko" },
  { id: "8451", platform: "threads", username: "voicebanapp", fullname: "" },
  { id: "63054", platform: "tiktok", username: "construct.hub", fullname: "" },
  { id: "53357", platform: "tiktok", username: "voiceban_", fullname: "" },
  { id: "50595", platform: "tiktok", username: "triplegpodcast", fullname: "" },
  { id: "23269", platform: "twitter", username: "voicebannetwork", fullname: "" },
  { id: "90001", platform: "facebook", username: "", fullname: "ConstructHUB" },
  { id: "90002", platform: "instagram", username: "builder_tips", fullname: "" },
];
const OURS = ["76607", "38445", "63054"];
const targets = (): Target[] => checkAccounts({ allow: OURS, accounts: ACCOUNTS });
const media = (name: string) => ({ url: `https://constructhub.us/api/tutorials/media/${name}`, sha256: "ab".repeat(32), coverUrl: null as string | null, coverMs: null as number | null });
const video = (helpKey: string, publishAt: string): VideoForPost => ({
  helpKey, publishAt,
  posts: {
    instagram: { text: `${helpKey} on Instagram #contractors`, cut: "vertical.mp4", media: { ...media(`${helpKey}.social-vertical.0000aaaa.mp4`), coverUrl: `https://constructhub.us/api/tutorials/media/${helpKey}.social-cover-vertical.0000bbbb.jpg` } },
    tiktok: { text: `${helpKey} on TikTok`, cut: "vertical-tiktok.mp4", media: { ...media(`${helpKey}.social-tiktok.0000cccc.mp4`), coverMs: 200 } },
    linkedin: { text: `${helpKey} on LinkedIn https://constructhub.us/tutorials`, cut: "feed.mp4", media: media(`${helpKey}.social-feed.0000dddd.mp4`) },
  },
});
const FOUR = [video("database-directory", "2026-10-07T22:38:22.000Z"), video("crm-clients", "2026-10-08T00:08:51.000Z"), video("crm-create-estimate", "2026-10-08T00:08:51.000Z"), video("crm-schedule", "2026-10-08T00:09:03.000Z")];

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
function mockIo(answer: (c: Call, n: number) => { status: number; body: unknown } | Error, at = "2026-10-08T14:00:00.000Z") {
  const calls: Call[] = [], logs: string[] = [], sleeps: number[] = [];
  const fetch: Fetch = async (url, init) => {
    const c: Call = { method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const a = answer(c, calls.length);
    if (a instanceof Error) throw a;
    return { status: a.status, text: async () => (typeof a.body === "string" ? a.body : JSON.stringify(a.body)) };
  };
  const io: Io = { fetch, sleep: async (ms) => { sleeps.push(ms); }, now: () => new Date(at), log: (l) => logs.push(l) };
  return { io, calls, logs, sleeps };
}

describe("who may be posted to", () => {
  it("refuses an empty allowlist before anything else", () => {
    for (const empty of [undefined, null, "", " ", ",", " , "]) expect(() => parseAllowlist(empty)).toThrow(/TUTORIAL_BLOTATO_ACCOUNT_IDS is empty/);
    expect(parseAllowlist(" 76607, 38445,63054,76607 ")).toEqual(OURS);
    expect(() => parseAllowlist("76607,abc")).toThrow(/not an account id/);
    expect(() => checkAccounts({ allow: [], accounts: ACCOUNTS })).toThrow(/empty/);
  });
  it("accepts ConstructHUB's own three accounts — by username or, when Blotato gives none, by full name", () => {
    expect(targets()).toEqual([
      { id: "76607", platform: "instagram", name: "constructhubapp", pageId: null },
      { id: "38445", platform: "linkedin", name: "Construct HUB", pageId: null },
      { id: "63054", platform: "tiktok", name: "construct.hub", pageId: null },
    ]);
    for (const yes of ["constructhubapp", "Construct HUB", "construct.hub", "CHUB tips", "ConStruct_Hub"]) expect(looksLikeConstructHub(yes), yes).toBe(true);
    for (const no of ["voicebanapp", "Veto Kravchenko", "triplegpodcast", "", null, "Veto Creed", "hub"]) expect(looksLikeConstructHub(no), String(no)).toBe(false);
  });
  it("never posts to another brand's account, even when a typo puts its id in the allowlist — no flag lifts it", () => {
    expect(Object.keys(DENYLIST).sort()).toEqual(["23269", "30778", "43689", "45119", "50595", "52703", "53357", "61953", "8451"]);
    for (const id of Object.keys(DENYLIST)) {
      expect(() => checkAccounts({ allow: [...OURS, id], accounts: ACCOUNTS }), id).toThrow(new RegExp(`REFUSING TO POST[\\s\\S]*${id}[\\s\\S]*denylist`));
      expect(() => checkAccounts({ allow: [id], accounts: ACCOUNTS, iChecked: [id] }), id).toThrow(/denylist/);
    }
    // Our own YouTube channel looks like ConstructHUB and is still refused: YouTube goes through our own scheduler.
    expect(() => checkAccounts({ allow: ["52703"], accounts: ACCOUNTS })).toThrow(/YouTube/);
  });
  it("refuses an id Blotato does not have, a name that is not ours (unless --i-checked), and a Facebook account without its Page", () => {
    expect(() => checkAccounts({ allow: [...OURS, "12345"], accounts: ACCOUNTS })).toThrow(/12345 is not an account of this Blotato workspace/);
    expect(() => checkAccounts({ allow: ["90002"], accounts: ACCOUNTS })).toThrow(/does not look like a ConstructHUB account[\s\S]*--i-checked 90002/);
    expect(checkAccounts({ allow: ["90002"], accounts: ACCOUNTS, iChecked: ["90002"] })[0].id).toBe("90002");
    expect(() => checkAccounts({ allow: ["90001"], accounts: ACCOUNTS })).toThrow(/needs its Page id/);
    expect(checkAccounts({ allow: ["90001"], accounts: ACCOUNTS, pageIds: parsePageIds("90001:1122334455") })[0].pageId).toBe("1122334455");
    expect(() => parsePageIds("90001")).toThrow(/accountId:pageId/);
  });
});

describe("what is sent", () => {
  const [ig, li, tk] = targets();
  it("builds Blotato's request: the schedule time beside `post`, the cover where the platform takes one", () => {
    const v = FOUR[1];
    const a = buildPost(ig, v.posts.instagram!.text, v.posts.instagram!.media, "2026-10-08T15:00:00.000Z");
    expect(a).toEqual({
      post: { accountId: "76607", content: { text: v.posts.instagram!.text, mediaUrls: [v.posts.instagram!.media.url], platform: "instagram" }, target: { targetType: "instagram", mediaType: "reel", shareToFeed: true, coverImageUrl: v.posts.instagram!.media.coverUrl } },
      scheduledTime: "2026-10-08T15:00:00.000Z",
    });
    expect(buildPost(li, "x", v.posts.linkedin!.media)).toEqual({ post: { accountId: "38445", content: { text: "x", mediaUrls: [v.posts.linkedin!.media.url], platform: "linkedin" }, target: { targetType: "linkedin" } } });
  });
  it("sets every field TikTok requires, truthfully: public, our own brand, synthetic narration disclosed", () => {
    expect(buildPost(tk, "x", FOUR[0].posts.tiktok!.media).post.target).toEqual({
      targetType: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", disabledComments: false, disabledDuet: false, disabledStitch: false,
      isBrandedContent: false, isYourBrand: true, isAiGenerated: true, videoCoverTimestamp: 200,
    });
  });
  it("refuses media that is not served from constructhub.us and text over the platform's limit", () => {
    expect(() => buildPost(ig, "x", { url: "https://example.com/a.mp4" })).toThrow(/constructhub\.us/);
    expect(() => buildPost(ig, "x".repeat(2201), FOUR[0].posts.instagram!.media)).toThrow(/2200/);
  });
});

describe("when", () => {
  const eastern = (d: Date) => zoneTime(d);
  it("puts a Shorts-style post 30–90 minutes after YouTube, the same Eastern day, at a minute that never changes", () => {
    for (const key of ["a", "crm-clients", "crm-home", "zz"]) {
      const yt = "2026-10-12T13:00:00.000Z" /* Monday 09:00 EDT */, at = followYouTube(yt, "instagram", key, "76607");
      const mins = (at.getTime() - Date.parse(yt)) / 60000;
      expect(mins).toBeGreaterThanOrEqual(30);
      expect(mins).toBeLessThanOrEqual(90);
      expect(followYouTube(yt, "instagram", key, "76607").getTime()).toBe(at.getTime());
    }
    expect(new Set(["a", "b", "c", "d", "e", "f"].map((k) => followYouTube("2026-10-12T13:00:00.000Z", "tiktok", k, "63054").getTime())).size).toBeGreaterThan(3);
    // A video that goes public at 23:20 Eastern keeps its post on that day.
    const late = followYouTube("2026-10-13T03:20:00.000Z", "tiktok", "crm-home", "63054");
    expect(eastern(late).date).toBe("2026-10-12");
  });
  it("keeps LinkedIn to weekday business hours and moves a weekend post to Monday morning", () => {
    const inHours = followYouTube("2026-10-12T16:00:00.000Z", "linkedin", "crm-home", "38445"); // Monday 12:00 EDT
    expect(eastern(inHours)).toMatchObject({ date: "2026-10-12", weekday: "Monday" });
    expect((inHours.getTime() - Date.parse("2026-10-12T16:00:00.000Z")) / 60000).toBeGreaterThanOrEqual(30);
    const early = eastern(followYouTube("2026-10-12T10:00:00.000Z", "linkedin", "crm-home", "38445")); // Monday 06:00 EDT
    expect(early.date).toBe("2026-10-12"); expect(early.time >= "09:00" && early.time <= "10:59").toBe(true);
    const evening = eastern(followYouTube("2026-10-12T23:30:00.000Z", "linkedin", "crm-home", "38445")); // Monday 19:30 EDT
    expect(evening).toMatchObject({ date: "2026-10-13", weekday: "Tuesday" }); expect(evening.time >= "09:00" && evening.time <= "10:59").toBe(true);
    for (const sat of ["2026-10-10T13:00:00.000Z", "2026-10-11T18:00:00.000Z", "2026-10-09T23:30:00.000Z" /* Friday evening */]) {
      const z = eastern(followYouTube(sat, "linkedin", "crm-home", "38445"));
      expect(z, sat).toMatchObject({ date: "2026-10-12", weekday: "Monday" });
      expect(z.time >= "09:00" && z.time <= "10:59", sat).toBe(true);
    }
    // After the clocks go back (1 November 2026) nine o'clock is still nine o'clock Eastern.
    expect(eastern(followYouTube("2026-10-31T15:00:00.000Z", "linkedin", "crm-home", "38445"))).toMatchObject({ date: "2026-11-02", abbr: "EST" });
  });
  it("starts new accounts gently: one post per account per day for 14 days, then three", () => {
    const now = new Date("2026-10-08T14:00:00.000Z"), { planned } = planPosts(FOUR, targets(), emptyLedger(), { now });
    expect(planned.length).toBe(12);
    for (const t of targets()) {
      const days = planned.filter((p) => p.target.id === t.id).map((p) => eastern(p.at).date);
      expect(new Set(days).size, t.platform).toBe(4);
      if (t.platform === "linkedin") for (const p of planned.filter((x) => x.target.id === t.id)) expect(["Saturday", "Sunday"]).not.toContain(eastern(p.at).weekday);
    }
    // Twenty videos scheduled over the coming weeks: at most one a day inside the warm-up, up to three after it.
    const many = Array.from({ length: 20 }, (_x, i) => video(`crm-v${i}`, new Date(Date.parse("2026-10-20T13:00:00Z") + Math.floor(i / 4) * 86400000 + i * 600000).toISOString()));
    const per = new Map<string, number>();
    for (const p of planPosts(many, [targets()[0]], emptyLedger(), { now, warmupStart: "2026-10-08" }).planned) per.set(eastern(p.at).date, (per.get(eastern(p.at).date) ?? 0) + 1);
    for (const [date, n] of per) expect(n, date).toBeLessThanOrEqual(date < "2026-10-22" ? 1 : 3);
    expect(Math.max(...per.values())).toBe(3);
  });
  it("--spread: the first post now, the next ones 30–45 minutes apart per account, accounts a few minutes apart", () => {
    const now = new Date("2026-10-08T14:00:00.000Z"), { planned } = planPosts(FOUR, targets(), emptyLedger(), { now, spreadMin: 30, perDay: 4 });
    expect(planned.length).toBe(12);
    const first = planned[0];
    expect(first.immediate).toBe(true);
    expect(first.body.scheduledTime).toBeUndefined();
    expect(first.target.id).toBe("76607");
    const starts: number[] = [];
    for (const t of targets()) {
      const mine = planned.filter((p) => p.target.id === t.id);
      expect(mine.map((p) => p.helpKey)).toEqual(["database-directory", "crm-clients", "crm-create-estimate", "crm-schedule"]); // YouTube's order
      starts.push(mine[0].at.getTime());
      for (let i = 1; i < mine.length; i++) {
        const gap = (mine[i].at.getTime() - mine[i - 1].at.getTime()) / 60000;
        // LinkedIn takes three posts in 24 hours from an unverified profile (social-rate.ts, learned 2026-10-08):
        // its fourth waits until the first is a day old.
        if (t.platform === "linkedin" && i === 3) { expect(mine[3].at.getTime() - mine[0].at.getTime()).toBeGreaterThanOrEqual(24 * 3600000); continue; }
        expect(gap).toBeGreaterThanOrEqual(30); expect(gap).toBeLessThanOrEqual(45);
        expect(mine[i].body.scheduledTime).toBe(mine[i].at.toISOString());
        expect(mine[i].immediate).toBe(false);
      }
    }
    expect((starts[1] - starts[0]) / 60000).toBeGreaterThanOrEqual(3);
    expect((starts[2] - starts[1]) / 60000).toBeGreaterThanOrEqual(3);
    expect((starts[2] - starts[0]) / 60000).toBeLessThanOrEqual(12);
    // Without --per-day the warm-up cap still holds: one today, the rest on the following days.
    const capped = planPosts(FOUR, [targets()[0]], emptyLedger(), { now, spreadMin: 30 }).planned;
    expect(new Set(capped.map((p) => eastern(p.at).date)).size).toBe(4);
  });
});

const entry = (p: Partial<LedgerPost>): LedgerPost => ({
  helpKey: "crm-clients", accountId: "76607", platform: "instagram", account: "constructhubapp", cut: "vertical.mp4", mediaUrl: "https://constructhub.us/x", mediaSha256: "", textSha256: "", textLength: 1,
  scheduledTime: "2026-10-08T15:00:00.000Z", scheduledEastern: "", status: "scheduled", postSubmissionId: "sub-1", createdAt: "2026-10-08T14:00:00.000Z", ...p,
});

describe("never twice", () => {
  const now = new Date("2026-10-08T14:00:00.000Z");
  it("does not plan a video an account already has — scheduled, published, in progress, or of unknown outcome", () => {
    for (const status of ["scheduled", "published", "in-progress", "sending"] as const) {
      const ledger: SocialLedger = { ...emptyLedger(), posts: [entry({ status, postSubmissionId: status === "sending" ? null : "sub-1" })] };
      const { planned, skipped } = planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 9 });
      expect(planned.length, status).toBe(11);
      expect(planned.some((p) => p.helpKey === "crm-clients" && p.target.id === "76607"), status).toBe(false);
      expect(skipped.find((s) => s.helpKey === "crm-clients" && s.accountId === "76607")!.reason, status).toMatch(status === "sending" ? /outcome was never recorded/ : new RegExp(`already ${status}`));
    }
  });
  it("retries a failure Blotato reported only when asked", () => {
    const ledger: SocialLedger = { ...emptyLedger(), posts: [entry({ status: "failed", errorMessage: "Unsupported media type" })] };
    expect(planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 9 }).planned.length).toBe(11);
    expect(planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 9 }).skipped[0].reason).toMatch(/failed before \(Unsupported media type\).*--retry-failed/);
    expect(planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 9, retryFailed: true }).planned.length).toBe(12);
  });
  it("creates each post once, records it before and after the request, and a second run sends nothing", async () => {
    const ledger = emptyLedger(), saved: SocialLedger[] = [];
    const save = (l: SocialLedger) => saved.push(JSON.parse(JSON.stringify(l)));
    let n = 0;
    const m = mockIo((c) => {
      expect(c.url).toBe(`${BLOTATO_BASE}/posts`);
      // The ledger already holds this post, as `sending`, when the request leaves.
      expect(saved[saved.length - 1].posts.find((p) => p.helpKey === c.body.post.content.text.split(" ")[0] && p.accountId === c.body.post.accountId)!.status).toBe("sending");
      return { status: 201, body: { postSubmissionId: `sub-${++n}`, ...(c.body.scheduledTime ? { scheduledTime: c.body.scheduledTime } : {}) } };
    });
    const { planned } = planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 4 });
    const r = await sendPosts({ planned, ledger, save, key: KEY, io: m.io, allow: OURS });
    expect(r).toEqual({ sent: 12, failed: 0 });
    expect(m.calls.length).toBe(12);
    expect(m.calls.every((c) => c.method === "POST" && c.headers["blotato-api-key"] === KEY && OURS.includes(c.body.post.accountId))).toBe(true);
    expect(new Set(m.calls.map((c) => `${c.body.post.accountId}:${c.body.post.content.mediaUrls[0]}`)).size).toBe(12);
    expect(ledger.posts.map((p) => p.status).sort()).toEqual([...Array(1).fill("in-progress"), ...Array(11).fill("scheduled")]);
    expect(m.sleeps.filter((s) => s >= 6000).length).toBe(11); // never faster than one creation every six seconds
    // Again, with the ledger as it now is: nothing to plan, nothing sent.
    const again = planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 4 });
    expect(again.planned).toEqual([]);
    expect(again.skipped.length).toBe(12);
    const m2 = mockIo(() => { throw new Error("no request may be made"); });
    expect(await sendPosts({ planned, ledger, save, key: KEY, io: m2.io, allow: OURS })).toEqual({ sent: 0, failed: 0 });
    expect(m2.calls.length).toBe(0);
  });
  it("stops, and never re-sends, when a request left and no answer came back", async () => {
    const ledger = emptyLedger(), save = () => {};
    const m = mockIo((_c, i) => (i === 2 ? new Error(`socket hang up (key ${KEY})`) : { status: 201, body: { postSubmissionId: `sub-${i}` } }));
    const { planned } = planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 4 });
    await expect(sendPosts({ planned, ledger, save, key: KEY, io: m.io, allow: OURS })).rejects.toThrow(/outcome of .* is unknown/);
    expect(m.calls.length).toBe(2);
    expect(ledger.posts.map((p) => p.status)).toEqual([expect.stringMatching(/in-progress|scheduled/), "sending"]);
    const next = planPosts(FOUR, targets(), ledger, { now, spreadMin: 30, perDay: 4 });
    expect(next.planned.length).toBe(10);
    expect(next.skipped.some((s) => /check Blotato by hand/.test(s.reason))).toBe(true);
    expect(JSON.stringify(ledger) + m.logs.join("\n")).not.toContain(KEY);
  });
  it("waits out a 429 (nothing was created) and records a refusal as failed", async () => {
    const ledger = emptyLedger();
    const m = mockIo((_c, i) => (i === 1 ? { status: 429, body: { statusCode: 429, message: "Rate limit exceeded, retry in 49 seconds" } } : i === 3 ? { status: 422, body: { message: `Account not found for key ${KEY}` } } : { status: 201, body: { postSubmissionId: `s${i}` } }));
    const { planned } = planPosts(FOUR.slice(0, 2), [targets()[0]], ledger, { now, spreadMin: 30, perDay: 4 });
    const r = await sendPosts({ planned, ledger, save: () => {}, key: KEY, io: m.io, allow: OURS });
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(m.sleeps).toContain(52_000);
    expect(ledger.posts.map((p) => p.status)).toEqual(["in-progress", "failed"]);
    expect(ledger.posts[1].errorMessage).toContain("Account not found for key [key]");
  });
  it("refuses, at the moment of sending, a post for an account outside the allowlist or on the denylist", async () => {
    const ledger = emptyLedger(), m = mockIo(() => ({ status: 201, body: { postSubmissionId: "x" } }));
    const { planned } = planPosts(FOUR.slice(0, 1), targets(), ledger, { now, spreadMin: 30, perDay: 4 });
    await expect(sendPosts({ planned, ledger, save: () => {}, key: KEY, io: m.io, allow: ["38445", "63054"] })).rejects.toThrow(/REFUSING: 76607/);
    const forged = [{ ...planned[0], target: { ...planned[0].target, id: "61953" }, body: { ...planned[0].body, post: { ...planned[0].body.post, accountId: "61953" } } }];
    await expect(sendPosts({ planned: forged, ledger, save: () => {}, key: KEY, io: m.io, allow: [...OURS, "61953"] })).rejects.toThrow(/REFUSING: 61953/);
    expect(m.calls.length).toBe(0);
  });
});

describe("the key, and what the tool may do in the workspace", () => {
  it("never lets the key into a log line, an error or the ledger", async () => {
    expect(redact(`x ${KEY} y ${KEY}`, KEY)).toBe("x [key] y [key]");
    const m = mockIo(() => ({ status: 401, body: `invalid key ${KEY}` }));
    const err = await listAccounts(m.io, KEY).catch((e) => e as Error);
    expect(err.message).toMatch(/Blotato answered 401/);
    expect(err.message).not.toContain(KEY);
    const m2 = mockIo(() => new Error(`connect ECONNREFUSED ${KEY}`));
    expect((await listAccounts(m2.io, KEY).catch((e) => e as Error)).message).not.toContain(KEY);
    // The tool prints through redact(), and neither source file writes the key anywhere.
    const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../scripts/tutorials", f), "utf8");
    expect(read("social-post.ts")).not.toMatch(/console\.(log|error|warn)\((?![^)]*redact)/);
    expect(read("social-post.ts") + read("social-post-lib.ts")).not.toMatch(/blt_|TUTORIAL_BLOTATO_KEY\s*=\s*["'][^"']/);
  });
  it("reads the account list in Blotato's shape", async () => {
    const m = mockIo(() => ({ status: 200, body: { items: ACCOUNTS.map((a) => ({ ...a, id: a.id })) } }));
    expect((await listAccounts(m.io, KEY)).find((a) => a.id === "38445")).toEqual({ id: "38445", platform: "linkedin", username: "", fullname: "Construct HUB" });
    expect(m.calls[0]).toMatchObject({ method: "GET", url: `${BLOTATO_BASE}/users/me/accounts` });
    await expect(listAccounts(mockIo(() => ({ status: 200, body: { accounts: [] } })).io, KEY)).rejects.toThrow(/unexpected shape/);
  });
  it("only ever creates posts and reads: no PATCH, PUT or DELETE, no schedule or media endpoint", () => {
    // The code, without its comments (which describe Blotato's other endpoints).
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../scripts/tutorials/social-post-lib.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/method: "GET" \| "POST"/);
    expect([...src.matchAll(/call\(o?\.?io, o?\.?key, "(\w+)", [`"]([^`"$?]+)/g)].map((m) => `${m[1]} ${m[2]}`).sort()).toEqual(["GET /posts/", "GET /users/me/accounts", "GET /users/me/accounts/", "POST /posts"]);
    expect(src).not.toMatch(/"(DELETE|PATCH|PUT)"/);
    expect(src).not.toMatch(/\/schedules|\/media/);
  });
  it("reconcile reads each unfinished post's status, keeps a scheduled post scheduled, and shouts about failures and unknowns", async () => {
    const ledger: SocialLedger = { ...emptyLedger(), posts: [
      entry({ postSubmissionId: "a", status: "in-progress" }), entry({ helpKey: "crm-home", postSubmissionId: "b", status: "scheduled" }),
      entry({ helpKey: "crm-x", postSubmissionId: "c", status: "scheduled" }), entry({ helpKey: "crm-y", postSubmissionId: null, status: "sending" }), entry({ helpKey: "crm-z", postSubmissionId: "d", status: "published" }),
    ] };
    const m = mockIo((c) => {
      expect(c.method).toBe("GET");
      const id = c.url.split("/").pop();
      return { status: 200, body: id === "a" ? { status: "published", publicUrl: "https://www.instagram.com/reel/abc" } : id === "b" ? { status: "in-progress" } : { status: "failed", errorMessage: "Unsupported media type" } };
    });
    const r = await reconcilePosts({ ledger, save: () => {}, key: KEY, io: m.io });
    expect(m.calls.map((c) => c.url.split("/").pop())).toEqual(["a", "b", "c"]);
    expect(ledger.posts.map((p) => p.status)).toEqual(["published", "scheduled", "failed", "sending", "published"]);
    expect(ledger.posts[0].publicUrl).toBe("https://www.instagram.com/reel/abc");
    expect(r.attention.join("\n")).toMatch(/FAILED — Unsupported media type[\s\S]*|outcome unknown/);
    expect(r.attention.length).toBe(2);
  });
});
