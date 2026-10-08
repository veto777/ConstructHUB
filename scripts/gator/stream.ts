/**
 * The second stream of the social calendar: gator shorts ("viral clips") beside the tutorial cuts.
 * Pure — the clock and both ledgers are handed in — so the cadence is tested in
 * server/tutorials/gator.test.ts. The tool is `social-post.ts --stream viral` / `daily.ts --schedule`.
 *
 * THE CADENCE (the owner, 2026-10-08; the slots and the allowance live in scripts/tutorials/social-rate.ts,
 * shared with the tutorial cuts):
 *   · TikTok, Instagram and LinkedIn: THREE gator clips per account per Eastern day — morning, midday and
 *     evening — and ONE tutorial cut, whose slot (10:15–11:00) is kept free for the tutorial stream.
 *   · LinkedIn only gets the clips given a LinkedIn version (the tame ones); at the weekend it gets the
 *     tutorial and the midday gator clip only.
 *   · YouTube is for the walkthroughs: no gator clip goes there (the Shorts code stays, switched off).
 *   · Two hours between any two posts on an account; four posts a day; the platform back-off
 *     (social-rate.ts) when LinkedIn or Instagram refuses.
 *   · A clip goes to an account once. A post the platform refused is tried again at the next free slot,
 *     never within 12 hours of the refusal. The viral ledger (docs/gator/viral-schedule.json) is the record.
 */
import { SCHEDULE_TZ, addDays, easternLabel, zoneTime } from "../../server/youtube/schedule";
import type { LedgerPost, SocialLedger } from "../tutorials/social-post-lib";
import { GATORS_PER_DAY, mayRetry, rateRefusal, slotAt, type Backoff, type SlotName } from "../tutorials/social-rate";

export type ViralPlatform = "instagram" | "tiktok" | "linkedin" | "youtube";
export const VIRAL_RULES = {
  slots: ["gator-morning", "gator-midday", "gator-evening"] as readonly SlotName[],
  perDay: GATORS_PER_DAY,
  /** A slot closer than this to "now" is left: Blotato wants a future time and the upload takes a while. */
  leadMin: 10,
  /** Days ahead the plan may run. */
  horizonDays: 120,
};
export type ViralClip = { conceptId: string; platforms: Partial<Record<ViralPlatform, { text: string; title?: string; /** The file of the clip's folder this platform gets (default: social.json's clip). */ file?: string }>> };
export type ViralTarget = { id: string; platform: ViralPlatform; name: string };
/** One entry of the viral ledger: a tutorial ledger post's shape, marked with its stream. */
export type ViralLedgerPost = LedgerPost & { stream: "viral"; conceptId: string; aiGenerated: true };
export type ViralLedger = { version: 1; stream: "viral"; timezone: string; posts: ViralLedgerPost[] };
export const emptyViralLedger = (): ViralLedger => ({ version: 1, stream: "viral", timezone: SCHEDULE_TZ, posts: [] });
export type ViralPlanned = { conceptId: string; target: ViralTarget; at: Date; eastern: string; slot: string; text: string; title?: string; file?: string };
export type ViralSkip = { conceptId: string; accountId: string; reason: string };

const MIN = 60000;
/** The Monday of a date's week. */
export const weekOf = (date: string): string => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -((d + 6) % 7)); };
const counts = (p: { status: string }) => p.status !== "failed";

/**
 * The plan: every clip, in the order given, into the next free gator slot of each account that takes it —
 * or the reason it has none. `tutorial` is the tutorial ledger (read, never written); the tutorial slot of
 * every day that has no tutorial cut in that ledger yet is counted as taken (`reserveTutorial`, default on),
 * so the tutorial stream always finds its place.
 */
