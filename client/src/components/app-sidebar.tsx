import { useEffect, useState } from "react";
import {
  Cloud, Search, Database, Clock, FileText, Building, Camera, LogIn, LogOut,
  Eye, Grid3X3, CreditCard, Shield, MapPin, GraduationCap, ChevronRight,
  HardHat, Globe, ShieldAlert, ExternalLink, ShieldCheck, BadgeCheck,
  Settings, Skull, Megaphone, TrendingUp, Fingerprint, ShieldOff, Star, PlusCircle,
  Layers, Wrench, BookOpen, Rocket, FolderOpen, Users, PhoneCall,
  KanbanSquare, ArrowRight, Bell, Lock, Phone, LayoutGrid, Store, KeyRound, Bug,
} from "lucide-react";
import { PLANS, planForModule, type ModuleKey } from "@shared/plans";
import permitsLogo from "@assets/Permits_1772157993497.png";
import masterclassLogo from "@assets/Masterclass_1772158106209.png";
import priceLogo from "@assets/Price_1772158106209.png";
import ipTrackerLogo from "@assets/IP_tracker_1772159260377.png";
import vpnBlockerLogo from "@assets/VPN_BLocker_1772159189610.png";
import { Link, useLocation } from "wouter";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { County } from "@shared/schema";
import { CHLogo } from "@/components/ch-logo";
import { StandingGator } from "@/components/mascot";

/** Round orange badges matching the IP Tracker / Pricing artwork. */
function SocialMediaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#F1592F" />
      <path d="M12 21.5h5l12-7v19l-12-7h-5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2z" fill="#fff" />
      <path d="M15 26.5l2.2 7.5h3.6l-1.8-7.5z" fill="#3F4650" />
      <rect x="29" y="14.5" width="3" height="19" rx="1.5" fill="#3F4650" />
      <path d="M35 19.5c1.6 1.2 2.5 2.8 2.5 4.5s-.9 3.3-2.5 4.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A white handset on the orange disc (lucide's Phone glyph, centred). */
function CallAssistantIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#F1592F" />
      <g transform="translate(12 12)">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" fill="#fff" />
      </g>
      <path d="M29.5 13.5a8 8 0 0 1 5 5M28.8 17.3a4 4 0 0 1 1.9 1.9" stroke="#3F4650" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function SiteScanIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#F1592F" />
      <rect x="9" y="12" width="26" height="20" rx="2.5" fill="#fff" />
      <rect x="9" y="12" width="26" height="5" rx="2.5" fill="#3F4650" />
      <rect x="13" y="21" width="10" height="2.2" rx="1.1" fill="#F1592F" />
      <rect x="13" y="25.5" width="7" height="2.2" rx="1.1" fill="#3F4650" />
      <circle cx="29" cy="28" r="6" fill="#fff" stroke="#3F4650" strokeWidth="2.6" />
      <path d="M33.3 32.3l4.7 4.7" stroke="#3F4650" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function CloudflareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#F1592F" />
      <path d="M15 31h19.5a5.5 5.5 0 0 0 .8-10.94A8 8 0 0 0 20 19.2 6 6 0 0 0 15 31z" fill="#fff" />
      <path d="M18 27.5h14" stroke="#3F4650" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M21 31.5h8" stroke="#3F4650" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function SearchConsoleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#F1592F" />
      <rect x="11" y="24" width="4.5" height="10" rx="1.2" fill="#fff" />
      <rect x="18" y="18" width="4.5" height="16" rx="1.2" fill="#fff" />
      <rect x="25" y="13" width="4.5" height="21" rx="1.2" fill="#fff" />
      <circle cx="31" cy="27" r="5.2" fill="#fff" stroke="#3F4650" strokeWidth="2.4" />
      <path d="M34.8 30.8l4.2 4.2" stroke="#3F4650" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function GoogleGIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GoogleBusinessIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M22 8.5l-2-4.5H4L2 8.5h20z" fill="#4285F4"/>
      <path d="M2 8.5C2 10.43 3.57 12 5.5 12S9 10.43 9 8.5" fill="#34A853"/>
      <path d="M9 8.5C9 10.43 10.57 12 12.5 12S16 10.43 16 8.5" fill="#FBBC05"/>
      <path d="M16 8.5C16 10.43 17.57 12 19.5 12S23 10.43 23 8.5" fill="#EA4335"/>
      <path d="M4 11v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" stroke="#4285F4" strokeWidth="1.5" fill="none"/>
      <rect x="9" y="15" width="6" height="6" rx="0.5" fill="#4285F4" opacity="0.3"/>
    </svg>
  );
}

function GoogleAdsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M3.27 16.66l6.54-11.32a2.78 2.78 0 0 1 3.81-1.02l.01.01a2.78 2.78 0 0 1 1.02 3.8L8.11 19.46a2.78 2.78 0 0 1-3.82 1.01 2.78 2.78 0 0 1-1.02-3.81z" fill="#FBBC05"/>
      <path d="M14.65 5.33l6.54 11.33a2.78 2.78 0 0 1-1.02 3.8 2.78 2.78 0 0 1-3.81-1.01L9.82 8.12a2.78 2.78 0 0 1 1.02-3.8 2.78 2.78 0 0 1 3.81 1.01z" fill="#4285F4"/>
      <circle cx="5.96" cy="19.5" r="2.78" fill="#34A853"/>
    </svg>
  );
}

type BadgeType = "new" | "hot" | "best";
/** testId overrides the title-derived test id when two items share a title. */
type NavChild = { title: string; url: string; icon: any; badge?: BadgeType; subChildren?: NavChild[]; testId?: string };

/** Pages of the modules only some plans include; the page itself shows the plan_required card. */
const MODULE_BY_URL: Record<string, ModuleKey> = {
  "/agency": "agencyWorkspace",
  "/domains": "domainsMailAlerts",
  "/mail-alerts": "domainsMailAlerts",
  "/ads-manager": "adsManager",
  "/cloudflare": "cloudflareSearchConsole",
  "/search-console": "cloudflareSearchConsole",
};

/** url → the plan name to show before the click, or null when the account can use the page. */
type PlanBadgeFor = (url: string) => string | null;

