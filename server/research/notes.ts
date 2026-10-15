/**
 * Notes a search attaches to its results (audit 2026-10-15, decision 9: a search that stops at a cap says so). A
 * live search returns its hits as usual; when it stopped early it returns them through withNote(), and the runner
 * and ./registry add the note to the source's line in the report ("showing the first 10 of 34 matches").
 */
export type Noted<T> = T[] & { note?: string };

/** The list with a note attached (no note: the list unchanged). Several notes join with "; ". */
export function withNote<T>(list: T[], note: string | null | undefined): Noted<T> {
  if (!note) return list as Noted<T>;
  const prev = (list as Noted<T>).note;
  return Object.assign(list, { note: prev && prev !== note ? `${prev}; ${note}` : note });
}

/** The note a search attached to its results, if any. */
export const noteOf = (list: unknown): string | null => {
  const n = (list as { note?: unknown } | null)?.note;
  return typeof n === "string" && n ? n : null;
};

/** "showing the first 10 of 34 matches" (total unknown: "showing the first 10 matches; there are more"). */
export function capNote(shown: number, total?: number | null, what = "matches"): string {
  return total != null && total > shown ? `showing the first ${shown} of ${total} ${what}` : `showing the first ${shown} ${what}; there are more`;
}

/** A value made safe to put inside a RegExp. */
export const escapeRegExp = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** decodeURIComponent that leaves a malformed sequence (a stray "%") as it is instead of throwing. */
export function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v.replace(/%([0-9A-Fa-f]{2})/g, (m, h) => { try { return decodeURIComponent(m); } catch { return m; } }); }
}
