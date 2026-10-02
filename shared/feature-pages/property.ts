import type { FeaturePage } from "./types";

/**
 * Property Records — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "property",
  slug: "property",
  group: "win",
  status: "stub",
  title: "Property Records",
  kicker: "Property Records",
  headline: { lead: "", swipe: "Property Records" },
  lede: "Owner and parcel lookups through county appraiser offices, sourced from NETR Online.",
  hero: { mascot: "standing", bubble: "Here is what Property Records does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "account" },
  faqs: [],
  related: [],
  app: { href: "/property", surface: "app" },
  seo: { title: "Property Records | ConstructHUB", description: "Owner and parcel lookups through county appraiser offices, sourced from NETR Online." },
  sources: ["client/src/pages/property.tsx", "server/data/appraisers.json", "scripts/scrape-netronline.ts"],
};

export default page;
