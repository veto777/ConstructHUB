import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import { Settings } from "lucide-react";
import {
  ArrowRight, Search, Database, Building, Clock, FileText,
  CheckCircle2, Zap, ChevronRight, TrendingUp,
  Users, DollarSign, BarChart3, AlertTriangle,
  Globe, Award, Shield, MapPin, Target,
  Layers, HardHat, Landmark, Eye,
  BookOpen, Filter, Download, RefreshCw,
} from "lucide-react";

function PermitsAnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let isDark = document.documentElement.classList.contains('dark');

    const observer = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const colors = [
      { h: 227, s: 71, l: 57 },
      { h: 30, s: 90, l: 55 },
      { h: 170, s: 60, l: 45 },
    ];
    let particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; colorIdx: number;
    }> = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2.5 + 1,
        opacity: Math.random() * 0.25 + 0.08,
        colorIdx: Math.floor(Math.random() * 3),
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMultiplier = isDark ? 1 : 0.3;

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const c = colors[p.colorIdx];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${p.opacity * opacityMultiplier})`;
        ctx.fill();

        particles.forEach((p2, j) => {
          if (j <= i) return;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `hsla(227, 71%, 57%, ${0.04 * (1 - dist / 120) * opacityMultiplier})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none dark:bg-none"
      style={{ background: "transparent" }}
    />
  );
}

function PermitsFloatingOrbs() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="landing-orb" style={{ width: 500, height: 500, background: "radial-gradient(circle, #4A6CF7, transparent 70%)", top: -150, right: -150, animationDelay: "0s" }} />
      <div className="landing-orb" style={{ width: 400, height: 400, background: "radial-gradient(circle, #F59E0B, transparent 70%)", bottom: -100, left: -100, animationDelay: "-7s" }} />
      <div className="landing-orb" style={{ width: 350, height: 350, background: "radial-gradient(circle, #14B8A6, transparent 70%)", top: "40%", right: -100, animationDelay: "-14s" }} />
    </div>
  );
}

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
  { value: 50, suffix: "", label: "States Covered", sub: "Complete nationwide directory" },
  { value: 32864, suffix: "+", label: "Permit Databases", sub: "County & city portals indexed" },
  { value: 3139, suffix: "+", label: "Counties Mapped", sub: "Every US county accessible" },
  { value: 10, suffix: "x", label: "Time Saved", sub: "vs. manual portal searching" },
];

const tools = [
  {
    icon: Search,
    title: "Cross-Database Search",
    description: "Search for permits across every database in a county or state with a single query. No more visiting 5 different government portals to find one permit.",
    gradient: "from-blue-500/20 to-indigo-500/20",
    border: "border-blue-500/20",
    link: "/",
    badge: "Search",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    features: ["Address & parcel search", "Multi-database results", "Real-time scraping"],
  },
  {
    icon: Database,
    title: "Database Directory",
    description: "Browse the complete directory of permit databases organized by state and county. Every portal link, phone number, and platform type documented.",
    gradient: "from-amber-500/20 to-orange-500/20",
    border: "border-amber-500/20",
    link: "/databases",
    badge: "Directory",
    badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    features: ["Filter by state & county", "Portal links included", "Platform identification"],
  },
  {
    icon: Building,
    title: "Property Records",
    description: "Access county assessor and property appraiser data. Look up ownership, assessed values, tax records, and sales history for any property in your service area.",
    gradient: "from-teal-500/20 to-emerald-500/20",
    border: "border-teal-500/20",
    link: "/property",
    badge: "Records",
    badgeColor: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    features: ["Ownership lookups", "Value assessments", "Tax & sales history"],
  },
  {
    icon: Clock,
    title: "Scrape Schedules",
    description: "Set up automated scraping schedules to monitor permits on a recurring basis. Get fresh data without lifting a finger — daily, weekly, or custom intervals.",
    gradient: "from-violet-500/20 to-purple-500/20",
    border: "border-violet-500/20",
    link: "/schedules",
    badge: "Automation",
    badgeColor: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    features: ["Recurring schedules", "Auto-scrape new permits", "Custom intervals"],
  },
  {
    icon: FileText,
    title: "Search History",
    description: "Every search you run is saved with full results. Revisit past queries, track permit status changes over time, and build your own research database.",
    gradient: "from-rose-500/20 to-pink-500/20",
    border: "border-rose-500/20",
    link: "/history",
    badge: "History",
    badgeColor: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    features: ["Full result archives", "Status change tracking", "Export capabilities"],
  },
];

