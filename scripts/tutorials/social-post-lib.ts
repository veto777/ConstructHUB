/**
 * Cross-posting the social cuts through Blotato — the rules, the plan and the calls, with nothing
 * that touches a disk or the network by itself (fetch, the clock and the ledger are handed in), so
 * every rule is tested in server/tutorials/social-post.test.ts. The tool is social-post.ts.
 *
 * Blotato's API, as read on 2026-10-08 (https://help.blotato.com/api/start and its API reference):
 *   base https://backend.blotato.com/v2, header `blotato-api-key`
 *   GET  /users/me/accounts                     → { items: [{ id, platform, fullname, username }] }
 *   GET  /users/me/accounts/:id/subaccounts     → { items: [{ id, accountId, name }] }   (Facebook / LinkedIn pages)
 *   POST /posts  { post: { accountId, content: { text, mediaUrls, platform }, target: { targetType, … } }, scheduledTime? }
 *                                               → 201 { postSubmissionId, scheduledTime? }      30 requests a minute
 *   GET  /posts/:postSubmissionId               → { status: in-progress | scheduled | published | failed, publicUrl?, errorMessage? }
 *   Media: "pass any publicly accessible URL in mediaUrls — no upload step required". Ours are the
 *   R2 objects served by https://constructhub.us/api/tutorials/media/… (social-upload.ts).
 *   `scheduledTime` is a top-level sibling of `post`, an ISO 8601 instant; left out, the post goes out now.
 *
 * THE WORKSPACE IS SHARED with the owner's other brands. This tool only ever CREATES posts, and only
 * on accounts that pass every one of these:
 *   1. the id is in the allowlist (TUTORIAL_BLOTATO_ACCOUNT_IDS) — an empty allowlist is a refusal;
 *   2. the id is not in DENYLIST (the other brands' accounts, by id — no flag lifts this);
 *   3. Blotato's own account list has the id, and its name looks like ConstructHUB
 *      (or the id was named with --i-checked);
 *   4. its platform is one we have a post for.
 * It never edits, reschedules or deletes anything in the workspace.
 */
import { createHash } from "node:crypto";
import { SCHEDULE_TZ, addDays, easternLabel, zoneTime, zonedToUtc } from "../../server/youtube/schedule";
import { PLATFORM_RULES, SOCIAL_PLATFORMS, type SocialPlatform } from "./social-text";

export const BLOTATO_BASE = "https://backend.blotato.com/v2";

/**
 * Accounts of the owner's OTHER brands in this Blotato workspace (and our own YouTube channel, which
 * is posted through YouTube's API with its own scheduler). Never posted to, whatever the env says:
 * a typo in the allowlist must not put ConstructHUB content in front of another brand's audience.
 */
export const DENYLIST: Readonly<Record<string, string>> = {
  "43689": "Facebook “Veto Creed” / Voiceban page",
  "45119": "YouTube “Bud Smith (Voiceban)”",
  "52703": "YouTube “Construct HUB” (posted through our own YouTube scheduler, never through Blotato)",
  "61953": "Instagram voicebanapp",
  "30778": "LinkedIn Veto Kravchenko",
  "8451": "Threads voicebanapp",
  "53357": "TikTok voiceban_",
  "50595": "TikTok triplegpodcast",
  "23269": "X voicebannetwork",
};

export type BlotatoAccount = { id: string; platform: string; username?: string | null; fullname?: string | null };
export type Target = { id: string; platform: SocialPlatform; name: string; pageId?: string | null };

/** The allowlist from the environment: account ids, comma-separated. Empty → refuse. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  const ids = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("TUTORIAL_BLOTATO_ACCOUNT_IDS is empty: there is no account this tool may post to. Add ConstructHUB's own account ids (see PRODUCER-GUIDE.md, “Posting to social”).");
  for (const id of ids) if (!/^\d{1,12}$/.test(id)) throw new Error(`TUTORIAL_BLOTATO_ACCOUNT_IDS: “${id.slice(0, 20)}” is not an account id`);
  return [...new Set(ids)];
}
/** `accountId:pageId` pairs (TUTORIAL_BLOTATO_PAGE_IDS) — a Facebook Page (required) or a LinkedIn company page. */
export function parsePageIds(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,12}):([A-Za-z0-9_-]{1,40})$/.exec(pair);
    if (!m) throw new Error(`TUTORIAL_BLOTATO_PAGE_IDS: “${pair.slice(0, 30)}” is not accountId:pageId`);
    out[m[1]] = m[2];
  }
  return out;
}

