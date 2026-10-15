/**
 * `adverse` on an enforcement record comes only from the publisher's own outcome text, and only from a clean match
 * (audit 2026-10-15, decision 2; round 2, decision 4):
 *
 *   - no outcome published, or one that says neither way → null (unknown is never turned into a fact);
 *   - a negated sanction or a negated clearance, on either side ("not revoked", "no suspension", "without penalty",
 *     "fine not imposed", "case not dismissed") → null; so is any other negation word in the outcome's clause
 *     ("Disciplinary action has still not been taken", "Not subject to any discipline"; round 5, decision 1);
 *   - a reversal or suspension of the outcome ("lifted", "rescinded", "reversed", "set aside", "stayed", "vacated",
 *     "overturned") → null: what stands afterwards isn't stated (round 3, decision 6);
 *   - words of both kinds ("License revoked; hearing waived", "Dismissed, penalty paid") → null;
 *   - only not-adverse words (dismissed, withdrawn, not sustained, unfounded, …) → false;
 *   - only sanction words (revoked, suspended, fined, penalty, debarred, reprimand, probation, …) → true, or false
 *     when the sanction has ended (a debarment whose period is over).
 *
 * Packs pass their own adverse/not-adverse words when the publisher uses its own vocabulary; the same rules apply.
 */

/** Outcomes that are not findings against the business. */
export const NOT_ADVERSE = /\bdismiss|\bwithdr[ae]wn?\b|\bwithdrawal\b|\bno (?:action|violations?\b|further action|probable cause|cause\b)|\bnot (?:sustained|substantiated|guilty)|\bunfounded|\bunsubstantiated|\binsufficient evidence|\bfound not\b|\bexonerat|\bacquit|\bclosed without (?:action|a finding)|\bwaived\b/i;

/** Outcomes that are findings or sanctions. */
export const ADVERSE = /\brevo(?:ked|cation|ke)\b|\bsuspen(?:ded|sion|d)\b|\bfined?\b|\bfines\b|\bpenalt(?:y|ies)\b|\bdebar(?:red|ment)?\b|\bcensure|\breprimand|\bprobation|\bcease (?:and|&) desist|\bguilty\b|\bforfeit|\bsanction|\bsurrender|\bdisciplin|\brestitution|\bstop[- ]work order|\bjudgment against|\bfinal order\b|\bcivil (?:penalty|forfeiture)/i;

/** Words that undo or hold an outcome: the record doesn't say what stands afterwards. */
export const REVERSAL = /\blift(?:ed|ing)?\b|\brescind|\brevers(?:ed|al|ing)\b|\bset aside\b|\bstay(?:ed|s)?\b|\bvacat|\boverturn|\bannul/i;

/**
 * A negation right after a word, or after the one word it describes: "fine not imposed", "dismissal was not granted",
 * "penalty never assessed", "disciplinary action was never taken".
 */
const NEGATED_AFTER = /^\s+(?:[a-z-]+\s+)?(?:(?:was|were|is|has|have|had|been|be|being)\s+)*(?:not|never|no longer)\b/i;

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

/**
 * Where the matched word really ends: several patterns match a stem ("dismiss", "disciplin"), and a negation is read
 * after the whole word ("Dismissal not granted", "Discipline not imposed"), not inside its suffix.
 */
const wordEnd = (t: string, b: number) => b + (/^[a-z]*/i.exec(t.slice(b))?.[0].length ?? 0);

/**
 * A negation word: anywhere in an outcome's clause (outside a not-adverse phrase) it leaves the outcome unknown. "No."
 * before a number or license ID ("license No. BC807216", "No. 12") is the abbreviation for number, not a negation.
 */
