/**
 * /done-for-you — every service our team does for a contractor (the
 * done-for-you registry, shared/dfy-pages), with what a feature is and what a
 * service is, side by side. /done-for-you/:slug — one service's page
 * (DfyLanding, the feature pages' template).
 *
 * Signed out: the public header (the ribbon on every marketing page) and
 * footer. Signed in: the app frame (App.tsx registers both routes in both
 * routers), as /features does.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DFY_CATALOGUE, DFY_PATH, dfyPageBySlug, type DfyCatalogueEntry } from "@shared/dfy-pages";
import { FEATURES_PATH } from "@shared/feature-pages";
import { featurePriceSummary } from "@shared/feature-pages/pricing";
import { ROUTE_META } from "@shared/route-meta";
import { SALES_REP_LABEL } from "@shared/plan-copy";
import { DfyLanding } from "@/components/feature-landing/dfy-landing";
import { FEATURE_ICON_COMPONENTS } from "@/components/feature-landing/icons";
import {
  BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, H2, Kicker, LEAD, TEXT_LINK, useDocumentTitle,
  useMetaDescription, useStartAtTop,
} from "@/components/feature-landing/primitives";
import { StandingGator } from "@/components/mascot";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import NotFound from "@/pages/not-found";

function ServiceCard({ entry }: { entry: DfyCatalogueEntry }) {
  const price = featurePriceSummary(entry.pricing);
  // "Talk to a sales rep", or the one-time price the page states ("$599 one-time").
  const figure = price.price && price.price !== price.headline ? `${price.price}${price.per}` : null;
  const Icon = FEATURE_ICON_COMPONENTS[entry.icon];
  return (
    <Link
      href={entry.path}
      className="group flex flex-col bg-mkt-card border border-mkt-rule rounded-2xl p-6 sm:p-7 hover:border-mkt-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange"
      data-testid={`card-dfy-catalogue-${entry.key}`}
    >
      <div className="h-11 w-11 rounded-lg border border-mkt-rule bg-mkt-paper flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3 className="mt-5 font-display font-semibold text-[1.35rem] leading-tight text-mkt-ink">{entry.title}</h3>
      <p className="mt-2.5 text-[15px] text-mkt-ink-soft leading-relaxed flex-1">{entry.lede}</p>
      <p className="mt-5 pt-4 border-t border-dotted border-mkt-rule text-[11px] font-semibold uppercase tracking-[0.14em] text-mkt-muted" data-testid={`text-dfy-catalogue-price-${entry.key}`}>
        {price.headline}
        {figure && <span className="block mt-1 normal-case tracking-normal text-[14px] text-mkt-ink">{figure}</span>}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-mkt-orange-ink">
        See what's included <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** Features or services? The owner's question, answered on the page: they do different jobs. */
const COMPARE = [
  {
    key: "features",
    kicker: "Features",
    title: "Software you run",
    body: "Tools you use yourself, whenever you like: Site Scan, Click Guard, permit search and the rest in your ConstructHUB plan, and the CRM as a separate product with its own plans. Each one is priced by plan, and a new account's first plan starts with a trial.",
    points: ["You do the work, with the tools", "Priced by plan or as an add-on", "Open any time from your dashboard"],
    link: { label: "See every feature", href: FEATURES_PATH, testId: "link-dfy-compare-features" },
  },
  {
    key: "services",
    kicker: "Done-For-You",
    title: "Work our team does",
    body: "People, not software: we file the paperwork, build your profile and website, and run your SEO and ads for you. A sales rep scopes and quotes each service with you before you commit or pay; GBP Reinstatement has one listed price per project and its own request form.",
    points: ["We do the work for you", "Scoped and quoted for your business", "One engagement, or ongoing on an agreement"],
    link: null,
  },
] as const;

