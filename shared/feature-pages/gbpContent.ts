import type { FeaturePage } from "./types";

/**
 * Posts & Photos — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "gbpContent",
  slug: "gbp-content",
  group: "grow",
  status: "stub",
  title: "Posts & Photos",
  kicker: "Posts & Photos",
  headline: { lead: "", swipe: "Posts & Photos" },
  lede: "Scheduled Google posts and photo uploads.",
  hero: { mascot: "standing", bubble: "Here is what Posts & Photos does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/gbp-content", surface: "app" },
  seo: { title: "Posts & Photos | ConstructHUB", description: "Scheduled Google posts and photo uploads." },
  sources: ["client/src/pages/gbp-content.tsx", "client/src/pages/photos.tsx", "server/gbp/content.ts", "server/gbp/content-upload.ts"],
};

export default page;
