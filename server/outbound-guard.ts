/**
 * OWNER LAW, 2026-10-15 (after Free Law Project ticketed our "signup blocked by the captcha" email): nothing we send to
 * a platform, PR outlet, news desk, agency, directory or partner may reveal that a bot, a script or an AI is behind
 * ConstructHUB. Every mailbox that writes to outsiders checks its mail here and refuses to send a message that would:
 *   - media@            server/media-inbox/mailbox.ts sendMail (strict)
 *   - support@/social@  scripts/send-email.ts, the only way a one-off email leaves (strict)
 *   - backlink outreach server/backlinks/outreach.ts sendApproved (strict)
 *   - press wire        server/press/worker.ts submissions (hard tells only: the release itself is the customer's news
 *                       and may say "automated" about their own business)
 * Mail to our own customers (receipts, reports, alerts) is not checked: they bought a tool and know what it does.
 */

/** Tells no outside email may ever carry: CAPTCHAs, bot checks, blocked sign-ups, crawling, rate limits, "I'm an AI". */
const HARD_TELL = /\b(re|h)?captcha|\bturnstile\b|\bbot[ -]?(check|detection|protection)|\b(verification|security) (puzzle|challenge|check)|\bprove (we|i|that we|that i)('re| are|'m| am)? (a )?human|\bhuman verification|\b(sign[ -]?up|registration|account creation|log[ -]?in|access)( (page|form))? (was |is |got |keeps )?(blocked|failing|failed|rejected)|\bblocked (us|our (sign[ -]?up|account|access|requests?))|\bscrap(er|ers|ing)\b|\bcrawl(ed|er|ers|ing)\b|\bheadless\b|\brobots\.txt\b|\brate[ -]?limit|\buser[ -]agent\b/i;
const HARD_AI = /\b(as an ai|an ai (language )?model|i('| a)?m an ai|we('| a)?re an ai|language model|ai (assistant|agent) (wrote|sent|drafted))\b/i;

/** Our own outreach adds: anything "automated", a script or bot of ours, and naming an AI provider. */
const STRICT_TELL = /\bautomat(ed|ion|ically)\b|\b(our|a|the) (bot|script|crawler|scraper|spider)s?\b|\bprogrammatic(ally)?\b/i;
const STRICT_AI = /\b(chatgpt|openai|truthcoder|anthropic|claude)\b/i;

export type BotTellLevel = "strict" | "hard";

/** Why outgoing text would tell an outsider a bot, a script or an AI is behind it, or null when it reads clean. */
export function botTellProblem(text: string, level: BotTellLevel = "strict"): string | null {
  if (HARD_AI.test(text) || (level === "strict" && STRICT_AI.test(text))) return "The email talks about being an AI or names an AI provider";
  const m = text.match(HARD_TELL) ?? (level === "strict" ? text.match(STRICT_TELL) : null);
  return m ? `The email gives away that a bot or a script is behind it ("${m[0]}")` : null;
}

export class BotTellError extends Error {
  constructor(public to: string, public problem: string) {
    super(`Refused to send to ${to}: ${problem} (OWNER LAW 2026-10-15: never reveal a bot to an outsider)`);
    this.name = "BotTellError";
  }
}

/** Throws BotTellError when the subject or body would give a bot away. */
export function assertNoBotTell(m: { to: string; subject: string; body: string }, level: BotTellLevel = "strict"): void {
  const problem = botTellProblem(`${m.subject}\n${m.body}`, level);
  if (problem) throw new BotTellError(m.to, problem);
}
