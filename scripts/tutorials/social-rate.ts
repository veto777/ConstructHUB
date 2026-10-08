/**
 * The shared cadence and what an account can take — one rule for BOTH streams (the tutorial cuts and the
 * gator shorts), so neither poster can spend the other's allowance. Pure; tested in
 * server/tutorials/gator.test.ts.
 *
 * THE CADENCE (the owner, 2026-10-08: "on TikTok and Instagram and LinkedIn we will only post one tutorial
 * a day and 3 funny videos a day"; YouTube gets every walkthrough and no gator clips):
 *
 *   per account, per Eastern day     one tutorial cut + three gator clips, at least two hours apart
 *   gator, morning                   07:30–08:15      (LinkedIn weekdays 08:00–08:15)
 *   the tutorial cut                 10:15–11:00
 *   gator, midday                    13:00–13:30
 *   gator, evening                   18:30–20:30      (LinkedIn weekdays 15:30–17:30: business hours)
 *   LinkedIn, weekends               the tutorial cut and the midday gator clip only
 *
 * The minute inside a window moves every day by a fixed step from a per-account start, so no two
 * consecutive days have the same time and the same question always gets the same answer. (The windows are
 * narrower than "07:30–09:00 / 10:00–11:30 / 12:00–13:30" on purpose: only so can any choice of minutes
 * keep two hours between neighbours.)
 *
 * THE ALLOWANCE: four posts per account per Eastern day (Instagram, TikTok, LinkedIn alike), never more
 * than five in any rolling 24 hours (a calendar-day cap alone would allow eight around midnight; a strict
 * rolling four would refuse every slot that falls a minute earlier than yesterday's), two hours between
 * any two posts on an account.
 *
 * THE BACK-OFF (learned 2026-10-08, the accounts' second day: LinkedIn refused with "a share limit has been
 * reached for unverified members" after five posts in two hours, Instagram with "The Instagram account is
 * restricted"): when a platform refuses a post with one of those answers, that account drops to TWO posts a
 * day for 48 hours (docs/tutorials/social-backoff.json records when and why), the refused post is not tried
 * again within 12 hours, and what does not fit moves to the next free slot.
 *
 * A post that Blotato reported as failed did not go out and does not count.
 */
import { createHash } from "crypto";
import { SCHEDULE_TZ, addDays, zoneTime, zonedToUtc } from "../../server/youtube/schedule";

export type RateRule = { perDay: number; rolling: number; minGapMin: number; why: string };
const YOUNG = "a young account is restricted when it posts in bursts";
export const RATE_RULES: Partial<Record<string, RateRule>> = {
  instagram: { perDay: 4, rolling: 5, minGapMin: 120, why: YOUNG },
  tiktok: { perDay: 4, rolling: 5, minGapMin: 120, why: YOUNG },
  linkedin: { perDay: 4, rolling: 5, minGapMin: 120, why: "LinkedIn's share limit for an unverified profile" },
};
export const TUTORIALS_PER_DAY = 1, GATORS_PER_DAY = 3;
export const BACKOFF = { perDay: 2, hours: 48, retryHours: 12 };
export type Backoff = { platform: string; accountId: string; from: string; until: string; perDay: number; why: string };
const HOUR = 3600000, MIN = 60000;

