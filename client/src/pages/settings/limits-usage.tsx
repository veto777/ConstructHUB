import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GooglePill } from "@/components/google";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import { apiErrorMessage } from "@/lib/queryClient";
import { ADDONS, ADDON_MAX_QUANTITY, PLANS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_PRICING_HREF, type AddonKey, type BillingInterval, type PlanKey, type PlanLimits } from "@shared/plans";
import { CallAssistantTierPicker } from "@/components/call-assistant-tiers";
import { CALL_ASSISTANT_SEPARATE_LINE, callAssistantOverageLine, callAssistantTierNumbersLine, callAssistantOverageStatusLine } from "@shared/plan-copy";
import {
  addonPriceCents, formatUsd, intervalSuffix, type EntitlementsInfo, type UsageMeter,
} from "@/lib/pricing-display";
import { LoadingCard, formatCount, useOptionalQuery } from "./shared";
import { useAddonChange, useBillingActions, useCallAssistantChange, useCallAssistantSubscription, useEntitlements, useSubscription } from "./use-billing";
import type { SettingsSectionProps } from "./types";
import { formatJobcamTier, formatJobcamUsage } from "@shared/jobcam-storage";

/**
 * Workspace → Limits & usage: every limit in the price book (shared/plans.ts
 * PlanLimits) with what the plan includes and what this account has used, as
 * the server counts it (GET /api/entitlements plus the lists each count comes
 * from). The add-on that raises a limit sits under it with the same +/-
 * controls as Billing, so a full meter and its fix are on one row.
 */

/** API allowances arrive with the account foundation; older servers don't send them. */
type ApiAllowances = { apiUnitsPerMonth?: number; apiRatePerMinute?: number };
type ApiKeysPlan = { plan?: { apiEnabled?: boolean; unitsPerMonth?: number; usedThisMonth?: number; ratePerMinute?: number } };

type LimitRow = {
  key: string;
  label: string;
  /** What the plan includes, already formatted. */
  included: string;
  /** Nothing of this in the plan (shown muted). */
  excluded?: boolean;
  /** The count this account has used; `null` = not counted for this limit, `undefined` = not reported by the server. */
  used?: number | null;
  /** The "Used" cell when a plain count doesn't say it (JobCam storage reads "4.2 of 5 GB"). */
  usedText?: string;
  /** The finite ceiling the bar measures against (omit for unlimited / not a count). */
  ceiling?: number;
  /** "/ mo" counts reset monthly; the rest are standing counts. */
  monthly?: boolean;
  hint?: string;
  /** The add-on that raises this limit (shown when the plan can buy it). */
  addon?: AddonKey;
  /** Extra control instead of an add-on (a legacy per-location Agency subscription keeps its location-count change). */
  action?: ReactNode;
};

type LimitGroup = { title: string; rows: LimitRow[] };

/** GET /api/crm/voice/status — the subset this page reads (server/voice/billing.ts). Answers without the add-on. */
type VoiceStatusLite = {
  enabled: boolean;
  /** Bought, but paused until a payment goes through (server/voice/billing.ts). */
  paused?: boolean;
  allowance: { numbers: number; minutes: number };
  pricing: { includedMinutes: number; overageCentsPerMinute: number; freeSpamCalls?: number };
  /** "off": minutes above the plan are counted and shown but not charged yet (the server's overage switch). */
  overageBilling?: "on" | "off";
  /** The held Call Assistant tier (server/voice/billing.ts). */
  tier?: { key: string; addon: string; name: string } | null;
  numberAllowance?: { used: number };
  usage: { minutes: number; overageMinutes: number; overageCents: number; spamCallsThisMonth?: number } | null;
};

/** The SEO rows on a plan without the tools (owner, 2026-10-08): where they are, no price, no count. */
const SEO_AGENCY_HINT = "SEO tools are included with the Agency plan. Accounts that already have them keep them.";

