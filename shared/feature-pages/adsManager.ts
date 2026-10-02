import type { FeaturePage } from "./types";

/**
 * Agency Ads & LSA — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "adsManager",
  slug: "ads-manager",
  group: "win",
  status: "stub",
  title: "Agency Ads & LSA",
  kicker: "Agency Ads & LSA",
  headline: { lead: "", swipe: "Agency Ads & LSA" },
  lede: "Client ad accounts, audits and protections.",
  hero: { mascot: "standing", bubble: "Here is what Agency Ads & LSA does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "adsManager" },
  faqs: [],
  related: [],
  app: { href: "/ads-manager", surface: "app" },
  seo: { title: "Agency Ads & LSA | ConstructHUB", description: "Client ad accounts, audits and protections." },
  sources: ["client/src/pages/ads-manager.tsx", "client/src/pages/lsa-account-manager.tsx", "client/src/pages/google-ads-guide.tsx", "server/ads/", "server/lsa-manager.ts"],
};

export default page;
