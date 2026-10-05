import AgencyPage from "@/pages/agency";
import GoogleProfilePage from "@/pages/google-profile";
import InvitePage from "@/pages/invite";
import { PaymentNeededBanner } from "@/components/payment-needed-banner";
import { CloudflarePage, SearchConsolePage } from "@/pages/site-connections";
import { NotificationBell } from "@/components/account-security";
import { RecentAuthModal } from "@/components/recent-auth";
import SocialMediaPage from "@/pages/social-media";
import GuidesPage from "@/pages/guides";
import SiteScanPage, { FreeSiteScanPage, SharedSiteScanPage } from "@/pages/site-scan";
import { Switch, Route, useLocation, Link } from "wouter";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CrmSidebar } from "@/components/crm-sidebar";
import { CrmRibbon } from "@/components/crm-ribbon";
import { AppTabBar } from "@/components/app-tabbar";
import { inNativeApp } from "@/lib/app-shell";
import { CrmNotificationsBell } from "@/components/crm-notifications-bell";
import { CookieConsent } from "@/components/cookie-consent";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { CartProvider } from "@/contexts/cart-context";
import { CartSheet } from "@/components/cart-sheet";
import { Settings } from "lucide-react";
import NotFound from "@/pages/not-found";
import SearchPage from "@/pages/search";
import DatabasesPage from "@/pages/databases";
import SchedulesPage from "@/pages/schedules";
import HistoryPage from "@/pages/history";
import PropertyPage from "@/pages/property";
import PhotosPage from "@/pages/photos";
import AuthPage from "@/pages/auth";
import LandingPage from "@/pages/landing";
import GmbMonitorPage from "@/pages/gmb-monitor";
import RankingGridPage from "@/pages/ranking-grid";
import PricingPage from "@/pages/pricing";
import CompetitorsPage from "@/pages/competitors";
import GbpContentPage from "@/pages/gbp-content";
import DomainsPage from "@/pages/domains";
import MailAlertsPage from "@/pages/mail-alerts";
import LocationsPage from "@/pages/locations";
import MasterClassPage from "@/pages/master-class";
import ReinstatementPage from "@/pages/reinstatement";
import GoogleBusinessPage from "@/pages/google-business";
import AdsManagerPage from "@/pages/ads-manager";
import GoogleAdsPage from "@/pages/google-ads";
import GoogleAdsGuidePage from "@/pages/google-ads-guide";
import GoogleAdsGuideSectionPage from "@/pages/google-ads-guide-section";
import GoogleAdFraudPage from "@/pages/google-ad-fraud";
import LsaGuidePage from "@/pages/lsa-guide";
import LsaLeadsPage from "@/pages/lsa-leads";
import CallAssistantLandingPage from "@/pages/call-assistant-landing";
import { FeaturesCataloguePage, FeaturePageRoute, LegacyLanding } from "@/pages/features";
import { DfyCataloguePage, DfyPageRoute } from "@/pages/done-for-you";
import SettingsPage from "@/pages/settings";
import DevelopersPage from "@/pages/developers";
import { CrmLogo } from "@/components/crm-logo";
import { isPortal, isClientPortal, CRM_NAME, marketingUrl } from "@/lib/site";
import IpTrackerPage from "@/pages/ip-tracker";
import CrmGatewayPage from "@/pages/crm-gateway";
import VpnShieldPage from "@/pages/vpn-shield";
import HomePage from "@/pages/home";
import ContractSignPage from "@/pages/contract-sign";
import GoogleReviewsPage from "@/pages/google-reviews";
import ReviewFeedbackPage from "@/pages/review-feedback";
import ReviewUnsubscribePage from "@/pages/review-unsubscribe";
import AdsConsultantChat from "@/components/ads-consultant-chat";
import HubWidget from "@/components/hub/hub-widget";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import TermsOfUsePage from "@/pages/terms-of-use";
import { CrmTermsPage, CrmPrivacyPage } from "@/pages/crm-legal";
import MediaLibraryPage from "@/pages/media-library";
import LsaAccountManagerPage from "@/pages/lsa-account-manager";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import { copyrightNotice } from "@/lib/marketing";
import { useSeoHead } from "@/lib/seo-head";
import { pageMetaFor } from "@shared/route-meta";

