// Server-side price authority.
//
// SECURITY: prices and product names for cart checkout MUST come from here (or,
// for course modules, from the database) — never from the client request body.
// The client is free to send whatever price/name it likes; the server ignores
// it and looks the real value up by id. Keep these values in sync with the
// display catalog in client/src/pages/pricing.tsx and master-class.tsx.

export interface CatalogItem {
  name: string;
  /** Price in cents (Stripe unit_amount). */
  priceCents: number;
}

// Done-for-you services (type: "dfy_service" | "dfy_bundle"), keyed by cart id.
export const DFY_CATALOG: Record<string, CatalogItem> = {
  dfy_formation:       { name: "Business Formation & Filing",                          priceCents: 550000 },
  dfy_gmb_website:     { name: "GMB & Website Setup",                                   priceCents: 1500000 },
  dfy_seo_ads:         { name: "SEO & Ad Campaigns",                                    priceCents: 750000 },
  dfy_recruiting:      { name: "Recruiting Support",                                    priceCents: 950000 },
  dfy_seo_first_page:  { name: "First Page SEO — 1-2 Keywords (6-Month)",              priceCents: 1800000 },
  dfy_seo_growth:      { name: "SEO Growth — Top 3 for 1-2 Keywords (6-Month)",        priceCents: 3600000 },
  dfy_seo_domination:  { name: "SEO Domination — Top 3 for 3-5 Keywords (6-Month)",    priceCents: 6000000 },
  dfy_bundle:          { name: "Complete Business Build",                               priceCents: 2999900 },
};

// Master Class complete bundle (type: "course_bundle"). Individual modules
// (type: "course_module") are priced from the masterClassModules table by id.
export const COURSE_BUNDLE: CatalogItem = {
  name: "Master Class — Complete Bundle (50% Off)",
  priceCents: 249900,
};

// SEO packages that require a signed contract before payment — blocked from the
// direct cart-checkout flow.
export const SEO_CONTRACT_REQUIRED_IDS = new Set([
  "dfy_seo_first_page",
  "dfy_seo_growth",
  "dfy_seo_domination",
  "dfy_seo_ads",
]);
