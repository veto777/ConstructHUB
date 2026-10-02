import type { FeaturePage } from "./types";

/**
 * Leads & follow-ups — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "crmLeads",
  slug: "crm-leads",
  group: "run",
  status: "stub",
  title: "Leads & follow-ups",
  kicker: "Leads & follow-ups",
  headline: { lead: "", swipe: "Leads & follow-ups" },
  lede: "New leads and the follow-ups that are due.",
  hero: { mascot: "standing", bubble: "Here is what Leads & follow-ups does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/crm/pipeline", surface: "portal" },
  seo: { title: "Leads & follow-ups | ConstructHUB", description: "New leads and the follow-ups that are due." },
  sources: ["client/src/pages/crm-pipeline.tsx", "server/crm/follow-ups.ts", "server/crm/lead-capture.ts"],
};

export default page;
