import type { FeaturePage } from "./types";

/**
 * Click Guard — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "clickGuard",
  slug: "click-guard",
  group: "protect",
  status: "stub",
  title: "Click Guard",
  kicker: "Click Guard",
  headline: { lead: "", swipe: "Click Guard" },
  lede: "Suspicious ad clicks caught and IPs excluded.",
  hero: { mascot: "standing", bubble: "Here is what Click Guard does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "protectedSites", unit: "websites", period: "count" } },
  faqs: [],
  related: [],
  app: { href: "/google-ads", surface: "app" },
  seo: { title: "Click Guard | ConstructHUB", description: "Suspicious ad clicks caught and IPs excluded." },
  legacyPath: "/google-ads-landing",
  sources: ["client/src/pages/google-ads.tsx", "client/src/pages/google-ad-fraud.tsx", "client/src/pages/google-ads-landing.tsx", "server/click-guard-exclusions.ts", "server/tracking-script.ts"],
};

export default page;
