/**
 * The CRM's frame on a computer or tablet: the shared tool shell (components/tool/shell.tsx) with the CRM's sections
 * (crm-tool/nav.ts). Row 1 keeps what the sidebar held: Create, notifications, theme, your profile and sign out.
 * "All tools" is the way back to the rest of ConstructHUB, another host, so its links are full navigations.
 *
 * Phones and the iPhone app keep the sidebar + bottom ribbon frame (App.tsx): the ribbon is the phone's menu, and the
 * apps sell nothing, so they never get the links to the platform (App Store 3.1.3(f)).
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, LayoutGrid, LogOut, PlayCircle, Plus } from "lucide-react";
import { ToolShell, useMedia } from "@/components/tool/shell";
import { InToolShell } from "@/components/tool/in-shell";
import { CrmLogo } from "@/components/crm-logo";
import { CrmCreateMenu } from "@/components/crm-create-menu";
import { CrmNotificationsBell } from "@/components/crm-notifications-bell";
import { CrmDivisionSwitcher } from "@/components/crm-division-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { marketingUrl } from "@/lib/site";
import { crmNav } from "./nav";

function PlatformLinks() {
  const row = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-accent";
  return (
    <nav className="flex flex-col gap-1" aria-label="ConstructHUB">
      <a href={marketingUrl("/")} className={row} data-testid="link-crm-all-tools-platform">
        <LayoutGrid className="h-4 w-4" aria-hidden="true" /> All ConstructHUB tools <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </a>
      <a href={marketingUrl("/tutorials#group-crm")} className={row} data-testid="link-crm-all-tools-tutorials">
        <PlayCircle className="h-4 w-4" aria-hidden="true" /> Tutorials <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </a>
    </nav>
  );
}

export function CrmToolLayout({ footer, children }: { footer?: ReactNode; children: ReactNode }) {
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: user } = useQuery<{ email: string; displayName: string | null; avatarUrl: string | null } | null>({ queryKey: ["/api/auth/me"] });
  // Unanswered client messages: the badge that makes silence loud (only for the seats with an inbox).
  const { data: inbox } = useQuery<{ unreadTotal: number }>({
    queryKey: ["/api/crm/inbox"], refetchInterval: 30_000, enabled: me?.permissions?.manageCustomers === true,
  });
  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/auth/logout", {}),
    onSettled: () => { queryClient.clear(); window.location.href = "/auth"; },
  });
  const name = me?.member?.displayName || user?.displayName || user?.email || "";
  const config = crmNav(me);

  const brand = (
    <span className="flex items-center gap-2.5 min-w-0">
      <Link href="/crm" className="flex items-center gap-2.5 min-w-0" aria-label="CRM home" data-testid="link-crm-tool-home">
        <CrmLogo height={22} />
        {me?.org?.name && (
          <span className="hidden lg:flex items-center gap-1.5 min-w-0 max-w-[12rem] text-[12px] text-white/70" data-testid="text-crm-tool-org">
            {me.org.logoUrl && <img src={me.org.logoUrl} alt="" className="h-4 w-4 rounded-sm object-contain bg-white shrink-0" />}
            <span className="truncate">{me.org.name}</span>
          </span>
        )}
      </Link>
      {/* Division workspace: All divisions or one division (owner / division-less admins only). */}
      <CrmDivisionSwitcher variant="topbar" />
    </span>
  );

  const actions = (
    <>
      <CrmCreateMenu trigger={
        <button type="button" data-testid="button-create"
          className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--tool-orange)] px-3 text-[13px] font-semibold text-white shadow-sm hover:opacity-90">
          <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" /> Create <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
        </button>
      } />
      <CrmNotificationsBell />
      <ThemeToggle className="h-9 w-9" />
      <Link href="/crm/team?tab=profile" className="ml-1 inline-flex h-9 items-center rounded-md px-1 hover:bg-white/10" aria-label="Your profile" title={name} data-testid="link-profile">
        {user?.avatarUrl
          ? <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
          : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white">{(name || "?")[0]?.toUpperCase()}</span>}
      </Link>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} title="Sign out" aria-label="Sign out" data-testid="button-logout"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-50">
        <LogOut className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
      </button>
    </>
  );

  return (
    <InToolShell.Provider value>
      <ToolShell config={config} testId="crm-tool-shell" brand={brand} actions={actions} footer={footer}
        badges={{ messages: inbox?.unreadTotal || undefined }}
        allToolsLabel="All tools" allToolsNote="Everything else in ConstructHUB opens on constructhub.us. The CRM stays where you left it."
        allTools={() => <PlatformLinks />}>
        {children}
      </ToolShell>
    </InToolShell.Provider>
  );
}

/** The tool frame from 768px (the width the shell's icon rail appears at), the phone frame below it or when there is no tool frame. */
export function CrmFrame({ tool, children }: { tool: ReactNode | null; children: ReactNode }) {
  const phone = useMedia("(max-width: 767px)");
  return <>{tool && !phone ? tool : children}</>;
}
