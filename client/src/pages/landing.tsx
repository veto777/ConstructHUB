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
  ArrowRight, Search, Camera, BarChart3, Shield, Users, Zap,
  MapPin, Phone, Building2, CheckCircle2, Star, TrendingUp,
  Clock, Eye, FileText, Globe, LayoutDashboard, GraduationCap,
  Grid3X3, ShieldAlert, Crosshair, Link2, Monitor, Briefcase,
  Megaphone, Package,
} from "lucide-react";
import { SHOW_COMPETITOR_INTEL } from "@/lib/features";
import { GROWTH_TOOLS } from "@/lib/growth-tools";
import { BRAND_NAME, copyrightNotice, formatCount, usePermitDirectoryCounts } from "@/lib/marketing";
import { LandingMobileMenu } from "@/components/landing-mobile-menu";

const SECTION_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#consulting", label: "Consulting" },
  { href: "#stats", label: "Results" },
  { href: "#coverage", label: "Coverage" },
] as const;

function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; hue: number;
    }> = [];

    let isDark = document.documentElement.classList.contains('dark');

    const observer = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.4 + 0.1,
        hue: Math.random() > 0.5 ? 228 : 28,
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

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 91%, 63%, ${p.opacity * opacityMultiplier})`;
        ctx.fill();

        particles.forEach((p2, j) => {
          if (j <= i) return;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `hsla(228, 91%, 63%, ${0.06 * (1 - dist / 150) * opacityMultiplier})`;
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
      className="fixed inset-0 z-0 pointer-events-none dark:block"
      style={{ background: "transparent" }}
    />
  );
}

function FloatingOrbs() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="landing-orb landing-orb-1" />
      <div className="landing-orb landing-orb-2" />
      <div className="landing-orb landing-orb-3" />
    </div>
  );
}

function CountUp({ end, suffix = "", duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
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

  return <span ref={ref}>{count.toLocaleString("en-US")}{suffix}</span>;
}

const services = [
  {
    icon: Search,
    title: "Nationwide Permit Search",
    description: "Find the permit office for any county or city we list in all 50 states and DC, and search the government portals we support by address, contractor, or company name.",
    gradient: "from-orange-500/20 to-amber-500/20",
    border: "border-orange-500/20",
  },
  {
    icon: Camera,
    title: "SEO Photo Optimizer",
    description: "Watermark, rename, geotag and describe your job photos in one batch. Google strips EXIF on upload, so geotags don't promise a ranking benefit.",
    gradient: "from-blue-500/20 to-indigo-500/20",
    border: "border-blue-500/20",
  },
  {
    icon: Eye,
    title: "GMB Monitor",
    description: "Check your Google Business listings against Google on demand and keep a history of every change a check finds. Includes AI Review Response Generator.",
    gradient: "from-purple-500/20 to-violet-500/20",
    border: "border-purple-500/20",
  },
  {
    icon: Grid3X3,
    title: "GMB Ranking Grid",
    description: "Visualize exactly where you rank on Google Maps across your service area. Monitor local keyword performance with a geographic heatmap grid.",
    gradient: "from-emerald-500/20 to-teal-500/20",
    border: "border-emerald-500/20",
  },
  {
    icon: MapPin,
    title: "GMB Locations Manager",
    description: "Manage all your business locations with Semrush-style GBP analytics — search/maps views, interactions, phone calls, and citation campaign tracking.",
    gradient: "from-pink-500/20 to-rose-500/20",
    border: "border-pink-500/20",
  },
  {
    icon: ShieldAlert,
    title: "GBP Reinstatement",
    description: "Suspended Google Business Profile? Our reinstatement service handles soft and hard suspensions with a proven 4-step recovery process.",
    gradient: "from-red-500/20 to-orange-500/20",
    border: "border-red-500/20",
  },
  {
    icon: Crosshair,
    title: "Competitor Intelligence",
    description: "Analyze competitors in your market. Track their permit activity, ranking positions, and business moves so you always stay one step ahead.",
    gradient: "from-amber-500/20 to-yellow-500/20",
    border: "border-amber-500/20",
  },
  {
    icon: GraduationCap,
    title: "Master Class",
    description: "Complete state-by-state guide to starting a construction business — LLC formation, licensing, bonding, insurance, plus website & SEO training.",
    gradient: "from-indigo-500/20 to-blue-500/20",
    border: "border-indigo-500/20",
  },
  {
    icon: Users,
    title: "Expert Consulting",
    description: "Platinum members work 1-on-1 with industry consultants who specialize in construction. Get personalized strategies for SEO, GMB, lead generation, and scaling.",
    gradient: "from-cyan-500/20 to-sky-500/20",
    border: "border-cyan-500/20",
  },
];

// Testimonials were removed: the three 5-star quotes came in with the Replit
// import (the same one whose government data was fabricated) and nobody could
// vouch for them. Add quotes back only with a real, consenting customer.

export default function LandingPage() {
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const { data: counts } = usePermitDirectoryCounts();
  const hasVerified = typeof counts?.verifiedPortals === "number";
  const stats: { value: number | undefined; suffix?: string; label: string }[] = [
    { value: counts?.total, label: "Jurisdictions Listed" },
    hasVerified
      ? { value: counts?.verifiedPortals, label: "Verified Portal Links" }
      : { value: counts?.county, label: "County Offices Listed" },
    { value: 51, label: "States + DC Listed" },
    { value: GROWTH_TOOLS.length, label: "Pro Tools Built In" },
  ];

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
    <div className="min-h-screen bg-white dark:bg-[#1a2035] text-foreground dark:text-white overflow-x-clip">
      <AnimatedBackground />
      <FloatingOrbs />

      {/* Nav */}
      <nav className={`sticky top-0 z-50 transition-all duration-300 bg-[#1e2a4a] backdrop-blur-xl border-b border-white/5 ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <CHLogo height={40} />
          <div className="hidden md:flex items-center gap-6 text-sm text-white/70">
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white transition-colors" data-testid={`link-nav-${link.href.slice(1)}`}>{link.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            {user && (
              <Link href="/settings">
                <button className="hidden sm:inline-flex items-center justify-center rounded-md h-9 w-9 text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                  <Settings className="h-4 w-4" />
                </button>
              </Link>
            )}
            <div className="text-white"><CartSheet /></div>
            <div className="text-white hidden sm:block"><ThemeToggle /></div>
            {user ? (
              <Link href="/" data-testid="link-nav-dashboard">
                <Button size="sm" className="bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white shadow-lg shadow-blue-500/25">
                  <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" /> Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth" className="hidden sm:block" data-testid="link-nav-signin">
                  <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-nav-getstarted">
                  <Button size="sm" className="bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white shadow-lg shadow-blue-500/25">
                    Get Started <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              </>
            )}
            <LandingMobileMenu signInHref={user ? undefined : "/auth"} links={[...SECTION_LINKS]} />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 pt-16 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="animate-in">
            <Badge className="mb-6 bg-blue-500/10 text-blue-400 border-blue-500/20 px-4 py-1.5 text-sm">
              <Zap className="h-3.5 w-3.5 mr-1.5" /> Your Complete Business-Building Platform
            </Badge>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-1">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/60 dark:from-white dark:via-white dark:to-white/60 bg-clip-text text-transparent">
              Construct<span className="font-extrabold">HUB</span> —
            </span>
            <br />
            <span className="bg-gradient-to-r from-[#4A6CF7] via-[#6B8CFF] to-[#F07C22] bg-clip-text text-transparent">
              Build Your Business From the Ground Up
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground dark:text-white/50 max-w-2xl mx-auto leading-relaxed animate-in-delay-2">
            Whether you're starting from scratch or scaling an existing operation — we provide every tool, resource, and service you need. From LLC formation and licensing to GMB optimization and SEO domination. And if you don't want to do it yourself, we'll build your entire business for you.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-3">
            <Link href="/auth?mode=signup" data-testid="link-hero-signup">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white px-8 h-12 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                Create a Free Account <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href="/free-site-scan" className="underline font-semibold">Free 60-second website scan</Link>
            <Link href="/pricing#done-for-you" data-testid="link-hero-dfy">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white hover:bg-muted dark:hover:bg-white/10 px-8 h-12 text-base">
                <Package className="h-4 w-4 mr-2" /> Done-For-You Services
              </Button>
            </Link>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground dark:text-white/40 animate-in-delay-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> No card needed to sign up
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Setup in minutes
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Cancel anytime
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-orange-400" /> Turnkey business building available
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section id="stats" className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <Card key={stat.label} className={`bg-muted/50 dark:bg-white/[0.03] border-border dark:border-white/[0.06] p-6 text-center backdrop-blur-sm animate-in-delay-${i + 1}`}>
              <div className="text-3xl sm:text-4xl font-extrabold text-foreground dark:text-white">
                {typeof stat.value === "number" ? <CountUp end={stat.value} suffix={stat.suffix} /> : "—"}
              </div>
              <p className="text-sm text-muted-foreground dark:text-white/50 mt-1">{stat.label}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-muted dark:bg-white/5 text-muted-foreground dark:text-white/60 border-border dark:border-white/10">What We Do</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Everything You Need to Start, Build &
              <span className="bg-gradient-to-r from-[#4A6CF7] to-[#6B8CFF] bg-clip-text text-transparent"> Dominate</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              From forming your LLC to ranking #1 on Google Maps — a full suite of tools and services built by contractors who scaled from solo operators to hundreds of employees.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.filter((svc) => SHOW_COMPETITOR_INTEL || svc.title !== "Competitor Intelligence").map((svc, i) => (
              <Card
                key={svc.title}
                className={`group bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-service-${i}`}
              >
                <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${svc.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <svc.icon className="h-5 w-5 text-foreground dark:text-white" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{svc.title}</h3>
                <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed">{svc.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Done-For-You */}
      <section id="done-for-you" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-orange-500/10 text-orange-400 border-orange-500/20">Turnkey Solutions</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Don't Want to Do It Yourself?
              <span className="bg-gradient-to-r from-[#F07C22] to-[#FFB347] bg-clip-text text-transparent"> We'll Build It For You.</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-2xl mx-auto">
              Our turnkey system handles everything — from filing your LLC to launching your marketing. We process all paperwork, set up your online presence, and get you ready to take jobs. The only thing we can't do is take your licensing exams for you.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            <Card className="group bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm" data-testid="card-dfy-formation">
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Briefcase className="h-5 w-5 text-foreground dark:text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold">Business Formation & Filing</h3>
                    <span className="text-xl font-extrabold text-[#4A6CF7]">$5,500</span>
                  </div>
                  <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed mt-2">LLC, licensing paperwork, bonding, insurance processing, tax registration</p>
                </div>
              </div>
            </Card>
            <Card className="group bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm" data-testid="card-dfy-gmb">
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Globe className="h-5 w-5 text-foreground dark:text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold">GMB & Website Setup</h3>
                    <span className="text-xl font-extrabold text-[#4A6CF7]">$15,000</span>
                  </div>
                  <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed mt-2">Full Google Business Profile, professional website, content</p>
                </div>
              </div>
            </Card>
            <Card className="group bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm" data-testid="card-dfy-seo">
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Megaphone className="h-5 w-5 text-foreground dark:text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold">SEO & Ad Campaigns</h3>
                    <span className="text-xl font-extrabold text-[#4A6CF7]">$7,500</span>
                  </div>
                  <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed mt-2">Local SEO, Google Ads, LSA setup, citation building</p>
                </div>
              </div>
            </Card>
          </div>
          <Card className="relative bg-gradient-to-br from-[#4A6CF7]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#F07C22]/10 border-border dark:border-white/[0.08] p-8 backdrop-blur-sm text-center" data-testid="card-dfy-bundle">
            <div className="absolute inset-0 bg-gradient-to-r from-[#4A6CF7]/5 to-[#F07C22]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="flex items-center justify-center gap-3 mb-3 flex-wrap">
                <h3 className="text-2xl sm:text-3xl font-extrabold">Complete Business Build</h3>
              </div>
              <div className="text-4xl font-extrabold text-foreground dark:text-white mb-3">$29,999</div>
              <p className="text-muted-foreground dark:text-white/40 max-w-xl mx-auto mb-6">
                Everything above as one package. Paid upfront. 4-6 months from start to finish. Excludes licensing exams and prerequisites.
              </p>
              <Link href="/pricing#done-for-you" data-testid="link-dfy-pricing">
                <Button size="lg" className="bg-[#F07C22] hover:bg-[#E06B15] text-white px-8 shadow-lg shadow-orange-500/25">
                  View Full Pricing <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>

      {/* Consulting CTA */}
      <section id="consulting" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#4A6CF7]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#F07C22]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-r from-[#4A6CF7]/5 to-[#F07C22]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10 flex flex-col lg:flex-row items-center gap-8">
              <div className="flex-1 text-center lg:text-left">
                <Badge className="mb-4 bg-orange-500/10 text-orange-400 border-orange-500/20">
                  <Star className="h-3 w-3 mr-1" /> Platinum Benefit
                </Badge>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                  Talk With a Professional
                  <span className="bg-gradient-to-r from-[#F07C22] to-[#FFB347] bg-clip-text text-transparent"> Consultant</span>
                </h2>
                <p className="text-muted-foreground dark:text-white/50 mb-6 leading-relaxed">
                  Our expert consultants specialize in the construction industry. Get personalized 
                  strategies for SEO, Google My Business, lead generation, and scaling your contracting business. 
                  In-person or virtual sessions available.
                </p>
                <div className="flex flex-wrap items-center gap-4 justify-center lg:justify-start mb-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/60">
                    <Clock className="h-4 w-4 text-orange-400" /> 1-on-1 Sessions
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/60">
                    <Shield className="h-4 w-4 text-orange-400" /> Industry Experts
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/60">
                    <TrendingUp className="h-4 w-4 text-orange-400" /> Proven Results
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
                  <div className="text-center sm:text-left">
                    <div className="text-4xl font-extrabold text-foreground dark:text-white">$250<span className="text-lg font-normal text-muted-foreground dark:text-white/40"> first session</span></div>
                    <p className="text-xs text-muted-foreground dark:text-white/30 mt-1" data-testid="text-consulting-terms">
                      Platinum members only · 30 minutes · $500 per session after the first · In-person or virtual
                    </p>
                  </div>
                  <Link href="/pricing" data-testid="link-consulting-book">
                    <Button size="lg" className="bg-[#F07C22] hover:bg-[#E06B15] text-white px-8 shadow-lg shadow-orange-500/25">
                      See the Platinum Plan <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="hidden lg:flex flex-col gap-4 w-64">
                <div className="bg-muted/50 dark:bg-white/[0.04] rounded-xl p-4 border border-border dark:border-white/[0.06]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <Globe className="h-4 w-4 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium">GMB Strategy</p>
                      <p className="text-[10px] text-muted-foreground dark:text-white/40">Optimize your listing</p>
                    </div>
                  </div>
                </div>
                <div className="bg-muted/50 dark:bg-white/[0.04] rounded-xl p-4 border border-border dark:border-white/[0.06]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium">Lead Generation</p>
                      <p className="text-[10px] text-muted-foreground dark:text-white/40">Win more bids</p>
                    </div>
                  </div>
                </div>
                <div className="bg-muted/50 dark:bg-white/[0.04] rounded-xl p-4 border border-border dark:border-white/[0.06]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-8 w-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium">Business Growth</p>
                      <p className="text-[10px] text-muted-foreground dark:text-white/40">Scale operations</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Coverage Map */}
      <section id="coverage" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold tracking-tight mb-3">
            Nationwide <span className="text-[#4A6CF7]">Coverage</span>
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-10 max-w-xl mx-auto" data-testid="text-coverage-summary">
            {counts ? `${formatCount(counts.total)} county and city jurisdictions` : "County and city jurisdictions"} listed
            across all 50 states and DC{hasVerified ? `, ${formatCount(counts!.verifiedPortals!)} with a verified permit portal link` : ""}.
            Every portal link we show is checked, and links we could not confirm are labeled.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[
              "Washington", "Florida", "California", "Texas",
              "New York", "Illinois", "Pennsylvania", "Ohio",
              "Georgia", "North Carolina", "Michigan", "Arizona",
              "Colorado", "Virginia", "Oregon", "Nevada",
              "Tennessee", "New Jersey", "Massachusetts", "Indiana",
            ].map(state => (
              <div key={state} className="flex items-center gap-2 bg-muted/50 dark:bg-white/[0.02] border border-border dark:border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-muted-foreground dark:text-white/50">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" /> {state}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground/50 dark:text-white/25">All 50 states + DC listed &mdash; portal links shown only once checked</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <CHLogo height={80} className="mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
            Ready to Build Your Business?
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-8 max-w-lg mx-auto">
            Use our DIY tools to start and grow at your own pace — or let us build your entire business for you with our done-for-you turnkey services. Either way, {BRAND_NAME} has you covered.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/auth?mode=signup" data-testid="link-cta-signup">
              <Button size="lg" className="bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white px-10 h-13 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                Create Your Free Account <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <a href="#consulting" data-testid="link-cta-consulting">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white hover:bg-muted dark:hover:bg-white/10 px-8 h-13 text-base">
                Talk to an Expert
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
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
            <p className="text-xs text-white/20">{copyrightNotice()}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
