import type { FeaturePage } from "./types";

/**
 * GMB Ranking Grid — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "rankingGrid",
  slug: "ranking-grid",
  group: "grow",
  status: "stub",
  title: "GMB Ranking Grid",
  kicker: "GMB Ranking Grid",
  headline: { lead: "", swipe: "GMB Ranking Grid" },
  lede: "Where you rank on the map, street by street.",
  hero: { mascot: "standing", bubble: "Here is what GMB Ranking Grid does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan", allowance: { limit: "gridCredits", perLocation: "gridCreditsPerLocation", unit: "ranking-grid credits", period: "month" } },
  faqs: [],
  related: [],
  app: { href: "/ranking-grid", surface: "app" },
  seo: { title: "GMB Ranking Grid | ConstructHUB", description: "Where you rank on the map, street by street." },
  sources: ["client/src/pages/ranking-grid.tsx", "shared/plans.ts (gridCreditCost)", "server/growth-quotas.ts"],
};

export default page;
