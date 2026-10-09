/**
 * The AI Call Assistant's four tiers in the app's own (shadcn) look. The
 * service is sold on its OWN subscription (owner, 2026-10-08), apart from the
 * platform plans — the CRM's pattern (components/crm-plans.tsx). Every figure
 * is the price book's (shared/plans.ts CALL_ASSISTANT_TIERS through
 * shared/plan-copy.ts callAssistantTiers) — nothing here types a price.
 *
 *   CallAssistantTierCards — four cards (4-up on desktop, 2-up on tablets,
 *     stacked on phones), the interval the page shows; display only
 *   CallAssistantPlanCards — the pricing page's section: the cards with a buy
 *     button each (a first purchase goes through the review dialog, then
 *     POST /api/call-assistant/billing/checkout; a subscriber switches tiers in
 *     place through POST /api/call-assistant/billing/change after the
 *     number-release confirm), the extra-number picker and the yearly note
 *   CallAssistantTierPicker — the held tier and a switch to each other one
 *     (Settings → Billing and Limits & usage). A switch goes through the Call
 *     Assistant change flow (pages/settings/use-billing.tsx
 *     useCallAssistantChange): a smaller tier that keeps fewer numbers than the
 *     account holds asks first and names them.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, Loader2, Minus, PhoneCall, Plus, ShieldBan } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import { PurchaseReviewDialog, type PurchaseReview } from "@/components/purchase-review";
import { ADDONS, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_NAME, ADDON_MAX_QUANTITY, callAssistantTierOf, type AddonKey, type BillingInterval, type CallAssistantTierKey } from "@shared/plans";
import { CRM_PLANS } from "@shared/crm-plans";
import { callAssistantPricing, callAssistantTiers, callAssistantYearlyNote, callAssistantAboveTopLine, formatUsd } from "@shared/plan-copy";

const suffix = (interval: BillingInterval) => (interval === "year" ? "/yr" : "/mo");
/** The extra number's price per interval, from the price book. */
const extraNumberCents = (interval: BillingInterval) => (interval === "year" ? ADDONS.call_number.annualCents : ADDONS.call_number.monthlyCents);

/** GET /api/call-assistant/billing/subscription (server/voice/subscription.ts callAssistantSummary + access). */
export type CallAssistantSubscriptionInfo = {
  tier: CallAssistantTierKey | null;
  tierName: string | null;
  addon: AddonKey | null;
  status: string;
  interval: BillingInterval | null;
  extraNumbers: number;
  numbers: number;
  minutes: number;
  addons: Partial<Record<AddonKey, number>>;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasLiveSubscription: boolean;
  /** "off": minutes above the tier are metered and shown but not charged yet (the server's CALL_ASSISTANT_OVERAGE_BILLING switch). */
  overageBilling?: "on" | "off";
  access: { enabled: boolean; paused: boolean; via: "subscription" | "admin" | null };
};

export const CALL_ASSISTANT_SUBSCRIPTION_KEY = ["/api/call-assistant/billing/subscription"] as const;

/** Everything a Call Assistant purchase or change touches on the client. */
export function refreshCallAssistantBilling() {
  void queryClient.invalidateQueries({ queryKey: CALL_ASSISTANT_SUBSCRIPTION_KEY });
  void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/crm/voice/status"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
}

/** The tier the pricing page recommends (the second one: the owner's entry point for most trades). */
const featured = (tier: CallAssistantTierKey) => tier === CALL_ASSISTANT_TIERS[1]?.tier;

