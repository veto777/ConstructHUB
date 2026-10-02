import type { FeaturePage } from "./types";

/**
 * Permit Database Search — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "permits",
  slug: "permits",
  group: "win",
  status: "stub",
  title: "Permit Database Search",
  kicker: "Permit Database Search",
  headline: { lead: "", swipe: "Permit Database Search" },
  lede: "Search building permits by county or city.",
  hero: { mascot: "standing", bubble: "Here is what Permit Database Search does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan", allowance: { limit: "permitSearches", unit: "permit searches", period: "month" } },
  faqs: [],
  related: [],
  app: { href: "/search", surface: "app" },
  seo: { title: "Permit Database Search | ConstructHUB", description: "Search building permits by county or city." },
  legacyPath: "/permits-landing",
  sources: ["client/src/pages/search.tsx", "client/src/pages/databases.tsx", "client/src/pages/permits-landing.tsx", "server/scraper.ts", "server/data/permit-portals.json"],
};

export default page;