// Pages only the CRM portal, the client portal, a customer's document link or a platform admin opens load
// on demand, so the marketing pages (and every signed-out visitor) don't download them.
const AdminFeaturePagesPage = lazy(() => import("@/pages/admin-feature-pages"));
const AdminAccessPage = lazy(() => import("@/pages/admin-access"));
const AdminIssuesPage = lazy(() => import("@/pages/admin-issues"));
const CrmTeamPage = lazy(() => import("@/pages/crm-team"));
const CrmJoinPage = lazy(() => import("@/pages/crm-join"));
const CrmHomePage = lazy(() => import("@/pages/crm-home"));
const CrmSchedulePage = lazy(() => import("@/pages/crm-schedule"));
const CrmInboxPage = lazy(() => import("@/pages/crm-inbox"));
const CrmCallAssistantPage = lazy(() => import("@/pages/crm-call-assistant"));
const CrmClientsPage = lazy(() => import("@/pages/crm-clients"));
const CrmClientPage = lazy(() => import("@/pages/crm-client"));
const CrmPaymentsPage = lazy(() => import("@/pages/crm-payments"));
const CrmEstimatesPage = lazy(() => import("@/pages/crm-estimates"));
const CrmEstimateNewPage = lazy(() => import("@/pages/crm-estimate-new"));
const CrmEstimateDetailPage = lazy(() => import("@/pages/crm-estimate-detail"));
const CrmInvoicesPage = lazy(() => import("@/pages/crm-invoices"));
const CrmPipelinePage = lazy(() => import("@/pages/crm-pipeline"));
const CrmPriceBookPage = lazy(() => import("@/pages/crm-pricebook"));
const CrmProjectPage = lazy(() => import("@/pages/crm-project"));
const CrmSettingsPage = lazy(() => import("@/pages/crm-settings"));
const AccountDeletePage = lazy(() => import("@/pages/account-delete"));
const CrmIntegrationsPage = lazy(() => import("@/pages/crm-integrations"));
const CrmReportsPage = lazy(() => import("@/pages/crm-reports"));
const CrmMigratePage = lazy(() => import("@/pages/crm-migrate"));
const CrmAdminPage = lazy(() => import("@/pages/crm-admin"));
const PublicEstimatePage = lazy(() => import("@/pages/public-estimate"));
const PublicPortalPage = lazy(() => import("@/pages/public-portal"));
const PublicInvoicePage = lazy(() => import("@/pages/public-invoice"));
const PublicChangeOrderPage = lazy(() => import("@/pages/public-change-order"));
const PublicLeadFormPage = lazy(() => import("@/pages/public-lead-form"));
const ClientPortalPage = lazy(() => import("@/pages/client-portal"));

/**
 * The old one-off landing pages, retired into /features/<slug>: the old URLs
 * stay and replace themselves with the feature page (LegacyLanding in
 * pages/features.tsx).
 */
const PermitsLanding = () => <LegacyLanding featureKey="permits" />;
const GoogleAdsLanding = () => <LegacyLanding featureKey="clickGuard" />;
const CompetitorsLanding = () => <LegacyLanding featureKey="competitors" />;
const MasterClassLanding = () => <LegacyLanding featureKey="masterClass" />;

/** The old à-la-carte tools page: single features are add-ons on /pricing now. */
function IndividualPricingRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/pricing#add-ons", { replace: true }); }, [setLocation]);
  return null;
}

/** /settings/billing[?billing=invoices] → the shell's Billing section (its inner tab = ?tab=invoices…). */
function SettingsBillingRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("billing");
    const tab = view && ["invoices", "payment-methods", "purchases", "subscriptions"].includes(view) ? view : "billing";
    setLocation(`/settings?tab=${tab}`, { replace: true });
  }, [setLocation]);
  return null;
}

/** /settings/api[?api=usage] → the shell's API keys / API usage section. */
function SettingsApiRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("api");
    setLocation(`/settings?tab=${view === "usage" ? "api-usage" : "api-keys"}`, { replace: true });
  }, [setLocation]);
  return null;
}

/** On the CRM host: the Call Assistant moved to the platform; keep the query (tab, call, view). */
function CallAssistantMovedRedirect() {
  useEffect(() => {
    window.location.replace(marketingUrl(`/call-assistant${window.location.search}`));
  }, []);
  return null;
}

