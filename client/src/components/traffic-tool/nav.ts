/**
 * IP Tracker and VPN Shield as one full-screen tool (owner, 2026-10-12): both watch the visitors of the same tracked
 * sites (they share the site list), so they share the rail; each one's sections are its sub-menu, each a named
 * route of App.tsx. The chosen ?site= carries along.
 */
import { Fingerprint, ShieldOff } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig } from "@/components/tool/shell";
import { viewHref } from "@/hooks/use-tool-view";

/** ip-tracker.tsx's tab ids → route segment. */
export const IP_TRACKER_VIEWS = { dashboard: "", visitors: "visitors", traffic: "traffic", pages: "pages", geo: "geo", platforms: "platforms" } as const;
const IP_LABELS: Record<string, string> = { dashboard: "Dashboard", visitors: "Visitors", traffic: "Traffic", pages: "Pages", geo: "Geo", platforms: "Platforms" };
/** vpn-shield.tsx's tab ids → route segment. */
export const VPN_SHIELD_VIEWS = { overview: "", blocked: "flagged", install: "install", settings: "settings" } as const;
const VPN_LABELS: Record<string, string> = { overview: "Overview", blocked: "Flagged visits", install: "Install script", settings: "Settings" };

const sub = (base: string, views: Record<string, string>, labels: Record<string, string>) => [{
  key: "views",
  items: Object.entries(views).map(([id, slug]) => ({ key: id, label: labels[id], path: slug ? `${base}/${slug}` : undefined, to: (c: ToolNavCtx) => viewHref(base, slug, c.params, ["site"]) })),
}];
const paths = (base: string, views: Record<string, string>) => Object.values(views).filter(Boolean).map((s) => `${base}/${s}`);

export function trafficNav(): ToolShellConfig {
  return {
    key: "traffic", label: "Traffic protection",
    tools: [
      { key: "ip-tracker", label: "IP Tracker", icon: Fingerprint, path: "/ip-tracker", paths: paths("/ip-tracker", IP_TRACKER_VIEWS), to: (c) => viewHref("/ip-tracker", "", c.params, ["site"]), groups: sub("/ip-tracker", IP_TRACKER_VIEWS, IP_LABELS) },
      { key: "vpn-shield", label: "VPN Shield", icon: ShieldOff, path: "/vpn-shield", paths: paths("/vpn-shield", VPN_SHIELD_VIEWS), to: (c) => viewHref("/vpn-shield", "", c.params, ["site"]), groups: sub("/vpn-shield", VPN_SHIELD_VIEWS, VPN_LABELS) },
    ],
  };
}
