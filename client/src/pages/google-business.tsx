import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, Eye, Grid3X3, Camera, MapPin, ShieldAlert,
  CheckCircle2, Star, Zap, ChevronRight, TrendingUp,
  Users, Phone, Search, BarChart3, Bell, MessageSquare,
  Globe, Award, Shield, ImageIcon, AlertTriangle,
  Target, Sparkles, BadgeCheck,
} from "lucide-react";
import googleBusinessLogo from "@assets/google-business-logo.png";

function CountUp({ end, suffix = "", prefix = "", duration = 2000 }: { end: number; suffix?: string; prefix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = Date.now();
          const tick = () => {
            const elapsed = Date.now() - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(tick);
          };
          tick();
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);

  return <span ref={ref}>{prefix}{count}{suffix}</span>;
}

const stats = [
  { value: 84, suffix: "%", label: "Search Locally", sub: "of customers search for local services" },
  { value: 5, suffix: "x", label: "More Calls", sub: "with an optimized GBP profile" },
  { value: 76, suffix: "%", label: "Visit Within 24h", sub: "of nearby searchers visit a business" },
  { value: 3, suffix: ".5", label: "Stars Minimum", sub: "before customers will consider you" },
];

const tools = [
  {
    icon: Eye,
    title: "GBP Monitor",
    description: "Your listing can be edited by anyone — Google, competitors, or random users. Track every change in real time. AI-powered review response generator included.",
    gradient: "from-purple-500 to-violet-500",
    border: "border-purple-500/20",
    link: "/gmb-monitor",
    badge: "Monitoring",
    badgeColor: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    features: ["Real-time edit tracking", "AI review responses", "Instant change alerts"],
  },
  {
    icon: Grid3X3,
    title: "Ranking Grid",
    description: "You might rank #1 from your office but #15 from 5 miles away. See exactly where you rank across your entire service area with a geographic heatmap.",
    gradient: "from-emerald-500 to-teal-500",
    border: "border-emerald-500/20",
    link: "/ranking-grid",
    badge: "Rankings",
    badgeColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    features: ["Geographic heatmap", "Keyword tracking", "Competitor comparison"],
  },
  {
    icon: Camera,
    title: "SEO Photo Optimizer",
    description: "Google Business photos with proper EXIF data, geotagging, and optimized filenames rank higher. Most contractors upload phone photos with zero optimization.",
    gradient: "from-blue-500 to-indigo-500",
    border: "border-blue-500/20",
    link: "/photos",
    badge: "Optimization",
    badgeColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    features: ["EXIF metadata injection", "AI descriptions", "SEO filenames"],
  },
  {
    icon: MapPin,
    title: "Locations Manager",
    description: "Track views, calls, direction requests, and site visits in one Semrush-style dashboard. Run citation campaigns to boost local authority.",
    gradient: "from-pink-500 to-rose-500",
    border: "border-pink-500/20",
    link: "/locations",
    badge: "Analytics",
    badgeColor: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
    features: ["Analytics dashboard", "Citation campaigns", "Multi-location management"],
  },
  {
    icon: ShieldAlert,
    title: "GBP Reinstatement",
    description: "A suspended Google Business Profile means zero visibility. Our proven 4-step process has reinstated hundreds of profiles. Flat rate, expert handling.",
    gradient: "from-red-500 to-orange-500",
    border: "border-red-500/20",
    link: "/reinstatement",
    badge: "Recovery",
    badgeColor: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    features: ["Soft & hard suspension", "$599 flat rate", "Expert handling"],
  },
];

const pipeline = [
  { step: "01", title: "Claim & Verify Your Profile", desc: "We ensure your Google Business Profile is properly claimed, verified, and set up with the right categories, service areas, and business details.", icon: BadgeCheck, color: "from-[#4A6CF7] to-[#3B5DE7]" },
  { step: "02", title: "Optimize Every Detail", desc: "Photos with EXIF data, AI-generated descriptions, proper attributes, and SEO-optimized content. Every element tuned for maximum visibility.", icon: Sparkles, color: "from-[#34A853] to-[#2D9A46]" },
  { step: "03", title: "Monitor & Dominate", desc: "Real-time monitoring catches unauthorized edits. Ranking grids show your position everywhere. Analytics track what's working and what needs improvement.", icon: TrendingUp, color: "from-[#8B5CF6] to-[#7C3AED]" },
];