function DashboardRouter() {
  return (
    <Suspense fallback={null}>
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/databases" component={DatabasesPage} />
      <Route path="/property" component={PropertyPage} />
      <Route path="/schedules" component={SchedulesPage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/photos" component={PhotosPage} />
      <Route path="/media-library" component={MediaLibraryPage} />
      <Route path="/gmb-monitor" component={GmbMonitorPage} />
      <Route path="/ranking-grid" component={RankingGridPage} />
      <Route path="/pricing" component={PricingPage} />
      {SHOW_COMPETITOR_INTEL && <Route path="/competitors" component={CompetitorsPage} />}
      <Route path="/agency" component={AgencyPage} />
      <Route path="/locations" component={LocationsPage} />
      <Route path="/google-profile" component={GoogleProfilePage} />
      <Route path="/invite/:code" component={InvitePage} />
      <Route path="/domains" component={DomainsPage} />
      <Route path="/mail-alerts" component={MailAlertsPage} />
      <Route path="/gbp-content" component={GbpContentPage} />
      <Route path="/social-media" component={SocialMediaPage} />
      <Route path="/guides" component={GuidesPage} />
      <Route path="/cloudflare" component={CloudflarePage} />
      <Route path="/search-console" component={SearchConsolePage} />
      <Route path="/site-scan" component={SiteScanPage} />
      <Route path="/master-class" component={MasterClassPage} />
      <Route path="/reinstatement" component={ReinstatementPage} />
      <Route path="/google-business" component={GoogleBusinessPage} />
      <Route path="/google-ads" component={GoogleAdsPage} />
      <Route path="/ads-manager" component={AdsManagerPage} />
      {/* Retired landing pages: the old URLs redirect to their /features page. */}
      <Route path="/google-ads-landing" component={GoogleAdsLanding} />
      <Route path="/permits-landing" component={PermitsLanding} />
      <Route path="/google-ads-guide" component={GoogleAdsGuidePage} />
      <Route path="/google-ads-guide/:section" component={GoogleAdsGuideSectionPage} />
      <Route path="/google-ad-fraud" component={GoogleAdFraudPage} />
      <Route path="/lsa-guide" component={LsaGuidePage} />
      <Route path="/lsa-leads" component={LsaLeadsPage} />
      <Route path="/ip-tracker" component={IpTrackerPage} />
      <Route path="/crm-app" component={CrmGatewayPage} />
      {/* The AI Call Assistant's marketing page; signed in it keeps the sidebar (its "Call Assistant" entry lands here). */}
      <Route path="/call-assistant" component={CrmCallAssistantPage} />
      {/* Every feature's intro page (shared/feature-pages), inside the app frame when signed in. */}
      <Route path="/features" component={FeaturesCataloguePage} />
      <Route path="/features/:slug" component={FeaturePageRoute} />
      {/* Every done-for-you service's page (shared/dfy-pages), inside the app frame when signed in. */}
      <Route path="/done-for-you" component={DfyCataloguePage} />
      <Route path="/done-for-you/:slug" component={DfyPageRoute} />
      {/* Platform admins: every feature page, its status and links (the API answers 403 to anyone else). */}
      <Route path="/admin/feature-pages" component={AdminFeaturePagesPage} />
      {/* Platform admins: give an account a plan for 1–1000 days, extend or revoke it (the API answers 403 to anyone else). */}
      <Route path="/admin/access" component={AdminAccessPage} />
      {/* Platform admins: the issue desk — captured failures and Claude's reports (the API answers 403 to anyone else). */}
      <Route path="/admin/issues" component={AdminIssuesPage} />
      <Route path="/vpn-shield" component={VpnShieldPage} />
      <Route path="/individual-pricing" component={IndividualPricingRedirect} />
      {SHOW_COMPETITOR_INTEL && <Route path="/competitors-landing" component={CompetitorsLanding} />}
      <Route path="/master-class-landing" component={MasterClassLanding} />
      {SHOW_GOOGLE_REVIEWS && <Route path="/google-reviews" component={GoogleReviewsPage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token/unsubscribe" component={ReviewUnsubscribePage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token" component={ReviewFeedbackPage} />}
      <Route path="/contract/sign/:token" component={ContractSignPage} />
      <Route path="/crm-terms" component={CrmTermsPage} />
      <Route path="/crm-privacy" component={CrmPrivacyPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfUsePage} />
      <Route path="/lsa-account-manager" component={LsaAccountManagerPage} />
      {/* Deep links into Account settings (the shell's Billing / API keys / API usage sections) and the public API reference. */}
      <Route path="/settings/billing" component={SettingsBillingRedirect} />
      <Route path="/settings/api" component={SettingsApiRedirect} />
      <Route path="/developers" component={DevelopersPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/account/delete" component={AccountDeletePage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/crm-terms" component={CrmTermsPage} />
      <Route path="/crm-privacy" component={CrmPrivacyPage} />
      <Route path="/e/:token" component={PublicEstimatePage} />
      <Route path="/i/:token" component={PublicInvoicePage} />
      <Route path="/co/:token" component={PublicChangeOrderPage} />
      <Route path="/lead-form/:token" component={PublicLeadFormPage} />
      <Route path="/portal/:token" component={PublicPortalPage} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

/**
 * The signed-out tool pages and the CRM legal pages have no masthead of their
 * own: the site's ribbon (Features ▾, Done-For-You ▾, Plans, Results, Coverage,
 * sign in) goes above them, as on every other public page (owner, 2026-10-02:
 * "make sure every page keeps the menu details in the ribbon"). Defined once at
 * module scope so a re-render never remounts the page. Left out on purpose: the
 * pages a contractor's own customer opens (/review/<token>, /contract/sign/<token>).
 */
function withRibbon(Page: ComponentType<any>): ComponentType<any> {
  function RibbonedPage(props: any) {
    const [location] = useLocation();
    return (
      <>
        <PublicPageHeader next={`${location}${window.location.search}`} />
        <Page {...props} />
      </>
    );
  }
  return RibbonedPage;
}

const Ribboned = {
  DatabasesPage: withRibbon(DatabasesPage),
  PropertyPage: withRibbon(PropertyPage),
  PhotosPage: withRibbon(PhotosPage),
  GoogleAdsPage: withRibbon(GoogleAdsPage),
  AdsManagerPage: withRibbon(AdsManagerPage),
  GoogleAdsGuideSectionPage: withRibbon(GoogleAdsGuideSectionPage),
  IpTrackerPage: withRibbon(IpTrackerPage),
  VpnShieldPage: withRibbon(VpnShieldPage),
  CrmTermsPage: withRibbon(CrmTermsPage),
  CrmPrivacyPage: withRibbon(CrmPrivacyPage),
};

function PublicRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/invite/:code" component={InvitePage} />
      <Route path="/databases" component={Ribboned.DatabasesPage} />
      <Route path="/property" component={Ribboned.PropertyPage} />
      <Route path="/photos" component={Ribboned.PhotosPage} />
      <Route path="/pricing" component={PricingPage} />
      {/* Signed-out visitors get the free public scan; the full tool needs an account. */}
      <Route path="/site-scan" component={FreeSiteScanPage} />
      <Route path="/master-class" component={MasterClassPage} />
      <Route path="/reinstatement" component={ReinstatementPage} />
      <Route path="/google-business" component={GoogleBusinessPage} />
      <Route path="/google-ads" component={Ribboned.GoogleAdsPage} />
      <Route path="/ads-manager" component={Ribboned.AdsManagerPage} />
      <Route path="/google-ads-landing" component={GoogleAdsLanding} />
      <Route path="/google-ads-guide" component={GoogleAdsGuidePage} />
      <Route path="/google-ads-guide/:section" component={Ribboned.GoogleAdsGuideSectionPage} />
      <Route path="/google-ad-fraud" component={GoogleAdFraudPage} />
      <Route path="/lsa-guide" component={LsaGuidePage} />
      <Route path="/ip-tracker" component={Ribboned.IpTrackerPage} />
      <Route path="/crm-app" component={CrmGatewayPage} />
      <Route path="/call-assistant" component={CallAssistantLandingPage} />
      <Route path="/features" component={FeaturesCataloguePage} />
      <Route path="/features/:slug" component={FeaturePageRoute} />
      <Route path="/done-for-you" component={DfyCataloguePage} />
      <Route path="/done-for-you/:slug" component={DfyPageRoute} />
      <Route path="/vpn-shield" component={Ribboned.VpnShieldPage} />
      <Route path="/individual-pricing" component={IndividualPricingRedirect} />
      <Route path="/developers" component={DevelopersPage} />
      <Route path="/permits-landing" component={PermitsLanding} />
      {SHOW_COMPETITOR_INTEL && <Route path="/competitors-landing" component={CompetitorsLanding} />}
      <Route path="/master-class-landing" component={MasterClassLanding} />
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token/unsubscribe" component={ReviewUnsubscribePage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token" component={ReviewFeedbackPage} />}
      <Route path="/contract/sign/:token" component={ContractSignPage} />
      <Route path="/crm-terms" component={Ribboned.CrmTermsPage} />
      <Route path="/crm-privacy" component={Ribboned.CrmPrivacyPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfUsePage} />
      <Route path="/landing" component={LandingPage} />
      {/* Signed-in tools send a signed-out visitor to sign in and back; any
          other unknown URL is an honest 404, never the landing page. */}
      <Route component={SignedOutFallback} />
    </Switch>
  );
}

/** Dashboard routes that need an account (everything else here is public). */
const SIGNED_IN_ONLY = [
  "/search", "/schedules", "/history", "/media-library", "/gmb-monitor", "/ranking-grid",
  "/social-media", "/guides", "/cloudflare", "/search-console", "/lsa-leads", "/lsa-account-manager", "/settings",
  "/agency", "/locations", "/domains", "/mail-alerts", "/gbp-content", "/admin/feature-pages", "/admin/access", "/admin/issues",
  ...(SHOW_COMPETITOR_INTEL ? ["/competitors"] : []),
  ...(SHOW_GOOGLE_REVIEWS ? ["/google-reviews"] : []),
];

function SignedOutFallback() {
  const [location, setLocation] = useLocation();
  const needsAccount = SIGNED_IN_ONLY.some(p => location === p || location.startsWith(`${p}/`));
  useEffect(() => {
    if (needsAccount) {
      const next = `${location}${window.location.search}`;
      setLocation(`/auth?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [needsAccount, location, setLocation]);
  return needsAccount ? null : <NotFound />;
}

/** Tab titles for the growth app; pages that set their own title are left alone. */
const DEFAULT_TITLE = "ConstructHUB — Nationwide Contractor Services";
const SELF_TITLED = ["/media-library", "/privacy", "/terms", "/crm-terms", "/crm-privacy", "/features", "/done-for-you", "/admin/feature-pages", "/admin/access", "/admin/issues"];
/** Feature and service pages title themselves from their content (seo.title). */
const isSelfTitled = (location: string) =>
  SELF_TITLED.includes(location) || location.startsWith("/features/") || location.startsWith("/done-for-you/");
const PAGE_TITLES: Record<string, string> = {
  "/search": "Search Permits", "/databases": "Database Directory", "/property": "Property Records",
  "/schedules": "Scrape Schedules", "/history": "Search History", "/photos": "Photo Optimizer",
  "/gmb-monitor": "GMB Edit Monitor", "/ranking-grid": "GMB Ranking Grid", "/pricing": "Pricing",
  "/competitors": "Competitor Intel", "/agency": "Agency", "/locations": "Locations", "/domains": "Domains",
  "/mail-alerts": "Mail Alerts", "/gbp-content": "Posts & Photos", "/social-media": "Social Media",
  "/guides": "Guides", "/cloudflare": "Cloudflare", "/search-console": "Search Console", "/site-scan": "Site Scan",
  "/master-class": "Master Class", "/reinstatement": "Reinstatement", "/google-business": "Google Business",
  "/google-ads": "Click Guard", "/ads-manager": "Agency Ads & LSA", "/google-ads-guide": "Google Ads Guide",
  "/google-ad-fraud": "Ad Fraud", "/lsa-guide": "LSA Guide", "/lsa-leads": "LSA Leads", "/ip-tracker": "IP Tracker",
  "/vpn-shield": "VPN Shield", "/google-reviews": "Google Reviews",
  "/lsa-account-manager": "Account Manager", "/settings": "Settings", "/auth": "Sign in", "/developers": "Developers",
  "/call-assistant": "AI Call Assistant",
};

/** The sidebar's collapsed/expanded choice (ui/sidebar.tsx writes this cookie) survives a reload. */
function sidebarDefaultOpen(): boolean {
  return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

const sidebarStyle = {
  "--sidebar-width": "14.5rem",
  "--sidebar-width-icon": "3rem",
};

/** The portal (portal.constructhub.*) is the CRM only — no marketing routes. */
function PortalRouter() {
  return (
    <Suspense fallback={null}>
    <Switch>
      <Route path="/" component={CrmHomePage} />
      <Route path="/crm" component={CrmHomePage} />
      <Route path="/crm/home" component={CrmHomePage} />
      <Route path="/crm/clients" component={CrmClientsPage} />
      <Route path="/crm/clients/:id" component={CrmClientPage} />
      <Route path="/crm/schedule" component={CrmSchedulePage} />
      <Route path="/crm/inbox" component={CrmInboxPage} />
      {/* The Call Assistant lives on the platform, not in the CRM (owner, 2026-10-02): old CRM links and
          notifications land on constructhub.us/call-assistant with their ?tab=/&call= intact. */}
      <Route path="/crm/call-assistant" component={CallAssistantMovedRedirect} />
      <Route path="/call-assistant" component={CallAssistantMovedRedirect} />
      <Route path="/crm/pipeline" component={CrmPipelinePage} />
      <Route path="/crm/estimates/new" component={CrmEstimateNewPage} />
      <Route path="/crm/estimates/:id" component={CrmEstimateDetailPage} />
      <Route path="/crm/estimates" component={CrmEstimatesPage} />
      <Route path="/crm/invoices" component={CrmInvoicesPage} />
      <Route path="/crm/pricebook" component={CrmPriceBookPage} />
      <Route path="/crm/projects/:id" component={CrmProjectPage} />
      <Route path="/crm/payments" component={CrmPaymentsPage} />
      <Route path="/crm/team" component={CrmTeamPage} />
      <Route path="/crm/settings" component={CrmSettingsPage} />
      <Route path="/account/delete" component={AccountDeletePage} />
      <Route path="/crm/integrations" component={CrmIntegrationsPage} />
      <Route path="/crm/reports" component={CrmReportsPage} />
      <Route path="/crm/migrate" component={CrmMigratePage} />
      <Route path="/crm/admin" component={CrmAdminPage} />
      {/* Platform-wide console at the short URL too — every user and org
          across the platform; the page 403s anyone but platform admins. */}
      <Route path="/admin" component={CrmAdminPage} />
      <Route path="/crm/join" component={CrmJoinPage} />
      <Route path="/crm-terms" component={CrmTermsPage} />
      <Route path="/crm-privacy" component={CrmPrivacyPage} />
      {/* /auth must exist on the SIGNED-IN portal too: a beta-invite link
          (/auth?beta=…) opened in a signed-in browser previously fell through
          to the home fallback — dumping the owner into their own workspace and
          looking like the invite "shared" it. AuthPage shows the sign-out /
          continue choice card in that state. */}
      <Route path="/auth" component={AuthPage} />
      <Route path="/e/:token" component={PublicEstimatePage} />
      <Route path="/i/:token" component={PublicInvoicePage} />
      <Route path="/co/:token" component={PublicChangeOrderPage} />
      <Route path="/lead-form/:token" component={PublicLeadFormPage} />
      <Route path="/portal/:token" component={PublicPortalPage} />
      {/* Unknown portal route -> home, which always offers the next action. */}
      <Route component={CrmHomePage} />
    </Switch>
    </Suspense>
  );
}

/** Signed-out portal visitors get the login screen, not the marketing landing page. */
function PortalPublicRouter() {
  return (
    <Suspense fallback={null}>
    <Switch>
      {/* Client-facing links are token-authorised and must never demand a login. */}
      <Route path="/crm-terms" component={CrmTermsPage} />
      <Route path="/crm-privacy" component={CrmPrivacyPage} />
      <Route path="/e/:token" component={PublicEstimatePage} />
      <Route path="/i/:token" component={PublicInvoicePage} />
      <Route path="/co/:token" component={PublicChangeOrderPage} />
      <Route path="/lead-form/:token" component={PublicLeadFormPage} />
      <Route path="/portal/:token" component={PublicPortalPage} />
      <Route path="/crm/join" component={CrmJoinPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={AuthPage} />
    </Switch>
    </Suspense>
  );
}

/**
 * The homeowner client portal (client.constructhub.*) is its own product face:
 * no marketing routes, no CRM chrome, no platform login. Token-authorised
 * document pages render here too — they are the approve/pay surfaces the
 * dashboard links out to.
 */
function ClientRouter() {
  return (
    <Suspense fallback={null}>
    <Switch>
      <Route path="/" component={ClientPortalPage} />
      <Route path="/crm-terms" component={CrmTermsPage} />
      <Route path="/crm-privacy" component={CrmPrivacyPage} />
      <Route path="/e/:token" component={PublicEstimatePage} />
      <Route path="/i/:token" component={PublicInvoicePage} />
      <Route path="/co/:token" component={PublicChangeOrderPage} />
      <Route path="/lead-form/:token" component={PublicLeadFormPage} />
      <Route path="/portal/:token" component={PublicPortalPage} />
      <Route component={ClientPortalPage} />
    </Switch>
    </Suspense>
  );
}

function AppContent() {
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const [location] = useLocation();

  const portal = isPortal();
  const clientPortal = isClientPortal();

  // The CRM is its own product — its own tab title, never the marketing one.
  useEffect(() => {
    if (clientPortal) document.title = "Client Portal";
    else if (portal) document.title = CRM_NAME;
  }, [portal, clientPortal]);

  // …and its own brand theme (orange primary, purple/blue accent — see
  // `.crm-theme` in index.css). Set on <html>, not the shell div, because
  // Radix dialogs/sheets/menus portal out to <body> and would escape a
  // shell-scoped class. The marketing site never gets it.
  useEffect(() => {
    const on = portal || clientPortal;
    document.documentElement.classList.toggle("crm-theme", on);
    return () => document.documentElement.classList.remove("crm-theme");
  }, [portal, clientPortal]);

  // The platform's signed-in pages wear the one brand too (`.app-theme`: orange, Plus Jakarta Sans, warm page).
  const appTheme = !!user && !portal && !clientPortal;
  useEffect(() => {
    document.documentElement.classList.toggle("app-theme", appTheme);
    return () => document.documentElement.classList.remove("app-theme");
  }, [appTheme]);

  // Each growth-app page gets its own tab title (runs after the page's own
  // effects, so self-titled pages are skipped rather than overwritten).
  useEffect(() => {
    if (portal || clientPortal || isSelfTitled(location)) return;
    // A marketing or public app page's title is the one the server wrote into its HTML (shared/route-meta.ts).
    const meta = pageMetaFor(location);
    if (meta) { document.title = meta.title; return; }
    const key = Object.keys(PAGE_TITLES).find(p => location === p || location.startsWith(`${p}/`));
    document.title = key ? `${PAGE_TITLES[key]} | ConstructHUB` : DEFAULT_TITLE;
  }, [location, portal, clientPortal]);

  // Canonical link, Open Graph / Twitter tags and JSON-LD follow the page (lib/seo-head.ts); never on the portals.
  useSeoHead(location, !portal && !clientPortal);

  if (location === "/free-site-scan") return <FreeSiteScanPage />;
  if (location.startsWith("/site-scan/report/")) return <SharedSiteScanPage />;

  // The client portal never touches the platform session: a homeowner has no
  // ConstructHUB account. Handle it before the /api/auth/me gate entirely.
  // Client-facing token pages stay full-bleed on this host too.
  if (clientPortal) {
    if (location === "/crm-terms") return <CrmTermsPage />;
    if (location === "/crm-privacy") return <CrmPrivacyPage />;
    if (location.startsWith("/e/")) return <PublicEstimatePage />;
    if (location.startsWith("/i/")) return <PublicInvoicePage />;
    if (location.startsWith("/co/")) return <PublicChangeOrderPage />;
    if (location.startsWith("/lead-form/")) return <PublicLeadFormPage />;
    if (location.startsWith("/portal/")) return <PublicPortalPage />;
    return <ClientRouter />;
  }


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const showAdsChat = location.startsWith("/google-ads") || location.startsWith("/google-ad-fraud");

  if (!user) {
    // On the portal, an anonymous visitor gets the sign-in screen. Never the
    // marketing site — the two are deliberately separate products.
    if (portal) return <PortalPublicRouter />;
    return (
      <>
        <PublicRouter />
        {/* Gabe, the corner assistant (Hub widget): preset questions only for signed-out visitors (marketing pages). */}
        <HubWidget surface="marketing" signedIn={false} />
      </>
    );
  }

  // The portal has its own app frame: a branded sidebar, a slim top bar with
  // just the collapse trigger and the current section — no marketing chrome.
  if (portal) {
    // Platform Admin is CROSS-ORG — it must never wear a workspace's chrome
    // (an org sidebar around platform-wide data reads as that org's data).
    // It gets its own full-bleed shell at /admin; /crm/admin lands here too.
    if (location === "/admin" || location === "/crm/admin") {
      return (
        <div className="min-h-screen bg-muted/30 flex flex-col">
          <header className="box-content h-12 px-4 pt-[env(safe-area-inset-top)] flex items-center justify-between bg-sidebar text-sidebar-foreground border-b border-sidebar-border sticky top-0 z-50">
            <div className="flex items-center gap-2.5">
              <CrmLogo height={20} />
              <span className="text-[11px] font-semibold uppercase tracking-widest rounded bg-sidebar-primary text-sidebar-primary-foreground px-1.5 py-0.5">
                Platform Admin
              </span>
            </div>
            <Link href="/crm" className="text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
              data-testid="link-admin-back-to-workspace">
              ← Back to my workspace
            </Link>
          </header>
          <main className="flex-1 overflow-auto">
            <CrmAdminPage />
          </main>
        </div>
      );
    }

    // Client-facing documents render full-bleed even on the portal host — the
    // homeowner gets a clean page, not the contractor's app frame.
    if (location === "/crm-terms") return <CrmTermsPage />;
    if (location === "/crm-privacy") return <CrmPrivacyPage />;
    // A beta-invite link (/auth?beta=…) opened while signed in renders the
    // full-bleed choice card — never silently the signed-in workspace.
    if (location.startsWith("/auth")) return <AuthPage />;
    if (location.startsWith("/e/")) return <PublicEstimatePage />;
    if (location.startsWith("/i/")) return <PublicInvoicePage />;
    if (location.startsWith("/co/")) return <PublicChangeOrderPage />;
    if (location.startsWith("/lead-form/")) return <PublicLeadFormPage />;
    if (location.startsWith("/portal/")) return <PublicPortalPage />;
    const section =
      location.startsWith("/crm/clients") ? "Clients" :
      location.startsWith("/crm/schedule") ? "Schedule" :
      location.startsWith("/crm/inbox") ? "Messages" :
      location.startsWith("/crm/call-assistant") ? "Call Assistant" :
      location.startsWith("/crm/pipeline") || location.startsWith("/crm/projects") ? "Pipeline" :
      location.startsWith("/crm/pricebook") ? "Price book" :
      location.startsWith("/crm/estimates") ? "Estimates" :
      location.startsWith("/crm/invoices") ? "Invoices" :
      location.startsWith("/crm/migrate") ? "Import" :
      location.startsWith("/crm/payments") ? "Payments" :
      location.startsWith("/crm/team") ? "Team & Company" :
      location.startsWith("/crm/settings") ? "Settings" :
      location.startsWith("/crm/integrations") ? "Integrations" :
      location.startsWith("/crm/reports") ? "Reports" :
      location.startsWith("/crm/admin") ? "Platform Admin" :
      location.startsWith("/crm/join") ? "Join the team" : "Home";
    return (
      <SidebarProvider style={sidebarStyle as React.CSSProperties} defaultOpen={sidebarDefaultOpen()}>
        <div className="flex h-screen w-full">
          <CrmSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="box-content flex items-center gap-3 px-4 h-12 pt-[env(safe-area-inset-top)] border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-50">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <span className="text-sm text-muted-foreground" data-testid="text-crm-section">{section}</span>
              <div className="ml-auto flex items-center">
                <CrmNotificationsBell />
              </div>
            </header>
            {/* Bottom padding keeps content clear of the mobile ribbon; desktop is unchanged. */}
            <main className="flex-1 overflow-auto pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-0">
              <PortalRouter />
            </main>
          </div>
          <CrmRibbon />
          <HubWidget surface="portal" signedIn />
        </div>
      </SidebarProvider>
    );
  }

  if (location === "/landing") {
    return (
      <>
        <LandingPage />
        <HubWidget surface="marketing" signedIn />
      </>
    );
  }

  if (location.startsWith("/contract/sign/")) {
    // Rendered through a Route so the page's useParams() gets :token (a bare
    // <ContractSignPage /> outside any Route saw {} and showed "Not Found").
    return <Route path="/contract/sign/:token" component={ContractSignPage} />;
  }

  // Client-facing pages render full-bleed on any host — no app chrome.
  if (location === "/crm-terms") return <CrmTermsPage />;
  if (location === "/crm-privacy") return <CrmPrivacyPage />;
  if (location.startsWith("/e/")) return <PublicEstimatePage />;
  if (location.startsWith("/i/")) return <PublicInvoicePage />;
  if (location.startsWith("/co/")) return <PublicChangeOrderPage />;
  if (location.startsWith("/lead-form/")) return <PublicLeadFormPage />;
  if (location.startsWith("/portal/")) return <PublicPortalPage />;

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties} defaultOpen={sidebarDefaultOpen()}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="box-content flex items-center justify-between gap-2 px-4 h-14 pt-[env(safe-area-inset-top)] shrink-0 border-b border-border/40 bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-1.5">
              <RecentAuthModal /><NotificationBell />
              <Link href="/settings" data-testid="link-header-settings" aria-label="Settings"
                className="inline-flex items-center justify-center rounded-md h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <Settings className="h-4 w-4" />
              </Link>
              {/* The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)): no cart there. */}
              {!inNativeApp() && <CartSheet />}
              <ThemeToggle />
            </div>
          </header>
          <PaymentNeededBanner />
          {/* Phones: bottom padding keeps content clear of the tab bar (AppTabBar); desktop is unchanged. */}
          <main className="flex-1 min-h-0 overflow-auto flex flex-col pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">
            <div className="flex-1">
              <DashboardRouter />
            </div>
            {/* Phones: room below the line for the fixed Gabe launcher (56 px at bottom-4). */}
            <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 border-t border-border/30 pt-4 pb-20 md:pb-4 px-4 text-xs text-muted-foreground" data-testid="footer-dashboard">
              <a href="mailto:support@constructhub.us" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-email">support@constructhub.us</a>
              <span className="mx-2 text-border">&middot;</span>
              <a href="/terms" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-terms">Terms</a>
              <span className="mx-2 text-border">&middot;</span>
              <a href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-privacy">Privacy</a>
              <span className="mx-2 text-border">&middot;</span>
              <span>{copyrightNotice()}</span>
            </footer>
          </main>
        </div>
      </div>
      <AppTabBar />
      {/* The Google Ads pages keep their own consultant chat; everywhere else Gabe helps. */}
      {showAdsChat ? <AdsConsultantChat /> : <HubWidget surface="growth" signedIn />}
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <CartProvider>
          <TooltipProvider>
            <CookieConsent />
            {/* The lazily loaded pages outside a router (a document link, the client portal) wait here. */}
            <Suspense fallback={null}>
              <AppContent />
            </Suspense>
            <Toaster />
          </TooltipProvider>
        </CartProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
