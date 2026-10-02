import type { FeaturePage } from "./types";

/**
 * Photo Optimizer — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "media",
  slug: "media",
  group: "grow",
  status: "stub",
  title: "Photo Optimizer",
  kicker: "Photo Optimizer",
  headline: { lead: "", swipe: "Photo Optimizer" },
  lede: "Geotagged, compressed job photos in your media library.",
  hero: { mascot: "standing", bubble: "Here is what Photo Optimizer does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/media-library", surface: "app" },
  seo: { title: "Photo Optimizer | ConstructHUB", description: "Geotagged, compressed job photos in your media library." },
  sources: ["client/src/pages/photos.tsx", "client/src/pages/media-library.tsx", "server/photo-processor.ts"],
};

export default page;
