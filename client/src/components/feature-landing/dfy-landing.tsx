/**
 * One done-for-you service's page, from its content file
 * (shared/dfy-pages/<key>.ts), in the same template as the feature pages
 * (sections.tsx). Signed out it wears the public header — the same ribbon as
 * every marketing page — and footer; signed in, App.tsx renders it inside the
 * app frame.
 *
 * A service is work our team does, so the call to action is the sales
 * request ("Talk to a sales rep"), never an account or a checkout: everything
 * here at or above the sales threshold is quoted by a rep, and its price never
 * reaches the browser.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { DFY_CATALOGUE, DFY_PATH, dfyPagePath, type DfyPage } from "@shared/dfy-pages";
import { FEATURE_CATALOGUE } from "@shared/feature-pages";
import { featurePriceSummary } from "@shared/feature-pages/pricing";
import { SALES_REP_LABEL } from "@shared/plan-copy";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import { featureVisible } from "./feature-landing";
import {
  BTN_LG, BTN_OUTLINE, BTN_OUTLINE_ON_NAVY, BTN_PRIMARY, useDocumentTitle, useMetaDescription, useStartAtTop,
} from "./primitives";
import {
  AudienceSection, CardsSection, FaqSection, FeatureHero, FinalCta, InDepthSection, PricingSection, RelatedSection,
  SpotlightSection, StepsSection, type RelatedEntry, type Tone,
} from "./sections";

/** A related key: another service first, else a feature (flagged-off features are left out). */
function relatedEntry(key: string): RelatedEntry | undefined {
  const service = DFY_CATALOGUE.find((e) => e.key === key);
  if (service) return service;
  return FEATURE_CATALOGUE.find((e) => e.key === key && featureVisible(e.flag));
}

export function DfyLanding({ page }: { page: DfyPage }) {
  const [salesOpen, setSalesOpen] = useState(false);
  const price = useMemo(() => featurePriceSummary(page.pricing), [page.pricing]);
  useMetaDescription(page.seo.description);
  useDocumentTitle(page.seo.title);
  useStartAtTop(page.slug);

  const related = useMemo(
    () => page.related.map(relatedEntry).filter((e): e is RelatedEntry => !!e),
    [page.related],
  );

  const salesCta = (className: string, where: string) => (
    <button type="button" onClick={() => setSalesOpen(true)} className={`${className} ${BTN_LG}`} data-testid={`cta-dfy-sales-${where}`}>
      {SALES_REP_LABEL} <ArrowRight className="h-4 w-4" />
    </button>
  );
  const everyService = (className: string, where: string) => (
    <Link href={DFY_PATH} className={`${className} ${BTN_LG}`} data-testid={`link-dfy-services-${where}`}>
      See Every Service
    </Link>
  );

  // Kicker numbers follow the sections shown; bands alternate paper-2 / paper (as on the feature pages).
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
      <PublicPageHeader next={dfyPagePath(page)} />
      <div className="mkt-editorial flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid={`page-dfy-${page.slug}`} data-dfy-status={page.status}>
        <FeatureHero
          page={page}
          price={price}
          primaryCta={salesCta(BTN_PRIMARY, "hero")}
          salesCta={everyService(BTN_OUTLINE, "hero")}
          tryIt={null}
          back={{ label: "All services", href: DFY_PATH, testId: "link-dfy-all" }}
        />
        <StepsSection page={page} n={nSteps} tone={tone("steps")} />
        <CardsSection page={page} n={nCards} tone={tone("cards")} />
        <SpotlightSection page={page} n={nSpot} tone={tone("spotlight")} />
        <AudienceSection page={page} n={nAudience} tone={tone("audience")} />
        <PricingSection
          page={page}
          price={price}
          n={nPricing}
          tone={tone("pricing")}
          ctas={salesCta(BTN_PRIMARY, "pricing")}
          compare={{ lead: "Every done-for-you service, side by side:", label: "See every service", href: DFY_PATH }}
        />
        <FaqSection page={page} n={nFaq} tone={tone("faq")} />
        <InDepthSection page={page} n={nInDepth} tone={tone("in-depth")} />
        <RelatedSection page={page} entries={related} n={nRelated} tone={tone("related")} />
        <FinalCta
          page={page}
          price={price}
          headline={`Get ${page.ctaTitle ?? page.title} Done for You`}
          ctas={<>{salesCta(BTN_PRIMARY, "cta")}{everyService(BTN_OUTLINE_ON_NAVY, "cta")}</>}
          more={{ label: "Compare the tools you run yourself", href: "/features", testId: "link-dfy-cta-features" }}
        />
      </div>
      <PublicPageFooter />
      <TalkToSalesDialog open={salesOpen} onOpenChange={setSalesOpen} topic={page.title} />
    </div>
  );
}
