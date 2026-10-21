/**
 * Scope categories of estimate lines, and the tiered, category-gated bundle discount.
 *
 * Owner (2026-10-21, Alpine): "for client discounts make sure bundle only works for siding, windows and roofing for 5%
 * and 2 scopes is only 2% and painting or gutters do not count as a scopes for this discount".
 *
 * A line's category: what the user picked on the line (stored as crm_estimate_items.scope_category), else the
 * price-book item's category name, else keywords in the line name. Doors, painting, gutters and anything else are
 * their own categories and never count toward a bundle rule that doesn't list them.
 *
 * A bundle RULE lives on the org's discount preset (Settings → Bid discounts, custom_fields.discountDefaults[].rule)
 * and is copied onto each estimate's offer (crm_estimate_discounts.rule). Orgs without a rule keep the flat bundle.
 * The offer's percent = the best tier whose `min` the estimate's DISTINCT qualifying categories reach; below every
 * tier the offer is not available. The server recomputes this from the stored lines on approve
 * (server/crm/discounts.ts) — the client's ticks are never trusted. Pure, no imports (client + server).
 */

export const SCOPE_CATEGORIES = ["siding", "windows", "roofing", "gutters", "painting", "doors", "other"] as const;
export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export const SCOPE_CATEGORY_LABEL: Record<ScopeCategory, string> = {
  siding: "Siding", windows: "Windows", roofing: "Roofing", gutters: "Gutters", painting: "Painting", doors: "Doors", other: "Other",
};

// Order matters: "Siding Remodel - Primed (NO PAINT)" is siding, not painting; "Metal Roof" is roofing.
const KEYWORDS: Array<[ScopeCategory, RegExp]> = [
  ["siding", /\b(siding|hardie|hardieplank|lap|shake|shingle siding|board and batten|board & batten|panel|panels|soffit|fascia)\b/i],
  ["roofing", /\b(roof|roofing|re-?roof|shingles?|metal roof)\b/i],
  ["windows", /\bwindows?\b/i],
  ["gutters", /\bgutters?\b|\bdownspouts?\b/i],
  ["painting", /\bpaint(ing)?\b|\bstain(ing)?\b/i],
  ["doors", /\bdoors?\b/i],
];

/** Category from free text (a line name or a price-book category name). */
export function categoryFromText(text: string | null | undefined): ScopeCategory {
  const t = String(text ?? "");
  for (const [cat, re] of KEYWORDS) if (re.test(t)) return cat;
  return "other";
}

export const isScopeCategory = (v: unknown): v is ScopeCategory =>
  typeof v === "string" && (SCOPE_CATEGORIES as readonly string[]).includes(v);

/** The category a line counts as: its stored choice, else its name's keywords. */
export function lineCategory(l: { scopeCategory?: string | null; name?: string | null }): ScopeCategory {
  return isScopeCategory(l.scopeCategory) ? l.scopeCategory : categoryFromText(l.name);
}

export type BundleTier = { min: number; percentBps: number };
export type BundleRule = { categories: string[]; tiers: BundleTier[] };

/** Alpine's rule (owner, 2026-10-21): siding + windows + roofing → 5%, any two → 2%. */
export const ALPINE_BUNDLE_RULE: BundleRule = {
  categories: ["siding", "windows", "roofing"],
  tiers: [{ min: 3, percentBps: 500 }, { min: 2, percentBps: 200 }],
};

/**
 * The org's rule for a discount code: crm_orgs.custom_fields.discountRules[code] (Alpine: { bundle: ALPINE_BUNDLE_RULE }).
 * Kept apart from discountDefaults on purpose: saving Bid discounts there switches on send-time seeding, and an org
 * that only wants the tiered bundle shouldn't get that too. Every place a "bundle" offer is made takes this rule.
 */
export function orgDiscountRule(orgCustomFields: unknown, code: string): BundleRule | null {
  return bundleRuleOf((orgCustomFields as any)?.discountRules?.[code]);
}

/** A rule read off stored JSON, or null (junk never throws). */
export function bundleRuleOf(raw: unknown): BundleRule | null {
  const r = raw as any;
  if (!r || !Array.isArray(r.categories) || !Array.isArray(r.tiers)) return null;
  const categories = r.categories.filter((c: unknown) => typeof c === "string" && c);
  const tiers = r.tiers
    .filter((t: any) => t && Number.isInteger(t.min) && t.min > 0 && Number.isInteger(t.percentBps) && t.percentBps >= 0 && t.percentBps <= 10_000)
    .map((t: any) => ({ min: t.min, percentBps: t.percentBps }));
  return categories.length && tiers.length ? { categories, tiers } : null;
}

/** Distinct qualifying categories present on the lines (discount lines never count). */
export function qualifyingCategories(rule: BundleRule, lines: Array<{ kind?: string; scopeCategory?: string | null; name?: string | null }>): string[] {
  const want = new Set(rule.categories);
  const have = new Set<string>();
  for (const l of lines) {
    if (l.kind === "discount") continue;
    const c = lineCategory(l);
    if (want.has(c)) have.add(c);
  }
  return rule.categories.filter((c) => have.has(c));
}

export type EffectiveOffer = { percentBps: number; available: boolean; reason: string | null; categories: string[] };

const list = (cats: string[]) => cats.map((c) => SCOPE_CATEGORY_LABEL[c as ScopeCategory]?.toLowerCase() ?? c).join(", ");

/** The percent an offer is worth on these lines. An offer without a rule is its flat percent, always available. */
export function effectiveOffer(offer: { percentBps: number; rule?: unknown }, lines: Array<{ kind?: string; scopeCategory?: string | null; name?: string | null }>): EffectiveOffer {
  const rule = bundleRuleOf(offer.rule);
  if (!rule) return { percentBps: offer.percentBps, available: true, reason: null, categories: [] };
  const cats = qualifyingCategories(rule, lines);
  const tier = [...rule.tiers].sort((a, b) => b.min - a.min).find((t) => cats.length >= t.min);
  if (!tier || tier.percentBps <= 0) {
    const need = Math.min(...rule.tiers.map((t) => t.min));
    return {
      percentBps: 0, available: false, categories: cats,
      reason: `Needs ${need} of ${list(rule.categories)} on the estimate${cats.length ? ` (has ${list(cats)})` : ""}`,
    };
  }
  return { percentBps: tier.percentBps, available: true, reason: null, categories: cats };
}

/** "−5% for siding + windows + roofing, −2% for any two of them". */
export function bundleRuleText(rule: BundleRule): string {
  const pct = (b: number) => `−${Number((b / 100).toFixed(2))}%`;
  const names = rule.categories.map((c) => SCOPE_CATEGORY_LABEL[c as ScopeCategory]?.toLowerCase() ?? c);
  return [...rule.tiers].sort((a, b) => b.min - a.min).map((t) =>
    t.min >= rule.categories.length ? `${pct(t.percentBps)} for ${names.join(" + ")}`
      : `${pct(t.percentBps)} for any ${t.min === 2 ? "two" : t.min} of them`).join(", ");
}
