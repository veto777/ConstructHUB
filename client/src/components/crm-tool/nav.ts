/**
 * The CRM as a full-screen tool (owner, 2026-10-12: "create the same format for all other pages like … JobCam …"):
 * on a computer or tablet the CRM wears the shared <ToolShell> — navy bar, icon rail, a sub-menu where a section has
 * several real views. Phones and the iPhone app keep the CRM's own bottom ribbon (crm-ribbon.tsx), which the owner
 * can rearrange; see crm-tool/layout.tsx.
 *
 * Same sections and the same permission gates as the sidebar it replaces (crm-sidebar.tsx, which phones still use):
 * a section the seat cannot use is not offered.
 */
import {
  BookOpen, Blocks, Building2, CalendarDays, Camera, CreditCard, FileText, Images, Inbox, KanbanSquare, LayoutDashboard,
  ReceiptText, Ruler, Settings, ShieldCheck, Users,
} from "lucide-react";
import type { ToolDef, ToolNavCtx, ToolShellConfig } from "@/components/tool/shell";
import { CRM_ESTIMATES_MENU, crmHasAny } from "@shared/crm-access";

type Gate = { perm?: string; anyOf?: readonly string[]; platformAdmin?: boolean };
type Me = { permissions?: Record<string, boolean>; isPlatformAdmin?: boolean } | null | undefined;

const isJobcam = (p: string) => p.startsWith("/crm/jobcam") || /^\/crm\/projects\/[^/]+\/jobcam/.test(p);
const fixed = (to: string) => (_c: ToolNavCtx) => to;

const SECTIONS: (ToolDef & Gate)[] = [
  { key: "home", label: "Home", icon: LayoutDashboard, path: "/crm", paths: ["/", "/crm/home"], to: fixed("/crm"), groups: [] },
  { key: "clients", label: "Clients", icon: Users, path: "/crm/clients", to: fixed("/crm/clients"), groups: [] },
  // Gated like the inbox API (server/crm/inbox.ts: manageCustomers).
  { key: "messages", label: "Messages", icon: Inbox, path: "/crm/inbox", to: fixed("/crm/inbox"), groups: [], perm: "manageCustomers" },
  { key: "pipeline", label: "Pipeline", icon: KanbanSquare, path: "/crm/pipeline", paths: ["/crm/projects"],
    match: (p) => p.startsWith("/crm/projects/") && !isJobcam(p), to: fixed("/crm/pipeline"), groups: [] },
  { key: "schedule", label: "Schedule", icon: CalendarDays, path: "/crm/schedule", to: fixed("/crm/schedule"), groups: [] },
  // Every member shoots (field crews included): no gate; the API scopes by project visibility.
  { key: "jobcam", label: "JobCam", icon: Camera, path: "/crm/jobcam", match: isJobcam, to: fixed("/crm/jobcam"), groups: [] },
  // Every project photo across the jobs; the API scopes rows like the client pages.
  { key: "photos", label: "Photos", icon: Images, path: "/crm/photos", to: fixed("/crm/photos"), groups: [] },
  { key: "estimates", label: "Estimates", icon: FileText, path: "/crm/estimates", to: fixed("/crm/estimates"), anyOf: CRM_ESTIMATES_MENU,
    groups: [{ key: "views", items: [
      { key: "all", label: "All estimates", to: fixed("/crm/estimates") },
      { key: "new", label: "New estimate", path: "/crm/estimates/new", to: fixed("/crm/estimates/new") },
    ] }] },
  // Money: hidden without seePrices, like the API.
  { key: "invoices", label: "Invoices", icon: ReceiptText, path: "/crm/invoices", to: fixed("/crm/invoices"), groups: [], perm: "seePrices" },
  { key: "pricebook", label: "Price book", rail: "Prices", icon: BookOpen, path: "/crm/pricebook", to: fixed("/crm/pricebook"), groups: [], perm: "seePrices" },
  { key: "payments", label: "Payments", icon: CreditCard, path: "/crm/payments", to: fixed("/crm/payments"), groups: [], perm: "seePrices" },
  // HOVER / CladAI measurement reports: everyone reads them (the API scopes them); importing needs manageCustomers.
  // The old sidebar never listed them, so they were reachable only from Settings and Integrations.
  { key: "reports", label: "Measurement reports", rail: "Reports", icon: Ruler, path: "/crm/reports", to: fixed("/crm/reports"), groups: [] },
  { key: "team", label: "Team & Company", rail: "Team", icon: Building2, path: "/crm/team", to: fixed("/crm/team"), foot: true,
    groups: [{ key: "tabs", items: [
      { key: "profile", label: "My profile", to: fixed("/crm/team?tab=profile") },
      { key: "company", label: "Company", params: { tab: "company" }, to: fixed("/crm/team?tab=company") },
      { key: "team", label: "Team", params: { tab: "team" }, to: fixed("/crm/team?tab=team") },
    ] }] },
  { key: "integrations", label: "Integrations", rail: "Connect", icon: Blocks, path: "/crm/integrations", to: fixed("/crm/integrations"), groups: [], perm: "manageSettings", foot: true },
  // Import (/crm/migrate) grew out of Settings.
  { key: "settings", label: "Settings", icon: Settings, path: "/crm/settings", paths: ["/crm/migrate"], to: fixed("/crm/settings"), perm: "manageSettings", foot: true,
    groups: [{ key: "views", items: [
      { key: "settings", label: "Settings", to: fixed("/crm/settings") },
      { key: "import", label: "Import from another CRM", path: "/crm/migrate", to: fixed("/crm/migrate") },
    ] }] },
  // ConstructHUB staff only. /admin has its own full-bleed frame (App.tsx), so this is a way out, not a view.
  { key: "admin", label: "Platform Admin", rail: "Admin", icon: ShieldCheck, path: "/crm/admin", to: fixed("/admin"), groups: [], platformAdmin: true, foot: true },
];

/** The CRM's sections for this seat. */
export function crmNav(me: Me): ToolShellConfig {
  const allowed = (s: Gate) =>
    crmHasAny(me?.permissions, s.anyOf ?? (s.perm ? [s.perm] : [])) && (!s.platformAdmin || me?.isPlatformAdmin === true);
  return {
    key: "crm", label: "CRM",
    tools: SECTIONS.filter(allowed).map(({ perm: _p, anyOf: _a, platformAdmin: _x, ...t }) => ({
      ...t,
      // A crew member who cannot write estimates has no "New estimate".
      groups: t.key === "estimates" && me?.permissions?.manageEstimates !== true
        ? t.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== "new") }))
        : t.groups,
    })),
  };
}
