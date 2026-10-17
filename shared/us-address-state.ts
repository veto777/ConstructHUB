/**
 * Which US state an address is in — read from what the address itself says, never guessed.
 *
 * Three readings, all deterministic:
 *   1. an explicit state field ("WA", "Florida");
 *   2. the state written at the END of a free-text address ("5590 Starry Rd. Bellingham, WA 98226",
 *      "CPM - James St job Bellingham WA") — only at the end, so "Washington St" mid-line never counts;
 *   3. the ZIP code's 3-digit USPS prefix (98226 → WA, 34690 → FL).
 * Anything else (names, phone area codes, which website a form came from) is not an address and is not read.
 */
import { normalizeUsState } from "./divisions";

/** USPS 3-digit ZIP prefix ranges by state (inclusive). Military/territory prefixes map to nothing. */
const ZIP_PREFIX_RANGES: [number, number, string][] = [
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 59, "VT"], [60, 69, "CT"],
  [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"],
  [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 339, "FL"], [341, 342, "FL"], [344, 344, "FL"], [346, 347, "FL"], [349, 349, "FL"],
  [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"],
  [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"],
  [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 715, "LA"], [716, 729, "AR"],
  [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"],
  [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [889, 898, "NV"], [900, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

/** State of a ZIP (5 digits, optional +4), or null. */
export function stateFromZip(raw: string | null | undefined): string | null {
  const m = /\b(\d{5})(?:-\d{4})?\b/.exec(String(raw ?? ""));
  if (!m) return null;
  const prefix = Number(m[1].slice(0, 3));
  for (const [lo, hi, st] of ZIP_PREFIX_RANGES) if (prefix >= lo && prefix <= hi) return st;
  return null;
}

/**
 * State written at the end of a free-text address, or carried by its ZIP. A trailing state and a trailing
 * ZIP that disagree → null (a typo is not evidence either way).
 */
export function stateFromAddressText(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().replace(/[.,;\s]+$/, "");
  if (!s) return null;
  const m = /(?:^|[\s,])([A-Za-z]{2}|[A-Za-z]+(?: [A-Za-z]+)?)\.?(?:,?\s+(\d{5}(?:-\d{4})?))?(?:,?\s*(?:USA|US|United States))?$/i.exec(s);
  let named: string | null = null;
  if (m) {
    // A two-letter code must be upper case to count ("WA" — not "Co" in "Hillsborough Co").
    const asState = (w: string) => (w.length === 2 && w !== w.toUpperCase() ? null : normalizeUsState(w));
    // Two-word names first ("New York"), then the last word alone ("Bellingham WA" → WA).
    named = (m[1].includes(" ") ? normalizeUsState(m[1]) : null) ?? asState(m[1].split(" ").pop()!);
  }
  const zip = stateFromZip(m?.[2] ?? (/\b\d{5}(?:-\d{4})?$/.test(s) ? s : null));
  if (named && zip && named !== zip) return null;
  return named ?? zip;
}

/** First state any of these address fragments gives (explicit field first, then ZIP, then free text). */
export function stateOfAddress(a: {
  state?: string | null; postalCode?: string | null; addressLine1?: string | null; city?: string | null; text?: string | null;
}): string | null {
  return normalizeUsState(a.state)
    ?? stateFromZip(a.postalCode)
    ?? stateFromAddressText([a.addressLine1, a.city].filter(Boolean).join(", "))
    ?? stateFromAddressText(a.text);
}
