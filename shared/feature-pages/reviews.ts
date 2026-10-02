import type { FeaturePage } from "./types";

/**
 * Google Reviews — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "reviews",
  slug: "reviews",
  group: "grow",
  status: "stub",
  title: "Google Reviews",
  kicker: "Google Reviews",
  headline: { lead: "", swipe: "Google Reviews" },
  lede: "Your rating, new reviews and the ones still waiting on a reply.",
  hero: { mascot: "standing", bubble: "Here is what Google Reviews does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/google-reviews", surface: "app" },
  seo: { title: "Google Reviews | ConstructHUB", description: "Your rating, new reviews and the ones still waiting on a reply." },
  flag: "SHOW_GOOGLE_REVIEWS",
  sources: ["client/src/pages/google-reviews.tsx", "client/src/pages/review-feedback.tsx", "server/gbp/review-automation.ts", "server/review-reminders.ts"],
};

export default page;
