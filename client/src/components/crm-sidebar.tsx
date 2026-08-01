import {
  LayoutDashboard, Users, KanbanSquare, BookOpen, CreditCard, Building2,
  Settings, LogOut, ShieldCheck, FileText, ReceiptText, type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { CHLogo } from "@/components/ch-logo";
import { CrmLogo } from "@/components/crm-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * The CRM's own sidebar — slimmer and quieter than the marketing app's, but
 * the same shadcn idiom: wordmark up top, icon+label nav with an active pill,
 * theme toggle and user chip pinned to the bottom.
 */
const NAV: {
  title: string; url: string; icon: LucideIcon; testid: string;
  /** Permission required to see this item; undefined = everyone. */
  perm?: string;
  /** Platform admins only (ConstructHUB staff — see /api/crm/me). */
  platformAdmin?: boolean;
  active: (l: string) => boolean;
}[] = [
  { title: "Home", url: "/", icon: LayoutDashboard, testid: "link-portal-nav-home",
    active: (l: string) => l === "/" || l === "/crm" || l === "/crm/home" },
  { title: "Clients", url: "/crm/clients", icon: Users, testid: "link-portal-nav-clients",
    active: (l: string) => l.startsWith("/crm/clients") },
  { title: "Pipeline", url: "/crm/pipeline", icon: KanbanSquare, testid: "link-portal-nav-pipeline",
    active: (l: string) => l.startsWith("/crm/pipeline") || l.startsWith("/crm/projects") },
  { title: "Estimates", url: "/crm/estimates", icon: FileText, testid: "link-portal-nav-estimates",
    active: (l: string) => l.startsWith("/crm/estimates") },
  // Invoices carry money — hidden from members without seePrices, like the API.
  { title: "Invoices", url: "/crm/invoices", icon: ReceiptText, testid: "link-portal-nav-invoices",
    perm: "seePrices",
    active: (l: string) => l.startsWith("/crm/invoices") },
  { title: "Price book", url: "/crm/pricebook", icon: BookOpen, testid: "link-portal-nav-pricebook",
    active: (l: string) => l.startsWith("/crm/pricebook") },
  { title: "Payments", url: "/crm/payments", icon: CreditCard, testid: "link-portal-nav-payments",
    active: (l: string) => l.startsWith("/crm/payments") },
  { title: "Team & Company", url: "/crm/team", icon: Building2, testid: "link-portal-nav-team",
    active: (l: string) => l.startsWith("/crm/team") },
  // Gated: only members with manageSettings see (or can reach) Settings.
  { title: "Settings", url: "/crm/settings", icon: Settings, testid: "link-nav-settings",
    perm: "manageSettings",
    active: (l: string) => l.startsWith("/crm/settings") },
  // Gated: ConstructHUB staff only — cross-account monitoring, never org-scoped.
  { title: "Platform Admin", url: "/crm/admin", icon: ShieldCheck, testid: "link-portal-nav-admin",
    platformAdmin: true,
    active: (l: string) => l.startsWith("/crm/admin") },
];

export function CrmSidebar() {
  const [location] = useLocation();

  const { data: user } = useQuery<{ email: string; displayName: string | null; avatarUrl: string | null } | null>({
    queryKey: ["/api/auth/me"],
  });
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });

  const displayName = me?.member?.displayName || user?.displayName || user?.email || "";
  const orgName = me?.org?.name;

  // Sign out, drop every cached query (they hold org-scoped data), and land on
  // the login screen. A full navigation so no portal state survives.
  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/auth/logout", {}),
    onSettled: () => {
      queryClient.clear();
      window.location.href = "/auth";
    },
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-2.5 cursor-pointer min-w-0" data-testid="link-portal-home">
          {/* Full brand lockup (mark + CRM badge); collapses to the bare mark. */}
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <CrmLogo height={26} testid="text-crm-brand" />
            {orgName && (
              <span className="flex items-center gap-1.5 mt-1 min-w-0">
                {me?.org?.logoUrl && (
                  <img src={me.org.logoUrl} alt="" data-testid="img-sidebar-org-logo"
                    className="h-4 w-4 rounded-sm object-contain bg-white shrink-0" />
                )}
                <span className="text-[11px] text-sidebar-foreground/50 truncate leading-tight">
                  {orgName}
                </span>
              </span>
            )}
          </div>
          <CHLogo height={22} className="hidden group-data-[collapsible=icon]:inline-flex" />
        </Link>
      </SidebarHeader>

      <SidebarSeparator className="mx-0" />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 px-4">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 gap-1">
              {NAV.filter((item) =>
                (!item.perm || me?.permissions?.[item.perm] === true) &&
                (!item.platformAdmin || me?.isPlatformAdmin === true),
              ).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={item.active(location)}
                    tooltip={item.title}
                    className="h-9 rounded-lg px-3 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm"
                  >
                    <Link href={item.url} data-testid={item.testid} className="flex items-center gap-3 w-full">
                      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                      <span className="text-[13px] font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex items-center justify-between gap-1 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center">
          <div className="flex items-center gap-2 min-w-0 group-data-[collapsible=icon]:hidden">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/25 text-[11px] font-semibold text-sidebar-primary-foreground">
                {(displayName || "?")[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium truncate leading-tight" data-testid="text-user-name">
                {displayName}
              </div>
              {me?.member?.role && (
                <div className="text-[10px] text-sidebar-foreground/50 capitalize leading-tight">
                  {me.member.role}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 group-data-[collapsible=icon]:flex-col">
            <ThemeToggle className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent" />
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              title="Sign out"
              aria-label="Sign out"
              data-testid="button-logout"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
