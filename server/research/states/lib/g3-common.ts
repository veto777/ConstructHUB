/**
 * Small helpers shared by the g3 state packs (VA, WV, NC, SC, GA, TN). Nothing here holds data: every URL, field
 * and code lives in the state file or vendor helper that uses it, with the date it was checked.
 */
import { promises as fs } from "node:fs";
import { clean } from "../../bulk";
import { decodeEntities } from "../../bulk-sources";
import { personText } from "../../person-name";
import { tokens } from "../../licenses";

/** Yield from a downloaded temp file, then delete it. */
export async function* fromFile<T>(path: string, fn: (p: string) => AsyncIterable<T>): AsyncIterable<T> {
  try { yield* fn(path); } finally { await fs.rm(path, { force: true }); }
}

/** Visible text of an HTML fragment: tags dropped, <br> as a space, entities decoded, whitespace collapsed. */
export const htmlText = (v: string | null | undefined): string | null =>
  v == null ? null : clean(decodeEntities(v.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

/**
 * A person-name cell as text (round 6, decision 3): like the helper above, but a <br> between two names stays a list
 * (written " / ", ../../person-name.ts), so "Jane Smith<br>John Doe" is never read as one person. Whitespace in the
 * page source is not a separator; only the <br> is.
 */
export const htmlPerson = (v: string | null | undefined): string | null =>
  v == null ? null : personText(decodeEntities(v.replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")));

/** Every word of the searched name is a whole word of one of the candidate names ("Smith" is not "Locksmith"). */
export function hasAllWords(name: string, ...candidates: (string | null | undefined)[]): boolean {
  const want = tokens(name);
  if (!want.length) return false;
  return candidates.some((c) => { const have = new Set(tokens(c ?? "")); return want.every((w) => have.has(w)); });
}

/** DD-MM-YYYY → YYYY-MM-DD (WV Fire Marshal API dates); anything else → null. */
export function dmyDate(v: string | null | undefined): string | null {
  const m = v?.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m && Number(m[3]) >= 1900 ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** M/D/YYYY or YYYY-MM-DD → YYYY-MM-DD; anything else → null. */
export function anyDate(v: string | null | undefined): string | null {
  const t = v?.trim() ?? "";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) >= 1900 ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us && Number(us[3]) >= 1900 ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}
