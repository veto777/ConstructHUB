/**
 * One feature's intro page, from its content file (shared/feature-pages/<key>.ts),
 * in the /call-assistant page's editorial look (design B). Signed out it wears
 * the public header and footer; signed in, App.tsx renders it inside the app
 * frame with the sidebar (PublicPageHeader/Footer render nothing then).
 *
 * Every price comes from the price book through shared/feature-pages/pricing.ts.
 * The calls to action: signed out "Create Your Account" (back to the feature
 * after sign-up) + "Talk to a sales rep"; signed in "Open <feature>", or, when
 * the account's plan lacks it (featurePlanGap), "Upgrade to <plan>" / "See
 * add-ons" with a "Not in your <Plan> plan" line.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { FEATURE_CATALOGUE, featurePagePath, type FeaturePage } from "@shared/feature-pages";
import { featurePlanGap, featurePriceSummary } from "@shared/feature-pages/pricing";
import { SALES_REP_LABEL } from "@shared/plan-copy";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import { DashLink } from "@/components/dashboard/dash-link";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import type { EntitlementsInfo } from "@/lib/pricing-display";
import {
  BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, TEXT_LINK, useDocumentTitle, useMetaDescription, useStartAtTop,
} from "./primitives";
import {
  AudienceSection, CardsSection, FaqSection, FeatureHero, FinalCta, InDepthSection, PricingSection, RelatedSection,
  SpotlightSection, StepsSection, type Tone,
} from "./sections";

const FLAGS: Record<NonNullable<FeaturePage["flag"]>, boolean> = { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS };

/** False when the page's client feature flag is off (the page and its catalogue card are hidden). */
export const featureVisible = (flag: FeaturePage["flag"] | undefined) => !flag || FLAGS[flag];

/** Where "Create Your Account" sends a new account: the feature itself (portal features go through the CRM gateway). */
const signupNext = (page: FeaturePage) => (page.app.surface === "portal" ? "/crm-app" : page.app.href);

export function FeatureLanding({ page }: { page: FeaturePage }) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [salesOpen, setSalesOpen] = useState(false);
  const price = useMemo(() => featurePriceSummary(page.pricing), [page.pricing]);
  // Portal (CRM) features follow the org owner's plan, which this account's entitlements don't show.
  const checkPlan = !!user && page.app.surface === "app";
  const { data: ent } = useQuery<EntitlementsInfo>({ queryKey: ["/api/entitlements"], enabled: checkPlan });
  const gap = checkPlan && ent ? featurePlanGap(page.pricing, ent) : null;
  useMetaDescription(page.seo.description);
  useDocumentTitle(page.seo.title);
  useStartAtTop(page.slug);

  const related = useMemo(
    () => page.related
      .map((key) => FEATURE_CATALOGUE.find((e) => e.key === key))
      .filter((e): e is NonNullable<typeof e> => !!e && featureVisible(e.flag)),
    [page.related],
  );

  const primaryCta = (where: string) => gap
    ? (
      <Link href={gap.href} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid={`cta-feature-primary-${where}`} data-cta="upgrade">
        {gap.label} <ArrowRight className="h-4 w-4" />
      </Link>
    )
    : user
    ? (
      <DashLink href={page.app.href} surface={page.app.surface} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid={`cta-feature-primary-${where}`} data-cta="open">
        {page.app.label ?? `Open ${page.title}`} <ArrowRight className="h-4 w-4" />
      </DashLink>
    )
    : (
      <Link href={`/auth?mode=signup&next=${encodeURIComponent(signupNext(page))}`} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid={`cta-feature-primary-${where}`} data-cta="signup">
        Create Your Account <ArrowRight className="h-4 w-4" />
      </Link>
    );
  const salesCta = (className: string, where: string) => (
    <button type="button" onClick={() => setSalesOpen(true)} className={`${className} ${BTN_LG}`} data-testid={`button-feature-sales-${where}`}>
      {SALES_REP_LABEL}
    </button>
  );
  const tryIt = gap ? (
    <p className="mt-4 text-[15px] text-mkt-ink-soft" data-testid="text-feature-plan-gap">{gap.note}</p>
  ) : page.tryIt && !user ? (
    <p className="mt-4 text-[15px] text-mkt-ink-soft">
      Not ready to sign up?{" "}
      <Link href={page.tryIt.href} className={`inline-block ${TEXT_LINK}`} data-testid="link-feature-try">{page.tryIt.label}</Link>
    </p>
  ) : null;

  // Kicker numbers follow the sections actually shown ("01 How It Works", …),
  // and the bands alternate paper-2 / paper from the first one, as on /call-assistant.
  const order: string[] = [];
  const n = (id: string, shown: boolean) => {
    if (!shown) return "";
    order.push(id);
    return String(order.length).padStart(2, "0");
  };
  const tone = (id: string): Tone => (order.indexOf(id) % 2 === 0 ? "paper-2" : "paper");
  const nSteps = n("steps", page.steps.length > 0);
  const nCards = n("cards", page.cards.length > 0);
  const nSpot = n("spotlight", !!page.spotlight);
  const nAudience = n("audience", page.audience.length > 0);
  const nPricing = n("pricing", true);
  const nFaq = n("faq", page.faqs.length > 0);
  const nInDepth = n("in-depth", !!page.inDepth);
  const nRelated = n("related", related.length > 0);

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next={featurePagePath(page)} />
      <div className="mkt-editorial flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid={`page-feature-${page.slug}`} data-feature-status={page.status}>
        <FeatureHero
          page={page}
          price={price}
          primaryCta={primaryCta("hero")}
          salesCta={salesCta(BTN_OUTLINE, "hero")}
          tryIt={tryIt}
        />
        <StepsSection page={page} n={nSteps} tone={tone("steps")} />
        <CardsSection page={page} n={nCards} tone={tone("cards")} />
        <SpotlightSection page={page} n={nSpot} tone={tone("spotlight")} />
        <AudienceSection page={page} n={nAudience} tone={tone("audience")} />
        <PricingSection page={page} price={price} n={nPricing} tone={tone("pricing")} ctas={<>{primaryCta("pricing")}{salesCta(BTN_OUTLINE, "pricing")}</>} />
        <FaqSection page={page} n={nFaq} tone={tone("faq")} />
        <InDepthSection page={page} n={nInDepth} tone={tone("in-depth")} />
        <RelatedSection page={page} entries={related} n={nRelated} tone={tone("related")} />
        <FinalCta page={page} price={price} ctas={<>{primaryCta("cta")}{salesCta(BTN_OUTLINE_ON_NAVY, "cta")}</>} />
      </div>
      <PublicPageFooter />
      <TalkToSalesDialog open={salesOpen} onOpenChange={setSalesOpen} topic={page.title} />
    </div>
  );
}
