/**
 * Website tools as one full-screen tool (owner, 2026-10-12: "the same format for all other pages like … site scan"):
 * Site Scan, Search Console and Cloudflare share the rail — all three are about the client's website — and each
 * one's views are its sub-menu. Every view is a named route of App.tsx; the chosen ?site= carries along.
 */
import { ScanSearch } from "lucide-react";
import { brandIcon } from "@/components/brand-icon";
import type { ToolNavCtx, ToolShellConfig, ToolSubItem } from "@/components/tool/shell";
import { viewHref } from "@/hooks/use-tool-view";

export const SITE_SCAN_VIEWS = { scan: "", history: "history" } as const;
/** The page's own tab names (site-connections.tsx) → route segment. */
export const SEARCH_CONSOLE_VIEWS = { Sites: "", Connections: "connections", Onboarding: "onboarding", "Work queue": "work-queue", Guide: "guide" } as const;
export const CLOUDFLARE_VIEWS = { Sites: "", Connections: "connections", Onboarding: "onboarding", "Work queue": "work-queue", "Edge audit": "edge-audit", Guide: "guide" } as const;

const items = (base: string, views: Record<string, string>, labels: Record<string, string> = {}, keep = ["site"]): ToolSubItem[] =>
  Object.entries(views).map(([key, slug]) => ({
    key: slug || "main", label: labels[key] ?? key, path: slug ? `${base}/${slug}` : undefined,
    to: (c: ToolNavCtx) => viewHref(base, slug, c.params, keep),
  }));
const paths = (base: string, views: Record<string, string>) => Object.values(views).filter(Boolean).map((s) => `${base}/${s}`);

export function websiteNav(): ToolShellConfig {
  return {
    key: "website", label: "Website",
    tools: [
      { key: "site-scan", label: "Site Scan", icon: ScanSearch, path: "/site-scan", paths: paths("/site-scan", SITE_SCAN_VIEWS), to: () => "/site-scan",
        groups: [{ key: "views", items: items("/site-scan", SITE_SCAN_VIEWS, { scan: "New scan", history: "Scan history" }, []) }] },
      { key: "search-console", label: "Search Console", rail: "Search Console", icon: brandIcon("search_console"), path: "/search-console", paths: paths("/search-console", SEARCH_CONSOLE_VIEWS), to: () => "/search-console",
        groups: [{ key: "views", items: items("/search-console", SEARCH_CONSOLE_VIEWS) }] },
      { key: "cloudflare", label: "Cloudflare", icon: brandIcon("cloudflare"), path: "/cloudflare", paths: paths("/cloudflare", CLOUDFLARE_VIEWS), to: () => "/cloudflare",
        groups: [{ key: "views", items: items("/cloudflare", CLOUDFLARE_VIEWS) }] },
    ],
  };
}
