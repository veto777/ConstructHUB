import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { ADDONS, PLANS, TRIAL_DAYS, type AddonKey, type BillingInterval } from "@shared/plans";
import {
  PAYMENT_PROBLEM_STATUSES, addonPriceCents, agencyQuote, describeSubscription, formatUsd, intervalSuffix, intervalWord,
  planPriceCents, type EntitlementsInfo, type SubscriptionInfo,
} from "@/lib/pricing-display";
import { formatDate } from "./format";
import { useBillingPortal } from "./use-billing-portal";

const STATUS_LABELS: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment past due", unpaid: "Unpaid",
  canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused", inactive: "Inactive",
};

/**
 * GET /api/stripe/subscription may also report when the subscription began
 * (Stripe's start_date). Older servers don't; the row then reads "—".
 */
type SubscriptionWithStart = SubscriptionInfo & {
  startedAt?: string | null;
  startDate?: string | null;
  currentPeriodStart?: string | null;
};

export type SubscriptionsPanelProps = {
  /** "Change plan" (default: the pricing page, keeping a yearly interval). */
  onChangePlan?: () => void;
  /** "Manage billing" (default: Stripe's billing portal via POST /api/stripe/create-portal). */
  onManageBilling?: () => void;
  /** false hides the header buttons (the settings shell renders the plan cards with their own controls below). */
  showActions?: boolean;
};

/**
 * Billing → Subscriptions: the plan, its interval, when it started, the next
 * billing date, the price and the add-ons with their quantities. Prices come
 * from the price book, never from this file. Changes happen in Pricing or in
 * Stripe's portal; this panel is a statement, not a form.
 */
