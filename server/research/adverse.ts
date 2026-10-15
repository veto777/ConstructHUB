/**
 * `adverse` on an enforcement record comes only from the publisher's own outcome text, and only from a clean match
 * (audit 2026-10-15, decision 2; round 2, decision 4):
 *
 *   - no outcome published, or one that says neither way → null (unknown is never turned into a fact);
 *   - a negated sanction ("not revoked", "no suspension", "without penalty") → null;
 *   - words of both kinds ("License revoked; hearing waived", "Dismissed, penalty paid") → null;
 *   - only not-adverse words (dismissed, vacated, withdrawn, reversed, not sustained, …) → false;
 *   - only sanction words (revoked, suspended, fined, penalty, debarred, reprimand, probation, …) → true, or false
 *     when the sanction has ended (a debarment whose period is over).
 *
 * Packs pass their own adverse/not-adverse words when the publisher uses its own vocabulary; the same rules apply.
 */

/** Outcomes that are not findings against the business. */
export const NOT_ADVERSE = /\bdismiss|\bvacat|\bwithdr[ae]wn?\b|\bwithdrawal\b|\brevers(?:ed|al)\b|\brescind|\bno (?:action|violations?\b|further action|probable cause|cause\b)|\bnot (?:sustained|substantiated|guilty)|\bunfounded|\bunsubstantiated|\binsufficient evidence|\bfound not\b|\bexonerat|\bacquit|\bclosed without (?:action|a finding)|\bwaived\b/i;

/** Outcomes that are findings or sanctions. */
export const ADVERSE = /\brevo(?:ked|cation|ke)\b|\bsuspen(?:ded|sion|d)\b|\bfined?\b|\bfines\b|\bpenalt(?:y|ies)\b|\bdebar(?:red|ment)?\b|\bcensure|\breprimand|\bprobation|\bcease (?:and|&) desist|\bguilty\b|\bforfeit|\bsanction|\bsurrender|\bdisciplin|\brestitution|\bstop[- ]work order|\bjudgment against|\bfinal order\b|\bcivil (?:penalty|forfeiture)/i;

/**
 * A sanction word under a negation: "not revoked", "no suspension", "without a penalty", "no civil penalty",
 * "never disciplined", "closed without discipline". Up to two words may sit between ("no monetary penalty imposed").
 */
const NEGATOR = /\b(?:not|no|never|without|none|nor)\b(?:\s+[a-z-]+){0,2}?\s+$/i;

export type AdverseOptions = {
  /** The publisher's own words for an adverse outcome (replaces ADVERSE). */
  adverse?: RegExp;
  /** More words that mean not adverse (added to NOT_ADVERSE). */
  notAdverse?: RegExp;
  /** The sanction has ended (a debarment period that is over): false when the text is otherwise a clean sanction. */
  ended?: boolean;
};

const global = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");

/** True / false / null from the publisher's outcome text (see the top of the file). */
export function adverseFrom(outcome: string | null | undefined, opts: AdverseOptions = {}): boolean | null {
  const t = (outcome ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Spans of not-adverse wording: a sanction word inside one ("not guilty") is part of it, not a sanction.
  const spans = [NOT_ADVERSE, ...(opts.notAdverse ? [opts.notAdverse] : [])].flatMap((re) => Array.from(t.matchAll(global(re)), (m) => [m.index!, m.index! + m[0].length]));
  const cleared = spans.length > 0;
  let sanction = false;
  for (const m of t.matchAll(global(opts.adverse ?? ADVERSE))) {
    const [a, b] = [m.index!, m.index! + m[0].length];
    if (spans.some(([x, y]) => a < y && b > x)) continue;
    // A negated sanction is not a clean answer either way.
    if (NEGATOR.test(t.slice(Math.max(0, a - 40), a))) return null;
    sanction = true;
  }
  if (sanction && cleared) return null;
  if (cleared) return false;
  if (sanction) return opts.ended ? false : true;
  return null;
}

/** A sanction whose end date is before today has ended (YYYY-MM-DD dates; a missing date is not an ending). */
export function hasEnded(endDate: string | null | undefined, today = new Date().toISOString().slice(0, 10)): boolean {
  return !!endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate) && endDate.slice(0, 10) < today;
}
