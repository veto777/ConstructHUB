/**
 * Strict "typed dollars" → cents for the CRM's money inputs.
 *
 *   "$12,500" / "12500" / "12500.5" / "12.5k"  → 1250000 / 1250000 / 1250050 / 1250000
 *   ""                                          → null (no value)
 *   "abc" / "12,50" / "1.234" / "12kk"          → NaN  (invalid — block the save)
 *
 * The old loose parseFloat() read "12k" as $12 and "abc" as "no value", so a
 * typo silently saved the wrong number or wiped the existing one. Callers
 * must treat NaN as "tell the user", never as a value.
 */
const PLAIN = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;
const THOUSANDS = /^\$?\s*(\d+(?:\.\d+)?)\s*[kK]$/;

/** Postgres integer columns hold at most this many cents (~$21.4M). */
export const MAX_CENTS = 2_147_483_647;

export const DOLLAR_INPUT_HINT = "Enter a dollar amount like 12,500 or 12.5k";

export function parseDollarInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let cents: number;
  const k = THOUSANDS.exec(s);
  if (k) {
    cents = Math.round(Number(k[1]) * 1000 * 100);
  } else {
    const m = PLAIN.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined)) return NaN;
    const whole = m[1] ? Number(m[1].replace(/,/g, "")) : 0;
    const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    cents = whole * 100 + frac;
  }
  if (!Number.isFinite(cents) || cents > MAX_CENTS) return NaN;
  return cents;
}

/** The inline message for an input, or null when it parses (blank included). */
export function dollarInputError(raw: string): string | null {
  if (!Number.isNaN(parseDollarInput(raw))) return null;
  const s = raw.trim();
  // Well-formed but rejected → it was over the column limit.
  const tooBig = /\d/.test(s) && (THOUSANDS.test(s) || PLAIN.test(s));
  return tooBig ? "That amount is too large (max $21,474,836)" : DOLLAR_INPUT_HINT;
}
