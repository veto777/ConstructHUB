/**
 * `adverse` on an enforcement record comes only from the publisher's own outcome text (audit 2026-10-15, decision 2):
 *
 *   - no outcome published, or one that says neither way → null (unknown is never turned into a fact);
 *   - dismissed, vacated, withdrawn, reversed, "no penalty", not sustained, … → false, tested BEFORE the adverse words
 *     ("Dismissed, no penalty imposed" contains "penalty");
 *   - a sanction that has ended (a debarment whose period is over) → false;
 *   - revoked, suspended, fined, penalty, debarred, reprimand, probation, … → true.
 *
 * Packs pass their own adverse/not-adverse words when the publisher uses its own vocabulary.
 */

/** Outcomes that are not findings against the business. */
export const NOT_ADVERSE = /\bdismiss|\bvacat|\bwithdr[ae]wn?\b|\bwithdrawal\b|\brevers(?:ed|al)\b|\brescind|\bno (?:civil |administrative |monetary )?(?:penalt|fines?\b|action|violations?\b|discipline|further action|probable cause)|\bnot (?:sustained|substantiated|guilty)|\bunfounded|\bunsubstantiated|\binsufficient evidence|\bfound not\b|\bexonerat|\bacquit|\bclosed without (?:action|discipline|a finding)|\bpenalty waived|\bwaived\b/i;

/** Outcomes that are findings or sanctions. */
export const ADVERSE = /\brevo(?:ked|cation|ke)\b|\bsuspen(?:ded|sion|d)\b|\bfined?\b|\bfines\b|\bpenalt(?:y|ies)\b|\bdebar(?:red|ment)?\b|\bcensure|\breprimand|\bprobation|\bcease (?:and|&) desist|\bguilty\b|\bforfeit|\bsanction|\bsurrender|\bdisciplin|\brestitution|\bstop[- ]work order|\bjudgment against|\bfinal order\b|\bcivil (?:penalty|forfeiture)/i;

export type AdverseOptions = {
  /** The publisher's own words for an adverse outcome (replaces ADVERSE). */
  adverse?: RegExp;
  /** More words that mean not adverse (added to NOT_ADVERSE). */
  notAdverse?: RegExp;
  /** The sanction has ended (a debarment period that is over): not adverse whatever the words. */
  ended?: boolean;
};

/** True / false / null from the publisher's outcome text (see the top of the file). */
export function adverseFrom(outcome: string | null | undefined, opts: AdverseOptions = {}): boolean | null {
  const t = (outcome ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (NOT_ADVERSE.test(t) || opts.notAdverse?.test(t)) return false;
  if (opts.ended) return false;
  return (opts.adverse ?? ADVERSE).test(t) ? true : null;
}

/** A sanction whose end date is before today has ended (YYYY-MM-DD dates; a missing date is not an ending). */
export function hasEnded(endDate: string | null | undefined, today = new Date().toISOString().slice(0, 10)): boolean {
  return !!endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate) && endDate.slice(0, 10) < today;
}
