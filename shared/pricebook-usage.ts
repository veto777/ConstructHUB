/**
 * Price-book memory (owner, 2026-10-21: "create a memory of what is used the most often and what is not pushed to
 * the bottom. Also if prices are adjusted for any reason the form saves it").
 *
 * Per org + price-book item (crm_pricebook_usage, server/crm/pricebook-usage.ts):
 *   useCount       estimates the item was used on — counted once per estimate, on save/autosave, never per keystroke
 *   lastUsedAt     the tiebreaker
 *   lastPriceCents the unit price it was last billed at (e.g. Siding Remodel listed $25/sf, billed $16.50)
 *   lastDescription / lastUnit  the scope text and unit it was last billed with
 *
 * The picker prefills the last-used price and scope, shows "$16.50 last used · $25 list", and offers
 * "Update price book to $16.50" — the list price is never overwritten silently.
 */

export type PricebookUsage = {
  useCount: number;
  lastUsedAt: string | null;
  lastPriceCents: number | null;
  lastDescription: string | null;
  lastUnit: string | null;
};

export type RankableItem = { name: string; code?: string | null } & Partial<PricebookUsage>;

/** Text relevance for a typed query: 3 exact, 2 starts with, 1 a word starts with, 0.5 contains, 0 no match. */
export function textRelevance(item: { name: string; code?: string | null }, q: string): number {
  const query = q.trim().toLowerCase();
  if (!query) return 0;
  const name = item.name.toLowerCase();
  const code = (item.code ?? "").toLowerCase();
  if (name === query || code === query) return 3;
  if (name.startsWith(query) || code.startsWith(query)) return 2;
  if (name.split(/[\s\-/(),]+/).some((w) => w.startsWith(query))) return 1;
  if (name.includes(query) || code.includes(query)) return 0.5;
  return 0;
}

/**
 * Order for the estimate line picker. Without a query: most-used first, most recent as the tiebreaker, never-used
 * items last in their incoming order. With a query: text relevance first, then the same usage order.
 * Stable: equal items keep their incoming order.
 */
export function rankPricebookItems<T extends RankableItem>(items: T[], q = ""): T[] {
  const query = q.trim();
  return items
    .map((it, idx) => ({ it, idx, rel: query ? textRelevance(it, query) : 0 }))
    .sort((a, b) => {
      if (query && b.rel !== a.rel) return b.rel - a.rel;
      const ua = a.it.useCount ?? 0, ub = b.it.useCount ?? 0;
      if ((ua > 0) !== (ub > 0)) return ub > 0 ? 1 : -1;
      if (ub !== ua) return ub - ua;
      const ta = a.it.lastUsedAt ? Date.parse(a.it.lastUsedAt) : 0;
      const tb = b.it.lastUsedAt ? Date.parse(b.it.lastUsedAt) : 0;
      if (tb !== ta) return tb - ta;
      return a.idx - b.idx;
    })
    .map((x) => x.it);
}

/** The price a picked item should prefill: the last price it was billed at, else its list price. */
export function prefillPrice(listPriceCents: number | null, usage: Partial<PricebookUsage> | null | undefined): number | null {
  if (usage?.lastPriceCents != null && (usage.useCount ?? 0) > 0) return usage.lastPriceCents;
  return listPriceCents;
}

/** "$16.50 last used · $25 list" when the last price differs from the list price, else null. */
export function lastUsedLabel(listPriceCents: number | null, usage: Partial<PricebookUsage> | null | undefined, unit?: string | null): string | null {
  if (!usage || usage.lastPriceCents == null || !(usage.useCount ?? 0)) return null;
  if (listPriceCents != null && usage.lastPriceCents === listPriceCents) return null;
  const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const per = unit ? `/${unit}` : "";
  return listPriceCents != null
    ? `${fmt(usage.lastPriceCents)}${per} last used · ${fmt(listPriceCents)}${per} list`
    : `${fmt(usage.lastPriceCents)}${per} last used`;
}
