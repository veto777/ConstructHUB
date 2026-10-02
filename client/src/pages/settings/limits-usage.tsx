import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TalkToSalesDialog } from "@/components/talk-to-sales";
import { apiErrorMessage } from "@/lib/queryClient";
import { ADDONS, PLANS, type AddonKey, type BillingInterval, type PlanKey, type PlanLimits } from "@shared/plans";
import {
  AGENCY_INCLUDED_LOCATIONS, addonPriceCents, formatUsd, intervalSuffix, type EntitlementsInfo, type UsageMeter,
} from "@/lib/pricing-display";
import { LoadingCard, formatCount, useOptionalQuery } from "./shared";
import { useBillingActions, useEntitlements, useSubscription } from "./use-billing";
import type { SettingsSectionProps } from "./types";

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
  /** The finite ceiling the bar measures against (omit for unlimited / not a count). */
  ceiling?: number;
  /** "/ mo" counts reset monthly; the rest are standing counts. */
  monthly?: boolean;
  hint?: string;
  /** The add-on that raises this limit (shown when the plan can buy it). */
  addon?: AddonKey;
  /** Extra control instead of an add-on (Agency locations are priced per location). */
  action?: ReactNode;
};

type LimitGroup = { title: string; rows: LimitRow[] };

/** GET /api/crm/voice/status — the subset this page reads (server/voice/billing.ts). Answers without the add-on. */
type VoiceStatusLite = {
  enabled: boolean;
  allowance: { numbers: number; minutes: number };
  pricing: { includedMinutes: number; overageCentsPerMinute: number };
  numberAllowance?: { used: number };
  usage: { minutes: number; overageMinutes: number; overageCents: number } | null;
};

const countText = (v: number) => (v < 0 ? "Unlimited (fair use)" : v === 0 ? "Not included" : formatCount(v));
const perMonth = (v: number) => (v < 0 ? "Unlimited (fair use)" : v === 0 ? "Not included" : `${formatCount(v)} / mo`);

