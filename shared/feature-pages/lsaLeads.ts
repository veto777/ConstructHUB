import type { FeaturePage } from "./types";

/**
 * LSA Leads — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "lsaLeads",
  slug: "lsa-leads",
  group: "win",
  status: "stub",
  title: "LSA Leads",
  kicker: "LSA Leads",
  headline: { lead: "", swipe: "LSA Leads" },
  lede: "Local Services leads, disputes and Telegram alerts.",
  hero: { mascot: "standing", bubble: "Here is what LSA Leads does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "account" },
  faqs: [],
  related: [],
  app: { href: "/lsa-leads", surface: "app" },
  seo: { title: "LSA Leads | ConstructHUB", description: "Local Services leads, disputes and Telegram alerts." },
  sources: ["client/src/pages/lsa-leads.tsx", "client/src/pages/lsa-guide.tsx", "server/lsa/"],
};

export default page;