/** "constructhubapp", "Construct HUB", "construct.hub", "CHUB tips" — but not "Voiceban". */
export const looksLikeConstructHub = (name: string | null | undefined): boolean => {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return n.includes("construct") || n.includes("chub");
};
export const accountName = (a: BlotatoAccount): string => [a.username, a.fullname].map((s) => String(s ?? "").trim()).filter(Boolean).join(" / ") || "(no name)";

/**
 * The accounts this run may post to — or a refusal that says exactly why. Every allowlisted id must
 * pass; one bad id stops the whole run (posting to "the ones that are fine" would hide the mistake).
 */
export function checkAccounts(o: { allow: readonly string[]; accounts: readonly BlotatoAccount[]; iChecked?: readonly string[]; pageIds?: Record<string, string> }): Target[] {
  if (!o.allow.length) throw new Error("the allowlist is empty: nothing may be posted");
  const problems: string[] = [], targets: Target[] = [];
  for (const id of o.allow) {
    if (DENYLIST[id]) { problems.push(`${id} is ${DENYLIST[id]} — another brand's account (or one this tool must not use). It is on the built-in denylist and is never posted to.`); continue; }
    const a = o.accounts.find((x) => String(x.id) === id);
    if (!a) { problems.push(`${id} is not an account of this Blotato workspace`); continue; }
    const name = accountName(a);
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(a.platform)) { problems.push(`${id} (${a.platform} ${name}): there is no post for ${a.platform}`); continue; }
    if (!looksLikeConstructHub(a.username) && !looksLikeConstructHub(a.fullname) && !o.iChecked?.includes(id)) {
      problems.push(`${id} is ${a.platform} “${name}”, which does not look like a ConstructHUB account. If it really is, pass --i-checked ${id}.`);
      continue;
    }
    const pageId = o.pageIds?.[id] ?? null;
    if (a.platform === "facebook" && !pageId) { problems.push(`${id} (facebook ${name}) needs its Page id: TUTORIAL_BLOTATO_PAGE_IDS=${id}:<pageId>`); continue; }
    targets.push({ id, platform: a.platform as SocialPlatform, name, pageId });
  }
  if (problems.length) throw new Error(`REFUSING TO POST:\n${problems.map((p) => `  · ${p}`).join("\n")}`);
  return targets;
}

/* ── What is sent ─────────────────────────────────────────────────────────── */

export type PostMedia = { url: string; coverUrl?: string | null; coverMs?: number | null };
export type BlotatoPost = { post: { accountId: string; content: { text: string; mediaUrls: string[]; platform: string }; target: Record<string, unknown> }; scheduledTime?: string };

/**
 * The request for one post. TikTok's flags are its required disclosures, set to what is true here:
 * public; comments, duets and stitches allowed; not a paid partnership; it does promote our own
 * product (isYourBrand); and the narration is a synthetic voice (isAiGenerated).
 */
export function buildPost(t: Target, text: string, media: PostMedia, scheduledTime?: string | null): BlotatoPost {
  let target: Record<string, unknown>;
  switch (t.platform) {
    case "instagram": target = { targetType: "instagram", mediaType: "reel", shareToFeed: true, ...(media.coverUrl ? { coverImageUrl: media.coverUrl } : {}) }; break;
    case "tiktok": target = {
      targetType: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", disabledComments: false, disabledDuet: false, disabledStitch: false,
      isBrandedContent: false, isYourBrand: true, isAiGenerated: true, ...(media.coverMs != null ? { videoCoverTimestamp: media.coverMs } : {}),
    }; break;
    case "linkedin": target = { targetType: "linkedin", ...(t.pageId ? { pageId: t.pageId } : {}) }; break;
    case "facebook": target = { targetType: "facebook", pageId: t.pageId, mediaType: "reel" }; break;
    case "twitter": target = { targetType: "twitter" }; break;
    case "threads": target = { targetType: "threads" }; break;
  }
  if (text.length > PLATFORM_RULES[t.platform].limit) throw new Error(`the ${t.platform} text is ${text.length} characters, over the platform's ${PLATFORM_RULES[t.platform].limit}`);
  if (!/^https:\/\/constructhub\.us\//.test(media.url)) throw new Error(`media must be served from https://constructhub.us/ (got ${media.url.slice(0, 60)})`);
  return { post: { accountId: t.id, content: { text, mediaUrls: [media.url], platform: t.platform }, target }, ...(scheduledTime ? { scheduledTime } : {}) };
}

/* ── When ─────────────────────────────────────────────────────────────────── */

const DAY_MS = 86400000, MIN = 60000;
/** A number from 0 to n−1 that depends only on the words given: the same video and account always get the same minute. */
export const stable = (n: number, ...parts: string[]): number => parseInt(createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 8), 16) % n;
const isWeekend = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutesOf = (time: string) => +time.slice(0, 2) * 60 + +time.slice(3, 5);
/** LinkedIn is read at work: 08:30–17:00 Eastern on a weekday. */
export const LINKEDIN_HOURS = { from: 8 * 60 + 30, to: 17 * 60 };

