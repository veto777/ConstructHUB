import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
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
import LocationsPage from "@/pages/locations";
import MasterClassPage from "@/pages/master-class";
import ReinstatementPage from "@/pages/reinstatement";
import GoogleBusinessPage from "@/pages/google-business";
import GoogleAdsPage from "@/pages/google-ads";
import GoogleAdsGuidePage from "@/pages/google-ads-guide";
import GoogleAdsGuideSectionPage from "@/pages/google-ads-guide-section";
import GoogleAdFraudPage from "@/pages/google-ad-fraud";
import LsaGuidePage from "@/pages/lsa-guide";
import LsaLeadsPage from "@/pages/lsa-leads";
import GoogleAdsLandingPage from "@/pages/google-ads-landing";
import PermitsLandingPage from "@/pages/permits-landing";
import CompetitorsLandingPage from "@/pages/competitors-landing";
import MasterClassLandingPage from "@/pages/master-class-landing";
import SettingsPage from "@/pages/settings";
import IpTrackerPage from "@/pages/ip-tracker";
import VpnShieldPage from "@/pages/vpn-shield";
import IndividualPricingPage from "@/pages/individual-pricing";
import HomePage from "@/pages/home";
import ContractSignPage from "@/pages/contract-sign";
import GoogleReviewsPage from "@/pages/google-reviews";
import ReviewFeedbackPage from "@/pages/review-feedback";
import ReviewUnsubscribePage from "@/pages/review-unsubscribe";
import AdsConsultantChat from "@/components/ads-consultant-chat";
import SiteAssistantChat from "@/components/site-assistant-chat";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import TermsOfUsePage from "@/pages/terms-of-use";
import MediaLibraryPage from "@/pages/media-library";
import LsaAccountManagerPage from "@/pages/lsa-account-manager";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";

function DashboardRouter() {
  return (
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
      <Route path="/locations" component={LocationsPage} />
      <Route path="/master-class" component={MasterClassPage} />
      <Route path="/reinstatement" component={ReinstatementPage} />
      <Route path="/google-business" component={GoogleBusinessPage} />
      <Route path="/google-ads" component={GoogleAdsPage} />
      <Route path="/google-ads-landing" component={GoogleAdsLandingPage} />
      <Route path="/google-ads-guide" component={GoogleAdsGuidePage} />
      <Route path="/google-ads-guide/:section" component={GoogleAdsGuideSectionPage} />
      <Route path="/google-ad-fraud" component={GoogleAdFraudPage} />
      <Route path="/lsa-guide" component={LsaGuidePage} />
      <Route path="/lsa-leads" component={LsaLeadsPage} />
      <Route path="/ip-tracker" component={IpTrackerPage} />
      <Route path="/vpn-shield" component={VpnShieldPage} />
      <Route path="/individual-pricing" component={IndividualPricingPage} />
      {SHOW_COMPETITOR_INTEL && <Route path="/competitors-landing" component={CompetitorsLandingPage} />}
      <Route path="/master-class-landing" component={MasterClassLandingPage} />
      {SHOW_GOOGLE_REVIEWS && <Route path="/google-reviews" component={GoogleReviewsPage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token/unsubscribe" component={ReviewUnsubscribePage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token" component={ReviewFeedbackPage} />}
      <Route path="/contract/sign/:token" component={ContractSignPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfUsePage} />
      <Route path="/lsa-account-manager" component={LsaAccountManagerPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PublicRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/databases" component={DatabasesPage} />
      <Route path="/property" component={PropertyPage} />
      <Route path="/photos" component={PhotosPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/locations" component={LocationsPage} />
      <Route path="/master-class" component={MasterClassPage} />
      <Route path="/reinstatement" component={ReinstatementPage} />
      <Route path="/google-business" component={GoogleBusinessPage} />
      <Route path="/google-ads" component={GoogleAdsPage} />
      <Route path="/google-ads-landing" component={GoogleAdsLandingPage} />
      <Route path="/google-ads-guide" component={GoogleAdsGuidePage} />
      <Route path="/google-ads-guide/:section" component={GoogleAdsGuideSectionPage} />
      <Route path="/google-ad-fraud" component={GoogleAdFraudPage} />
      <Route path="/lsa-guide" component={LsaGuidePage} />
      <Route path="/ip-tracker" component={IpTrackerPage} />
      <Route path="/vpn-shield" component={VpnShieldPage} />
      <Route path="/individual-pricing" component={IndividualPricingPage} />
      <Route path="/permits-landing" component={PermitsLandingPage} />
      {SHOW_COMPETITOR_INTEL && <Route path="/competitors-landing" component={CompetitorsLandingPage} />}
      <Route path="/master-class-landing" component={MasterClassLandingPage} />
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token/unsubscribe" component={ReviewUnsubscribePage} />}
      {SHOW_GOOGLE_REVIEWS && <Route path="/review/:token" component={ReviewFeedbackPage} />}
      <Route path="/contract/sign/:token" component={ContractSignPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfUsePage} />
      <Route component={LandingPage} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "14.5rem",
  "--sidebar-width-icon": "3rem",
};

function AppContent() {
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const [location] = useLocation();


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const isDev = import.meta.env.DEV;
  const showAdsChat = location.startsWith("/google-ads") || location.startsWith("/google-ad-fraud");

  const showSiteChat = location === "/" || location === "/landing";

  if (!user && !isDev) {
    return (
      <>
        <PublicRouter />
        {showSiteChat && <SiteAssistantChat />}
      </>
    );
  }

  if (location === "/landing") {
    return (
      <>
        <LandingPage />
        <SiteAssistantChat />
      </>
    );
  }

  if (location === "/google-ads-landing") {
    return <GoogleAdsLandingPage />;
  }

  if (location === "/permits-landing") {
    return <PermitsLandingPage />;
  }

  if (location === "/competitors-landing" && SHOW_COMPETITOR_INTEL) {
    return <CompetitorsLandingPage />;
  }

  if (location === "/master-class-landing") {
    return <MasterClassLandingPage />;
  }

  if (location.startsWith("/contract/sign/")) {
    return <ContractSignPage />;
  }

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-1 px-4 h-12 border-b border-border/40 bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-1">
              <Link href="/settings" data-testid="link-header-settings">
                <button className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" data-testid="button-header-settings">
                  <Settings className="h-4 w-4" />
                </button>
              </Link>
              <CartSheet />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto flex flex-col">
            <div className="flex-1">
              <DashboardRouter />
            </div>
            <footer className="border-t border-border/30 py-3 px-4 text-center text-xs text-muted-foreground" data-testid="footer-dashboard">
              <a href="mailto:support@constructhub.us" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-email">support@constructhub.us</a>
              <span className="mx-2 text-border">&middot;</span>
              <a href="/terms" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-terms">Terms</a>
              <span className="mx-2 text-border">&middot;</span>
              <a href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-dashboard-footer-privacy">Privacy</a>
              <span className="mx-2 text-border">&middot;</span>
              <span>&copy; 2025 ConstructHUB</span>
            </footer>
          </main>
        </div>
      </div>
      {showAdsChat && <AdsConsultantChat />}
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <CartProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </CartProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
