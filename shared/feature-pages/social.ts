import type { FeaturePage } from "./types";

/**
 * Social Media — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "social",
  slug: "social",
  group: "grow",
  status: "stub",
  title: "Social Media",
  kicker: "Social Media",
  headline: { lead: "", swipe: "Social Media" },
  lede: "Posts queued and published across your social accounts.",
  hero: { mascot: "standing", bubble: "Here is what Social Media does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "account" },
  faqs: [],
  related: [],
  app: { href: "/social-media", surface: "app" },
  seo: { title: "Social Media | ConstructHUB", description: "Posts queued and published across your social accounts." },
  sources: ["client/src/pages/social-media.tsx", "server/social/"],
};

export default page;
