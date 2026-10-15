/**
 * One person per name field, judged on the field AS PUBLISHED (round 5, decision 4; round 6, decision 3). Flipping
 * "LAST, FIRST" or collapsing whitespace first would hide a list: "J Smith, John Doe" flipped is "John Doe J Smith",
 * and "Jane Smith\nJohn Doe" collapsed is "Jane Smith John Doe". So every place that turns a published name field
 * into a person's name goes through personText or flipPerson, and a field that is not one person keeps its separators
 * (a line break becomes " / "), so no later check can read one person's match from it.
 */

const GENERATION = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/**
 * True when a name field is ONE person: no list separator ("/", "&", ";", " and ", a line break), at most two comma
 * parts ("LAST, FIRST [M]", one surname word before the comma, initials counted as words; a trailing generational
 * suffix such as ", Jr." aside) and at most four name words. Anything else is a list of people.
 */
export function onePersonField(field: string): boolean {
  const raw = field.replace(/\s+/g, " ").trim();
  if (!raw || /[\/&;\r\n]|\band\b/i.test(field)) return false;
  const t = raw.replace(/,\s*(?:jr|sr|ii|iii|iv)\.?\s*(?=,|$)/gi, "").trim();
  const words = (v: string) => v.split(/[\s.,]+/).filter((w) => /[a-z]/i.test(w) && !GENERATION.has(w.toUpperCase()));
  if (words(t).length > 4) return false;
  const parts = t.split(",");
  if (parts.length === 1) return true;
  if (parts.length !== 2 || !parts[1].trim()) return false;
  return words(parts[0]).length === 1;
}

/**
 * A published name field as text: one person → whitespace collapsed; a list → as published, with each line break
 * written " / " (so it stays a list to onePersonField). Null for an empty field.
 */
export function personText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const lines = String(raw).split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  return lines.length ? lines.join(" / ") : null;
}

/**
 * "LAST, FIRST M" → "FIRST M LAST" for a field that is one person; a list is returned as personText (never flipped,
 * never joined into one name). Other single-person forms are returned with whitespace collapsed.
 */
export function flipPerson(raw: string | null | undefined): string | null {
  const t = personText(raw);
  if (!t || !onePersonField(String(raw))) return t;
  const m = t.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}`.replace(/\s+/g, " ").trim() : t;
}
