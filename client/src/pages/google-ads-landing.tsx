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
  ArrowRight, Shield, ShieldCheck, ShieldAlert, Zap,
  CheckCircle2, Star, AlertTriangle, GraduationCap,
  MousePointerClick, DollarSign, Ban, Search,
  BarChart3, FileText, MapPin, Target, Eye,
  Fingerprint, Globe, Bot, ChevronRight, Lock,
  TrendingUp, Users, Phone, Megaphone, Settings,
} from "lucide-react";
import googleAdsLogo from "@assets/google-ads-logo.png";

function AdsAnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const googleColors = [
      { h: 217, s: 89, l: 61 },
      { h: 142, s: 53, l: 43 },
      { h: 45, s: 97, l: 55 },
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

    for (let i = 0; i < 70; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.35 + 0.1,
        colorIdx: Math.floor(Math.random() * 3),
      });
    }

    let isDark = document.documentElement.classList.contains('dark');

    const observer = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const opacityMultiplier = isDark ? 1 : 0.3;

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const c = googleColors[p.colorIdx];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${p.opacity * opacityMultiplier})`;
        ctx.fill();

        particles.forEach((p2, j) => {
          if (j <= i) return;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `hsla(217, 89%, 61%, ${0.05 * (1 - dist / 140) * opacityMultiplier})`;
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
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: "transparent" }}
    />
  );
}

function AdsFloatingOrbs() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="landing-orb" style={{ width: 500, height: 500, background: "radial-gradient(circle, #4285F4, transparent 70%)", top: -150, right: -150, animationDelay: "0s" }} />
      <div className="landing-orb" style={{ width: 400, height: 400, background: "radial-gradient(circle, #34A853, transparent 70%)", bottom: -100, left: -100, animationDelay: "-7s" }} />
      <div className="landing-orb" style={{ width: 350, height: 350, background: "radial-gradient(circle, #FBBC05, transparent 70%)", top: "40%", right: -100, animationDelay: "-14s" }} />
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

const fraudStats = [
  { value: 25, suffix: "%+", label: "Clicks Are Fraudulent", sub: "Industry average for contractors" },
  { value: 42, prefix: "$", suffix: "", label: "Average CPC", sub: "Contractor keyword costs" },
  { value: 90, suffix: "%", label: "Lose Money on Ads", sub: "Contractors using default settings" },
  { value: 3, suffix: "x", label: "ROI Improvement", sub: "After proper campaign setup" },
];

const tools = [
  {
    icon: Shield,
    title: "Click Guard",
    description: "Real-time IP tracking and click fraud protection. Auto-block repeat offenders, VPNs, bots, and competitors. Push exclusions directly to Google Ads.",
    gradient: "from-[#4285F4]/20 to-[#3367D6]/20",
    border: "border-[#4285F4]/20",
    link: "/google-ads",
    badge: "Protection",
    badgeColor: "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20",
  },
  {
    icon: GraduationCap,
    title: "Ads Master Class",
    description: "12-section campaign setup guide with real screenshots. Every setting explained — from keywords to bidding to landing pages. Built for contractors.",
    gradient: "from-[#34A853]/20 to-[#2D9A46]/20",
    border: "border-[#34A853]/20",
    link: "/google-ads-guide",
    badge: "Education",
    badgeColor: "bg-[#34A853]/10 text-[#34A853] border-[#34A853]/20",
  },
  {
    icon: ShieldAlert,
    title: "Ad Fraud Exposé",
    description: "The truth Google doesn't want you to know. 9 investigative sections revealing how default settings drain your budget — with evidence and data.",
    gradient: "from-[#FBBC05]/20 to-[#F9AB00]/20",
    border: "border-[#FBBC05]/20",
    link: "/google-ad-fraud",
    badge: "Investigation",
    badgeColor: "bg-[#FBBC05]/10 text-[#FBBC05] border-[#FBBC05]/20",
  },
  {
    icon: Phone,
    title: "LSA Setup Guide",
    description: "Complete Local Services Ads guide — verification, call strategy, reviews, service selection, messaging, photos, and business bio. 8 expert sections.",
    gradient: "from-[#4285F4]/20 to-[#34A853]/20",
    border: "border-[#4285F4]/20",
    link: "/lsa-guide",
    badge: "Guide",
    badgeColor: "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20",
  },
];

const keyPoints = [
  { icon: Ban, color: "text-[#FBBC05]", title: "Disable Auto-Apply & AI Max", desc: "Google enables budget-draining features by default" },
  { icon: Search, color: "text-[#4285F4]", title: "Phrase & Exact Match Only", desc: "Broad match wastes money on irrelevant searches" },
  { icon: MapPin, color: "text-[#34A853]", title: "Presence-Only Targeting", desc: "Filter out VPN users, scammers, and bots" },
  { icon: Target, color: "text-[#4285F4]", title: "Manual CPC for New Campaigns", desc: "Don't let Google's AI control your bidding" },
  { icon: Eye, color: "text-[#FBBC05]", title: "Track Every Click", desc: "Install Click Guard before spending a dollar" },
  { icon: DollarSign, color: "text-[#34A853]", title: "Know Your Cost Per Lead", desc: "If you can't measure it, you can't improve it" },
];

const pipeline = [
  { step: "01", title: "Install Click Guard", desc: "Add our lightweight tracking script to your website. Under 3KB, loads async, tracks every visitor.", icon: Globe, color: "from-[#4285F4] to-[#3367D6]" },
  { step: "02", title: "Detect Fraud Automatically", desc: "Click Guard monitors IP addresses, device fingerprints, VPNs, and behavior patterns in real time.", icon: Fingerprint, color: "from-[#34A853] to-[#2D9A46]" },
  { step: "03", title: "Block & Protect", desc: "Fraudulent IPs are automatically pushed to your Google Ads exclusion list. Your budget stays safe.", icon: ShieldCheck, color: "from-[#FBBC05] to-[#F9AB00]" },
];

export default function GoogleAdsLandingPage() {
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
      <AdsAnimatedBackground />
      <AdsFloatingOrbs />

      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#1e2a4a] backdrop-blur-xl border-b border-white/5 ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/landing" data-testid="link-ads-home">
            <CHLogo height={40} />
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/70">
            <a href="#tools" className="hover:text-white transition-colors" data-testid="link-nav-tools">Tools</a>
            <a href="#how-it-works" className="hover:text-white transition-colors" data-testid="link-nav-how">How It Works</a>
            <a href="#playbook" className="hover:text-white transition-colors" data-testid="link-nav-playbook">Playbook</a>
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
              <Link href="/google-ads" data-testid="link-nav-click-guard">
                <Button size="sm" className="bg-[#4285F4] hover:bg-[#3367D6] text-white shadow-lg shadow-blue-500/25">
                  <Shield className="h-3.5 w-3.5 mr-1.5" /> Click Guard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth" data-testid="link-ads-signin">
                  <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-ads-getstarted">
                  <Button size="sm" className="bg-[#4285F4] hover:bg-[#3367D6] text-white shadow-lg shadow-blue-500/25">
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
            <img src={googleAdsLogo} alt="Google Ads" className="h-16 w-16 rounded-xl object-contain mx-auto mb-6 animate-float" />
          </div>
          <div className="animate-in-delay-1">
            <Badge className="mb-6 bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20 px-4 py-1.5 text-sm" data-testid="badge-hero">
              <Shield className="h-3.5 w-3.5 mr-1.5" /> Google Ads Protection & Strategy for Contractors
            </Badge>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-2" data-testid="text-hero-title">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/60 dark:from-white dark:via-white dark:to-white/60 bg-clip-text text-transparent">
              Stop Wasting Money
            </span>
            <br />
            <span className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#FBBC05] bg-clip-text text-transparent animate-gradient-text">
              on Google Ads
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground dark:text-white/50 max-w-2xl mx-auto leading-relaxed animate-in-delay-3">
            25% of your ad clicks are fraudulent. Google's default settings are designed to drain your budget.
            Our tools protect your campaigns and show you exactly how to set up ads that actually generate leads.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-4">
            <Link href={user ? "/google-ads" : "/auth?mode=signup"} data-testid="link-hero-protect">
              <Button size="lg" className="bg-[#4285F4] hover:bg-[#3367D6] text-white px-8 h-12 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                <Shield className="h-4 w-4 mr-2" /> Protect Your Budget <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <a href="#tools" data-testid="link-hero-learn">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-12 text-base">
                <GraduationCap className="h-4 w-4 mr-2" /> Learn the Playbook
              </Button>
            </a>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground dark:text-white/40 animate-in-delay-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#34A853]" /> Real-time IP tracking
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#34A853]" /> Auto-block fraudulent clicks
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#34A853]" /> 12-section campaign guide
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#FBBC05]" /> AI Ads Consultant included
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 bg-red-500/10 text-red-400 border-red-500/20">
              <AlertTriangle className="h-3 w-3 mr-1" /> The Problem
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Contractors Are Losing
              <span className="bg-gradient-to-r from-[#FBBC05] to-red-400 bg-clip-text text-transparent"> Thousands Every Month</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {fraudStats.map((stat, i) => (
              <Card key={stat.label} className={`bg-muted/50 dark:bg-white/[0.03] border-border dark:border-white/[0.06] p-6 text-center backdrop-blur-sm animate-in-delay-${i + 1}`} data-testid={`card-stat-${i}`}>
                <div className="text-3xl sm:text-4xl font-extrabold text-foreground dark:text-white">
                  <CountUp end={stat.value} suffix={stat.suffix} prefix={stat.prefix || ""} />
                </div>
                <p className="text-sm text-muted-foreground dark:text-white/60 mt-1 font-medium">{stat.label}</p>
                <p className="text-[10px] text-muted-foreground dark:text-white/30 mt-0.5">{stat.sub}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="tools" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-muted dark:bg-white/5 text-muted-foreground dark:text-white/60 border-border dark:border-white/10">Complete Toolkit</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Everything You Need to
              <span className="bg-gradient-to-r from-[#4285F4] to-[#34A853] bg-clip-text text-transparent"> Win at Google Ads</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              From click fraud protection to campaign mastery — a full suite of tools and guides built specifically for contractors.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {tools.map((tool, i) => (
              <Link key={tool.title} href={user ? tool.link : "/auth?mode=signup"}>
                <Card
                  className={`group bg-muted/50 dark:bg-white/[0.02] ${tool.border} hover:border-border dark:hover:border-white/[0.12] p-6 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm cursor-pointer animate-in-delay-${Math.min(i + 1, 4)}`}
                  data-testid={`card-tool-${i}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                      <tool.icon className="h-6 w-6 text-foreground dark:text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold">{tool.title}</h3>
                        <Badge className={`${tool.badgeColor} text-[10px] px-2 py-0`}>{tool.badge}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed">{tool.description}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground dark:text-white/20 group-hover:text-foreground/60 dark:group-hover:text-white/60 group-hover:translate-x-1 transition-all mt-1 shrink-0" />
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
              <ShieldCheck className="h-3 w-3 mr-1" /> Click Guard
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              How Click Guard
              <span className="bg-gradient-to-r from-[#4285F4] to-[#34A853] bg-clip-text text-transparent"> Protects You</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              Set up in minutes. Protection starts immediately. No coding required.
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
            <Link href={user ? "/google-ads" : "/auth?mode=signup"} data-testid="link-pipeline-cta">
              <Button size="lg" className="bg-[#4285F4] hover:bg-[#3367D6] text-white px-8 h-12 shadow-lg shadow-blue-500/25">
                <Shield className="h-4 w-4 mr-2" /> Set Up Click Guard Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="playbook" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-[#FBBC05]/10 text-[#FBBC05] border-[#FBBC05]/20">
              <AlertTriangle className="h-3 w-3 mr-1" /> Critical Knowledge
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              The 6 Things Google
              <span className="bg-gradient-to-r from-[#FBBC05] to-[#4285F4] bg-clip-text text-transparent"> Doesn't Want You to Know</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-2xl mx-auto">
              Google Ads default settings are designed to maximize <strong className="text-muted-foreground dark:text-white/60">Google's</strong> revenue — not yours.
              Our master class covers every trap and how to avoid it.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {keyPoints.map((point, i) => (
              <Card
                key={point.title}
                className={`bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] p-5 backdrop-blur-sm hover:border-border dark:hover:border-white/[0.12] transition-all duration-300 hover:-translate-y-1 animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-keypoint-${i}`}
              >
                <point.icon className={`h-6 w-6 ${point.color} mb-3`} />
                <h3 className="text-sm font-bold mb-1">{point.title}</h3>
                <p className="text-xs text-muted-foreground dark:text-white/40 leading-relaxed">{point.desc}</p>
              </Card>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href={user ? "/google-ads-guide" : "/auth?mode=signup"} data-testid="link-playbook-cta">
              <Button size="lg" className="bg-gradient-to-r from-[#4285F4] to-[#34A853] hover:from-[#3367D6] hover:to-[#2D9A46] text-white px-8 h-12 shadow-lg shadow-blue-500/25">
                <GraduationCap className="h-4 w-4 mr-2" /> Read the Full Master Class <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#4285F4]/10 via-muted/50 dark:via-[#1a1f3a]/50 to-[#34A853]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-comparison">
            <div className="absolute inset-0 bg-gradient-to-r from-[#4285F4]/5 to-[#34A853]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                  Without Click Guard vs.
                  <span className="text-[#34A853]"> With Click Guard</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Without Protection
                  </h3>
                  {[
                    "25%+ budget wasted on fraud",
                    "Competitors clicking your ads",
                    "Bots draining daily budget",
                    "VPN users triggering clicks",
                    "No visibility into who's clicking",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-[#34A853] uppercase tracking-wider mb-4 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> With Click Guard
                  </h3>
                  {[
                    "Auto-block repeat offenders",
                    "IP fingerprinting & device tracking",
                    "VPN & bot detection built in",
                    "Real-time traffic source analytics",
                    "Direct Google Ads exclusion sync",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#34A853] shrink-0" />
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
          <img src={googleAdsLogo} alt="Google Ads" className="h-20 w-20 rounded-2xl object-contain mx-auto mb-6 animate-float" />
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4" data-testid="text-final-cta">
            Ready to Stop Wasting
            <br />
            <span className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#FBBC05] bg-clip-text text-transparent">
              Your Ad Budget?
            </span>
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-8 max-w-lg mx-auto">
            Set up Click Guard in minutes. Read the master class. Stop bleeding money on fraudulent clicks and
            Google's predatory default settings.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? "/google-ads" : "/auth?mode=signup"} data-testid="link-final-protect">
              <Button size="lg" className="bg-[#4285F4] hover:bg-[#3367D6] text-white px-10 h-13 text-base shadow-2xl shadow-blue-500/30 landing-glow-btn">
                Protect Your Budget <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href={user ? "/google-ads-guide" : "/auth?mode=signup"} data-testid="link-final-guide">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-13 text-base">
                <GraduationCap className="h-4 w-4 mr-2" /> Start the Master Class
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
