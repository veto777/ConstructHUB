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
    "The all-in-one contractor platform: a CRM, permit and property-record search, Google Business Profile tools, click-fraud protection and done-for-you work.",
};

export const ROUTE_META: Readonly<Record<string, RouteMeta>> = {
  "/": HOME_META,
  "/call-assistant": {
    title: "AI Call Assistant | ConstructHUB",
    description:
      "An AI receptionist for contractors: a local number in your state, your own lines forwarded, and every call in your CRM with a transcript and recording.",
  },
  [FEATURES_PATH]: {
    title: "Features | ConstructHUB",
    description:
      "Every ConstructHUB feature for contractors: Google Business Profile tools, click-fraud protection, permits, the CRM and more, and which plan includes each.",
  },
  // One entry per feature intro page, from its content file (shared/feature-pages/<key>.ts).
  ...Object.fromEntries(FEATURE_PAGES.map((page) => [featurePagePath(page), { title: page.seo.title, description: page.seo.description }])),
  [DFY_PATH]: {
    title: "Done-For-You Services for Contractors | ConstructHUB",
    description:
      "Business formation and licensing, Google profile and website setup, SEO and ads, monthly SEO and GBP reinstatement, done by our team for contractors.",
  },
  // One entry per done-for-you page, from its content file (shared/dfy-pages/<key>.ts).
  ...Object.fromEntries(DFY_PAGES.map((page) => [dfyPagePath(page), { title: page.seo.title, description: page.seo.description }])),
  "/pricing": {
    title: "Plans & Pricing | ConstructHUB",
    description:
      `Every ConstructHUB plan and add-on side by side, from ${formatUsd(STARTING_MONTHLY_CENTS)}/month; a new account starts with a ${TRIAL_LABEL}. ` +
      "Done-for-you work is quoted by a sales rep.",
  },
  "/reinstatement": {
    title: "Request GBP Reinstatement Help | ConstructHUB",
    description:
      "Request a free case review for a suspended Google Business Profile. Our team looks at the suspension and tells you honestly if we think we can help.",
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
      "What we saw reviewing ad traffic in contractor Google Ads accounts with IP tracking, device fingerprinting and screen recording, and our opinion of it.",
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

/**
 * Public app pages that marketing pages link to but that are not prerendered or
 * in the sitemap (free tools, the sign-in page): their own title and
 * description in the HTML the server sends, instead of the home page's. Each
 * description restates the page's own lede; the titles are the names the app
 * already gives these pages in the browser tab (client/src/App.tsx PAGE_TITLES).
 */
export const APP_PAGE_META: Readonly<Record<string, RouteMeta>> = {
  "/auth": {
    title: "Sign In | ConstructHUB",
    description: "Sign in to your ConstructHUB account, or create one to choose a plan for your contracting business.",
  },
  "/free-site-scan": {
    title: "Free Website Scan | ConstructHUB",
    description:
      "A free 60-second scan of your contractor website: we check up to 11 pages and show the first fixes. Verify your email to unlock the full quick-scan report.",
  },
  "/databases": {
    title: "Database Directory | ConstructHUB",
    description:
      "Browse US counties and cities for permit offices. Where an official permit portal is on record it is linked; otherwise search the web for it.",
  },
  "/property": {
    title: "Property Records | ConstructHUB",
    description:
      "County property appraiser offices nationwide, with direct links to the official government portals for ownership, assessed values and tax records.",
  },
  "/master-class": {
    title: "Master Class | ConstructHUB",
    description:
      "A step-by-step guide to starting a construction business: pick your state to see what you need, from forming your LLC to getting licensed and insured.",
  },
  "/developers": {
    title: "Developers | ConstructHUB",
    description: "The ConstructHUB API reference: read your ConstructHUB data and update your records from your own tools.",
  },
  "/google-ads": {
    title: "Click Guard | ConstructHUB",
    description:
      "Track visits that run your script, flag unusual patterns and build an IP exclusion list for Google Ads. Signals do not prove fraud.",
  },
};

/** A page's own title and description: a marketing page's, else a public app page's, else none. */
export const pageMetaFor = (path: string): RouteMeta | undefined => ROUTE_META[path] ?? APP_PAGE_META[path];
