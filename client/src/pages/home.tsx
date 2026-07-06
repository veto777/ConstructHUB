import { useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, Database, Building2, Camera, Eye, Grid3X3, Shield,
  ShieldOff, Fingerprint, Crosshair, GraduationCap, Megaphone,
  ArrowRight, Zap, Star, Globe, TrendingUp, Users, Sparkles,
  Target, BadgeCheck, BarChart3, Bot, Clock, Lock, MapPin,
  FileText, Briefcase, ChevronRight, Crown, Award,
} from "lucide-react";
import { SHOW_COMPETITOR_INTEL } from "@/lib/features";

function FloatingParticles({ color = "#d4d4d8" }: { color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles: { x: number; y: number; size: number; speedX: number; speedY: number; opacity: number; rotation: number; rotSpeed: number }[] = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 6 + 2,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: Math.random() * 0.25 + 0.08,
        opacity: Math.random() * 0.12 + 0.03,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 1.2,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;
        if (p.y > canvas.height + 10) { p.y = -10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [color]);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
}

interface ToolShowcase {
  title: string;
  tagline: string;
  description: string;
  whyItMatters: string;
  icon: any;
  url: string;
  stats?: string;
}

const TOOLS: ToolShowcase[] = [
  {
    title: "Permit Database Search",
    tagline: "Find every permit before your competitors do",
    description: "Search 32,864+ permit databases across all 50 states and 3,139 counties. Find new construction projects, renovation permits, and building activity in any city or county in the country — instantly.",
    whyItMatters: "While your competitors wait for word of mouth, you're identifying new construction projects the day permits are filed. Every permit is a warm lead — a homeowner who already committed to spending money on construction.",
    icon: Search,
    url: "/search",
    stats: "32,864+ databases",
  },
  {
    title: "Database Directory",
    tagline: "Every permit source in America, mapped",
    description: "Browse the most complete directory of construction permit databases ever assembled. Every county, every city, organized by state with direct links to official government portals.",
    whyItMatters: "No more Googling for hours trying to find where a county keeps their permits. We've already found and verified every single permit database in the country so you don't have to.",
    icon: Database,
    url: "/databases",
    stats: "3,139 counties",
  },
  {
    title: "Property Records",
    tagline: "Know the property before you knock on the door",
    description: "Access property appraiser records across all 3,139 counties. Look up ownership details, property values, building characteristics, and assessment history for any address.",
    whyItMatters: "When you know a property's value, square footage, and owner before making contact, you walk in with confidence. You can tailor your pitch, estimate accurately, and close faster because you already did your homework.",
    icon: Building2,
    url: "/property",
    stats: "3,139 counties",
  },
  {
    title: "GMB Monitor",
    tagline: "Never miss a change to your Google profile",
    description: "Real-time monitoring of your Google Business Profile. Get alerted when anything changes — name, address, photos, hours, categories. Includes an AI-powered review response generator that crafts professional replies in seconds.",
    whyItMatters: "Google can change your business profile without telling you. Anyone can suggest edits. One wrong change to your hours or address and you lose customers without knowing why. This tool watches your profile 24/7.",
    icon: Eye,
    url: "/gmb-monitor",
  },
  {
    title: "GMB Ranking Grid",
    tagline: "See exactly where you rank on Google Maps",
    description: "Generate visual ranking grid reports showing your Google Business position across your entire service area. Track how you rank for specific keywords at every point in your coverage zone.",
    whyItMatters: "You might rank #1 at your office but #15 two miles away. Most contractors have no idea their rankings drop off a cliff outside their immediate area. This tool shows you the blind spots so you can fix them.",
    icon: Grid3X3,
    url: "/ranking-grid",
  },
  {
    title: "SEO Photo Optimizer",
    tagline: "Turn job site photos into ranking fuel",
    description: "Optimize your Google Business photos with geo-tagging, EXIF metadata injection, AI-generated descriptions, and SEO-friendly filenames. Every photo becomes a local ranking signal.",
    whyItMatters: "Google uses photo metadata to verify where your business operates. Properly optimized photos with GPS coordinates and relevant descriptions tell Google you're active and legitimate in your service area. Most contractors upload photos with zero metadata — you won't.",
    icon: Camera,
    url: "/photos",
  },
  {
    title: "Google Click Guard",
    tagline: "Stop competitors from draining your ad budget",
    description: "Detect and block click fraud on your Google Ads. Automatic IP exclusions, device fingerprinting, VPN detection, and a real-time fraud analytics dashboard showing exactly who's clicking your ads and why.",
    whyItMatters: "Studies show 14-20% of all Google Ads clicks are fraudulent. For construction companies spending $2,000-$10,000/month on ads, that's hundreds to thousands of dollars going to competitors clicking your ads, bots, and click farms. This tool stops them.",
    icon: Shield,
    url: "/google-ads",
  },
  {
    title: "IP Tracker",
    tagline: "Know exactly who visits your website",
    description: "Real-time visitor tracking with device fingerprinting, geo-location, traffic source analysis, browser/OS detection, and detailed visitor activity timelines. A modern replacement for TraceMyIP, built for contractors.",
    whyItMatters: "Your website is your digital storefront. Knowing who visits, where they came from, and what pages they viewed gives you intelligence most contractors never have.",
    icon: Fingerprint,
    url: "/ip-tracker",
  },
  {
    title: "VPN Shield",
    tagline: "Block anonymous visitors polluting your data",
    description: "Detect and block VPN, proxy, and datacenter traffic from your websites. Uses WebRTC leak detection, timezone mismatch analysis, and datacenter IP matching. Automatically whitelists search engine crawlers.",
    whyItMatters: "VPN users pollute your analytics with fake locations, making your marketing data worthless. VPN Shield filters them out while keeping legitimate visitors and search engine crawlers untouched.",
    icon: ShieldOff,
    url: "/vpn-shield",
  },
  {
    title: "Competitor Intelligence",
    tagline: "See everything your competitors are doing",
    description: "Track competitor Google Business profiles, analyze their reviews with our BS Meter for fake review detection, monitor their ad activity, and run market scans to uncover their strategies.",
    whyItMatters: "Your competitors are watching you — but are you watching them? Know when they get new reviews, change their services, or start running ads. The BS Meter catches fake 5-star review campaigns so you can report them and level the playing field.",
    icon: Crosshair,
    url: "/competitors",
  },
  {
    title: "Master Class",
    tagline: "The complete guide to building a construction business",
    description: "State-by-state guides for LLC formation, licensing, bonding, and insurance. Plus expert modules on subcontractor management, sales strategies, hiring, branding, website & SEO, and vetting other contractors.",
    whyItMatters: "Starting a construction business without proper licensing, bonding, or insurance can get you fined, sued, or shut down. Every state has different rules. This is the playbook that shows you exactly what to do in your state, step by step.",
    icon: GraduationCap,
    url: "/master-class",
  },
  {
    title: "Google Ads Master Class",
    tagline: "Stop wasting money on Google Ads",
    description: "12 detailed sections covering everything from campaign setup to click fraud protection. Learn which Google features to avoid, how to write ads that convert, proper bidding strategies, and the costly mistakes most contractors make.",
    whyItMatters: "Most contractors lose 40-60% of their Google Ads budget to bad settings, wrong keywords, and features Google pushes that don't work for local businesses. This guide was written by someone who's managed millions in construction ad spend.",
    icon: Megaphone,
    url: "/google-ads-guide",
  },
];

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-12 relative">
      <FloatingParticles color="#c2410c" />
      <div className="text-center space-y-4 relative z-10">
        <Badge className="px-4 py-1.5 text-sm bg-orange-500/10 text-foreground dark:text-orange-400 border border-orange-500/20" data-testid="badge-home-hero">
          <Zap className="w-4 h-4 mr-2" /> Built for Contractors Who Refuse to Stay Small
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight" data-testid="text-home-title">
          Stop Guessing. Start
          <span className="font-black italic text-[#F97316]"> Dominating.</span>
        </h1>
        <p className="text-muted-foreground max-w-3xl mx-auto text-lg leading-relaxed">
          Most contractors are leaving money on the table — chasing cold leads, getting ripped off by ad agencies, and watching competitors steal their jobs. ConstructHUB's expert-led Master Class and powerful growth tools give you the training, data, and protection to take control of your market.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 relative z-10">
        {[
          { label: "Permit Databases", value: "32,864+", icon: Database },
          { label: "Counties Covered", value: "3,139", icon: MapPin },
          { label: "All 50 States + DC", value: "51", icon: Globe },
          { label: "Pro Tools", value: "15+", icon: Zap },
        ].map((stat) => (
          <Card key={stat.label} className="bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/50" data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="p-4 text-center">
              <stat.icon className="w-6 h-6 mx-auto mb-2 text-blue-600 dark:text-blue-400" />
              <div className="text-2xl sm:text-3xl font-extrabold">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#4A6CF7] to-[#F97316] bg-clip-text text-transparent whitespace-nowrap" data-testid="text-tools-heading">Your Complete Toolkit</h2>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-5">
          {TOOLS.filter((tool) => SHOW_COMPETITOR_INTEL || tool.title !== "Competitor Intelligence").map((tool, index) => (
            <Link key={tool.title} href={tool.url} className="block no-underline" data-testid={`card-tool-${index}`}>
            <Card
              className="group border-border/50 hover:border-border transition-all hover:shadow-md cursor-pointer"
            >
              <CardContent className="p-0">
                <div className="flex flex-col lg:flex-row">
                  <div className="flex-1 p-6 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-muted border border-border/50">
                        <tool.icon className="w-6 h-6 text-[#4A6CF7]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-bold">{tool.title}</h3>
                          {tool.stats && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {tool.stats}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[#4A6CF7]">{tool.tagline}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0 mt-1 hidden sm:block" />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
                  </div>

                  <div className="lg:w-[380px] shrink-0 p-5 lg:p-6 border-t lg:border-t-0 lg:border-l border-border/30 bg-muted/30 rounded-b-xl lg:rounded-b-none lg:rounded-r-xl">
                    <div className="flex items-start gap-2">
                      <Target className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Why This Is a Game Changer</span>
                        <p className="text-sm mt-1 leading-relaxed">{tool.whyItMatters}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </Link>
          ))}
        </div>
      </div>

      <Card className="border-border/50 relative z-10" data-testid="card-bottom-cta">
        <CardContent className="p-8 text-center space-y-4">
          <Award className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-extrabold">Ready to Get the Advantage?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            These 12 tools used separately would cost over $500/month. Bundle them all together starting at $15/month,
            or go all-in with our Gold and Platinum plans for complete market domination.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              className="bg-foreground text-background hover:bg-foreground/90 font-bold px-8"
              onClick={() => setLocation("/pricing")}
              data-testid="button-view-plans"
            >
              <Crown className="w-4 h-4 mr-2" /> View Plans & Pricing
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/individual-pricing")}
              data-testid="button-individual-tools"
            >
              <Zap className="w-4 h-4 mr-2" /> À La Carte Tools
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
