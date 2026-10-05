import { useState } from "react";
import {
  LayoutDashboard, CalendarDays, Inbox, Users, MoreHorizontal,
  KanbanSquare, BookOpen, CreditCard, Building2, Settings, Sun, Moon,
  ShieldCheck, FileText, FilePlus2, ReceiptText, Blocks, Plus, ChevronRight, Phone, LayoutGrid, ArrowUpRight, Trash2, SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { marketingUrl } from "@/lib/site";
import { inNativeApp } from "@/lib/app-shell";
import { CRM_TAB_DEFAULT, CRM_TAB_OPTIONS, resolveTabs, type TabOption } from "@shared/tab-bar";
import { CRM_TAB_ICONS, activeTabKey, useSaveTabPrefs, useTabPrefs } from "@/lib/tab-prefs";
import { TabBarPicker } from "@/components/tab-bar-picker";
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
  // No Call Assistant: it lives on the platform, not in the CRM (owner, 2026-10-02).
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

/** The default four keep the testids the specs already use. */
const RIBBON_TESTIDS: Record<string, string> = { home: "ribbon-tab-dashboard", schedule: "ribbon-tab-schedule", inbox: "ribbon-tab-inbox", clients: "ribbon-tab-customers" };

export function CrmRibbon() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });

  const prefs = useTabPrefs();
  const saveTabs = useSaveTabPrefs();
  const [customizing, setCustomizing] = useState(false);
  // A tab the person can't open (Inbox without manageCustomers, Invoices without seePrices) is never shown.
  const can = (o: TabOption) => !o.perm || me?.permissions?.[o.perm] !== false;
  const tabs = resolveTabs(prefs.data?.crmTabs, CRM_TAB_OPTIONS, CRM_TAB_DEFAULT, can);
  const activeKey = activeTabKey(tabs, location);
  const moreActive = !activeKey && MORE_LINKS.some((l) => l.active(location));

  return (
    <>
      <nav
        data-testid="crm-ribbon"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border/60 bg-background/85 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* The person's four tabs (Settings → Phone tab bar, or More → Customize the bar); More always stays last. */}
        {tabs.map((t) => (
          <RibbonTab key={t.key} href={t.href} icon={CRM_TAB_ICONS[t.key] ?? LayoutDashboard} label={t.label}
            testid={RIBBON_TESTIDS[t.key] ?? `ribbon-tab-${t.key}`} active={activeKey === t.key} />
        ))}
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
            {/* The global Create menu — same items as the sidebar's button.
                Anything it navigates to closes the sheet, like the links below
                (its dialogs live inside the sheet, so only close on leaving). */}
            <CrmCreateMenu
              onNavigate={() => setMoreOpen(false)}
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
            <button type="button" onClick={() => { setMoreOpen(false); setCustomizing(true); }} data-testid="ribbon-more-customize"
              className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium text-foreground hover:bg-accent transition-colors">
              <SlidersHorizontal className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              Customize the bar
            </button>
            {/* iPhone app only: self-serve account deletion (App Store 5.1.1(v); the website keeps the support request). */}
            {inNativeApp() && (
              <Link href="/account/delete" onClick={() => setMoreOpen(false)} data-testid="ribbon-more-delete-account"
                className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium text-destructive hover:bg-accent transition-colors">
                <Trash2 className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                Delete account
              </Link>
            )}
            {/* Back to the platform and every other ConstructHUB tool (another host: a full navigation). */}
            <a href={marketingUrl("/")} data-testid="ribbon-more-platform"
              className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium text-foreground hover:bg-accent transition-colors">
              <LayoutGrid className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              All ConstructHUB tools
              <ArrowUpRight className="ml-auto h-4 w-4 opacity-60" aria-hidden="true" />
            </a>
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

      <Sheet open={customizing} onOpenChange={setCustomizing}>
        <SheetContent side="bottom" data-testid="ribbon-customize-sheet"
          className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">Customize the bar</SheetTitle>
            <SheetDescription>Choose the four tabs at the bottom of the CRM on your phone and in the app.</SheetDescription>
          </SheetHeader>
          <TabBarPicker options={CRM_TAB_OPTIONS} defaults={CRM_TAB_DEFAULT} value={prefs.data?.crmTabs} icons={CRM_TAB_ICONS}
            can={can} lastLabel="More" saving={saveTabs.isPending} testIdPrefix="crm-tabs"
            onSave={(keys) => saveTabs.mutateAsync({ crmTabs: keys })} />
        </SheetContent>
      </Sheet>
    </>
  );
}