/** How a -1 limit reads: platform admins are simply unlimited; a plan's -1 is fair use. */
const FAIR_USE = "Unlimited (fair use)";
export const ADMIN_UNLIMITED = "Unlimited";
const countText = (v: number, unlimited = FAIR_USE) => (v < 0 ? unlimited : v === 0 ? "Not included" : formatCount(v));
const perMonth = (v: number, unlimited = FAIR_USE) => (v < 0 ? unlimited : v === 0 ? "Not included" : `${formatCount(v)} / mo`);

/** Monthly meters as the server reports them: the effective limit already accounts for per-location plans. */
function meterRow(key: string, label: string, meter: UsageMeter | undefined, fallbackLimit: number, extra: Partial<LimitRow> = {}, unlimited = FAIR_USE): LimitRow {
  const limit = meter ? meter.limit : fallbackLimit;
  return {
    key, label,
    included: perMonth(limit, unlimited),
    excluded: limit === 0,
    used: limit === 0 ? null : meter ? Math.max(0, meter.used) : undefined,
    ceiling: limit > 0 ? limit : undefined,
    monthly: true,
    ...extra,
  };
}

export function LimitsUsageSection({ go }: SettingsSectionProps) {
  const [, navigate] = useLocation();
  const ent = useEntitlements();
  const { data: subscription, view } = useSubscription();
  const { addon: addonMutation, salesTopic, setSalesTopic } = useBillingActions();
  const addonChange = useAddonChange(addonMutation);
  // The AI Call Assistant is its own subscription (server/voice/subscription.ts): its tier and extra numbers change
  // there, and a change that pays for fewer numbers than the account holds asks first (the numbers are released, not kept).
  const { data: callAssistant } = useCallAssistantSubscription();
  const callAssistantMutation = useCallAssistantChange();
  const callAssistantChange = useAddonChange(callAssistantMutation);

  const entitlements = ent.data;
  const plan: PlanKey | null = entitlements?.accessPlan ?? null;
  const allowances: PlanLimits | null = entitlements?.allowances ?? null;
  const api = (allowances ?? {}) as ApiAllowances;
  const hasApi = typeof api.apiUnitsPerMonth === "number";

  // Standing counts come from the lists each gate counts; a list that can't load leaves the count "not reported".
  const domains = useQuery<unknown[]>({ queryKey: ["/api/click-guard/domains"], enabled: !!allowances && allowances.protectedSites !== 0 });
  // ConstructHUB SEO: tracked keywords are a standing count the SEO status reports; the two monthly meters come with the entitlements.
  const seo = useOptionalQuery<{ configured: boolean; usage: { keywords: UsageMeter }; credits?: { includedUsedCents: number; walletCents: number; notice?: string | null } }>("/api/seo/status", !!allowances && allowances.seoKeywords !== 0);
  const crmMe = useQuery<{ seats?: { used: number; limit: number }; crm?: { jobcam?: boolean } }>({ queryKey: ["/api/crm/me"], enabled: !!allowances });
  // JobCam storage (the CRM's job photos & video): the same numbers as the meter in JobCam.
  const jobcam = useOptionalQuery<{ bytes: number; tierGb: number; limitBytes: number; nextTierGb: number | null; full: boolean }>(
    "/api/crm/jobcam/usage", !!allowances && crmMe.data?.crm?.jobcam === true);
  const templates = useQuery<unknown[]>({ queryKey: ["/api/review-templates"], enabled: !!allowances && allowances.reviewTemplates !== 0 });
  const apiKeys = useOptionalQuery<ApiKeysPlan>("/api/account/api-keys", hasApi);
  // The Call Assistant's status answers for every account (a separate service, with or without a plan).
  const voice = useOptionalQuery<VoiceStatusLite>("/api/crm/voice/status", !!entitlements);

  if (ent.isLoading) return <LoadingCard label="Loading your limits…" />;
  if (ent.error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive" role="alert" data-testid="text-limits-error">
          Couldn't load your limits. {apiErrorMessage(ent.error)}
        </CardContent>
      </Card>
    );
  }

  if (!entitlements || !plan || !allowances) {
    return (
      <Card data-testid="card-limits-no-plan">
        <CardHeader>
          <CardTitle className="text-base">No active plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Limits come with a plan. Choose one in Pricing and this page shows what it includes and how much of it you've used.
          </p>
          <div className="flex flex-wrap gap-2">
            <GooglePill variant="solid" label="Compare plans" onClick={() => navigate("/pricing")} testId="button-limits-choose-plan" />
            <GooglePill label="Open billing" onClick={() => go("billing")} testId="button-limits-open-billing" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const usage = entitlements.usage ?? {};
  // Platform admins (the Alpine account) are all-access: every usage limit is -1, no add-on raises anything.
  const admin = entitlements.isPlatformAdmin === true;
  const unl = admin ? ADMIN_UNLIMITED : FAIR_USE;
  // A stored legacy Agency-band subscription still reports the location count it is billed for; a current
  // plan's limits are flat (Unlimited's locations are simply unlimited), which the rows below show as-is.
  const isAgency = plan === "agency" && !admin;
  const interval: BillingInterval = view.interval ?? "month";
  // Add-ons change a Stripe subscription on a current plan; a legacy plan keeps its old price until it switches in Pricing.
  const editable = view.changesInPlace && !view.isLegacy;
  const pendingAddon = addonMutation.isPending ? addonMutation.variables?.addon : null;
  const resets = entitlements.resetsAt ? new Date(entitlements.resetsAt) : null;
  const apiPlan = apiKeys.data?.plan;

  const groups: LimitGroup[] = [
    {
      title: "Google Business Profile",
      rows: [
        {
          key: "locations",
          label: "Google Business Profile locations",
          included: countText(allowances.locations, unl),
          used: entitlements.locations?.used ?? undefined,
          ceiling: allowances.locations > 0 ? allowances.locations : undefined,
          hint: isAgency && view.locations ? `Billed for ${formatCount(view.locations)} locations (your legacy per-location plan).` : undefined,
          action: isAgency && view.locations ? (
            <Button size="sm" variant="outline" onClick={() => go("billing")} data-testid="button-limits-locations">Change location count</Button>
          ) : undefined,
        },
        {
          key: "guardCadenceMinutes",
          label: "Profile Guard edit checks",
          included: `Every ${formatCount(allowances.guardCadenceMinutes)} min`,
          used: null,
          hint: "How often Profile Guard compares your listing with its approved snapshot.",
        },
        meterRow("gridCredits", "Ranking-grid credits", usage.rankings, allowances.gridCredits, {
          hint: "One credit per 25 grid points.",
        }, unl),
        {
          key: "reviewTemplates",
          label: "Review request templates",
          included: countText(allowances.reviewTemplates, unl),
          excluded: allowances.reviewTemplates === 0,
          used: allowances.reviewTemplates === 0 ? null : templates.data ? templates.data.length : undefined,
          ceiling: allowances.reviewTemplates > 0 ? allowances.reviewTemplates : undefined,
        },
        {
          key: "autoPublishAiReplies",
          label: "AI review replies publish automatically",
          included: allowances.autoPublishAiReplies ? "Included" : "Not included",
          excluded: !allowances.autoPublishAiReplies,
          used: null,
          hint: allowances.autoPublishAiReplies ? undefined : "Drafts wait for your approval on this plan.",
        },
      ],
    },
    {
      title: "Websites & ads",
      rows: [
        {
          key: "protectedSites",
          label: "Protected websites (Click Guard + IP Tracker + VPN Shield)",
          included: countText(allowances.protectedSites, unl),
          excluded: allowances.protectedSites === 0,
          used: allowances.protectedSites === 0 ? null : domains.data ? domains.data.length : undefined,
          ceiling: allowances.protectedSites > 0 ? allowances.protectedSites : undefined,
          addon: "protected_site",
        },
        meterRow("siteScans", "Site Scans", usage.siteScans, allowances.siteScans, undefined, unl),
        meterRow("competitorScans", "Competitor Intel scans", usage.competitorScans, allowances.competitorScans, { addon: "competitor_pack" }, unl),
        // ConstructHUB SEO (rank tracker, keyword research, backlinks): a taste on Agency, the full suite on Unlimited,
        // an add-on below that (shared/plans.ts SEO_PLAN_LIMITS, ADDONS.seo_*); an account that had the tools before
        // keeps them (server/entitlements.ts seoGrandfathered).
        {
          key: "seoKeywords", label: "SEO: tracked keywords",
          included: countText(allowances.seoKeywords, unl),
          excluded: allowances.seoKeywords === 0,
          used: allowances.seoKeywords === 0 ? null : seo.data ? Math.max(0, seo.data.usage.keywords.used) : undefined,
          ceiling: allowances.seoKeywords > 0 ? allowances.seoKeywords : undefined,
          hint: allowances.seoKeywords === 0 ? SEO_AGENCY_HINT
            : seo.data && !seo.data.configured ? "Rank tracking is being switched on for your account — check back shortly."
            : `${entitlements?.seoGrandfathered ? "Your plan keeps the SEO tools it had. " : ""}Checked on Google every week.`,
        },
        {
          key: "seoCreditCents", label: "SEO data",
          included: allowances.seoCreditCents < 0 ? "Unlimited" : `$${(allowances.seoCreditCents / 100).toFixed(0)} a month`,
          excluded: allowances.seoCreditCents === 0,
          used: allowances.seoCreditCents === 0 ? null : seo.data?.credits ? seo.data.credits.includedUsedCents / 100 : undefined,
          ceiling: allowances.seoCreditCents > 0 ? allowances.seoCreditCents / 100 : undefined,
          // A refunded or disputed credit pack: the account says what happened and what to do, in plain words.
          hint: allowances.seoCreditCents === 0 ? SEO_AGENCY_HINT
            : seo.data?.credits?.notice ? seo.data.credits.notice
            : seo.data?.credits && seo.data.credits.walletCents > 0
            ? `Site explorer, keyword research, backlinks and rank checks, in dollars. Plus $${(seo.data.credits.walletCents / 100).toFixed(2)} purchased credit.`
            : "Site explorer, keyword research, backlinks and rank checks, in dollars. More can be added as prepaid credit on the SEO page.",
        },
      ],
    },
    {
      title: "Permits & CRM",
      rows: [
        meterRow("permitSearches", "Permit searches", usage.searches, allowances.permitSearches, {}, unl),
        meterRow("teamTextSegments", "Team text alerts", usage.texts, allowances.teamTextSegments, {
          hint: allowances.teamTextSegments === 0 ? undefined : "Every text the workspace sends counts, by segment: 160 characters, or 70 with emoji or special characters.",
        }, unl),
        {
          key: "clientTexting",
          label: "Two-way client texting",
          // A platform admin can't buy the add-on (the button is hidden) and texting is on (orgSmsEntitled).
          included: admin ? "Included (own or dedicated number)"
            : allowances.clientTexting === "none" ? "Not included"
            : allowances.clientTexting === "included" ? "1 number included"
            : "Your SignalWire number or the texting add-on",
          excluded: allowances.clientTexting === "none",
          used: null,
          addon: allowances.clientTexting === "none" ? undefined : "texting_number",
        },
        // JobCam belongs to the CRM subscription, not this plan; larger storage sizes are requested, not bought.
        crmMe.data?.crm?.jobcam === true ? {
          key: "jobcamStorage",
          label: "JobCam storage",
          included: jobcam.data ? formatJobcamTier(jobcam.data.tierGb) : "—",
          used: jobcam.data ? jobcam.data.bytes : undefined,
          usedText: jobcam.data ? formatJobcamUsage(jobcam.data.bytes, jobcam.data.tierGb) : undefined,
          ceiling: jobcam.data?.limitBytes,
          hint: jobcam.data?.full
            ? `Storage is full: new photos and videos wait until you delete some or get more.${jobcam.data.nextTierGb ? ` Next size: ${formatJobcamTier(jobcam.data.nextTierGb)} — request it in JobCam.` : ""}`
            : "Job photos, videos and their previews. Need more? Request it in JobCam when you're near the limit.",
        } : {
          key: "jobcamStorage",
          label: "JobCam storage",
          included: "Not included",
          excluded: true,
          used: null,
          hint: "JobCam is part of the ConstructHUB CRM subscription, not this plan.",
        },
      ],
    },
  ];

  {
    const vs = voice.data ?? null;
    const on = vs?.enabled === true;
    const paused = !on && vs?.paused === true;
    const minutes = on ? vs!.allowance.minutes : 0;
    const numbers = on ? vs!.allowance.numbers : 0;
    const overage = on && vs!.usage && vs!.usage.overageMinutes > 0 ? vs!.usage : null;
    const caLive = !!callAssistant?.hasLiveSubscription && !admin;
    const caInterval: BillingInterval = callAssistant?.interval ?? "month";
    const extraNumbers = callAssistant?.extraNumbers ?? 0;
    const caPending = callAssistantMutation.isPending ? callAssistantMutation.variables?.addon ?? null : null;
    groups.push({
      title: "AI Call Assistant",
      rows: [
        {
          key: "callAssistantMinutes",
          label: "Call Assistant minutes",
          included: on ? perMonth(minutes, unl) : paused ? "Paused" : "Not subscribed",
          excluded: !on,
          used: !on ? null : vs!.usage ? vs!.usage.minutes : 0,
          ceiling: on && minutes > 0 ? minutes : undefined,
          monthly: true,
          hint: admin && on
            ? "Unlimited for platform admins: every started minute is counted here and none is billed as overage."
            : paused
            ? "Paused: the subscription's payment didn't go through. Update your payment method in Billing and the assistant answers again; your number is held meanwhile."
            : overage
            ? `${formatCount(overage.overageMinutes)} minutes over the included ones this month: ${formatUsd(overage.overageCents)} so far, each call at the rate in force when it was taken. ${callAssistantOverageStatusLine(vs!.overageBilling, vs!.pricing.overageCentsPerMinute)}`
            : on
            ? `Every started minute of an answered call counts; blocked spam costs nothing. Above the included minutes: ${callAssistantOverageLine()}.`
            : CALL_ASSISTANT_SEPARATE_LINE,
          action: (
            <div className="w-full space-y-2" data-testid="row-limit-call-assistant-tier">
              <p className="text-xs text-muted-foreground">
                {vs?.tier ? `Your tier: ${vs.tier.name}.` : caLive ? "Pick a tier." : ""} Every tier: the first {formatCount(vs?.pricing.freeSpamCalls ?? CALL_ASSISTANT_FREE_SPAM_CALLS)} spam calls each month never count toward your minutes.
                {vs?.usage?.spamCallsThisMonth ? ` ${formatCount(vs.usage.spamCallsThisMonth)} spam calls stopped this month.` : ""}
              </p>
              {caLive ? (
                <CallAssistantTierPicker
                  compact
                  addons={callAssistant?.addons}
                  interval={caInterval}
                  editable={!callAssistantChange.checking}
                  pending={caPending}
                  onSwitch={(addon) => void callAssistantChange.request({ addon, quantity: 1 }, 0)}
                />
              ) : !admin && !paused ? (
                <GooglePill variant="solid" label={`See ${CALL_ASSISTANT_NAME} pricing`} onClick={() => navigate(CALL_ASSISTANT_PRICING_HREF)} testId="button-limits-call-assistant-pricing" />
              ) : null}
            </div>
          ),
        },
        {
          key: "callAssistantNumbers",
          label: "Call Assistant phone numbers",
          included: on ? countText(numbers, unl) : "Not subscribed",
          excluded: !on,
          used: !on ? null : vs!.numberAllowance ? vs!.numberAllowance.used : undefined,
          ceiling: on && numbers > 0 ? numbers : undefined,
          hint: admin
            ? `Platform admins can hold up to ${formatCount(numbers)} numbers: each one is a real carrier number. Buy and release them in Call Assistant → Numbers.`
            : `${callAssistantTierNumbersLine()}; buy and release them in Call Assistant → Numbers.`,
          // Extra numbers are a line of the Call Assistant's own subscription, not a plan add-on.
          action: caLive ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-3" data-testid="row-limit-addon-call_number">
              <div className="min-w-0 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{ADDONS.call_number.name}</span> · {formatUsd(addonPriceCents(ADDONS.call_number, caInterval))}{intervalSuffix(caInterval)} each
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="h-10 w-10" aria-label={`Remove one ${ADDONS.call_number.name}`}
                  disabled={callAssistantMutation.isPending || callAssistantChange.checking || extraNumbers === 0}
                  onClick={() => void callAssistantChange.request({ addon: "call_number", quantity: extraNumbers - 1 }, extraNumbers)}
                  data-testid="button-limit-addon-dec-call_number">
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" data-testid="text-limit-addon-qty-call_number">
                  {caPending === "call_number" ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : extraNumbers}
                </span>
                <Button size="icon" variant="outline" className="h-10 w-10" aria-label={`Add one ${ADDONS.call_number.name}`}
                  disabled={callAssistantMutation.isPending || extraNumbers >= ADDON_MAX_QUANTITY}
                  onClick={() => callAssistantMutation.mutate({ addon: "call_number", quantity: extraNumbers + 1 })}
                  data-testid="button-limit-addon-inc-call_number">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : undefined,
        },
      ],
    });
  }

  if (hasApi) {
    groups.push({
      title: "API",
      rows: [
        {
          key: "apiUnitsPerMonth",
          label: "API units",
          included: perMonth(api.apiUnitsPerMonth ?? 0, unl),
          excluded: (api.apiUnitsPerMonth ?? 0) === 0,
          used: (api.apiUnitsPerMonth ?? 0) === 0 ? null : apiPlan && typeof apiPlan.usedThisMonth === "number" ? apiPlan.usedThisMonth : undefined,
          ceiling: (api.apiUnitsPerMonth ?? 0) > 0 ? api.apiUnitsPerMonth : undefined,
          monthly: true,
          hint: "Reads cost 1 unit per call plus 1 per 100 rows; writes cost 5. AI features are never available through the API.",
          action: <Button size="sm" variant="outline" onClick={() => go("api-keys")} data-testid="button-limits-api-keys">Manage API keys</Button>,
        },
        {
          key: "apiRatePerMinute",
          label: "API requests per minute",
          included: typeof api.apiRatePerMinute === "number" ? `${formatCount(api.apiRatePerMinute)} / min per key` : "—",
          used: null,
        },
      ],
    });
  }

  return (
    <div className="space-y-6" data-testid="section-limits">
      <Card data-testid="card-limits-plan">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="g-card__title g-card__title--md flex flex-wrap items-center gap-2" data-testid="text-limits-plan">
                {admin ? "All features, unlimited" : `${entitlements.planName ?? PLANS[plan].name} plan limits`}
                {admin && (
                  <Badge variant="outline" className="text-[10px]" data-testid="badge-limits-admin">Platform admin</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="text-limits-resets">
                {/* The meters roll over at midnight UTC (billing runs on it); say when that is on the viewer's own clock
                    (audit lane 1 G; owner 2026-10-04: as recommended). */}
                {resets ? `Monthly counts reset ${resets.toLocaleString(undefined, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.` : ""}
                {admin
                  ? " This is a platform admin account: every feature and add-on is on, and every plan limit is unlimited, whatever plan it holds. Per-day safety caps still apply (for example 5 Site Scans and 40 Gabe questions a day), and the Call Assistant keeps a ceiling on phone numbers." : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <GooglePill label="Billing" onClick={() => go("billing")} testId="button-limits-billing" />
              <GooglePill variant="solid" label="Change plan" onClick={() => navigate("/pricing")} testId="button-limits-change-plan" />
            </div>
          </div>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.title} data-testid={`card-limits-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{group.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 pb-2 text-[11px] font-semibold  text-muted-foreground">
              <span>Limit</span>
              <span className="text-right">Included</span>
              <span className="text-right">Used</span>
            </div>
            {group.rows.map((row) => {
              // Nothing to buy on an all-access admin account.
              const addon = !admin && row.addon && ADDONS[row.addon].availableOn.includes(plan) ? ADDONS[row.addon] : null;
              const qty = addon ? Math.max(0, Number(subscription?.addons?.[addon.key] ?? 0) || 0) : 0;
              const pct = row.ceiling && typeof row.used === "number" ? Math.min(100, Math.round((row.used / row.ceiling) * 100)) : null;
              const usedText = row.used === null ? "—"
                : row.used === undefined ? "Not reported"
                : row.usedText ? row.usedText
                : row.ceiling ? `${formatCount(row.used)} of ${formatCount(row.ceiling)}`
                : `${formatCount(row.used)} used`;
              return (
                <div key={row.key} className="border-t py-3 space-y-2" data-testid={`limit-${row.key}`}>
                  <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:gap-3 sm:items-start">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${row.excluded ? "text-muted-foreground" : ""}`}>{row.label}</p>
                      {row.hint && <p className="text-xs text-muted-foreground">{row.hint}</p>}
                    </div>
                    <p className={`text-sm tabular-nums sm:text-right ${row.excluded ? "text-muted-foreground" : ""}`} data-testid={`limit-${row.key}-included`}>
                      <span className="sm:hidden text-xs text-muted-foreground">Included: </span>{row.included}
                    </p>
                    <p className={`text-sm tabular-nums sm:text-right ${pct !== null && pct >= 100 ? "text-destructive font-medium" : "text-muted-foreground"}`} data-testid={`limit-${row.key}-used`}>
                      <span className="sm:hidden text-xs text-muted-foreground">Used: </span>{usedText}{row.monthly && typeof row.used === "number" ? " this month" : ""}
                    </p>
                  </div>
                  {pct !== null && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {(addon || row.action) && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2" data-testid={addon ? `row-limit-addon-${addon.key}` : undefined}>
                      {addon ? (
                        <>
                          <div className="min-w-0 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{addon.name}</span> · {formatUsd(addonPriceCents(addon, interval))}{intervalSuffix(interval)} each
                            {addon.setupCents ? ` + ${formatUsd(addon.setupCents)} one-time setup` : ""}
                            {addon.preview && (
                              <>
                                {" · "}
                                <Badge variant="outline" className="text-[10px]" data-testid={`badge-limit-addon-preview-${addon.key}`}>Coming soon</Badge>
                              </>
                            )}
                            {!editable && !addon.preview && (
                              <>
                                {" · "}
                                <button type="button" className="underline hover:text-foreground" onClick={() => go("billing")} data-testid={`link-limit-addon-billing-${addon.key}`}>
                                  managed in Billing
                                </button>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-10 w-10"
                              aria-label={`Remove one ${addon.name}`}
                              disabled={!editable || addonMutation.isPending || addonChange.checking || qty === 0 || addon.preview === true}
                              onClick={() => void addonChange.request({ addon: addon.key, quantity: qty - 1 }, qty)}
                              data-testid={`button-limit-addon-dec-${addon.key}`}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" data-testid={`text-limit-addon-qty-${addon.key}`}>
                              {pendingAddon === addon.key ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : qty}
                            </span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-10 w-10"
                              aria-label={`Add one ${addon.name}`}
                              disabled={!editable || addonMutation.isPending || addon.preview === true}
                              onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty + 1 })}
                              data-testid={`button-limit-addon-inc-${addon.key}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      ) : row.action}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {addonChange.dialog}
      {callAssistantChange.dialog}
      <TalkToSalesDialog
        open={salesTopic !== null}
        onOpenChange={(open) => { if (!open) setSalesTopic(null); }}
        topic={salesTopic ?? ""}
      />
    </div>
  );
}

/** Exposed for tests: the limit keys this page renders, in order (every PlanLimits field, the Call Assistant pair — a separate service, always listed — and the API pair when present). */
export const LIMIT_ROW_KEYS: readonly (keyof PlanLimits | "jobcamStorage" | "callAssistantMinutes" | "callAssistantNumbers" | "apiUnitsPerMonth" | "apiRatePerMinute")[] = [
  "locations", "guardCadenceMinutes", "gridCredits", "reviewTemplates", "autoPublishAiReplies",
  "protectedSites", "siteScans", "competitorScans",
  "permitSearches", "teamTextSegments", "clientTexting", "jobcamStorage",
  "callAssistantMinutes", "callAssistantNumbers",
  "apiUnitsPerMonth", "apiRatePerMinute",
];
