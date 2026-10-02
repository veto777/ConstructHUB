/**
 * /features — every feature, grouped like the signed-in dashboard (Grow /
 * Protect / Win jobs / Run the business / Learn, then the platform), each card
 * saying what it does and which plan has it, so a client can decide what they
 * want. /features/:slug — one feature's intro page (FeatureLanding).
 *
 * Signed out: public header + footer. Signed in: the app frame with the
 * sidebar (App.tsx registers both routes in both routers).
 *
 * Also here: LegacyLanding, which retires the old one-off landing pages
 * (/permits-landing, /google-ads-landing, /competitors-landing,
 * /master-class-landing) into /features/<slug> — but only once that page is
 * written ("ready"); until then the old page keeps rendering.
 */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  EXTERNAL_FEATURE_PAGES, FEATURE_CATALOGUE, FEATURE_GROUPS, FEATURES_PATH, featurePageByKey, featurePageBySlug,
  featurePagePath, type FeatureCatalogueEntry,
} from "@shared/feature-pages";
import { featurePriceSummary } from "@shared/feature-pages/pricing";
import type { FeatureGroupKey, FeatureIcon } from "@shared/feature-pages/types";
import { ROUTE_META } from "@shared/route-meta";
import { SALES_REP_LABEL } from "@shared/plan-copy";
import { FeatureLanding, featureVisible } from "@/components/feature-landing/feature-landing";
import { FEATURE_ICON_COMPONENTS } from "@/components/feature-landing/icons";
import {
  BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, H2, Kicker, LEAD, useDocumentTitle, useMetaDescription,
  useStartAtTop,
} from "@/components/feature-landing/primitives";
import { ComingSoonPill } from "@/components/feature-landing/sections";
import { StandingGator } from "@/components/mascot";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import NotFound from "@/pages/not-found";

const GROUP_ICONS: Record<FeatureGroupKey, FeatureIcon> = {
  grow: "trending-up", protect: "shield", win: "target", run: "kanban", learn: "graduation", platform: "bot",
};

