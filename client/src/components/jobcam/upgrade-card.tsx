/**
 * What a workspace WITHOUT JobCam sees where the feed or the camera would be.
 * Nothing is hidden: the JobCam menu item and the project tab stay, and open
 * this card instead.
 *
 *   - CRM Basic / Essentials: "Add JobCam — $39/mo" (the JobCam add-on on the
 *     CRM subscription) or "move to CRM Max", where it is included. Both go
 *     through the purchase review and POST /api/crm/billing/change — the same
 *     in-place change the CRM plan cards use (prorated to the saved card,
 *     recent sign-in required).
 *   - Only the account owner holds the CRM subscription, so only the owner
 *     gets buttons; everyone else is told who to ask.
 *   - No CRM plan: the standard CRM plan prompt.
 *   - The iPhone apps sell nothing (App Store 3.1.3(f)): no price, no button.
 *
 * Every number comes from shared/crm-plans.ts (jobcamOffer).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import { PurchaseReviewDialog, type PurchaseReview } from "@/components/purchase-review";
import { CrmPaywall, type CrmSubscriptionInfo } from "@/components/crm-plans";
import { inNativeApp } from "@/lib/app-shell";
import { CRM_ADDONS, CRM_PLANS, jobcamOffer, type CrmPlanKey } from "@shared/crm-plans";
import { JOBCAM_INCLUDED_GB } from "@shared/jobcam-storage";
import type { BillingInterval } from "@shared/plans";

type CrmMe = {
  org?: { name?: string };
  crm?: { active: boolean; plan: CrmPlanKey | null; isOwner: boolean; jobcam?: boolean; via?: string | null };
};

/** Does this workspace have JobCam? `undefined` while /api/crm/me loads; an older server (no flag) reads as yes. */
export function useJobcamAccess(): { loading: boolean; entitled: boolean; me: CrmMe | undefined } {
  const { data: me, isLoading } = useQuery<CrmMe>({ queryKey: ["/api/crm/me"] });
  return { loading: isLoading, entitled: me?.crm?.jobcam !== false, me };
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const per = (interval: BillingInterval) => (interval === "year" ? "/yr" : "/mo");

type Choice = { kind: "addon" } | { kind: "plan"; plan: CrmPlanKey };

export function JobcamUpgradeCard({ dark = false }: { dark?: boolean }) {
  const { toast } = useToast();
  const { me } = useJobcamAccess();
  const isOwner = me?.crm?.isOwner === true;
  const native = inNativeApp();
  // The subscription (and its billing interval) is the owner's own; nobody else can read or change it.
  const { data: sub } = useQuery<CrmSubscriptionInfo>({ queryKey: ["/api/crm/billing/subscription"], enabled: isOwner && !native });
  const [choice, setChoice] = useState<Choice | null>(null);

  const change = useMutation({
    mutationFn: async (c: Choice) => (await apiRequest("POST", "/api/crm/billing/change", c.kind === "addon" ? { jobcam: true } : { plan: c.plan })).json(),
    onSuccess: () => {
      setChoice(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/billing/subscription"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      void queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/crm/jobcam") });
      toast({ title: "JobCam is on", description: "Open the camera and start shooting." });
    },
    onError: (err) => {
      if (err instanceof VerificationCancelled) return;
      setChoice(null);
      toast({ title: "Couldn't change your CRM subscription", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const plan = me?.crm?.plan ?? null;
  const interval: BillingInterval = sub?.interval === "year" ? "year" : "month";
  const offer = jobcamOffer(plan, interval);
  const shell = `rounded-2xl border p-5 sm:p-6 ${dark ? "border-white/15 bg-white/5 text-white" : "border-border bg-card"}`;
  const muted = dark ? "text-white/70" : "text-muted-foreground";

  // The iPhone apps: say it isn't here, name no plan and no price.
  if (native) {
    return (
      <div className={shell} data-testid="jobcam-upgrade-card">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Camera className="h-5 w-5" /> JobCam isn't on this account</h2>
        <p className={`mt-2 text-sm ${muted}`}>Ask your account owner.</p>
      </div>
    );
  }
  // No CRM plan at all: the CRM's own "choose a plan" screen.
  if (offer.kind === "crm_plan_required") return <CrmPaywall isOwner={isOwner} orgName={me?.org?.name} />;

  const planName = CRM_PLANS[offer.plan].name;
  // Buying changes the live subscription in place; without one there is nothing to change yet.
  const canBuy = isOwner && sub?.hasLiveSubscription === true;
  const review: PurchaseReview | null = !choice ? null : choice.kind === "addon" && offer.addon ? {
    name: `the ${offer.addon.name} add-on`,
    product: "ConstructHUB CRM",
    price: `${usd(offer.addon.cents)}${per(interval)}`,
    note: `Added to your ${planName} subscription now. The rest of this billing period is charged to your saved card today, then ${usd(offer.addon.cents)}${per(interval)} with your plan. Remove it any time.`,
    included: [
      "JobCam — job-site photos and video, filed to each project",
      "Camera with time and GPS on every shot, tags, search across jobs",
      "Share links for clients (gallery or live timeline)",
      `${JOBCAM_INCLUDED_GB} GB of storage`,
    ],
    notIncluded: [`Storage above ${JOBCAM_INCLUDED_GB} GB (request it when you need it)`, `Anything else in ${offer.includedIn?.name ?? "a higher plan"} — your plan stays ${planName}`],
  } : choice.kind === "plan" ? {
    name: CRM_PLANS[choice.plan].name,
    product: "ConstructHUB CRM",
    price: `${usd(offer.includedIn?.cents ?? 0)}${per(interval)}`,
    note: "Your CRM subscription changes in place and the difference is charged or credited now.",
    included: CRM_PLANS[choice.plan].features,
    notIncluded: CRM_PLANS[choice.plan].notIncluded,
  } : null;

  return (
    <div className={shell} data-testid="jobcam-upgrade-card">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Camera className="h-5 w-5 text-primary" /> JobCam isn't on your {planName} plan</h2>
      <p className={`mt-2 text-sm ${muted}`}>{CRM_ADDONS.jobcam.blurb}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {offer.addon && (
          <div className={`rounded-xl border p-4 ${dark ? "border-white/15" : "border-border"}`} data-testid="jobcam-offer-addon">
            <p className="text-sm font-semibold">Add JobCam to {planName}</p>
            <p className="mt-1 text-2xl font-semibold" data-testid="text-jobcam-addon-price">{usd(offer.addon.cents)}<span className={`text-sm font-medium ${muted}`}>{per(interval)}</span></p>
            <p className={`mt-1 text-xs ${muted}`}>Keep your plan and add JobCam to it.</p>
            {canBuy && (
              <Button className="mt-3 w-full" onClick={() => setChoice({ kind: "addon" })} disabled={change.isPending} data-testid="button-jobcam-add">
                {change.isPending && choice?.kind === "addon" && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Add JobCam — {usd(offer.addon.cents)}{per(interval)}
              </Button>
            )}
          </div>
        )}
        {offer.includedIn && (
          <div className={`rounded-xl border p-4 ${dark ? "border-white/15" : "border-border"}`} data-testid="jobcam-offer-plan">
            <p className="text-sm font-semibold">{offer.addon ? "Or move" : "Move"} to {offer.includedIn.name}</p>
            <p className="mt-1 text-2xl font-semibold" data-testid="text-jobcam-plan-price">{usd(offer.includedIn.cents)}<span className={`text-sm font-medium ${muted}`}>{per(interval)}</span></p>
            <p className={`mt-1 text-xs ${muted}`}>JobCam is included, along with everything else in {offer.includedIn.name}.</p>
            {canBuy && (
              <Button variant="outline" className={`mt-3 w-full ${dark ? "text-black" : ""}`} onClick={() => setChoice({ kind: "plan", plan: offer.includedIn!.plan })} disabled={change.isPending} data-testid="button-jobcam-move-plan">
                {change.isPending && choice?.kind === "plan" && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Move to {offer.includedIn.name}
              </Button>
            )}
          </div>
        )}
      </div>
      {!isOwner ? (
        <p className="mt-4 text-sm font-medium" data-testid="text-jobcam-ask-owner">Ask your account owner — the CRM subscription is theirs to change.</p>
      ) : !canBuy && sub ? (
        <p className={`mt-4 text-sm ${muted}`} data-testid="text-jobcam-no-subscription">Your CRM subscription isn't active, so there is nothing to add JobCam to yet.</p>
      ) : null}
      <PurchaseReviewDialog review={review} pending={change.isPending} confirmLabel={choice?.kind === "addon" ? "Add JobCam" : "Change my CRM plan"}
        onClose={() => setChoice(null)} onConfirm={() => { if (choice) change.mutate(choice); }} />
    </div>
  );
}
