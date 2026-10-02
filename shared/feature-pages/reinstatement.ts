import type { FeaturePage } from "./types";

/**
 * Reinstatement — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "reinstatement",
  slug: "reinstatement",
  group: "learn",
  status: "stub",
  title: "Reinstatement",
  kicker: "Reinstatement",
  headline: { lead: "", swipe: "Reinstatement" },
  lede: "Suspended Google profile? We handle the appeal.",
  hero: { mascot: "standing", bubble: "Here is what Reinstatement does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "service", service: "gbpReinstatement" },
  faqs: [],
  related: [],
  app: { href: "/reinstatement", surface: "app" },
  seo: { title: "Reinstatement | ConstructHUB", description: "Suspended Google profile? We handle the appeal." },
  sources: ["client/src/pages/reinstatement.tsx", "shared/plans.ts (GBP_REINSTATEMENT_CENTS)"],
};

export default page;
