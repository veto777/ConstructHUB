import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
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
    description: "25-33% of contractor clicks are fraudulent. Telemarketers, competitors, and bots are draining your budget daily. Learn who's clicking and how to stop them.",
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
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-8" data-testid="view-google-ads-locked">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-[#4285F4]/10 border border-[#4285F4]/20 rounded-full px-4 py-1.5 mb-4">
              <Lock className="h-4 w-4 text-[#4285F4]" />
              <span className="text-sm text-[#4285F4] font-medium">Platinum & Master Class Subscribers Only</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-3" data-testid="text-locked-title">
              Google Ads for Contractors:
              <br />
              <span className="bg-gradient-to-r from-[#4285F4] to-[#34A853] bg-clip-text text-transparent">
                The Complete Campaign Setup Playbook
              </span>
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              12 in-depth sections with real Google Ads screenshots showing you exactly how to set up campaigns that generate real leads — and every trap Google sets to drain your budget.
            </p>
          </div>

          <Card className="max-w-2xl mx-auto bg-gradient-to-br from-[#4285F4]/10 to-[#34A853]/10 border-[#4285F4]/20" data-testid="card-upgrade-prompt">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4285F4] to-[#34A853] flex items-center justify-center mx-auto mb-4">
                <GraduationCap className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Unlock the Full Playbook</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                12 detailed guide pages with step-by-step instructions, real screenshots, and every setting explained.
              </p>
              <a href="/master-class" data-testid="link-master-class">
                <Button className="bg-gradient-to-r from-[#4285F4] to-[#34A853] hover:from-[#3367D6] hover:to-[#2D9A46] text-white px-8 h-11">
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Go to Master Class
                </Button>
              </a>
              <p className="text-xs text-muted-foreground mt-3">
                Platinum or Master Class purchase unlocks Google Ads content
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10" data-testid="view-ads-masterclass">
            <img src={googleAdsLogo} alt="Google Ads" className="h-12 w-12 rounded-lg object-contain mx-auto mb-4" />
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-[#4285F4]/20 to-[#34A853]/20 border border-[#4285F4]/20 rounded-full px-4 py-1.5 mb-4 animate-in animate-badge-glow">
              <GraduationCap className="h-4 w-4 text-[#4285F4]" />
              <span className="text-sm text-[#4285F4] font-medium">Google Ads Master Class</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-3 animate-in-delay-1" data-testid="text-masterclass-title">
              Google Ads for Contractors:
              <br />
              <span className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#4285F4] bg-clip-text text-transparent animate-gradient-text">
                The Complete Campaign Setup Playbook
              </span>
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed animate-in-delay-2">
              12 detailed guide pages showing you exactly how to set up profitable Google Ads campaigns. Each page is a complete walkthrough with real screenshots, step-by-step instructions, and the strategies that actually generate leads.
            </p>
          </div>

          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#FBBC05]/10 to-[#4285F4]/10 border-[#FBBC05]/20 mb-8 animate-in-delay-3" data-testid="card-critical-warning">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-[#FBBC05] flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-[#FBBC05] mb-1">Critical Warning: Google's Default Settings Are Designed to Drain Your Budget</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
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
              { label: "Potential Savings", value: "25%+", sub: "with Click Guard", color: "text-[#4285F4]" },
            ].map((stat, i) => (
              <Card key={stat.label} className={`bg-card border-border text-center card-hover-glow animate-scale-in`} style={{ animationDelay: `${0.3 + i * 0.1}s` }} data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                <CardContent className="p-4">
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="max-w-4xl mx-auto space-y-3">
            {GUIDE_SECTIONS.map((s, i) => (
              <Link key={s.slug} href={`/google-ads-guide/${s.slug}`}>
                <Card
                  className="bg-card border-border card-hover-lift cursor-pointer group stagger-item"
                  style={{ animationDelay: `${0.4 + i * 0.06}s` }}
                  data-testid={`card-section-${s.slug}`}
                >
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 p-5">
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className="text-lg font-bold text-muted-foreground w-7 text-right">{s.number}</span>
                        <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
                          <s.icon className={`h-5 w-5 ${s.color}`} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="text-sm sm:text-base font-semibold text-foreground group-hover:text-[#4285F4] transition-colors">{s.title}</h3>
                          {s.critical && (
                            <Badge className="bg-[#FBBC05]/10 text-[#FBBC05] border-[#FBBC05]/20 text-[9px] px-1.5 py-0 flex-shrink-0">CRITICAL</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{s.description}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {s.screenshots > 0 && (
                          <Badge className="bg-card text-muted-foreground border-border text-[9px] hidden sm:flex">
                            <ImageIcon className="h-3 w-3 mr-1" /> {s.screenshots} {s.screenshots === 1 ? "screenshot" : "screenshots"}
                          </Badge>
                        )}
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-[#4285F4] transition-all duration-300 group-hover:translate-x-1" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto mt-10 bg-gradient-to-r from-[#4285F4]/10 to-[#34A853]/10 border-[#4285F4]/20 card-hover-glow" data-testid="card-bottom-cta">
            <CardContent className="p-6 text-center">
              <Shield className="h-8 w-8 text-[#4285F4] mx-auto mb-3 animate-float" />
              <h3 className="text-lg font-bold text-foreground mb-2">Ready to Protect Your Ad Budget?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-4">
                Start with Section 1 and work through the entire guide. Then set up Click Guard to protect your campaigns from click fraud.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link href="/google-ads-guide/campaign-setup">
                  <Button className="bg-gradient-to-r from-[#4285F4] to-[#34A853] text-white px-6 h-10" data-testid="button-start-guide">
                    Start the Guide <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
                <Link href="/google-ads">
                  <Button variant="outline" className="border-border px-6 h-10" data-testid="button-click-guard">
                    <ShieldCheck className="h-4 w-4 mr-2" /> Set Up Click Guard
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
