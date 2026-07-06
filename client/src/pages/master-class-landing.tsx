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
  ArrowRight, CheckCircle2, Zap, ChevronRight,
  DollarSign, BarChart3, Globe, Award, MapPin,
  Target, GraduationCap, Building2, Shield, Heart,
  Calculator, Users, BookOpen, Layers, HardHat,
  Briefcase, Star, FileText, TrendingUp, Camera,
  Monitor, Scale, Wrench, Lock, Lightbulb,
  Megaphone, Trophy, Sparkles, BadgeCheck, Settings,
} from "lucide-react";

function MasterClassBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let isDark = document.documentElement.classList.contains("dark");

    const observer = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains("dark");
      if (canvas) {
        canvas.style.background = isDark
          ? "linear-gradient(135deg, #1a2035 0%, #1d1a2e 30%, #1a2030 60%, #1a2035 100%)"
          : "linear-gradient(135deg, #ffffff 0%, #f8f9fc 30%, #f0f2f8 60%, #ffffff 100%)";
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const colors = [
      { h: 227, s: 71, l: 57 },
      { h: 25, s: 90, l: 50 },
      { h: 270, s: 60, l: 55 },
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
            ctx.strokeStyle = `hsla(227, 71%, 57%, ${0.04 * opacityMultiplier * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });
      });
      animationId = requestAnimationFrame(animate);
    };

    canvas.style.background = isDark
      ? "linear-gradient(135deg, #1a2035 0%, #1d1a2e 30%, #1a2030 60%, #1a2035 100%)"
      : "linear-gradient(135deg, #ffffff 0%, #f8f9fc 30%, #f0f2f8 60%, #ffffff 100%)";

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
    />
  );
}

function MasterClassOrbs() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="landing-orb" style={{ width: 500, height: 500, background: "radial-gradient(circle, #4A6CF7, transparent 70%)", top: -150, right: -150, animationDelay: "0s" }} />
      <div className="landing-orb" style={{ width: 400, height: 400, background: "radial-gradient(circle, #F97316, transparent 70%)", bottom: -100, left: -100, animationDelay: "-7s" }} />
      <div className="landing-orb" style={{ width: 350, height: 350, background: "radial-gradient(circle, #8B5CF6, transparent 70%)", top: "40%", right: -100, animationDelay: "-14s" }} />
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
  { value: 4, suffix: "", label: "Complete Modules", sub: "Formation to marketing" },
  { value: 50, suffix: "", label: "State Guides", sub: "Every state covered" },
  { value: 100, suffix: "+", label: "Action Steps", sub: "Detailed checklists" },
  { value: 50, suffix: "%", label: "Off Right Now", sub: "Limited time pricing" },
];

const modules = [
  {
    icon: Building2,
    number: "01",
    title: "Business Formation & Licensing",
    price: "$1,500",
    description: "The complete legal blueprint for getting your construction business up and running in any state. Entity formation, contractor licensing, bonding, insurance, workers comp, tax registration, and compliance — all 50 states covered with direct links to every agency you need.",
    gradient: "from-blue-500/20 to-indigo-500/20",
    border: "border-blue-500/20",
    color: "text-blue-400",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    highlights: [
      "LLC vs. S-Corp vs. Sole Proprietorship — which one for your trade",
      "State-by-state licensing requirements with direct agency links",
      "Bonding amounts, insurance minimums, and workers comp setup",
      "Tax registration, payroll compliance, and EIN filing",
      "Subcontractor management and 1099 compliance",
    ],
  },
  {
    icon: Camera,
    number: "02",
    title: "GMB Setup & Optimization",
    price: "$2,000",
    description: "Build a Google Business Profile that dominates local search, generates leads consistently, and withstands competitor attacks. Everything from initial setup and verification to review strategy, photo optimization, and suspension prevention.",
    gradient: "from-purple-500/20 to-violet-500/20",
    border: "border-purple-500/20",
    color: "text-purple-400",
    badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    highlights: [
      "Full GMB setup, verification, and category optimization",
      "Review strategy — getting 5-star reviews consistently",
      "Defending against fake competitor reviews",
      "Photo optimization and weekly posting calendar",
      "Suspension prevention and recovery playbook",
    ],
  },
  {
    icon: Monitor,
    number: "03",
    title: "Website & Online Presence",
    price: "$1,500",
    description: "Build a contractor website that actually converts visitors into booked jobs. The same framework used by 7-figure contractors — from page structure and lead capture to speed optimization and trust signals that turn browsers into buyers.",
    gradient: "from-emerald-500/20 to-teal-500/20",
    border: "border-emerald-500/20",
    color: "text-emerald-400",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    highlights: [
      "High-converting website blueprint with page-by-page specs",
      "Service pages and location pages that rank in Google",
      "Lead capture forms, click-to-call, and chat integration",
      "Speed optimization — every second costs you leads",
      "Portfolio showcases and trust signals that close deals",
    ],
  },
  {
    icon: TrendingUp,
    number: "04",
    title: "SEO & Directory Domination",
    price: "$1,500",
    description: "Rank your website on the first page of Google without paying for ads. Master local SEO, directory listings, citation building, and content strategy — the organic traffic system that compounds over time and delivers free leads month after month.",
    gradient: "from-orange-500/20 to-amber-500/20",
    border: "border-orange-500/20",
    color: "text-orange-400",
    badgeColor: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    highlights: [
      "Local SEO — dominating Google Maps and organic results",
      "Directory listings and citation building strategy",
      "Content strategy that attracts homeowners searching for contractors",
      "Link building specifically for contractor websites",
      "Tracking rankings and measuring organic lead growth",
    ],
  },
];

const whoItsFor = [
  { icon: HardHat, color: "text-blue-400", title: "New Contractors", desc: "Starting from scratch and need a complete roadmap — entity formation, licensing, insurance, and your first customers." },
  { icon: Wrench, color: "text-amber-400", title: "Trades Professionals", desc: "Skilled at your trade but unsure how to handle the business side — legal, marketing, sales, and scaling." },
  { icon: TrendingUp, color: "text-emerald-400", title: "Growing Companies", desc: "Already working but ready to scale — better marketing, stronger online presence, and more consistent leads." },
  { icon: Building2, color: "text-violet-400", title: "Multi-State Operators", desc: "Expanding to new states and need to know licensing, bonding, and compliance requirements for each one." },
  { icon: Users, color: "text-pink-400", title: "Crew Leaders Going Solo", desc: "You've worked for someone else and you're ready to be the boss. This shows you every step to make it happen." },
  { icon: Briefcase, color: "text-cyan-400", title: "Business Owners Struggling Online", desc: "Great at your trade but invisible online. Learn to dominate Google, get reviews, and build a website that converts." },
];

const pipeline = [
  { step: "01", title: "Build Your Legal Foundation", desc: "Choose the right entity, register with the state, get your contractor license, secure bonding and insurance. Our 50-state guide gives you direct links to every agency — no Googling, no guessing.", icon: Shield, color: "from-[#4A6CF7] to-[#3B5DE7]" },
  { step: "02", title: "Establish Your Online Presence", desc: "Set up a Google Business Profile that dominates local search. Build a website that actually converts visitors into booked jobs. Get listed in every directory that matters for contractors.", icon: Globe, color: "from-[#F97316] to-[#EA580C]" },
  { step: "03", title: "Generate Consistent Leads", desc: "Master local SEO so customers find you organically. Build a review strategy that establishes trust. Create content that ranks. Turn your online presence into a lead-generation machine that runs 24/7.", icon: Target, color: "from-[#8B5CF6] to-[#7C3AED]" },
];

export default function MasterClassLandingPage() {
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
      <MasterClassBackground />
      <MasterClassOrbs />

      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#1e2a4a] backdrop-blur-xl border-b border-white/5 ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/landing" data-testid="link-masterclass-home">
            <CHLogo height={40} />
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/70">
            <a href="#modules" className="hover:text-white transition-colors" data-testid="link-nav-modules">Modules</a>
            <a href="#how-it-works" className="hover:text-white transition-colors" data-testid="link-nav-how">How It Works</a>
            <a href="#who" className="hover:text-white transition-colors" data-testid="link-nav-who">Who It's For</a>
            <a href="#enroll" className="hover:text-white transition-colors" data-testid="link-nav-enroll">Enroll</a>
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
              <Link href="/master-class" data-testid="link-nav-course">
                <Button size="sm" className="bg-[#F97316] hover:bg-[#EA580C] text-white shadow-lg shadow-orange-500/25">
                  <GraduationCap className="h-3.5 w-3.5 mr-1.5" /> Go to Course
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth" data-testid="link-masterclass-signin">
                  <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-masterclass-getstarted">
                  <Button size="sm" className="bg-[#F97316] hover:bg-[#EA580C] text-white shadow-lg shadow-orange-500/25">
                    Enroll Now <ArrowRight className="h-3.5 w-3.5 ml-1" />
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
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-[#F97316] to-[#4A6CF7] flex items-center justify-center mx-auto mb-6 animate-float">
              <GraduationCap className="h-9 w-9 text-white" />
            </div>
          </div>
          <div className="animate-in-delay-1">
            <div className="inline-flex items-center gap-3 mb-6">
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-4 py-1.5 text-sm animate-pulse" data-testid="badge-sale">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> 50% OFF — Limited Time
              </Badge>
              <Badge className="bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20 px-4 py-1.5 text-sm" data-testid="badge-hero">
                <Trophy className="h-3.5 w-3.5 mr-1.5" /> Construction Master Class
              </Badge>
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] animate-in-delay-2" data-testid="text-hero-title">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/60 dark:from-white dark:via-white dark:to-white/60 bg-clip-text text-transparent">
              Build a Profitable
            </span>
            <br />
            <span className="bg-gradient-to-r from-[#F97316] via-[#4A6CF7] to-[#8B5CF6] bg-clip-text text-transparent animate-gradient-text">
              Construction Business.
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground dark:text-white/50 max-w-2xl mx-auto leading-relaxed animate-in-delay-3">
            The complete step-by-step system for starting, growing, and scaling a construction company.
            From forming your LLC to dominating Google — built by contractors who've done it, not
            consultants who've read about it.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in-delay-4">
            <Link href={user ? "/master-class" : "/auth?mode=signup"} data-testid="link-hero-enroll">
              <Button size="lg" className="bg-[#F97316] hover:bg-[#EA580C] text-white px-8 h-12 text-base shadow-2xl shadow-orange-500/30 landing-glow-btn">
                <GraduationCap className="h-4 w-4 mr-2" /> Enroll Now — 50% Off <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <a href="#modules" data-testid="link-hero-explore">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-12 text-base">
                <BookOpen className="h-4 w-4 mr-2" /> View Full Curriculum
              </Button>
            </a>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground dark:text-white/40 animate-in-delay-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-orange-400" /> 4 in-depth modules
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-orange-400" /> 50 state-by-state guides
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-orange-400" /> 100+ action steps
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-400" /> Built by real contractors
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 bg-purple-500/10 text-purple-400 border-purple-500/20">
              <BarChart3 className="h-3 w-3 mr-1" /> Course Overview
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Everything You Need
              <span className="bg-gradient-to-r from-[#F97316] to-[#4A6CF7] bg-clip-text text-transparent"> In One Course</span>
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
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#F97316]/10 via-background/50 dark:via-[#1a1f3a]/50 to-[#4A6CF7]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-value-prop">
            <div className="absolute inset-0 bg-gradient-to-r from-[#F97316]/5 to-[#4A6CF7]/5 animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="relative z-10">
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
                  Why 90% of Contractors
                  <span className="text-[#F97316]"> Fail in the First 5 Years</span>
                </h2>
                <p className="text-muted-foreground dark:text-white/50 max-w-2xl mx-auto text-sm leading-relaxed">
                  It's not because they're bad at their trade. It's because nobody taught them the business side.
                  This course fills every gap between being a great tradesperson and running a great company.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Scale className="h-4 w-4" /> Common Mistakes
                  </h3>
                  {[
                    "Choosing the wrong entity type (costing thousands in taxes)",
                    "Operating without proper licensing or insurance",
                    "No online presence — invisible to 90% of customers",
                    "Zero review strategy — losing to competitors with fake reviews",
                    "No lead generation system beyond word of mouth",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-[#F97316] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <GraduationCap className="h-4 w-4" /> What You'll Learn
                  </h3>
                  {[
                    "Exact entity type for your trade and tax situation",
                    "Every license, bond, and insurance you actually need",
                    "Build a website that converts visitors into customers",
                    "Get real 5-star reviews and dominate local search",
                    "Organic lead system that runs 24/7 without ad spend",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F97316] shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="modules" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-muted dark:bg-white/5 text-muted-foreground dark:text-white/60 border-border dark:border-white/10">Full Curriculum</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              4 Modules. One Complete
              <span className="bg-gradient-to-r from-[#F97316] to-[#8B5CF6] bg-clip-text text-transparent"> Business Blueprint.</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              Each module is a deep-dive course on its own. Together, they cover every aspect of building
              a construction business from the ground up.
            </p>
          </div>
          <div className="space-y-5">
            {modules.map((mod, i) => (
              <Card
                key={mod.title}
                className={`group bg-muted/50 dark:bg-white/[0.02] ${mod.border} hover:border-border dark:hover:border-white/[0.12] p-6 sm:p-8 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm animate-in-delay-${Math.min(i + 1, 4)}`}
                data-testid={`card-module-${i}`}
              >
                <div className="flex flex-col sm:flex-row items-start gap-5">
                  <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${mod.gradient} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                    <mod.icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-xs font-bold text-muted-foreground dark:text-white/30 tracking-widest">MODULE {mod.number}</span>
                      <Badge className={`${mod.badgeColor} text-[10px] px-2 py-0`}>{mod.price}</Badge>
                    </div>
                    <h3 className="text-lg font-bold mb-2">{mod.title}</h3>
                    <p className="text-sm text-muted-foreground dark:text-white/40 leading-relaxed mb-4">{mod.description}</p>
                    <div className="space-y-1.5">
                      {mod.highlights.map(h => (
                        <div key={h} className="flex items-start gap-2 text-xs text-muted-foreground dark:text-white/50">
                          <CheckCircle2 className={`h-3 w-3 ${mod.color} shrink-0 mt-0.5`} />
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="mt-8 bg-gradient-to-r from-[#F97316]/10 to-[#4A6CF7]/10 border-[#F97316]/20 p-6 sm:p-8 text-center animate-in-delay-5" data-testid="card-bundle">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Trophy className="h-6 w-6 text-[#F97316]" />
              <h3 className="text-xl font-bold">Complete Bundle — All 4 Modules</h3>
            </div>
            <div className="flex items-center justify-center gap-4 mb-4">
              <span className="text-3xl font-extrabold text-[#F97316]">$2,499</span>
              <span className="text-lg text-muted-foreground dark:text-white/30 line-through">$4,999</span>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">SAVE 50%</Badge>
            </div>
            <p className="text-sm text-muted-foreground dark:text-white/40 max-w-lg mx-auto mb-6">
              Get everything — all 4 modules, all 50 state guides, 100+ action steps, and lifetime access.
              The bundle saves you over $2,500 compared to buying modules individually.
            </p>
            <Link href={user ? "/master-class" : "/auth?mode=signup"} data-testid="link-bundle-cta">
              <Button size="lg" className="bg-[#F97316] hover:bg-[#EA580C] text-white px-10 h-12 text-base shadow-2xl shadow-orange-500/30 landing-glow-btn">
                <GraduationCap className="h-4 w-4 mr-2" /> Enroll Now — 50% Off <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </Card>
        </div>
      </section>

      <section className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#4A6CF7]/10 via-background/50 dark:via-[#1a1f3a]/50 to-[#F97316]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-state-guides">
            <div className="relative z-10">
              <div className="text-center mb-8">
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[#4A6CF7] to-[#8B5CF6] flex items-center justify-center mx-auto mb-4">
                  <MapPin className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
                  50 State-by-State
                  <span className="text-[#4A6CF7]"> Contractor Guides</span>
                </h2>
                <p className="text-muted-foreground dark:text-white/50 max-w-xl mx-auto text-sm leading-relaxed">
                  Every state has different requirements for contractors. Our guides give you the exact steps,
                  agencies, links, and requirements for your specific state — no generic advice.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { icon: Building2, label: "Entity Formation", desc: "Secretary of State filings" },
                  { icon: Shield, label: "Licensing Requirements", desc: "Board links and requirements" },
                  { icon: Award, label: "Bonding Amounts", desc: "GC and specialty bond info" },
                  { icon: Heart, label: "Insurance Minimums", desc: "GL, WC, and auto requirements" },
                  { icon: Calculator, label: "Tax Registration", desc: "Revenue department links" },
                  { icon: FileText, label: "Step-by-Step Checklists", desc: "Every action item in order" },
                ].map((item, i) => (
                  <div key={item.label} className="bg-muted/50 dark:bg-white/[0.03] rounded-xl p-4 border border-border dark:border-white/[0.06]" data-testid={`state-feature-${i}`}>
                    <item.icon className="h-5 w-5 text-[#4A6CF7] mb-2" />
                    <p className="text-sm font-bold mb-0.5">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground dark:text-white/40">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/20">
              <Zap className="h-3 w-3 mr-1" /> Your Roadmap
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              From Zero to
              <span className="bg-gradient-to-r from-[#F97316] to-[#8B5CF6] bg-clip-text text-transparent"> Booked Solid</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-xl mx-auto">
              Three phases to building a construction business that generates consistent leads and revenue.
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
                      <span className="text-xs font-bold text-muted-foreground dark:text-white/30 tracking-widest">PHASE {item.step}</span>
                    </div>
                    <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground dark:text-white/50 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="who" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <Users className="h-3 w-3 mr-1" /> Who It's For
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Built for Contractors
              <span className="bg-gradient-to-r from-[#F97316] to-[#4A6CF7] bg-clip-text text-transparent"> at Every Stage</span>
            </h2>
            <p className="mt-4 text-muted-foreground dark:text-white/40 max-w-2xl mx-auto">
              Whether you're starting from scratch or scaling an established company, this course
              fills the gaps nobody else teaches.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {whoItsFor.map((item, i) => (
              <Card
                key={item.title}
                className={`bg-muted/50 dark:bg-white/[0.02] border-border dark:border-white/[0.06] p-5 backdrop-blur-sm hover:border-border dark:hover:border-white/[0.12] transition-all duration-300 hover:-translate-y-1 animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-who-${i}`}
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
          <Card className="relative overflow-hidden bg-gradient-to-br from-[#8B5CF6]/10 via-background/50 dark:via-[#1a1f3a]/50 to-[#F97316]/10 border-border dark:border-white/[0.08] p-8 sm:p-12 backdrop-blur-sm" data-testid="card-comparison">
            <div className="relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
                  Figuring It Out Alone vs.
                  <span className="text-[#F97316]"> Master Class</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Scale className="h-4 w-4" /> Going It Alone
                  </h3>
                  {[
                    "Months of Googling state requirements",
                    "Expensive mistakes with entity selection",
                    "No online presence = invisible to customers",
                    "Learning marketing by wasting money on ads",
                    "Losing to competitors with better strategies",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-[#F97316] uppercase tracking-wider mb-4 flex items-center gap-2">
                    <GraduationCap className="h-4 w-4" /> With Master Class
                  </h3>
                  {[
                    "Direct links to every agency in your state",
                    "Exact entity type for your trade and tax situation",
                    "Website and GMB that generate leads from day one",
                    "Organic SEO strategy that compounds over time",
                    "Complete playbook used by 7-figure contractors",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground dark:text-white/50">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F97316] shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="enroll" className="relative z-10 py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#4A6CF7] flex items-center justify-center mx-auto mb-6 animate-float">
            <GraduationCap className="h-11 w-11 text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4" data-testid="text-final-cta">
            Ready to Build a Business
            <br />
            <span className="bg-gradient-to-r from-[#F97316] via-[#4A6CF7] to-[#8B5CF6] bg-clip-text text-transparent">
              That Actually Works?
            </span>
          </h2>
          <p className="text-muted-foreground dark:text-white/40 mb-4 max-w-lg mx-auto">
            Join contractors across all 50 states who used this exact system to start, grow,
            and scale their businesses. Stop guessing and start building on a proven foundation.
          </p>
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className="text-3xl font-extrabold text-[#F97316]">$2,499</span>
            <span className="text-lg text-muted-foreground dark:text-white/30 line-through">$4,999</span>
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">50% OFF</Badge>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={user ? "/master-class" : "/auth?mode=signup"} data-testid="link-final-enroll">
              <Button size="lg" className="bg-[#F97316] hover:bg-[#EA580C] text-white px-10 h-13 text-base shadow-2xl shadow-orange-500/30 landing-glow-btn">
                Enroll Now — 50% Off <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href={user ? "/master-class" : "/auth?mode=signup"} data-testid="link-final-preview">
              <Button size="lg" variant="outline" className="border-border dark:border-white/20 text-foreground dark:text-white px-8 h-13 text-base">
                <BookOpen className="h-4 w-4 mr-2" /> Preview the Course
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
