import { useState } from "react";
import {
  Search, Database, Clock, FileText, Building, Camera, LogIn, LogOut,
  Eye, Grid3X3, CreditCard, Shield, MapPin, GraduationCap, ChevronRight,
  HardHat, Globe, ShieldAlert, ExternalLink, ShieldCheck, BadgeCheck,
  Settings, Skull, Megaphone, TrendingUp, Fingerprint, ShieldOff, Zap, Star,
  Layers, Wrench, BookOpen, Rocket, FolderOpen, Users, PhoneCall,
} from "lucide-react";
import permitsLogo from "@assets/Permits_1772157993497.png";
import spyLogo from "@assets/Spy_logo_1772157993496.png";
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
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { County } from "@shared/schema";
import { CHLogo } from "@/components/ch-logo";

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
type NavChild = { title: string; url: string; icon: any; badge?: BadgeType; subChildren?: NavChild[] };
type NavGroup = {
  label: string;
  icon: any;
  logo?: string;
  logoComponent?: (props: { className?: string }) => JSX.Element;
  landingUrl?: string;
  children: NavChild[];
};

function FeatureBadge({ type, label }: { type: BadgeType; label: string }) {
  if (type === "hot") {
    return (
      <span className="ml-auto shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 text-white shadow-sm shadow-red-500/30 animate-pulse" data-testid={`badge-hot-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        HOT
      </span>
    );
  }
  if (type === "best") {
    return (
      <span className="ml-auto shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-amber-900 shadow-sm shadow-amber-400/30" data-testid={`badge-best-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        BEST
      </span>
    );
  }
  return (
    <span className="ml-auto shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-400 text-white shadow-sm shadow-blue-500/30" data-testid={`badge-new-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      NEW
    </span>
  );
}

const permitsGroup: NavGroup = {
  label: "Permits & Databases",
  icon: HardHat,
  logo: permitsLogo,
  landingUrl: "/permits-landing",
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
      { title: "Locations", url: "/locations", icon: MapPin },
      { title: "GBP Monitor", url: "/gmb-monitor", icon: Eye },
      { title: "Ranking Grid", url: "/ranking-grid", icon: Grid3X3, badge: "hot" as BadgeType },
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
    landingUrl: "/google-ads-landing",
    children: [
      { title: "Click Guard", url: "/google-ads", icon: ShieldCheck, badge: "hot" as BadgeType },
      { title: "Ad Fraud", url: "/google-ad-fraud", icon: Skull },
      { title: "Ads Guide", url: "/google-ads-guide", icon: Megaphone },
      { title: "LSA Guide", url: "/lsa-guide", icon: BadgeCheck },
      { title: "LSA Leads", url: "/lsa-leads", icon: PhoneCall, badge: "new" as BadgeType },
    ],
  },
];

const ADMIN_EMAILS = ["support@constructhub.us", "alpinesidingcompany@gmail.com"];

const googleReviewsItem = { title: "Google Reviews", url: "/google-reviews", icon: Star, logoComponent: GoogleGIcon, badge: "best" as BadgeType };

const standaloneItems: { title: string; url: string; icon: any; logo?: string; logoComponent?: (props: { className?: string }) => JSX.Element; landingUrl?: string; badge?: BadgeType }[] = [
  { title: "IP Tracker", url: "/ip-tracker", icon: Fingerprint, logo: ipTrackerLogo, badge: "hot" },
  { title: "VPN Shield", url: "/vpn-shield", icon: ShieldOff, logo: vpnBlockerLogo, badge: "new" },
  ...(SHOW_COMPETITOR_INTEL ? [{ title: "Competitor Intel", url: "/competitors", icon: Shield, logo: spyLogo, landingUrl: "/competitors-landing" }] : []),
  { title: "Master Class", url: "/master-class", icon: GraduationCap, logo: masterclassLogo, landingUrl: "/master-class-landing" },
];

const pricingGroup: NavGroup = {
  label: "Pricing & Plans",
  icon: CreditCard,
  logo: priceLogo,
  children: [
    { title: "Subscription Plans", url: "/pricing", icon: Layers },
    { title: "Individual Tools", url: "/individual-pricing", icon: Zap },
    { title: "Master Class", url: "/master-class-landing", icon: BookOpen },
    { title: "SEO Services", url: "/pricing", icon: Rocket },
  ],
};

function CollapsibleNavGroup({ group }: { group: NavGroup }) {
  const [location] = useLocation();
  const isActiveGroup = group.children.some(c => c.url === location || c.subChildren?.some(sc => sc.url === location)) || location === group.landingUrl;
  const [open, setOpen] = useState(isActiveGroup);

  return (
    <SidebarMenuItem>
      <div className="flex items-center">
        <SidebarMenuButton
          className="cursor-pointer flex-1"
          onClick={() => setOpen(!open)}
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
            <SidebarMenuSubItem key={item.url}>
              <SidebarMenuSubButton
                asChild
                isActive={location === item.url}
              >
                <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`} className="flex items-center gap-1.5 w-full min-w-0">
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.title}</span>
                  {item.badge && <FeatureBadge type={item.badge} label={item.title} />}
                </Link>
              </SidebarMenuSubButton>
              {item.subChildren && item.subChildren.map(sub => (
                <SidebarMenuSubButton
                  key={sub.url}
                  asChild
                  isActive={location === sub.url}
                  className="pl-6"
                >
                  <Link href={sub.url} data-testid={`link-nav-${sub.title.toLowerCase().replace(/\s+/g, "-")}`} className="flex items-center gap-1.5 w-full min-w-0">
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

  const { data: dbCounts } = useQuery<{ total: number; county: number; city: number }>({
    queryKey: ["/api/databases/counts"],
  });

  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const { data: user } = useQuery<{ id: number; email: string; displayName: string | null; avatarUrl: string | null } | null>({
    queryKey: ["/api/auth/me"],
  });

  const activeCount = dbCounts?.total ?? 0;
  const countyCount = counties?.length ?? 0;

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-5 pb-6">
        <Link href="/" className="flex flex-col cursor-pointer" data-testid="link-logo-home">
          <CHLogo height={36} />
          <p className="text-[10px] font-medium text-sidebar-foreground/40 tracking-wide mt-1 leading-tight" data-testid="text-app-title">The All-in-One Growth Platform for Contractors</p>
        </Link>
      </SidebarHeader>
      <SidebarContent>
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
            <SidebarMenu>
              {googleGroups.map(group => (
                <CollapsibleNavGroup key={group.label} group={group} />
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
              {user && ADMIN_EMAILS.includes(user.email) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild data-active={location === "/lsa-account-manager"}>
                    <Link href="/lsa-account-manager" data-testid="link-nav-lsa-account-manager" className="flex items-center gap-2 w-full">
                      <Users className="h-5 w-5 min-w-5 min-h-5 shrink-0 text-[#4285F4]" />
                      <span>Account Manager</span>
                      <span className="ml-auto text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">ADMIN</span>
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
                        {item.badge && <FeatureBadge type={item.badge} label={item.title} />}
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
      </SidebarContent>
      <SidebarFooter className="p-5 pt-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Counties</span>
            <span className="font-semibold tabular-nums">{countyCount}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Active databases</span>
            <span className="font-semibold tabular-nums">{activeCount}</span>
          </div>
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
                  <Link href="/settings">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      data-testid="button-settings"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={handleLogout}
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
