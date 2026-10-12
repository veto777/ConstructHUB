/**
 * Google Ads as its own full-screen tool (owner, 2026-10-12: "create the same format for all other pages like … Click
 * guard, Ad fraud … to make this site look more spiffy"). Click Guard's and the Agency manager's sections are routes
 * of their own; the guides sit at the foot of the rail. Registered in components/tool/product-shell.tsx.
 */
import { BookOpenText, PhoneCall, ShieldCheck, Skull, Users } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig, ToolSubItem } from "@/components/tool/shell";

/** Click Guard's sections: the tab key the page uses, its address segment and its label. Dashboard is /google-ads. */
export const CLICK_GUARD_TABS = [
  ["dashboard", "", "Dashboard"], ["traffic", "traffic", "Traffic sources"], ["fraud", "signals", "Traffic signals"],
  ["tools", "tools", "Tools"], ["settings", "settings", "Domain settings"], ["link-ads", "script", "Google Ads script"],
] as const;
/** The Agency Ads & LSA manager's sections (landing door is platform-admin only and not in the menu). */
export const ADS_MANAGER_TABS = [
  ["recommendations", "", "Recommendations"], ["accounts", "accounts", "Client accounts"], ["invitations", "invitations", "Access invitations"],
  ["plans", "previews", "Protection previews"], ["jobs", "queue", "Queue"], ["findings", "audit", "Health audit"], ["landing", "landing-door", "Landing door"],
] as const;
/** The LSA account manager's sections (platform admins only; reached from the admin pages, not the menu). */
export const LSA_MANAGER_TABS = [["manager", "", "Manager connection"], ["accounts", "accounts", "Accounts"], ["invitations", "invitations", "Invitations"], ["audit", "audit", "Audit log"]] as const;
/** The Google Ads guide's chapters (pages/google-ads-guide.tsx), with short menu labels. */
const GUIDE_CHAPTERS: [string, string][] = [
  ["campaign-setup", "Campaign setup"], ["features-to-avoid", "Features to avoid"], ["assets", "Ad assets"], ["keywords", "Keywords"],
  ["location", "Location targeting"], ["bidding", "Bidding and budget"], ["ad-copy", "Ad copy"], ["landing-pages", "Landing pages"],
  ["ip-exclusions", "IP exclusions"], ["tracking", "Tracking"], ["click-fraud", "Click fraud"], ["mistakes", "Common mistakes"],
];
export const GUIDE_SECTIONS = GUIDE_CHAPTERS.map(([slug]) => slug);

export const routeOf = (base: string, seg: string) => (seg ? `${base}/${seg}` : base);
/** Every route a sectioned page answers on. */
export const sectionRoutes = (base: string, tabs: readonly (readonly [string, string, string])[]) => tabs.map(([, seg]) => routeOf(base, seg));

/** Keep Click Guard's chosen site (?domain=) from view to view. */
const keepDomain = (path: string) => (c: ToolNavCtx) => { const d = c.params.get("domain"); return d ? `${path}?domain=${encodeURIComponent(d)}` : path; };
const items = (base: string, tabs: readonly (readonly [string, string, string])[], keep: (path: string) => (c: ToolNavCtx) => string, skip: string[] = []): ToolSubItem[] =>
  tabs.filter(([key]) => !skip.includes(key)).map(([key, seg, label]) => ({ key, label, path: routeOf(base, seg), to: keep(routeOf(base, seg)) }));
const plain = (path: string) => () => path;

export function googleAdsNav(): ToolShellConfig {
  return {
    key: "google-ads", label: "Google Ads",
    tools: [
      { key: "click-guard", label: "Click Guard", rail: "Click Guard", icon: ShieldCheck, path: "/google-ads", paths: sectionRoutes("/google-ads", CLICK_GUARD_TABS), to: keepDomain("/google-ads"),
        groups: [{ key: "views", items: items("/google-ads", CLICK_GUARD_TABS, keepDomain) }] },
      { key: "ad-fraud", label: "Ad Fraud", icon: Skull, path: "/google-ad-fraud", to: plain("/google-ad-fraud"), groups: [] },
      { key: "ads-manager", label: "Agency Ads & LSA", rail: "Agency", icon: Users, path: "/ads-manager", paths: sectionRoutes("/ads-manager", ADS_MANAGER_TABS), to: plain("/ads-manager"),
        groups: [{ key: "views", items: items("/ads-manager", ADS_MANAGER_TABS, plain, ["landing"]) }] },
      { key: "lsa-leads", label: "LSA Leads", rail: "LSA Leads", icon: PhoneCall, path: "/lsa-leads", paths: sectionRoutes("/lsa-account-manager", LSA_MANAGER_TABS), to: plain("/lsa-leads"), groups: [] },
      { key: "guides", label: "Guides", icon: BookOpenText, foot: true, path: "/google-ads-guide", paths: ["/lsa-guide", ...GUIDE_SECTIONS.map((s) => `/google-ads-guide/${s}`)], to: plain("/google-ads-guide"),
        groups: [{ key: "guides", items: [
          { key: "ads", label: "Google Ads guide", path: "/google-ads-guide", to: plain("/google-ads-guide") },
          { key: "lsa", label: "LSA guide", path: "/lsa-guide", to: plain("/lsa-guide") },
        ] }, { key: "chapters", label: "Google Ads chapters", items: GUIDE_CHAPTERS.map(([slug, label]) => ({ key: slug, label, path: `/google-ads-guide/${slug}`, to: plain(`/google-ads-guide/${slug}`) })) }] },
    ],
  };
}
