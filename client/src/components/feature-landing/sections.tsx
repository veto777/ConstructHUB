/**
 * The sections of a feature intro page, in the /call-assistant page's editorial
 * look. Each takes plain content (shared/feature-pages/types.ts) and renders
 * nothing when its content is empty, so a stub page is just the hero, the
 * price and the call to action.
 *
 * Section rhythm, as on /call-assistant: paper / paper-2 bands with hairline
 * borders, numbered small-caps kickers, Fraunces headings with one orange
 * italic phrase, hairline card grids, and a navy close.
 *
 * The same sections serve the done-for-you service pages (shared/dfy-pages):
 * they take the shared content shape (LandingContent), and the few lines that
 * differ — the back link, the compare link, the closing headline — are props.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, ChevronDown, Minus } from "lucide-react";
import type { FeatureCompare, FeatureHeading, LandingContent } from "@shared/feature-pages/types";
import type { FeaturePriceSummary } from "@shared/feature-pages/pricing";
import { competitorPriceLabel, comparePricesNote } from "@shared/feature-pages/compare";
import { SALES_REP_LABEL } from "@shared/plan-copy";
import { GabeAvatar, StandingGator } from "@/components/mascot";
import { FEATURE_ICON_COMPONENTS } from "./icons";
import { H2, Kicker, LEAD, PANEL_RULE, TEXT_LINK } from "./primitives";

const SECTION_X = "px-4 sm:px-6 lg:px-8";

/** Bands alternate paper-2 and paper, as on /call-assistant; the page decides each band's tone. */
export type Tone = "paper" | "paper-2";
const TONE_BG: Record<Tone, string> = { "paper-2": "bg-mkt-paper-2 border-y border-mkt-rule", paper: "" };

