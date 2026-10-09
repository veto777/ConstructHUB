import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/queryClient";
import { inNativeApp } from "@/lib/app-shell";
import { ADDONS, ADDON_MAX_QUANTITY, CALL_ASSISTANT_NAME, CALL_ASSISTANT_PRICING_HREF, type BillingInterval } from "@shared/plans";
import { CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SEPARATE_LINE, formatUsd } from "@shared/plan-copy";
import { CallAssistantTierPicker } from "@/components/call-assistant-tiers";
import { PAYMENT_PROBLEM_STATUSES, intervalSuffix, intervalWord } from "@/lib/pricing-display";
import { fetchNumberReleasePreview, useAddonChange, useBillingActions, useCallAssistantChange, useCallAssistantSubscription } from "@/pages/settings/use-billing";

const STATUS_LABELS: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment past due", unpaid: "Unpaid",
  canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", inactive: "Inactive", paused: "Paused",
};

/**
 * Settings → Billing: the account's AI Call Assistant subscription — a
 * separate service on its own subscription (owner, 2026-10-08), apart from
 * any platform plan — with the tier picker, the extra-number counter, the way
 * to buy it (its own section of Pricing) and the way to cancel it (Stripe's
 * portal, like every subscription). Every switch that pays for fewer numbers
 * than the account holds asks first and names the numbers that stop answering
 * (use-billing.tsx useAddonChange). Prices come from the price book.
 */
export function CallAssistantBillingCard({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  const { data: sub, isLoading, error } = useCallAssistantSubscription();
  const { portal } = useBillingActions();
  const change = useCallAssistantChange();
  const confirm = useAddonChange(change);
  const live = !!sub?.hasLiveSubscription;
  const included = sub?.access.via === "admin";
  const interval: BillingInterval = sub?.interval ?? "month";
  const status = sub?.status ?? "inactive";
  const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const extraNumbers = sub?.extraNumbers ?? 0;
  const pendingAddon = change.isPending ? change.variables?.addon ?? null : null;
  // Cancelling (in Stripe's portal) releases the Call Assistant numbers: say so next to the way there.
  const { data: cancelReleases } = useQuery({
    queryKey: ["/api/stripe/addons/release-preview", "cancel"],
    queryFn: () => fetchNumberReleasePreview("cancel=1"),
    enabled: live,
  });
  // The iPhone apps sell nothing (App Store 3.1.3(f)): no tiers, prices or billing there.
  if (inNativeApp()) return null;

  return (
    <Card data-testid="card-call-assistant-billing">
      <CardHeader>
        <CardTitle className="text-base">{CALL_ASSISTANT_NAME}</CardTitle>
        <CardDescription>{CALL_ASSISTANT_SEPARATE_LINE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 space-y-0.5">
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-call-assistant-plan">Loading…</p>
            ) : error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="text-call-assistant-plan">Couldn't load it. {apiErrorMessage(error)}</p>
            ) : included ? (
              <p className="text-sm font-medium" data-testid="text-call-assistant-plan">Included with your account — nothing to buy.</p>
            ) : live && sub?.tierName ? (
              <>
                <div className="text-sm font-semibold flex flex-wrap items-center gap-2" data-testid="text-call-assistant-plan">
                  {sub.tierName} tier{extraNumbers ? ` + ${extraNumbers} extra number${extraNumbers === 1 ? "" : "s"}` : ""}
                  <Badge variant="outline" className="text-[10px]" data-testid="badge-call-assistant-status">{STATUS_LABELS[status] || status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="text-call-assistant-interval">
                  Billed {intervalWord(interval)}
                  {periodEnd ? ` · ${sub.cancelAtPeriodEnd ? "Ends" : status === "trialing" ? "Trial ends" : "Renews"} ${periodEnd.toLocaleDateString()}` : ""}
                </p>
                {PAYMENT_PROBLEM_STATUSES.includes(status) && (
                  <p className="text-xs text-destructive" role="alert">Your last payment didn't go through: the assistant is paused. Update your card in Manage billing.</p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium" data-testid="text-call-assistant-plan">Not subscribed</p>
                <p className="text-xs text-muted-foreground">
                  {sub?.status && sub.status !== "inactive" ? `Your ${CALL_ASSISTANT_NAME} subscription is ${(STATUS_LABELS[status] || status).toLowerCase()}. ` : ""}
                  Choose a tier on Pricing to start it — no ConstructHUB plan needed.
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!included && !live && (
              <Button size="sm" onClick={() => navigate(CALL_ASSISTANT_PRICING_HREF)} data-testid="button-call-assistant-choose">Choose a tier</Button>
            )}
            {live && (
              <Button variant="outline" size="sm" onClick={() => portal.mutate()} disabled={portal.isPending} data-testid="button-call-assistant-manage-billing">
                {portal.isPending ? "Opening…" : "Manage billing"}
              </Button>
            )}
          </div>
        </div>

        {live && !included && (
          <>
            {sub?.overageBilling === "off" && (
              <p className="text-xs text-muted-foreground" data-testid="text-call-assistant-overage-off">
                Minutes above your plan are not charged yet. They are counted and shown in Limits &amp; usage.
              </p>
            )}
            <div className="space-y-2" data-testid="row-billing-call-assistant">
              <p className="text-xs text-muted-foreground">
                Switching tiers is prorated on this subscription. A smaller tier keeps fewer numbers, and you see which ones stop answering before you confirm.
              </p>
              <CallAssistantTierPicker
                compact={compact}
                addons={sub?.addons}
                interval={interval}
                editable={!confirm.checking}
                pending={pendingAddon}
                onSwitch={(addon) => void confirm.request({ addon, quantity: 1 }, 0)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" data-testid="row-billing-addon-call_number">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{ADDONS.call_number.name}</p>
                <p className="text-xs text-muted-foreground">{ADDONS.call_number.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatUsd(interval === "year" ? ADDONS.call_number.annualCents : ADDONS.call_number.monthlyCents)}{intervalSuffix(interval)} each</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Remove one extra number"
                  disabled={change.isPending || confirm.checking || extraNumbers === 0}
                  onClick={() => void confirm.request({ addon: "call_number", quantity: extraNumbers - 1 }, extraNumbers)}
                  data-testid="button-addon-dec-call_number">
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" data-testid="text-addon-qty-call_number">
                  {pendingAddon === "call_number" ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : extraNumbers}
                </span>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Add one extra number"
                  disabled={change.isPending || confirm.checking || extraNumbers >= ADDON_MAX_QUANTITY}
                  onClick={() => change.mutate({ addon: "call_number", quantity: extraNumbers + 1 })}
                  data-testid="button-addon-inc-call_number">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-billing-cancel-numbers">
              To cancel, open Manage billing (Stripe's portal). {CALL_ASSISTANT_NUMBER_RULES.cancel}
              {cancelReleases?.length ? ` Cancelling releases ${cancelReleases.map((n) => n.phoneNumber).join(", ")}; a released number can't be kept or moved.` : ""}
            </p>
          </>
        )}
        {confirm.dialog}
      </CardContent>
    </Card>
  );
}
