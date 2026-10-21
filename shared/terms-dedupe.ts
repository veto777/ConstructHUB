/**
 * Estimates used to copy the org's terms into their own "estimate terms" at creation, and the company terms are
 * copied separately too, so the client saw the same terms twice (owner, 2026-10-21). Two terms texts count as the
 * same document when, ignoring spacing and case, one contains the other or they share their opening (an older and
 * a newer copy of the same terms). Then only the company terms are shown.
 */
export function isSameTerms(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const opening = (s: string) => s.slice(0, 200);
  return y.includes(opening(x)) || x.includes(opening(y));
}
