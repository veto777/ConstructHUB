import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import {
  ArrowRight, Search, Shield, Eye, CheckCircle2,
  Zap, ChevronRight, TrendingUp, Users, DollarSign,
  BarChart3, AlertTriangle, Globe, Star, MapPin,
  Target, Crosshair, Bot, Megaphone, ThumbsDown,
  UserX, Ban, Flag, Monitor, Smartphone, Camera,
  MessageSquare, Award, Gauge, Fingerprint, Settings,
} from "lucide-react";

function CompetitorAnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [darkBg, setDarkBg] = useState(document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const colors = [
      { h: 45, s: 93, l: 52 },
      { h: 227, s: 71, l: 57 },
      { h: 0, s: 72, l: 56 },
    ];
    let particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; colorIdx: number;
    }> = [];

    let isDark = document.documentElement.classList.contains('dark');
    const observer = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
      setDarkBg(isDark);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

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
      const opacityMult = isDark ? 1 : 0.3;
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        const c = colors[p.colorIdx];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${p.opacity * opacityMult})`;
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
            ctx.strokeStyle = `hsla(45, 93%, 52%, ${0.04 * opacityMult * (1 - dist / 120)})`;
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
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: darkBg ? "linear-gradient(135deg, #1a2035 0%, #1f1a10 30%, #182030 60%, #1a2035 100%)" : "transparent" }}
    />
  );
}

function CompetitorFloatingOrbs() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="landing-orb" style={{ width: 500, height: 500, background: "radial-gradient(circle, #EAB308, transparent 70%)", top: -150, right: -150, animationDelay: "0s" }} />
      <div className="landing-orb" style={{ width: 400, height: 400, background: "radial-gradient(circle, #4A6CF7, transparent 70%)", bottom: -100, left: -100, animationDelay: "-7s" }} />
      <div className="landing-orb" style={{ width: 350, height: 350, background: "radial-gradient(circle, #EF4444, transparent 70%)", top: "40%", right: -100, animationDelay: "-14s" }} />
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
  { value: 20, suffix: "+", label: "Industries Covered", sub: "Roofing, HVAC, plumbing & more" },
  { value: 100, suffix: "+", label: "Competitors Per Scan", sub: "Complete market indexing" },
  { value: 85, suffix: "%", label: "Fake Review Detection", sub: "Our BS Meter catches fraud" },
  { value: 24, suffix: "/7", label: "Ad Monitoring", sub: "Track competitor campaigns" },
];

const tools = [
  {
    icon: Search,
    title: "Market Scan",
    description: "Enter your industry and location. We index every competitor within your radius — their Google rankings, reviews, website, phone, hours, and more. See your entire competitive landscape in one view.",
    gradient: "from-yellow-500/20 to-amber-500/20",
    border: "border-yellow-500/20",
    badge: "Core",
    badgeColor: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    features: ["Industry + location targeting", "Up to 100-mile radius", "Full business profile data"],
  },
  {
    icon: Star,
    title: "Review Analysis & BS Meter",
    description: "Our proprietary BS Meter scores every competitor's reviews on a 0-100 scale. We detect patterns of fake reviews — sudden spikes, generic language, reviewer patterns — so you can see who's honest and who's buying reviews.",
    gradient: "from-red-500/20 to-rose-500/20",
    border: "border-red-500/20",
    badge: "Exclusive",
    badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
    features: ["Fake review pattern detection", "0-100 BS score per business", "Review timeline analysis"],
  },
  {
    icon: Megaphone,
    title: "Ad Spy",
    description: "Monitor what Google Ads your competitors are running. See their actual ad headlines, descriptions, and the keywords they're bidding on. Track their campaigns across desktop, mobile, and tablet.",
    gradient: "from-blue-500/20 to-indigo-500/20",
    border: "border-blue-500/20",
    badge: "Intelligence",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    features: ["Live ad capture", "Keyword tracking", "Device-specific monitoring"],
  },
  {
    icon: BarChart3,
    title: "Competitor Profiles",
    description: "Deep-dive into any competitor's profile. See their rating, review count, categories, website, photos, hours, and whether they're verified. Compare side-by-side with your own business.",
    gradient: "from-emerald-500/20 to-teal-500/20",
    border: "border-emerald-500/20",
    badge: "Analysis",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    features: ["Side-by-side comparison", "Rating & review trends", "Photo & profile audits"],
  },
  {
    icon: Flag,
    title: "Market Reports",
    description: "Get a complete market overview — average rating, total competitors, review distribution, and where you stand. Understand your market position and identify gaps you can exploit.",
    gradient: "from-violet-500/20 to-purple-500/20",
    border: "border-violet-500/20",
    badge: "Reports",
    badgeColor: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    features: ["Market positioning", "Competitor density maps", "Opportunity identification"],
  },
];

const pipeline = [
  { step: "01", title: "Scan Your Market", desc: "Select your industry (roofing, HVAC, plumbing, etc.) and enter your location. Our system queries Google to find every competitor within your specified radius — 10, 25, 50, or 100 miles.", icon: Search, color: "from-[#EAB308] to-[#CA8A04]" },
  { step: "02", title: "Analyze the Competition", desc: "We pull full profiles for every competitor — ratings, reviews, photos, website, hours, categories. Our BS Meter scores their reviews to detect fakes. Ad Spy captures their live Google Ads campaigns.", icon: Eye, color: "from-[#4A6CF7] to-[#3B5DE7]" },
  { step: "03", title: "Outmaneuver Everyone", desc: "Use competitor insights to craft better ads, target underserved areas, improve your reviews strategy, and position your business where the competition is weakest. Knowledge is the ultimate competitive advantage.", icon: Target, color: "from-[#EF4444] to-[#DC2626]" },
];

const insights = [
  { icon: ThumbsDown, color: "text-red-400", title: "Competitors Buying Reviews", desc: "Our BS Meter detects sudden review spikes, generic language patterns, and suspicious reviewer profiles that indicate fake reviews." },
  { icon: Megaphone, color: "text-blue-400", title: "What Ads They're Running", desc: "See the exact headlines, descriptions, and keywords your competitors bid on. Know their strategy before they know yours." },
  { icon: MapPin, color: "text-emerald-400", title: "Underserved Areas", desc: "Identify neighborhoods and zip codes where competitors have low density — the easiest markets to dominate." },
  { icon: Star, color: "text-yellow-400", title: "Reputation Gaps", desc: "Find competitors with low ratings or few reviews. These are the businesses you can easily outrank and steal customers from." },
  { icon: DollarSign, color: "text-violet-400", title: "Pricing Intelligence", desc: "Compare competitor positioning, service offerings, and how they present themselves. Spot pricing gaps you can exploit." },
  { icon: Camera, color: "text-pink-400", title: "Profile Weaknesses", desc: "Competitors with no photos, incomplete profiles, or outdated hours are vulnerable. See exactly where they're dropping the ball." },
];

export default function CompetitorsLandingPage() {
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
      <CompetitorAnimatedBackground />
      <CompetitorFloatingOrbs />

      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#1e2a4a] ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/landing" data-testid="link-competitors-home">
            <CHLogo height={40} />
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/70">
            <a href="#tools" className="hover:text-white transition-colors" data-testid="link-nav-tools">Tools</a>
            <a href="#how-it-works" className="hover:text-white transition-colors" data-testid="link-nav-how">How It Works</a>
            <a href="#insights" className="hover:text-white transition-colors" data-testid="link-nav-insights">Insights</a>
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
              <Link href="/competitors" data-testid="link-nav-intel">
                <Button size="sm" className="bg-[#EAB308] hover:bg-[#CA8A04] text-black shadow-lg shadow-yellow-500/25">
                  <Eye className="h-3.5 w-3.5 mr-1.5" /> Open Intel Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth" data-testid="link-competitors-signin">
                  <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-competitors-getstarted">
                  <Button size="sm" className="bg-[#EAB308] hover:bg-[#CA8A04] text-black shadow-lg shadow-yellow-500/25">
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
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-[#EAB308] to-[#EF4444] flex items-center justify-center mx-auto mb-6 animate-float">
              <Eye className="h-9 w-9 text-white" />
            </div>
          </div>
          <div className="animate-in-delay-1">
            <Badge className="mb-6 bg-[#EAB308]/10 text-[#EAB308] border-[#EAB308]/20 px-4 py-1.5 text-sm" data-testid="badge-hero">
              <Shield className="h-3.5 w-3.5 mr-1.5" /> Platinum-Tier Competitive Intelligence
            </Badge>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-2" data-testid="text-hero-title">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/60 dark:from-white dark:via-white dark:to-white/60 bg-clip-text text-transparent">
              Know Everything
            </span>
            <br />
            <span className="bg-gradient-to-r from-[#EAB308] via-[#EF4444] to-[#4A6CF7] bg-clip-text text-transparent animate-gradient-text">
              About Your Competition.
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground dark:text-white/50 max-w-2xl mx-auto leading-relaxed animate-in-delay-3">
            Stop guessing what your competitors are doing. Scan your entire market, analyze every
            competitor's reviews with our BS Meter, spy on their Google Ads, and find the gaps
            in your market that nobody else sees.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-4">
            <Link href={user ? "/competitors" : "/auth?mode=signup"} data-testid="link-hero-scan">
              <Button size="lg" className="bg-[#EAB308] hover:bg-[#CA8A04] text-black px-8 h-12 text-base shadow-2xl shadow-yellow-500/30 landing-glow-btn">
                <Search className="h-4 w-4 mr-2" /> Scan Your Market <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <a href="#tools" data-testid="link-hero-explore">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-12 text-base">
                <Eye className="h-4 w-4 mr-2" /> See What You Get
              </Button>
            </a>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground dark:text-white/40 animate-in-delay-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-yellow-400" /> 20+ industries supported
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-yellow-400" /> BS Meter fake review detection
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-yellow-400" /> Live Google Ads spy
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-red-400" /> Platinum exclusive
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 bg-red-500/10 text-red-400 border-red-500/20">
              <BarChart3 className="h-3 w-3 mr-1" /> By the Numbers
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Complete Market
              <span className="bg-gradient-to-r from-[#EAB308] to-[#EF4444] bg-clip-text text-transparent"> Visibility</span>
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
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#EAB308]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#EF4444]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-value-prop">
            <div className="absolute inset-0 bg-gradient-to-r from-[#EAB308]/5 to-[#EF4444]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
                  Why Most Contractors
                  <span className="text-[#EAB308]"> Lose to the Competition</span>
                </h2>
                <p className="text-muted-foreground dark:text-white/50 max-w-2xl mx-auto text-sm leading-relaxed">
                  Your competitors know more about you than you know about them. They're watching your ads, studying your reviews, and targeting your customers. Without intelligence, you're fighting blind.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Without Intel
                  </h3>
                  {[
                    "No idea what competitors are bidding on",
                    "Can't tell if their reviews are real or fake",
                    "Don't know which markets are underserved",
                    "Wasting ads budget on saturated keywords",
                    "Losing jobs to contractors with fake reputations",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-[#EAB308] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4" /> With Competitor Intel
                  </h3>
                  {[
                    "See every ad your competitors are running",
                    "BS Meter exposes fake review patterns",
                    "Identify gaps and underserved neighborhoods",
                    "Target keywords competitors aren't using",
                    "Build a real reputation that beats the fakers",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#EAB308] shrink-0" />
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
            <Badge className="mb-4 bg-muted dark:bg-white/5 text-muted-foreground dark:text-white/60 border-border dark:border-white/10">Complete Intelligence Suite</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Every Tool You Need to
              <span className="bg-gradient-to-r from-[#EAB308] to-[#4A6CF7] bg-clip-text text-transparent"> Dominate Your Market</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              From scanning and profiling to ad monitoring and reporting — a complete competitive intelligence platform.
            </p>
          </div>
          <div className="space-y-5">
            {tools.map((tool, i) => (
              <Card
                key={tool.title}
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
                          <CheckCircle2 className="h-3 w-3 text-yellow-400 shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground dark:text-white/20 group-hover:text-foreground/60 dark:group-hover:text-white/60 group-hover:translate-x-1 transition-all mt-1 shrink-0 hidden sm:block" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-[#4A6CF7]/10 text-[#4A6CF7] border-[#4A6CF7]/20">
              <Zap className="h-3 w-3 mr-1" /> How It Works
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              From Blind Spot to
              <span className="bg-gradient-to-r from-[#EAB308] to-[#EF4444] bg-clip-text text-transparent"> Full Visibility</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              Three steps to know everything about every competitor in your market.
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
            <Link href={user ? "/competitors" : "/auth?mode=signup"} data-testid="link-pipeline-cta">
              <Button size="lg" className="bg-[#EAB308] hover:bg-[#CA8A04] text-black px-8 h-12 shadow-lg shadow-yellow-500/25">
                <Search className="h-4 w-4 mr-2" /> Start Your First Scan
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#EF4444]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#EAB308]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-bs-meter">
            <div className="relative z-10">
              <div className="text-center mb-8">
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[#EF4444] to-[#EAB308] flex items-center justify-center mx-auto mb-4">
                  <Gauge className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
                  The
                  <span className="text-[#EF4444]"> BS Meter</span>
                </h2>
                <p className="text-muted-foreground dark:text-white/50 max-w-xl mx-auto text-sm leading-relaxed">
                  Our proprietary algorithm analyzes every competitor's reviews to detect fraud.
                  Fake reviews are a massive problem in the contractor space — and we expose them.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { score: "0-30", label: "Organic", color: "text-emerald-400", bg: "bg-emerald-500/10", desc: "Reviews appear legitimate and naturally accumulated over time" },
                  { score: "30-60", label: "Moderate Risk", color: "text-yellow-400", bg: "bg-yellow-500/10", desc: "Some suspicious patterns detected — sudden spikes or generic language" },
                  { score: "60-100", label: "High Risk", color: "text-red-400", bg: "bg-red-500/10", desc: "Strong indicators of purchased or fake reviews — proceed with caution" },
                ].map((tier, i) => (
                  <div key={tier.score} className={`${tier.bg} rounded-xl p-5 border border-border dark:border-white/[0.06]`} data-testid={`bs-tier-${i}`}>
                    <div className={`text-2xl font-extrabold ${tier.color} mb-1`}>{tier.score}</div>
                    <div className={`text-sm font-bold ${tier.color} mb-2`}>{tier.label}</div>
                    <p className="text-xs text-muted-foreground dark:text-white/40 leading-relaxed">{tier.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="insights" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-violet-500/10 text-violet-400 border-violet-500/20">
              <Crosshair className="h-3 w-3 mr-1" /> Strategic Intel
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              What You'll
              <span className="bg-gradient-to-r from-[#EAB308] to-[#4A6CF7] bg-clip-text text-transparent"> Discover</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-2xl mx-auto">
              Every scan reveals insights your competitors don't want you to know.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((item, i) => (
              <Card
                key={item.title}
                className={`bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] p-5 backdrop-blur-sm hover:border-border dark:hover:border-white/[0.12] transition-all duration-300 hover:-translate-y-1 animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-insight-${i}`}
              >
                <item.icon className={`h-6 w-6 ${item.color} mb-3`} />
                <h3 className="text-sm font-bold mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground dark:text-white/40 leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="get-started" className="relative z-10 py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-[#EAB308] to-[#EF4444] flex items-center justify-center mx-auto mb-6 animate-float">
            <Eye className="h-11 w-11 text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4" data-testid="text-final-cta">
            Ready to Own
            <br />
            <span className="bg-gradient-to-r from-[#EAB308] via-[#EF4444] to-[#4A6CF7] bg-clip-text text-transparent">
              Your Entire Market?
            </span>
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-8 max-w-lg mx-auto">
            Competitor Intelligence is available exclusively to Platinum members.
            Get the unfair advantage that separates market leaders from everyone else.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? "/competitors" : "/pricing"} data-testid="link-final-scan">
              <Button size="lg" className="bg-[#EAB308] hover:bg-[#CA8A04] text-black px-10 h-13 text-base shadow-2xl shadow-yellow-500/30 landing-glow-btn">
                Start Scanning Now <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href="/pricing" data-testid="link-final-pricing">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-13 text-base">
                <DollarSign className="h-4 w-4 mr-2" /> View Platinum Pricing
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
