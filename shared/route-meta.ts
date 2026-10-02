/**
 * Per-page <title> and meta description for the public marketing pages
 * (search results and link previews). The server writes them into the HTML it
 * sends for that path (server/seo-html.ts, server/static.ts) — and the build
 * prerenders every one of these pages (script/prerender.ts) — so crawlers that
 * don't run JavaScript see them; the app sets the same title in the browser.
 *
 * Every page prerendered and listed in the sitemap (shared/seo.ts
 * MARKETING_ROUTES) has an entry; the vitest checks it. Pages without an entry
 * keep client/index.html's defaults. No typed prices: a figure comes from the
 * price book through the plan-copy helpers.
 */
import { FEATURE_PAGES, FEATURES_PATH, featurePagePath } from "./feature-pages";
import { DFY_PAGES, DFY_PATH, dfyPagePath } from "./dfy-pages";
import { STARTING_MONTHLY_CENTS, TRIAL_LABEL, formatUsd } from "./plan-copy";

export type RouteMeta = { title: string; description: string };

/** The home page's title and description (client/index.html carries the same as its defaults). */
export const HOME_META: RouteMeta = {
  title: "ConstructHUB — Nationwide Contractor Services",
  description:
    "The all-in-one platform for contractors: a CRM, permit and property-record search, Google Business Profile tools and click-fraud protection, plus done-for-you services.",
};

export const ROUTE_META: Readonly<Record<string, RouteMeta>> = {
  "/": HOME_META,
  "/call-assistant": {
    title: "AI Call Assistant | ConstructHUB",
    description:
      "An AI receptionist for contractors: pick a woman's or man's voice, get a local number in your state, forward the lines you already have, and every call lands in your CRM with a transcript and recording.",
  },
  [FEATURES_PATH]: {
    title: "Features | ConstructHUB",
    description:
      "Every ConstructHUB feature for contractors in one place: Google Business Profile tools, click-fraud protection, permits, the CRM and more, with what each one does and which plan includes it.",
  },
  // One entry per feature intro page, from its content file (shared/feature-pages/<key>.ts).
  ...Object.fromEntries(FEATURE_PAGES.map((page) => [featurePagePath(page), { title: page.seo.title, description: page.seo.description }])),
  [DFY_PATH]: {
    title: "Done-For-You Services for Contractors | ConstructHUB",
    description:
      "Business formation and licensing, Google profile and website setup, SEO and ads, monthly SEO and GBP reinstatement, done by our team for your contracting business.",
  },
  // One entry per done-for-you page, from its content file (shared/dfy-pages/<key>.ts).
  ...Object.fromEntries(DFY_PAGES.map((page) => [dfyPagePath(page), { title: page.seo.title, description: page.seo.description }])),
  "/pricing": {
    title: "Plans & Pricing | ConstructHUB",
    description:
      `Every ConstructHUB plan and add-on side by side, from ${formatUsd(STARTING_MONTHLY_CENTS)}/month with a ${TRIAL_LABEL}. ` +
      "The CRM is in every plan; done-for-you services are quoted by a sales rep.",
  },
  "/reinstatement": {
    title: "Request GBP Reinstatement Help | ConstructHUB",
    description:
      "Send a free case review request for a suspended Google Business Profile. Our team reviews the suspension and tells you honestly whether we think we can help.",
  },
  "/google-business": {
    title: "Google Business Profile Tools | ConstructHUB",
    description:
      "Check, optimize and monitor your Google Business Profile, and compete for the Local Pack with ConstructHUB's tools for contractors.",
  },
  "/google-ads-guide": {
    title: "Google Ads Guide for Contractors | ConstructHUB",
    description:
      "Google Ads for contractors: a campaign setup playbook in 12 sections with real Google Ads screenshots, for Master Class students.",
  },
  "/google-ad-fraud": {
    title: "Google Ads Click Fraud: What We Observed | ConstructHUB",
    description:
      "What we observed reviewing ad traffic in contractor Google Ads accounts with IP tracking, device fingerprinting and screen recording, and our opinion of it.",
  },
  "/lsa-guide": {
    title: "Local Services Ads Guide for Contractors | ConstructHUB",
    description:
      "Local Services Ads for contractors: a setup and optimization playbook for getting your business into LSA and staying on top.",
  },
  "/privacy": {
    title: "Privacy Policy | ConstructHUB",
    description:
      "How ConstructHUB collects, uses, discloses and safeguards your information when you visit constructhub.us or use our services.",
  },
  "/terms": {
    title: "Terms of Use | ConstructHUB",
    description:
      "The terms for using ConstructHUB: accounts, plans and add-ons, billing, done-for-you services, refunds, acceptable use and dispute resolution.",
  },
};