/** "Agency" on a module the signed-in account's plan doesn't include, so the upgrade card is no surprise. */
function PlanBadge({ plan, label }: { plan: string; label: string }) {
  // The sidebar is narrow: a lock keeps the page name readable; the plan is in the tooltip and for screen readers.
  return (
    <span
      className="ml-auto shrink-0 inline-flex items-center p-0.5 text-sidebar-foreground/60"
      title={`Included with the ${plan} plan`}
      data-testid={`badge-plan-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{plan} plan</span>
    </span>
  );
}

const navTestId = (item: { title: string; testId?: string }) =>
  item.testId ?? `link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`;

/** SPA navigation never scrolls to a #fragment on its own; find it once the page renders. */
function scrollToFragment(url: string) {
  const id = url.split("#")[1];
  if (!id) return;
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) { if (tries++ < 30) setTimeout(tick, 100); return; }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Content above it (plan cards) loads async and pushes it down: settle once more.
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 900);
  };
  setTimeout(tick, 0);
}
type NavGroup = {
  label: string;
  icon: any;
  logo?: string;
  logoComponent?: (props: { className?: string }) => JSX.Element;
  landingUrl?: string;
  children: NavChild[];
};

function FeatureBadge({ type, label }: { type: BadgeType; label: string }) {
  return <span className="sr-only" data-testid={`badge-${type}-${label.toLowerCase().replace(/\s+/g, "-")}`}>{type === "new" ? "New" : type === "hot" ? "Popular" : "Recommended"}</span>;
}

const permitsGroup: NavGroup = {
  label: "Permits & Databases",
  icon: HardHat,
  logo: permitsLogo,
  landingUrl: "/features/permits",
  children: [
    { title: "Search Permits", url: "/search", icon: Search },
    { title: "Database Directory", url: "/databases", icon: Database },
    { title: "Property Records", url: "/property", icon: Building },
    { title: "Scrape Schedules", url: "/schedules", icon: Clock },
    { title: "Search History", url: "/history", icon: FileText },
  ],
};

const googleGroups: NavGroup[] = [
  {
    label: "Google Business",
    icon: Globe,
    logoComponent: GoogleBusinessIcon,
    landingUrl: "/google-business",
    children: [
      { title: "Google Profile", url: "/google-profile", icon: Store },
      { title: "Agency", url: "/agency", icon: Users },
      { title: "Locations", url: "/locations", icon: MapPin },
      { title: "Domains", url: "/domains", icon: Globe },
      { title: "Mail alerts", url: "/mail-alerts", icon: Bell },
      { title: "Posts & Photos", url: "/gbp-content", icon: Camera },
      { title: "GMB Edit Monitor", url: "/gmb-monitor", icon: Eye },
      { title: "GMB Ranking Grid", url: "/ranking-grid", icon: Grid3X3, badge: "hot" as BadgeType },
      { title: "Photo Optimizer", url: "/photos", icon: Camera, subChildren: [
        { title: "Media Library", url: "/media-library", icon: FolderOpen },
      ]},
      { title: "Reinstatement", url: "/reinstatement", icon: ShieldAlert },
    ],
  },
  {
    label: "Google Ads",
    icon: TrendingUp,
    logoComponent: GoogleAdsIcon,
    landingUrl: "/features/click-guard",
    children: [
      { title: "Agency Ads & LSA", url: "/ads-manager", icon: Megaphone, badge: "new" as BadgeType },
      { title: "Click Guard", url: "/google-ads", icon: ShieldCheck, badge: "hot" as BadgeType },
      { title: "Ad Fraud", url: "/google-ad-fraud", icon: Skull },
      { title: "Ads Guide", url: "/google-ads-guide", icon: Megaphone },
      { title: "LSA Guide", url: "/lsa-guide", icon: BadgeCheck },
      { title: "LSA Leads", url: "/lsa-leads", icon: PhoneCall, badge: "new" as BadgeType },
    ],
  },
];

const googleReviewsItem = { title: "Google Reviews", url: "/google-reviews", icon: Star, logoComponent: GoogleGIcon, badge: "best" as BadgeType };

const standaloneItems: { title: string; url: string; icon: any; logo?: string; logoComponent?: (props: { className?: string }) => JSX.Element; landingUrl?: string; badge?: BadgeType }[] = [
  // The AI Call Assistant's dashboard is a platform page (/call-assistant signed in); the CRM is a standalone
  // service and never hosts it (owner, 2026-10-02). Signed out, /call-assistant is the feature page.
  { title: "Call Assistant", url: "/call-assistant", icon: Phone, logoComponent: CallAssistantIcon, badge: "new" },
  { title: "Social Media", url: "/social-media", icon: Megaphone, logoComponent: SocialMediaIcon },
  { title: "Site Scan", url: "/site-scan", icon: Search, logoComponent: SiteScanIcon },
  { title: "Cloudflare", url: "/cloudflare", icon: Cloud, logoComponent: CloudflareIcon },
  { title: "Search Console", url: "/search-console", icon: Search, logoComponent: SearchConsoleIcon },
  { title: "IP Tracker", url: "/ip-tracker", icon: Fingerprint, logo: ipTrackerLogo, badge: "hot" },
  { title: "VPN Shield", url: "/vpn-shield", icon: ShieldOff, logo: vpnBlockerLogo, badge: "new" },
  ...(SHOW_COMPETITOR_INTEL ? [{ title: "Competitor Intel", url: "/competitors", icon: Shield, landingUrl: "/features/competitors" }] : []),
  { title: "Master Class", url: "/master-class", icon: GraduationCap, logo: masterclassLogo, landingUrl: "/features/master-class" },
];

const pricingGroup: NavGroup = {
  label: "Pricing & Plans",
  icon: CreditCard,
  logo: priceLogo,
  children: [
    { title: "Subscription Plans", url: "/pricing", icon: Layers },
    { title: "Add-ons", url: "/pricing#add-ons", icon: PlusCircle },
    // Every feature's intro page, for any signed-in account deciding what to add.
    { title: "All features", url: "/features", icon: LayoutGrid },
    { title: "Master Class", url: "/features/master-class", icon: BookOpen, testId: "link-nav-pricing-master-class" },
    // The done-for-you SEO packages section of the pricing page.
    { title: "SEO Services", url: "/pricing#services", icon: Rocket },
  ],
};

function CollapsibleNavGroup({ group, planBadgeFor = () => null }: { group: NavGroup; planBadgeFor?: PlanBadgeFor }) {
  const [location] = useLocation();
  const isActiveGroup = group.children.some(c => c.url === location || c.subChildren?.some(sc => sc.url === location)) || location === group.landingUrl;
  const [open, setOpen] = useState(isActiveGroup);

  return (
    <SidebarMenuItem>
      <div className="flex items-center">
        <SidebarMenuButton
          className="cursor-pointer flex-1"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          data-testid={`link-nav-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {group.logoComponent ? (
            <group.logoComponent className="h-5 w-5 min-w-5 min-h-5 shrink-0" />
          ) : group.logo ? (
            <img src={group.logo} alt="" className="h-5 w-5 min-w-5 min-h-5 object-cover rounded-full shrink-0" />
          ) : (
            <group.icon className="h-5 w-5 min-w-5 min-h-5 shrink-0" />
          )}
          <span className="font-medium">{group.label}</span>
          <ChevronRight className={`ml-auto h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </SidebarMenuButton>
        {group.landingUrl && (
          <Link href={group.landingUrl} className="p-1.5 rounded-md hover:bg-sidebar-accent transition-colors mr-1" data-testid={`link-nav-${group.label.toLowerCase().replace(/\s+/g, "-")}-landing`}>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </Link>
        )}
      </div>
      {open && (
        <SidebarMenuSub>
          {group.children.map(item => (
            <SidebarMenuSubItem key={item.title}>
              <SidebarMenuSubButton
                asChild
                isActive={location === item.url}
              >
                <Link href={item.url} onClick={() => scrollToFragment(item.url)} data-testid={navTestId(item)} className="flex items-center gap-1.5 w-full min-w-0">
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.title}</span>
                  {(() => {
                    const plan = planBadgeFor(item.url);
                    if (plan) return <PlanBadge plan={plan} label={item.title} />;
                    return item.badge ? <FeatureBadge type={item.badge} label={item.title} /> : null;
                  })()}
                </Link>
              </SidebarMenuSubButton>
              {item.subChildren && item.subChildren.map(sub => (
                <SidebarMenuSubButton
                  key={sub.title}
                  asChild
                  isActive={location === sub.url}
                  className="pl-6"
                >
                  <Link href={sub.url} data-testid={navTestId(sub)} className="flex items-center gap-1.5 w-full min-w-0">
                    <sub.icon className="h-3 w-3 shrink-0" />
                    <span className="truncate text-xs">{sub.title}</span>
                    {sub.badge && <FeatureBadge type={sub.badge} label={sub.title} />}
                  </Link>
                </SidebarMenuSubButton>
              ))}
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();

  // On a phone the sidebar is a sheet over the page: close it once a link
  // (group child, standalone item or the footer Settings) has navigated.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: dbCounts } = useQuery<{ total: number; county: number; city: number }>({
    queryKey: ["/api/databases/counts"],
  });

  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const { data: user } = useQuery<{ id: number; email: string; displayName: string | null; avatarUrl: string | null; isPlatformAdmin?: boolean } | null>({
    queryKey: ["/api/auth/me"],
  });

  // Which plan-gated modules this account can open. Agency workspace follows the
  // workspace owner's plan (members need none of their own), so it reads /api/agency/me.
  const { data: entitlements } = useQuery<{ modules?: Partial<Record<ModuleKey, boolean>> } | null>({
    queryKey: ["/api/entitlements"],
    enabled: !!user,
  });
  const { data: agencyMe } = useQuery<{ entitled?: boolean } | null>({
    queryKey: ["/api/agency/me"],
    enabled: !!user,
  });
  // The issue desk's badge: issues nobody has looked at yet (403 until the admin sign-in passes — then no count).
  const { data: issueSummary } = useQuery<{ new: number; fixReady: number }>({
    queryKey: ["/api/admin/issues/summary"],
    enabled: user?.isPlatformAdmin === true,
    refetchInterval: 60_000,
  });
  const newIssues = issueSummary?.new ?? 0;
  const planBadgeFor: PlanBadgeFor = (url) => {
    const module = MODULE_BY_URL[url];
    if (!module || !user) return null;
    const allowed = module === "agencyWorkspace" ? agencyMe?.entitled : entitlements?.modules?.[module];
    // Unknown (loading or failed) shows nothing rather than a wrong lock.
    return allowed === false ? PLANS[planForModule(module)].name : null;
  };

  const activeCount = dbCounts?.total ?? 0;
  const countyCount = counties?.length ?? 0;

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Still signed in: refresh so the UI shows the truth, stay put.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      return;
    }
    // Drop every cached account response and leave the signed-in page with a
    // fresh document, so nothing from the old session lingers in memory.
    queryClient.clear();
    window.location.assign("/");
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 pb-3">
        <Link href="/" className="flex items-center justify-between gap-3 cursor-pointer" data-testid="link-logo-home">
          <span className="flex flex-col min-w-0">
            <CHLogo height={36} />
            <p className="sr-only" data-testid="text-app-title">The All-in-One Growth Platform for Contractors</p>
          </span>
          {/* The mascot stands beside the mark on every ConstructHUB sidebar. */}

        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* ConstructHub CRM — included in every paid plan, on its own portal.
            Prominent pathway in through the /crm-app gateway (member → portal, else plans). */}
        <SidebarGroup>
          <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Workspace</div>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild data-active={location === "/crm-app"}>
                  <Link href="/crm-app" data-testid="link-nav-crm" className="flex items-center gap-2 w-full">
                    <KanbanSquare className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-primary" />
                    <span className="font-semibold">CRM</span>
                    <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-sidebar-foreground/60">
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <CollapsibleNavGroup group={permitsGroup} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Growth</div>
            <SidebarMenu>
              {googleGroups.map(group => (
                <CollapsibleNavGroup key={group.label} group={group} planBadgeFor={planBadgeFor} />
              ))}
              {SHOW_GOOGLE_REVIEWS && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    data-active={location === googleReviewsItem.url}
                  >
                    <Link href={googleReviewsItem.url} data-testid="link-nav-google-reviews" className="flex items-center gap-2 w-full">
                      <GoogleGIcon className="h-5 w-5 min-w-5 min-h-5 shrink-0" />
                      <span>Google Reviews</span>
                      <FeatureBadge type="best" label="Google Reviews" />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Tools</div>
            <SidebarMenu>
              {standaloneItems.map(item => (
                <SidebarMenuItem key={item.url}>
                  <div className="flex items-center">
                    <SidebarMenuButton
                      asChild
                      data-active={location === item.url}
                      className="flex-1"
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`} className="flex items-center gap-2 w-full">
                        {item.logoComponent ? (
                          <item.logoComponent className="h-5 w-5 min-w-5 min-h-5 shrink-0" />
                        ) : item.logo ? (
                          <img src={item.logo} alt="" className="h-5 w-5 min-w-5 min-h-5 object-cover rounded-full shrink-0" />
                        ) : (
                          <item.icon className="h-5 w-5 min-w-5 min-h-5 shrink-0" />
                        )}
                        <span>{item.title}</span>
                        {planBadgeFor(item.url)
                          ? <PlanBadge plan={planBadgeFor(item.url)!} label={item.title} />
                          : item.badge && <FeatureBadge type={item.badge} label={item.title} />}
                      </Link>
                    </SidebarMenuButton>
                    {item.landingUrl && (
                      <Link href={item.landingUrl} className="p-1.5 rounded-md hover:bg-sidebar-accent transition-colors mr-1" data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}-landing`}>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    )}
                  </div>
                </SidebarMenuItem>
              ))}
              <CollapsibleNavGroup group={pricingGroup} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {user?.isPlatformAdmin === true && <SidebarGroup>
          <details open={location.startsWith("/admin/") || location === "/lsa-account-manager"}>
            <summary className="cursor-pointer rounded-md px-2 py-3 text-sm font-medium">Admin</summary>
            <SidebarMenu>              {/* The server decides who is a platform admin (/api/auth/me). */}
              {user?.isPlatformAdmin === true && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-active={location === "/lsa-account-manager"}>
                    <Link href="/lsa-account-manager" data-testid="link-nav-lsa-account-manager" className="flex items-center gap-2 w-full">
                      <Users className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-muted-foreground" />
                      <span>Account Manager</span>

                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Every feature's intro page, with its status — the admins' way to review them all. */}
              {user?.isPlatformAdmin === true && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-active={location === "/admin/feature-pages"}>
                    <Link href="/admin/feature-pages" data-testid="link-nav-admin-feature-pages" className="flex items-center gap-2 w-full">
                      <LayoutGrid className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-primary" />
                      <span>Feature pages</span>

                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Give an account a plan for 1–1000 days, and revoke it. */}
              {user?.isPlatformAdmin === true && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-active={location === "/admin/access"}>
                    <Link href="/admin/access" data-testid="link-nav-admin-access" className="flex items-center gap-2 w-full">
                      <KeyRound className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-primary" />
                      <span>Access grants</span>

                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* The issue desk: captured failures and Claude's reports on them; the count is issues still new. */}
              {user?.isPlatformAdmin === true && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-active={location === "/admin/issues"}>
                    <Link href="/admin/issues" data-testid="link-nav-admin-issues" className="flex items-center gap-2 w-full">
                      <Bug className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-muted-foreground" />
                      <span>Issues</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {newIssues > 0 && (
                          <span className="min-w-[1.25rem] rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
                            aria-label={`${newIssues} new`} data-testid="badge-nav-issues-new">
                            {newIssues > 99 ? "99+" : newIssues}
                          </span>
                        )}

                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
</SidebarMenu>
          </details>
        </SidebarGroup>}
      </SidebarContent>
      <SidebarFooter className="p-5 pt-3">
        <div className="space-y-3">
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">Directory totals</summary>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Counties</span>
            <span className="font-semibold tabular-nums">{countyCount}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Directory entries</span>
            <span className="font-semibold tabular-nums">{activeCount}</span>
          </div>
          </details>
          <div className="border-t border-sidebar-border pt-3 mt-2">
            {user ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-semibold text-primary">
                        {(user.displayName || user.email)?.[0]?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span className="text-xs truncate" data-testid="text-user-name">
                    {user.displayName || user.email}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button asChild variant="ghost" size="sm" className="h-10 w-10 p-0">
                    <Link href="/settings" aria-label="Settings" data-testid="button-settings">
                      <Settings className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={handleLogout}
                    aria-label="Sign out"
                    data-testid="button-logout"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <Link href="/auth" data-testid="link-login">
                <Button variant="outline" size="sm" className="w-full text-xs gap-2">
                  <LogIn className="h-3.5 w-3.5" />
                  Sign In / Sign Up
                </Button>
              </Link>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
