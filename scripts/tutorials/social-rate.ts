/**
 * What a young account can take — one rule for BOTH streams (the tutorial cuts and the gator shorts),
 * so neither poster can spend the other's allowance. Pure; tested in server/tutorials/gator.test.ts.
 *
 * Learned on 2026-10-08, the accounts' second day: nine gator posts in ten minutes on top of the day's
 * tutorial cuts got one Instagram post refused ("The Instagram account is restricted") and one LinkedIn
 * post refused ("a share limit has been reached for unverified members").
 *
 *   LinkedIn   at most 3 posts in any rolling 24 hours, until the owner verifies the profile
 *              (then set `until` or remove the rule);
 *   Instagram  at most 4 posts in any rolling 24 hours for the account's first two weeks.
 *
 * A post that Blotato reported as failed did not go out and does not count.
 */
export type RateRule = { max: number; windowHours: number; /** The rule lapses this many days after the account's first post (absent: it stays). */ firstDays?: number; why: string };
export const RATE_RULES: Partial<Record<string, RateRule>> = {
  linkedin: { max: 3, windowHours: 24, why: "LinkedIn's share limit for an unverified profile" },
  instagram: { max: 4, windowHours: 24, firstDays: 14, why: "a new Instagram account is restricted when it posts in bursts" },
};
const HOUR = 3600000;

/**
 * Why a post at `at` may not go out on an account — or null when it may. `times`: when every other
 * post on that account (both streams; published, scheduled or possibly sent) goes or went out.
 * The rule holds for EVERY 24-hour stretch the new post falls in, so a post is also refused when it
 * would overfill the window of one that is already scheduled after it.
 */
export function rateRefusal(platform: string, at: Date | number, times: readonly number[], rules: Partial<Record<string, RateRule>> = RATE_RULES): string | null {
  const rule = rules[platform], t = typeof at === "number" ? at : at.getTime();
  if (!rule) return null;
  const all = [...times, t].sort((a, b) => a - b);
  if (rule.firstDays !== undefined && t - all[0] >= rule.firstDays * 24 * HOUR) return null;
  const w = rule.windowHours * HOUR;
  for (const end of all) {
    if (end < t || end - t >= w) continue;
    const n = all.filter((x) => x > end - w && x <= end).length;
    if (n > rule.max) return `${platform}: that would be ${n} posts in ${rule.windowHours} hours — ${rule.max} at most (${rule.why})`;
  }
  return null;
}
/** The first moment at or after `at` when the post may go out (looking a week ahead), in steps of 15 minutes. */
export function nextAllowed(platform: string, at: Date, times: readonly number[], rules: Partial<Record<string, RateRule>> = RATE_RULES): Date | null {
  for (let t = at.getTime(), end = t + 7 * 24 * HOUR; t <= end; t += 15 * 60000) if (!rateRefusal(platform, t, times, rules)) return new Date(t);
  return null;
}
/** When the posts of one account go or went out, from any number of ledgers (failed ones left out). */
export const accountTimes = (accountId: string, ...ledgers: readonly { posts: readonly { accountId: string; status: string; scheduledTime: string | null; createdAt: string }[] }[]): number[] =>
  ledgers.flatMap((l) => l.posts.filter((p) => p.accountId === accountId && p.status !== "failed").map((p) => new Date(p.scheduledTime ?? p.createdAt).getTime()));
