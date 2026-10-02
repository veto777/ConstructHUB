import type { FeaturePage } from "./types";

/**
 * Master Class — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "masterClass",
  slug: "master-class",
  group: "learn",
  status: "stub",
  title: "Master Class",
  kicker: "Master Class",
  headline: { lead: "", swipe: "Master Class" },
  lede: "The contractor marketing course.",
  hero: { mascot: "standing", bubble: "Here is what Master Class does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "sales", topic: "The Master Class" },
  faqs: [],
  related: [],
  app: { href: "/master-class", surface: "app" },
  seo: { title: "Master Class | ConstructHUB", description: "The contractor marketing course." },
  legacyPath: "/master-class-landing",
  sources: ["client/src/pages/master-class.tsx", "client/src/pages/master-class-landing.tsx"],
};

export default page;
