// Server-side price authority.
//
// SECURITY: prices and product names for cart checkout MUST come from here (or,
// for course modules, from the database) — never from the client request body.
// The client is free to send whatever price/name it likes; the server ignores
// it and looks the real value up by id. Keep these values in sync with the
// display catalog in client/src/pages/pricing.tsx and master-class.tsx.
//
// Anything priced at SALES_THRESHOLD_CENTS ($1,000) or more is quoted by a
// sales rep (owner decision 2026-09-30): no price on the page and no checkout.
// Every checkout path refuses it with sendTalkToSales() (409); items under the
// threshold keep their price and checkout.
import type { Response } from "express";
import { showsPrice, TALK_TO_SALES_CODE } from "@shared/plans";

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
  dfy_seo_first_page:  { name: "First Page SEO — 1-2 Keywords (6-Month)",              priceCents: 1800000 },
  dfy_seo_growth:      { name: "SEO Growth — Top 3 for 1-2 Keywords (6-Month)",        priceCents: 3600000 },
  dfy_seo_domination:  { name: "SEO Domination — Top 3 for 3-5 Keywords (6-Month)",    priceCents: 6000000 },
  dfy_bundle:          { name: "Complete Business Build",                               priceCents: 2999900 },
};

// TODO(owner): ConstructHUB SEO add-on. The SEO tools (rank tracker, keyword
// research, backlinks, competitor gap) are included with every plan under the
// allowances in shared/plans.ts SEO_PLAN_LIMITS; a paid "SEO" add-on that
// raises those allowances (more tracked keywords / searches / refreshes) would
// be an ADDONS entry in shared/plans.ts with `grants: { seoKeywords, seoResearch,
// seoBacklinkRefreshes }` plus its Stripe price (server/billing). Retail price
// is the owner's call — NOT set here; wholesale cost is cents per check
// (server/seo/pricing.ts), so the margin is whatever the owner picks.

// Master Class complete bundle (type: "course_bundle"). Individual modules
// (type: "course_module") are priced from the masterClassModules table by id.
export const COURSE_BUNDLE: CatalogItem = {
  name: "Master Class — Complete Bundle",
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

/** At or above SALES_THRESHOLD_CENTS: quoted by a sales rep, never checked out online. */
export const isSalesOnly = (priceCents: number) => !showsPrice(priceCents);

export function talkToSalesMessage(names: string[]): string {
  const list = names.length ? names.join(", ") : "This service";
  return `${list} ${names.length > 1 ? "are" : "is"} quoted by a sales rep, not sold online. ` +
    "Talk to a sales rep — send an inquiry and we'll get back to you with a quote. Nothing was charged.";
}

/** The one refusal for a sales-only item at checkout or contract creation: 409 { code: "talk_to_sales" }. */
export function sendTalkToSales(res: Response, names: string[]) {
  return res.status(409).json({ code: TALK_TO_SALES_CODE, message: talkToSalesMessage(names), items: names });
}

const oneLine = (value: unknown, max: number) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Subject line for the sales inquiry email (POST /api/seo-inquiry, which now
 * carries every sales request): "Sales inquiry — <first service> — <name>".
 */
export function salesInquirySubject(services: readonly string[] | null | undefined, name: string): string {
  return `Sales inquiry — ${oneLine(services?.[0], 100) || "General"} — ${oneLine(name, 150)}`;
}
