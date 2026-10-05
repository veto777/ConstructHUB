import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Home, Phone, Star, MapPin, Camera, Grid3X3, ShieldCheck, Fingerprint, PhoneCall, ScanSearch, Megaphone, Search,
  Building, Globe, Users, Settings, LayoutDashboard, CalendarDays, Inbox, KanbanSquare, FileText, FilePlus2,
  ReceiptText, BookOpen, CreditCard, Building2, BarChart3, type LucideIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** The phone tab bars each person picks (shared/tab-bar.ts; server/account/ui-prefs.ts). */
export type TabPrefs = { platformTabs: string[] | null; crmTabs: string[] | null };
const KEY = ["/api/account/ui-prefs"];

export function useTabPrefs(enabled = true) {
  return useQuery<TabPrefs>({ queryKey: KEY, enabled, retry: false, staleTime: 60_000 });
}

export function useSaveTabPrefs() {
  return useMutation({
    mutationFn: async (next: Partial<TabPrefs>) => (await apiRequest("PUT", "/api/account/ui-prefs", next)).json() as Promise<TabPrefs>,
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
}

export const PLATFORM_TAB_ICONS: Record<string, LucideIcon> = {
  home: Home, calls: Phone, reviews: Star, locations: MapPin, posts: Camera, rankings: Grid3X3, "click-guard": ShieldCheck,
  "ip-tracker": Fingerprint, "lsa-leads": PhoneCall, "site-scan": ScanSearch, social: Megaphone, permits: Search,
  property: Building, domains: Globe, agency: Users, settings: Settings,
};

export const CRM_TAB_ICONS: Record<string, LucideIcon> = {
  home: LayoutDashboard, schedule: CalendarDays, inbox: Inbox, clients: Users, pipeline: KanbanSquare, estimates: FileText,
  "new-estimate": FilePlus2, invoices: ReceiptText, pricebook: BookOpen, payments: CreditCard, team: Building2, reports: BarChart3,
};

/** Of the tabs shown, the one for this page: the longest matching path wins ("New estimate" over "Estimates"). */
export function activeTabKey(tabs: readonly { key: string; href: string; match?: readonly string[] }[], location: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const t of tabs) {
    for (const p of [t.href, ...(t.match ?? [])]) {
      const hit = p === "/" ? location === "/" || location === "/crm" : location === p || location.startsWith(p.endsWith("/") ? p : `${p}/`) || location.startsWith(`${p}?`);
      if (hit && (!best || p.length > best.len)) best = { key: t.key, len: p.length };
    }
  }
  return best?.key ?? null;
}
