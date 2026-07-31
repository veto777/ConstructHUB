import {
  LayoutDashboard, Users, KanbanSquare, BookOpen, CreditCard, Building2,
  HardHat,
} from "lucide-react";
import { Link, useLocation } from "wouter";
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
import { useQuery } from "@tanstack/react-query";

/**
 * The CRM's own sidebar — slimmer and quieter than the marketing app's, but
 * the same shadcn idiom: wordmark up top, icon+label nav with an active pill,
 * theme toggle and user chip pinned to the bottom.
 */
const NAV = [
  { title: "Home", url: "/", icon: LayoutDashboard, testid: "link-portal-nav-home",
    active: (l: string) => l === "/" || l === "/crm" || l === "/crm/home" },
  { title: "Clients", url: "/crm/clients", icon: Users, testid: "link-portal-nav-clients",
    active: (l: string) => l.startsWith("/crm/clients") },
  { title: "Pipeline", url: "/crm/pipeline", icon: KanbanSquare, testid: "link-portal-nav-pipeline",
    active: (l: string) => l.startsWith("/crm/pipeline") || l.startsWith("/crm/projects") },
  { title: "Price book", url: "/crm/pricebook", icon: BookOpen, testid: "link-portal-nav-pricebook",
    active: (l: string) => l.startsWith("/crm/pricebook") },
  { title: "Payments", url: "/crm/payments", icon: CreditCard, testid: "link-portal-nav-payments",
    active: (l: string) => l.startsWith("/crm/payments") },
  { title: "Team & Company", url: "/crm/team", icon: Building2, testid: "link-portal-nav-team",
    active: (l: string) => l.startsWith("/crm/team") },
];

export function CrmSidebar() {
  const [location] = useLocation();

  const { data: user } = useQuery<{ email: string; displayName: string | null; avatarUrl: string | null } | null>({
    queryKey: ["/api/auth/me"],
  });
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });

  const displayName = me?.member?.displayName || user?.displayName || user?.email || "";
  const orgName = me?.org?.name;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-2.5 cursor-pointer" data-testid="link-portal-home">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <HardHat className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="font-semibold text-[15px] leading-tight whitespace-nowrap" data-testid="text-crm-brand">
              ConstructHub <span className="text-sidebar-primary font-bold">CRM</span>
            </span>
            {orgName && (
              <span className="text-[11px] text-sidebar-foreground/50 truncate leading-tight mt-0.5">
                {orgName}
              </span>
            )}
          </div>
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
              {NAV.map((item) => (
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
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
