/**
 * The Call Assistant Results panel's period, shared by the panel (client/src/pages/crm-call-assistant/results.tsx)
 * and the summary route that parses it (server/voice/calls.ts), so the typed-days limit lives in one place.
 */

/** The longest period the owner can type, in days. */
export const CALL_RESULTS_MAX_DAYS = 365;

export type CallResultsPreset = "7d" | "30d" | "month" | "all";
export type CallResultsRange = CallResultsPreset | `${number}d`;

/** The Results panel's period: a preset, or "<1..365>d" for a number of days the owner typed (anything else → 30d). */
export function parseCallResultsRange(raw: unknown): CallResultsRange {
  const v = String(raw ?? "");
  if (v === "7d" || v === "30d" || v === "month" || v === "all") return v;
  const m = /^(\d{1,3})d$/.exec(v);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= CALL_RESULTS_MAX_DAYS ? (`${n}d` as CallResultsRange) : "30d";
}