/** Monthly meters as the server reports them: the effective limit already accounts for per-location plans. */
function meterRow(key: string, label: string, meter: UsageMeter | undefined, fallbackLimit: number, extra: Partial<LimitRow> = {}): LimitRow {
  const limit = meter ? meter.limit : fallbackLimit;
  return {
    key, label,
    included: perMonth(limit),
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

  const entitlements = ent.data;
  const plan: PlanKey | null = entitlements?.accessPlan ?? null;
  const allowances: PlanLimits | null = entitlements?.allowances ?? null;
  const api = (allowances ?? {}) as ApiAllowances;
  const hasApi = typeof api.apiUnitsPerMonth === "number";

  // Standing counts come from the lists each gate counts; a list that can't load leaves the count "not reported".
  const domains = useQuery<unknown[]>({ queryKey: ["/api/click-guard/domains"], enabled: !!allowances && allowances.protectedSites !== 0 });
  const crmMe = useQuery<{ seats?: { used: number; limit: number } }>({ queryKey: ["/api/crm/me"], enabled: !!allowances });
  const templates = useQuery<unknown[]>({ queryKey: ["/api/review-templates"], enabled: !!allowances && allowances.reviewTemplates !== 0 });
  const apiKeys = useOptionalQuery<ApiKeysPlan>("/api/account/api-keys", hasApi);
  // Call Assistant add-on (numbers+billing lane): only where the plan can buy it.
  const callAssistantSold = !!entitlements?.accessPlan && ADDONS.call_assistant.availableOn.includes(entitlements.accessPlan);
  const voice = useOptionalQuery<VoiceStatusLite>("/api/crm/voice/status", callAssistantSold);

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
          <CardTitle className="text-lg">No active plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Limits come with a plan. Choose one in Pricing and this page shows what it includes and how much of it you've used.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate("/pricing")} data-testid="button-limits-choose-plan">Compare plans</Button>
            <Button size="sm" variant="outline" onClick={() => go("billing")} data-testid="button-limits-open-billing">Open Billing</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const usage = entitlements.usage ?? {};
  const isAgency = plan === "agency";
  const interval: BillingInterval = view.interval ?? "month";
  // Add-ons change a Stripe subscription on a current plan; a legacy plan keeps its old price until it switches in Pricing.
  const editable = view.changesInPlace && !view.isLegacy;
  const resets = entitlements.resetsAt ? new Date(entitlements.resetsAt) : null;
  const apiPlan = apiKeys.data?.plan;

  const groups: LimitGroup[] = [
    {
      title: "Google Business Profile",
      rows: [
        {
          key: "locations",
          label: "Google Business Profile locations",
          included: isAgency ? `${formatCount(AGENCY_INCLUDED_LOCATIONS)} included, then per location` : countText(allowances.locations),
          used: entitlements.locations?.used ?? undefined,
          ceiling: isAgency ? undefined : allowances.locations > 0 ? allowances.locations : undefined,
          hint: isAgency && view.locations ? `Billed for ${formatCount(view.locations)} locations.` : undefined,
          addon: isAgency ? undefined : "extra_location",
          action: isAgency ? (
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
          hint: isAgency ? `${formatCount(allowances.gridCreditsPerLocation)} per location each month.` : "One credit per 25 grid points.",
        }),
        {
          key: "reviewTemplates",
          label: "Review request templates",
          included: countText(allowances.reviewTemplates),
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
          included: countText(allowances.protectedSites),
          excluded: allowances.protectedSites === 0,
          used: allowances.protectedSites === 0 ? null : domains.data ? domains.data.length : undefined,
          ceiling: allowances.protectedSites > 0 ? allowances.protectedSites : undefined,
          addon: "protected_site",
        },
        meterRow("siteScans", "Site Scans", usage.siteScans, allowances.siteScans, {
          hint: isAgency ? `${formatCount(allowances.siteScansPerLocation)} per location each month.` : undefined,
        }),
        meterRow("competitorScans", "Competitor Intel scans", usage.competitorScans, allowances.competitorScans, { addon: "competitor_pack" }),
      ],
    },
    {
      title: "Permits & CRM",
      rows: [
        meterRow("permitSearches", "Permit searches", usage.searches, allowances.permitSearches),
        {
          key: "crmSeats",
          label: "CRM seats (estimates, invoices, payments)",
          included: countText(allowances.crmSeats),
          used: crmMe.data?.seats ? crmMe.data.seats.used : undefined,
          ceiling: allowances.crmSeats > 0 ? allowances.crmSeats : undefined,
          hint: isAgency ? "One pool for the CRM and the agency team." : undefined,
          addon: "extra_seat",
        },
        meterRow("teamTextSegments", "Team text alerts", usage.texts, allowances.teamTextSegments, {
          hint: allowances.teamTextSegments === 0 ? undefined : "Every text the workspace sends counts, by segment: 160 characters, or 70 with emoji or special characters.",
        }),
        {
          key: "clientTexting",
          label: "Two-way client texting",
          included: allowances.clientTexting === "none" ? "Not included"
            : allowances.clientTexting === "included" ? "1 number included"
            : "Your SignalWire number or the texting add-on",
          excluded: allowances.clientTexting === "none",
          used: null,
          addon: allowances.clientTexting === "none" ? undefined : "texting_number",
        },
      ],
    },
  ];

  if (callAssistantSold) {
    const vs = voice.data ?? null;
    const on = vs?.enabled === true;
    const minutes = on ? vs!.allowance.minutes : 0;
    const numbers = on ? vs!.allowance.numbers : 0;
    const overage = on && vs!.usage && vs!.usage.overageMinutes > 0 ? vs!.usage : null;
    groups.push({
      title: "AI Call Assistant",
      rows: [
        {
          key: "callAssistantMinutes",
          label: "Call Assistant minutes",
          included: on ? perMonth(minutes) : "Add-on",
          excluded: !on,
          used: !on ? null : vs!.usage ? vs!.usage.minutes : 0,
          ceiling: on && minutes > 0 ? minutes : undefined,
          monthly: true,
          hint: overage
            ? `${formatCount(overage.overageMinutes)} minutes over the included ones this month: ${formatUsd(overage.overageCents)} at ${formatUsd(vs!.pricing.overageCentsPerMinute)}/min, on your next invoice.`
            : `Every started minute of an answered call counts; blocked spam costs nothing. Above the included minutes: ${formatUsd(vs?.pricing.overageCentsPerMinute ?? 0)}/min.`,
          addon: "call_assistant",
        },
        {
          key: "callAssistantNumbers",
          label: "Call Assistant phone numbers",
          included: on ? countText(numbers) : "Add-on",
          excluded: !on,
          used: !on ? null : vs!.numberAllowance ? vs!.numberAllowance.used : undefined,
          ceiling: on && numbers > 0 ? numbers : undefined,
          hint: "One local number comes with each AI Call Assistant; buy and release them in CRM → Call Assistant → Numbers.",
          addon: on ? "call_number" : undefined,
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
          included: perMonth(api.apiUnitsPerMonth ?? 0),
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

  const pendingAddon = addonMutation.isPending ? addonMutation.variables?.addon : null;

  return (
    <div className="space-y-6" data-testid="section-limits">
      <Card data-testid="card-limits-plan">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="font-semibold flex flex-wrap items-center gap-2" data-testid="text-limits-plan">
                {entitlements.planName ?? PLANS[plan].name} plan limits
                {entitlements.isPlatformAdmin && entitlements.accessPlan !== entitlements.plan && (
                  <Badge variant="outline" className="text-[10px]" data-testid="badge-limits-admin">Platform admin</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="text-limits-resets">
                {resets ? `Monthly counts reset ${resets.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}.` : ""}
                {isAgency ? " Agency allowances grow with the locations you're billed for." : ""}
                {entitlements.isPlatformAdmin && entitlements.accessPlan !== entitlements.plan
                  ? ` The ${entitlements.planName} plan's limits apply to this account, whatever plan it holds.` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => go("billing")} data-testid="button-limits-billing">Billing</Button>
              <Button size="sm" onClick={() => navigate("/pricing")} data-testid="button-limits-change-plan">Change plan</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.title} data-testid={`card-limits-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{group.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Limit</span>
              <span className="text-right">Included</span>
              <span className="text-right">Used</span>
            </div>
            {group.rows.map((row) => {
              const addon = row.addon && ADDONS[row.addon].availableOn.includes(plan) ? ADDONS[row.addon] : null;
              const qty = addon ? Math.max(0, Number(subscription?.addons?.[addon.key] ?? 0) || 0) : 0;
              const pct = row.ceiling && typeof row.used === "number" ? Math.min(100, Math.round((row.used / row.ceiling) * 100)) : null;
              const usedText = row.used === null ? "—"
                : row.used === undefined ? "Not reported"
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
                              className="h-8 w-8"
                              aria-label={`Remove one ${addon.name}`}
                              disabled={!editable || addonMutation.isPending || qty === 0 || addon.preview === true}
                              onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty - 1 })}
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
                              className="h-8 w-8"
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

      <TalkToSalesDialog
        open={salesTopic !== null}
        onOpenChange={(open) => { if (!open) setSalesTopic(null); }}
        topic={salesTopic ?? ""}
      />
    </div>
  );
}

/** Exposed for tests: the limit keys this page renders, in order (every PlanLimits field, the Call Assistant pair on plans that sell it, and the API pair when present). */
export const LIMIT_ROW_KEYS: readonly (keyof PlanLimits | "callAssistantMinutes" | "callAssistantNumbers" | "apiUnitsPerMonth" | "apiRatePerMinute")[] = [
  "locations", "guardCadenceMinutes", "gridCredits", "reviewTemplates", "autoPublishAiReplies",
  "protectedSites", "siteScans", "competitorScans",
  "permitSearches", "crmSeats", "teamTextSegments", "clientTexting",
  "callAssistantMinutes", "callAssistantNumbers",
  "apiUnitsPerMonth", "apiRatePerMinute",
];
