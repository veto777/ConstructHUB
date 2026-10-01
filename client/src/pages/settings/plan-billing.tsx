import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CreditCard, Loader2, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TalkToSalesButton, TalkToSalesDialog } from "@/components/talk-to-sales";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import {
  ADDONS, AGENCY_SELF_SERVE_MAX_LOCATIONS, PLANS, PLAN_KEYS, TRIAL_DAYS,
  type BillingInterval,
} from "@shared/plans";
import {
  AGENCY_INCLUDED_LOCATIONS, PAYMENT_PROBLEM_STATUSES, USAGE_METERS, addonPriceCents, addonsForPlan, agencyQuote,
  formatUsd, intervalSuffix, intervalWord, normalizeLocations, planPriceCents, usageLine, usagePercent,
  type EntitlementsInfo,
} from "@/lib/pricing-display";
import { useBillingActions, useEntitlements, useSubscription } from "./use-billing";
import type { SettingsSectionProps } from "./types";

const STATUS_LABELS: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment past due", unpaid: "Unpaid",
  canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", inactive: "Inactive",
};

/**
 * Workspace → Billing (the "Subscriptions" view): the real subscription (never
 * a hardcoded plan) against the price book in shared/plans.ts, this month's
 * usage, add-ons, and the way to Stripe's portal for cards and invoices. A
 * legacy plan shows by the name it was bought under, with the new plan its
 * features now follow. Plan changes go through /pricing (one subscription,
 * changed in place).
 */
