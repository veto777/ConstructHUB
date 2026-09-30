import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Wrench, Globe, Megaphone, Briefcase, Search, MessageSquare, PlusCircle, Settings2,
} from "lucide-react";
import {
  PLANS, PLAN_KEYS, ADDONS, TRIAL_DAYS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS,
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

const PLAN_STYLE: Record<PlanKey, { icon: any; card: string; chip: string; button: string; check: string }> = {
  starter: {
    icon: Zap, card: "border-blue-500/30 hover:border-blue-500/60", chip: "bg-blue-500/10 text-blue-500",
    button: "bg-blue-500 hover:bg-blue-600 text-white", check: "text-blue-500",
  },
  pro: {
    icon: Star, card: "ring-2 ring-[#F97316]/40 border-[#F97316]/40 hover:border-[#F97316]/70", chip: "bg-[#F97316]/10 text-[#F97316]",
    button: "bg-[#F97316] hover:bg-[#ea6c10] text-white", check: "text-[#F97316]",
  },
  growth: {
    icon: TrendingUp, card: "border-teal-500/30 hover:border-teal-500/60", chip: "bg-teal-500/10 text-teal-500",
    button: "bg-teal-500 hover:bg-teal-600 text-white", check: "text-teal-500",
  },
  agency: {
    icon: Building2, card: "border-purple-500/30 hover:border-purple-500/60", chip: "bg-purple-500/10 text-purple-500",
    button: "bg-purple-600 hover:bg-purple-700 text-white", check: "text-purple-500",
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
  if (value === true) return <Check className="w-5 h-5 text-green-500 mx-auto" aria-label="Included" />;
  if (value === false) return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" aria-label="Not included" />;
  return <span className="text-sm font-medium">{value}</span>;
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
  const startLabel = (plan: PlanKey) => (view.firstSubscription ? `Start ${TRIAL_DAYS}-day free trial` : `Choose ${PLANS[plan].name}`);
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
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-extrabold tracking-tight" data-testid="text-pricing-title">
            Plans &amp; pricing
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto" data-testid="text-trial">
            A new account starts any plan with a {TRIAL_DAYS}-day free trial. Cancel before it ends and you pay nothing.
            CRM included on every plan.
          </p>
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="inline-flex items-center rounded-full border border-border bg-muted/40 p-1"
            data-testid="toggle-interval"
          >
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => setBillingInterval(i)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${interval === i ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`button-interval-${i}`}
              >
                {i === "month" ? "Monthly" : "Annual"}
                {i === "year" && (
                  <span className="ml-1.5 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-green-600 dark:text-green-400">
                    {monthsFree} months free
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {view.live && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm" data-testid="banner-current-plan">
            <Badge variant="outline" className="px-3 py-1 text-sm border-green-500/30 text-green-600 dark:text-green-400" data-testid="badge-current-plan">
              <Check className="w-3.5 h-3.5 mr-1" />
              Your plan: {view.displayName}
              {view.interval ? ` · ${intervalWord(view.interval)}` : ""}
            </Badge>
            {view.isLegacy && view.planKey && (
              <span className="text-muted-foreground" data-testid="text-legacy-match">
                Your features now match {PLANS[view.planKey].name}.
              </span>
            )}
            {PAYMENT_PROBLEM_STATUSES.includes(subscription?.status ?? "") && (
              <span className="text-destructive" role="alert">Your last payment didn't go through. Update your card in Manage billing.</span>
            )}
            {view.viaStripe && (
              <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending} data-testid="button-manage-subscription">
                {portalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
                Manage billing
              </Button>
            )}
          </div>
        )}

        <div id="plans" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 scroll-mt-16">
          {PLAN_KEYS.map((key) => {
            const plan = PLANS[key];
            const style = PLAN_STYLE[key];
            const Icon = style.icon;
            const current = isCurrent(key);
            const request: PlanRequest = { plan: key, interval, ...(key === "agency" ? { locations: currentAgencyLocations } : {}) };
            const pending = busy && pendingPlan?.plan === key && pendingPlan.locations === request.locations;
            return (
              <Card key={key} className={`relative flex flex-col transition-colors ${style.card}`} data-testid={`card-plan-${key}`}>
                {PLAN_RIBBON[key] && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className={`border-none px-3 text-xs font-semibold ${style.button}`}>{PLAN_RIBBON[key]}</Badge>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.chip}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-xl">{plan.name}</CardTitle>
                      {view.live && view.planKey === key && view.isLegacy && (
                        <p className="text-[11px] text-muted-foreground" data-testid={`text-legacy-${key}`}>Your {view.displayName} features match this plan</p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground pt-2">{plan.tagline}</p>
                  <div className="pt-3" data-testid={`text-price-${key}`}>
                    <span className="text-4xl font-extrabold">{formatUsd(planPriceCents(plan, interval))}</span>
                    <span className="text-muted-foreground text-sm">{intervalSuffix(interval)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground min-h-[2rem]" data-testid={`text-price-note-${key}`}>
                    {interval === "year"
                      ? `${formatUsd(Math.round(plan.annualCents / 12))}/mo billed yearly · save ${formatUsd(annualSavingsCents(plan))}`
                      : `or ${formatUsd(plan.annualCents)}/yr (${monthsFree} months free)`}
                    {key === "agency" && (
                      <span className="block">
                        {AGENCY_INCLUDED_LOCATIONS} locations included, then {formatUsd(Math.max(...bandPrices))} down to {formatUsd(Math.min(...bandPrices))} per location
                      </span>
                    )}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col flex-1 space-y-4">
                  <ul className="space-y-2 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className={`w-4 h-4 shrink-0 mt-0.5 ${style.check}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2">
                    <Button
                      className={`w-full font-semibold border-0 ${current ? "" : style.button}`}
                      variant={current ? "outline" : "default"}
                      disabled={current || busy}
                      onClick={() => choosePlan(request)}
                      data-testid={`button-subscribe-${key}`}
                    >
                      {pending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                      {ctaLabel(key)}
                    </Button>
                    {key === "agency" && (
                      <button type="button" onClick={() => jumpTo("agency")} className="w-full text-xs text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center justify-center gap-1" data-testid="link-agency-calculator">
                        Price more than {AGENCY_INCLUDED_LOCATIONS} locations <ArrowDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground -mt-4">
          No free plan. A new account's first plan starts with the {TRIAL_DAYS}-day trial. Prices in USD.
        </p>

        <section id="comparison" className="space-y-4 scroll-mt-16" aria-labelledby="comparison-heading">
          <div className="text-center space-y-2">
            <h2 id="comparison-heading" className="text-2xl font-extrabold tracking-tight" data-testid="text-comparison-heading">Compare plans</h2>
            <p className="text-sm text-muted-foreground">What each plan includes, side by side.</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border" data-testid="table-plan-comparison">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th scope="col" className="sticky left-0 z-10 bg-muted text-left p-3 font-bold min-w-[140px] sm:min-w-[180px]">Feature</th>
                  {PLAN_KEYS.map((key) => (
                    <th key={key} scope="col" className="p-3 text-center font-bold min-w-[110px]">
                      <span className="block">{PLANS[key].name}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {formatUsd(planPriceCents(PLANS[key], interval))}{intervalSuffix(interval)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.flatMap((section) => [
                  <tr key={`s-${section.title}`} className="bg-muted/30">
                    <th scope="colgroup" colSpan={PLAN_KEYS.length + 1} className="sticky left-0 text-left p-3 font-bold">{section.title}</th>
                  </tr>,
                  ...section.rows.map((r) => (
                    <tr key={r.key} className="border-b border-border/50" data-testid={`row-compare-${r.key}`}>
                      <th scope="row" className="sticky left-0 z-10 bg-background p-3 text-left font-medium">{r.label}</th>
                      {PLAN_KEYS.map((key) => (
                        <td key={key} className="p-3 text-center" data-testid={`cell-compare-${r.key}-${key}`}>
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

        <section id="agency" className="space-y-5 scroll-mt-16" aria-labelledby="agency-heading">
          <div className="text-center space-y-2">
            <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20">
              <Building2 className="w-3.5 h-3.5 mr-1.5" /> Agency
            </Badge>
            <h2 id="agency-heading" className="text-2xl font-extrabold tracking-tight">Agency pricing by location</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              {formatUsd(PLANS.agency.monthlyCents)}/mo includes {AGENCY_INCLUDED_LOCATIONS} client locations. Each location above that is
              priced by the band it falls in, like tax brackets, so adding a location never lowers the bill.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl mx-auto">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm" data-testid="table-agency-bands">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th scope="col" className="text-left p-3">Locations</th>
                      <th scope="col" className="text-right p-3">Per location / month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agencyBandRows().map((b) => (
                      <tr key={b.label} className="border-b border-border/50 last:border-0">
                        <td className="p-3 font-medium">{b.label}</td>
                        <td className="p-3 text-right">
                          {b.centsPerLocation === null ? "Talk to a sales rep" : b.centsPerLocation === 0 ? `Included in ${formatUsd(PLANS.agency.monthlyCents)}` : formatUsd(b.centsPerLocation)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card className="border-purple-500/30" data-testid="card-agency-calculator">
              <CardContent className="p-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="agency-locations">How many client locations?</Label>
                  <Input
                    id="agency-locations"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={agencyInput}
                    onChange={(e) => setAgencyInput(e.target.value)}
                    onBlur={() => setAgencyInput(String(agencyLocations))}
                    data-testid="input-agency-locations"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {AGENCY_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setAgencyInput(String(n))}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${agencyLocations === n ? "border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400" : "border-border text-muted-foreground hover:text-foreground"}`}
                        data-testid={`button-agency-preset-${n}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {quote.sales ? (
                  <div className="space-y-3" data-testid="text-agency-sales">
                    <p className="text-lg font-bold" data-testid="text-agency-total">
                      {quote.locations.toLocaleString("en-US")} locations = Talk to a sales rep
                    </p>
                    <p className="text-sm text-muted-foreground">Above {AGENCY_SELF_SERVE_MAX_LOCATIONS.toLocaleString("en-US")} locations we price the workspace with you.</p>
                    <TalkToSalesButton topic={`Agency plan — ${quote.locations.toLocaleString("en-US")} locations`} className="w-full bg-purple-600 hover:bg-purple-700 text-white" data-testid="button-agency-sales" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-2xl font-extrabold" data-testid="text-agency-total">
                      {quote.locations.toLocaleString("en-US")} location{quote.locations === 1 ? "" : "s"} = {formatUsd(interval === "year" ? quote.annualCents : quote.monthlyCents)}{intervalSuffix(interval)}
                    </p>
                    <ul className="space-y-1 text-sm" data-testid="list-agency-breakdown">
                      {quote.lines.map((l) => (
                        <li key={l.label} className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            {l.label}{l.centsPerLocation > 0 ? ` · ${l.count.toLocaleString("en-US")} × ${formatUsd(l.centsPerLocation)}` : ""}
                          </span>
                          <span className="font-medium">{formatUsd(l.subtotalCents)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      {interval === "year"
                        ? `Billed yearly: ${monthsFree} months free versus ${formatUsd(quote.monthlyCents)}/mo.`
                        : `Or ${formatUsd(quote.annualCents)}/yr billed yearly (${monthsFree} months free).`}
                      {quote.locations > AGENCY_INCLUDED_LOCATIONS && ` About ${formatUsd(Math.round(quote.monthlyCents / quote.locations))} per location per month.`}
                    </p>
                    <Button
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white"
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
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="add-ons" className="space-y-4 scroll-mt-16" aria-labelledby="addons-heading">
          <div className="text-center space-y-2">
            <Badge className="bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20">
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Add-ons
            </Badge>
            <h2 id="addons-heading" className="text-2xl font-extrabold tracking-tight" data-testid="text-addons-heading">Add-ons: pay per feature</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              Need one more of something? Add it to your plan instead of moving up a plan.
              {addonsEditable ? " Add or remove them any time in Settings → Billing." : " Add them in Settings → Billing once you're subscribed to one of these plans."}
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border max-w-4xl mx-auto">
            <table className="w-full text-sm" data-testid="table-addons">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th scope="col" className="text-left p-3">Add-on</th>
                  <th scope="col" className="text-right p-3 whitespace-nowrap">Price</th>
                  <th scope="col" className="hidden sm:table-cell text-left p-3">Available on</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ADDONS) as AddonKey[]).map((k) => {
                  const addon = ADDONS[k];
                  return (
                    <tr key={k} className="border-b border-border/50 last:border-0" data-testid={`row-addon-${k}`}>
                      <td className="p-3 align-top">
                        <p className="font-medium">{addon.name}</p>
                        <p className="text-xs text-muted-foreground">{addon.description}</p>
                        <p className="sm:hidden text-xs text-muted-foreground mt-1">On {addonPlanNames(addon)}</p>
                      </td>
                      <td className="p-3 align-top text-right whitespace-nowrap" data-testid={`text-addon-price-${k}`}>
                        <span className="font-semibold">{formatUsd(addonPriceCents(addon, interval))}{intervalSuffix(interval)}</span>
                        {addon.setupCents ? <span className="block text-xs text-muted-foreground">+ {formatUsd(addon.setupCents)} setup</span> : null}
                      </td>
                      <td className="hidden sm:table-cell p-3 align-top text-muted-foreground">{addonPlanNames(addon)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {addonsEditable && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLocation("/settings?tab=billing")} data-testid="button-manage-addons">
                <Settings2 className="w-4 h-4 mr-2" /> Manage add-ons
              </Button>
            </div>
          )}
        </section>

        {/* #services is where every "Talk to a sales rep" link lands (SALES_HREF in
            shared/plan-copy.ts); #done-for-you is the older anchor the same section kept. */}
        <section id="services" className="space-y-6 scroll-mt-16" aria-labelledby="dfy-heading">
          <div id="done-for-you" className="text-center space-y-2 scroll-mt-16">
            <Badge className="bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20">
              <Briefcase className="w-3.5 h-3.5 mr-1.5" /> Done for you
            </Badge>
            <h2 id="dfy-heading" className="text-2xl font-extrabold tracking-tight" data-testid="text-dfy-heading">Done-for-you services</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              We quote these for your business. Tell a sales rep what you need and we'll scope it with you —
              the only thing we can't do is take your licensing exams for you.
            </p>
            {/* The inquiry form for anyone sent here by a "Talk to a sales rep" link elsewhere on the site. */}
            <TalkToSalesButton topic="Done-for-you services" className="mt-2 border-0 bg-[#F97316] hover:bg-[#ea6c10] text-white" data-testid="button-services-sales" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {DFY_SERVICES.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground max-w-2xl mx-auto">
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

function ServiceCard({ service }: { service: (typeof DFY_SERVICES)[number] }) {
  const { toast } = useToast();
  const { addItem, isInCart } = useCart();
  const Icon = SERVICE_ICONS[service.id] ?? Briefcase;
  const salesOnly = isSalesOnlyService(service);
  const cartId = service.cartId ?? service.catalogIds[0];
  return (
    <Card className="flex flex-col border-border/70 hover:border-[#F97316]/50 transition-colors" data-testid={`card-service-${service.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F97316]/10 text-[#F97316] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <CardTitle className="text-lg leading-snug">{service.title}</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground pt-2">{service.blurb}</p>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 space-y-4">
        {service.bullets.length > 0 && (
          <ul className="space-y-2 flex-1">
            {service.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 shrink-0 mt-0.5 text-green-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto space-y-2">
          {salesOnly || !cartId ? (
            <TalkToSalesButton topic={service.title} className="w-full" variant="outline" data-testid={`button-sales-${service.id}`} />
          ) : (
            <>
              <p className="text-2xl font-extrabold" data-testid={`text-service-price-${service.id}`}>{formatUsd(service.priceCents!)}</p>
              <Button
                className="w-full"
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
      </CardContent>
    </Card>
  );
}