/**
 * When a video's post goes out on one account, following its YouTube publish time:
 *   · Shorts-style platforms: the same Eastern day, 30–90 minutes after YouTube publishes it;
 *   · LinkedIn: the same, when that is a weekday between 08:30 and 17:00 Eastern; earlier in the day →
 *     09:00–10:59 that morning; later, or on a weekend → 09:00–10:59 on the next weekday.
 * The minute is picked by a hash of the video and the account, so it is the same every time it is asked.
 */
export function followYouTube(publishAt: string | Date, platform: SocialPlatform, helpKey: string, accountId: string, tz: string = SCHEDULE_TZ): Date {
  const yt = new Date(publishAt);
  const after = new Date(yt.getTime() + (30 + stable(61, "after", helpKey, accountId)) * MIN);
  if (platform !== "linkedin") {
    // "The same Eastern day": a video that goes public late in the evening keeps its post before midnight.
    const day = zoneTime(yt, tz).date;
    return zoneTime(after, tz).date === day ? after : zonedToUtc(day, "23:55", tz);
  }
  const z = zoneTime(after, tz), mins = minutesOf(z.time), morning = hhmm(9 * 60 + stable(120, "morning", helpKey, accountId));
  if (!isWeekend(z.date) && zoneTime(yt, tz).date === z.date) {
    if (mins >= LINKEDIN_HOURS.from && mins <= LINKEDIN_HOURS.to) return after;
    if (mins < LINKEDIN_HOURS.from) return zonedToUtc(z.date, morning, tz);
  }
  let day = addDays(zoneTime(yt, tz).date, 1);
  while (isWeekend(day)) day = addDays(day, 1);
  return zonedToUtc(day, morning, tz);
}

export type LedgerPost = {
  helpKey: string; accountId: string; platform: SocialPlatform; account: string;
  cut: string; mediaUrl: string; mediaSha256: string; coverUrl?: string | null; textSha256: string; textLength: number;
  /** null = sent without a time (published at once). */
  scheduledTime: string | null; scheduledEastern: string;
  /** `sending` = the request left and no answer was recorded: the outcome is unknown and it is never sent again by itself. */
  status: "sending" | "in-progress" | "scheduled" | "published" | "failed";
  postSubmissionId: string | null; publicUrl?: string | null; errorMessage?: string | null;
  createdAt: string; checkedAt?: string | null;
};
export type SocialLedger = { version: 1; timezone: string; posts: LedgerPost[] };
export const emptyLedger = (): SocialLedger => ({ version: 1, timezone: SCHEDULE_TZ, posts: [] });
/** A post that exists (or may exist): everything but a failure Blotato itself reported. */
export const counts = (p: LedgerPost): boolean => p.status !== "failed";

export type VideoForPost = {
  helpKey: string;
  /** When YouTube publishes it (the YouTube ledger). */
  publishAt: string;
  posts: Partial<Record<SocialPlatform, { text: string; cut: string; media: PostMedia & { sha256: string } }>>;
};
export type PlannedPost = { helpKey: string; target: Target; text: string; cut: string; media: PostMedia & { sha256: string }; at: Date; immediate: boolean; eastern: string; body: BlotatoPost };
export type Skip = { helpKey: string; accountId: string; reason: string };
export type PlanOptions = {
  now: Date;
  /** `--spread M`: ignore YouTube's times; per account, the first post now and each next one M minutes (+ up to a third of M) later; accounts start a few minutes apart. */
  spreadMin?: number | null;
  /** Posts per account per Eastern day. Default: `warmupPerDay` during the warm-up, 3 (the YouTube cadence) after. */
  perDay?: number | null;
  /** New accounts are flagged easily: for `warmupDays` from `warmupStart` (YYYY-MM-DD, Eastern) an account gets `warmupPerDay` post(s) a day. */
  warmupStart?: string | null; warmupDays?: number; warmupPerDay?: number;
  retryFailed?: boolean;
  tz?: string;
  /** Keys held for the owner's approval (the help entry's `youtube.hold`): never planned, whatever the YouTube ledger says. The caller leaves out the ones released for this run. */
  held?: readonly string[];
};
export const HELD_REASON = "held for owner approval";
export const WARMUP_DAYS = 14, WARMUP_PER_DAY = 1, CADENCE_PER_DAY = 3;
/** A time closer than this is sent without `scheduledTime` (Blotato wants a future time; "now" is simply now). */
export const IMMEDIATE_WITHIN_MS = 90_000;

