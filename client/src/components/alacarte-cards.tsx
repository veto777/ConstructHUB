/**
 * The "À la carte" tab of /pricing: one card per tool (shared/alacarte.ts), each
 * bought on its own subscription with or without a plan. Signed out, a card
 * shows the standalone price and "or $X/mo as an add-on to any plan"; signed in,
 * the price the account pays (its tier, from GET /api/alacarte/me) and, for a
 * tool the account already holds, "Active". The CRM and the Call Assistant are
 * linked to their own cards (never a second checkout); the texting number is an
 * add-on only. Never rendered in the iPhone apps: /pricing is an APP_SALES_PATH.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { apiErrorCode } from "@/lib/plan-errors";
import { formatUsd, intervalSuffix } from "@/lib/pricing-display";
import { TEXT_LINK } from "@/components/feature-landing/primitives";
import { trackEvent } from "@/lib/gtag";
import { ADDONS, type BillingInterval } from "@shared/plans";
import {
  ALACARTE, ALACARTE_KEYS, ALACARTE_LINKED, ALACARTE_ADDON_ONLY, ALACARTE_MAX_QUANTITY, ALACARTE_PRICING_HREF,
  alacartePriceCents, alacarteAnnualSavingsCents, type AlacarteKey, type AlacarteTier,
} from "@shared/alacarte";

/** GET /api/alacarte/me — the fields the cards read. */
export type AlacarteMe = {
  signedIn: boolean;
  tier: AlacarteTier;
  plan?: string | null;
  crmPlan?: string | null;
  crmPlanActive: boolean;
  isPlatformAdmin: boolean;
  items: { key: AlacarteKey | null; tier: AlacarteTier; quantity: number; status: string; interval: BillingInterval | null; active: boolean; hasLiveSubscription: boolean; cancelAtPeriodEnd: boolean }[];
  /** Items the account's plan already gives — nothing to buy. */
  covered: AlacarteKey[];
};

const OUTLINE_BUTTON = "h-11 rounded-lg border-2 border-mkt-ink [border-color:var(--mkt-ink)] bg-transparent text-mkt-ink hover:bg-mkt-ink hover:text-mkt-paper font-semibold text-[15px]";
const NAVY_BUTTON = "h-11 rounded-lg border-0 bg-mkt-panel text-mkt-panel-ink hover:opacity-90 font-semibold text-[15px]";

/** The price with its interval suffix ("/mo" or "/yr"). */
const priceLabel = (key: AlacarteKey, tier: AlacarteTier, interval: BillingInterval) =>
  `${formatUsd(alacartePriceCents(key, tier, interval))}${intervalSuffix(interval)}`;

/** What a card says under its price: the other tier, or how the yearly price works. */
export function alacartePriceNote(key: AlacarteKey, tier: AlacarteTier, interval: BillingInterval, signedIn: boolean): string {
  const it = ALACARTE[key];
  const per = it.unit ? ` per ${it.unit}` : "";
  if (!signedIn || tier === "standalone") {
    return `${interval === "year" ? `${formatUsd(Math.round(alacartePriceCents(key, "standalone", "year") / 12))}/mo billed yearly${per} · ` : ""}or ${priceLabel(key, "addon", interval)}${per} as an add-on to any plan`;
  }
  return interval === "year"
    ? `${formatUsd(Math.round(alacartePriceCents(key, "addon", "year") / 12))}/mo billed yearly${per} · the add-on price, because you have a plan`
    : `the add-on price${per}, because you have a plan · save ${formatUsd(alacarteAnnualSavingsCents(key, "addon"))} on yearly billing`;
}

