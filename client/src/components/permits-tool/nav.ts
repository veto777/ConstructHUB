/**
 * Permits & Databases as its own full-screen tool (owner, 2026-10-12: "create the same format for all other pages"):
 * under these routes the app sidebar is not shown; the shell (components/tool/product-shell.tsx) carries this menu.
 * One tool per page; the pages have no inner tabs, so no sub-items. Signed out, /databases and /property are public
 * pages (App.tsx PublicRouter) and never get the shell. Inside the phone app the menu hides what the sidebar hides.
 */
import { BellRing, CalendarClock, Database, History, Home, Search } from "lucide-react";
import type { ToolShellConfig } from "@/components/tool/shell";
import { APP_NAV } from "@/components/app-sidebar";

export function permitsNav(): ToolShellConfig {
  const tool = (key: string, label: string, path: string, icon: any, rail?: string) => ({ key, label, rail, icon, path, to: () => path, groups: [] });
  return {
    key: "permits", label: "Permits & Databases",
    tools: [
      tool("search", "Search permits", "/search", Search, "Search"),
      tool("databases", "Databases", "/databases", Database),
      tool("property", "Property records", "/property", Home, "Property"),
      tool("alerts", "Permit alerts", "/permit-alerts", BellRing, "Alerts"),
      tool("schedules", "Schedules", "/schedules", CalendarClock),
      tool("history", "History", "/history", History),
    ].filter((t) => APP_NAV.shownHere({ url: t.path })),
  };
}
