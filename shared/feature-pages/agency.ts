import type { FeaturePage } from "./types";

/**
 * Agency workspace — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "agency",
  slug: "agency",
  group: "run",
  status: "stub",
  title: "Agency workspace",
  kicker: "Agency workspace",
  headline: { lead: "", swipe: "Agency workspace" },
  lede: "Client workspaces, team roles and bulk actions.",
  hero: { mascot: "standing", bubble: "Here is what Agency workspace does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "module", module: "agencyWorkspace" },
  faqs: [],
  related: [],
  app: { href: "/agency", surface: "app" },
  seo: { title: "Agency workspace | ConstructHUB", description: "Client workspaces, team roles and bulk actions." },
  sources: ["client/src/pages/agency.tsx", "client/src/components/agency-workspace.tsx", "server/agency/"],
};

export default page;
