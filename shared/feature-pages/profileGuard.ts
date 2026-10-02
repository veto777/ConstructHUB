import type { FeaturePage } from "./types";

/**
 * Profile Guard — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "profileGuard",
  slug: "profile-guard",
  group: "grow",
  status: "stub",
  title: "Profile Guard",
  kicker: "Profile Guard",
  headline: { lead: "", swipe: "Profile Guard" },
  lede: "Alerts when someone edits your Google profile. Turn it on per location in Locations.",
  hero: { mascot: "standing", bubble: "Here is what Profile Guard does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/locations", surface: "app" },
  seo: { title: "Profile Guard | ConstructHUB", description: "Alerts when someone edits your Google profile. Turn it on per location in Locations." },
  sources: ["client/src/components/profile-guard.tsx", "client/src/pages/gmb-monitor.tsx", "server/gbp/guard.ts", "server/gbp/guard-routes.ts"],
};

export default page;
