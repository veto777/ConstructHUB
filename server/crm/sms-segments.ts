/**
 * How many SMS segments a text costs — the unit the plan's monthly text
 * allowance counts (shared/plans.ts teamTextSegments) and the unit the carrier
 * bills. Pure: no env, no db.
 *
 * A body made only of GSM 03.38 characters fits 160 in one segment and 153 per
 * segment after that (the concatenation header takes the rest); the extension
 * characters (^ { } \ [ ~ ] | € and form feed) cost two each. One character
 * outside GSM-7 (an emoji, a curly quote, most accented capitals) switches the
 * whole text to UCS-2: 70 in one segment, 67 per segment after, counted in
 * UTF-16 code units (an emoji is two). A text is never fewer than one segment.
 */

const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM7_EXTENSION = new Set("\f^{}\\[~]|€");

/** Characters per segment: a single-segment text, then each part of a longer one. */
export const SMS_SEGMENT_SIZES = {
  gsm7: { single: 160, multi: 153 },
  ucs2: { single: 70, multi: 67 },
} as const;

export type SmsEncoding = keyof typeof SMS_SEGMENT_SIZES;

/** GSM-7 when every character is in the GSM 03.38 tables, otherwise UCS-2. */
export function smsEncoding(body: string): SmsEncoding {
  for (const ch of body) if (!GSM7_BASIC.has(ch) && !GSM7_EXTENSION.has(ch)) return "ucs2";
  return "gsm7";
}

/** Segments the carrier splits `body` into (at least 1). */
export function smsSegments(body: string): number {
  const encoding = smsEncoding(body);
  let units = 0;
  if (encoding === "gsm7") {
    for (const ch of body) units += GSM7_EXTENSION.has(ch) ? 2 : 1;
  } else {
    units = body.length; // UTF-16 code units: what UCS-2 carries
  }
  const { single, multi } = SMS_SEGMENT_SIZES[encoding];
  return units <= single ? 1 : Math.ceil(units / multi);
}
