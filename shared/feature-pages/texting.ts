import type { FeaturePage } from "./types";

/**
 * Texting — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "texting",
  slug: "texting",
  group: "run",
  status: "stub",
  title: "Texting",
  kicker: "Texting",
  headline: { lead: "", swipe: "Texting" },
  lede: "Team alerts and client texts from your CRM.",
  hero: { mascot: "standing", bubble: "Here is what Texting does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "teamTextSegments", unit: "team alert texts", period: "month" } },
  faqs: [],
  related: [],
  app: { href: "/crm/settings", surface: "portal" },
  seo: { title: "Texting | ConstructHUB", description: "Team alerts and client texts from your CRM." },
  sources: ["server/crm/sms.ts", "server/crm/sms-segments.ts", "shared/plans.ts (clientTexting, texting_number)"],
};

export default page;
