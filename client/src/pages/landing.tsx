/**
 * The marketing landing page — "editorial warmth" direction.
 *
 * Reads like a friendly local business guide, not a software template: warm
 * paper background, navy ink, one orange, Fraunces for display type and Plus
 * Jakarta Sans for everything else (both scoped by the `mkt-editorial` class,
 * see client/src/index.css — the CRM keeps Inter). The standing gator is the
 * cover star of the hero, standing on a tape-measure rule, with a short
 * welcome in a speech bubble.
 *
 * Every heading, paragraph, number, link, href and data-testid from the
 * previous version survives; e2e specs depend on the testids.
 */
import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/theme-toggle";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import { StandingGator } from "@/components/mascot";
import { Settings } from "lucide-react";
import {
  ArrowRight, Search, Camera, Users,
  MapPin, CheckCircle2,
  Eye, Globe, LayoutDashboard, GraduationCap,
  Grid3X3, ShieldAlert, Crosshair, Briefcase,
  Megaphone, Package,
} from "lucide-react";
import { SHOW_COMPETITOR_INTEL } from "@/lib/features";
import { GROWTH_TOOLS } from "@/lib/growth-tools";
import { BRAND_NAME, copyrightNotice, formatCount, usePermitDirectoryCounts } from "@/lib/marketing";
import { LandingMobileMenu } from "@/components/landing-mobile-menu";
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { AGENCY_ONLY_MODULES, SALES_HREF, SALES_REP_LABEL, TRIAL_LABEL, formatUsd, joinNames } from "@shared/plan-copy";

const SECTION_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#plans", label: "Plans" },
  { href: "#stats", label: "Results" },
  { href: "#coverage", label: "Coverage" },
] as const;

/** Button recipes — anchors styled as buttons (no <button> nested in <a>). */
const BTN = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-paper";
const BTN_PRIMARY = `${BTN} bg-mkt-orange text-white hover:bg-mkt-orange-hover`;
const BTN_OUTLINE = `${BTN} border-2 border-mkt-ink text-mkt-ink hover:bg-mkt-ink hover:text-mkt-paper`;
/** On a navy band. */
const BTN_OUTLINE_ON_NAVY = `${BTN} border-2 border-mkt-navy-ink text-mkt-navy-ink hover:bg-mkt-navy-ink hover:text-mkt-navy`;
const BTN_LG = "h-12 px-6 text-base";

const WELCOME_LINE = "Welcome in — let's build your business.";

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

