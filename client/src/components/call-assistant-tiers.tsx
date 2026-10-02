/**
 * The AI Call Assistant's three tiers (Solo / Crew / Fleet) in the app's own
 * (shadcn) look: the pricing page's add-on area and Settings. Every figure is
 * the price book's (shared/plans.ts CALL_ASSISTANT_TIERS through
 * shared/plan-copy.ts callAssistantTiers) — nothing here types a price.
 *
 *   CallAssistantTierCards — three cards, the interval the page shows
 *   CallAssistantTierPicker — the held tier and a switch to each other one
 *     (Settings → Billing and Limits & usage). A switch goes through the
 *     shared add-on flow (use-billing.tsx useAddonChange): a smaller tier that
 *     keeps fewer numbers than the account holds asks first and names them.
 */
import { Check, Loader2, PhoneCall, ShieldBan } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CALL_ASSISTANT_TIERS, callAssistantTierOf, type AddonKey, type BillingInterval } from "@shared/plans";
import { callAssistantPricing, callAssistantTiers, formatUsd } from "@shared/plan-copy";

const suffix = (interval: BillingInterval) => (interval === "year" ? "/yr" : "/mo");

/** Three tier cards for the pricing page (`interval` follows the page's monthly/yearly toggle). */
export function CallAssistantTierCards({ interval, className }: { interval: BillingInterval; className?: string }) {
  const p = callAssistantPricing();
  return (
    <div className={cn("space-y-3", className)} data-testid="section-call-assistant-tiers">
      <div className="grid gap-3 md:grid-cols-3">
        {p.tiers.map((t, i) => (
          <div
            key={t.tier}
            className={cn("relative rounded-xl border bg-card p-4 flex flex-col", i === 1 && "ring-2 ring-[#F97316]/40 border-[#F97316]/40")}
            data-testid={`card-call-assistant-tier-${t.tier}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <PhoneCall className="h-4 w-4 text-[#F97316]" aria-hidden="true" />
              <h3 className="font-semibold">{t.name}</h3>
              {p.comingSoon && <Badge variant="outline" className="text-[10px]">Coming soon</Badge>}
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight" data-testid={`text-call-assistant-tier-price-${t.tier}`}>
              {interval === "year" ? t.annual : t.monthly}<span className="text-sm font-medium text-muted-foreground">{suffix(interval)}</span>
            </p>
            {t.intro && interval === "month" ? (
              <p className="text-xs font-semibold text-[#C2410C] dark:text-[#FB923C]" data-testid={`text-call-assistant-tier-intro-${t.tier}`}>
                Launch price: {t.intro}/mo for your first {t.introMonths} months
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{interval === "year" ? `or ${t.monthly}/mo on monthly billing` : `or ${t.annual}/yr on yearly billing`}</p>
            )}
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex gap-2"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> {t.minutes} call minutes a month</li>
              <li className="flex gap-2"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> {t.numbersLabel} included</li>
              <li className="flex gap-2 text-muted-foreground"><Check className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" /> Fits {t.estimatedCalls} (estimate)</li>
            </ul>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-[#F97316]/30 bg-[#F97316]/5 px-4 py-3 text-sm flex flex-wrap items-start gap-2" data-testid="text-call-assistant-tiers-every">
        <ShieldBan className="h-4 w-4 mt-0.5 text-[#F97316] shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">Every tier:</span> the first {p.freeSpamCalls} spam calls each month are free (they never count toward your minutes); spam is screened and repeat spammers are blocked before they're answered.
          Above the included minutes, {p.overagePerMinute}/minute. Extra local numbers {p.extraNumber}/mo each. Add-on for the {p.plans} plans.
        </span>
      </div>
    </div>
  );
}

/**
 * The held tier and a button to each other one. `addons` = the subscription's
 * add-on quantities; `onSwitch(addon)` asks for that tier (the server swaps it
 * for the held one, prorated). Disabled while the tiers are in preview or the
 * subscription can't be changed here.
 */
export function CallAssistantTierPicker({ addons, interval, editable, pending, onSwitch, compact = false }: {
  addons: Partial<Record<AddonKey, number>> | null | undefined;
  interval: BillingInterval;
  editable: boolean;
  /** The add-on key being switched to, while the request runs. */
  pending?: AddonKey | null;
  onSwitch: (addon: AddonKey) => void;
  compact?: boolean;
}) {
  const p = callAssistantPricing();
  const held = callAssistantTierOf(addons ?? {});
  const heldIndex = held ? CALL_ASSISTANT_TIERS.findIndex((t) => t.tier === held.tier) : -1;
  return (
    <div className={cn("grid gap-2", compact ? "sm:grid-cols-3" : "md:grid-cols-3")} data-testid="picker-call-assistant-tier">
      {callAssistantTiers().map((t, i) => {
        const current = held?.tier === t.tier;
        const label = current ? "Current tier" : !held ? `Choose ${t.name}` : i > heldIndex ? `Upgrade to ${t.name}` : `Move to ${t.name}`;
        return (
          <div
            key={t.tier}
            className={cn("rounded-lg border p-3 flex flex-col gap-2", current && "border-primary/60 bg-primary/5")}
            data-testid={`option-call-assistant-tier-${t.tier}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">{t.name}</span>
              <span className="text-sm font-semibold tabular-nums">{formatUsd(interval === "year" ? t.annualCents : t.monthlyCents)}{suffix(interval)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t.minutes} minutes / month · {t.numbersLabel}</p>
            <Button
              size="sm"
              variant={current ? "secondary" : "outline"}
              disabled={current || !editable || p.comingSoon || !!pending}
              onClick={() => onSwitch(t.addon)}
              data-testid={`button-call-assistant-tier-${t.tier}`}
            >
              {pending === t.addon && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {label}
            </Button>
          </div>
        );
      })}
      {p.comingSoon && (
        <p className={cn("text-xs text-muted-foreground", compact ? "sm:col-span-3" : "md:col-span-3")} data-testid="text-call-assistant-tier-preview">
          Coming soon: listed, not for sale yet.
        </p>
      )}
    </div>
  );
}
