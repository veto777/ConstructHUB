import type { FeaturePage } from "./types";

/**
 * Mail alerts — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "mailAlerts",
  slug: "mail-alerts",
  group: "protect",
  status: "stub",
  title: "Mail alerts",
  kicker: "Mail alerts",
  headline: { lead: "", swipe: "Mail alerts" },
  lede: "Provider alert emails, matched to your clients.",
  hero: { mascot: "standing", bubble: "Here is what Mail alerts does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "domainsMailAlerts" },
  faqs: [],
  related: [],
  app: { href: "/mail-alerts", surface: "app" },
  seo: { title: "Mail alerts | ConstructHUB", description: "Provider alert emails, matched to your clients." },
  sources: ["client/src/pages/mail-alerts.tsx", "server/mail-alerts/"],
};

export default page;
