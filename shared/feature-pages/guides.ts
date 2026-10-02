import type { FeaturePage } from "./types";

/**
 * Guides — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "guides",
  slug: "guides",
  group: "learn",
  status: "stub",
  title: "Guides",
  kicker: "Guides",
  headline: { lead: "", swipe: "Guides" },
  lede: "Google Ads, Local Services and state licensing guides.",
  hero: { mascot: "standing", bubble: "Here is what Guides does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "account" },
  faqs: [],
  related: [],
  app: { href: "/guides", surface: "app" },
  seo: { title: "Guides | ConstructHUB", description: "Google Ads, Local Services and state licensing guides." },
  sources: ["client/src/pages/guides.tsx", "client/src/pages/google-ads-guide.tsx", "client/src/pages/lsa-guide.tsx", "client/src/pages/site-connection-guide.tsx", "server/state-guides-schema.ts"],
};

export default page;