/** Four tier cards (`interval` follows the page's monthly/yearly toggle). `action` renders a button under each card. */
export function CallAssistantTierCards({ interval, className, action, current }: {
  interval: BillingInterval;
  className?: string;
  action?: (tier: ReturnType<typeof callAssistantTiers>[number]) => React.ReactNode;
  /** The tier the account holds (its card is marked). */
  current?: CallAssistantTierKey | null;
}) {
  const p = callAssistantPricing();
  return (
    <div className={cn("space-y-3", className)} data-testid="section-call-assistant-tiers">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {p.tiers.map((t) => (
          <div
            key={t.tier}
            className={cn("relative rounded-xl border bg-card p-4 flex flex-col", featured(t.tier) && "ring-2 ring-[#F97316]/40 border-[#F97316]/40", current === t.tier && "border-primary/60 bg-primary/5")}
            data-testid={`card-call-assistant-tier-${t.tier}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <PhoneCall className="h-4 w-4 text-[#F97316]" aria-hidden="true" />
              <h3 className="font-semibold">{t.name}</h3>
              {current === t.tier && <Badge variant="outline" className="text-[10px]">Current</Badge>}
              {p.comingSoon && <Badge variant="outline" className="text-[10px]">Coming soon</Badge>}
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight" data-testid={`text-call-assistant-tier-price-${t.tier}`}>
              {interval === "year" ? t.annual : t.monthly}<span className="text-sm font-medium text-muted-foreground">{suffix(interval)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{interval === "year" ? `or ${t.monthly}/mo on monthly billing` : `or ${t.annual}/yr on yearly billing (${p.annualFreeMonths === 1 ? "one month" : `${p.annualFreeMonths} months`} free)`}</p>
            <ul className="mt-3 space-y-1.5 text-sm flex-1">
              <li className="flex gap-2"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> {t.minutes} call minutes a month</li>
              <li className="flex gap-2"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> {t.numbersLabel} included</li>
              <li className="flex gap-2 text-muted-foreground"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> Fits {t.estimatedCalls} (estimate)</li>
              <li className="flex gap-2" data-testid={`text-call-assistant-tier-overage-${t.tier}`}>
                <Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> {t.overageShort}/min over
              </li>
            </ul>
            {action && <div className="mt-4">{action(t)}</div>}
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-[#F97316]/30 bg-[#F97316]/5 px-4 py-3 text-sm flex flex-wrap items-start gap-2" data-testid="text-call-assistant-tiers-every">
        <ShieldBan className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">Every tier:</span> the first {p.freeSpamCalls} spam calls each month are free (they never count toward your minutes); spam is screened and repeat spammers are blocked before they're answered.
          Above the included minutes, {p.overageLine}. Extra local numbers {p.extraNumber}/mo each. {callAssistantAboveTopLine()}
        </span>
      </div>
    </div>
  );
}

type Order = { tier: CallAssistantTierKey; interval: BillingInterval; extraNumbers: number };

/**
 * The pricing page's Call Assistant section: the cards with a buy or switch
 * button each, the extra-number picker and the yearly note. A first purchase
 * is reviewed (what you get, what you are NOT getting) before Stripe; a
 * subscriber's switch goes through the change route (a smaller tier releases
 * the newest numbers — the server decides, Settings → Billing shows which).
 */
export function CallAssistantPlanCards({ interval, signedIn }: { interval: BillingInterval; signedIn: boolean }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [extraNumbers, setExtraNumbers] = useState(0);
  const [review, setReview] = useState<Order | null>(null);
  const p = callAssistantPricing();

  const { data: sub, isPending: subPending } = useQuery<CallAssistantSubscriptionInfo>({
    queryKey: CALL_ASSISTANT_SUBSCRIPTION_KEY,
    enabled: signedIn,
  });
  const live = !!sub?.hasLiveSubscription;
  const included = sub?.access.via === "admin";
  useEffect(() => { if (live) setExtraNumbers(sub?.extraNumbers ?? 0); }, [live, sub?.extraNumbers]);

  const fail = (title: string) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    setReview(null);
    refreshCallAssistantBilling();
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });
  };
  const checkout = useMutation({
    mutationFn: async (o: Order) => (await apiRequest("POST", "/api/call-assistant/billing/checkout", o)).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: fail("Couldn't start checkout"),
  });
  const change = useMutation({
    mutationFn: async (o: Order) => (await apiRequest("POST", "/api/call-assistant/billing/change", o)).json(),
    onSuccess: (_data, o) => {
      setReview(null);
      refreshCallAssistantBilling();
      const tier = CALL_ASSISTANT_TIERS.find((t) => t.tier === o.tier);
      toast({ title: `${CALL_ASSISTANT_NAME} changed`, description: `You're now on the ${tier?.name ?? o.tier} tier${o.extraNumbers ? ` with ${o.extraNumbers} extra number${o.extraNumbers === 1 ? "" : "s"}` : ""}.` });
    },
    onError: fail(`Couldn't change your ${CALL_ASSISTANT_NAME}`),
  });
  const pending = checkout.isPending || change.isPending;

  const numberCents = extraNumberCents(interval);
  const isCurrent = (tier: CallAssistantTierKey) => live && sub?.tier === tier && sub?.interval === interval && sub?.extraNumbers === extraNumbers;

  const choose = (tier: CallAssistantTierKey) => {
    if (!signedIn) {
      setLocation(`/auth?mode=signup&next=${encodeURIComponent(`/pricing${interval === "year" ? "?interval=year" : ""}#call-assistant`)}`);
      return;
    }
    setReview({ tier, interval, extraNumbers });
  };

  const reviewTier = review ? p.tiers.find((t) => t.tier === review.tier) ?? null : null;
  const reviewData: PurchaseReview | null = review && reviewTier ? {
    name: reviewTier.fullName,
    product: CALL_ASSISTANT_NAME,
    price: `${formatUsd((review.interval === "year" ? reviewTier.annualCents : reviewTier.monthlyCents) + review.extraNumbers * extraNumberCents(review.interval))}${suffix(review.interval)}`,
    note: live
      ? "Your Call Assistant subscription changes in place and the difference is charged or credited now. A smaller tier keeps fewer numbers: the newest extras stop answering and are released."
      : "Billed on its own subscription from the first invoice, separately from any ConstructHUB plan or CRM plan. No trial, no intro price. Cancel any time; the Call Assistant number is part of the service and is released when it ends.",
    included: [
      `${reviewTier.minutes} call minutes a month, then ${reviewTier.overage} a minute`,
      `${reviewTier.numbersLabel} included${review.extraNumbers ? ` + ${review.extraNumbers} extra number${review.extraNumbers === 1 ? "" : "s"}` : ""}`,
      `The first ${p.freeSpamCalls} spam calls each month free`,
      "Every voice, the Agent Studio, the Simulator and the call log",
    ],
    notIncluded: [
      "A ConstructHUB platform plan (Starter, Pro, Growth, Agency) — bought separately, not needed for this",
      `The ConstructHUB CRM — a separate product, from ${formatUsd(CRM_PLANS.crm_basic.monthlyCents)}/mo; leads are filed for the CRM, and the Call Assistant's own Calls tab shows every call`,
      "Appointment booking (not available yet) and outbound calls",
    ],
  } : null;

  return (
    <div data-testid="block-call-assistant-plans">
      {included && (
        <p className="mb-5 text-center text-[14px] font-semibold" data-testid="text-call-assistant-included">
          Your account already includes the {CALL_ASSISTANT_NAME} — there is nothing to buy.
        </p>
      )}
      {live && sub?.tierName && (
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-sm" data-testid="banner-call-assistant-current">
          <Badge variant="outline" className="px-3 py-1 rounded-full">
            Your {CALL_ASSISTANT_NAME}: {sub.tierName}{sub.extraNumbers ? ` + ${sub.extraNumbers} extra number${sub.extraNumbers === 1 ? "" : "s"}` : ""}{sub.interval ? ` · billed ${sub.interval === "year" ? "yearly" : "monthly"}` : ""}
          </Badge>
          {sub.cancelAtPeriodEnd && <span className="text-muted-foreground">Set to end at the period's close</span>}
        </div>
      )}
      <CallAssistantTierCards
        interval={interval}
        current={live ? sub?.tier ?? null : null}
        action={(t) => {
          const current = isCurrent(t.tier);
          return (
            <Button
              className="w-full"
              variant={featured(t.tier) && !current ? "default" : "outline"}
              disabled={current || pending || included || p.comingSoon || (signedIn && subPending)}
              onClick={() => choose(t.tier)}
              data-testid={`button-call-assistant-subscribe-${t.tier}`}
            >
              {pending && review?.tier === t.tier && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {current ? "Current tier" : live ? `Switch to ${t.name}` : `Choose ${t.name}`}
            </Button>
          );
        }}
      />
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-[14px]" data-testid="block-call-assistant-extra-numbers">
        <span>Extra local numbers ({formatUsd(numberCents)}{suffix(interval)} each):</span>
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={extraNumbers <= 0} onClick={() => setExtraNumbers((n) => Math.max(0, n - 1))} aria-label="Fewer extra numbers" data-testid="button-call-assistant-numbers-minus"><Minus className="w-4 h-4" /></Button>
          <span className="w-8 text-center font-semibold tabular-nums" data-testid="text-call-assistant-extra-numbers">{extraNumbers}</span>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={extraNumbers >= ADDON_MAX_QUANTITY} onClick={() => setExtraNumbers((n) => Math.min(ADDON_MAX_QUANTITY, n + 1))} aria-label="More extra numbers" data-testid="button-call-assistant-numbers-plus"><Plus className="w-4 h-4" /></Button>
        </div>
      </div>
      <p className="text-center text-[13px] text-muted-foreground mt-4" data-testid="text-call-assistant-separate">
        {p.separateLine} {callAssistantYearlyNote()}. No trial and no intro price. Prices in USD.
      </p>

      <PurchaseReviewDialog
        review={reviewData}
        pending={pending}
        confirmLabel={live ? `Change my ${CALL_ASSISTANT_NAME}` : "Continue to payment"}
        onClose={() => setReview(null)}
        onConfirm={() => { if (review) (live ? change : checkout).mutate(review); }}
      />
    </div>
  );
}

/**
 * The held tier and a button to each other one. `addons` = the Call Assistant
 * subscription's quantities; `onSwitch(addon)` asks for that tier (the server
 * re-prices the one tier line, prorated). Disabled while the tiers are in
 * preview or the subscription can't be changed here.
 */
export function CallAssistantTierPicker({ addons, interval, editable, pending, onSwitch, compact = false }: {
  addons: Partial<Record<AddonKey, number>> | null | undefined;
  interval: BillingInterval;
  editable: boolean;
  /** The add-on key being switched to, while the request runs. */
  pending?: AddonKey | null;
  onSwitch: (addon: AddonKey) => void;
  compact?: boolean;
}) {
  const p = callAssistantPricing();
  const held = callAssistantTierOf(addons ?? {});
  const heldIndex = held ? CALL_ASSISTANT_TIERS.findIndex((t) => t.tier === held.tier) : -1;
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", compact ? "xl:grid-cols-4" : "lg:grid-cols-4")} data-testid="picker-call-assistant-tier">
      {callAssistantTiers().map((t, i) => {
        const current = held?.tier === t.tier;
        const label = current ? "Current tier" : !held ? `Choose ${t.name}` : i > heldIndex ? `Upgrade to ${t.name}` : `Move to ${t.name}`;
        return (
          <div
            key={t.tier}
            className={cn("rounded-lg border p-3 flex flex-col gap-2", current && "border-primary/60 bg-primary/5")}
            data-testid={`option-call-assistant-tier-${t.tier}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">{t.name}</span>
              <span className="text-sm font-semibold tabular-nums">{formatUsd(interval === "year" ? t.annualCents : t.monthlyCents)}{suffix(interval)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t.numbersLabel} · {t.overageShort}/min over</p>
            <Button
              size="sm"
              variant={current ? "secondary" : "outline"}
              disabled={current || !editable || p.comingSoon || !!pending}
              onClick={() => onSwitch(t.addon)}
              data-testid={`button-call-assistant-tier-${t.tier}`}
            >
              {pending === t.addon && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {label}
            </Button>
          </div>
        );
      })}
      {p.comingSoon && (
        <p className="text-xs text-muted-foreground sm:col-span-full" data-testid="text-call-assistant-tier-preview">
          Coming soon: listed, not for sale yet.
        </p>
      )}
    </div>
  );
}