/** "Live in Four <em>Steps</em>": a heading's plain part, then its orange italic part. */
export function HeadingText({ heading }: { heading: FeatureHeading }) {
  return (
    <>
      {heading.title}
      {heading.em && <em className="text-mkt-orange-ink">{heading.em}</em>}
    </>
  );
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

/** "Coming soon" pill for a feature that is listed but not for sale yet. */
export function ComingSoonPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-mkt-orange px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mkt-orange-ink ${className}`}
      data-testid="badge-feature-coming-soon"
    >
      Coming soon
    </span>
  );
}

/**
 * "Included in every plan — from $29/mo." for the hero and the closing band;
 * "Quoted by a sales rep for your business." when a rep prices it (the button
 * beside it already says "Talk to a sales rep").
 */
export function priceSentence(s: FeaturePriceSummary): { strong: string; rest: string } {
  if (!s.price && s.headline === SALES_REP_LABEL) return { strong: "Quoted by a sales rep", rest: " for your business." };
  if (!s.price) return { strong: s.headline, rest: "." };
  const from = s.plans.length > 1 || s.from ? "from " : "";
  return { strong: s.headline, rest: ` — ${from}${s.price}${s.per}${s.priceTail ?? ""}.` };
}

// ── Hero ─────────────────────────────────────────────────────────────────────

/** A plain link the page passes to a section: where it goes and its testid. */
export type SectionLink = { label: string; href: string; testId: string };

const ALL_FEATURES: SectionLink = { label: "All features", href: "/features", testId: "link-feature-all" };

export function FeatureHero({
  page, price, primaryCta, salesCta, tryIt, back = ALL_FEATURES,
}: {
  page: LandingContent;
  price: FeaturePriceSummary;
  primaryCta: ReactNode;
  salesCta: ReactNode;
  tryIt: ReactNode;
  /** The small link above the kicker: "All features" (a service page: "All services"). */
  back?: SectionLink;
}) {
  const sentence = priceSentence(price);
  return (
    <section className="relative">
      <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" aria-hidden />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
        <div className="lg:col-span-7 pt-8 sm:pt-12 lg:pt-16 pb-10 lg:pb-20">
          <Link href={back.href} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-mkt-muted hover:text-mkt-ink transition-colors mb-6" data-testid={back.testId}>
            <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden /> {back.label}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <Kicker n="">{page.kicker}</Kicker>
            {price.comingSoon && <ComingSoonPill />}
          </div>
          <h1 className="font-display mt-5 font-semibold text-[2.45rem] leading-[1.04] sm:text-[3.3rem] lg:text-[3.85rem] tracking-[-0.02em] text-mkt-ink [overflow-wrap:anywhere] [text-wrap:balance]" data-testid="text-feature-title">
            {page.headline.lead}<span className="mkt-marker">{page.headline.swipe}</span>{page.headline.tail}
          </h1>
          <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft max-w-[37rem] leading-relaxed" data-testid="text-feature-lede">
            {page.lede}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
            {primaryCta}
            {salesCta}
          </div>
          {tryIt}
          <p className="mt-5 text-[15px] text-mkt-ink-soft" data-testid="text-feature-hero-price">
            <strong className="font-semibold text-mkt-ink">{sentence.strong}</strong>{sentence.rest}
            {" "}<a href="#pricing" className={`${TEXT_LINK} whitespace-nowrap`}>See pricing</a>
          </p>
        </div>

        {/* The mascot and his line, on the navy grid panel. */}
        <div className="pb-12 lg:pb-0 lg:col-span-5" aria-hidden>
          <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
            <div className="absolute inset-0 mkt-grid-paper-panel" />
            <div className="relative flex lg:flex-col items-center gap-4 lg:gap-6 p-5 sm:p-6 lg:px-8 lg:pt-10 lg:pb-0">
              <p className="order-2 lg:order-1 flex-1 lg:flex-none mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1" data-testid="text-feature-bubble">
                {page.hero.bubble}
              </p>
              {page.hero.mascot === "gabe" ? (
                <GabeAvatar size={300} className="order-1 lg:order-2 shrink-0 !w-[96px] !h-[96px] sm:!w-[120px] sm:!h-[120px] lg:!w-[300px] lg:!h-[300px] lg:-mb-2" />
              ) : (
                <>
                  <StandingGator height={128} className="order-1 shrink-0 lg:hidden" />
                  <StandingGator height={340} className="hidden lg:block order-2 shrink-0 -mb-1" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mkt-ruler" aria-hidden />
    </section>
  );
}

// ── Section frame ────────────────────────────────────────────────────────────

/** A numbered band: kicker + heading (+ intro beside it on desktop), then the body. */
function Band({
  id, n, kicker, heading, tone, children, testId, center = false, narrow = false,
}: {
  id: string;
  n: string;
  kicker: string;
  heading: FeatureHeading;
  tone: Tone;
  children: ReactNode;
  testId: string;
  center?: boolean;
  narrow?: boolean;
}) {
  const bg = TONE_BG[tone];
  return (
    <section id={id} className={`py-20 lg:py-28 ${SECTION_X} ${bg} scroll-mt-16`} data-testid={testId}>
      <div className={narrow ? "max-w-3xl mx-auto" : center ? "max-w-5xl mx-auto" : "max-w-7xl mx-auto"}>
        {center ? (
          <div className="text-center">
            <Kicker n={n} className="justify-center">{kicker}</Kicker>
            <h2 className={H2}><HeadingText heading={heading} /></h2>
            {heading.intro && <p className={`mt-5 ${LEAD} max-w-2xl mx-auto`}>{heading.intro}</p>}
          </div>
        ) : heading.intro && !narrow ? (
          <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-end">
            <div className="lg:col-span-7">
              <Kicker n={n}>{kicker}</Kicker>
              <h2 className={H2}><HeadingText heading={heading} /></h2>
            </div>
            <p className={`lg:col-span-5 ${LEAD} lg:pb-1`}>{heading.intro}</p>
          </div>
        ) : (
          <div className="max-w-3xl">
            <Kicker n={n}>{kicker}</Kicker>
            <h2 className={H2}><HeadingText heading={heading} /></h2>
            {heading.intro && <p className={`mt-5 ${LEAD}`}>{heading.intro}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────

export function StepsSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  if (!page.steps.length) return null;
  const count = page.steps.length;
  const heading = page.headings?.steps ?? { title: "Up and Running in ", em: `${NUMBER_WORDS[count] ?? count} Steps` };
  const cols = count >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <Band id="how-it-works" n={n} kicker="How It Works" heading={heading} tone={tone} testId="section-feature-how">
      <ol className={`mt-12 grid sm:grid-cols-2 ${count === 5 ? "lg:grid-cols-5" : cols} gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden`}>
        {page.steps.map((step, i) => (
          <li key={step.title} className="bg-mkt-paper p-7 lg:p-8" data-testid={`step-feature-${i + 1}`}>
            <span className="font-display italic text-[2.6rem] leading-none text-mkt-orange-ink">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-5 font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{step.title}</h3>
            <p className="mt-2.5 text-[15px] text-mkt-ink-soft leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </Band>
  );
}

// ── What you get ─────────────────────────────────────────────────────────────

export function CardsSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  if (!page.cards.length) return null;
  const heading = page.headings?.cards ?? { title: "What You Get With ", em: page.title };
  return (
    <Band id="what-you-get" n={n} kicker="What You Get" heading={heading} tone={tone} testId="section-feature-cards">
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
        {page.cards.map((card, i) => {
          const Icon = FEATURE_ICON_COMPONENTS[card.icon];
          return (
            <div key={card.title} className="group bg-mkt-paper p-6 lg:p-7 transition-colors hover:bg-mkt-card" data-testid={`card-feature-${i}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
                <span className="font-display italic text-mkt-muted text-lg leading-none">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="font-display font-semibold text-[1.2rem] leading-tight text-mkt-ink mb-2">{card.title}</h3>
              <p className="text-[14.5px] text-mkt-ink-soft leading-relaxed">{card.body}</p>
            </div>
          );
        })}
        <GridFillers count={page.cards.length} />
      </div>
    </Band>
  );
}