const pipeline = [
  { step: "01", title: "Search Any Address or Parcel", desc: "Enter an address, parcel number, or permit number. Our engine queries every relevant permit database in the county simultaneously — no more visiting government websites one at a time.", icon: Search, color: "from-[#4A6CF7] to-[#3B5DE7]" },
  { step: "02", title: "Get Unified Results", desc: "Results from multiple databases are deduplicated and presented in a clean, searchable format. See permit type, status, contractor, dates, and full details at a glance.", icon: Layers, color: "from-[#F59E0B] to-[#D97706]" },
  { step: "03", title: "Act on the Data", desc: "Use permit data to find new customers, verify competitor activity, track construction trends in your market, or check property history before bidding a job.", icon: Target, color: "from-[#14B8A6] to-[#0D9488]" },
];

const useCases = [
  { icon: HardHat, color: "text-amber-400", title: "Find New Customers", desc: "Homeowners pulling permits need contractors. Be the first to reach them." },
  { icon: Eye, color: "text-blue-400", title: "Track Competitor Activity", desc: "See what your competitors are building, where, and for whom." },
  { icon: DollarSign, color: "text-emerald-400", title: "Verify Before You Bid", desc: "Check permit history and property records before committing to a job." },
  { icon: TrendingUp, color: "text-violet-400", title: "Spot Market Trends", desc: "New construction hotspots emerge in permit data months before they're obvious." },
  { icon: Shield, color: "text-teal-400", title: "Protect Your License", desc: "Verify that properties have proper permits before taking on renovation work." },
  { icon: Users, color: "text-pink-400", title: "Grow Your Territory", desc: "Explore permit activity in neighboring counties to expand your service area." },
];

