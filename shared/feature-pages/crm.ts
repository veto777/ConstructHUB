import type { FeaturePage } from "./types";

/**
 * ConstructHub CRM — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "crm",
  slug: "crm",
  group: "run",
  status: "stub",
  title: "ConstructHub CRM",
  kicker: "ConstructHub CRM",
  headline: { lead: "", swipe: "ConstructHub CRM" },
  lede: "Estimates, jobs, invoices and your pipeline.",
  hero: { mascot: "standing", bubble: "Here is what ConstructHub CRM does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan", allowance: { limit: "crmSeats", unit: "CRM seats", period: "count" } },
  faqs: [],
  related: [],
  app: { href: "/crm", surface: "portal" },
  seo: { title: "ConstructHub CRM | ConstructHUB", description: "Estimates, jobs, invoices and your pipeline." },
  sources: ["client/src/pages/crm-*.tsx", "client/src/pages/crm-gateway.tsx", "server/crm/"],
};

export default page;
