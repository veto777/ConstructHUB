import { useState } from "react";
import {
  LayoutDashboard, CalendarDays, Inbox, Users, MoreHorizontal,
  KanbanSquare, BookOpen, CreditCard, Building2, Settings, Sun, Moon,
  ShieldCheck, FileText, FilePlus2, ReceiptText, Blocks, Plus, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { CrmCreateMenu } from "@/components/crm-create-menu";
import { InfoTip } from "@/components/info-tip";
import { useTheme } from "@/components/theme-provider";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * The CRM's mobile ribbon — the phone counterpart of the sidebar: a frosted,
 * safe-area-aware bar fixed to the bottom with five clean icon+label tabs
 * (Dashboard, Schedule, Inbox, Clients, More). Visible only below the md
 * breakpoint; the desktop sidebar is untouched. "More" opens a bottom sheet
 * with the rest of the workspace.
 */

const MORE_LINKS: {
  title: string; url: string; icon: LucideIcon; testid: string;
  /** ⓘ help-dialog key (lib/info-content.ts) shown beside the row. */
  infoKey: string;
  /** Permission required to see this item; undefined = everyone. */
  perm?: string;
  /** Platform admins only (ConstructHUB staff — see /api/crm/me). */
  platformAdmin?: boolean;
  active: (l: string) => boolean;
}[] = [
  { title: "Pipeline", url: "/crm/pipeline", icon: KanbanSquare, testid: "ribbon-more-pipeline",
    infoKey: "pipeline",
    active: (l) => l.startsWith("/crm/pipeline") || l.startsWith("/crm/projects") },
  { title: "Estimates", url: "/crm/estimates", icon: FileText, testid: "ribbon-more-estimates",
    infoKey: "estimates",
    active: (l) => l.startsWith("/crm/estimates") && l !== "/crm/estimates/new" },
  // The one-tap fast path — the action a field user wants from the driveway.
  { title: "New estimate", url: "/crm/estimates/new", icon: FilePlus2, testid: "ribbon-more-new-estimate",
    infoKey: "estimate-new",
    active: (l) => l === "/crm/estimates/new" },
  // Gated like the API: invoices are money, seePrices only.
  { title: "Invoices", url: "/crm/invoices", icon: ReceiptText, testid: "ribbon-more-invoices",
    infoKey: "invoices", perm: "seePrices",
    active: (l) => l.startsWith("/crm/invoices") },
  { title: "Price book", url: "/crm/pricebook", icon: BookOpen, testid: "ribbon-more-pricebook",
    infoKey: "pricebook",
    active: (l) => l.startsWith("/crm/pricebook") },
  { title: "Payments", url: "/crm/payments", icon: CreditCard, testid: "ribbon-more-payments",
    infoKey: "payments",
    active: (l) => l.startsWith("/crm/payments") },
  { title: "Team & Company", url: "/crm/team", icon: Building2, testid: "ribbon-more-team",
    infoKey: "team",
    active: (l) => l.startsWith("/crm/team") },
  // Gated like the sidebar, next to Settings where it grew from.
  { title: "Integrations", url: "/crm/integrations", icon: Blocks, testid: "ribbon-more-integrations",
    infoKey: "integrations", perm: "manageSettings",
    active: (l) => l.startsWith("/crm/integrations") },
  // Gated like the sidebar: only members with manageSettings see Settings.
  { title: "Settings", url: "/crm/settings", icon: Settings, testid: "ribbon-more-settings",
    infoKey: "settings", perm: "manageSettings",
    active: (l) => l.startsWith("/crm/settings") },
  // ConstructHUB staff only, like the sidebar.
  { title: "Platform Admin", url: "/crm/admin", icon: ShieldCheck, testid: "ribbon-more-admin",
    infoKey: "admin", platformAdmin: true,
    active: (l) => l.startsWith("/crm/admin") },
];

function RibbonTab({
  href,
  icon: Icon,
  label,
  active,
  testid,
  onClick,
}: {
  href?: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  testid: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
          active && "bg-primary/10",
        )}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
      </span>
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </>
  );
  const cls = cn(
    "flex flex-1 flex-col items-center gap-1 py-1.5 transition-colors",
    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
  );
  return href ? (
    <Link href={href} data-testid={testid} className={cls} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  ) : (
    <button type="button" data-testid={testid} className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

export function CrmRibbon() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });

  const moreActive = MORE_LINKS.some((l) => l.active(location));

  return (
    <>
      <nav
        data-testid="crm-ribbon"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border/60 bg-background/85 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <RibbonTab href="/" icon={LayoutDashboard} label="Dashboard" testid="ribbon-tab-dashboard"
          active={location === "/" || location === "/crm" || location === "/crm/home"} />
        <RibbonTab href="/crm/schedule" icon={CalendarDays} label="Schedule" testid="ribbon-tab-schedule"
          active={location.startsWith("/crm/schedule")} />
        <RibbonTab href="/crm/inbox" icon={Inbox} label="Inbox" testid="ribbon-tab-inbox"
          active={location.startsWith("/crm/inbox")} />
        <RibbonTab href="/crm/clients" icon={Users} label="Clients" testid="ribbon-tab-customers"
          active={location.startsWith("/crm/clients")} />
        <RibbonTab icon={MoreHorizontal} label="More" testid="ribbon-tab-more"
          active={moreActive} onClick={() => setMoreOpen(true)} />
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          data-testid="ribbon-more-sheet"
          className="rounded-t-2xl px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">More</SheetTitle>
            <SheetDescription className="sr-only">The rest of your workspace.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1">
            {/* The global Create menu — same items as the sidebar's button. */}
            <CrmCreateMenu
              trigger={
                <button
                  type="button"
                  data-testid="ribbon-button-create"
                  className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-semibold bg-primary text-primary-foreground transition-colors"
                >
                  <Plus className="h-5 w-5 shrink-0" strokeWidth={2.2} />
                  Create
                  <ChevronRight className="h-4 w-4 ml-auto opacity-70" />
                </button>
              }
            />
            {MORE_LINKS.filter((l) =>
              (!l.perm || me?.permissions?.[l.perm] === true) &&
              (!l.platformAdmin || me?.isPlatformAdmin === true),
            ).map((l) => (
              <div key={l.url} className="flex items-center gap-1">
                <Link href={l.url} data-testid={l.testid} onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-1 items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium transition-colors",
                    l.active(location)
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent",
                  )}>
                  <l.icon className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                  {l.title}
                </Link>
                <InfoTip k={l.infoKey} className="h-11 w-11 my-0 mx-0" />
              </div>
            ))}
            <button
              type="button"
              onClick={toggleTheme}
              data-testid="button-ribbon-theme-toggle"
              className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium text-foreground hover:bg-accent transition-colors"
            >
              {theme === "light"
                ? <Moon className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                : <Sun className="h-5 w-5 shrink-0" strokeWidth={1.8} />}
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
