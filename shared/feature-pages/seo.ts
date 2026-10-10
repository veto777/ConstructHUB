import type { FeatureCompare, FeaturePage } from "./types";
import { ADDONS, PLANS, PLAN_KEYS } from "../plans";

/**
 * ConstructHUB SEO (the /seo tool) — a STUB page (status "stub": not in the
 * sitemap, not prerendered) so the à la carte SEO suites (shared/alacarte.ts
 * seo_basic / seo_pro) have a Compare page and a landing page for the locked
 * sidebar entry. Every card below is backed by code in `sources`:
 *   - the rank tracker, checked weekly per site by default (twice a week is a setting), every keyword × device:
 *     server/seo/jobs.ts (SEO_FREQUENCIES), client/src/pages/seo/index.tsx
 *   - site explorer, keyword research, backlinks, audits, competitors, content: client/src/pages/seo/*.tsx, server/seo/routes.ts
 *   - Search Console clicks and impressions broken down beside the rankings: server/seo/gsc-breakdown.ts, client/src/pages/seo/gsc-breakdown.tsx
 *   - the keyword allowance and the monthly SEO data allowance (prepaid credit beyond it): shared/plans.ts
 *     seoKeywords / seoCreditCents, shared/seo-credits.ts, server/seo/plan.ts
 *   - the suite as an add-on below Unlimited: shared/plans.ts ADDONS.seo_basic / seo_pro
 * Not built, so not claimed: daily rank checks (ours are weekly), content writing, an API for the SEO data.
 */

const INCLUDED_PLAN = PLANS[PLAN_KEYS.find((k) => PLANS[k].limits.seoKeywords !== 0) ?? "agency"].name;

export const SEO_COMPARE: FeatureCompare = {
  // Prices read on 2026-10-10 from: semrush.com/prices, ahrefs.com/pricing, seranking.com/subscription.html
  // (~/codex-audits/a-la-carte-competitors.md → seo_basic / seo_pro). Third-party-reported prices (Mangools, Moz) are not quoted.
  alacarte: ["seo_basic", "seo_pro"],
  checkedOn: "2026-10-10",
  competitors: [
    { name: "Semrush", plan: "SEO", price: { kind: "monthly", cents: 13900 }, note: "500 keywords checked daily, 5 sites", source: "https://www.semrush.com/prices/" },
    { name: "Ahrefs", plan: "Lite", price: { kind: "monthly", cents: 12900 }, note: "750 keywords", source: "https://ahrefs.com/pricing" },
    { name: "SE Ranking", plan: "Core", price: { kind: "monthly", cents: 12900 }, note: "2,000 keywords checked daily", source: "https://seranking.com/subscription.html" },
  ],
  onlyUs: [
    "1,000 tracked keywords at the entry tier.",
    "Your Search Console clicks and impressions broken down beside the rankings you track.",
    "The same suite that holds Site Scan and GridRank, on one account.",
  ],
  theyNotUs: "Daily rank checks (ours are weekly by default), far larger keyword databases, content tools and an API.",
};

const page: FeaturePage = {
  key: "seo",
  slug: "seo",
  group: "grow",
  status: "stub",
  title: "ConstructHUB SEO",
  kicker: "SEO suite",
  headline: { lead: "Rankings, Keywords and Backlinks, ", swipe: "Checked Weekly" },
  lede:
    "A rank tracker, site explorer, keyword research and backlinks for your website, with your Search Console clicks and " +
    "impressions beside the rankings. Included from the " + INCLUDED_PLAN + " plan, or added to any plan as the SEO suite.",
  hero: { mascot: "standing", bubble: "Let's see where your site really ranks." },
  steps: [],
  cards: [
    {
      icon: "trending-up",
      title: "Rank tracker",
      body: "Every tracked keyword, on mobile and desktop, checked once a week by default (twice a week is a setting). Your tracked-keyword allowance comes from your plan or your SEO suite.",
    },
    {
      icon: "search",
      title: "Site explorer and keyword research",
      body: "Look up any site's keywords and pages, and find the keywords worth tracking for your trade and area.",
    },
    {
      icon: "link",
      title: "Backlinks",
      body: "The sites that link to yours and to your competitors, with the pages they point at.",
    },
    {
      icon: "chart",
      title: "Search Console beside the rankings",
      body: "Connect Google Search Console and read its clicks and impressions, broken down next to the rankings you track.",
    },
    {
      icon: "gauge",
      title: "A data allowance, never a surprise bill",
      body: "Every lookup spends from a monthly SEO data allowance; automatic checks stop when it is used up, and credit you buy is spent only when you press the button.",
    },
  ],
  audience: [],
  pricing: {
    kind: "allowance",
    allowance: { limit: "seoKeywords", unit: "tracked keywords", period: "count" },
    note: `Below the ${INCLUDED_PLAN} plan, the suite is the ${ADDONS.seo_basic.name} or ${ADDONS.seo_pro.name} add-on, or an à la carte subscription with no plan at all.`,
  },
  faqs: [],
  compare: SEO_COMPARE,
  related: ["siteScan", "rankingGrid", "searchConsole"],
  app: { href: "/seo", surface: "app", label: "Open SEO" },
  seo: {
    title: "Contractor SEO Suite: Rank Tracker, Keywords, Backlinks | ConstructHUB",
    description: "A weekly rank tracker, site explorer, keyword research and backlinks for contractors, with Search Console clicks beside the rankings.",
  },
  sources: [
    "client/src/pages/seo/index.tsx",
    "client/src/pages/seo/explorer.tsx",
    "client/src/pages/seo/backlinks.tsx",
    "client/src/pages/seo/gsc-breakdown.tsx",
    "server/seo/routes.ts",
    "server/seo/jobs.ts",
    "server/seo/gsc-breakdown.ts",
    "server/seo/plan.ts",
    "shared/plans.ts",
    "shared/seo-credits.ts",
  ],
};

export default page;
