import { PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CALL_ASSISTANT_NUMBER_RULES } from "@shared/plan-copy";
import type { VoiceStatus } from "./index";

/** "Paused — update your payment method": the one banner for a bought add-on whose payment failed. */
export function CallAssistantPausedBanner({ status }: { status: VoiceStatus }) {
  return (
    <Card role="alert" className="border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20" data-testid="banner-call-assistant-paused">
      <CardContent className="flex flex-wrap items-start gap-3 p-4">
        <PauseCircle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold" data-testid="text-call-assistant-paused">Paused — update your payment method</p>
          <p className="text-sm text-muted-foreground">
            The subscription's last payment didn't go through, so the assistant isn't answering calls. Callers hear a short
            "taking a break" message.{" "}
            {status.subscriptionStatus !== "unpaid" ? CALL_ASSISTANT_NUMBER_RULES.payment
              // Stripe stopped retrying: the subscription has ended for the number (server/voice/number-release.ts).
              : status.numberRelease === "releasing"
                ? "The payment is no longer being retried, so your Call Assistant number is being released (the Numbers tab shows the date). Update your payment method before then to keep it."
                : status.numberRelease === "released"
                  ? "The payment is no longer being retried, so your Call Assistant number was released because the payment was not recovered. Updating your payment method restarts the assistant; you then pick a new number."
                  : "The payment is no longer being retried. Update your payment method to restart the assistant."}
            {" "}You can still read your settings and call log.
          </p>
        </div>
        <Button asChild size="sm">
          <a href={status.billingHref ?? "/settings?tab=billing"} data-testid="link-call-assistant-paused-billing">Update payment method</a>
        </Button>
      </CardContent>
    </Card>
  );
}