/**
 * The plan of a run: for every video × allowed account, either a post with its time or the reason
 * there is none. A (video, account) pair that is already in the ledger is never planned again —
 * also when its outcome is unknown (`sending`); only a failure Blotato reported can be retried, with
 * `retryFailed`. A day that already holds its share for an account pushes the post to the next day
 * (LinkedIn: the next weekday).
 */
export function planPosts(videos: readonly VideoForPost[], targets: readonly Target[], ledger: SocialLedger, o: PlanOptions): { planned: PlannedPost[]; skipped: Skip[] } {
  const tz = o.tz ?? SCHEDULE_TZ, planned: PlannedPost[] = [], skipped: Skip[] = [];
  const today = zoneTime(o.now, tz).date;
  const warmStart = o.warmupStart ?? ledger.posts.map((p) => zoneTime(p.scheduledTime ?? p.createdAt, tz).date).sort()[0] ?? today;
  const capOn = (date: string): number => {
    if (o.perDay) return o.perDay;
    const dayN = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${warmStart}T00:00:00Z`).getTime()) / DAY_MS);
    return dayN < (o.warmupDays ?? WARMUP_DAYS) ? (o.warmupPerDay ?? WARMUP_PER_DAY) : CADENCE_PER_DAY;
  };
  const held = new Set(o.held ?? []);
  for (const v of videos) if (held.has(v.helpKey)) for (const t of targets) skipped.push({ helpKey: v.helpKey, accountId: t.id, reason: `${HELD_REASON} — not posted. When the owner has approved it: --release ${v.helpKey}` });
  const order = videos.filter((v) => !held.has(v.helpKey)).sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.helpKey.localeCompare(b.helpKey));
  targets.forEach((t, ti) => {
    const used = new Map<string, number>();
    for (const p of ledger.posts) if (p.accountId === t.id && counts(p)) { const d = zoneTime(p.scheduledTime ?? p.createdAt, tz).date; used.set(d, (used.get(d) ?? 0) + 1); }
    // --spread: this account's own clock — it starts a few minutes after the account before it.
    let cursor = o.now.getTime() + ti * (3 + stable(3, "account-offset", t.id)) * MIN;
    for (const v of order) {
      const mine = v.posts[t.platform];
      if (!mine) { skipped.push({ helpKey: v.helpKey, accountId: t.id, reason: `no ${t.platform} post for this video` }); continue; }
      const before = ledger.posts.filter((p) => p.helpKey === v.helpKey && p.accountId === t.id);
      const live = before.find(counts);
      if (live) { skipped.push({ helpKey: v.helpKey, accountId: t.id, reason: live.status === "sending" ? "a post was sent and its outcome was never recorded — check Blotato by hand (never sent twice)" : `already ${live.status}${live.postSubmissionId ? ` (${live.postSubmissionId})` : ""}` }); continue; }
      if (before.length && !o.retryFailed) { skipped.push({ helpKey: v.helpKey, accountId: t.id, reason: `failed before (${before[before.length - 1].errorMessage ?? "no message"}) — pass --retry-failed to try again` }); continue; }

      let at: Date;
      if (o.spreadMin != null) { at = new Date(cursor); }
      else {
        at = followYouTube(v.publishAt, t.platform, v.helpKey, t.id, tz);
        // A video that is already public: its post goes out in the next window instead of in the past.
        if (at.getTime() < o.now.getTime()) {
          at = new Date(o.now.getTime() + (10 + stable(50, "late", v.helpKey, t.id)) * MIN);
          if (t.platform === "linkedin") at = followYouTube(o.now, "linkedin", v.helpKey, t.id, tz);
        }
      }
      // The day's share for this account: move on, a day at a time, until one has room.
      for (let guard = 0; guard < 400; guard++) {
        const d = zoneTime(at, tz).date;
        if ((used.get(d) ?? 0) < capOn(d) && !(t.platform === "linkedin" && o.spreadMin == null && isWeekend(d))) break;
        const next = addDays(d, 1), clock = zoneTime(at, tz).time;
        at = zonedToUtc(next, o.spreadMin != null || t.platform !== "linkedin" ? clock : hhmm(9 * 60 + stable(120, "morning", v.helpKey, t.id)), tz);
      }
      const d = zoneTime(at, tz).date;
      used.set(d, (used.get(d) ?? 0) + 1);
      if (o.spreadMin != null) cursor = Math.max(cursor, at.getTime()) + (o.spreadMin + stable(Math.max(1, Math.floor(o.spreadMin / 3) + 1), "spread", v.helpKey, t.id)) * MIN;
      const immediate = at.getTime() - o.now.getTime() < IMMEDIATE_WITHIN_MS;
      const iso = immediate ? null : new Date(Math.round(at.getTime() / 1000) * 1000).toISOString();
      planned.push({ helpKey: v.helpKey, target: t, text: mine.text, cut: mine.cut, media: mine.media, at, immediate, eastern: easternLabel(at, tz), body: buildPost(t, mine.text, mine.media, iso) });
    }
  });
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.target.id.localeCompare(b.target.id));
  return { planned, skipped };
}

/* ── Talking to Blotato ───────────────────────────────────────────────────── */

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>;
export type Io = { fetch: Fetch; sleep: (ms: number) => Promise<void>; now: () => Date; log: (line: string) => void };
/** At least this long between two requests that create something (Blotato allows 30 a minute; we send 10). */
export const WRITE_GAP_MS = 6000;
export const READ_GAP_MS = 1200;

/** Whatever is printed or thrown goes through this: the key never reaches a log, a ledger or an error. */
export const redact = (text: string, key: string): string => (key ? text.split(key).join("[key]") : text);

async function call(io: Io, key: string, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  if (!key) throw new Error("TUTORIAL_BLOTATO_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    let status = 0, raw = "";
    try {
      const res = await io.fetch(`${BLOTATO_BASE}${path}`, { method, headers: { "blotato-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      status = res.status; raw = await res.text();
    } catch (e) {
      // A request that may have left is never repeated blindly when it creates something.
      const why = redact(e instanceof Error ? e.message : String(e), key);
      if (method === "POST") throw Object.assign(new Error(`no answer from Blotato (${why}) — the post may or may not exist`), { uncertain: true });
      if (attempt >= 2) throw new Error(`Blotato did not answer: ${why}`);
      await io.sleep(4000 * (attempt + 1));
      continue;
    }
    if (status === 429 && attempt < 3) {
      // Refused, so nothing was created: wait as long as it says (or a minute) and ask again.
      const wait = Number(/retry in (\d+) seconds?/i.exec(raw)?.[1] ?? 60);
      io.log(`  … Blotato's rate limit: waiting ${wait + 3} s`);
      await io.sleep((wait + 3) * 1000);
      continue;
    }
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    if (status < 200 || status >= 300) throw new Error(`Blotato answered ${status} to ${method} ${path.replace(/\?.*$/, "")}: ${redact(String(json?.message ?? raw).slice(0, 300), key)}`);
    return json;
  }
}

