import { useState } from "react";
import { Star, ArrowRight, Loader2, Clock, MessageSquareHeart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";

/**
 * The portal's "Leave a review" tab: opens the same review page the contractor's Google Reviews tool emails
 * (/review/<token>), so the client gets the identical rating → feedback → review flow. The server reuses the
 * client's emailed request when there is one (server/crm/portal-review.ts). Read-only in contractor preview.
 */
export function PortalReview({ orgName, preview }: { orgName?: string | null; preview?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const company = orgName || "your contractor";

  async function start() {
    if (preview) {
      toast({ title: "Read-only preview", description: "Reviews are disabled while viewing as the client." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/client/review/start", { method: "POST", credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) {
        toast({ title: "Could not open the review page", description: j.message || "Please try again in a moment.", variant: "destructive" });
        setBusy(false);
        return;
      }
      window.location.assign(j.url);
    } catch {
      toast({ title: "Could not open the review page", description: "Please try again in a moment.", variant: "destructive" });
      setBusy(false);
    }
  }

  const steps = [
    { icon: Star, text: "Rate your project from 1 to 10." },
    { icon: MessageSquareHeart, text: "Tell us in your own words how it went." },
    { icon: Clock, text: "About a minute, start to finish." },
  ];

  return (
    <section className="space-y-3" data-testid="section-portal-review">
      <SectionTitle icon={Star} title="Leave a review" infoKey="portal-review"
        description={`How did ${company} do? Your feedback goes straight to the owner.`} />
      <Card>
        <CardContent className="p-5 sm:p-6 space-y-5">
          <div className="flex gap-1 text-amber-500" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-6 w-6 fill-current" />)}
          </div>
          <ul className="space-y-2.5">
            {steps.map((s) => (
              <li key={s.text} className="flex items-center gap-3 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <s.icon className="h-4 w-4" />
                </span>
                {s.text}
              </li>
            ))}
          </ul>
          <Button onClick={start} disabled={busy} className="w-full sm:w-auto" data-testid="button-portal-review-start">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Star className="h-4 w-4 mr-2" />}
            Start my review
            {!busy && <ArrowRight className="h-4 w-4 ml-2" />}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