/** Is this answer a platform telling us to slow down? The back-off it calls for, or null. */
export function backoffFor(p: { platform: string; accountId: string; errorMessage?: string | null }, at: Date): Backoff | null {
  const m = p.errorMessage ?? "";
  const hit = p.platform === "linkedin" ? /share limit|unverified members/i.test(m) : p.platform === "instagram" ? /account is restricted/i.test(m) : false;
  return hit ? { platform: p.platform, accountId: p.accountId, from: at.toISOString(), until: new Date(at.getTime() + BACKOFF.hours * HOUR).toISOString(), perDay: BACKOFF.perDay, why: m.slice(0, 200) } : null;
}
/** Add a back-off unless one already covers that moment on that account. Returns whether it was added. */
export function addBackoff(list: Backoff[], b: Backoff): boolean {
  const t = new Date(b.from).getTime();
  if (list.some((x) => x.accountId === b.accountId && new Date(x.from).getTime() <= t && t < new Date(x.until).getTime())) return false;
  list.push(b); return true;
}
/** A refused post may be tried again 12 hours after its last refusal — never sooner. */
export const mayRetry = (lastRefusedAt: Date | number | string, at: Date | number): boolean => new Date(at).getTime() - new Date(lastRefusedAt).getTime() >= BACKOFF.retryHours * HOUR;

export type RateContext = { accountId?: string; backoffs?: readonly Backoff[]; tz?: string; /** `--spread` / `--asap`: an explicit "minutes apart" order sets the two-hour gap aside (the caps stay). */ noGap?: boolean };
/**
 * Why a post at `at` may not go out on an account — or null when it may. `times`: when every other
 * post on that account (both streams; published, scheduled or possibly sent) goes or went out.
 */
export function rateRefusal(platform: string, at: Date | number, times: readonly number[], rules: Partial<Record<string, RateRule>> = RATE_RULES, o: RateContext = {}): string | null {
  const rule = rules[platform], t = typeof at === "number" ? at : at.getTime(), tz = o.tz ?? SCHEDULE_TZ;
  if (!rule) return null;
  const slow = (o.backoffs ?? []).find((b) => b.platform === platform && (!o.accountId || b.accountId === o.accountId) && new Date(b.from).getTime() <= t && t < new Date(b.until).getTime());
  const cap = slow ? Math.min(rule.perDay, slow.perDay) : rule.perDay, day = zoneTime(new Date(t), tz).date;
  const sameDay = times.filter((x) => zoneTime(new Date(x), tz).date === day).length + 1;
  if (sameDay > cap) return `${platform}: that would be ${sameDay} posts on ${day} — ${cap} a day at most (${slow ? `backing off until ${slow.until}: ${slow.why}` : rule.why})`;
  // Every 24-hour stretch the new post falls in — also the window of one already scheduled after it.
  const all = [...times, t].sort((a, b) => a - b);
  for (const end of all) {
    if (end < t || end - t >= 24 * HOUR) continue;
    const n = all.filter((x) => x > end - 24 * HOUR && x <= end).length;
    if (n > rule.rolling) return `${platform}: that would be ${n} posts in 24 hours — ${rule.rolling} at most (${rule.why})`;
  }
  if (!o.noGap) { const near = times.find((x) => Math.abs(x - t) < rule.minGapMin * MIN); if (near !== undefined) return `${platform}: within ${rule.minGapMin} minutes of another post on the account`; }
  return null;
}
/** The first moment at or after `at` when the post may go out (looking a week ahead), in steps of 15 minutes. */
export function nextAllowed(platform: string, at: Date, times: readonly number[], rules: Partial<Record<string, RateRule>> = RATE_RULES, o: RateContext = {}): Date | null {
  for (let t = at.getTime(), end = t + 7 * 24 * HOUR; t <= end; t += 15 * MIN) if (!rateRefusal(platform, t, times, rules, o)) return new Date(t);
  return null;
}
/** When the posts of one account go or went out, from any number of ledgers (failed ones left out). */
export const accountTimes = (accountId: string, ...ledgers: readonly { posts: readonly { accountId: string; status: string; scheduledTime: string | null; createdAt: string }[] }[]): number[] =>
  ledgers.flatMap((l) => l.posts.filter((p) => p.accountId === accountId && p.status !== "failed").map((p) => new Date(p.scheduledTime ?? p.createdAt).getTime()));

/* ── The day's slots ──────────────────────────────────────────────────────── */

