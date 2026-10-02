import type { FeaturePage } from "./types";

/**
 * IP Tracker — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "ipTracker",
  slug: "ip-tracker",
  group: "protect",
  status: "stub",
  title: "IP Tracker",
  kicker: "IP Tracker",
  headline: { lead: "", swipe: "IP Tracker" },
  lede: "Who visited your website this week.",
  hero: { mascot: "standing", bubble: "Here is what IP Tracker does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "protectedSites", unit: "websites", period: "count" } },
  faqs: [],
  related: [],
  app: { href: "/ip-tracker", surface: "app" },
  seo: { title: "IP Tracker | ConstructHUB", description: "Who visited your website this week." },
  sources: ["client/src/pages/ip-tracker.tsx", "server/tracking-script.ts"],
};

export default page;