/** Section kicker: a short orange rule, an index number and small caps. */
function Kicker({ n, children, className = "" }: { n: string; children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-3 text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.14em] sm:tracking-[0.18em] text-mkt-orange-ink [text-wrap:balance] ${className}`}>
      <span className="hidden sm:block h-px w-8 bg-mkt-orange shrink-0" aria-hidden />
      {n && <span className="font-display italic normal-case tracking-normal text-[15px] text-mkt-muted">{n}</span>}
      <span>{children}</span>
    </p>
  );
}

const services = [
  {
    icon: Search,
    title: "Nationwide Permit Search",
    description: "Find the permit office for any county or city we list in all 50 states and DC, and search the government portals we support by address, contractor, or company name.",
  },
  {
    icon: Camera,
    title: "SEO Photo Optimizer",
    description: "Watermark, rename, geotag and describe your job photos in one batch. Google strips EXIF on upload, so geotags don't promise a ranking benefit.",
  },
  {
    icon: Eye,
    title: "GMB Monitor",
    description: "Check your Google Business listings against Google on demand and keep a history of every change a check finds. Includes AI Review Response Generator.",
  },
  {
    icon: Grid3X3,
    title: "GMB Ranking Grid",
    description: "Visualize exactly where you rank on Google Maps across your service area. Monitor local keyword performance with a geographic heatmap grid.",
  },
  {
    icon: MapPin,
    title: "GMB Locations Manager",
    description: "Manage all your business locations with Semrush-style GBP analytics — search/maps views, interactions, phone calls, and citation campaign tracking.",
  },
  {
    icon: ShieldAlert,
    title: "GBP Reinstatement",
    description: "Suspended Google Business Profile? Our reinstatement service handles soft and hard suspensions with a proven 4-step recovery process.",
  },
  {
    icon: Crosshair,
    title: "Competitor Intelligence",
    description: "Analyze competitors in your market. Track their permit activity, ranking positions, and business moves so you always stay one step ahead.",
  },
  {
    icon: GraduationCap,
    title: "Master Class",
    description: "Complete state-by-state guide to starting a construction business — LLC formation, licensing, bonding, insurance, plus website & SEO training.",
  },
  {
    icon: Users,
    title: "Contractor CRM",
    description: "Clients, estimates, invoices, pipeline, messaging and payments in one place — included with every plan.",
  },
];

/** Done-for-you card recipes (the three cards are written out so their testids stay literal). */
const DFY_CARD = "group bg-mkt-card border border-mkt-rule rounded-2xl p-7 hover:border-mkt-ink transition-colors";
const DFY_ICON = "h-11 w-11 rounded-lg border border-mkt-rule bg-mkt-paper flex items-center justify-center text-mkt-ink mb-6 group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors";
const DFY_TITLE = "font-display font-semibold text-[1.35rem] leading-tight text-mkt-ink";
const DFY_BODY = "text-[15px] text-mkt-ink-soft leading-relaxed mt-2.5";
const DFY_SALES = "mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-mkt-orange-ink";

const COVERAGE_STATES = [
  "Washington", "Florida", "California", "Texas",
  "New York", "Illinois", "Pennsylvania", "Ohio",
  "Georgia", "North Carolina", "Michigan", "Arizona",
  "Colorado", "Virginia", "Oregon", "Nevada",
  "Tennessee", "New Jersey", "Massachusetts", "Indiana",
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

  const visibleServices = services.filter((svc) => SHOW_COMPETITOR_INTEL || svc.title !== "Competitor Intelligence");
  // The services sit in a hairline grid, three across on desktop; an
  // incomplete last row gets a "see every tool" cell so no cell is left blank.
  const fillerCells = (3 - (visibleServices.length % 3)) % 3;

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
    <div className="mkt-editorial min-h-screen bg-mkt-paper text-mkt-ink overflow-x-clip">

      {/* Nav — a navy masthead with an orange rule under it. */}
      <nav className={`sticky top-0 z-50 transition-transform duration-300 bg-mkt-navy border-b-[3px] border-mkt-orange ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <CHLogo height={40} />
          <div className="hidden md:flex items-center gap-5 lg:gap-7 text-[14px] lg:text-[15px] font-medium text-white/75">
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white transition-colors" data-testid={`link-nav-${link.href.slice(1)}`}>{link.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-1 lg:gap-3">
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
              <Link href="/" data-testid="link-nav-dashboard" className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
                <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/auth" className="hidden sm:inline-flex items-center whitespace-nowrap h-9 px-3 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors" data-testid="link-nav-signin">
                  Sign In
                </Link>
                <Link href="/auth?mode=signup" data-testid="link-nav-getstarted" className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
                  Get Started <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
            <LandingMobileMenu signInHref={user ? undefined : "/auth"} links={[...SECTION_LINKS]} />
          </div>
        </div>
      </nav>

      {/* Hero — the gator is the cover star, standing on a tape-measure rule. */}
      <section className="relative z-10">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" aria-hidden />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-8 lg:items-end">

          {/* Copy */}
          <div className="lg:col-span-7 pt-10 sm:pt-14 lg:pt-20 pb-12 lg:pb-16">
            <Kicker n="" className="animate-in">Your Complete Business-Building Platform</Kicker>
            <h1 className="font-display mt-5 text-mkt-ink animate-in-delay-1">
              <span className="block italic font-medium text-mkt-orange-ink text-2xl sm:text-3xl leading-tight mb-2">Construct<span className="font-bold not-italic">HUB</span> —</span>
              <span className="block font-semibold text-[2.6rem] leading-[1.02] sm:text-[3.4rem] lg:text-[4.1rem] xl:text-[4.5rem] tracking-[-0.02em]">
                Build Your Business <span className="mkt-marker">From the Ground&nbsp;Up</span>
              </span>
            </h1>

            {/* Phone/tablet: the gator floats beside the paragraph so the CTAs stay close to the fold. */}
            <div className="lg:hidden float-right ml-4 mb-2 mt-5 w-[150px] md:w-[210px] relative animate-in-delay-2" aria-hidden>
              <p className="mkt-bubble px-3 py-2 text-[13px] md:text-[16px] leading-snug">{WELCOME_LINE}</p>
              <StandingGator height={190} className="mx-auto mt-4 md:!h-[280px]" />
            </div>

            <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft max-w-[36rem] leading-relaxed animate-in-delay-2">
              Whether you're starting from scratch or scaling an existing operation — we provide every tool, resource, and service you need. From LLC formation and licensing to GMB optimization and SEO domination. And if you don't want to do it yourself, we'll build your entire business for you.
            </p>

            <div className="clear-both mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 animate-in-delay-3">
              <Link href="/auth?mode=signup" data-testid="link-hero-signup" className={`${BTN_PRIMARY} ${BTN_LG}`}>
                Create Your Account <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={SALES_HREF} data-testid="link-hero-dfy" className={`${BTN_OUTLINE} ${BTN_LG}`}>
                <Package className="h-4 w-4" /> Done-For-You Services
              </Link>
            </div>
            <p className="mt-4 text-[15px] text-mkt-ink-soft animate-in-delay-3">
              Not ready to sign up?{" "}
              <Link href="/free-site-scan" className="inline-block whitespace-nowrap font-semibold text-mkt-orange-ink underline decoration-2 decoration-mkt-orange-soft underline-offset-4 hover:decoration-mkt-orange">Free 60-second website scan</Link>
            </p>

            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-mkt-ink-soft animate-in-delay-4">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-mkt-orange-ink" /> No card needed to sign up</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-mkt-orange-ink" /> Setup in minutes</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-mkt-orange-ink" /> Cancel anytime</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-mkt-orange-ink" /> Turnkey business building available</li>
            </ul>
          </div>

          {/* Desktop: the cover — a navy panel, the welcome bubble, and the gator standing on the rule. */}
          <div className="hidden lg:block lg:col-span-5 relative self-end h-[600px] animate-in-delay-2" aria-hidden>
            <div className="absolute right-0 top-14 w-[350px] h-[456px] rounded-[32px] bg-mkt-panel mkt-grid-paper-panel" />
            <p className="absolute left-0 top-0 w-[232px] mkt-bubble px-5 py-3 text-[19px] leading-snug -rotate-2 z-20">{WELCOME_LINE}</p>
            <StandingGator height={500} className="absolute bottom-0 left-[58px] z-10 translate-y-[3px]" />
          </div>
        </div>
        <div className="mkt-ruler" aria-hidden />
      </section>

      {/* Stats — by the numbers. */}
      <section id="stats" className="relative bg-mkt-paper-2 border-b border-mkt-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`py-8 lg:py-10 px-4 sm:px-6 ${i % 2 === 1 ? "border-l border-mkt-rule" : ""} ${i >= 2 ? "border-t border-mkt-rule lg:border-t-0 lg:border-l" : ""}`}
            >
              <div className="font-display font-semibold text-[2.5rem] lg:text-[3rem] leading-none text-mkt-ink">
                {typeof stat.value === "number" ? <CountUp end={stat.value} suffix={stat.suffix} /> : "—"}
              </div>
              <p className="mt-3 text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-mkt-muted [text-wrap:balance]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12 lg:mb-14">
            <div className="lg:col-span-7">
              <Kicker n="01">What We Do</Kicker>
              <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5">
                Everything You Need to Start, Build &amp; <em className="text-mkt-orange-ink">Dominate</em>
              </h2>
            </div>
            <p className="lg:col-span-5 text-[17px] text-mkt-ink-soft leading-relaxed lg:pb-1">
              From forming your LLC to ranking #1 on Google Maps — a full suite of tools and services built by contractors who scaled from solo operators to hundreds of employees.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
            {visibleServices.map((svc, i) => (
              <article
                key={svc.title}
                className="group bg-mkt-paper p-7 lg:p-8 transition-colors hover:bg-mkt-card"
                data-testid={`card-service-${i}`}
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="h-11 w-11 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                    <svc.icon className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <span className="font-display italic text-mkt-muted text-lg leading-none">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-semibold text-[1.35rem] leading-tight text-mkt-ink mb-2.5">{svc.title}</h3>
                <p className="text-[15px] text-mkt-ink-soft leading-relaxed">{svc.description}</p>
              </article>
            ))}
            {Array.from({ length: fillerCells }, (_, i) => (
              i === 0 ? (
                <Link key="filler-cta" href="/pricing" className="hidden lg:flex bg-mkt-paper-2 p-8 flex-col justify-end hover:bg-mkt-card transition-colors">
                  <span className="font-display italic text-xl text-mkt-ink">Every plan includes the CRM.</span>
                  <span className="mt-2 inline-flex items-center gap-2 text-[15px] font-semibold text-mkt-orange-ink">See every tool <ArrowRight className="h-4 w-4" /></span>
                </Link>
              ) : (
                <div key={`filler-${i}`} className="hidden lg:block bg-mkt-paper-2" />
              )
            ))}
          </div>
        </div>
      </section>

      {/* Done-For-You */}
      <section id="done-for-you" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-y border-mkt-rule">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12 lg:mb-14">
            <div className="lg:col-span-7">
              <Kicker n="02">Turnkey Solutions</Kicker>
              <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5">
                Don't Want to Do It Yourself? <em className="text-mkt-orange-ink">We'll Build It For You.</em>
              </h2>
            </div>
            <p className="lg:col-span-5 text-[17px] text-mkt-ink-soft leading-relaxed lg:pb-1">
              Our turnkey system handles everything — from filing your LLC to launching your marketing. We process all paperwork, set up your online presence, and get you ready to take jobs. The only thing we can't do is take your licensing exams for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            <div className={DFY_CARD} data-testid="card-dfy-formation">
              <div className={DFY_ICON}><Briefcase className="h-5 w-5" strokeWidth={1.75} /></div>
              <h3 className={DFY_TITLE}>Business Formation &amp; Filing</h3>
              <p className={DFY_BODY}>LLC, licensing paperwork, bonding, insurance processing, tax registration</p>
              <span className={DFY_SALES} data-testid="text-dfy-sales">{SALES_REP_LABEL}</span>
            </div>
            <div className={DFY_CARD} data-testid="card-dfy-gmb">
              <div className={DFY_ICON}><Globe className="h-5 w-5" strokeWidth={1.75} /></div>
              <h3 className={DFY_TITLE}>GMB &amp; Website Setup</h3>
              <p className={DFY_BODY}>Full Google Business Profile, professional website, content</p>
              <span className={DFY_SALES} data-testid="text-dfy-sales">{SALES_REP_LABEL}</span>
            </div>
            <div className={DFY_CARD} data-testid="card-dfy-seo">
              <div className={DFY_ICON}><Megaphone className="h-5 w-5" strokeWidth={1.75} /></div>
              <h3 className={DFY_TITLE}>SEO &amp; Ad Campaigns</h3>
              <p className={DFY_BODY}>Local SEO, Google Ads, LSA setup, citation building</p>
              <span className={DFY_SALES} data-testid="text-dfy-sales">{SALES_REP_LABEL}</span>
            </div>
          </div>

          <div className="relative overflow-hidden bg-mkt-panel text-mkt-panel-ink rounded-2xl" data-testid="card-dfy-bundle">
            <div className="mkt-hazard h-2.5" aria-hidden />
            <div className="absolute inset-0 top-2.5 mkt-grid-paper-panel [mask-image:linear-gradient(to_right,transparent_40%,black_100%)]" aria-hidden />
            <div className="relative p-8 lg:p-12 grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-8">
                <h3 className="font-display font-semibold text-[2rem] sm:text-[2.5rem] leading-[1.05] tracking-[-0.02em]">Complete Business Build</h3>
                <p className="mt-4 text-[17px] leading-relaxed opacity-80 max-w-2xl">
                  Everything above as one package. Paid upfront. 4-6 months from start to finish. Excludes licensing exams and prerequisites.
                </p>
              </div>
              <div className="lg:col-span-4 lg:justify-self-end">
                <Link href={SALES_HREF} data-testid="link-dfy-pricing" className={`${BTN_PRIMARY} ${BTN_LG} w-full sm:w-auto`}>
                  {SALES_REP_LABEL} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Plans — every number comes from the price book (shared/plans.ts). */}
      <section id="plans" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8" data-testid="section-plans">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end mb-12 lg:mb-14">
            <div className="lg:col-span-7">
              <Kicker n="03">Plans</Kicker>
              <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5">
                One Plan for Every <em className="text-mkt-orange-ink">Stage</em>
              </h2>
            </div>
            <p className="lg:col-span-5 text-[17px] text-mkt-ink-soft leading-relaxed lg:pb-1">
              Every plan starts with a {TRIAL_LABEL} and includes the CRM. Pay monthly, or yearly at 10 times the monthly price.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PLAN_KEYS.map((key, i) => (
              <div key={key} className="bg-mkt-card border border-mkt-rule rounded-2xl p-7 flex flex-col hover:border-mkt-ink transition-colors" data-testid={`card-plan-${key}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display font-semibold text-[1.4rem] text-mkt-ink">{PLANS[key].name}</h3>
                  <span className="font-display italic text-mkt-muted text-lg leading-none">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="mt-5 font-display font-semibold text-[2.6rem] leading-none text-mkt-ink">
                  {formatUsd(PLANS[key].monthlyCents)}<span className="font-sans text-sm font-medium text-mkt-muted ml-1">/month</span>
                </div>
                <p className="text-[15px] text-mkt-ink-soft mt-4 leading-relaxed">{PLANS[key].tagline}</p>
                {key === "agency" && (
                  <p className="text-[13px] text-mkt-muted mt-3 leading-relaxed" data-testid="text-agency-locations">
                    {PLANS.agency.limits.locations} locations included, then per-location pricing.
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[15px] text-mkt-ink-soft" data-testid="text-agency-modules">
            Only the {PLANS.agency.name} plan includes the {joinNames(AGENCY_ONLY_MODULES)}.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link href="/pricing" data-testid="link-plans-pricing" className={`${BTN_PRIMARY} ${BTN_LG}`}>
              See Plans &amp; Pricing <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={SALES_HREF} data-testid="link-plans-sales" className={`${BTN_OUTLINE} ${BTN_LG}`}>
              {SALES_REP_LABEL}
            </Link>
          </div>
        </div>
      </section>

      {/* Coverage */}
      <section id="coverage" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-mkt-paper-2 border-y border-mkt-rule">
        <div className="max-w-5xl mx-auto">
          <div className="text-center">
            <Kicker n="04" className="justify-center">Coverage</Kicker>
            <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5">
              Nationwide <em className="text-mkt-orange-ink">Coverage</em>
            </h2>
            <p className="mt-5 text-[17px] text-mkt-ink-soft leading-relaxed max-w-2xl mx-auto" data-testid="text-coverage-summary">
              {counts ? `${formatCount(counts.total)} county and city jurisdictions` : "County and city jurisdictions"} listed
              across all 50 states and DC{hasVerified ? `, ${formatCount(counts!.verifiedPortals!)} with a verified permit portal link` : ""}.
              Every portal link we show is checked, and links we could not confirm are labeled.
            </p>
          </div>
          <ul className="mt-12 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-8 border-t border-mkt-rule">
            {COVERAGE_STATES.map((state) => (
              <li key={state} className="flex items-center gap-2.5 py-3 border-b border-dotted border-mkt-rule text-[15px] text-mkt-ink">
                <CheckCircle2 className="h-4 w-4 text-mkt-orange-ink shrink-0" /> {state}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-center text-[13px] text-mkt-muted">All 50 states + DC listed &mdash; portal links shown only once checked</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative bg-mkt-navy text-mkt-navy-ink py-24 lg:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-70 dark:opacity-40" aria-hidden />
        <div className="relative max-w-3xl mx-auto text-center">
          <CHLogo height={80} className="mx-auto mb-8" />
          <h2 className="font-display font-semibold text-[2.4rem] sm:text-[3rem] lg:text-[3.5rem] leading-[1.05] tracking-[-0.02em]">
            Ready to Build Your Business?
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-mkt-navy-muted max-w-xl mx-auto">
            Use our DIY tools to start and grow at your own pace — or let us build your entire business for you with our done-for-you turnkey services. Either way, {BRAND_NAME} has you covered.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link href="/auth?mode=signup" data-testid="link-cta-signup" className={`${BTN_PRIMARY} ${BTN_LG} px-8`}>
              Create Your Account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={SALES_HREF} data-testid="link-cta-consulting" className={`${BTN_OUTLINE_ON_NAVY} ${BTN_LG}`}>
              {SALES_REP_LABEL}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-mkt-navy-rule py-10 px-4 sm:px-6 lg:px-8 bg-mkt-navy text-mkt-navy-ink">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <CHLogo height={30} className="opacity-70" />
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-mkt-navy-muted">
              <a href="mailto:support@constructhub.us" className="hover:text-mkt-navy-ink transition-colors" data-testid="link-footer-email">support@constructhub.us</a>
              <span aria-hidden className="opacity-40">·</span>
              <a href="/terms" className="hover:text-mkt-navy-ink transition-colors" data-testid="link-footer-terms">Terms of Use</a>
              <span aria-hidden className="opacity-40">·</span>
              <a href="/privacy" className="hover:text-mkt-navy-ink transition-colors" data-testid="link-footer-privacy">Privacy Policy</a>
            </div>
            <p className="text-[13px] text-mkt-navy-muted">{copyrightNotice()}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
