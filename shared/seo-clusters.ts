/**
 * Keywords grouped by the words they share — "roof repair cost", "roof repair near me" and "emergency roof repair"
 * under "roof repair". Worked out from the keywords themselves, so it is free and instant; it is a reading aid for
 * planning pages, not a statement that Google shows the same results for every keyword in a group.
 */
const STOP = new Set(["a", "an", "and", "are", "at", "be", "best", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it", "me", "much", "my", "near", "of", "on", "or", "the", "to", "top", "vs", "what", "when", "where", "which", "who", "why", "with", "you", "your"]);
/**
 * Plural and singular are one word: "roofs" and "roof", "companies" and "company", "businesses" and "business",
 * "boxes" and "box", "patios" and "patio". Deliberately no more than that — and words that only look plural
 * ("glass", "gas", "bus", "analysis") are left alone.
 */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is|as)$/.test(w)) return w.slice(0, -1);
  return w;
}
/** The words of a keyword: lower case, a possessive 's dropped ("company's" is "company"), filler words left out. */
const words = (keyword: string) => keyword.toLowerCase().replace(/['’]s\b/g, "").replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));

export type KeywordCluster<T> = {
  /** The shared words; null for the keywords left over (they share nothing, or the limit of groups was reached). */ term: string | null; rows: T[];
  /** Searches a month across the keywords of the group that HAVE a figure; null when none has. See `measured`. */ volume: number | null;
  /** How many of the group's keywords have a figure: when fewer than rows.length, `volume` is a part, not the whole. */ measured: number;
};
export const CLUSTER_MAX = 40;

/**
 * Greedy and deterministic: the words (one, or two in a row) shared by the most not-yet-grouped keywords make the next
 * group, two words in a row being preferred to one when they cover at least two thirds as many. A word that is in
 * nearly every keyword (the topic that was searched) says nothing and is skipped. Groups of fewer than `minSize` are
 * not made; what is left over is returned last with `term: null`. Largest volume first.
 */
export function clusterKeywords<T extends { keyword: string; volume: number | null }>(rows: readonly T[], minSize = 2): KeywordCluster<T>[] {
  const items = rows.map((row) => {
    const w = words(row.keyword), stems = w.map(stem);
    const terms = new Set<string>(stems);
    for (let i = 0; i + 1 < stems.length; i++) terms.add(`${stems[i]} ${stems[i + 1]}`);
    return { row, terms, surface: w, stems };
  });
  // How each term is written most often, for the heading.
  const written = new Map<string, Map<string, number>>();
  const note = (term: string, as: string) => { const m = written.get(term) ?? written.set(term, new Map()).get(term)!; m.set(as, (m.get(as) ?? 0) + 1); };
  for (const it of items) { it.stems.forEach((s, i) => note(s, it.surface[i])); for (let i = 0; i + 1 < it.stems.length; i++) note(`${it.stems[i]} ${it.stems[i + 1]}`, `${it.surface[i]} ${it.surface[i + 1]}`); }
  const label = (term: string) => [...(written.get(term) ?? new Map([[term, 1]])).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
  const everywhere = new Set<string>();
  if (items.length >= 5) { const df = new Map<string, number>(); for (const it of items) for (const t of it.terms) df.set(t, (df.get(t) ?? 0) + 1); for (const [t, n] of df) if (n > items.length * 0.8) everywhere.add(t); }

  const left = new Set(items), out: KeywordCluster<T>[] = [];
  const sum = (list: T[]) => { const v = list.map((r) => r.volume).filter((n): n is number => typeof n === "number"); return { volume: v.length ? v.reduce((a, b) => a + b, 0) : null, measured: v.length }; };
  // Compared by code point, not by the reader's language settings: the same list gives the same groups everywhere.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  while (left.size && out.length < CLUSTER_MAX) {
    const df = new Map<string, number>();
    for (const it of left) for (const t of it.terms) if (!everywhere.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    let best: string | null = null, bestScore = 0;
    for (const [t, n] of df) {
      if (n < minSize) continue;
      const score = n * (t.includes(" ") ? 1.5 : 1);
      if (score > bestScore || (score === bestScore && best !== null && cmp(t, best) < 0)) { best = t; bestScore = score; }
    }
    if (best === null) break;
    const members = [...left].filter((it) => it.terms.has(best!));
    for (const m of members) left.delete(m);
    out.push({ term: label(best), rows: members.map((m) => m.row), ...sum(members.map((m) => m.row)) });
  }
  out.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || b.rows.length - a.rows.length || cmp(String(a.term), String(b.term)));
  if (left.size) { const rest = items.filter((it) => left.has(it)).map((it) => it.row); out.push({ term: null, rows: rest, ...sum(rest) }); }
  return out;
}