export function PlanBillingSection(_props: SettingsSectionProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: subscription, isLoading, error, view } = useSubscription();
  const plan = view.live && view.planKey ? PLANS[view.planKey] : null;
  const interval: BillingInterval = view.interval ?? "month";
  // Limits and this month's usage, as every gate on the server counts them.
  const { data: entitlements } = useEntitlements();
  const { portal: portalMutation, addon: addonMutation, showError, salesTopic, setSalesTopic, refreshBilling } = useBillingActions();

  const [locationsInput, setLocationsInput] = useState<string | null>(null);
  const billedLocations = view.locations ?? AGENCY_INCLUDED_LOCATIONS;
  const wantedLocations = normalizeLocations(locationsInput ?? billedLocations);
  const locationsQuote = agencyQuote(wantedLocations);
  // Add-ons and location counts change a Stripe subscription on a current plan;
  // a legacy plan keeps its old price until it switches plans in Pricing.
  const editable = view.changesInPlace && !view.isLegacy;
  const locationsMutation = useMutation({
    // Without a known interval the server keeps the subscription's own.
    mutationFn: async (locations: number) =>
      (await apiRequest("POST", "/api/stripe/change-plan", { plan: "agency", ...(view.interval ? { interval: view.interval } : {}), locations })).json(),
    onSuccess: (data: any, locations) => {
      if (data?.url) { window.location.href = data.url; return; }
      setLocationsInput(null);
      refreshBilling();
      toast({ title: "Locations updated", description: `Agency is now billed for ${locations.toLocaleString("en-US")} locations.` });
    },
    onError: (err, locations) => showError("Couldn't change locations", `${PLANS.agency.name} plan — ${locations.toLocaleString("en-US")} locations`)(err),
  });

  const status = subscription?.status || "";
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const openEnded = !!periodEnd && periodEnd.getUTCFullYear() >= 2099;
  const periodText = !periodEnd ? null
    : openEnded ? "No end date"
    : !view.viaStripe ? `Access through ${periodEnd.toLocaleDateString()}`
    : status === "trialing" ? `Trial ends ${periodEnd.toLocaleDateString()}`
    : subscription?.cancelAtPeriodEnd === true ? `Ends ${periodEnd.toLocaleDateString()}`
    : subscription?.cancelAtPeriodEnd === false ? `Renews ${periodEnd.toLocaleDateString()}`
    // Not told whether it renews (it may be set to cancel in Stripe's portal).
    : `Current period ends ${periodEnd.toLocaleDateString()}`;
  // Legacy subscriptions keep the Stripe price they were sold at until they change plans.
  const priceText = !plan || view.isLegacy || !view.interval ? null
    : plan.key === "agency"
      ? (() => {
          if (!view.locations) return null;
          const q = agencyQuote(view.locations);
          return q.sales ? null : `${formatUsd(view.interval === "year" ? q.annualCents : q.monthlyCents)}${intervalSuffix(view.interval)} for ${view.locations.toLocaleString("en-US")} locations`;
        })()
      : `${formatUsd(planPriceCents(plan, view.interval))}${intervalSuffix(view.interval)}`;
  const addons = plan ? addonsForPlan(plan.key) : [];
  const pendingAddon = addonMutation.isPending ? addonMutation.variables?.addon : null;

  return (
    <div className="space-y-6" data-testid="section-billing">
      <Card data-testid="card-current-plan">
        <CardHeader>
          <CardTitle className="text-lg">Current plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-primary/5 border border-primary/10 rounded-lg">
            <div className="min-w-0 space-y-0.5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground" data-testid="text-current-plan">Loading your plan…</p>
              ) : error ? (
                <p className="text-sm text-destructive" role="alert" data-testid="text-current-plan">
                  Couldn't load your plan. {apiErrorMessage(error)}
                </p>
              ) : plan ? (
                <>
                  <div className="font-semibold text-primary flex flex-wrap items-center gap-2" data-testid="text-current-plan">
                    {view.displayName} plan
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-plan-status">
                      {STATUS_LABELS[status] || status}
                    </Badge>
                  </div>
                  {view.isLegacy && (
                    <p className="text-xs text-muted-foreground" data-testid="text-legacy-match">
                      Your features now match {plan.name}.{view.viaStripe ? " Your existing price stays until you change plans." : ""}
                    </p>
                  )}
                  {(view.interval || priceText) && (
                    <p className="text-xs text-muted-foreground" data-testid="text-plan-interval">
                      {view.interval ? `Billed ${intervalWord(view.interval)}` : ""}{view.interval && priceText ? " · " : ""}{priceText ?? ""}
                    </p>
                  )}
                  {periodText && (
                    <p className="text-xs text-muted-foreground" data-testid="text-plan-period">{periodText}</p>
                  )}
                  {PAYMENT_PROBLEM_STATUSES.includes(status) && (
                    <p className="text-xs text-destructive" role="alert">Your last payment didn't go through. Update your card in Manage billing.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold text-primary" data-testid="text-current-plan">No active plan</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-plan-inactive">
                    {view.storedPlan
                      ? `Your ${view.displayName} subscription is ${(STATUS_LABELS[status] || status).toLowerCase()}.`
                      : `No subscription on this account. New customers start any plan with a ${TRIAL_DAYS}-day free trial.`}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate(view.interval === "year" ? "/pricing?interval=year" : "/pricing")} data-testid="button-upgrade">
                {plan ? "Change plan" : "Choose a plan"}
              </Button>
              {view.viaStripe && (
                <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending} data-testid="button-manage-billing">
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLAN_KEYS.map((key) => (
              <a
                key={key}
                href="/pricing"
                onClick={e => { e.preventDefault(); navigate("/pricing"); }}
                className={`p-3 border rounded-lg text-center hover:border-primary/50 hover:bg-muted/40 transition-colors ${plan?.key === key ? "border-primary/50" : ""}`}
                data-testid={`card-plan-${key}`}
              >
                <div className="text-sm font-semibold flex items-center justify-center gap-1.5">
                  {PLANS[key].name}
                  {plan?.key === key && <Badge variant="outline" className="text-[9px] px-1 py-0">{view.isLegacy ? "Matches" : "Current"}</Badge>}
                </div>
                <p className="text-lg font-bold text-primary mt-1">{formatUsd(planPriceCents(PLANS[key], interval))}{intervalSuffix(interval)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{PLANS[key].tagline}</p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {entitlements?.accessPlan && <UsageCard entitlements={entitlements} />}

      {plan && (
        <Card data-testid="card-addons">
          <CardHeader>
            <CardTitle className="text-lg">Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pay only for the extra you need; add-ons are billed with your plan{view.interval ? `, ${intervalWord(view.interval)}` : ""}.
              {editable && " A change is prorated and invoiced right away, and a reduction becomes account credit. If your card can't be charged, nothing changes."}
            </p>
            {!view.viaStripe ? (
              <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-3" data-testid="text-addons-no-stripe">
                Add-ons are billed on a Stripe subscription, and this plan wasn't bought through Stripe checkout. Choose a plan in Pricing to add them.
              </p>
            ) : view.isLegacy && (
              <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-3" data-testid="text-addons-legacy">
                Add-ons and location counts ride on the current plans. Your {view.displayName} price stays as it is; switch to {plan.name} in Pricing to add them.
              </p>
            )}
            {plan.key === "agency" && editable && (
              <div className="rounded-lg border p-3 space-y-2" data-testid="row-billing-locations">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Client locations</p>
                    <p className="text-xs text-muted-foreground">
                      {AGENCY_INCLUDED_LOCATIONS} included{view.locations ? `; billed for ${view.locations.toLocaleString("en-US")} now` : ""}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="w-24 h-9"
                      aria-label="Billed client locations"
                      value={locationsInput ?? String(billedLocations)}
                      onChange={(e) => setLocationsInput(e.target.value)}
                      data-testid="input-billing-locations"
                    />
                    {!locationsQuote.sales && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={wantedLocations === billedLocations || locationsMutation.isPending}
                        onClick={() => locationsMutation.mutate(wantedLocations)}
                        data-testid="button-billing-locations"
                      >
                        {locationsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
                      </Button>
                    )}
                  </div>
                </div>
                {locationsQuote.sales ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>More than {AGENCY_SELF_SERVE_MAX_LOCATIONS.toLocaleString("en-US")} locations is priced with a sales rep.</span>
                    <TalkToSalesButton topic={`Agency plan — ${wantedLocations.toLocaleString("en-US")} locations`} size="sm" variant="outline" data-testid="button-billing-locations-sales" />
                  </div>
                ) : wantedLocations !== billedLocations && (
                  <p className="text-xs text-muted-foreground" data-testid="text-billing-locations-quote">
                    {wantedLocations.toLocaleString("en-US")} locations = {formatUsd(interval === "year" ? locationsQuote.annualCents : locationsQuote.monthlyCents)}{intervalSuffix(interval)}
                  </p>
                )}
              </div>
            )}
            {addons.map((addon) => {
              const qty = Math.max(0, Number(subscription?.addons?.[addon.key] ?? 0) || 0);
              const pending = pendingAddon === addon.key;
              const disabled = !editable || addonMutation.isPending;
              return (
                <div key={addon.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" data-testid={`row-billing-addon-${addon.key}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{addon.name}</p>
                    <p className="text-xs text-muted-foreground">{addon.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatUsd(addonPriceCents(addon, interval))}{intervalSuffix(interval)} each
                      {addon.setupCents ? ` + ${formatUsd(addon.setupCents)} one-time setup` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      aria-label={`Remove one ${addon.name}`}
                      disabled={disabled || qty === 0}
                      onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty - 1 })}
                      data-testid={`button-addon-dec-${addon.key}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" data-testid={`text-addon-qty-${addon.key}`}>
                      {pending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : qty}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      aria-label={`Add one ${addon.name}`}
                      disabled={disabled}
                      onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty + 1 })}
                      data-testid={`button-addon-inc-${addon.key}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-payment-method">
        <CardHeader>
          <CardTitle className="text-lg">Payment method &amp; invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
              {view.viaStripe ? (
                <p className="text-sm text-muted-foreground" data-testid="text-billing-portal">
                  Your card, invoices and cancellation are managed in Stripe's secure billing portal.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-billing-portal">
                  This account has no Stripe subscription, so there's no card or invoice to show. You enter a card at checkout when you choose a plan.
                </p>
              )}
            </div>
            {view.viaStripe ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                data-testid="button-portal-billing"
              >
                {portalMutation.isPending ? "Opening…" : "Manage billing"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => navigate("/pricing")} data-testid="button-add-payment">
                See plans
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <TalkToSalesDialog
        open={salesTopic !== null}
        onOpenChange={(open) => { if (!open) setSalesTopic(null); }}
        topic={salesTopic ?? ""}
      />
    </div>
  );
}

/** This month's allowances as the server counts them (GET /api/entitlements), with the reset date. */
export function UsageCard({ entitlements }: { entitlements: EntitlementsInfo }) {
  const meters = USAGE_METERS
    .map((m) => ({ ...m, meter: entitlements.usage?.[m.key] }))
    .filter((m) => usageLine(m.meter) !== null);
  const resets = entitlements.resetsAt ? new Date(entitlements.resetsAt) : null;
  const perLocation = entitlements.accessPlan === "agency";
  const locations = entitlements.locations;
  return (
    <Card data-testid="card-usage">
      <CardHeader>
        <CardTitle className="text-lg">Usage this month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entitlements.isPlatformAdmin && entitlements.accessPlan !== entitlements.plan && (
          <p className="text-xs text-muted-foreground" data-testid="text-usage-admin">
            Platform admin: the {entitlements.planName} plan's limits apply to this account, whatever plan it holds.
          </p>
        )}
        {locations && (
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm" data-testid="usage-locations">
            <span className="font-medium">Google Business Profile locations</span>
            <span className="text-muted-foreground tabular-nums">
              {perLocation
                ? `${locations.used.toLocaleString("en-US")} linked`
                : `${locations.used.toLocaleString("en-US")} of ${locations.limit.toLocaleString("en-US")}`}
            </span>
          </div>
        )}
        {meters.map(({ key, label, meter }) => {
          const pct = usagePercent(meter);
          return (
            <div key={key} className="space-y-1.5" data-testid={`usage-${key}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{label}</span>
                <span className={`tabular-nums ${pct !== null && pct >= 100 ? "text-destructive" : "text-muted-foreground"}`}>{usageLine(meter)}</span>
              </div>
              {pct !== null && (
                <div
                  className="h-1.5 rounded-full bg-muted overflow-hidden"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                >
                  <div className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
        {resets && (
          <p className="text-xs text-muted-foreground" data-testid="text-usage-resets">
            Monthly counts reset {resets.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}.
            {perLocation ? " Agency allowances grow with the locations you're billed for." : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
