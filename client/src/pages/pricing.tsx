import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import {
  Check, Zap, Star, TrendingUp, Building2, Loader2, ExternalLink, X, ArrowDown,
  Wrench, Globe, Megaphone, Briefcase, Search, MessageSquare, Settings2,
} from "lucide-react";
import {
  PLANS, PLAN_KEYS, ADDONS, TRIAL_DAYS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_TIER_ADDONS,
  type AddonKey, type BillingInterval, type PlanKey,
} from "@shared/plans";
import {
  formatUsd, intervalSuffix, intervalWord, planPriceCents, annualSavingsCents, annualMonthsFree,
  addonPriceCents, addonPlanNames, agencyQuote, agencyBandRows, comparisonSections, describeSubscription,
  normalizeLocations, isSalesOnlyService, DFY_SERVICES, AGENCY_INCLUDED_LOCATIONS, PAYMENT_PROBLEM_STATUSES,
  type CompareCell, type SubscriptionInfo,
} from "@/lib/pricing-display";
import { TalkToSalesButton, TalkToSalesDialog } from "@/components/talk-to-sales";
import { ToastAction } from "@/components/ui/toast";
import { apiErrorCode } from "@/lib/plan-errors";
import { useCart } from "@/contexts/cart-context";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { callAssistantIntroShort, callAssistantPricing, callAssistantYearlyNote } from "@shared/plan-copy";
import { CallAssistantTierCards } from "@/components/call-assistant-tiers";
import { StandingGator } from "@/components/mascot";
import { H2, Kicker, LEAD, TEXT_LINK } from "@/components/feature-landing/primitives";

// Design B (the marketing site's editorial look): hairline cards on cream, ONE
// orange for the recommended plan, the navy panel colour for Agency (it turns
// cream in dark mode, as the hero panels do, so the accent still reads).
const ORANGE_BUTTON = "border-0 bg-mkt-orange hover:bg-mkt-orange-hover text-white font-semibold rounded-lg";
const NAVY_BUTTON = "h-11 rounded-lg border-0 bg-mkt-panel text-mkt-panel-ink hover:opacity-90 font-semibold text-[15px]";
const OUTLINE_BUTTON = "h-11 rounded-lg border-2 border-mkt-ink [border-color:var(--mkt-ink)] bg-transparent text-mkt-ink hover:bg-mkt-ink hover:text-mkt-paper font-semibold text-[15px]";
const SECTION_X = "px-4 sm:px-6 lg:px-8";

const PLAN_STYLE: Record<PlanKey, { icon: any; card: string; ribbon: string; button: string }> = {
  starter: { icon: Zap, card: "border border-mkt-rule hover:border-mkt-ink", ribbon: "", button: OUTLINE_BUTTON },
  pro: {
    icon: Star, card: "border-2 border-mkt-orange", ribbon: "bg-mkt-orange text-white",
    button: ORANGE_BUTTON,
  },
  growth: { icon: TrendingUp, card: "border border-mkt-rule hover:border-mkt-ink", ribbon: "", button: OUTLINE_BUTTON },
  agency: {
    icon: Building2, card: "border-2 border-mkt-panel", ribbon: "bg-mkt-panel text-mkt-panel-ink",
    button: NAVY_BUTTON,
  },
};

const PLAN_RIBBON: Partial<Record<PlanKey, string>> = { pro: "Recommended", agency: "For agencies" };

const SERVICE_ICONS: Record<string, any> = {
  formation: Wrench, website: Globe, "seo-ads": Megaphone, "seo-packages": Search, "business-build": Briefcase, custom: MessageSquare,
};

const AGENCY_PRESETS = [10, 25, 50, 100, 250, 500];

/** Bring a section to the top of whatever scrolls it: the app's own pane when
 *  signed in (scrollIntoView would also scroll the window and push the top bar
 *  out of view), the window when signed out. Either way the section's
 *  scroll-margin is the gap left above it (clear of the signed-out sticky
 *  header), the same gap the sidebar's own fragment scroll leaves. */
function scrollToSection(el: HTMLElement) {
  let pane = el.parentElement;
  while (pane && !(pane.scrollHeight > pane.clientHeight && /(auto|scroll)/.test(getComputedStyle(pane).overflowY))) {
    pane = pane.parentElement;
  }
  const gap = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (pane) pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - gap;
  else el.scrollIntoView({ block: "start" });
}

const LOCATION_EVENTS = ["pushState", "replaceState", "popstate", "hashchange"] as const;

type PlanRequest = { plan: PlanKey; interval: BillingInterval; locations?: number };

const planBody = (r: PlanRequest) => ({ plan: r.plan, interval: r.interval, ...(r.plan === "agency" ? { locations: r.locations ?? AGENCY_INCLUDED_LOCATIONS } : {}) });

