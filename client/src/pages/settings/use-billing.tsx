import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { VerificationCancelled } from "@/components/recent-auth";
import { apiErrorCode } from "@/lib/plan-errors";
import { ADDONS, type AddonKey } from "@shared/plans";
import { CALL_ASSISTANT_NUMBER_RULES } from "@shared/plan-copy";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

/** Add-ons whose reduction releases Call Assistant numbers (server/voice/number-release.ts). */
const NUMBER_ADDONS: readonly AddonKey[] = ["call_assistant", "call_number"];
type AddonChange = { addon: AddonKey; quantity: number };
type NumberPreview = { phoneNumber: string; orgName: string }[];

/** The account's Call Assistant numbers a change would release (GET /api/stripe/addons/release-preview); null if it can't be read. */
export async function fetchNumberReleasePreview(query: string): Promise<NumberPreview | null> {
  try {
    const res = await apiRequest("GET", `/api/stripe/addons/release-preview?${query}`);
    const body = await res.json();
    return Array.isArray(body?.numbers) ? body.numbers : null;
  } catch {
    return null;
  }
}

/**
 * Add-on +/- with a confirm step where it matters (owner, 2026-10-02: the
 * number is part of the service and "the only thing that can keep a customer
 * from leaving"): fewer Call Assistant / extra-number add-ons than the numbers
 * the account holds stops those numbers now and releases them, so the
 * customer sees which numbers, and that they can't be kept, before it happens.
 * Every other change goes straight through. Render `dialog` once.
 */
export function useAddonChange(addon: ReturnType<typeof useBillingActions>["addon"]) {
  const [confirm, setConfirm] = useState<{ change: AddonChange; numbers: NumberPreview | null } | null>(null);
  const [checking, setChecking] = useState(false);

  async function request(change: AddonChange, current: number) {
    if (change.quantity >= current || !NUMBER_ADDONS.includes(change.addon)) { addon.mutate(change); return; }
    setChecking(true);
    const numbers = await fetchNumberReleasePreview(`${change.addon}=${change.quantity}`);
    setChecking(false);
    // Nothing would stop: no question to ask. Unknown (the check failed): ask anyway, without the list.
    if (numbers && numbers.length === 0) { addon.mutate(change); return; }
    setConfirm({ change, numbers });
  }

  const removingAssistant = confirm?.change.addon === "call_assistant" && confirm.change.quantity === 0;
  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
      <AlertDialogContent data-testid="dialog-addon-number-release">
        <AlertDialogHeader>
          <AlertDialogTitle>{removingAssistant ? `Remove the ${ADDONS.call_assistant.name}?` : "Give up a Call Assistant number?"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {confirm?.numbers?.length ? (
                <>
                  <p>{confirm.numbers.length === 1 ? "This number stops answering now and is released:" : "These numbers stop answering now and are released:"}</p>
                  <ul className="list-disc pl-5 font-medium text-foreground" data-testid="list-addon-release-numbers">
                    {confirm.numbers.map((n) => (
                      <li key={n.phoneNumber} data-testid={`text-addon-release-number-${n.phoneNumber}`}>{n.phoneNumber}{n.orgName ? ` (${n.orgName})` : ""}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Your Call Assistant numbers above the new count stop answering now and are released.</p>
              )}
              <p>{CALL_ASSISTANT_NUMBER_RULES.cancel}</p>
              <p className="font-medium text-foreground" data-testid="text-addon-release-final">
                A released number can't be kept or moved to another provider.
                {removingAssistant ? " Adding the Call Assistant again later gives you a new number, not this one." : ""}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-addon-release-cancel">Keep my number</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => { if (confirm) addon.mutate(confirm.change); setConfirm(null); }}
            data-testid="button-addon-release-confirm"
          >
            {confirm?.numbers && confirm.numbers.length > 1 ? "Release the numbers" : "Release the number"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { request, checking, dialog };
}
