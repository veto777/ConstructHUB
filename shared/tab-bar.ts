/**
 * The phone tab bar each user picks (owner, 2026-10-04: "Let the settings allow you to pick what's in your lower
 * Ribbon on mobile and app"). Four tabs are the user's; the fifth is always Menu (platform) / More (CRM), so every
 * page stays reachable. Saved per account (server/account/ui-prefs.ts), so the phone browser and the apps agree.
 */
export type TabOption = {
  key: string;
  label: string;
  href: string;
  /** Prefix-matches that light the tab up (besides href itself). */
  match?: readonly string[];
  /** CRM permission needed to see it (crm /api/crm/me permissions). */
  perm?: string;
};

export const TAB_SLOTS = 4;

export const PLATFORM_TAB_OPTIONS: readonly TabOption[] = [
  { key: "home", label: "Home", href: "/", match: ["/dashboard"] },
  { key: "calls", label: "Calls", href: "/call-assistant" },
  { key: "reviews", label: "Reviews", href: "/google-reviews" },
  { key: "locations", label: "Locations", href: "/locations" },
  { key: "posts", label: "Posts", href: "/gbp-content" },
  { key: "rankings", label: "Rankings", href: "/ranking-grid" },
  { key: "click-guard", label: "Click Guard", href: "/google-ads" },
  { key: "ip-tracker", label: "IP Tracker", href: "/ip-tracker" },
  { key: "lsa-leads", label: "LSA Leads", href: "/lsa-leads" },
  { key: "site-scan", label: "Site Scan", href: "/site-scan" },
  { key: "social", label: "Social", href: "/social-media" },
  { key: "permits", label: "Permits", href: "/search", match: ["/databases"] },
  { key: "property", label: "Property", href: "/property" },
  { key: "domains", label: "Domains", href: "/domains" },
  { key: "agency", label: "Agency", href: "/agency" },
  { key: "settings", label: "Settings", href: "/settings" },
];
export const PLATFORM_TAB_DEFAULT: readonly string[] = ["home", "calls", "reviews", "locations"];

export const CRM_TAB_OPTIONS: readonly TabOption[] = [
  { key: "home", label: "Dashboard", href: "/", match: ["/crm/home"] },
  { key: "schedule", label: "Schedule", href: "/crm/schedule" },
  { key: "inbox", label: "Inbox", href: "/crm/inbox", perm: "manageCustomers" },
  { key: "clients", label: "Clients", href: "/crm/clients" },
  { key: "pipeline", label: "Pipeline", href: "/crm/pipeline", match: ["/crm/projects"] },
  { key: "estimates", label: "Estimates", href: "/crm/estimates" },
  { key: "new-estimate", label: "New estimate", href: "/crm/estimates/new" },
  { key: "invoices", label: "Invoices", href: "/crm/invoices", perm: "seePrices" },
  { key: "pricebook", label: "Price book", href: "/crm/pricebook" },
  { key: "payments", label: "Payments", href: "/crm/payments" },
  { key: "team", label: "Team", href: "/crm/team" },
  { key: "reports", label: "Reports", href: "/crm/reports" },
];
export const CRM_TAB_DEFAULT: readonly string[] = ["home", "schedule", "inbox", "clients"];

/** A saved choice cleaned against the catalog: known keys, no repeats, at most TAB_SLOTS; empty/invalid → null. */
export function cleanTabChoice(raw: unknown, options: readonly TabOption[]): string[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set(options.map((o) => o.key));
  const out: string[] = [];
  for (const k of raw) if (typeof k === "string" && known.has(k) && !out.includes(k)) out.push(k);
  return out.length ? out.slice(0, TAB_SLOTS) : null;
}

/** The tabs to show: the user's choice (minus any they can't open), topped up from the defaults to fill the slots. */
export function resolveTabs(choice: readonly string[] | null | undefined, options: readonly TabOption[], defaults: readonly string[],
  can: (o: TabOption) => boolean = () => true): TabOption[] {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const picked: TabOption[] = [];
  for (const k of [...(choice ?? []), ...(choice?.length ? [] : defaults)]) {
    const o = byKey.get(k);
    if (o && can(o) && !picked.includes(o)) picked.push(o);
  }
  // A tab the user can't open (e.g. Inbox for a field crew) is replaced by the next default they can.
  for (const k of [...defaults, ...options.map((o) => o.key)]) {
    if (picked.length >= TAB_SLOTS) break;
    const o = byKey.get(k);
    if (o && can(o) && !picked.includes(o) && !(choice?.length && choice.includes(k))) picked.push(o);
  }
  return picked.slice(0, TAB_SLOTS);
}

export const tabIsActive = (o: TabOption, location: string): boolean =>
  (o.href === "/" ? location === "/" || location === "/crm" : location.startsWith(o.href)) ||
  (o.match ?? []).some((m) => location.startsWith(m));