export type SlotName = "gator-morning" | "tutorial" | "gator-midday" | "gator-evening";
export const SLOT_ORDER: readonly SlotName[] = ["gator-morning", "tutorial", "gator-midday", "gator-evening"];
/** [first minute of the window, minutes in it, the daily step — coprime to the size, so tomorrow is never today's minute]. */
const WINDOWS: Record<"default" | "linkedin", Record<SlotName, readonly [number, number, number]>> = {
  default: { "gator-morning": [7 * 60 + 30, 46, 7], tutorial: [10 * 60 + 15, 46, 7], "gator-midday": [13 * 60, 31, 7], "gator-evening": [18 * 60 + 30, 121, 37] },
  linkedin: { "gator-morning": [8 * 60, 16, 5], tutorial: [10 * 60 + 15, 46, 7], "gator-midday": [13 * 60, 31, 7], "gator-evening": [15 * 60 + 30, 121, 37] },
};
const isWeekend = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const start = (n: number, ...parts: string[]) => parseInt(createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 8), 16) % n;
/** A slot's Eastern clock time on a date ("08:07"), or null when that account has no such slot that day (LinkedIn at the weekend). */
export function slotClock(date: string, name: SlotName, platform: string, accountId: string): string | null {
  if (platform === "linkedin" && isWeekend(date) && (name === "gator-morning" || name === "gator-evening")) return null;
  const [from, size, step] = WINDOWS[platform === "linkedin" && !isWeekend(date) ? "linkedin" : "default"][name];
  const dayN = Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86400000);
  return hhmm(from + ((dayN * step + start(size, "slot", name, accountId)) % size));
}
export function slotAt(date: string, name: SlotName, platform: string, accountId: string, tz: string = SCHEDULE_TZ): Date | null {
  const clock = slotClock(date, name, platform, accountId);
  return clock ? zonedToUtc(date, clock, tz) : null;
}

/* ── The tutorial of the day ──────────────────────────────────────────────── */

/**
 * Which tutorials get a social cut: ONE per Eastern day — by default the first that YouTube publishes
 * that day (`prefer` names another for a date). YouTube itself still gets every walkthrough.
 */
export function tutorialsOfTheDay<V extends { helpKey: string; publishAt: string }>(videos: readonly V[], o: { tz?: string; prefer?: Readonly<Record<string, string>> } = {}): V[] {
  const tz = o.tz ?? SCHEDULE_TZ, byDay = new Map<string, V[]>();
  for (const v of [...videos].sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.helpKey.localeCompare(b.helpKey))) { const d = zoneTime(new Date(v.publishAt), tz).date; byDay.set(d, [...(byDay.get(d) ?? []), v]); }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, vs]) => vs.find((v) => v.helpKey === o.prefer?.[d]) ?? vs[0]);
}
/**
 * When the day's tutorial cut goes out on an account: the tutorial slot of the day YouTube publishes it —
 * or, when YouTube publishes it after that slot (a cut never precedes its video), the next day's slot.
 */
export function tutorialSlotFor(publishAt: string | Date, platform: string, accountId: string, tz: string = SCHEDULE_TZ): Date {
  const yt = new Date(publishAt);
  for (let d = zoneTime(yt, tz).date, i = 0; i < 8; i++, d = addDays(d, 1)) { const at = slotAt(d, "tutorial", platform, accountId, tz); if (at && at.getTime() >= yt.getTime()) return at; }
  throw new Error("no tutorial slot in the week after the publish time");
}
/** Why an account may not take another tutorial cut that Eastern day — or null. `tutorialTimes`: its other tutorial cuts. */
export function tutorialRefusal(at: Date | number, tutorialTimes: readonly number[], tz: string = SCHEDULE_TZ): string | null {
  const day = zoneTime(new Date(at), tz).date, n = tutorialTimes.filter((x) => zoneTime(new Date(x), tz).date === day).length;
  return n >= TUTORIALS_PER_DAY ? `the account already has its tutorial cut on ${day} (one a day; YouTube gets every walkthrough)` : null;
}