export default function PermitsLandingPage() {
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY < 50) {
        setNavVisible(true);
      } else if (currentY > lastScrollY.current) {
        setNavVisible(false);
      } else {
        setNavVisible(true);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#1a2035] text-foreground dark:text-white overflow-x-hidden">
      <PermitsAnimatedBackground />
      <PermitsFloatingOrbs />

      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#1e2a4a] backdrop-blur-xl border-b border-white/5 ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/landing" data-testid="link-permits-home">
            <CHLogo height={40} />
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/70">
            <a href="#tools" className="hover:text-white transition-colors" data-testid="link-nav-tools">Tools</a>
            <a href="#how-it-works" className="hover:text-white transition-colors" data-testid="link-nav-how">How It Works</a>
            <a href="#use-cases" className="hover:text-white transition-colors" data-testid="link-nav-cases">Use Cases</a>
            <a href="#get-started" className="hover:text-white transition-colors" data-testid="link-nav-start">Get Started</a>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <Link href="/settings">
              <button className="hidden sm:inline-flex items-center justify-center rounded-md h-9 w-9 text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <Settings className="h-4 w-4" />
              </button>
            </Link>
            <div className="text-white"><CartSheet /></div>
            <div className="text-white"><ThemeToggle /></div>
            {user ? (
              <Link href="/" data-testid="link-nav-search">
                <Button size="sm" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white shadow-lg shadow-blue-500/25">
                  <Search className="h-3.5 w-3.5 mr-1.5" /> Search Permits
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth" data-testid="link-permits-signin">
                  <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-permits-getstarted">
                  <Button size="sm" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white shadow-lg shadow-blue-500/25">
                    Get Started <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="relative z-10 pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="animate-in">
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-[#4A6CF7] to-[#F59E0B] flex items-center justify-center mx-auto mb-6 animate-float">
              <HardHat className="h-9 w-9 text-white" />
            </div>
          </div>
          <div className="animate-in-delay-1">
            <Badge className="mb-6 bg-[#4A6CF7]/10 text-[#4A6CF7] border-[#4A6CF7]/20 px-4 py-1.5 text-sm" data-testid="badge-hero">
              <Database className="h-3.5 w-3.5 mr-1.5" /> Nationwide Permit Database for Contractors
            </Badge>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-2" data-testid="text-hero-title">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/60 dark:from-white dark:via-white dark:to-white/60 bg-clip-text text-transparent">
              Every Permit.
            </span>
            <br />
            <span className="bg-gradient-to-r from-[#4A6CF7] via-[#F59E0B] to-[#14B8A6] bg-clip-text text-transparent animate-gradient-text">
              Every County. One Search.
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground dark:text-white/50 max-w-2xl mx-auto leading-relaxed animate-in-delay-3">
            Stop visiting dozens of government websites to find permits. Construction Hub aggregates
            permit databases from all 50 states into one powerful search engine — built specifically
            for contractors who need permit data to find customers, track competitors, and grow their business.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-4">
            <Link href={user ? "/" : "/auth?mode=signup"} data-testid="link-hero-search">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-8 h-12 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                <Search className="h-4 w-4 mr-2" /> Search Permits Now <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <a href="#tools" data-testid="link-hero-explore">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-12 text-base">
                <Database className="h-4 w-4 mr-2" /> Explore the Platform
              </Button>
            </a>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground dark:text-white/40 animate-in-delay-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> All 50 states covered
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> 32,864+ permit portals indexed
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Property records included
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-amber-400" /> Automated scrape schedules
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 bg-amber-500/10 text-amber-400 border-amber-500/20">
              <BarChart3 className="h-3 w-3 mr-1" /> By the Numbers
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              The Most Comprehensive
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#F59E0B] bg-clip-text text-transparent"> Permit Platform</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {stats.map((stat, i) => (
              <Card key={stat.label} className={`bg-muted/50 dark:bg-white/[0.03] border-border dark:border-white/[0.06] p-6 text-center backdrop-blur-sm animate-in-delay-${i + 1}`} data-testid={`card-stat-${i}`}>
                <div className="text-3xl sm:text-4xl font-extrabold text-foreground dark:text-white">
                  <CountUp end={stat.value} suffix={stat.suffix} />
                </div>
                <p className="text-sm text-muted-foreground dark:text-white/60 mt-1 font-medium">{stat.label}</p>
                <p className="text-[10px] text-muted-foreground dark:text-white/30 mt-0.5">{stat.sub}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-amber-50/50 border-slate-200/80 p-8 sm:p-12" data-testid="card-value-prop">
            <div className="relative z-10">
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3 text-slate-900">
                  Why Permit Data Is
                  <span className="text-[#F59E0B]"> Gold for Contractors</span>
                </h2>
                <p className="text-slate-600 max-w-2xl mx-auto text-sm leading-relaxed">
                  Most contractors don't realize that construction permits are public records — and they contain exactly the information you need to grow your business.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-[#4A6CF7] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Landmark className="h-4 w-4" /> What Permits Reveal
                  </h3>
                  {[
                    "Homeowners planning major renovations",
                    "New construction projects in your area",
                    "Which contractors are winning the work",
                    "Property values and ownership details",
                    "Building code compliance history",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#4A6CF7] shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-[#F59E0B] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> How Smart Contractors Use It
                  </h3>
                  {[
                    "Reach homeowners before competitors do",
                    "Verify properties before bidding jobs",
                    "Track construction trends by neighborhood",
                    "Identify commercial development opportunities",
                    "Build a pipeline of warm leads every week",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="tools" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-muted dark:bg-white/5 text-muted-foreground dark:text-white/60 border-border dark:border-white/10">Complete Platform</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Everything You Need to
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#14B8A6] bg-clip-text text-transparent"> Leverage Permit Data</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              From searching and browsing to scheduling and tracking — a complete toolkit for construction professionals.
            </p>
          </div>
          <div className="space-y-5">
            {tools.map((tool, i) => (
              <Link key={tool.title} href={user ? tool.link : "/auth?mode=signup"}>
                <Card
                  className={`group bg-muted/50 dark:bg-white/[0.02] ${tool.border} hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm cursor-pointer animate-in-delay-${Math.min(i + 1, 5)}`}
                  data-testid={`card-tool-${i}`}
                >
                  <div className="flex flex-col sm:flex-row items-start gap-5">
                    <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                      <tool.icon className="h-7 w-7 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="text-lg font-semibold">{tool.title}</h3>
                        <Badge className={`${tool.badgeColor} text-[10px] px-2 py-0`}>{tool.badge}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed mb-3">{tool.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {tool.features.map(f => (
                          <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-white/50">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground dark:text-white/20 group-hover:text-foreground/60 dark:group-hover:text-white/60 group-hover:translate-x-1 transition-all mt-1 shrink-0 hidden sm:block" />
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
            <Badge className="mb-4 bg-[#14B8A6]/10 text-[#14B8A6] border-[#14B8A6]/20">
              <Zap className="h-3 w-3 mr-1" /> How It Works
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              From Search to
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#14B8A6] bg-clip-text text-transparent"> Actionable Intelligence</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              Three steps to turn public permit records into business growth.
            </p>
          </div>
          <div className="space-y-6">
            {pipeline.map((item, i) => (
              <Card
                key={item.step}
                className={`bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] p-6 backdrop-blur-sm animate-in-delay-${i + 1}`}
                data-testid={`card-pipeline-${item.step}`}
              >
                <div className="flex items-start gap-5">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shrink-0`}>
                    <item.icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs font-bold text-muted-foreground dark:text-white/30 tracking-widest">STEP {item.step}</span>
                    </div>
                    <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground dark:text-white/50 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="text-center mt-8 animate-in-delay-4">
            <Link href={user ? "/" : "/auth?mode=signup"} data-testid="link-pipeline-cta">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-8 h-12 shadow-lg shadow-blue-500/25">
                <Search className="h-4 w-4 mr-2" /> Try It Now — Free
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="use-cases" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-violet-500/10 text-violet-400 border-violet-500/20">
              <Target className="h-3 w-3 mr-1" /> Use Cases
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              How Contractors Use
              <span className="bg-gradient-to-r from-[#F59E0B] to-[#14B8A6] bg-clip-text text-transparent"> Permit Data to Win</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-2xl mx-auto">
              Permit records aren't just paperwork — they're a roadmap to your next customer.
              Here's how the smartest contractors use this data every day.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {useCases.map((item, i) => (
              <Card
                key={item.title}
                className={`bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] p-5 backdrop-blur-sm hover:border-border dark:hover:border-white/[0.12] transition-all duration-300 hover:-translate-y-1 animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-usecase-${i}`}
              >
                <item.icon className={`h-6 w-6 ${item.color} mb-3`} />
                <h3 className="text-sm font-bold mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground dark:text-white/40 leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#14B8A6]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#4A6CF7]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-comparison">
            <div className="absolute inset-0 bg-gradient-to-r from-[#14B8A6]/5 to-[#4A6CF7]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                  Manual Research vs.
                  <span className="text-[#14B8A6]"> Construction Hub</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> The Old Way
                  </h3>
                  {[
                    "Visit each county website individually",
                    "Different search interfaces everywhere",
                    "No way to track changes over time",
                    "Hours wasted navigating clunky portals",
                    "Miss permits from neighboring counties",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-[#14B8A6] uppercase tracking-wider mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> With Construction Hub
                  </h3>
                  {[
                    "One search across all databases",
                    "Unified interface for every county",
                    "Automated schedules track new permits",
                    "Results in seconds, not hours",
                    "Property records and ownership included",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#14B8A6] shrink-0" />
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
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-[#4A6CF7] to-[#F59E0B] flex items-center justify-center mx-auto mb-6 animate-float">
            <HardHat className="h-11 w-11 text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4" data-testid="text-final-cta">
            Ready to Turn Permits
            <br />
            <span className="bg-gradient-to-r from-[#4A6CF7] via-[#F59E0B] to-[#14B8A6] bg-clip-text text-transparent">
              Into Customers?
            </span>
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-8 max-w-lg mx-auto">
            Join contractors across all 50 states who use Construction Hub to find new business,
            track their market, and stay ahead of the competition — all from public permit data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? "/" : "/auth?mode=signup"} data-testid="link-final-search">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5DE7] text-white px-10 h-13 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                Search Permits Free <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href={user ? "/databases" : "/auth?mode=signup"} data-testid="link-final-directory">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-13 text-base">
                <Database className="h-4 w-4 mr-2" /> Browse the Directory
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.05] py-10 px-4 sm:px-6 lg:px-8 bg-[#1e2a4a]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <CHLogo height={30} className="opacity-60" />
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/40">
              <a href="mailto:support@constructhub.us" className="hover:text-white/70 transition-colors" data-testid="link-footer-email">support@constructhub.us</a>
              <span className="text-white/20">|</span>
              <a href="/terms" className="hover:text-white/70 transition-colors" data-testid="link-footer-terms">Terms of Use</a>
              <span className="text-white/20">|</span>
              <a href="/privacy" className="hover:text-white/70 transition-colors" data-testid="link-footer-privacy">Privacy Policy</a>
            </div>
            <p className="text-xs text-white/20">&copy; 2025 Construction Hub. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