function CatalogueCard({ entry }: { entry: FeatureCatalogueEntry }) {
  const price = featurePriceSummary(entry.pricing);
  const Icon = FEATURE_ICON_COMPONENTS[entry.icon ?? GROUP_ICONS[entry.group]];
  return (
    <Link
      href={entry.path}
      className="group flex flex-col bg-mkt-card border border-mkt-rule rounded-2xl p-5 sm:p-6 hover:border-mkt-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange"
      data-testid={`card-catalogue-${entry.key}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-paper flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </div>
        {price.comingSoon && <ComingSoonPill />}
      </div>
      <h3 className="mt-4 sm:mt-5 font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{entry.title}</h3>
      <p className="mt-2 text-[14.5px] text-mkt-ink-soft leading-relaxed flex-1">{entry.lede}</p>
      <p className="mt-4 pt-4 border-t border-dotted border-mkt-rule text-[11px] font-semibold uppercase tracking-[0.14em] text-mkt-muted" data-testid={`text-catalogue-plan-${entry.key}`}>
        {price.headline}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-mkt-orange-ink">
        See how it works <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function FeaturesCataloguePage() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [salesOpen, setSalesOpen] = useState(false);
  const meta = ROUTE_META[FEATURES_PATH];
  useMetaDescription(meta.description);
  useDocumentTitle(meta.title);
  useStartAtTop(FEATURES_PATH);

  const groups = useMemo(() => FEATURE_GROUPS.map((g) => ({
    ...g,
    entries: FEATURE_CATALOGUE.filter((e) => e.group === g.key && featureVisible(e.flag)),
  })).filter((g) => g.entries.length > 0), []);

  const primary = user
    ? <Link href="/pricing" className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="cta-features-primary">Compare Plans <ArrowRight className="h-4 w-4" /></Link>
    : <Link href={`/auth?mode=signup&next=${encodeURIComponent(FEATURES_PATH)}`} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="cta-features-primary">Create Your Account <ArrowRight className="h-4 w-4" /></Link>;
  const sales = (className: string, where: string) => (
    <button type="button" onClick={() => setSalesOpen(true)} className={`${className} ${BTN_LG}`} data-testid={`button-features-sales-${where}`}>
      {SALES_REP_LABEL}
    </button>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next={FEATURES_PATH} />
      <div className="mkt-editorial flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-features">
        {/* Hero */}
        <section className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" aria-hidden />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
            <div className="lg:col-span-7 pt-10 sm:pt-14 lg:pt-20 pb-10 lg:pb-16">
              <Kicker n="">Every Feature</Kicker>
              <h1 className="font-display mt-5 font-semibold text-[2.45rem] leading-[1.04] sm:text-[3.3rem] lg:text-[3.85rem] tracking-[-0.02em] text-mkt-ink" data-testid="text-features-title">
                Pick the Tools Your Business <span className="mkt-marker">Needs</span>
              </h1>
              <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft max-w-[37rem] leading-relaxed">
                Every ConstructHUB feature, grouped the way your dashboard groups them. Open any one to see what it
                does, what it needs from you and which plan includes it.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                {primary}
                {sales(BTN_OUTLINE, "hero")}
              </div>
              {/* Jump to a group. */}
              <nav aria-label="Feature groups" className="mt-8 flex flex-wrap gap-2">
                {groups.map((g) => (
                  <a key={g.key} href={`#${g.key}`} className="inline-flex items-center h-9 px-3.5 rounded-full border border-mkt-rule bg-mkt-card text-[14px] font-semibold text-mkt-ink hover:border-mkt-ink transition-colors" data-testid={`link-features-group-${g.key}`}>
                    {g.label}
                  </a>
                ))}
              </nav>
            </div>
            <div className="pb-12 lg:pb-0 lg:col-span-5" aria-hidden>
              <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
                <div className="absolute inset-0 mkt-grid-paper-panel" />
                <div className="relative flex lg:flex-col items-center gap-4 lg:gap-6 p-5 sm:p-6 lg:px-8 lg:pt-10 lg:pb-0">
                  <p className="order-2 lg:order-1 flex-1 lg:flex-none mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1">
                    Every page says what it does and which plan has it. Take a look around.
                  </p>
                  <StandingGator height={128} className="order-1 shrink-0 lg:hidden" />
                  <StandingGator height={340} className="hidden lg:block order-2 shrink-0 -mb-1" />
                </div>
              </div>
            </div>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </section>

        {/* One band per group. */}
        {groups.map((g, i) => (
          <section
            key={g.key}
            id={g.key}
            className={`py-16 lg:py-24 px-4 sm:px-6 lg:px-8 scroll-mt-16 ${i % 2 === 0 ? "bg-mkt-paper-2 border-y border-mkt-rule" : ""}`}
            data-testid={`section-features-${g.key}`}
          >
            <div className="max-w-7xl mx-auto">
              <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end">
                <div className="lg:col-span-7">
                  <Kicker n={String(i + 1).padStart(2, "0")}>{g.label}</Kicker>
                  <h2 className={H2}>{g.label}</h2>
                </div>
                <p className={`lg:col-span-5 ${LEAD} lg:pb-1`}>{g.blurb}</p>
              </div>
              <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {g.entries.map((e) => <CatalogueCard key={e.key} entry={e} />)}
              </div>
            </div>
          </section>
        ))}

        {/* Close */}
        <section className="relative bg-mkt-navy text-mkt-navy-ink py-20 lg:py-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-70 dark:opacity-40" aria-hidden />
          <div className="relative max-w-3xl mx-auto text-center">
            <StandingGator height={120} className="mx-auto mb-6" />
            <h2 className="font-display font-semibold text-[2.3rem] sm:text-[2.9rem] lg:text-[3.3rem] leading-[1.05] tracking-[-0.02em]">
              Not Sure Where to Start?
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-mkt-navy-muted max-w-xl mx-auto">
              Tell us about your business and a sales rep will point you to the plan that fits, or compare every plan side by side.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <Link href="/pricing" className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="link-features-pricing">Compare Plans <ArrowRight className="h-4 w-4" /></Link>
              {sales(BTN_OUTLINE_ON_NAVY, "cta")}
            </div>
          </div>
        </section>
      </div>
      <PublicPageFooter />
      <TalkToSalesDialog open={salesOpen} onOpenChange={setSalesOpen} topic="Which ConstructHUB features fit my business" />
    </div>
  );
}

/** Replace the current URL (no extra history entry). */
function Replace({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to, { replace: true }); }, [to, setLocation]);
  return null;
}

/** /features/:slug — the feature's page; an unknown slug (or a flagged-off feature) is the 404 page. */
export function FeaturePageRoute() {
  const { slug = "" } = useParams<{ slug: string }>();
  const page = featurePageBySlug(slug);
  if (page && featureVisible(page.flag)) return <FeatureLanding key={page.slug} page={page} />;
  // An external page reached by its catalogue key's slug (/features/call-assistant).
  const external = EXTERNAL_FEATURE_PAGES.find((e) => e.path === `/${slug}`);
  if (external) return <Replace to={external.path} />;
  return <NotFound />;
}

/**
 * A retired one-off landing page: once the feature's page is written
 * (status "ready") the old URL replaces itself with /features/<slug>; until
 * then the old page keeps rendering, so nothing is lost while copy is ported.
 */
export function LegacyLanding({ featureKey, fallback: Fallback }: { featureKey: string; fallback: ComponentType }) {
  const page = featurePageByKey(featureKey);
  if (page?.status === "ready" && featureVisible(page.flag)) return <Replace to={featurePagePath(page)} />;
  return <Fallback />;
}
