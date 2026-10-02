import type { FeaturePage } from "./types";

/**
 * VPN Shield — STUB (status "stub"). Write it to shared/feature-pages/WRITING-GUIDE.md,
 * using siteScan.ts as the reference, then set status to "ready".
 */
const page: FeaturePage = {
  key: "vpnShield",
  slug: "vpn-shield",
  group: "protect",
  status: "stub",
  title: "VPN Shield",
  kicker: "VPN Shield",
  headline: { lead: "", swipe: "VPN Shield" },
  lede: "VPN and proxy visits blocked from your site.",
  hero: { mascot: "standing", bubble: "Here is what VPN Shield does." },
  steps: [],
  cards: [],
  audience: [],
  pricing: { kind: "allowance", allowance: { limit: "protectedSites", unit: "websites", period: "count" } },
  faqs: [],
  related: [],
  app: { href: "/vpn-shield", surface: "app" },
  seo: { title: "VPN Shield | ConstructHUB", description: "VPN and proxy visits blocked from your site." },
  sources: ["client/src/pages/vpn-shield.tsx", "server/tracking-script.ts"],
};

export default page;