const keyPoints = [
  { icon: Bell, color: "text-purple-600 dark:text-purple-400", title: "Anyone Can Edit Your Listing", desc: "Google, competitors, and random users suggest changes to your profile daily" },
  { icon: Star, color: "text-yellow-500 dark:text-yellow-400", title: "Reviews Are Everything", desc: "88% of consumers trust online reviews as much as personal recommendations" },
  { icon: Camera, color: "text-blue-600 dark:text-blue-400", title: "Photos Drive 42% More Clicks", desc: "Listings with 100+ photos get 520% more calls than those with fewer" },
  { icon: MapPin, color: "text-emerald-600 dark:text-emerald-400", title: "Local Pack = 3 Spots", desc: "Only 3 businesses appear in Google's Local Pack — are you one of them?" },
  { icon: Target, color: "text-pink-600 dark:text-pink-400", title: "Citations Build Authority", desc: "Consistent NAP data across directories is a top local ranking factor" },
  { icon: MessageSquare, color: "text-violet-600 dark:text-violet-400", title: "Response Time Matters", desc: "Businesses that respond to reviews within 24h get 35% more engagement" },
];

export default function GoogleBusinessPage() {
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="animate-in">
              <img src={googleBusinessLogo} alt="Google Business" className="h-16 w-16 rounded-xl object-contain mx-auto mb-6 animate-float" />
            </div>
            <div className="animate-in-delay-1">
              <Badge className="mb-6 bg-[#4A6CF7]/10 text-[#4A6CF7] border-[#4A6CF7]/20 px-4 py-1.5 text-sm" data-testid="badge-hero">
                <Globe className="h-3.5 w-3.5 mr-1.5" /> Google Business Profile Suite for Contractors
              </Badge>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-2" data-testid="text-hero-title">
              <span className="text-foreground">
                Own Your Local
              </span>
              <br />
              <span className="bg-gradient-to-r from-[#4A6CF7] via-[#34A853] to-[#8B5CF6] bg-clip-text text-transparent animate-gradient-text">
                Search Results
              </span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed animate-in-delay-3">
              84% of customers search for local services online. Your Google Business Profile is the first thing they see.
              Monitor it, optimize it, and dominate the Local Pack with 5 purpose-built tools.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-4">
              <Link href={user ? "/gmb-monitor" : "/auth?mode=signup"} data-testid="link-hero-start">
                <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-8 h-12 text-base shadow-lg shadow-blue-500/25">
                  <Eye className="h-4 w-4 mr-2" /> Start Monitoring <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <a href="#tools" data-testid="link-hero-explore">
                <Button size="lg" variant="outline" className="px-8 h-12 text-base">
                  <Star className="h-4 w-4 mr-2" /> Explore All Tools
                </Button>
              </a>
            </div>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground animate-in-delay-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Real-time profile monitoring
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> AI review response generator
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Geographic ranking grids
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-purple-500" /> SEO photo optimization
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
              <BarChart3 className="h-3 w-3 mr-1" /> The Opportunity
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Local Search Is
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#34A853] bg-clip-text text-transparent"> Everything</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {stats.map((stat, i) => (
              <Card key={stat.label} className={`bg-card border-border p-6 text-center animate-in-delay-${i + 1}`} data-testid={`card-stat-${i}`}>
                <div className="text-3xl sm:text-4xl font-extrabold text-foreground">
                  <CountUp end={stat.value} suffix={stat.suffix} />
                </div>
                <p className="text-sm text-muted-foreground mt-1 font-medium">{stat.label}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{stat.sub}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="tools" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-muted text-muted-foreground border-border">Complete Toolkit</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              5 Tools.
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#8B5CF6] bg-clip-text text-transparent"> One Mission.</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Each tool solves a specific problem that costs contractors leads, rankings, and revenue every single day.
            </p>
          </div>
          <div className="space-y-5">
            {tools.map((tool, i) => (
              <Link key={tool.title} href={user ? tool.link : "/auth?mode=signup"}>
                <Card
                  className={`group bg-card ${tool.border} hover:border-border p-6 transition-all duration-300 hover:-translate-y-1 cursor-pointer animate-in-delay-${Math.min(i + 1, 5)}`}
                  data-testid={`card-tool-${i}`}
                >
                  <div className="flex flex-col sm:flex-row items-start gap-5">
                    <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                      <tool.icon className="h-7 w-7 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="text-lg font-semibold text-foreground">{tool.title}</h3>
                        <Badge className={`${tool.badgeColor} text-[10px] px-2 py-0`}>{tool.badge}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{tool.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {tool.features.map(f => (
                          <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-1 transition-all mt-1 shrink-0 hidden sm:block" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-[#34A853]/10 text-[#34A853] border-[#34A853]/20">
              <Zap className="h-3 w-3 mr-1" /> 3-Step Process
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              How We Help You
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#34A853] bg-clip-text text-transparent"> Dominate Locally</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              From setup to domination — a proven system that works for every contractor.
            </p>
          </div>
          <div className="space-y-6">
            {pipeline.map((item, i) => (
              <Card
                key={item.step}
                className={`bg-card border-border p-6 animate-in-delay-${i + 1}`}
                data-testid={`card-pipeline-${item.step}`}
              >
                <div className="flex items-start gap-5">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shrink-0`}>
                    <item.icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs font-bold text-muted-foreground/50 tracking-widest">STEP {item.step}</span>
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="text-center mt-8 animate-in-delay-4">
            <Link href={user ? "/gmb-monitor" : "/auth?mode=signup"} data-testid="link-pipeline-cta">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-8 h-12 shadow-lg shadow-blue-500/25">
                <Eye className="h-4 w-4 mr-2" /> Start Monitoring Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="insights" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20">
              <AlertTriangle className="h-3 w-3 mr-1" /> Critical Knowledge
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              6 Things Most Contractors
              <span className="bg-gradient-to-r from-purple-500 to-[#4A6CF7] bg-clip-text text-transparent"> Don't Know</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Your Google Business Profile is more powerful — and more vulnerable — than you think. These insights could save your rankings.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {keyPoints.map((point, i) => (
              <Card
                key={point.title}
                className={`bg-card border-border p-5 hover:border-border/80 transition-all duration-300 hover:-translate-y-1 animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-insight-${i}`}
              >
                <point.icon className={`h-6 w-6 ${point.color} mb-3`} />
                <h3 className="text-sm font-bold text-foreground mb-1">{point.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{point.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#4A6CF7]/5 via-card to-[#34A853]/5 border-border p-8 sm:p-12" data-testid="card-comparison">
            <div className="absolute inset-0 bg-gradient-to-r from-[#4A6CF7]/5 to-[#34A853]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-2">
                  Without GBP Tools vs.
                  <span className="text-emerald-500"> With Our Suite</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-red-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Without Protection
                  </h3>
                  {[
                    "Unauthorized edits go unnoticed",
                    "No idea where you actually rank",
                    "Photos with zero SEO value",
                    "Reviews unanswered for days",
                    "Competitors outrank you locally",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-emerald-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> With Our Suite
                  </h3>
                  {[
                    "Instant alerts on every profile change",
                    "See your rank from every zip code",
                    "EXIF-optimized, geotagged photos",
                    "AI writes review responses instantly",
                    "Citation campaigns build local authority",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="get-started" className="relative z-10 py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <img src={googleBusinessLogo} alt="Google Business" className="h-20 w-20 rounded-2xl object-contain mx-auto mb-6 animate-float" />
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4" data-testid="text-final-cta">
            Ready to
            <br />
            <span className="bg-gradient-to-r from-[#4A6CF7] via-[#34A853] to-[#8B5CF6] bg-clip-text text-transparent">
              Dominate Local Search?
            </span>
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Join hundreds of contractors who use our Google Business Profile Suite to get more calls, more leads, and more revenue from local search.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? "/gmb-monitor" : "/auth?mode=signup"} data-testid="link-final-start">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-10 h-13 text-base shadow-lg shadow-blue-500/25">
                Start Monitoring <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href="/pricing" data-testid="link-final-pricing">
              <Button size="lg" variant="outline" className="px-8 h-13 text-base">
                <Award className="h-4 w-4 mr-2" /> View Plans & Pricing
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