export function AlacarteCards({ interval, signedIn }: { interval: BillingInterval; signedIn: boolean }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: me, isPending } = useQuery<AlacarteMe>({ queryKey: ["/api/alacarte/me"], enabled: signedIn });
  const [quantities, setQuantities] = useState<Partial<Record<AlacarteKey, number>>>({});
  const tier: AlacarteTier = signedIn && me ? me.tier : "standalone";
  const held = new Map((me?.items ?? []).filter((i) => i.key).map((i) => [i.key!, i]));

  const checkout = useMutation({
    mutationFn: async (body: { key: AlacarteKey; interval: BillingInterval; quantity: number }) =>
      (await apiRequest("POST", "/api/alacarte/checkout", body)).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: (err, body) => {
      const code = apiErrorCode(err);
      if (code === "crm_plan_required") {
        toast({ title: `${ALACARTE[body.key].name} needs a CRM plan`, description: apiErrorMessage(err), action: undefined });
        setLocation("/pricing#crm");
        return;
      }
      toast({ title: "Couldn't start checkout", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const buy = (key: AlacarteKey) => {
    if (!signedIn) { setLocation(`/auth?next=${encodeURIComponent(`${ALACARTE_PRICING_HREF.split("#")[0]}${interval === "year" ? "?interval=year" : ""}#alacarte`)}`); return; }
    trackEvent("begin_checkout", { item_category: "alacarte", item: key, tier });
    checkout.mutate({ key, interval, quantity: quantities[key] ?? 1 });
  };

  const busy = checkout.isPending || (signedIn && isPending);

  return (
    <div data-testid="section-alacarte" id="alacarte-cards">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {ALACARTE_KEYS.map((key, index) => {
          const it = ALACARTE[key];
          const row = held.get(key);
          const active = !!row?.active;
          const paused = !!row && !row.active && row.hasLiveSubscription;
          const covered = !!me?.covered.includes(key) || !!me?.isPlatformAdmin;
          const needsCrm = !!it.requiresCrmPlan && signedIn && !!me && !me.crmPlanActive && !active;
          const quantity = quantities[key] ?? 1;
          const pending = checkout.isPending && checkout.variables?.key === key;
          const cents = alacartePriceCents(key, tier, interval) * quantity;
          return (
            <div key={key} className="relative flex flex-col rounded-2xl border border-mkt-rule bg-mkt-card p-6 hover:border-mkt-ink transition-colors" data-testid={`card-alacarte-${key}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{it.name}</h3>
                <span className="font-display italic text-mkt-muted text-lg leading-none pt-1 shrink-0" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {active && <Badge variant="outline" className="font-sans text-[10px] rounded-full border-mkt-ink text-mkt-ink" data-testid={`badge-alacarte-active-${key}`}><Check className="w-3 h-3 mr-1 text-mkt-orange-ink" />Active{row!.quantity > 1 ? ` × ${row!.quantity}` : ""}{row!.cancelAtPeriodEnd ? " · ends at period end" : ""}</Badge>}
                {paused && <Badge variant="outline" className="font-sans text-[10px] rounded-full border-red-600 text-red-700" data-testid={`badge-alacarte-paused-${key}`}>Payment needed</Badge>}
                {it.comingPart && <Badge variant="outline" className="font-sans text-[10px] rounded-full border-mkt-orange text-mkt-orange-ink" data-testid={`badge-alacarte-coming-${key}`}>{it.comingPart}: coming soon</Badge>}
                {it.requiresCrmPlan && <Badge variant="outline" className="font-sans text-[10px] rounded-full border-mkt-rule text-mkt-muted" data-testid={`badge-alacarte-crm-${key}`}>On a CRM plan</Badge>}
              </div>
              <p className="mt-3 text-[14px] text-mkt-ink-soft leading-relaxed flex-1">{it.pitch}</p>
              <div className="mt-5 font-display font-semibold text-mkt-ink leading-none whitespace-nowrap" data-testid={`text-alacarte-price-${key}`}>
                <span className="text-[2.2rem] tracking-[-0.02em]">{formatUsd(cents)}</span>
                <span className="font-sans text-[14px] font-medium text-mkt-muted ml-1">{intervalSuffix(interval)}</span>
                {it.unit && <span className="font-sans text-[12px] font-medium text-mkt-muted ml-1">· {quantity} {it.unit}{quantity === 1 ? "" : "s"}</span>}
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mkt-muted min-h-[2.5rem]" data-testid={`text-alacarte-note-${key}`}>
                {it.requiresCrmPlan
                  ? `${priceLabel(key, "addon", interval)} on top of any CRM plan. Stand-alone ${it.name} (${priceLabel(key, "standalone", interval)}) is coming.`
                  : alacartePriceNote(key, tier, interval, signedIn)}
              </p>
              {it.unit && !active && (
                <label className="mt-2 flex items-center gap-2 text-[13px] text-mkt-ink-soft">
                  <span>{it.unit.charAt(0).toUpperCase() + it.unit.slice(1)}s</span>
                  <input
                    type="number" min={1} max={ALACARTE_MAX_QUANTITY} value={quantity}
                    onChange={(e) => setQuantities((q) => ({ ...q, [key]: Math.min(ALACARTE_MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value) || 1))) }))}
                    className="w-16 rounded-md border border-mkt-rule bg-mkt-paper px-2 py-1 text-mkt-ink"
                    aria-label={`Number of ${it.unit}s`} data-testid={`input-alacarte-quantity-${key}`}
                  />
                </label>
              )}
              <div className="mt-4 space-y-2">
                {active ? (
                  <Button variant="outline" disabled className="w-full border-2 border-mkt-rule bg-transparent text-mkt-ink-soft h-11 rounded-lg" data-testid={`button-alacarte-${key}`}>
                    <Check className="w-4 h-4 mr-1 text-mkt-orange-ink" /> Active
                  </Button>
                ) : paused ? (
                  <Button variant="outline" className={`w-full ${OUTLINE_BUTTON}`} onClick={() => setLocation("/settings?tab=billing")} data-testid={`button-alacarte-${key}`}>
                    Update payment
                  </Button>
                ) : covered ? (
                  <Button variant="outline" disabled className="w-full border-2 border-mkt-rule bg-transparent text-mkt-ink-soft h-11 rounded-lg" data-testid={`button-alacarte-${key}`}>
                    <Check className="w-4 h-4 mr-1 text-mkt-orange-ink" /> Included in your plan
                  </Button>
                ) : needsCrm ? (
                  <Button variant="outline" className={`w-full ${OUTLINE_BUTTON}`} onClick={() => setLocation("/pricing#crm")} data-testid={`button-alacarte-${key}`}>
                    <Lock className="w-4 h-4 mr-1" /> Choose a CRM plan first
                  </Button>
                ) : (
                  <Button className={`w-full ${tier === "addon" ? NAVY_BUTTON : OUTLINE_BUTTON}`} variant={tier === "addon" ? "default" : "outline"} disabled={busy} onClick={() => buy(key)} data-testid={`button-alacarte-${key}`}>
                    {pending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                    {signedIn ? (tier === "addon" ? "Add to my plan" : "Buy") : "Buy"} · {formatUsd(cents)}{intervalSuffix(interval)}
                  </Button>
                )}
                <p className="text-center text-[13px]">
                  <Link href={`/features/${it.slug}`} className={TEXT_LINK} data-testid={`link-alacarte-compare-${key}`}>Compare</Link>
                </p>
              </div>
            </div>
          );
        })}

        {/* Already stand-alone products: their own cards, never a second checkout. */}
        {ALACARTE_LINKED.map((l) => (
          <div key={l.key} className="flex flex-col rounded-2xl border border-dashed border-mkt-rule bg-mkt-paper p-6" data-testid={`card-alacarte-linked-${l.key}`}>
            <h3 className="font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{l.name}</h3>
            <p className="mt-3 text-[14px] text-mkt-ink-soft leading-relaxed flex-1">{l.pitch}</p>
            <div className="mt-5 font-display font-semibold text-mkt-ink leading-none whitespace-nowrap">
              <span className="font-sans text-[13px] font-medium text-mkt-muted mr-1">from</span>
              <span className="text-[2.2rem] tracking-[-0.02em]">{formatUsd(l.fromMonthlyCents)}</span>
              <span className="font-sans text-[14px] font-medium text-mkt-muted ml-1">/mo</span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mkt-muted min-h-[2.5rem]">Its own plans and its own subscription, with or without anything else.</p>
            <div className="mt-4 space-y-2">
              <Button variant="outline" className={`w-full ${OUTLINE_BUTTON}`} onClick={() => setLocation(l.href)} data-testid={`button-alacarte-linked-${l.key}`}>
                See {l.name} plans <ExternalLink className="w-4 h-4 ml-1" />
              </Button>
              <p className="text-center text-[13px]">
                <Link href={l.key === "call_assistant" ? "/call-assistant" : `/features/${l.slug}`} className={TEXT_LINK} data-testid={`link-alacarte-compare-${l.key}`}>Compare</Link>
              </p>
            </div>
          </div>
        ))}

        {/* Add-on only: a texting number needs a plan's text allowance to send with. */}
        {ALACARTE_ADDON_ONLY.map((a) => {
          const addon = ADDONS[a.addon];
          return (
            <div key={a.addon} className="flex flex-col rounded-2xl border border-dashed border-mkt-rule bg-mkt-paper p-6" data-testid={`card-alacarte-addon-${a.addon}`}>
              <h3 className="font-display font-semibold text-[1.3rem] leading-tight text-mkt-ink">{a.name}</h3>
              <div className="mt-2"><Badge variant="outline" className="font-sans text-[10px] rounded-full border-mkt-rule text-mkt-muted">Add-on only</Badge></div>
              <p className="mt-3 text-[14px] text-mkt-ink-soft leading-relaxed flex-1">{a.pitch}</p>
              <div className="mt-5 font-display font-semibold text-mkt-ink leading-none whitespace-nowrap" data-testid={`text-alacarte-price-${a.addon}`}>
                <span className="text-[2.2rem] tracking-[-0.02em]">{formatUsd(interval === "year" ? addon.annualCents : addon.monthlyCents)}</span>
                <span className="font-sans text-[14px] font-medium text-mkt-muted ml-1">{intervalSuffix(interval)}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mkt-muted min-h-[2.5rem]">
                {addon.setupCents ? `+ ${formatUsd(addon.setupCents)} one-time setup. ` : ""}Added to a Business Tools plan in Settings → Billing; texts count against the plan's monthly allowance.
              </p>
              <div className="mt-4 space-y-2">
                <Button variant="outline" className={`w-full ${OUTLINE_BUTTON}`} onClick={() => setLocation(signedIn ? "/settings?tab=billing" : "/pricing#plans")} data-testid={`button-alacarte-addon-${a.addon}`}>
                  {signedIn ? "Add in Settings → Billing" : "Choose a plan first"}
                </Button>
                <p className="text-center text-[13px]">
                  <Link href={`/features/${a.slug}`} className={TEXT_LINK} data-testid={`link-alacarte-compare-${a.addon}`}>Compare</Link>
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[13px] text-mkt-muted mt-6" data-testid="text-alacarte-footnote">
        Each tool is its own subscription: start or stop it any time (Manage billing). The add-on price applies while you have an active
        Business Tools or CRM plan; when a plan starts or ends, the price changes at your next renewal, never mid-cycle. Prices in USD.
      </p>
    </div>
  );
}
