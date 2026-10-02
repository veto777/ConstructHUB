import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/theme-toggle";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import { Settings } from "lucide-react";
import {
  ArrowRight, Search, Camera, Users,
  MapPin, Check, CheckCircle2,
  Eye, LayoutDashboard, GraduationCap,
  Grid3X3, ShieldAlert, Crosshair,
  Package,
} from "lucide-react";
import { SHOW_COMPETITOR_INTEL } from "@/lib/features";
import { GROWTH_TOOLS } from "@/lib/growth-tools";
import { BRAND_NAME, copyrightNotice, formatCount, usePermitDirectoryCounts } from "@/lib/marketing";
import { LandingMobileMenu } from "@/components/landing-mobile-menu";
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { AGENCY_ONLY_MODULES, SALES_HREF, SALES_REP_LABEL, TRIAL_LABEL, formatUsd, joinNames } from "@shared/plan-copy";

/*
 * "Bold trades" marketing design: Barlow Condensed display type, DM Sans
 * body, navy band + one orange accent, warm off-white page. The type and
 * palette tokens live behind the `mk` root class in index.css so the CRM and
 * dashboard keep their own look.
 */

const SECTION_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#plans", label: "Plans" },
  { href: "#stats", label: "Results" },
  { href: "#coverage", label: "Coverage" },
] as const;

/** The owner's hard-hat gator: 335x512 for 1x screens, 671x1024 for 2x. The
 *  hero renders him at most 327px wide (500px tall at xl), and `sizes` tracks
 *  the rendered width per breakpoint so 2x screens pick the 1024 file. */
const HERO_GATOR = "/mascot/gator-standing-512.v1.webp";
const HERO_GATOR_2X = "/mascot/gator-standing-1024.v1.webp";
const HERO_GATOR_SIZES = "(min-width: 1280px) 327px, (min-width: 1024px) 301px, (min-width: 640px) 170px, 144px";

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