export function DfyCataloguePage() {
  const [salesOpen, setSalesOpen] = useState(false);
  const meta = ROUTE_META[DFY_PATH];
  useMetaDescription(meta.description);
  useDocumentTitle(meta.title);
  useStartAtTop(DFY_PATH);

  const sales = (className: string, where: string) => (
    <button type="button" onClick={() => setSalesOpen(true)} className={`${className} ${BTN_LG}`} data-testid={`button-dfy-catalogue-sales-${where}`}>
      {SALES_REP_LABEL} <ArrowRight className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next={DFY_PATH} />
      <div className="mkt-editorial flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-done-for-you">
        {/* Hero */}
        <section className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" aria-hidden />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
            <div className="lg:col-span-7 pt-10 sm:pt-14 lg:pt-20 pb-10 lg:pb-16">
              <Kicker n="">Done-For-You Services</Kicker>
              <h1 className="font-display mt-5 font-semibold text-[2.45rem] leading-[1.04] sm:text-[3.3rem] lg:text-[3.85rem] tracking-[-0.02em] text-mkt-ink [text-wrap:balance]" data-testid="text-dfy-catalogue-title">
                Hand the Work to <span className="mkt-marker">Our&nbsp;Team</span>
              </h1>
              <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft max-w-[37rem] leading-relaxed">
                Business formation and licensing, your Google Business Profile and website, SEO and ad campaigns, and
                help with a suspended profile: work our team does for you. Tell a sales rep what you need, or send a
                reinstatement request, and we scope it with you before you commit or pay.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                {sales(BTN_PRIMARY, "hero")}
                <Link href={FEATURES_PATH} className={`${BTN_OUTLINE} ${BTN_LG}`} data-testid="link-dfy-catalogue-features">
                  See the Tools Instead
                </Link>
              </div>
              <p className="mt-5 text-[15px] text-mkt-ink-soft">
                <strong className="font-semibold text-mkt-ink">Sending a request is free and needs no account.</strong>{" "}
                Licensing exams are the one thing we can't do for you.
              </p>
            </div>
            <div className="pb-12 lg:pb-0 lg:col-span-5" aria-hidden>
              <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
                <div className="absolute inset-0 mkt-grid-paper-panel" />
                <div className="relative flex lg:flex-col items-center gap-4 lg:gap-6 p-5 sm:p-6 lg:px-8 lg:pt-10 lg:pb-0">
                  <p className="order-2 lg:order-1 flex-1 lg:flex-none mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1">
                    You run the jobs. Tell us what you'd rather hand off.
                  </p>
                  <StandingGator height={128} className="order-1 shrink-0 lg:hidden" />
                  <StandingGator height={340} className="hidden lg:block order-2 shrink-0 -mb-1" />
                </div>
              </div>
            </div>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </section>

        {/* The services */}
        <section id="services" className="py-16 lg:py-24 px-4 sm:px-6 lg:px-8 scroll-mt-16 bg-mkt-paper-2 border-y border-mkt-rule" data-testid="section-dfy-services">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end">
              <div className="lg:col-span-7">
                <Kicker n="01">The Services</Kicker>
                <h2 className={H2}>Pick What You Want <em className="text-mkt-orange-ink">Done</em></h2>
              </div>
              <p className={`lg:col-span-5 ${LEAD} lg:pb-1`}>
                Open any service to see what it covers, how it runs and what it doesn't do.
              </p>
            </div>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {DFY_CATALOGUE.map((e) => <ServiceCard key={e.key} entry={e} />)}
            </div>
          </div>
        </section>

        {/* Features or services? */}
        <section id="features-or-services" className="py-16 lg:py-24 px-4 sm:px-6 lg:px-8 scroll-mt-16" data-testid="section-dfy-compare">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl">
              <Kicker n="02">Features or Services?</Kicker>
              <h2 className={H2}>Two Ways to Get It <em className="text-mkt-orange-ink">Done</em></h2>
              <p className={`mt-5 ${LEAD}`}>
                Neither is better; they do different jobs. Use the tools for the work you want to do yourself, and hand
                us the work you'd rather not. You can use both.
              </p>
            </div>
            <div className="mt-10 grid md:grid-cols-2 gap-5">
              {COMPARE.map((c) => (
                <div key={c.key} className="bg-mkt-card border border-mkt-rule rounded-2xl p-6 lg:p-8" data-testid={`card-dfy-compare-${c.key}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink">{c.kicker}</p>
                  <h3 className="mt-2 font-display font-semibold text-[1.6rem] leading-tight text-mkt-ink">{c.title}</h3>
                  <p className="mt-3 text-[15px] text-mkt-ink-soft leading-relaxed">{c.body}</p>
                  <ul className="mt-5 space-y-2.5">
                    {c.points.map((p) => (
                      <li key={p} className="flex gap-2.5 text-[15px] text-mkt-ink"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" aria-hidden /> {p}</li>
                    ))}
                  </ul>
                  <p className="mt-6 text-[15px]">
                    {c.link
                      ? <Link href={c.link.href} className={TEXT_LINK} data-testid={c.link.testId}>{c.link.label}</Link>
                      : <button type="button" onClick={() => setSalesOpen(true)} className={TEXT_LINK} data-testid="button-dfy-compare-sales">{SALES_REP_LABEL}</button>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="relative bg-mkt-navy text-mkt-navy-ink py-20 lg:py-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-70 dark:opacity-40" aria-hidden />
          <div className="relative max-w-3xl mx-auto text-center">
            <StandingGator height={120} className="mx-auto mb-6" />
            <h2 className="font-display font-semibold text-[2.3rem] sm:text-[2.9rem] lg:text-[3.3rem] leading-[1.05] tracking-[-0.02em] [text-wrap:balance]">
              Not Sure What You Need?
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-mkt-navy-muted max-w-xl mx-auto">
              Tell us about your business and a sales rep will scope the work with you, or compare the tools you can run yourself.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              {sales(BTN_PRIMARY, "cta")}
              <Link href={FEATURES_PATH} className={`${BTN_OUTLINE_ON_NAVY} ${BTN_LG}`} data-testid="link-dfy-catalogue-features-cta">See Every Feature</Link>
            </div>
          </div>
        </section>
      </div>
      <PublicPageFooter />
      <TalkToSalesDialog open={salesOpen} onOpenChange={setSalesOpen} topic="Done-for-you services" />
    </div>
  );
}

/** /done-for-you/:slug — the service's page; an unknown slug is the 404 page. */
export function DfyPageRoute() {
  const { slug = "" } = useParams<{ slug: string }>();
  const page = dfyPageBySlug(slug);
  if (page) return <DfyLanding key={page.slug} page={page} />;
  return <NotFound />;
}
