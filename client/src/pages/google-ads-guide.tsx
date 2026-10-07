import { Card, CardContent } from "@/components/ui/card";
import { GooglePill } from "@/components/google";
import { useQuery } from "@tanstack/react-query";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { Link } from "wouter";
import {
  Shield, ShieldCheck, ShieldAlert, Search, BarChart3,
  AlertTriangle, CheckCircle, GraduationCap, Lock,
  ChevronRight, DollarSign, MousePointerClick, Megaphone,
  FileText, Ban, MapPin, Target,
  Image as ImageIcon,
} from "lucide-react";

import imgOverview from "@assets/image_1772131623518.png";
import googleAdsLogo from "@assets/google-ads-logo.png";

const GUIDE_SECTIONS = [
  {
    slug: "campaign-setup",
    icon: Megaphone,
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    number: "01",
    title: "Campaign Setup: Do It Right From Day One",
    description: "Choose 'Leads' as your goal, UNCHECK Search Partners, set a conservative budget, use Advanced mode only, separate campaigns by service type, and use Single Keyword Ad Groups.",
    screenshots: 3,
  },
  {
    slug: "features-to-avoid",
    icon: Ban,
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    number: "02",
    title: "Google Ads Features to AVOID at All Costs",
    description: "Disable Auto-Apply, AI Max, Automatically Created Assets, and the 'Only Bid for New Customers' trap. Every AI feature Google offers is designed to drain your budget.",
    screenshots: 4,
    critical: true,
  },
  {
    slug: "assets",
    icon: ImageIcon,
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    number: "03",
    title: "Ad Assets: What to Use and What to Delete",
    description: "Use callouts, headlines, descriptions, logos, images, and call assets. DELETE sitelinks, location assets, forms, messages, and promotions. If you can't track it, don't use it.",
    screenshots: 1,
  },
  {
    slug: "keywords",
    icon: Search,
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    number: "04",
    title: "Keyword Strategy: Be Specific or Go Broke",
    description: "Never use broad match. Use phrase match and exact match only. Build a negative keyword list before launching. Focus on long-tail, high-intent keywords.",
    screenshots: 0,
  },
  {
    slug: "location",
    icon: MapPin,
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    number: "05",
    title: "Location Targeting: The VPN & Scammer Filter",
    description: "Select 'Presence' only — not Google's recommended option. This filters out VPN users, scammers, and bots. Run separate campaigns for different service areas.",
    screenshots: 1,
  },
  {
    slug: "bidding",
    icon: DollarSign,
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    number: "06",
    title: "Bidding Strategy & Budget Management",
    description: "Target Impression Share for top position, Manual CPC for new campaigns, know your numbers before bidding, and watch your budget like a hawk.",
    screenshots: 1,
  },
  {
    slug: "ad-copy",
    icon: FileText,
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    number: "07",
    title: "Writing Ad Copy That Actually Converts",
    description: "Put keywords in Headline 1, differentiate in Headline 2, use numbers and social proof, test multiple ad variations, and write strong calls to action.",
    screenshots: 0,
  },
  {
    slug: "landing-pages",
    icon: MousePointerClick,
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    number: "08",
    title: "Landing Pages That Close Deals",
    description: "Never send traffic to your homepage. Build dedicated landing pages for each service. Above-the-fold headline + CTA + phone number. Mobile-first design.",
    screenshots: 0,
  },
  {
    slug: "ip-exclusions",
    icon: ShieldCheck,
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    number: "09",
    title: "IP Exclusions & Click Fraud Protection",
    description: "Set up Click Guard, block repeat visitors aggressively, avoid cheapskate customers, and understand why over-blocking is better than under-blocking.",
    screenshots: 1,
  },
  {
    slug: "tracking",
    icon: BarChart3,
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    number: "10",
    title: "Tracking & Measurement: Stop Flying Blind",
    description: "Set up conversion tracking, call tracking, cost-per-lead calculations, weekly campaign reviews, and cross-reference Click Guard data with Google Ads.",
    screenshots: 0,
  },
  {
    slug: "click-fraud",
    icon: ShieldAlert,
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    number: "11",
    title: "Click Fraud: The Hidden Budget Killer",
    description: "Some clicks on contractor ads come from telemarketers, competitors, and bots rather than customers. Learn how to spot who's clicking and how to exclude them.",
    screenshots: 0,
    critical: true,
  },
  {
    slug: "mistakes",
    icon: AlertTriangle,
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    number: "12",
    title: "Costly Mistakes That Will Wreck Your Budget",
    description: "The 9 most expensive mistakes contractors make with Google Ads, plus a complete Campaign Launch Checklist to verify every setting before going live.",
    screenshots: 1,
  },
];