/** Numbered eyebrow + condensed title that opens every section below the hero. */
function SectionHeading({ number, eyebrow, children, lede }: { number: string; eyebrow: string; children: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-end mb-10 lg:mb-14">
      <div>
        <p className="mk-eyebrow">{number} &mdash; {eyebrow}</p>
        <h2 className="mk-title mt-4 text-[2.5rem] leading-[0.95] sm:text-5xl lg:text-6xl text-balance">{children}</h2>
      </div>
      {lede && <div className="mk-muted text-base lg:text-lg leading-relaxed lg:pb-1 lg:max-w-md lg:justify-self-end">{lede}</div>}
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

function IconBox({ icon: Icon }: { icon: IconType }) {
  return (
    <div className="h-11 w-11 rounded-[4px] bg-[#141b2d] text-[#F97316] dark:bg-[#232c45] flex items-center justify-center shrink-0">
      <Icon className="h-5 w-5" />
    </div>
  );
}

/** One done-for-you service as a numbered punch-list row (01 / 02 / 03, the
 *  sales-rep label on the right); every one of them is quoted by a sales rep. */
function DfyRow({ number, title, description, "data-testid": testId }: { number: string; title: string; description: string; "data-testid": string }) {
  return (
    <div
      className="mk-grid-cell grid grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 sm:gap-x-6 gap-y-3 px-5 py-5 sm:px-7 sm:py-6"
      data-testid={testId}
    >
      <span className="mk-display text-3xl sm:text-4xl leading-none text-[#F97316] w-9 sm:w-12 self-start sm:self-center">{number}</span>
      <div className="min-w-0">
        <h3 className="mk-head text-[1.25rem] sm:text-[1.375rem]">{title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed mk-muted">{description}</p>
      </div>
      <span
        className="col-start-2 md:col-start-auto inline-flex items-center gap-1.5 whitespace-nowrap font-display font-semibold uppercase tracking-[0.1em] text-sm text-[color:var(--mk-orange-ink)]"
        data-testid="text-dfy-sales"
      >
        {SALES_REP_LABEL} <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

/** Orange checkbox for the hero punch list. */
function PunchCheck() {
  return (
    <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] bg-[#F97316]">
      <Check className="h-3 w-3 text-[#141b2d]" strokeWidth={3.5} />
    </span>
  );
}

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
    <div className="mk min-h-screen overflow-x-clip">
      {/* Nav */}
      <nav className={`sticky top-0 z-50 transition-transform duration-300 mk-navy border-b border-white/10 ${navVisible ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <CHLogo height={40} />
          <div className="hidden md:flex items-center gap-7 text-white/75">
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="mk-navlink hover:text-white transition-colors" data-testid={`link-nav-${link.href.slice(1)}`}>{link.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
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
              <Link href="/" className="mk-btn mk-btn-primary mk-btn-sm" data-testid="link-nav-dashboard">
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/auth" className="hidden sm:inline-flex mk-navlink text-white/80 hover:text-white px-3 py-2 transition-colors" data-testid="link-nav-signin">
                  Sign In
                </Link>
                <Link href="/auth?mode=signup" className="mk-btn mk-btn-primary mk-btn-sm" data-testid="link-nav-getstarted">
                  Get Started <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
            <LandingMobileMenu signInHref={user ? undefined : "/auth"} links={[...SECTION_LINKS]} />
          </div>
        </div>
      </nav>

      {/* Hero: navy band, blueprint grid, the gator front and centre. The band's
          large-screen padding is sized so his boots and the hazard tape are on
          the first screen at 1440x900 while the CTAs stay above the fold at
          1366x768. */}
      <section className="mk-blueprint relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px] lg:gap-x-10">
          <div className="pt-6 pb-14 sm:pt-10 lg:pt-14 lg:pb-14">
            <p className="mk-eyebrow !text-[#F97316] animate-in">Your Complete Business-Building Platform</p>
            <h1 className="mk-display mt-5 text-white text-[2.5rem] sm:text-6xl lg:text-[3.75rem] xl:text-[5.5rem] animate-in-delay-1">
              <span className="block normal-case text-[#F97316] text-[0.5em] tracking-[0.02em] mb-2">ConstructHUB &mdash;</span>
              <span className="block">Build Your Business</span>
              <span className="block">From the Ground Up</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-white/75 max-w-xl leading-relaxed animate-in-delay-2">
              Whether you're starting from scratch or scaling an existing operation — we provide every tool, resource, and service you need. From LLC formation and licensing to GMB optimization and SEO domination. And if you don't want to do it yourself, we'll build your entire business for you.
            </p>
            {/* Phones: Gabe's fixed launcher sits bottom-right, so below `sm`
                the CTA stack stops short of that column (pr-16) instead of
                running under it. */}
            <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4 pr-16 sm:pr-0 animate-in-delay-3">
              <Link href="/auth?mode=signup" className="mk-btn mk-btn-primary w-full sm:w-auto" data-testid="link-hero-signup">
                Create Your Account <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={SALES_HREF} className="mk-btn mk-btn-ghost w-full sm:w-auto" data-testid="link-hero-dfy">
                <Package className="h-4 w-4" /> Done-For-You Services
              </Link>
              <p className="basis-full text-sm text-white/70">
                Not ready to sign up?{" "}
                <Link href="/free-site-scan" className="inline-block font-semibold text-white underline underline-offset-[6px] decoration-2 decoration-[#F97316] hover:text-[#F97316] transition-colors">
                  Free 60-second website scan
                </Link>
              </p>
            </div>
            {/* Punch list: two columns of orange checkboxes. */}
            <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 max-w-xl text-sm text-white/75 animate-in-delay-4">
              <li className="flex items-center gap-2.5"><PunchCheck /> No card needed to sign up</li>
              <li className="flex items-center gap-2.5"><PunchCheck /> Setup in minutes</li>
              <li className="flex items-center gap-2.5"><PunchCheck /> Cancel anytime</li>
              <li className="flex items-center gap-2.5"><PunchCheck /> Turnkey business building available</li>
            </ul>
          </div>

          {/* The gator. Phones: beside his greeting, above the copy. Desktop:
              right column, greeting overhead, boots over the band's edge. The
              lean-in and the sticker tilt live on wrappers: fadeSlideIn fills
              `transform`, which would otherwise cancel a rotate on the same
              element. */}
          <div className="order-first lg:order-none relative z-20 flex items-center gap-4 pt-8 lg:pt-10 lg:flex-col lg:items-center lg:justify-end lg:self-end lg:-mb-6">
            <div className="shrink-0 lg:order-last origin-bottom lg:-rotate-2">
              <img
                src={HERO_GATOR}
                srcSet={`${HERO_GATOR} 335w, ${HERO_GATOR_2X} 671w`}
                sizes={HERO_GATOR_SIZES}
                alt="The ConstructHUB gator in a hard hat and hi-vis vest, arms crossed"
                width={335}
                height={512}
                draggable={false}
                decoding="async"
                fetchPriority="high"
                className="h-[220px] sm:h-[260px] lg:h-[460px] xl:h-[500px] w-auto select-none drop-shadow-[0_24px_24px_rgba(0,0,0,0.45)] animate-in-delay-1"
                data-testid="img-hero-gator"
              />
            </div>
            <div className="-rotate-3 lg:mb-5">
              <p className="mk-bubble max-w-[220px] lg:max-w-none animate-in-delay-2">
                Welcome in — let&rsquo;s build your business.
              </p>
            </div>
          </div>
        </div>
        <div className="mk-hazard" aria-hidden="true" />
      </section>

      {/* Stats: a measuring strip under the hero. */}
      <section id="stats" className="relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 lg:pt-20 pb-10 lg:pb-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-10">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className={`px-4 sm:px-6 lg:px-8 border-[color:var(--mk-line-strong)] [&:nth-child(even)]:border-l lg:border-l lg:first:border-l-0 animate-in-delay-${i + 1}`}
              >
                <div className="mk-display text-[2.75rem] sm:text-6xl lg:text-7xl">
                  {typeof stat.value === "number" ? <CountUp end={stat.value} suffix={stat.suffix} /> : "—"}
                </div>
                <p className="mt-3 font-display font-semibold uppercase tracking-[0.14em] text-xs sm:text-sm mk-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mk-ticks" aria-hidden="true" />
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            number="01"
            eyebrow="What We Do"
            lede="From forming your LLC to ranking #1 on Google Maps — a full suite of tools and services built by contractors who scaled from solo operators to hundreds of employees."
          >
            Everything You Need to Start, Build &amp; <span className="text-[#F97316]">Dominate</span>
          </SectionHeading>
          {/* One hairline grid: 1px rules between cells, no gaps, no shadows. */}
          <div className="mk-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {services.filter((svc) => SHOW_COMPETITOR_INTEL || svc.title !== "Competitor Intelligence").map((svc, i) => (
              <div
                key={svc.title}
                className={`mk-grid-cell group relative p-6 lg:p-7 flex flex-col animate-in-delay-${Math.min(i + 1, 5)}`}
                data-testid={`card-service-${i}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <IconBox icon={svc.icon} />
                  <span className="font-display font-semibold text-sm tracking-[0.14em] mk-muted pt-1">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mk-head text-[1.375rem] mt-5">{svc.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed mk-muted">{svc.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Done-For-You */}
      <section id="done-for-you" className="pb-20 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            number="02"
            eyebrow="Turnkey Solutions"
            lede="Our turnkey system handles everything — from filing your LLC to launching your marketing. We process all paperwork, set up your online presence, and get you ready to take jobs. The only thing we can't do is take your licensing exams for you."
          >
            Don't Want to Do It Yourself? <span className="text-[#F97316]">We'll Build It For You.</span>
          </SectionHeading>
          {/* Numbered punch-list panel; the bundle band below sells all three at once. */}
          <div className="mk-grid grid grid-cols-1 mb-4">
            <DfyRow number="01" title="Business Formation & Filing" description="LLC, licensing paperwork, bonding, insurance processing, tax registration" data-testid="card-dfy-formation" />
            <DfyRow number="02" title="GMB & Website Setup" description="Full Google Business Profile, professional website, content" data-testid="card-dfy-gmb" />
            <DfyRow number="03" title="SEO & Ad Campaigns" description="Local SEO, Google Ads, LSA setup, citation building" data-testid="card-dfy-seo" />
          </div>
          <div className="mk-navy rounded-[6px] overflow-hidden border border-transparent dark:border-white/10" data-testid="card-dfy-bundle">
            <div className="mk-hazard" aria-hidden="true" />
            <div className="p-7 sm:p-10 lg:p-12 grid lg:grid-cols-[minmax(0,1fr)_auto] gap-8 items-center">
              <div>
                <h3 className="mk-display text-4xl sm:text-5xl lg:text-6xl">Complete Business Build</h3>
                <p className="mt-4 text-white/70 max-w-xl text-base lg:text-lg leading-relaxed">
                  Everything above as one package. Paid upfront. 4-6 months from start to finish. Excludes licensing exams and prerequisites.
                </p>
              </div>
              <Link href={SALES_HREF} className="mk-btn mk-btn-primary w-full sm:w-auto" data-testid="link-dfy-pricing">
                {SALES_REP_LABEL} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Plans — every number comes from the price book (shared/plans.ts). */}
      <section id="plans" className="pb-20 lg:pb-28" data-testid="section-plans">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            number="03"
            eyebrow="Plans"
            lede={<>Every plan starts with a {TRIAL_LABEL} and includes the CRM. Pay monthly, or yearly at 10 times the monthly price.</>}
          >
            One Plan for Every <span className="text-[#F97316]">Stage</span>
          </SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLAN_KEYS.map((key) => (
              <div key={key} className="mk-card p-6 flex flex-col" data-testid={`card-plan-${key}`}>
                <h3 className="font-display font-semibold uppercase tracking-[0.12em] text-base">{PLANS[key].name}</h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="mk-display text-5xl">{formatUsd(PLANS[key].monthlyCents)}</span>
                  <span className="text-sm mk-muted">/month</span>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed mk-muted">{PLANS[key].tagline}</p>
                {key === "agency" && (
                  <p className="mt-3 text-xs mk-muted border-t pt-3 mk-rule" data-testid="text-agency-locations">
                    {PLANS.agency.limits.locations} locations included, then per-location pricing.
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm mk-muted" data-testid="text-agency-modules">
            Only the {PLANS.agency.name} plan includes the {joinNames(AGENCY_ONLY_MODULES)}.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <Link href="/pricing" className="mk-btn mk-btn-primary" data-testid="link-plans-pricing">
              See Plans &amp; Pricing <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={SALES_HREF} className="mk-btn mk-btn-outline" data-testid="link-plans-sales">
              {SALES_REP_LABEL}
            </Link>
          </div>
        </div>
      </section>

      {/* Coverage */}
      <section id="coverage" className="pb-20 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            number="04"
            eyebrow="Coverage"
            lede={
              <span data-testid="text-coverage-summary">
                {counts ? `${formatCount(counts.total)} county and city jurisdictions` : "County and city jurisdictions"} listed
                across all 50 states and DC{hasVerified ? `, ${formatCount(counts!.verifiedPortals!)} with a verified permit portal link` : ""}.
                Every portal link we show is checked, and links we could not confirm are labeled.
              </span>
            }
          >
            Nationwide <span className="text-[#F97316]">Coverage</span>
          </SectionHeading>
          {/* Dotted-rule list, four columns across: a checklist, not chips. */}
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-8 border-t border-dotted border-[color:var(--mk-line-strong)]">
            {COVERAGE_STATES.map((state) => (
              <li key={state} className="flex items-center gap-2.5 py-3 text-[15px] font-medium border-b border-dotted border-[color:var(--mk-line-strong)]">
                <CheckCircle2 className="h-4 w-4 text-[#F97316] shrink-0" /> {state}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs mk-muted">All 50 states + DC listed &mdash; portal links shown only once checked</p>
        </div>
      </section>

      {/* Final CTA: a split block — the pitch on navy, the two paths on orange. */}
      <section className="pb-20 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] rounded-[6px] overflow-hidden border border-transparent dark:border-white/10">
            <div className="mk-blueprint p-7 sm:p-10 lg:p-14">
              <CHLogo height={72} className="mb-6" />
              <h2 className="mk-display text-5xl sm:text-6xl lg:text-7xl">
                Ready to Build Your Business?
              </h2>
              <p className="mt-5 text-white/70 max-w-xl text-base lg:text-lg leading-relaxed">
                Use our DIY tools to start and grow at your own pace — or let us build your entire business for you with our done-for-you turnkey services. Either way, {BRAND_NAME} has you covered.
              </p>
            </div>
            <div className="bg-[#F97316] text-[#141b2d] p-7 sm:p-10 lg:p-14 flex flex-col justify-center">
              <p className="font-display font-semibold uppercase tracking-[0.16em] text-sm">Pick your path</p>
              <div className="mt-5 flex flex-col items-stretch gap-3 sm:gap-4">
                <Link href="/auth?mode=signup" className="mk-btn mk-btn-navy" data-testid="link-cta-signup">
                  Create Your Account <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href={SALES_HREF} className="mk-btn mk-btn-navy-outline" data-testid="link-cta-consulting">
                  {SALES_REP_LABEL}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mk-navy border-t border-white/10 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <CHLogo height={30} className="opacity-70" />
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/55">
              <a href="mailto:support@constructhub.us" className="hover:text-white transition-colors" data-testid="link-footer-email">support@constructhub.us</a>
              <span className="text-white/25">|</span>
              <a href="/terms" className="hover:text-white transition-colors" data-testid="link-footer-terms">Terms of Use</a>
              <span className="text-white/25">|</span>
              <a href="/privacy" className="hover:text-white transition-colors" data-testid="link-footer-privacy">Privacy Policy</a>
            </div>
            <p className="text-xs text-white/35">{copyrightNotice()}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
