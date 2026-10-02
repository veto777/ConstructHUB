import type { FeaturePage } from "./types";

/**
 * Cloudflare — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "cloudflare",
  slug: "cloudflare",
  group: "protect",
  status: "stub",
  title: "Cloudflare",
  kicker: "Cloudflare",
  headline: { lead: "", swipe: "Cloudflare" },
  lede: "Zones, traffic and edge rules for client sites.",
  hero: { mascot: "standing", bubble: "Here is what Cloudflare does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "cloudflareSearchConsole" },
  faqs: [],
  related: [],
  app: { href: "/cloudflare", surface: "app" },
  seo: { title: "Cloudflare | ConstructHUB", description: "Zones, traffic and edge rules for client sites." },
  sources: ["client/src/pages/site-connections.tsx", "server/cloudflare/"],
};

export default page;