function planRequestPrice(r: PlanRequest): string {
  if (r.plan === "agency") {
    const q = agencyQuote(r.locations ?? AGENCY_INCLUDED_LOCATIONS);
    if (!q.sales) return `${formatUsd(r.interval === "year" ? q.annualCents : q.monthlyCents)}${intervalSuffix(r.interval)}`;
  }
  return `${formatUsd(planPriceCents(PLANS[r.plan], r.interval))}${intervalSuffix(r.interval)}`;
}

function CompareValue({ value }: { value: CompareCell }) {
  if (value === true) return <Check className="w-5 h-5 text-mkt-orange-ink mx-auto" strokeWidth={2.25} aria-label="Included" />;
  if (value === false) return <X className="w-4 h-4 text-mkt-muted opacity-60 mx-auto" aria-label="Not included" />;
  return <span className="text-[14px] font-semibold text-mkt-ink">{value}</span>;
}

export default function PricingPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [interval, setBillingInterval] = useState<BillingInterval>(() =>
    new URLSearchParams(window.location.search).get("interval") === "year" ? "year" : "month");
  const [agencyInput, setAgencyInput] = useState(String(AGENCY_INCLUDED_LOCATIONS));
  const agencyLocations = normalizeLocations(agencyInput);
  const [confirm, setConfirm] = useState<PlanRequest | null>(null);

  const { data: subscription, isPending: subscriptionPending } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/stripe/subscription"],
  });
  const { data: user, isPending: userPending } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const view = describeSubscription(subscription);

  // Back from Stripe Checkout: say what happened once, then drop the flag.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success")) {
      // A new plan: anything cached in this tab from before checkout is stale.
      void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "You're subscribed", description: "Welcome to ConstructHUB. Your plan, renewal date and add-ons are in Settings → Billing." });
    } else if (params.get("canceled")) {
      toast({ title: "Checkout canceled", description: "No charges were made." });
    } else return;
    params.delete("success"); params.delete("canceled");
    const qs = params.toString();
    window.history.replaceState({}, "", `/pricing${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, [toast]);

  const portalMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stripe/create-portal", {})).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: (err) => showError("Couldn't open billing")(err),
  });

  /** A request the server says only a sales rep can sell (409 talk_to_sales) opens the inquiry form. */
  const [salesTopic, setSalesTopic] = useState<string | null>(null);
  const requestTopic = (r: PlanRequest) =>
    r.plan === "agency" ? `${PLANS.agency.name} plan — ${(r.locations ?? AGENCY_INCLUDED_LOCATIONS).toLocaleString("en-US")} locations` : `${PLANS[r.plan].name} plan`;

  const showError = (title: string, opts: { portal?: boolean } = {}) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    // A declined card changes nothing; the fix is a new card in Stripe's portal.
    const manageBilling = opts.portal || apiErrorCode(err) === "payment_failed" ? (
      <ToastAction altText="Manage billing" onClick={() => portalMutation.mutate()} data-testid="button-toast-manage-billing">Manage billing</ToastAction>
    ) : undefined;
    toast({ title, description: apiErrorMessage(err), variant: "destructive", action: manageBilling });
  };

  /** Refusals that have a next step of their own; anything else is a toast. */
  const handlePlanError = (title: string, r: PlanRequest, err: unknown) => {
    const code = apiErrorCode(err);
    if (code === "talk_to_sales") { setSalesTopic(requestTopic(r)); return; }
    // The page's idea of the subscription was stale: reload it so the buttons say what will happen.
    if (code === "no_subscription") void queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
    showError(title)(err);
  };

  const checkoutMutation = useMutation({
    mutationFn: async (r: PlanRequest) => (await apiRequest("POST", "/api/stripe/create-checkout", planBody(r))).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: async (err, r) => {
      if (apiErrorCode(err) !== "has_subscription") return handlePlanError("Couldn't start checkout", r, err);
      // Already subscribed (another tab, or a webhook this page hadn't seen): change the one
      // subscription in place instead, unless its last payment failed, which the portal fixes.
      await queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
      const fresh = queryClient.getQueryData<SubscriptionInfo>(["/api/stripe/subscription"]);
      if (fresh && describeSubscription(fresh).changesInPlace && !PAYMENT_PROBLEM_STATUSES.includes(fresh.status)) setConfirm(r);
      else showError("Couldn't start checkout", { portal: true })(err);
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async (r: PlanRequest) => (await apiRequest("POST", "/api/stripe/change-plan", planBody(r))).json(),
    onSuccess: (data, r) => {
      if (data?.url) { window.location.href = data.url; return; }
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      // The Agency workspace (and its sidebar lock) follows the plan through /api/agency/me.
      void queryClient.invalidateQueries({ queryKey: ["/api/agency/me"] });
      // The signed-in home shows the plan, its meters and its locks.
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Plan changed", description: `You're now on ${PLANS[r.plan].name}, billed ${intervalWord(r.interval)}.` });
    },
    onError: (err, r) => { setConfirm(null); handlePlanError("Couldn't change your plan", r, err); },
  });

  // Wait for the account and its subscription before any plan button works: a
  // subscriber must change plans, never start a second checkout.
  const busy = checkoutMutation.isPending || changePlanMutation.isPending || userPending || (!!user && subscriptionPending);
  const pendingPlan = (checkoutMutation.isPending ? checkoutMutation.variables : changePlanMutation.isPending ? changePlanMutation.variables : null) as PlanRequest | null;

  /** One subscription per account: a Stripe subscription is changed in place, never checked out again. */
  const choosePlan = (r: PlanRequest) => {
    if (!user) { setLocation(`/auth?next=${encodeURIComponent(`/pricing${r.interval === "year" ? "?interval=year" : ""}`)}`); return; }
    if (view.changesInPlace) setConfirm(r);
    else checkoutMutation.mutate(r);
  };

  /** The trial is for an account's first subscription only (the server decides; this mirrors it). */
  // The server decides trial eligibility (one per customer), so the button never promises it;
  // the line under the plans explains the trial for new accounts.
  const startLabel = (plan: PlanKey) => `Choose ${PLANS[plan].name}`;
  /** An Agency subscriber keeps the location count they are billed for unless they pick another. */
  const currentAgencyLocations = view.planKey === "agency" && !view.isLegacy && view.locations ? view.locations : AGENCY_INCLUDED_LOCATIONS;

  const isCurrent = (plan: PlanKey) =>
    view.live && !view.isLegacy && view.planKey === plan && (view.interval === null || view.interval === interval);

  const ctaLabel = (plan: PlanKey) => {
    if (isCurrent(plan)) return "Current plan";
    if (!view.live) return startLabel(plan);
    if (view.planKey === plan && !view.isLegacy) return `Switch to ${intervalWord(interval)} billing`;
    return `Switch to ${PLANS[plan].name}`;
  };

  // Deep links such as /pricing#services (every "Talk to a sales rep" link, the
  // sidebar's "SEO Services", the empty cart's "Services"; #done-for-you still
  // works) or /pricing#add-ons (the old individual-tools page) land on that section. The browser's own hash jump
  // misses it: the page mounts behind the sign-in check and an in-app link
  // changes the URL without a page load. So jump once the subscription has
  // settled (loaded or failed), and again on each later in-app navigation to a
  // hash on this page — never on a refetch, so a visitor who has scrolled away
  // is not yanked back.
  const [navCount, setNavCount] = useState(0);
  useEffect(() => {
    const bump = () => setNavCount((n) => n + 1);
    LOCATION_EVENTS.forEach((e) => window.addEventListener(e, bump));
    return () => LOCATION_EVENTS.forEach((e) => window.removeEventListener(e, bump));
  }, []);
  const hashHandledFor = useRef(-1);
  const pageSettled = !subscriptionPending;
  useEffect(() => {
    if (!pageSettled || hashHandledFor.current === navCount) return;
    let id = "";
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      hashHandledFor.current = navCount;
      const el = document.getElementById(id);
      if (el) scrollToSection(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [pageSettled, navCount]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) scrollToSection(el);
  };

  // Add-ons ride on a Stripe subscription to one of the current plans (a legacy plan switches first).
  const addonsEditable = view.changesInPlace && !view.isLegacy;
  const monthsFree = annualMonthsFree();
  const quote = agencyQuote(agencyLocations);
  const bandPrices = AGENCY_LOCATION_BANDS.map((b) => b.centsPerLocation).filter((c) => c > 0);
  const sections = comparisonSections();
  const confirmFrom = view.displayName ? `Your ${view.displayName} subscription${view.interval ? ` (billed ${intervalWord(view.interval)})` : ""}` : "Your subscription";

  return (
    <>
    {/* Signed out, this page has no app frame: the header brings the way home,
        sign-in and the cart. */}
    <PublicPageHeader next="/pricing" cart />
    <div className="mkt-editorial mkt-shadcn h-full overflow-y-auto overflow-x-hidden bg-mkt-paper text-mkt-ink" data-testid="page-pricing">
      {/* Hero: the title, the trial line and the billing toggle, beside the gator's panel. */}
      <section className="relative">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]" aria-hidden />
        <div className={`relative max-w-7xl mx-auto ${SECTION_X} lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center`}>
          <div className="lg:col-span-7 pt-8 sm:pt-12 lg:pt-14 pb-8 lg:pb-14 text-center lg:text-left">
            <Kicker n="" className="justify-center lg:justify-start">Pricing</Kicker>
            <h1 className="font-display mt-5 font-semibold text-[2.6rem] leading-[1.02] sm:text-[3.4rem] lg:text-[4rem] tracking-[-0.02em] text-mkt-ink" data-testid="text-pricing-title">
              Plans &amp; <span className="mkt-marker">pricing</span>
            </h1>
            <p className="mt-5 text-base sm:text-lg text-mkt-ink-soft max-w-[36rem] mx-auto lg:mx-0 leading-relaxed" data-testid="text-trial">
              A new account starts any plan with a {TRIAL_DAYS}-day free trial. Cancel before it ends and you pay nothing.
              CRM included on every plan.
            </p>
            <div
              role="radiogroup"
              aria-label="Billing period"
              className="mt-7 inline-flex items-center rounded-full border border-mkt-rule bg-mkt-card p-1"
              data-testid="toggle-interval"
            >
              {(["month", "year"] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={interval === i}
                  onClick={() => setBillingInterval(i)}
                  className={`rounded-full px-4 sm:px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange ${interval === i ? "bg-mkt-panel text-mkt-panel-ink" : "text-mkt-ink-soft hover:text-mkt-ink"}`}
                  data-testid={`button-interval-${i}`}
                >
                  {i === "month" ? "Monthly" : "Annual"}
                  {i === "year" && (
                    <span className={`ml-2 rounded-full border border-current px-1.5 py-0.5 text-[11px] font-semibold ${interval === i ? "text-mkt-orange dark:text-[#AE4A04]" : "text-mkt-orange-ink"}`}>
                      {monthsFree} months free
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* The mascot and his line on the navy grid panel (decorative). */}
          <div className="pb-10 lg:py-10 lg:col-span-5" aria-hidden>
            <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
              <div className="absolute inset-0 mkt-grid-paper-panel" />
              <div className="relative flex lg:flex-col items-center lg:items-center gap-4 lg:gap-5 p-5 sm:p-6 lg:px-8 lg:pt-9 lg:pb-0">
                <p className="order-1 flex-1 lg:flex-none mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1" data-testid="text-pricing-bubble">
                  Pick the plan that fits your crew.
                </p>
                <StandingGator height={112} className="order-2 shrink-0 lg:hidden" />
                <StandingGator height={280} className="hidden lg:block order-2 shrink-0 -mb-1" />
              </div>
            </div>
          </div>
        </div>
        <div className="mkt-ruler" aria-hidden />
      </section>

      <div className={`max-w-7xl mx-auto ${SECTION_X} py-12 lg:py-16 space-y-20 lg:space-y-28`}>
        {view.live && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm -mt-2" data-testid="banner-current-plan">
            <Badge variant="outline" className="px-3 py-1 text-sm rounded-full border-mkt-ink text-mkt-ink bg-mkt-card" data-testid="badge-current-plan">
              <Check className="w-3.5 h-3.5 mr-1 text-mkt-orange-ink" />
              Your plan: {view.displayName}
              {view.interval ? ` · ${intervalWord(view.interval)}` : ""}
            </Badge>
            {view.isLegacy && view.planKey && (
              <span className="text-mkt-ink-soft" data-testid="text-legacy-match">
                Your features now match {PLANS[view.planKey].name}.
              </span>
            )}
            {PAYMENT_PROBLEM_STATUSES.includes(subscription?.status ?? "") && (
              <span className="text-destructive" role="alert">Your last payment didn't go through. Update your card in Manage billing.</span>
            )}
            {view.viaStripe && (
              <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending} className="rounded-lg" data-testid="button-manage-subscription">
                {portalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
                Manage billing
              </Button>
            )}
          </div>
        )}

        <div>
          <div id="plans" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 pt-3 scroll-mt-16">
            {PLAN_KEYS.map((key, index) => {
              const plan = PLANS[key];
              const style = PLAN_STYLE[key];
              const Icon = style.icon;
              const current = isCurrent(key);
              const request: PlanRequest = { plan: key, interval, ...(key === "agency" ? { locations: currentAgencyLocations } : {}) };
              const pending = busy && pendingPlan?.plan === key && pendingPlan.locations === request.locations;
              return (
                <div key={key} className={`relative flex flex-col rounded-2xl bg-mkt-card transition-colors ${style.card}`} data-testid={`card-plan-${key}`}>
                  {PLAN_RIBBON[key] && (
                    <div className={`absolute -top-3 left-6 z-10 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${style.ribbon}`}>
                      {PLAN_RIBBON[key]}
                    </div>
                  )}
                  <div className="p-6 lg:p-7 pb-0 lg:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-paper flex items-center justify-center text-mkt-ink shrink-0">
                          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display font-semibold text-[1.45rem] leading-tight text-mkt-ink">{plan.name}</h3>
                      </div>
                      <span className="font-display italic text-mkt-muted text-lg leading-none pt-1" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    {view.live && view.planKey === key && view.isLegacy && (
                      <p className="mt-2 text-[12px] text-mkt-muted" data-testid={`text-legacy-${key}`}>Your {view.displayName} features match this plan</p>
                    )}
                    <p className="text-[14.5px] text-mkt-ink-soft pt-3 leading-relaxed">{plan.tagline}</p>
                    <div className="pt-5 font-display font-semibold text-mkt-ink leading-none" data-testid={`text-price-${key}`}>
                      <span className="text-[2.9rem] tracking-[-0.02em]">{formatUsd(planPriceCents(plan, interval))}</span>
                      <span className="font-sans text-[15px] font-medium text-mkt-muted ml-1">{intervalSuffix(interval)}</span>
                    </div>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-mkt-muted min-h-[2.5rem]" data-testid={`text-price-note-${key}`}>
                      {interval === "year"
                        ? `${formatUsd(Math.round(plan.annualCents / 12))}/mo billed yearly · save ${formatUsd(annualSavingsCents(plan))}`
                        : `or ${formatUsd(plan.annualCents)}/yr (${monthsFree} months free)`}
                      {key === "agency" && (
                        <span className="block">
                          {AGENCY_INCLUDED_LOCATIONS} locations included, then {formatUsd(Math.max(...bandPrices))} down to {formatUsd(Math.min(...bandPrices))} per location
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col flex-1 p-6 lg:p-7 pt-5 lg:pt-5">
                    <ul className="space-y-2.5 flex-1 border-t border-mkt-rule pt-5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5 text-[14px] leading-snug text-mkt-ink">
                          <Check className="w-4 h-4 shrink-0 mt-0.5 text-mkt-orange-ink" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-2 pt-6">
                      <Button
                        className={`w-full h-11 rounded-lg text-[15px] font-semibold ${current ? "border-2 border-mkt-rule bg-transparent text-mkt-ink-soft" : style.button}`}
                        variant={current ? "outline" : "default"}
                        disabled={current || busy}
                        onClick={() => choosePlan(request)}
                        data-testid={`button-subscribe-${key}`}
                      >
                        {pending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                        {ctaLabel(key)}
                      </Button>
                      {key === "agency" && (
                        <button type="button" onClick={() => jumpTo("agency")} className="w-full text-[13px] font-semibold text-mkt-ink-soft hover:text-mkt-ink underline decoration-mkt-orange-soft decoration-2 underline-offset-4 inline-flex items-center justify-center gap-1" data-testid="link-agency-calculator">
                          Price more than {AGENCY_INCLUDED_LOCATIONS} locations <ArrowDown className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-center text-[13px] text-mkt-muted mt-6">
            No free plan. A new account's first plan starts with the {TRIAL_DAYS}-day trial. Prices in USD.
          </p>
        </div>

        <section id="comparison" className="scroll-mt-16" aria-labelledby="comparison-heading">
          <SectionHead n="01" kicker="Compare" lede="What each plan includes, side by side.">
            <h2 id="comparison-heading" className={H2} data-testid="text-comparison-heading">Compare <em className="text-mkt-orange-ink">plans</em></h2>
          </SectionHead>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-mkt-rule bg-mkt-card" data-testid="table-plan-comparison">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="border-b border-mkt-rule">
                  <th scope="col" className="sticky left-0 z-10 bg-mkt-card text-left p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted min-w-[140px] sm:min-w-[200px]">Feature</th>
                  {PLAN_KEYS.map((key) => (
                    <th key={key} scope="col" className={`p-4 text-center min-w-[110px] ${key === "pro" ? "bg-[color:var(--mkt-orange-soft)]" : ""}`}>
                      <span className="block font-display font-semibold text-[1.15rem] text-mkt-ink">{PLANS[key].name}</span>
                      <span className="block text-[12px] font-medium text-mkt-muted">
                        {formatUsd(planPriceCents(PLANS[key], interval))}{intervalSuffix(interval)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.flatMap((section) => [
                  <tr key={`s-${section.title}`} className="bg-mkt-paper-2 border-b border-mkt-rule">
                    <th scope="colgroup" colSpan={PLAN_KEYS.length + 1} className="sticky left-0 text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink">{section.title}</th>
                  </tr>,
                  ...section.rows.map((r) => (
                    <tr key={r.key} className="border-b border-dotted border-mkt-rule last:border-b-0" data-testid={`row-compare-${r.key}`}>
                      <th scope="row" className="sticky left-0 z-10 bg-mkt-card px-4 py-3 text-left font-medium text-mkt-ink">{r.label}</th>
                      {PLAN_KEYS.map((key) => (
                        <td key={key} className="px-4 py-3 text-center text-mkt-ink" data-testid={`cell-compare-${r.key}-${key}`}>
                          <CompareValue value={r.cells[key]} />
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </section>

        <section id="agency" className="scroll-mt-16" aria-labelledby="agency-heading">
          <SectionHead
            n="02"
            kicker="Agency"
            lede={<>
              {formatUsd(PLANS.agency.monthlyCents)}/mo includes {AGENCY_INCLUDED_LOCATIONS} client locations. Each location above that is
              priced by the band it falls in, like tax brackets, so adding a location never lowers the bill.
            </>}
          >
            <h2 id="agency-heading" className={H2}>Agency pricing <em className="text-mkt-orange-ink">by location</em></h2>
          </SectionHead>
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-mkt-rule bg-mkt-card overflow-hidden">
              <table className="w-full text-[14px]" data-testid="table-agency-bands">
                <thead>
                  <tr className="border-b border-mkt-rule">
                    <th scope="col" className="text-left p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Locations</th>
                    <th scope="col" className="text-right p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Per location / month</th>
                  </tr>
                </thead>
                <tbody>
                  {agencyBandRows().map((b) => (
                    <tr key={b.label} className="border-b border-dotted border-mkt-rule last:border-0">
                      <td className="px-4 py-3 font-display font-semibold text-[1.05rem] text-mkt-ink">{b.label}</td>
                      <td className="px-4 py-3 text-right text-mkt-ink">
                        {b.centsPerLocation === null ? "Talk to a sales rep" : b.centsPerLocation === 0 ? `Included in ${formatUsd(PLANS.agency.monthlyCents)}` : formatUsd(b.centsPerLocation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-mkt-rule bg-mkt-card overflow-hidden flex flex-col" data-testid="card-agency-calculator">
              <div className="relative bg-mkt-panel text-mkt-panel-ink px-5 py-3.5 flex items-center gap-2.5">
                <div className="absolute inset-0 mkt-grid-paper-panel opacity-60" aria-hidden />
                <Building2 className="relative w-4 h-4 text-mkt-orange" aria-hidden />
                <span className="relative text-[11px] font-semibold uppercase tracking-[0.16em]">{PLANS.agency.name} calculator</span>
              </div>
              <div className="p-5 lg:p-6 space-y-5 flex-1">
                <div className="space-y-2">
                  <Label htmlFor="agency-locations" className="text-[13px] font-semibold text-mkt-ink">How many client locations?</Label>
                  <Input
                    id="agency-locations"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={agencyInput}
                    onChange={(e) => setAgencyInput(e.target.value)}
                    onBlur={() => setAgencyInput(String(agencyLocations))}
                    className="h-11 rounded-lg text-[15px] md:text-[15px]"
                    data-testid="input-agency-locations"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {AGENCY_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setAgencyInput(String(n))}
                        className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${agencyLocations === n ? "border-mkt-panel bg-mkt-panel text-mkt-panel-ink" : "border-mkt-rule text-mkt-ink-soft hover:border-mkt-ink hover:text-mkt-ink"}`}
                        data-testid={`button-agency-preset-${n}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {quote.sales ? (
                  <div className="space-y-3 border-t border-mkt-rule pt-5" data-testid="text-agency-sales">
                    <p className="font-display font-semibold text-[1.4rem] leading-tight text-mkt-ink" data-testid="text-agency-total">
                      {quote.locations.toLocaleString("en-US")} locations = Talk to a sales rep
                    </p>
                    <p className="text-[14px] text-mkt-ink-soft">Above {AGENCY_SELF_SERVE_MAX_LOCATIONS.toLocaleString("en-US")} locations we price the workspace with you.</p>
                    <TalkToSalesButton topic={`Agency plan — ${quote.locations.toLocaleString("en-US")} locations`} className={`w-full ${NAVY_BUTTON}`} data-testid="button-agency-sales" />
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-mkt-rule pt-5">
                    <p className="font-display font-semibold text-[1.75rem] leading-tight text-mkt-ink" data-testid="text-agency-total">
                      {quote.locations.toLocaleString("en-US")} location{quote.locations === 1 ? "" : "s"} = {formatUsd(interval === "year" ? quote.annualCents : quote.monthlyCents)}{intervalSuffix(interval)}
                    </p>
                    <ul className="space-y-1.5 text-[14px]" data-testid="list-agency-breakdown">
                      {quote.lines.map((l) => (
                        <li key={l.label} className="flex justify-between gap-3 border-b border-dotted border-mkt-rule pb-1.5 last:border-0">
                          <span className="text-mkt-ink-soft">
                            {l.label}{l.centsPerLocation > 0 ? ` · ${l.count.toLocaleString("en-US")} × ${formatUsd(l.centsPerLocation)}` : ""}
                          </span>
                          <span className="font-semibold text-mkt-ink">{formatUsd(l.subtotalCents)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12.5px] text-mkt-muted leading-relaxed">
                      {interval === "year"
                        ? `Billed yearly: ${monthsFree} months free versus ${formatUsd(quote.monthlyCents)}/mo.`
                        : `Or ${formatUsd(quote.annualCents)}/yr billed yearly (${monthsFree} months free).`}
                      {quote.locations > AGENCY_INCLUDED_LOCATIONS && ` About ${formatUsd(Math.round(quote.monthlyCents / quote.locations))} per location per month.`}
                    </p>
                    <Button
                      className={`w-full ${NAVY_BUTTON}`}
                      disabled={busy || (isCurrent("agency") && view.locations === quote.locations)}
                      onClick={() => choosePlan({ plan: "agency", interval, locations: quote.locations })}
                      data-testid="button-agency-start"
                    >
                      {busy && pendingPlan?.plan === "agency" && pendingPlan.locations === quote.locations && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                      {isCurrent("agency")
                        ? (view.locations === quote.locations ? "Your current location count" : `Change to ${quote.locations.toLocaleString("en-US")} locations`)
                        : view.live ? `Switch to ${PLANS.agency.name} with ${quote.locations.toLocaleString("en-US")} locations`
                        : startLabel("agency")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="add-ons" className="scroll-mt-16" aria-labelledby="addons-heading">
          <SectionHead
            n="03"
            kicker="Add-ons"
            lede={<>
              Need one more of something? Add it to your plan instead of moving up a plan.
              {addonsEditable ? " Add or remove them any time in Settings → Billing." : " Add them in Settings → Billing once you're subscribed to one of these plans."}
            </>}
          >
            <h2 id="addons-heading" className={H2} data-testid="text-addons-heading">Add-ons: <em className="text-mkt-orange-ink">pay per feature</em></h2>
          </SectionHead>
          {/* The AI Call Assistant: four tiers, one per subscription (shared/plans.ts CALL_ASSISTANT_TIERS). */}
          <div className="mt-10 max-w-5xl mx-auto space-y-3" id="call-assistant-tiers" data-testid="block-addon-call-assistant">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display font-semibold text-[1.4rem] leading-tight text-mkt-ink">{CALL_ASSISTANT_NAME}: pick a tier</h3>
              <Link href="/call-assistant" className={TEXT_LINK} data-testid="link-addon-call-assistant">How it works →</Link>
            </div>
            <p className="text-[14px] font-semibold text-mkt-orange-ink" data-testid="text-addon-intro-call_assistant">
              {/* The intro is Solo, monthly-only; on the yearly toggle say what yearly is (add-ons follow the plan's billing). */}
              {interval === "year" ? callAssistantYearlyNote() : `Regular prices from ${callAssistantPricing().from}/mo (${callAssistantPricing().fromTier}). Solo launch price: ${callAssistantIntroShort()}`}
            </p>
            <CallAssistantTierCards interval={interval} />
          </div>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-mkt-rule bg-mkt-card max-w-5xl mx-auto">
            <table className="w-full text-[14px]" data-testid="table-addons">
              <thead>
                <tr className="border-b border-mkt-rule">
                  <th scope="col" className="text-left p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Add-on</th>
                  <th scope="col" className="text-right p-4 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Price</th>
                  <th scope="col" className="hidden sm:table-cell text-left p-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">Available on</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ADDONS) as AddonKey[]).filter((k) => !CALL_ASSISTANT_TIER_ADDONS.includes(k)).map((k) => {
                  const addon = ADDONS[k];
                  return (
                    <tr key={k} className="border-b border-dotted border-mkt-rule last:border-0" data-testid={`row-addon-${k}`}>
                      <td className="px-4 py-3.5 align-top">
                        {/* a div, not a <p>: the Badge renders a <div>, which a <p> may not contain */}
                        <div className="font-display font-semibold text-[1.05rem] text-mkt-ink flex items-center gap-2 flex-wrap">
                          {addon.name}
                          {addon.preview && <Badge variant="outline" className="font-sans text-[10px] rounded-full border-mkt-orange text-mkt-orange-ink" data-testid={`badge-addon-preview-${k}`}>Coming soon</Badge>}
                        </div>
                        <p className="text-[13px] text-mkt-ink-soft mt-0.5">{addon.description}</p>
                        <p className="sm:hidden text-[12px] text-mkt-muted mt-1">On {addonPlanNames(addon)}</p>
                      </td>
                      <td className="px-4 py-3.5 align-top text-right whitespace-nowrap" data-testid={`text-addon-price-${k}`}>
                        <span className="font-semibold text-mkt-ink">{formatUsd(addonPriceCents(addon, interval))}{intervalSuffix(interval)}</span>
                        {addon.setupCents ? <span className="block text-[12px] text-mkt-muted">+ {formatUsd(addon.setupCents)} setup</span> : null}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3.5 align-top text-mkt-ink-soft">{addonPlanNames(addon)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {addonsEditable && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={() => setLocation("/settings?tab=billing")} className="h-11 rounded-lg border-2 [border-color:var(--mkt-ink)] font-semibold" data-testid="button-manage-addons">
                <Settings2 className="w-4 h-4 mr-2" /> Manage add-ons
              </Button>
            </div>
          )}
        </section>

        {/* #services is where every "Talk to a sales rep" link lands (SALES_HREF in
            shared/plan-copy.ts); #done-for-you is the older anchor the same section kept. */}
        <section id="services" className="scroll-mt-16" aria-labelledby="dfy-heading">
          <div id="done-for-you" className="scroll-mt-16">
            <SectionHead
              n="04"
              kicker="Done for you"
              lede={<>
                We quote these for your business. Tell a sales rep what you need and we'll scope it with you —
                the only thing we can't do is take your licensing exams for you.
              </>}
            >
              <h2 id="dfy-heading" className={H2} data-testid="text-dfy-heading">Done-for-you <em className="text-mkt-orange-ink">services</em></h2>
            </SectionHead>
            {/* The inquiry form for anyone sent here by a "Talk to a sales rep" link elsewhere on the site. */}
            <div className="mt-7 flex justify-center">
              <TalkToSalesButton topic="Done-for-you services" className={`${ORANGE_BUTTON} h-12 px-6 text-base`} data-testid="button-services-sales" />
            </div>
          </div>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {DFY_SERVICES.map((service, i) => (
              <ServiceCard key={service.id} service={service} index={i} />
            ))}
          </div>
          <p className="mt-6 text-center text-[13px] text-mkt-muted max-w-2xl mx-auto">
            Google decides search rankings, so nobody can guarantee them. Your service agreement spells out exactly what we deliver.
          </p>
        </section>
      </div>
      <PublicPageFooter />
    </div>

    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open && !changePlanMutation.isPending) setConfirm(null); }}>
      <AlertDialogContent data-testid="dialog-change-plan">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirm && (view.planKey === confirm.plan && !view.isLegacy && confirm.plan !== "agency"
              ? `Switch to ${intervalWord(confirm.interval)} billing?`
              : `Switch to ${PLANS[confirm.plan].name}?`)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm && (
              <>
                {confirmFrom} changes to {PLANS[confirm.plan].name}
                {confirm.plan === "agency" ? ` with ${(confirm.locations ?? AGENCY_INCLUDED_LOCATIONS).toLocaleString("en-US")} locations` : ""} at{" "}
                {planRequestPrice(confirm)}, billed {intervalWord(confirm.interval)}. No second subscription is created; you can review charges in Manage billing.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={changePlanMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); if (confirm) changePlanMutation.mutate(confirm); }}
            disabled={changePlanMutation.isPending}
            data-testid="button-confirm-change-plan"
          >
            {changePlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Switch plan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <TalkToSalesDialog
      open={salesTopic !== null}
      onOpenChange={(open) => { if (!open) setSalesTopic(null); }}
      topic={salesTopic ?? ""}
    />
    </>
  );
}

function ServiceCard({ service, index }: { service: (typeof DFY_SERVICES)[number]; index: number }) {
  const { toast } = useToast();
  const { addItem, isInCart } = useCart();
  const Icon = SERVICE_ICONS[service.id] ?? Briefcase;
  const salesOnly = isSalesOnlyService(service);
  const cartId = service.cartId ?? service.catalogIds[0];
  return (
    <div className="group flex flex-col rounded-2xl border border-mkt-rule bg-mkt-card p-6 lg:p-7 hover:border-mkt-ink transition-colors" data-testid={`card-service-${service.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-paper flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors shrink-0">
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </div>
        <span className="font-display italic text-mkt-muted text-lg leading-none" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <h3 className="mt-4 font-display font-semibold text-[1.25rem] leading-tight text-mkt-ink">{service.title}</h3>
      <p className="mt-2 text-[14.5px] text-mkt-ink-soft leading-relaxed">{service.blurb}</p>
      {service.bullets.length > 0 && (
        <ul className="mt-4 space-y-2 flex-1 border-t border-mkt-rule pt-4">
          {service.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[14px] text-mkt-ink">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-mkt-orange-ink" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-5 space-y-2">
        {salesOnly || !cartId ? (
          <TalkToSalesButton topic={service.title} className={`w-full ${OUTLINE_BUTTON}`} variant="outline" data-testid={`button-sales-${service.id}`} />
        ) : (
          <>
            <p className="font-display font-semibold text-[2rem] leading-none text-mkt-ink" data-testid={`text-service-price-${service.id}`}>{formatUsd(service.priceCents!)}</p>
            <Button
              className={`w-full ${isInCart(cartId) ? ORANGE_BUTTON : OUTLINE_BUTTON}`}
              variant={isInCart(cartId) ? "default" : "outline"}
              disabled={isInCart(cartId)}
              onClick={() => {
                if (addItem({ id: cartId, type: "dfy_service", name: service.title, price: service.priceCents!, description: service.blurb })) {
                  toast({ title: "Added to cart", description: `${service.title} has been added to your cart.` });
                }
              }}
              data-testid={`button-add-cart-${service.id}`}
            >
              {isInCart(cartId) ? "In cart" : "Add to cart"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** A section's kicker, heading and lede, centred — the feature pages' band head. */
function SectionHead({ n, kicker, lede, children }: { n: string; kicker: string; lede: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="text-center max-w-3xl mx-auto">
      <Kicker n={n} className="justify-center">{kicker}</Kicker>
      {children}
      <p className={`mt-5 ${LEAD} max-w-2xl mx-auto`}>{lede}</p>
    </div>
  );
}
