import type { FeaturePage } from "./types";

/**
 * Google Business Profile — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "gbp",
  slug: "gbp",
  group: "grow",
  status: "stub",
  title: "Google Business Profile",
  kicker: "Google Business Profile",
  headline: { lead: "", swipe: "Google Business Profile" },
  lede: "Connect Google and link the locations you manage.",
  hero: { mascot: "standing", bubble: "Here is what Google Business Profile does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan", allowance: { limit: "locations", unit: "Google Business Profile locations", period: "count" } },
  faqs: [],
  related: [],
  app: { href: "/locations", surface: "app" },
  seo: { title: "Google Business Profile | ConstructHUB", description: "Connect Google and link the locations you manage." },
  sources: ["client/src/pages/locations.tsx", "client/src/pages/google-business.tsx", "server/gbp/"],
};

export default page;
