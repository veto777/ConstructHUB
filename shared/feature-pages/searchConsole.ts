import type { FeaturePage } from "./types";

/**
 * Search Console — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "searchConsole",
  slug: "search-console",
  group: "protect",
  status: "stub",
  title: "Search Console",
  kicker: "Search Console",
  headline: { lead: "", swipe: "Search Console" },
  lede: "Google search clicks and impressions.",
  hero: { mascot: "standing", bubble: "Here is what Search Console does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "cloudflareSearchConsole" },
  faqs: [],
  related: [],
  app: { href: "/search-console", surface: "app" },
  seo: { title: "Search Console | ConstructHUB", description: "Google search clicks and impressions." },
  sources: ["client/src/pages/site-connections.tsx", "server/gsc/"],
};

export default page;
