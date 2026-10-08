/**
 * One web page, one key — used by the server and the page alike, so what is counted, asked for, priced and matched
 * is always the same list. The address as it is, without its fragment (#section is a place on a page, not a page).
 * Nothing else is folded together: /Roof and /roof, /guide and /guide/, ?id=A and ?id=a can all be different pages.
 */
export function pageKey(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 500) return null;
  try { const x = new URL(u); if (x.protocol !== "http:" && x.protocol !== "https:") return null; x.hash = ""; return x.toString(); } catch { return null; }
}
/** Web addresses only, each page once, in the order given. */
export function cleanPageUrls(list: readonly unknown[], max = Infinity): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of list) { const k = pageKey(raw); if (k && !seen.has(k)) { seen.add(k); out.push(k); } }
  return out.slice(0, max);
}