export async function listAccounts(io: Io, key: string): Promise<BlotatoAccount[]> {
  const j = await call(io, key, "GET", "/users/me/accounts");
  if (!Array.isArray(j?.items)) throw new Error("Blotato's account list has an unexpected shape");
  return j.items.map((a: any) => ({ id: String(a.id), platform: String(a.platform), username: a.username ?? "", fullname: a.fullname ?? "" }));
}
export async function listSubaccounts(io: Io, key: string, accountId: string): Promise<{ id: string; name: string }[]> {
  const j = await call(io, key, "GET", `/users/me/accounts/${encodeURIComponent(accountId)}/subaccounts`);
  return Array.isArray(j?.items) ? j.items.map((s: any) => ({ id: String(s.id), name: String(s.name ?? "") })) : [];
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Create the planned posts, one at a time. The ledger is saved BEFORE each request (status
 * `sending`) and again after its answer, so an interrupted run can never post a video twice: what
 * was sent is on record even if the answer never came.
 */
export async function sendPosts(o: { planned: readonly PlannedPost[]; ledger: SocialLedger; save: (l: SocialLedger) => void; key: string; io: Io; allow: readonly string[] }): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  for (const p of o.planned) {
    // The last line of defence, at the moment of sending: allowlisted, not denylisted, not already there.
    if (!o.allow.includes(p.target.id) || DENYLIST[p.target.id] || p.body.post.accountId !== p.target.id) throw new Error(`REFUSING: ${p.target.id} is not an account this run may post to`);
    if (o.ledger.posts.some((x) => x.helpKey === p.helpKey && x.accountId === p.target.id && counts(x))) continue;
    if (sent + failed > 0) await o.io.sleep(WRITE_GAP_MS);
    const entry: LedgerPost = {
      helpKey: p.helpKey, accountId: p.target.id, platform: p.target.platform, account: p.target.name, cut: p.cut,
      mediaUrl: p.media.url, mediaSha256: p.media.sha256, coverUrl: p.media.coverUrl ?? null, textSha256: hash(p.text), textLength: p.text.length,
      scheduledTime: p.body.scheduledTime ?? null, scheduledEastern: p.immediate ? `${easternLabel(o.io.now())} — at once` : p.eastern,
      status: "sending", postSubmissionId: null, createdAt: o.io.now().toISOString(),
    };
    o.ledger.posts.push(entry); o.save(o.ledger);
    try {
      const j = await call(o.io, o.key, "POST", "/posts", p.body);
      if (!j?.postSubmissionId) throw Object.assign(new Error("Blotato accepted the request but returned no postSubmissionId"), { uncertain: true });
      entry.postSubmissionId = String(j.postSubmissionId);
      entry.status = p.body.scheduledTime ? "scheduled" : "in-progress";
      if (j.scheduledTime) entry.scheduledTime = String(j.scheduledTime);
      sent++;
      o.io.log(`  ✓ ${p.helpKey} → ${p.target.platform} ${p.target.name}  ${entry.scheduledEastern}  ${entry.postSubmissionId}`);
    } catch (e: any) {
      const why = redact(e instanceof Error ? e.message : String(e), o.key);
      if (e?.uncertain) { entry.errorMessage = why; o.io.log(`  ?? ${p.helpKey} → ${p.target.platform} ${p.target.name}: ${why}. Left as “sending”: look in Blotato before doing anything else.`); o.save(o.ledger); throw new Error(`stopped: the outcome of ${p.helpKey} → ${p.target.id} is unknown`); }
      entry.status = "failed"; entry.errorMessage = why; failed++;
      o.io.log(`  ✗ ${p.helpKey} → ${p.target.platform} ${p.target.name}: ${why}`);
    }
    o.save(o.ledger);
  }
  return { sent, failed };
}

