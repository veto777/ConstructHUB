import type { FeaturePage } from "./types";

/**
 * Gabe, the Hub assistant — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "gabe",
  slug: "gabe",
  group: "platform",
  status: "stub",
  title: "Gabe, the Hub assistant",
  kicker: "Gabe, the Hub assistant",
  headline: { lead: "", swipe: "Gabe, the Hub assistant" },
  lede: "Gabe answers questions about ConstructHUB in the corner of every page.",
  hero: { mascot: "gabe", bubble: "Here is what Gabe, the Hub assistant does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "account" },
  faqs: [],
  related: [],
  app: { href: "/", surface: "app" },
  seo: { title: "Gabe, the Hub assistant | ConstructHUB", description: "Gabe answers questions about ConstructHUB in the corner of every page." },
  sources: ["client/src/components/hub/", "server/hub/", "shared/hub-presets.ts"],
};

export default page;
