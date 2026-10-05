/**
 * "Your last payment didn't go through" — on every signed-in platform page while a payment is owed (owner,
 * 2026-10-04: a failed payment must not keep the plan on). The plan's features are paused (shared/plans.ts
 * ACCESS_STATUSES); updating the card lets Stripe collect and everything comes back on its own.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inNativeApp } from "@/lib/app-shell";

export function PaymentNeededBanner() {
  const { data } = useQuery<{ paymentNeeded?: boolean; subscriptionStatus?: string | null }>({ queryKey: ["/api/entitlements"], staleTime: 60_000 });
  // Not in the iPhone apps: they sell nothing and never send anyone to pay (App Store 3.1.3(f)).
  if (!data?.paymentNeeded || inNativeApp()) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-950 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100" data-testid="banner-payment-needed">
      <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">Your last payment didn't go through.</strong>{" "}
        Your plan is paused until it's paid. Update your card and everything turns back on by itself.
      </span>
      <Button asChild size="sm" variant="destructive" className="shrink-0">
        <Link href="/settings?tab=billing" data-testid="link-payment-needed-billing">Update card</Link>
      </Button>
    </div>
  );
}