export function planViral(clips: readonly ViralClip[], targets: readonly ViralTarget[], o: {
  now: Date; viral: ViralLedger; tutorial: SocialLedger; tz?: string; backoffs?: readonly Backoff[]; reserveTutorial?: boolean;
  /** Tutorial posts not yet in the ledger (a plan made in the same run). */
  alsoTutorial?: readonly { accountId: string; at: Date }[];
}): { planned: ViralPlanned[]; skipped: ViralSkip[] } {
  const tz = o.tz ?? SCHEDULE_TZ, planned: ViralPlanned[] = [], skipped: ViralSkip[] = [];
  const today = zoneTime(o.now, tz).date;
  for (const t of targets) {
    if (t.platform === "youtube") { for (const c of clips) skipped.push({ conceptId: c.conceptId, accountId: t.id, reason: "YouTube is for the walkthroughs — no gator clips there" }); continue; }
    const tutorialTimes = [...o.tutorial.posts.filter((p) => p.accountId === t.id && counts(p)).map((p) => new Date(p.scheduledTime ?? p.createdAt).getTime()), ...(o.alsoTutorial ?? []).filter((p) => p.accountId === t.id).map((p) => p.at.getTime())];
    const viralTimes = o.viral.posts.filter((p) => p.accountId === t.id && counts(p)).map((p) => new Date(p.scheduledTime ?? p.createdAt).getTime());
    const onDay = (times: readonly number[], date: string) => times.filter((x) => zoneTime(new Date(x), tz).date === date).length;
    /** Everything on this account at the time a slot is judged: both ledgers, this plan, and the tutorial slots kept free. */
    const timesFor = (date: string): number[] => {
      const all = [...tutorialTimes, ...viralTimes];
      if (o.reserveTutorial !== false) for (const d of [addDays(date, -1), date, addDays(date, 1)]) { const keep = slotAt(d, "tutorial", t.platform, t.id, tz); if (keep && !onDay(tutorialTimes, d) && keep.getTime() > o.now.getTime()) all.push(keep.getTime()); }
      return all;
    };
    // The free gator slots, in order of time.
    let day = today, slotI = 0, guard = 0;
    const nextSlot = (notBefore: number): { at: Date; slot: SlotName } | { why: string } => {
      let why = "";
      for (; guard < VIRAL_RULES.horizonDays * VIRAL_RULES.slots.length; guard++) {
        const name = VIRAL_RULES.slots[slotI], date = day;
        if (++slotI === VIRAL_RULES.slots.length) { slotI = 0; day = addDays(day, 1); }
        const at = slotAt(date, name, t.platform, t.id, tz);
        if (!at) { why = "LinkedIn at the weekend: the midday slot only"; continue; }
        if (at.getTime() < o.now.getTime() + VIRAL_RULES.leadMin * MIN) { why = "the slot has passed"; continue; }
        if (at.getTime() < notBefore) { why = "refused less than 12 hours before"; continue; }
        if (onDay(viralTimes, date) >= VIRAL_RULES.perDay) { why = "the day has its three gator clips"; continue; }
        const rate = rateRefusal(t.platform, at, timesFor(date), undefined, { accountId: t.id, backoffs: o.backoffs, tz });
        if (rate) { why = rate; continue; }
        guard++;
        return { at, slot: name };
      }
      return { why };
    };
    for (const clip of clips) {
      const mine = clip.platforms[t.platform];
      if (!mine) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: t.platform === "linkedin" ? "no LinkedIn version — the clip does not belong there" : `no ${t.platform} post for this clip` }); continue; }
      const before = o.viral.posts.filter((p) => p.conceptId === clip.conceptId && p.accountId === t.id);
      const live = before.find(counts);
      if (live) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: `already ${live.status}${live.postSubmissionId ? ` (${live.postSubmissionId})` : ""}` }); continue; }
      // Refused before: carried to the next free slot — at least 12 hours after the refusal.
      const lastRefused = before.map((p) => new Date(p.createdAt).getTime()).sort((a, b) => b - a)[0];
      const saved = { day, slotI, guard };
      let found = nextSlot(0);
      while (lastRefused !== undefined && "at" in found && !mayRetry(lastRefused, found.at)) found = nextSlot(0);
      if (!("at" in found)) { skipped.push({ conceptId: clip.conceptId, accountId: t.id, reason: `no free gator slot in the next ${VIRAL_RULES.horizonDays} days (${found.why})` }); continue; }
      // A retry that had to wait does not take the earlier slots away from the clips behind it.
      if (lastRefused !== undefined && (saved.day !== day || saved.slotI !== slotI)) { const at = found.at.getTime(); viralTimes.push(at); ({ day, slotI, guard } = saved); }
      else viralTimes.push(found.at.getTime());
      planned.push({ conceptId: clip.conceptId, target: t, at: found.at, eastern: easternLabel(found.at, tz), slot: found.slot, text: mine.text, ...(mine.title ? { title: mine.title } : {}), ...(mine.file ? { file: mine.file } : {}) });
    }
  }
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.target.id.localeCompare(b.target.id));
  return { planned, skipped };
}
