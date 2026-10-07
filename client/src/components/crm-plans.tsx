import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, X, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import {
  CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS, CRM_EXTRA_SEAT_MAX,
  crmPlanPriceCents, type CrmPlanKey,
} from "@shared/crm-plans";
import type { BillingInterval } from "@shared/plans";
import { PurchaseReviewDialog, type PurchaseReview } from "@/components/purchase-review";
import { inNativeApp } from "@/lib/app-shell";

/**
 * The CRM's plans — a separate product from the ConstructHUB platform plans,
 * with its own subscription (server/crm/billing.ts). Used on /pricing#crm and
 * as the CRM app's own "choose a plan" screen (returnTo="crm"). Every purchase
 * goes through the review dialog: what you get, and what you are NOT getting.
 */
export type CrmSubscriptionInfo = {
  plan: CrmPlanKey | null;
  planName: string | null;
  status: string;
  interval: BillingInterval | null;
  extraSeats: number;
  /** The JobCam add-on is on this subscription (CRM Basic / Essentials). */
  jobcamAddon?: boolean;
  /** JobCam is usable on this subscription: included by the plan or added. */
  jobcam?: boolean;
  seats: number;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasLiveSubscription: boolean;
  access: { active: boolean; via: "plan" | "beta" | "admin" | null };
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const per = (interval: BillingInterval) => (interval === "year" ? "/yr" : "/mo");

type Order = { plan: CrmPlanKey; interval: BillingInterval; extraSeats: number };

export function CrmPlanCards({ interval, signedIn, returnTo = "pricing" }: {
  interval: BillingInterval;
  signedIn: boolean;
  /** Where Stripe sends the buyer back to: the pricing page or the CRM app. */
  returnTo?: "pricing" | "crm";
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [extraSeats, setExtraSeats] = useState(0);
  const [review, setReview] = useState<Order | null>(null);

  const { data: sub, isPending: subPending } = useQuery<CrmSubscriptionInfo>({
    queryKey: ["/api/crm/billing/subscription"],
    enabled: signedIn,
  });
  const live = !!sub?.hasLiveSubscription;
  const included = sub?.access.via === "beta" || sub?.access.via === "admin";
  useEffect(() => { if (live) setExtraSeats(sub?.extraSeats ?? 0); }, [live, sub?.extraSeats]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/crm/billing/subscription"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
  };
  const fail = (title: string) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    setReview(null);
    refresh();
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });
  };

  const checkout = useMutation({
    mutationFn: async (o: Order) => (await apiRequest("POST", "/api/crm/billing/checkout", { ...o, returnTo })).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: fail("Couldn't start checkout"),
  });
  const change = useMutation({
    mutationFn: async (o: Order) => (await apiRequest("POST", "/api/crm/billing/change", o)).json(),
    onSuccess: (_data, o) => {
      setReview(null);
      refresh();
      toast({ title: "CRM plan changed", description: `You're now on ${CRM_PLANS[o.plan].name}${o.extraSeats ? ` with ${o.extraSeats} extra seat${o.extraSeats === 1 ? "" : "s"}` : ""}.` });
    },
    onError: fail("Couldn't change your CRM plan"),
  });
  const pending = checkout.isPending || change.isPending;

  const seatCents = interval === "year" ? CRM_EXTRA_SEAT_ANNUAL_CENTS : CRM_EXTRA_SEAT_MONTHLY_CENTS;
  const totalCents = (plan: CrmPlanKey) => crmPlanPriceCents(plan, interval) + extraSeats * seatCents;
  const isCurrent = (plan: CrmPlanKey) => live && sub?.plan === plan && sub?.interval === interval && sub?.extraSeats === extraSeats;

  const choose = (plan: CrmPlanKey) => {
    if (!signedIn) {
      setLocation(`/auth?mode=signup&next=${encodeURIComponent(`/pricing${interval === "year" ? "?interval=year" : ""}#crm`)}`);
      return;
    }
    setReview({ plan, interval, extraSeats });
  };

  const reviewData: PurchaseReview | null = review ? {
    name: CRM_PLANS[review.plan].name,
    product: "ConstructHUB CRM",
    price: `${usd(crmPlanPriceCents(review.plan, review.interval) + review.extraSeats * (review.interval === "year" ? CRM_EXTRA_SEAT_ANNUAL_CENTS : CRM_EXTRA_SEAT_MONTHLY_CENTS))}${per(review.interval)}`,
    note: live
      ? "Your CRM subscription changes in place and the difference is charged or credited now."
      : `A first CRM subscription starts with a ${CRM_TRIAL_DAYS}-day trial. It is billed separately from any ConstructHUB platform plan. Cancel any time.`,
    included: [
      ...CRM_PLANS[review.plan].features,
      ...(review.extraSeats ? [`${review.extraSeats} extra seat${review.extraSeats === 1 ? "" : "s"} (${CRM_PLANS[review.plan].limits.seats + review.extraSeats} seats in all)`] : []),
    ],
    notIncluded: CRM_PLANS[review.plan].notIncluded,
  } : null;

  return (
    <div data-testid="block-crm-plans">
      {included && (
        <p className="mb-5 text-center text-[14px] font-semibold" data-testid="text-crm-included">
          Your account already includes the CRM — there is nothing to buy.
        </p>
      )}
      {live && sub?.planName && (
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-sm" data-testid="banner-crm-current">
          <Badge variant="outline" className="px-3 py-1 rounded-full">
            Your CRM plan: {sub.planName}{sub.extraSeats ? ` + ${sub.extraSeats} extra seat${sub.extraSeats === 1 ? "" : "s"}` : ""}
          </Badge>
          {sub.status === "trialing" && sub.trialEndsAt && (
            <span className="text-muted-foreground">Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}</span>
          )}
          {sub.cancelAtPeriodEnd && <span className="text-muted-foreground">Set to end at the period's close</span>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {CRM_PLAN_KEYS.map((key) => {
          const plan = CRM_PLANS[key];
          const current = isCurrent(key);
          return (
            <div key={key} className={`relative flex flex-col rounded-2xl bg-card text-card-foreground border ${key === "crm_essentials" ? "border-2 border-primary" : "border-border"}`} data-testid={`card-crm-plan-${key}`}>
              {key === "crm_essentials" && (
                <div className="absolute -top-3 left-6 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">Most teams</div>
              )}
              <div className="p-6 pb-0">
                <h3 className="font-semibold text-[1.35rem] leading-tight">{plan.name}</h3>
                <p className="text-[14px] text-muted-foreground pt-2 leading-relaxed">{plan.tagline}</p>
                <div className="pt-4 font-semibold leading-none" data-testid={`text-crm-price-${key}`}>
                  <span className="text-[2.5rem] tracking-[-0.02em]">{usd(crmPlanPriceCents(key, interval))}</span>
                  <span className="text-[15px] font-medium text-muted-foreground ml-1">{per(interval)}</span>
                </div>
                <p className="mt-2 text-[12.5px] text-muted-foreground min-h-[2.25rem]">
                  {interval === "year"
                    ? `${usd(Math.round(plan.annualCents / 12))}/mo billed yearly · save ${usd(plan.monthlyCents * 12 - plan.annualCents)}`
                    : `or ${usd(plan.annualCents)}/yr (${usd(Math.round(plan.annualCents / 12))}/mo)`}
                </p>
              </div>
              <div className="flex flex-col flex-1 p-6 pt-4">
                <ul className="space-y-2 border-t border-border pt-4" data-testid={`list-crm-features-${key}`}>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[14px] leading-snug">
                      <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /><span>{f}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Not included</p>
                <ul className="mt-2 space-y-1.5 flex-1" data-testid={`list-crm-not-included-${key}`}>
                  {plan.notIncluded.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
                      <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" /><span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full h-11 mt-5 text-[15px] font-semibold"
                  variant={key === "crm_essentials" && !current ? "default" : "outline"}
                  disabled={current || pending || included || (signedIn && subPending)}
                  onClick={() => choose(key)}
                  data-testid={`button-crm-subscribe-${key}`}
                >
                  {pending && review?.plan === key && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  {current ? "Current CRM plan" : live ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-[14px]" data-testid="block-crm-extra-seats">
        <span>Extra seats ({usd(seatCents)}{per(interval)} each):</span>
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={extraSeats <= 0} onClick={() => setExtraSeats((n) => Math.max(0, n - 1))} aria-label="Fewer extra seats" data-testid="button-crm-seats-minus"><Minus className="w-4 h-4" /></Button>
          <span className="w-8 text-center font-semibold tabular-nums" data-testid="text-crm-extra-seats">{extraSeats}</span>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={extraSeats >= CRM_EXTRA_SEAT_MAX} onClick={() => setExtraSeats((n) => Math.min(CRM_EXTRA_SEAT_MAX, n + 1))} aria-label="More extra seats" data-testid="button-crm-seats-plus"><Plus className="w-4 h-4" /></Button>
        </div>
        {extraSeats > 0 && (
          <span className="text-muted-foreground" data-testid="text-crm-seat-totals">
            {CRM_PLAN_KEYS.map((k) => `${CRM_PLANS[k].name} ${usd(totalCents(k))}${per(interval)}`).join(" · ")}
          </span>
        )}
      </div>
      <p className="text-center text-[13px] text-muted-foreground mt-4" data-testid="text-crm-trial">
        The CRM is its own subscription, billed separately from the ConstructHUB platform plans. A first CRM subscription starts with a {CRM_TRIAL_DAYS}-day trial. Prices in USD.
      </p>

      <PurchaseReviewDialog
        review={reviewData}
        pending={pending}
        confirmLabel={live ? "Change my CRM plan" : "Continue to payment"}
        onClose={() => setReview(null)}
        onConfirm={() => { if (review) (live ? change : checkout).mutate(review); }}
      />
    </div>
  );
}

/**
 * The CRM app's screen for an account without a CRM plan: the workspace is not
 * shown, the plans are. A team member (not the owner) cannot buy — the plan is
 * the owner's — so they are told who to ask.
 */
export function CrmPaywall({ isOwner, orgName }: { isOwner: boolean; orgName?: string }) {
  const { toast } = useToast();
  const [interval, setInterval] = useState<BillingInterval>("month");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("crm_canceled")) toast({ title: "Checkout canceled", description: "No charges were made." });
  }, [toast]);
  // The iPhone apps sell nothing (App Store 3.1.3(f); docs/app/APP-STORE-PLAN.md):
  // no plan names, no prices, no link to Pricing.
  if (inNativeApp()) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" data-testid="page-crm-paywall">
        <h1 className="text-2xl font-semibold">The CRM isn't on this account</h1>
        <p className="mt-3 text-muted-foreground">Sign in with an account that has the CRM, or ask your account owner.</p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl mx-auto px-4 py-10" data-testid="page-crm-paywall">
      <h1 className="text-2xl sm:text-3xl font-semibold text-center">Choose a CRM plan to open the CRM</h1>
      <p className="mt-3 text-center text-muted-foreground max-w-2xl mx-auto">
        The ConstructHUB CRM is its own product with its own subscription. A ConstructHUB platform plan
        (Starter, Pro, Growth, Agency) does not include it, and a CRM plan does not include the platform tools.
      </p>
      {isOwner ? (
        <>
          <div className="mt-6 flex justify-center">
            <div className="inline-flex rounded-lg border border-border p-1 text-sm" role="group" aria-label="Billing interval">
              {(["month", "year"] as const).map((i) => (
                <button key={i} type="button" onClick={() => setInterval(i)} data-testid={`toggle-crm-interval-${i}`}
                  className={`px-4 py-1.5 rounded-md font-medium ${interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  {i === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-8"><CrmPlanCards interval={interval} signedIn returnTo="crm" /></div>
        </>
      ) : (
        <p className="mt-8 text-center font-medium" data-testid="text-crm-paywall-member">
          {orgName ? `${orgName}'s` : "This team's"} CRM subscription is not active. Ask the account owner to choose a CRM plan.
        </p>
      )}
    </div>
  );
}
