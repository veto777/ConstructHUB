import { MessageCircle } from "lucide-react";
import type { DashboardChecklistItem, DashboardChecklistKey } from "@shared/dashboard";
import HubMascot from "@/components/hub/hub-mascot";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** The window event HubWidget listens for (docs/dashboard/SPEC.md §4.6). */
export const HUB_OPEN_EVENT = "constructhub:hub-open";

const HOW: Record<DashboardChecklistKey, string> = {
  connectGoogle: "connect Google",
  addLocation: "add a location",
  turnOnGuard: "turn on Profile Guard",
  runSiteScan: "run a Site Scan",
  requestReviews: "ask a customer for a review",
  protectWebsite: "protect your website with Click Guard",
  setUpCrm: "set up the CRM",
  inviteTeammate: "invite a teammate",
  addTextingNumber: "turn on client texting",
};

/** One sentence from the first open checklist step, and a button that opens Gabe with the question typed in (never sent). */
export function GabeNudge({ checklist }: { checklist: DashboardChecklistItem[] }) {
  const next = checklist.find((i) => !i.done);
  const how = next ? HOW[next.key] : null;
  const sentence = how ? `Not sure where to start? Ask Gabe how to ${how}.` : "Ask Gabe anything about your tools.";
  const question = how ? `How do I ${how}?` : "";
  const ask = () => window.dispatchEvent(new CustomEvent(HUB_OPEN_EVENT, { detail: { question } }));

  return (
    <Card className="p-4 sm:p-5" role="region" aria-labelledby="dashboard-gabe-title">
      <div className="flex items-start gap-4">
        <HubMascot size={56} decorative />
        <div className="min-w-0">
          <h2 id="dashboard-gabe-title" className="text-base font-semibold">Ask Gabe</h2>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-dashboard-gabe">{sentence}</p>
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={ask} className="min-h-10 w-full sm:w-auto" data-testid="button-dashboard-ask-gabe">
          <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ask Gabe
        </Button>
      </div>
    </Card>
  );
}
