import type { FeaturePage } from "./types";

/**
 * Competitor Intel — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "competitors",
  slug: "competitors",
  group: "win",
  status: "stub",
  title: "Competitor Intel",
  kicker: "Competitor Intel",
  headline: { lead: "", swipe: "Competitor Intel" },
  lede: "Benchmark your profile against local competitors.",
  hero: { mascot: "standing", bubble: "Here is what Competitor Intel does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "competitorScans", unit: "Competitor Intel scans", period: "month" } },
  faqs: [],
  related: [],
  app: { href: "/competitors", surface: "app" },
  seo: { title: "Competitor Intel | ConstructHUB", description: "Benchmark your profile against local competitors." },
  legacyPath: "/competitors-landing",
  flag: "SHOW_COMPETITOR_INTEL",
  sources: ["client/src/pages/competitors.tsx", "client/src/pages/competitors-landing.tsx", "server/competitor-analysis.ts", "server/competitor-provider.ts"],
};

export default page;
