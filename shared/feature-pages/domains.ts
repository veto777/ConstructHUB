import type { FeaturePage } from "./types";

/**
 * Domains — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "domains",
  slug: "domains",
  group: "protect",
  status: "stub",
  title: "Domains",
  kicker: "Domains",
  headline: { lead: "", swipe: "Domains" },
  lede: "Expiry, auto-renew and DNS checks on your domains.",
  hero: { mascot: "standing", bubble: "Here is what Domains does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "domainsMailAlerts" },
  faqs: [],
  related: [],
  app: { href: "/domains", surface: "app" },
  seo: { title: "Domains | ConstructHUB", description: "Expiry, auto-renew and DNS checks on your domains." },
  sources: ["client/src/pages/domains.tsx", "server/domains/"],
};

export default page;
