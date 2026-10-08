/**
 * The second stream of the social calendar: gator shorts ("viral clips") beside the tutorial cuts.
 * Pure — the clock and both ledgers are handed in — so the cadence is tested in
 * server/tutorials/gator.test.ts. The tool is `social-post.ts --stream viral` (dry run only for now).
 *
 * THE CADENCE (docs/gator/CONCEPTS.md, "Mixing into the calendar")
 *   · Tutorials are untouched: their own stream, their own ledger (docs/tutorials/social-schedule.json),
 *     three a day on YouTube, and their own share per account.
 *   · TikTok and Instagram: ONE gator clip per account per Eastern day, on top of the tutorial cuts, at a
 *     peak slot — 12:00 or 19:00 Eastern, which of the two decided per day and account, a few minutes
 *     past the hour. Never within 45 minutes of another post on that account.
 *   · Never back-to-back: on an account's timeline a gator clip is never next to another gator clip.
 *     A day whose slot would sit right after the last gator clip, with no tutorial cut between, is skipped.
 *   · LinkedIn: two gator clips a week at most (Monday–Sunday, Eastern), on a weekday at lunch, and
 *     only the clips written a LinkedIn version (the others do not belong there).
 *   · YouTube Shorts: one a day through our own YouTube client (never through Blotato), `#Shorts` in the
 *     title, `status.containsSyntheticMedia: true`, never within 45 minutes of a tutorial's publish time.
 *   · The platforms' own allowances for a young account, shared with the tutorial cuts (social-rate.ts):
 *     LinkedIn 3 posts and Instagram 4 in any rolling 24 hours.
 *   · A clip goes to an account once. The viral ledger (docs/gator/viral-schedule.json) is the record.
 */
import { SCHEDULE_TZ, addDays, easternLabel, zoneTime, zonedToUtc } from "../../server/youtube/schedule";
import { stable, type LedgerPost, type SocialLedger } from "../tutorials/social-post-lib";
import { rateRefusal } from "../tutorials/social-rate";

export type ViralPlatform = "instagram" | "tiktok" | "linkedin" | "youtube";
export const VIRAL_RULES = {
  peakSlots: ["12:00", "19:00"] as const,
  /** Minutes past the slot, 3…22: on the hour is where every scheduler posts. */
  jitter: { from: 3, span: 20 },
  perDay: 1,
  linkedinPerWeek: 2, linkedinSlot: "12:00",
  minGapMin: 45,
  /** Days ahead a clip may be pushed while looking for a day that keeps the rules. */
  horizonDays: 120,
};
export type ViralClip = { conceptId: string; platforms: Partial<Record<ViralPlatform, { text: string; title?: string }>> };
export type ViralTarget = { id: string; platform: ViralPlatform; name: string };
/** One entry of the viral ledger: a tutorial ledger post's shape, marked with its stream. */
export type ViralLedgerPost = LedgerPost & { stream: "viral"; conceptId: string; aiGenerated: true };
export type ViralLedger = { version: 1; stream: "viral"; timezone: string; posts: ViralLedgerPost[] };
export const emptyViralLedger = (): ViralLedger => ({ version: 1, stream: "viral", timezone: SCHEDULE_TZ, posts: [] });
export type ViralPlanned = { conceptId: string; target: ViralTarget; at: Date; eastern: string; slot: string; text: string; title?: string };
export type ViralSkip = { conceptId: string; accountId: string; reason: string };

const MIN = 60000;
const isWeekend = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };
/** The Monday of a date's week. */
export const weekOf = (date: string): string => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -((d + 6) % 7)); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const plus = (time: string, minutes: number) => hhmm(+time.slice(0, 2) * 60 + +time.slice(3, 5) + minutes);
const counts = (p: { status: string }) => p.status !== "failed";

/** The peak slot of a day on an account — the same every time it is asked, and not the same slot every day. */
export function slotFor(date: string, t: ViralTarget, tz: string = SCHEDULE_TZ): { slot: string; at: Date } {
  const slot = t.platform === "linkedin" ? VIRAL_RULES.linkedinSlot : VIRAL_RULES.peakSlots[stable(VIRAL_RULES.peakSlots.length, "viral-slot", date, t.id)];
  return { slot, at: zonedToUtc(date, plus(slot, VIRAL_RULES.jitter.from + stable(VIRAL_RULES.jitter.span, "viral-minute", date, t.id)), tz) };
}