export function SubscriptionsPanel({ onChangePlan, onManageBilling, showActions = true }: SubscriptionsPanelProps = {}) {
  const [, navigate] = useLocation();
  const portal = useBillingPortal();
  const { data: subscription, isLoading, error } = useQuery<SubscriptionWithStart>({ queryKey: ["/api/stripe/subscription"] });
  const { data: entitlements } = useQuery<EntitlementsInfo>({ queryKey: ["/api/entitlements"] });
  const view = describeSubscription(subscription);
  const plan = view.live && view.planKey ? PLANS[view.planKey] : null;
  const interval: BillingInterval = view.interval ?? "month";
  const status = subscription?.status || "";

  const changePlan = onChangePlan ?? (() => navigate(view.interval === "year" ? "/pricing?interval=year" : "/pricing"));
  const manageBilling = onManageBilling ?? portal.open;

  const startedAt = subscription?.startedAt ?? subscription?.startDate ?? subscription?.currentPeriodStart ?? null;
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const openEnded = !!periodEnd && periodEnd.getUTCFullYear() >= 2099;
  // A subscription set to end at the period's close is never charged again,
  // trial or not — so that case is read before the trial wording.
  const nextBilling = !periodEnd ? "—"
    : openEnded ? "No end date"
    // A Stripe-less active row is access an admin granted (/admin/access); a trial code's is "trialing".
    : !view.viaStripe && status === "active" ? `Access granted by ConstructHUB until ${formatDate(subscription?.currentPeriodEnd)}`
    : !view.viaStripe ? `Access through ${formatDate(subscription?.currentPeriodEnd)}`
    : subscription?.cancelAtPeriodEnd === true ? `Ends ${formatDate(subscription?.currentPeriodEnd)} (won't renew)`
    : status === "trialing" ? `Trial ends ${formatDate(subscription?.currentPeriodEnd)} — first charge that day`
    : subscription?.cancelAtPeriodEnd === false ? formatDate(subscription?.currentPeriodEnd)
    : `Current period ends ${formatDate(subscription?.currentPeriodEnd)}`;

  // The plan's own price per interval. Legacy plans keep the Stripe price they
  // were sold at, which this endpoint doesn't report, so no number is shown.
  let planPrice: number | null = null;
  let planPriceNote: string | null = null;
  if (plan && !view.isLegacy && view.interval) {
    if (plan.key === "agency") {
      const q = view.locations ? agencyQuote(view.locations) : null;
      if (q && !q.sales) {
        planPrice = view.interval === "year" ? q.annualCents : q.monthlyCents;
        planPriceNote = `for ${view.locations!.toLocaleString("en-US")} locations`;
      } else if (q?.sales) {
        planPriceNote = "priced with your sales rep";
      }
    } else {
      planPrice = planPriceCents(plan, view.interval);
    }
  } else if (plan && view.isLegacy) {
    planPriceNote = "your existing price (kept until you change plans)";
  }

  const addonRows = plan
    ? (Object.keys(ADDONS) as AddonKey[])
        .map((key) => ({ addon: ADDONS[key], qty: Math.max(0, Number(subscription?.addons?.[key] ?? 0) || 0) }))
        .filter((r) => r.qty > 0)
    : [];
  // Add-on prices depend on the interval; when the server doesn't report one
  // (older subscriptions) the quantities are shown without a guessed price.
  const priced = view.interval !== null;
  const addonsTotal = addonRows.reduce((sum, r) => sum + r.qty * addonPriceCents(r.addon, interval), 0);
  const total = planPrice !== null && priced ? planPrice + addonsTotal : null;

  return (
    <Card data-testid="card-subscription">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>What you're on, when it renews and what it costs.</CardDescription>
        </div>
        {showActions && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={changePlan} data-testid="button-change-plan">{plan ? "Change plan" : "Choose a plan"}</Button>
            {view.viaStripe && (
              <Button size="sm" variant="outline" onClick={manageBilling} disabled={portal.isPending} data-testid="button-manage-billing">
                {portal.isPending ? "Opening…" : "Manage billing"}
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-40" /><Skeleton className="h-5 w-64" /><Skeleton className="h-5 w-52" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="text-subscription-error">
            Couldn't load your subscription. {apiErrorMessage(error)}
          </p>
        ) : !plan ? (
          <div className="rounded-lg bg-muted/50 p-4 space-y-1" data-testid="text-no-subscription">
            <p className="text-sm font-medium">No active plan</p>
            <p className="text-xs text-muted-foreground">
              {view.storedPlan
                ? `Your ${view.displayName} subscription is ${(STATUS_LABELS[status] || status).toLowerCase()}.`
                : `No subscription on this account. New customers start any plan with a ${TRIAL_DAYS}-day free trial.`}
            </p>
          </div>
        ) : (
          <dl className="divide-y">
            <Row label="Plan">
              <span className="font-semibold" data-testid="text-subscription-plan">{view.displayName}</span>
              <Badge variant="outline" className="ml-2 text-[10px] align-middle" data-testid="badge-subscription-status">{STATUS_LABELS[status] || status}</Badge>
              {view.isLegacy && (
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-subscription-legacy">Your features match the {plan.name} plan.</p>
              )}
              {PAYMENT_PROBLEM_STATUSES.includes(status) && (
                <p className="text-xs text-destructive mt-1" role="alert">Your last payment didn't go through. Update your card in Manage billing.</p>
              )}
            </Row>
            <Row label="Billing">
              <span data-testid="text-subscription-interval">{view.interval ? `${intervalWord(view.interval).charAt(0).toUpperCase()}${intervalWord(view.interval).slice(1)}` : "—"}</span>
            </Row>
            <Row label="Start date">
              <span data-testid="text-subscription-start">{formatDate(startedAt)}</span>
            </Row>
            <Row label="Next billing date">
              <span data-testid="text-subscription-next">{nextBilling}</span>
            </Row>
            <Row label="Price">
              <span data-testid="text-subscription-price">
                {planPrice !== null ? `${formatUsd(planPrice)}${intervalSuffix(interval)}` : planPriceNote ? "" : "—"}
                {planPriceNote ? <span className="text-muted-foreground">{planPrice !== null ? " " : ""}{planPriceNote}</span> : null}
              </span>
            </Row>
            <Row label="Add-ons">
              {addonRows.length === 0 ? (
                <span className="text-muted-foreground" data-testid="text-subscription-no-addons">None</span>
              ) : (
                <ul className="space-y-1" data-testid="list-subscription-addons">
                  {addonRows.map(({ addon, qty }) => (
                    <li key={addon.key} className="flex flex-wrap justify-between gap-x-4" data-testid={`row-subscription-addon-${addon.key}`}>
                      <span>{addon.name} <span className="text-muted-foreground">× {qty}</span></span>
                      {priced && (
                        <span className="tabular-nums text-muted-foreground">
                          {formatUsd(qty * addonPriceCents(addon, interval))}{intervalSuffix(interval)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            {total !== null && (
              <Row label="Total">
                <span className="font-semibold tabular-nums" data-testid="text-subscription-total">{formatUsd(total)}{intervalSuffix(interval)}</span>
                {entitlements?.resetsAt && (
                  <p className="text-xs text-muted-foreground mt-1">Monthly usage allowances reset {formatDate(entitlements.resetsAt)}.</p>
                )}
              </Row>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default SubscriptionsPanel;
