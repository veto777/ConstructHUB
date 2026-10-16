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

/**
 * Why a source couldn't be searched, in the words a customer reads (acceptance run, 2026-10-15). An access refusal
 * (a robots.txt that refuses or can't be read, a bot challenge, a 401/403, a host blocked earlier in the run, a wait
 * too long to take) is "the site refused automated access" (or, for a robots.txt rule, that robots.txt doesn't allow
 * it), not a technical error; an unreadable answer is "the source answered with an unreadable page"; anything else is
 * the error itself.
 */
export function failureReason(err: unknown): { refused: boolean; reason: string } {
  const msg = String((err as { message?: unknown } | null)?.message ?? err);
  if (/robots\.txt disallows|which robots\.txt does not allow/i.test(msg)) return { refused: true, reason: "the site's robots.txt does not allow automated searches" };
  // An answer that isn't the source's own success page (an error body, a malformed or partial table) is not a search:
  // "not searched", never 0 matches (round 8, finding 7).
  if (/the source answered with an unreadable page/i.test(msg)) return { refused: true, reason: "the source answered with an unreadable page" };
  const blocked = (err as { name?: unknown } | null)?.name === "PortalBlockedError";
  if (blocked || /robots\.txt|bot challenge|denied access earlier|ERR_BLOCKED_BY_CLIENT/i.test(msg)) return { refused: true, reason: "the site refused automated access" };
  return { refused: false, reason: msg.slice(0, 200) };
}

/** A source line's note for a search that threw: "Not searched: the site refused automated access", or "Could not search: …". */
export function failureNote(err: unknown): string {
  const f = failureReason(err);
  // The customer reads the plain reason; the server log keeps the technical one (a challenge, a robots.txt that timed
  // out three times, a 403…), so a refusal can be told apart afterwards.
  if (f.refused) console.warn(`[research] not searched (${f.reason}): ${String((err as { message?: unknown } | null)?.message ?? err).slice(0, 300)}`);
  return f.refused ? `Not searched: ${f.reason}` : `Could not search: ${f.reason}`;
}