type Mark = { at: number; viral: boolean };
/**
 * The plan: for every clip × account, a time that keeps the cadence — or the reason there is none.
 * `tutorial` is the tutorial ledger (read, never written); `youtubeTimes` are the tutorials' publish
 * times on YouTube; `viral` is this stream's own ledger.
 */
export function planViral(clips: readonly ViralClip[], targets: readonly ViralTarget[], o: {
  now: Date; viral: ViralLedger; tutorial: SocialLedger; youtubeTimes?: readonly (string | Date)[]; tz?: string;
  /** Tutorial posts not yet in the ledger (a plan made in the same run), so the two streams are planned together. */
  alsoTutorial?: readonly { accountId: string; at: Date }[];
}): { planned: ViralPlanned[]; skipped: ViralSkip[] } {
  const tz = o.tz ?? SCHEDULE_TZ, planned: ViralPlanned[] = [], skipped: ViralSkip[] = [];
  const today = zoneTime(o.now, tz).date;
  for (const t of targets) {
    // This account's timeline: what both ledgers hold, and what this plan adds.
    const marks: Mark[] = [];
    if (t.platform === "youtube") for (const y of o.youtubeTimes ?? []) marks.push({ at: new Date(y).getTime(), viral: false });
    for (const p of o.tutorial.posts) if (p.accountId === t.id && counts(p)) marks.push({ at: new Date(p.scheduledTime ?? p.createdAt).getTime(), viral: false });
    for (const p of o.alsoTutorial ?? []) if (p.accountId === t.id) marks.push({ at: p.at.getTime(), viral: false });
    for (const p of o.viral.posts) if (p.accountId === t.id && counts(p)) marks.push({ at: new Date(p.scheduledTime ?? p.createdAt).getTime(), viral: true });
    const viralOn = (date: string) => marks.filter((m) => m.viral && zoneTime(new Date(m.at), tz).date === date).length;
    const viralInWeek = (date: string) => marks.filter((m) => m.viral && weekOf(zoneTime(new Date(m.at), tz).date) === weekOf(date)).length;
    let day = today;
    for (const clip of clips) {
      const mine = clip.platforms[t.platform];
      if (!mine) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: t.platform === "linkedin" ? "no LinkedIn version — the joke does not belong there" : `no ${t.platform} post for this clip` }); continue; }
      const before = o.viral.posts.filter((p) => p.conceptId === clip.conceptId && p.accountId === t.id);
      const live = before.find(counts);
      if (live) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: `already ${live.status}${live.postSubmissionId ? ` (${live.postSubmissionId})` : ""}` }); continue; }
      if (before.length) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: "failed before — it is not retried by itself" }); continue; }
      let found: { slot: string; at: Date } | null = null, why = "";
      for (let guard = 0; guard < VIRAL_RULES.horizonDays && !found; guard++, day = addDays(day, 1)) {
        const s = slotFor(day, t, tz), at = s.at.getTime();
        if (at < o.now.getTime() + 10 * MIN) { why = "the slot has passed"; continue; }
        if (viralOn(day) >= VIRAL_RULES.perDay) { why = "the day has its gator clip"; continue; }
        if (t.platform === "linkedin" && (isWeekend(day) || viralInWeek(day) >= VIRAL_RULES.linkedinPerWeek)) { why = "LinkedIn: weekdays, two a week"; continue; }
        // Never back-to-back: the posts on either side of the slot on this account must not be gator clips.
        const prev = marks.filter((m) => m.at <= at).sort((a, b) => b.at - a.at)[0], next = marks.filter((m) => m.at > at).sort((a, b) => a.at - b.at)[0];
        if (prev?.viral || next?.viral) { why = "it would sit next to another gator clip"; continue; }
        // The platform's own allowance, shared with the tutorial cuts (social-rate.ts).
        const rate = rateRefusal(t.platform, at, marks.map((m) => m.at));
        if (rate) { why = rate; continue; }
        if (marks.some((m) => Math.abs(m.at - at) < VIRAL_RULES.minGapMin * MIN)) { why = `within ${VIRAL_RULES.minGapMin} minutes of another post`; continue; }
        found = s;
      }
      if (!found) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: `no day in the next ${VIRAL_RULES.horizonDays} keeps the cadence (${why}) — gator clips need tutorial cuts between them` }); day = today; continue; }
      marks.push({ at: found.at.getTime(), viral: true });
      planned.push({ conceptId: clip.conceptId, target: t, at: found.at, eastern: easternLabel(found.at, tz), slot: found.slot, text: mine.text, ...(mine.title ? { title: mine.title } : {}) });
    }
  }
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.target.id.localeCompare(b.target.id));
  return { planned, skipped };
}