const NEGATION = /\b(?:not|never|without|none|nor|neither|non)\b|\bno\b(?!\.\s*(?:#|\d|[a-z]{1,4}-?\d))|n't\b/gi;

/**
 * Abbreviations of five letters or more ("Admin.", "Amend.", "Subsec."): shorter words never end a clause at a period
 * (outcomeClauses), so only these need listing. Lowercase, without the period.
 */
const ABBREVIATIONS = new Set("admin approx amend amdts subsec subch subpt sched suppl assoc depts viols stats regul compl dismd revkd suspd".split(" "));

/**
 * The outcome text cut into clauses at ; ! ? and line breaks, and at a period only where it surely ends a sentence
 * (round 6, decision 1): after a number ("Fined $500. Appeal not filed") or a word of five letters or more that is no
 * abbreviation, and before a capital letter or the end. A period after an abbreviation, an initial, a short word or a
 * word with dots inside ("Sec.", "Lic.", "No.", "U.S.") doesn't end the clause: when in doubt the clauses stay
 * together, which only makes a negation in them count (null), never drops one.
 */
export function outcomeClauses(t: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    let end = /[;!?\n]/.test(c);
    if (c === ".") {
      const before = /([A-Za-z0-9$,.'’-]+)$/.exec(t.slice(from, i))?.[1] ?? "";
      const after = t.slice(i + 1);
      const word = before.replace(/^[$]/, "");
      const number = /^\d[\d,]*(?:\.\d+)?$/.test(word);
      const plainWord = /^[A-Za-z]{5,}$/.test(word) && !ABBREVIATIONS.has(word.toLowerCase());
      end = (number || plainWord) && (/^\s*$/.test(after) || /^\s+["'(]?[A-Z]/.test(after));
    }
    if (end) { out.push(t.slice(from, i + 1)); from = i + 1; }
  }
  if (from < t.length) out.push(t.slice(from));
  return out;
}

/** True when a clause (outcomeClauses) holds an outcome word and a negation outside the not-adverse phrases. */
function negatedClause(t: string, spans: number[][], opts: AdverseOptions): boolean {
  const outcome = new RegExp(`${(opts.adverse ?? ADVERSE).source}|${NOT_ADVERSE.source}${opts.notAdverse ? `|${opts.notAdverse.source}` : ""}`, "i");
  let start = 0;
  for (const clause of outcomeClauses(t)) {
    const [a, b] = [start, start + clause.length];
    start = b;
    if (!outcome.test(clause)) continue;
    // A source's own outcome phrase may carry its negation too (WA L&I "Not Satisfied": a penalty still owed).
    const own = opts.adverse ? Array.from(clause.matchAll(global(opts.adverse)), (m) => [a + m.index!, a + m.index! + m[0].length]) : [];
    for (const m of clause.matchAll(NEGATION)) {
      const at = a + m.index!;
      if (![...spans, ...own].some(([x, y]) => at >= x && at < y)) return true;
    }
  }
  return false;
}

/** True / false / null from the publisher's outcome text (see the top of the file). */
export function adverseFrom(outcome: string | null | undefined, opts: AdverseOptions = {}): boolean | null {
  const t = (outcome ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (REVERSAL.test(t)) return null;
  const negated = (a: number, b: number) => NEGATOR.test(t.slice(Math.max(0, a - 40), a)) || NEGATED_AFTER.test(t.slice(b, b + 40));
  // Spans of not-adverse wording: a sanction word inside one ("not guilty") is part of it, not a sanction.
  const spans = [NOT_ADVERSE, ...(opts.notAdverse ? [opts.notAdverse] : [])].flatMap((re) => Array.from(t.matchAll(global(re)), (m) => [m.index!, wordEnd(t, m.index! + m[0].length)]));
  // A negated clearance ("case not dismissed") is not a clean answer either way.
  if (spans.some(([a, b]) => negated(a, b))) return null;
  // Any other negation word in a clause that holds an outcome makes it uncertain (round 5, decision 1): "Disciplinary
  // action has still not been taken", "Not subject to any discipline". Only a recognized not-adverse phrase ("no
  // action", "not sustained") may carry its own negation.
  if (negatedClause(t, spans, opts)) return null;
  const cleared = spans.length > 0;
  let sanction = false;
  for (const m of t.matchAll(global(opts.adverse ?? ADVERSE))) {
    const [a, b] = [m.index!, wordEnd(t, m.index! + m[0].length)];
    if (spans.some(([x, y]) => a < y && b > x)) continue;
    // A negated sanction ("not revoked", "fine not imposed") is not a clean answer either way.
    if (negated(a, b)) return null;
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
