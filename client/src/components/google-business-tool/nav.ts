/**
 * The Google Business tools as one full-screen tool (owner, 2026-10-12: "create the same format for all other pages
 * … to make this site look more spiffy"): no app sidebar, a rail of the Google Business pages, and each page's own
 * views as sub-items. Every entry is an existing route (App.tsx); the shell comes from components/tool/product-shell.
 */
import { Globe, Grid3X3, Image, LayoutDashboard, LifeBuoy, MapPin, Megaphone, PenLine, ScanEye, Users } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig, ToolSubItem } from "@/components/tool/shell";

/** Agency workspace tabs, each its own route (pages/agency.tsx reads the tab from the address). */
export const AGENCY_TABS: [string, string][] = [["locations", "Locations"], ["clients", "Clients"], ["team", "Team"], ["onboarding", "Onboarding"], ["jobs", "Jobs"], ["settings", "Settings"]];
export const agencyHref = (tab: string) => (tab === "locations" ? "/agency" : `/agency/${tab}`);

const at = (url: string) => (_c: ToolNavCtx) => url;
const page = (key: string, label: string, path: string, params?: Record<string, string>): ToolSubItem => ({
  key, label, path, params, to: at(params ? `${path}?${new URLSearchParams(params)}` : path),
});

export function googleBusinessNav(): ToolShellConfig {
  return {
    key: "google-business", label: "Google Business",
    tools: [
      { key: "overview", label: "Overview", icon: LayoutDashboard, path: "/google-business", to: at("/google-business"), groups: [] },
      {
        key: "locations", label: "Locations", icon: MapPin, path: "/locations", paths: ["/google-profile"], to: at("/locations"),
        groups: [{ key: "main", items: [page("all", "All locations", "/locations"), page("import", "Import from Google", "/locations", { import: "gbp" })] }],
      },
      // Posts and photos are two tools (owner 2026-10-15: "Make posts separately"), one queue underneath.
      { key: "posts", label: "Posts", icon: Megaphone, path: "/gbp-content", to: at("/gbp-content"), groups: [] },
      {
        key: "photos", label: "Photos", icon: Image, path: "/gbp-photos", paths: ["/photos", "/media-library"], to: at("/gbp-photos"),
        groups: [{ key: "main", items: [page("upload", "Upload & schedule", "/gbp-photos"), page("optimizer", "Photo optimizer", "/photos"), page("library", "Media library", "/media-library")] }],
      },
      { key: "listing", label: "Listing editor", rail: "Listing", icon: PenLine, path: "/listing-editor", to: at("/listing-editor"), groups: [] },
      { key: "monitor", label: "Edit monitor", rail: "Monitor", icon: ScanEye, path: "/gmb-monitor", to: at("/gmb-monitor"), groups: [] },
      { key: "grid", label: "Ranking grid", rail: "Ranking grid", icon: Grid3X3, path: "/ranking-grid", to: at("/ranking-grid"), groups: [] },
      { key: "reinstatement", label: "Reinstatement", rail: "Reinstate", icon: LifeBuoy, path: "/reinstatement", to: at("/reinstatement"), groups: [] },
      {
        key: "agency", label: "Agency", icon: Users, path: "/agency", paths: AGENCY_TABS.slice(1).map(([t]) => agencyHref(t)), to: at("/agency"),
        groups: [{ key: "tabs", items: AGENCY_TABS.map(([t, label]) => ({ key: t, label, path: agencyHref(t), to: at(agencyHref(t)) })) }],
      },
      {
        key: "domains", label: "Domains & alerts", rail: "Domains", icon: Globe, path: "/domains", paths: ["/mail-alerts"], to: at("/domains"), foot: true,
        groups: [{ key: "main", items: [page("domains", "Domains", "/domains"), page("mail", "Mail alerts", "/mail-alerts")] }],
      },
    ],
  };
}
