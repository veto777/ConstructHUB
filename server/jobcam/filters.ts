/**
 * Tag + search filter rules — pure (filters.test.ts). Tag names are stored
 * as typed (case kept for display) and matched case-insensitively by
 * normalising both sides here; AND = every filter tag on the media, OR = any.
 */

/** Trim, collapse spaces, dedupe case-insensitively, keep first spelling; drop empties. */
export function normalizeTags(raw: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = String(r ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export type TagMode = "and" | "or";

export function normalizeTagFilter(mode: string | null | undefined): TagMode {
  return String(mode ?? "").toLowerCase() === "or" ? "or" : "and";
}

/** Does a media row's tag list satisfy the filter? (The SQL does the same with && / @>.) */
export function matchesTagFilter(mediaTags: readonly string[] | null | undefined, filter: readonly string[], mode: TagMode): boolean {
  const want = normalizeTags(filter).map((t) => t.toLowerCase());
  if (!want.length) return true;
  const have = new Set((mediaTags ?? []).map((t) => t.toLowerCase()));
  return mode === "or" ? want.some((t) => have.has(t)) : want.every((t) => have.has(t));
}

/** Plain-text search: every whitespace-separated term must appear in one of the haystacks. */
export function matchesSearch(q: string | null | undefined, haystacks: readonly (string | null | undefined)[]): boolean {
  const terms = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = haystacks.map((h) => String(h ?? "").toLowerCase()).join(" \n ");
  return terms.every((t) => text.includes(t));
}
