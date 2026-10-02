import type { FeaturePage } from "./types";

/**
 * Customer API — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "customerApi",
  slug: "customer-api",
  group: "platform",
  status: "stub",
  title: "Customer API",
  kicker: "Customer API",
  headline: { lead: "", swipe: "Customer API" },
  lede: "Read and write your ConstructHUB data from your own tools with an API key.",
  hero: { mascot: "standing", bubble: "Here is what Customer API does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "apiUnitsPerMonth", unit: "API units", period: "month" } },
  faqs: [],
  related: [],
  app: { href: "/developers", surface: "app" },
  seo: { title: "Customer API | ConstructHUB", description: "Read and write your ConstructHUB data from your own tools with an API key." },
  sources: ["client/src/pages/developers.tsx", "server/public-api/"],
};

export default page;