/** Ask Blotato what became of every post that is not finished; update the ledger. Read-only towards Blotato. */
export async function reconcilePosts(o: { ledger: SocialLedger; save: (l: SocialLedger) => void; key: string; io: Io }): Promise<{ checked: number; changed: number; attention: string[] }> {
  let checked = 0, changed = 0;
  const attention: string[] = [];
  for (const p of o.ledger.posts) {
    if (p.status === "sending") { attention.push(`${p.helpKey} → ${p.platform} ${p.account}: sent ${p.createdAt}, outcome unknown — look in Blotato`); continue; }
    if (!p.postSubmissionId || p.status === "published" || p.status === "failed") continue;
    if (checked) await o.io.sleep(READ_GAP_MS);
    checked++;
    const j = await call(o.io, o.key, "GET", `/posts/${encodeURIComponent(p.postSubmissionId)}`);
    const status = String(j?.status ?? "");
    p.checkedAt = o.io.now().toISOString();
    if (!["in-progress", "scheduled", "published", "failed"].includes(status)) { attention.push(`${p.helpKey} → ${p.platform}: Blotato says “${status.slice(0, 40)}”`); continue; }
    // Blotato answers "in-progress" for anything it has no record of: a scheduled post does not go back to that.
    if (status === "in-progress" && p.status === "scheduled") continue;
    if (status !== p.status) { p.status = status as LedgerPost["status"]; changed++; }
    if (j.publicUrl) p.publicUrl = String(j.publicUrl);
    if (j.scheduledTime && status === "scheduled") p.scheduledTime = String(j.scheduledTime);
    if (status === "failed") { p.errorMessage = String(j.errorMessage ?? "").slice(0, 500); attention.push(`${p.helpKey} → ${p.platform} ${p.account}: FAILED — ${p.errorMessage}`); }
    o.save(o.ledger);
  }
  return { checked, changed, attention };
}