/**
 * Quiet cells that close the last row of a hairline grid (1 column on phones,
 * 2 from sm, 3 from lg), so no bare rule colour shows through an empty slot.
 */
function GridFillers({ count }: { count: number }) {
  const sm = count % 2 === 0 ? 0 : 1;
  const lg = (3 - (count % 3)) % 3;
  return (
    <>
      {Array.from({ length: Math.max(sm, lg) }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={`hidden bg-mkt-paper-2 ${i < sm ? "sm:block" : ""} ${i < lg ? "lg:block" : "lg:hidden"}`}
        />
      ))}
    </>
  );
}

// ── Spotlight (the "Calls & CRM" layout) ─────────────────────────────────────

export function SpotlightSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  const s = page.spotlight;
  if (!s) return null;
  return (
    <section id="spotlight" className={`py-20 lg:py-28 ${SECTION_X} ${TONE_BG[tone]} scroll-mt-16`} data-testid="section-feature-spotlight">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-6">
          <Kicker n={n}>{s.kicker}</Kicker>
          <h2 className={H2}><HeadingText heading={s.heading} /></h2>
          {s.heading.intro && <p className={`mt-5 ${LEAD}`}>{s.heading.intro}</p>}
          <ul className="mt-8 border-t border-mkt-rule">
            {s.points.map((line) => (
              <li key={line} className="flex gap-3 py-4 border-b border-dotted border-mkt-rule text-[15px] text-mkt-ink leading-relaxed">
                <CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-6 relative overflow-hidden rounded-2xl bg-mkt-panel text-mkt-panel-ink" data-testid="panel-feature-spotlight">
          <div className="mkt-hazard h-2.5" aria-hidden />
          <div className="absolute inset-0 top-2.5 mkt-grid-paper-panel [mask-image:linear-gradient(to_bottom,black_0%,transparent_90%)]" aria-hidden />
          <div className="relative p-7 lg:p-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{s.panel.label}</p>
            <h3 className="mt-2 font-display font-semibold text-[1.7rem] leading-tight">{s.panel.title}</h3>
            <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              {s.panel.items.map((item, i) => (
                <div key={item} className={`flex items-baseline gap-3 py-3 border-b ${PANEL_RULE}`}>
                  <dt className="font-display italic text-[15px] opacity-60 w-6 shrink-0">{String(i + 1).padStart(2, "0")}</dt>
                  <dd className="text-[15px] font-medium">{item}</dd>
                </div>
              ))}
            </dl>
            {s.panel.note && <p className="mt-6 text-[14px] leading-relaxed opacity-80">{s.panel.note}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Who it's for ─────────────────────────────────────────────────────────────

export function AudienceSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  if (!page.audience.length) return null;
  const heading = page.headings?.audience ?? { title: "Who It's ", em: "Built For" };
  const cols = page.audience.length === 2 ? "lg:grid-cols-2" : page.audience.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <Band id="who-its-for" n={n} kicker="Who It's For" heading={heading} tone={tone} testId="section-feature-audience">
      <div className={`mt-12 grid sm:grid-cols-2 ${cols} gap-5`}>
        {page.audience.map((who, i) => (
          <div key={who.title} className="bg-mkt-card border border-mkt-rule rounded-2xl p-6 lg:p-7 hover:border-mkt-ink transition-colors" data-testid={`card-feature-audience-${i}`}>
            <span className="font-display italic text-[1.6rem] leading-none text-mkt-orange-ink">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-4 font-display font-semibold text-[1.25rem] leading-tight text-mkt-ink">{who.title}</h3>
            <p className="mt-2 text-[14.5px] text-mkt-ink-soft leading-relaxed">{who.body}</p>
          </div>
        ))}
      </div>
    </Band>
  );
}

// ── Pricing ──────────────────────────────────────────────────────────────────

export function PricingSection({
  page, price, n, tone, ctas, compare,
}: {
  page: LandingContent;
  price: FeaturePriceSummary;
  n: string;
  tone: Tone;
  ctas: ReactNode;
  /** The line under the price card; default "Every plan and add-on, side by side: <price.link>". */
  compare?: { lead: string; label: string; href: string };
}) {
  const heading = page.headings?.pricing ?? { title: "What It ", em: "Costs" };
  // No plan rows (free, add-on-less, services): list what you get instead.
  const included = price.rows.length ? null : page.cards.slice(0, 6).map((c) => c.title);
  return (
    <Band id="pricing" n={n} kicker="Pricing" heading={heading} tone={tone} testId="section-feature-pricing" center>
      <div className="mt-12 bg-mkt-card border border-mkt-rule rounded-2xl overflow-hidden grid md:grid-cols-12 text-left" data-testid="card-feature-pricing">
        <div className="md:col-span-5 p-7 lg:p-9 border-b md:border-b-0 md:border-r border-mkt-rule">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-display font-semibold text-[1.35rem] text-mkt-ink" data-testid="text-feature-price-headline">{price.headline}</h3>
            {price.comingSoon && <ComingSoonPill />}
          </div>
          {price.price ? (
            <div className="mt-5 font-display font-semibold text-[3.4rem] leading-none text-mkt-ink" data-testid="text-feature-price">
              {(price.plans.length > 1 || price.from) && <span className="font-sans text-base font-medium text-mkt-muted mr-1.5">from</span>}
              {price.price}<span className="font-sans text-base font-medium text-mkt-muted ml-1">{price.per.trim()}</span>
            </div>
          ) : null}
          <p className="mt-4 text-[15px] text-mkt-ink-soft leading-relaxed" data-testid="text-feature-price-note">{price.priceNote}</p>
          {price.note && <p className="mt-3 text-[14px] text-mkt-ink-soft leading-relaxed">{price.note}</p>}
        </div>
        <div className="md:col-span-7 p-7 lg:p-9">
          {price.rows.length ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Plan by plan</p>
              <dl className="mt-3" data-testid="list-feature-plan-rows">
                {price.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-4 py-3 border-b border-dotted border-mkt-rule last:border-b-0">
                    <dt className="font-display font-semibold text-[1.05rem] text-mkt-ink">{row.label}</dt>
                    <dd className={`flex items-center gap-2 text-right text-[15px] ${row.included ? "text-mkt-ink" : "text-mkt-muted"}`}>
                      {row.included
                        ? <CheckCircle2 className="h-4 w-4 text-mkt-orange-ink shrink-0" aria-hidden />
                        : <Minus className="h-4 w-4 shrink-0" aria-hidden />}
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : included && included.length ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">What's included</p>
              <ul className="mt-4 space-y-3 text-[15px] text-mkt-ink">
                {included.map((line) => (
                  <li key={line} className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" /> {line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[15px] text-mkt-ink-soft leading-relaxed">{page.lede}</p>
          )}
          <p className="mt-6 pt-5 border-t border-mkt-rule text-[14px] text-mkt-ink-soft leading-relaxed">
            {compare?.lead ?? "Every plan and add-on, side by side:"}{" "}
            <Link href={compare?.href ?? price.link.href} className={TEXT_LINK} data-testid="link-feature-pricing">{compare?.label ?? price.link.label}</Link>
          </p>
        </div>
      </div>
      <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">{ctas}</div>
    </Band>
  );
}

// ── Compare (owner, 2026-10-10) ──────────────────────────────────────────────

/**
 * Named competitors at their own list prices, what we do that they don't (the
 * page's own claims), what they do that we don't, and "one of a kind" where
 * the research found nothing comparable. `offer` is the à la carte Buy /
 * Included block (feature-landing/alacarte-offer.tsx) rendered under it.
 */
export function CompareSection({ page, compare, n, tone, offer }: { page: LandingContent; compare: FeatureCompare; n: string; tone: Tone; offer: ReactNode }) {
  const heading: FeatureHeading = { title: `${page.ctaTitle ?? page.title} `, em: "Compared" };
  return (
    <Band id="compare" n={n} kicker="Compare" heading={heading} tone={tone} testId="section-feature-compare" center>
      {compare.oneOfAKind && (
        <p className="mt-6 inline-flex items-center rounded-full border border-mkt-orange px-4 py-1.5 text-[13px] font-semibold text-mkt-orange-ink" data-testid="text-feature-one-of-a-kind">
          {compare.oneOfAKind}
        </p>
      )}
      <div className="mt-10 bg-mkt-card border border-mkt-rule rounded-2xl overflow-hidden text-left">
        <table className="w-full text-[14.5px]" data-testid="table-feature-compare">
          <thead>
            <tr className="border-b border-mkt-rule">
              <th scope="col" className="text-left p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Product</th>
              <th scope="col" className="text-right p-4 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">List price</th>
            </tr>
          </thead>
          <tbody>
            {compare.competitors.map((c, i) => (
              <tr key={`${c.name}-${i}`} className="border-b border-dotted border-mkt-rule last:border-0" data-testid={`row-feature-compare-${i}`}>
                <td className="px-4 py-3.5 align-top">
                  <div className="font-display font-semibold text-[1.05rem] text-mkt-ink">{c.name}{c.plan ? <span className="font-sans text-[13px] font-medium text-mkt-muted ml-2">{c.plan}</span> : null}</div>
                  {(c.note || c.reported) && (
                    <p className="text-[13px] text-mkt-ink-soft mt-0.5">{c.note}{c.note && c.reported ? " · " : ""}{c.reported ? "reported by a third-party listing, not the vendor's page" : ""}</p>
                  )}
                </td>
                <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                  <span className="font-semibold text-mkt-ink">{competitorPriceLabel(c.price)}</span>
                  {c.per && <span className="block text-[12px] text-mkt-muted">{c.per}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-mkt-muted text-left" data-testid="text-feature-compare-note">{comparePricesNote(compare.checkedOn)}</p>
      <div className="mt-10 grid gap-5 md:grid-cols-12 text-left">
        <div className="md:col-span-7 bg-mkt-card border border-mkt-rule rounded-2xl p-6 lg:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">What we do that they don't</p>
          <ul className="mt-4 space-y-3 text-[15px] text-mkt-ink" data-testid="list-feature-only-us">
            {compare.onlyUs.map((line) => (
              <li key={line} className="flex gap-3"><CheckCircle2 className="h-[18px] w-[18px] mt-0.5 text-mkt-orange-ink shrink-0" aria-hidden /> {line}</li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-5 bg-mkt-paper-2 border border-mkt-rule rounded-2xl p-6 lg:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">What they do that we don't</p>
          <p className="mt-4 text-[15px] text-mkt-ink-soft leading-relaxed" data-testid="text-feature-they-not-us">{compare.theyNotUs}</p>
          {compare.noContractorAlternative && (
            <p className="mt-4 text-[14px] text-mkt-ink leading-relaxed" data-testid="text-feature-no-contractor-alternative">
              Built for contractors: we found no trade-specific alternative — the products above are general tools.
            </p>
          )}
        </div>
      </div>
      {offer}
    </Band>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

export function FaqSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  if (!page.faqs.length) return null;
  const heading = page.headings?.faq ?? { title: "Before You ", em: "Decide" };
  return (
    <Band id="faq" n={n} kicker="Questions" heading={heading} tone={tone} testId="section-feature-faq" narrow>
      <div className="mt-10 border-t border-mkt-rule">
        {page.faqs.map((item, i) => (
          <details key={item.q} className="group border-b border-mkt-rule" data-testid={`faq-feature-${i}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display font-semibold text-[1.15rem] sm:text-[1.25rem] leading-snug text-mkt-ink [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange rounded-sm">
              {item.q}
              <ChevronDown className="h-5 w-5 shrink-0 text-mkt-orange-ink transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-6 -mt-1 text-[15.5px] text-mkt-ink-soft leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </Band>
  );
}

// ── In depth ─────────────────────────────────────────────────────────────────

/**
 * The long-form explanation (content `inDepth`): its own band near the end of
 * the page — kicker "In Depth", an H2, 2–5 paragraphs and an optional bullet
 * list, in a reading column. Plain text, so it is in the prerendered HTML as is.
 */
export function InDepthSection({ page, n, tone }: { page: LandingContent; n: string; tone: Tone }) {
  const d = page.inDepth;
  if (!d) return null;
  return (
    <Band id="in-depth" n={n} kicker="In Depth" heading={d.heading} tone={tone} testId="section-feature-in-depth" narrow>
      <div className="mt-8 space-y-5 text-[16.5px] text-mkt-ink-soft leading-[1.75] [&>p]:max-w-[35rem]" data-testid="text-feature-in-depth">
        {d.paragraphs.map((para) => <p key={para}>{para}</p>)}
        {d.bullets && d.bullets.length > 0 && (
          <>
            {d.bulletsIntro && <p className="font-semibold text-mkt-ink">{d.bulletsIntro}</p>}
            <ul className="border-t border-mkt-rule">
              {d.bullets.map((line) => (
                <li key={line} className="flex gap-3 py-3 border-b border-dotted border-mkt-rule text-[15.5px] text-mkt-ink leading-relaxed">
                  <CheckCircle2 className="h-[18px] w-[18px] mt-1 text-mkt-orange-ink shrink-0" aria-hidden /> {line}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Band>
  );
}

// ── Related features ─────────────────────────────────────────────────────────

/** One related card: a feature or a done-for-you service. */
export type RelatedEntry = { key: string; title: string; lede: string; path: string };

export function RelatedSection({ page, entries, n, tone }: { page: LandingContent; entries: readonly RelatedEntry[]; n: string; tone: Tone }) {
  if (!entries.length) return null;
  const heading = page.headings?.related ?? { title: "Works Well ", em: "Together" };
  return (
    <Band id="related" n={n} kicker="Related" heading={heading} tone={tone} testId="section-feature-related">
      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {entries.map((e) => (
          <Link
            key={e.key}
            href={e.path}
            className="group block bg-mkt-card border border-mkt-rule rounded-2xl p-6 lg:p-7 hover:border-mkt-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange"
            data-testid={`link-feature-related-${e.key}`}
          >
            <h3 className="font-display font-semibold text-[1.25rem] leading-tight text-mkt-ink">{e.title}</h3>
            <p className="mt-2 text-[14.5px] text-mkt-ink-soft leading-relaxed">{e.lede}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-mkt-orange-ink">
              See how it works <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </Band>
  );
}

// ── Closing band ─────────────────────────────────────────────────────────────

const COMPARE_FEATURES: SectionLink = { label: "Compare every feature", href: "/features", testId: "link-feature-cta-all" };

export function FinalCta({
  page, price, ctas, headline, more = COMPARE_FEATURES,
}: {
  page: LandingContent;
  price: FeaturePriceSummary;
  ctas: ReactNode;
  /** The closing H2; default "Put <feature> to Work". */
  headline?: string;
  /** "Still deciding? <link>": every feature (a service page: every service). */
  more?: SectionLink;
}) {
  const sentence = priceSentence(price);
  return (
    <section className={`relative bg-mkt-navy text-mkt-navy-ink py-20 lg:py-28 ${SECTION_X} overflow-hidden`} data-testid="section-feature-cta">
      <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)] opacity-70 dark:opacity-40" aria-hidden />
      <div className="relative max-w-3xl mx-auto text-center">
        {page.hero.mascot === "gabe"
          ? <GabeAvatar size={96} className="mx-auto mb-7 rounded-full" />
          : <StandingGator height={120} className="mx-auto mb-6" />}
        <h2 className="font-display font-semibold text-[2.3rem] sm:text-[2.9rem] lg:text-[3.3rem] leading-[1.05] tracking-[-0.02em] [overflow-wrap:anywhere] [text-wrap:balance]">
          {headline ?? `Put ${page.ctaTitle ?? page.title} to Work`}
        </h2>
        <p className="mt-5 text-[17px] leading-relaxed text-mkt-navy-muted max-w-xl mx-auto">
          {sentence.strong}{sentence.rest}
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">{ctas}</div>
        <p className="mt-8 text-[14px] text-mkt-navy-muted">
          Still deciding?{" "}
          <Link href={more.href} className="font-semibold text-mkt-navy-ink underline decoration-2 decoration-mkt-orange underline-offset-4" data-testid={more.testId}>
            {more.label}
          </Link>
        </p>
      </div>
    </section>
  );
}
