import type { FeaturePage } from "./types";

/**
 * Schedule — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "crmSchedule",
  slug: "crm-schedule",
  group: "run",
  status: "stub",
  title: "Schedule",
  kicker: "Schedule",
  headline: { lead: "", swipe: "Schedule" },
  lede: "Appointments and crew visits.",
  hero: { mascot: "standing", bubble: "Here is what Schedule does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "plan" },
  faqs: [],
  related: [],
  app: { href: "/crm/schedule", surface: "portal" },
  seo: { title: "Schedule | ConstructHUB", description: "Appointments and crew visits." },
  sources: ["client/src/pages/crm-schedule.tsx", "server/crm/calendar.ts", "server/crm/appointments.test.ts"],
};

export default page;