export default function GoogleAdsGuidePage() {
  const { data: user } = useQuery<{ id: number; displayName?: string } | null>({
    queryKey: ["/api/auth/me"],
  });

  const { data: purchases = [] } = useQuery<{ moduleId: string; purchasedAt: string }[]>({
    queryKey: ["/api/course-purchases"],
    enabled: !!user,
  });

  const isDev = import.meta.env.DEV;
  const hasAccess = isDev || purchases.length > 0;

  if (!hasAccess) {
    return (
      <>
      <PublicPageHeader next="/google-ads-guide" />
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-8" data-testid="view-google-ads-locked">
          <div className="text-center max-w-3xl mx-auto">
            {/* Google's typography and hairlines (owner, 2026-10-07): the content and the Master Class gate as they were. */}
            <div className="g-pill g-pill--sm mb-4">
              <Lock aria-hidden="true" />
              <span>Master Class Students Only</span>
            </div>
            <h1 className="g-header__title !text-[28px] !leading-[34px] sm:!text-[32px] sm:!leading-[40px] mb-3" data-testid="text-locked-title">
              Google Ads for Contractors:
              <br />
              The Complete Campaign Setup Playbook
            </h1>
            <p className="g-text-2 text-sm leading-relaxed mb-8">
              12 in-depth sections with real Google Ads screenshots showing you exactly how to set up campaigns that generate real leads — and every trap Google sets to drain your budget.
            </p>
          </div>

          <Card className="max-w-2xl mx-auto shadow-none" data-testid="card-upgrade-prompt">
            <CardContent className="p-8 text-center">
              <div className="g-card__lead mx-auto mb-4 !h-16 !w-16">
                <GraduationCap className="!h-8 !w-8" aria-hidden="true" />
              </div>
              <h3 className="g-header__title mb-2">Unlock the Full Playbook</h3>
              <p className="g-text-2 text-sm mb-6 max-w-md mx-auto">
                12 detailed guide pages with step-by-step instructions, real screenshots, and every setting explained.
              </p>
              <GooglePill icon={GraduationCap} variant="solid" href="/master-class" label="Go to Master Class" testId="link-master-class" className="px-8" />
              <p className="text-xs text-muted-foreground mt-3">
                Any Master Class purchase unlocks the Google Ads content
              </p>
            </CardContent>
          </Card>

          {/* The outline is public (the same titles and summaries the unlocked page lists); the walkthroughs stay locked. */}
          <section className="max-w-4xl mx-auto" aria-labelledby="locked-outline-title" data-testid="section-locked-outline">
            <h2 id="locked-outline-title" className="g-header__title text-center mb-2">What the 12 Sections Cover</h2>
            <p className="g-text-2 text-sm text-center max-w-2xl mx-auto mb-6">
              Each section is a full walkthrough in the Master Class. Here is what every one of them covers.
            </p>
            <ol className="g-list">
              {GUIDE_SECTIONS.map((s) => (
                <li key={s.slug} className="g-card" data-testid={`locked-outline-${s.slug}`}>
                  <div className="g-card__row">
                    <span className="g-text-2 w-7 text-right flex-shrink-0 tabular-nums pt-2">{s.number}</span>
                    <span className="g-card__lead" aria-hidden="true"><s.icon /></span>
                    <div className="g-card__body">
                      <h3 className="g-card__title g-card__title--md">{s.title}</h3>
                      <p className="g-card__line">{s.description}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    <PublicPageHeader next="/google-ads-guide" />
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10" data-testid="view-ads-masterclass">
            <img src={googleAdsLogo} alt="Google Ads" className="h-12 w-12 rounded-lg object-contain mx-auto mb-4" />
            <div className="g-pill g-pill--sm mb-4">
              <GraduationCap aria-hidden="true" />
              <span>Google Ads Master Class</span>
            </div>
            <h1 className="g-header__title !text-[28px] !leading-[34px] sm:!text-[32px] sm:!leading-[40px] mb-3" data-testid="text-masterclass-title">
              Google Ads for Contractors:
              <br />
              The Complete Campaign Setup Playbook
            </h1>
            <p className="g-text-2 text-sm leading-relaxed">
              12 detailed guide pages showing you exactly how to set up profitable Google Ads campaigns. Each page is a complete walkthrough with real screenshots, step-by-step instructions, and the strategies that actually generate leads.
            </p>
          </div>

          <Card className="max-w-4xl mx-auto shadow-none mb-8" data-testid="card-critical-warning">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-[#FBBC05] flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="g-card__title g-card__title--md mb-1">Critical Warning: Google's Default Settings Are Designed to Drain Your Budget</h4>
                  <p className="g-card__line">
                    Google Ads comes with Auto-Apply, AI Max, Search Partners, Broad Match, and Automatically Created Assets all enabled by default. Every one of these features increases Google's revenue at your expense. Start with Section 1 and work through every page in order.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto mb-10">
            {[
              { label: "Guide Pages", value: "12", sub: "step-by-step walkthroughs", color: "text-[#4285F4]" },
              { label: "Screenshots", value: "11+", sub: "real Google Ads settings", color: "text-[#34A853]" },
              { label: "Contractor CPC", value: "$30-50", sub: "avg cost per click", color: "text-[#FBBC05]" },
              { label: "IP Exclusions", value: "500", sub: "max per Google Ads campaign", color: "text-[#4285F4]" },
            ].map((stat) => (
              <div key={stat.label} className="g-stat text-center" data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                <p className="g-stat__value">{stat.value}</p>
                <p className="g-stat__label mt-1">{stat.label}</p>
                <p className="g-stat__hint">{stat.sub}</p>
              </div>
            ))}
          </div>

          <div className="max-w-4xl mx-auto g-list">
            {GUIDE_SECTIONS.map((s) => (
              <Link key={s.slug} href={`/google-ads-guide/${s.slug}`} className="g-card group" data-testid={`card-section-${s.slug}`}>
                <div className="g-card__row items-center">
                  <span className="g-text-2 w-7 text-right flex-shrink-0 tabular-nums">{s.number}</span>
                  <span className="g-card__lead" aria-hidden="true"><s.icon /></span>
                  <div className="g-card__body">
                    <h3 className="g-card__title g-card__title--md group-hover:underline">
                      {s.title}
                      {s.critical && <span className="g-chip g-chip--sm ml-2 align-middle !normal-case">Critical</span>}
                    </h3>
                    <p className="g-card__line line-clamp-2">{s.description}</p>
                    {s.screenshots > 0 && (
                      <p className="g-card__meta inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" aria-hidden="true" /> {s.screenshots} {s.screenshots === 1 ? "screenshot" : "screenshots"}</p>
                    )}
                  </div>
                  <div className="g-card__trailing">
                    <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto mt-10 shadow-none" data-testid="card-bottom-cta">
            <CardContent className="p-6 text-center">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
              <h3 className="g-header__title mb-2">Ready to Protect Your Ad Budget?</h3>
              <p className="g-text-2 text-sm leading-relaxed max-w-2xl mx-auto mb-4">
                Start with Section 1 and work through the entire guide. Then set up Click Guard to protect your campaigns from click fraud.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <GooglePill icon={ChevronRight} variant="solid" href="/google-ads-guide/campaign-setup" label="Start the Guide" testId="button-start-guide" />
                <GooglePill icon={ShieldCheck} href="/google-ads" label="Set Up Click Guard" testId="button-click-guard" />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
    </>
  );
}
