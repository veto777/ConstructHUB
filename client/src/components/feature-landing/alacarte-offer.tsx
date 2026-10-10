/**
 * The à la carte offer on a feature page (shared/alacarte.ts): for each item the
 * page sells, Buy at the viewer's price — the standalone price with "or $X/mo as
 * an add-on to any plan" signed out or without a plan, the add-on price alone
 * with one — and "Included in <plan>" for the cheapest plan that carries the
 * feature. A signed-in owner of the item sees "Active"; a plan that already
 * covers it, "Included in your plan". Never rendered in the iPhone apps:
 * /features is an APP_SALES_PATH, and the route gate stands down there.
 */
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { formatUsd, intervalSuffix } from "@/lib/pricing-display";
import type { AlacarteMe } from "@/components/alacarte-cards";
import type { FeaturePriceSummary } from "@shared/feature-pages/pricing";
import { PLANS, type BillingInterval } from "@shared/plans";
import { ALACARTE, ALACARTE_PRICING_HREF, alacartePriceCents, type AlacarteKey, type AlacarteTier } from "@shared/alacarte";
import { BTN_LG, BTN_OUTLINE, BTN_PRIMARY, TEXT_LINK } from "./primitives";

const INTERVAL: BillingInterval = "month";

/** The standalone price "on its own, or … as an add-on to any plan"; with a plan, the add-on price alone (prices from the price book). */
export function offerLine(key: AlacarteKey, tier: AlacarteTier, signedIn: boolean): string {
  const it = ALACARTE[key];
  const per = it.unit ? ` per ${it.unit}` : "";
  const standalone = `${formatUsd(alacartePriceCents(key, "standalone", INTERVAL))}${intervalSuffix(INTERVAL)}`;
  const addon = `${formatUsd(alacartePriceCents(key, "addon", INTERVAL))}${intervalSuffix(INTERVAL)}`;
  if (signedIn && tier === "addon") return `${addon}${per} as an add-on to your plan (${standalone} on its own).`;
  return `${standalone}${per} on its own, or ${addon}${per} as an add-on to any plan.`;
}

export function AlacarteOffer({ keys, price, slug, signedIn }: { keys: AlacarteKey[]; price: FeaturePriceSummary; slug: string; signedIn: boolean }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: me } = useQuery<AlacarteMe>({ queryKey: ["/api/alacarte/me"], enabled: signedIn });
  const tier: AlacarteTier = signedIn && me ? me.tier : "standalone";
  const held = new Map((me?.items ?? []).filter((i) => i.key).map((i) => [i.key!, i]));
  const checkout = useMutation({
    mutationFn: async (key: AlacarteKey) => (await apiRequest("POST", "/api/alacarte/checkout", { key, interval: INTERVAL, quantity: 1, returnTo: "feature" })).json(),
    onSuccess: (data) => { if (data?.url) window.location.href = data.url; },
    onError: (err, key) => {
      toast({ title: `Couldn't start checkout for ${ALACARTE[key].name}`, description: apiErrorMessage(err), variant: "destructive" });
    },
  });
  const buy = (key: AlacarteKey) => {
    if (!signedIn) { setLocation(`/auth?next=${encodeURIComponent(`/features/${slug}`)}`); return; }
    checkout.mutate(key);
  };
  const includedIn = price.plans[0] ? PLANS[price.plans[0]] : null;

  return (
    <div className="mt-10 grid gap-4 md:grid-cols-2" data-testid="section-feature-alacarte">
      {keys.map((key) => {
        const it = ALACARTE[key];
        const row = held.get(key);
        const active = !!row?.active;
        const covered = !!me?.covered.includes(key) || !!me?.isPlatformAdmin;
        const pending = checkout.isPending && checkout.variables === key;
        return (
          <div key={key} className="bg-mkt-card border border-mkt-rule rounded-2xl p-6 lg:p-7 text-left" data-testid={`card-feature-alacarte-${key}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">On its own</p>
            <h3 className="mt-2 font-display font-semibold text-[1.35rem] leading-tight text-mkt-ink">{it.name}</h3>
            <p className="mt-2 text-[15px] text-mkt-ink-soft leading-relaxed" data-testid={`text-feature-alacarte-offer-${key}`}>{offerLine(key, tier, signedIn)}</p>
            {it.comingPart && <p className="mt-2 text-[13px] text-mkt-orange-ink font-semibold">{it.comingPart}: coming soon.</p>}
            <div className="mt-5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              {active ? (
                <span className={`${BTN_OUTLINE} ${BTN_LG} cursor-default`} data-testid={`button-feature-alacarte-${key}`}><Check className="h-4 w-4 text-mkt-orange-ink" /> Active on your account</span>
              ) : covered ? (
                <span className={`${BTN_OUTLINE} ${BTN_LG} cursor-default`} data-testid={`button-feature-alacarte-${key}`}><Check className="h-4 w-4 text-mkt-orange-ink" /> Included in your plan</span>
              ) : (
                <button type="button" onClick={() => buy(key)} disabled={checkout.isPending} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid={`button-feature-alacarte-${key}`}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {signedIn && tier === "addon" ? "Add to my plan" : "Buy on its own"} · {formatUsd(alacartePriceCents(key, tier, INTERVAL))}{intervalSuffix(INTERVAL)}
                </button>
              )}
              <Link href={ALACARTE_PRICING_HREF} className={TEXT_LINK} data-testid={`link-feature-alacarte-tab-${key}`}>Every tool à la carte</Link>
            </div>
          </div>
        );
      })}
      {includedIn && (
        <div className="bg-mkt-paper-2 border border-mkt-rule rounded-2xl p-6 lg:p-7 text-left" data-testid="card-feature-included-in">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">With a plan</p>
          <h3 className="mt-2 font-display font-semibold text-[1.35rem] leading-tight text-mkt-ink">Included in {includedIn.name}</h3>
          <p className="mt-2 text-[15px] text-mkt-ink-soft leading-relaxed">
            From the {includedIn.name} plan at {formatUsd(includedIn.monthlyCents)}/mo{price.plans.length > 1 ? ", and every plan above it" : ""} — with the rest of the Business Tools.
          </p>
          <div className="mt-5">
            <Link href="/pricing#plans" className={`${BTN_OUTLINE} ${BTN_LG}`} data-testid="link-feature-included-in">See the plans <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      )}
    </div>
  );
}
