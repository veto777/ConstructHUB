import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { VerificationCancelled } from "@/components/recent-auth";
import { apiErrorCode } from "@/lib/plan-errors";
import { ADDONS, type AddonKey } from "@shared/plans";
import { describeSubscription, type EntitlementsInfo, type SubscriptionInfo } from "@/lib/pricing-display";

/**
 * The signed-in subscription and the billing actions Settings shares between
 * Billing (plan card, add-ons, portal) and Limits & usage (add-on +/- next to
 * the limit each one raises). One place for the error handling: a sales-only
 * order opens the inquiry form, a declined card offers Stripe's portal.
 */

export function useSubscription() {
  const query = useQuery<SubscriptionInfo>({ queryKey: ["/api/stripe/subscription"] });
  return { ...query, view: describeSubscription(query.data) };
}

/** Limits and this month's usage, as every gate on the server counts them. */
export function useEntitlements() {
  return useQuery<EntitlementsInfo>({ queryKey: ["/api/entitlements"] });
}

export function refreshBilling() {
  void queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/agency/me"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
}

export function useBillingActions() {
  const { toast } = useToast();
  // Orders the server says only a sales rep can sell (409 talk_to_sales) open the inquiry form.
  const [salesTopic, setSalesTopic] = useState<string | null>(null);

  const portal = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stripe/create-portal", {})).json(),
    onSuccess: (data: any) => { if (data?.url) window.location.href = data.url; },
    onError: (err) => showError("Couldn't open billing")(err),
  });

  const showError = (title: string, salesTopicFor?: string) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    const code = apiErrorCode(err);
    if (code === "talk_to_sales" && salesTopicFor) { setSalesTopic(salesTopicFor); return; }
    // A declined card changes nothing; the fix is a new card in Stripe's portal.
    const manageBilling = code === "payment_failed" ? (
      <ToastAction altText="Manage billing" onClick={() => portal.mutate()} data-testid="button-toast-manage-billing">Manage billing</ToastAction>
    ) : undefined;
    toast({ title, description: apiErrorMessage(err), variant: "destructive", action: manageBilling });
  };

  // The billing route takes { addons: { key: quantity } }; the quantity is the new total, so a repeat is harmless.
  const addon = useMutation({
    mutationFn: async (v: { addon: AddonKey; quantity: number }) =>
      (await apiRequest("POST", "/api/stripe/addons", { addons: { [v.addon]: v.quantity } })).json(),
    onSuccess: (_data, v) => {
      refreshBilling();
      toast({ title: "Add-ons updated", description: `${ADDONS[v.addon].name}: ${v.quantity}` });
    },
    onError: (err, v) => showError("Couldn't update add-ons", `${ADDONS[v.addon].name} × ${v.quantity}`)(err),
  });

  return { portal, addon, showError, salesTopic, setSalesTopic, refreshBilling };
}
