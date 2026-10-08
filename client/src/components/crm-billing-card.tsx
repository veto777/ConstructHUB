import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import { CRM_ADDONS, crmAddonPriceCents } from "@shared/crm-plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { marketingUrl } from "@/lib/site";
import { InvoicesPanel } from "@/pages/settings/billing/invoices-panel";
import { useBillingPortal } from "@/pages/settings/billing/use-billing-portal";
import type { CrmSubscriptionInfo } from "@/components/crm-plans";
import { inNativeApp } from "@/lib/app-shell";
import { confirmAction } from "@/components/confirm-dialog";

/**
 * CRM → Settings → "CRM subscription & invoices": the account's CRM plan (its
 * own subscription, apart from any ConstructHUB platform plan), the way to
 * change it, and every invoice on the account — the same ledger Settings →
 * Billing → Invoices shows on the platform side. Stripe emails a receipt for
 * each paid invoice of either product.
 */
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

export function CrmBillingCard() {
  const { data: sub } = useQuery<CrmSubscriptionInfo>({ queryKey: ["/api/crm/billing/subscription"] });
  const portal = useBillingPortal();
  const included = sub?.access.via === "beta" || sub?.access.via === "admin";
  const { toast } = useToast();
  // The JobCam add-on comes off the same way it went on: an in-place change of the CRM subscription.
  const removeJobcam = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/billing/change", { jobcam: false })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/billing/subscription"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "JobCam add-on removed", description: "Your photos and videos are kept. Share links already sent keep working." });
    },
    onError: (err) => {
      if (err instanceof VerificationCancelled) return;
      toast({ title: "Couldn't remove the add-on", description: apiErrorMessage(err), variant: "destructive" });
    },
  });
  // The iPhone apps sell nothing (App Store 3.1.3(f)): no plan, billing or invoice surface there.
  if (inNativeApp()) return null;
  return (
    <div className="space-y-4" data-testid="section-crm-billing">
      <Card data-testid="card-crm-subscription">
        <CardHeader>
          <CardTitle>CRM subscription</CardTitle>
          <CardDescription>
            The CRM is billed on its own subscription, separately from any ConstructHUB platform plan. A receipt is emailed for every payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="px-3 py-1" data-testid="badge-crm-plan">
            {included ? "Included with your account" : sub?.planName
              ? `${sub.planName}${sub.extraSeats ? ` + ${sub.extraSeats} extra seat${sub.extraSeats === 1 ? "" : "s"}` : ""}${sub.jobcamAddon ? ` + ${CRM_ADDONS.jobcam.name} add-on (${usd(crmAddonPriceCents("jobcam", sub.interval === "year" ? "year" : "month"))}${sub.interval === "year" ? "/yr" : "/mo"})` : ""}${sub.interval ? ` · billed ${sub.interval === "year" ? "yearly" : "monthly"}` : ""}`
              : "No CRM plan"}
          </Badge>
          {sub?.status === "trialing" && sub.trialEndsAt && (
            <span className="text-sm text-muted-foreground" data-testid="text-crm-trial-end">Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}</span>
          )}
          {sub?.currentPeriodEnd && sub.status !== "trialing" && sub.hasLiveSubscription && (
            <span className="text-sm text-muted-foreground" data-testid="text-crm-renews">
              {sub.cancelAtPeriodEnd ? "Ends" : "Renews"} {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {sub?.jobcamAddon && sub.hasLiveSubscription && (
              <Button variant="outline" size="sm" disabled={removeJobcam.isPending} data-testid="button-crm-remove-jobcam"
                onClick={() => confirmAction({
                  id: "remove-jobcam-addon",
                  title: "Remove the JobCam add-on?",
                  description: "Your team can no longer open JobCam or upload. Photos and videos already stored are kept, share links already sent keep working, and the unused part of this billing period is credited to your account.",
                  confirmLabel: "Remove add-on",
                  onConfirm: () => removeJobcam.mutate(),
                })}>
                Remove JobCam add-on
              </Button>
            )}
            {!included && (
              <Button asChild variant="outline" size="sm" data-testid="button-crm-change-plan">
                <a href={marketingUrl("/pricing#crm")}>{sub?.hasLiveSubscription ? "Change CRM plan" : "Choose a CRM plan"}</a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={portal.open} disabled={portal.isPending} data-testid="button-crm-manage-billing">
              Manage billing
            </Button>
          </div>
        </CardContent>
      </Card>
      <InvoicesPanel pageSize={10} />
    </div>
  );
}
