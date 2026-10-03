import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Phone, Lock } from "lucide-react";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { AppPage, AppTabsList, PageHeader, StatusPill } from "@/components/app-ui";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrmPage, CrmPageHeader } from "@/components/crm-ui";
import { planRequiredFrom } from "@/components/plan-required";
import { ADDONS, PLANS, CALL_ASSISTANT_NAME } from "@shared/plans";
import { callAssistantIntroShort, callAssistantSpamAllowanceLine, callAssistantTiers, joinNames } from "@shared/plan-copy";
import { OverviewPanel } from "./overview";
import { CallAssistantPausedBanner } from "./paused-banner";
import { NumbersPanel } from "./numbers";
import { StudioPanel } from "./studio";
import { SimulatorPanel } from "./simulator";
import { CallsPanel } from "./calls";

/**
 * /call-assistant — the AI Call Assistant's home in the CRM
 * (docs/call-assistant/SPEC.md § Side ribbon). ARCHITECT-OWNED shell: the
 * tab strip, the plan gate and the deep link (?tab=). Each panel file is a
 * lane's (LANES.md): numbers.tsx and calls.tsx → their server lanes,
 * overview/studio/simulator → studio-frontend.
 *
 * Plan gate: GET /api/crm/voice/status answers for every member; `enabled`
 * is false when the org owner's subscription lacks the add-on, and every
 * other /api/crm/voice/* route answers the standard 402 plan_required body
 * (with `addon: "call_assistant"`). The gate card below is the one prompt.
 *
 * Paused: the add-on is bought but the subscription needs a payment
 * (`paused: true`). The tabs stay readable, a banner says "Paused — update
 * your payment method" with a link to Billing, and edits answer 402
 * payment_required (owner, 2026-10-02: "As soon as they stop paying the agent
 * stops working").
 */
export const CALL_ASSISTANT_TABS = ["overview", "numbers", "studio", "simulator", "calls"] as const;
export type CallAssistantTab = (typeof CALL_ASSISTANT_TABS)[number];
const TAB_LABELS: Record<CallAssistantTab, string> = {
  overview: "Overview", numbers: "Numbers", studio: "Agent Studio", simulator: "Simulator", calls: "Calls",
};

export type VoiceStatus = {
  enabled: boolean;
  /** Bought but paused until a payment goes through. */
  paused?: boolean;
  pausedReason?: "payment_needed" | null;
  billingHref?: string;
  subscriptionStatus?: string | null;
  /** An automatic number release: "releasing" = a fixed card still keeps it; "released" = gone (or final). */
  numberRelease?: "releasing" | "released" | null;
  addon: { key: string; name: string; preview: boolean; availableOn: string[] };
  canManage?: boolean;
  /** The held tier (absent on an older server; null without one). */
  tier?: { key: string; addon: string; name: string } | null;
  tiers?: { key: string; addon: string; name: string; monthlyCents: number; annualCents: number; includedMinutes: number; includedNumbers: number; overageCentsPerMinute?: number; preview: boolean }[];
  plan: string | null;
  allowance: { numbers: number; minutes: number; overageCentsPerMinute?: number };
  pricing: { includedMinutes: number; overageCentsPerMinute: number; freeSpamCalls?: number };
  engine: { configured: boolean; reachable: boolean; models: boolean; checkedAt: string };
  numbers: unknown[];
  profile: { status: string; publishedVersion: number | null } | null;
  usage: {
    month: string; minutes: number; calls: number; overageMinutes: number;
    /** What the overage costs so far: each call's minutes at its own tier's rate. */
    overageCents?: number; overageCentsPerMinute?: number;
    spamCallsThisMonth?: number; freeSpamCalls?: number; freeSpamMinutes?: number; freeSpamCallsLimit?: number;
  } | null;
};

function tabFromSearch(): CallAssistantTab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return (CALL_ASSISTANT_TABS as readonly string[]).includes(t ?? "") ? (t as CallAssistantTab) : "overview";
}

/** The standard plan prompt for the add-on module: honest copy from the price book, one way to Billing. */
export function CallAssistantPlanRequired({ error, status }: { error?: unknown; status?: VoiceStatus | null }) {
  const body = planRequiredFrom(error);
  const addon = ADDONS.call_assistant;
  const plans = joinNames(addon.availableOn.map((k) => PLANS[k].name));
  const preview = status?.addon.preview ?? addon.preview === true;
  const message = body?.message || `${CALL_ASSISTANT_NAME} is an add-on for the ${plans} plans. Add it in Settings → Billing to use it.`;
  const tiers = callAssistantTiers();
  return (
    <Card role="region" aria-labelledby="call-assistant-gate" data-testid="plan-required-callAssistant">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 id="call-assistant-gate" className="text-xl font-semibold leading-none tracking-tight">{CALL_ASSISTANT_NAME}</h2>
          <Badge variant="secondary">Add-on</Badge>
          {preview && <Badge variant="outline" data-testid="badge-call-assistant-preview">Coming soon</Badge>}
        </div>
        <p className="text-sm" data-testid="text-plan-required-message">{message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Answers every call, 24/7, in a voice and name you choose, and says it is a virtual assistant when asked.</li>
          <li>Asks what the caller needs, the address, a name, a good email and the best time to call — then files the lead in your CRM.</li>
          <li>Texts or emails the right person for emergencies, existing customers and "I want a person".</li>
          <li>Screens out spam on every call forwarded to it, so you stop answering telemarketers and robocalls; a number caught twice as near-certain spam is blocked before it's answered.</li>
          <li>Every call logged with a summary, transcript and recording.</li>
        </ul>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm" data-testid="list-plan-required-tiers">
          {tiers.map((t) => (
            <li key={t.tier} className="rounded-md border p-2.5" data-testid={`text-plan-required-tier-${t.tier}`}>
              <span className="font-semibold">{t.name}</span> · {t.monthly}/mo
              <span className="block text-xs text-muted-foreground">{t.minutes} minutes / month · {t.numbersLabel} · {t.overageShort}/min over</span>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Solo launch price: <span className="font-semibold" data-testid="text-plan-required-intro">{callAssistantIntroShort()}</span>. {callAssistantSpamAllowanceLine()}. On the {plans} plans.
          {preview ? " Pricing is being finalized; it cannot be added yet." : ""}
        </p>
        {/* a disabled <a> still navigates: while the add-on is in preview there is no link at all */}
        {preview ? (
          <Button disabled data-testid="button-call-assistant-unavailable">Not available yet</Button>
        ) : (
          <Button asChild>
            <a href="/settings?tab=billing" data-testid="link-call-assistant-billing">Add it in Billing</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function CrmCallAssistantPage() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<CallAssistantTab>(tabFromSearch);
  const goToTab = (t: string) => {
    const next = (CALL_ASSISTANT_TABS as readonly string[]).includes(t) ? (t as CallAssistantTab) : "overview";
    setTab(next);
    navigate(`/call-assistant?tab=${next}`, { replace: true });
  };
  // Back/forward keeps the tab in step with the URL.
  useEffect(() => {
    const onPop = () => setTab(tabFromSearch());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const status = useQuery<VoiceStatus>({ queryKey: ["/api/crm/voice/status"] });
  const enabled = status.data?.enabled === true;
  const paused = !enabled && status.data?.paused === true;
  const canManage = me?.permissions?.manageSettings === true;

  return (
    <AppPage testId="page-call-assistant">
      <PageHeader
        title={<span data-testid="text-call-assistant-title">Call Assistant</span>}
        description="Your AI receptionist answers every call, files the lead and alerts the right person."
        meta={status.data?.profile?.status ? (
          <StatusPill tone={status.data.profile.status === "live" ? "success" : status.data.profile.status === "paused" ? "warning" : "neutral"} data-testid="badge-call-assistant-status">
            {status.data.profile.status}
          </StatusPill>
        ) : null}
      />

      {status.isError && planRequiredFrom(status.error) ? (
        <CallAssistantPlanRequired error={status.error} />
      ) : status.data && !enabled && !paused ? (
        <CallAssistantPlanRequired status={status.data} />
      ) : (
        <Tabs value={tab} onValueChange={goToTab} data-testid="tabs-call-assistant">
          {/* The Overview shows the banner itself; every other tab gets it above the tab strip. */}
          {paused && status.data && tab !== "overview" && <div className="mb-3"><CallAssistantPausedBanner status={status.data} /></div>}
          <AppTabsList>
            {CALL_ASSISTANT_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-lg px-3.5" data-testid={`tab-call-assistant-${t}`}>{TAB_LABELS[t]}</TabsTrigger>
            ))}
          </AppTabsList>
          <TabsContent value="overview"><OverviewPanel status={status.data ?? null} loading={status.isLoading} onPickResult={(p) => {
            // Open the Calls tab already filtered: the Calls panel reads ?outcome= / ?view= when it mounts.
            setTab("calls");
            navigate(p === "spam" ? "/call-assistant?tab=calls&view=spam" : `/call-assistant?tab=calls&outcome=${p}`, { replace: true });
          }} /></TabsContent>
          <TabsContent value="numbers"><NumbersPanel canManage={canManage} /></TabsContent>
          <TabsContent value="studio"><StudioPanel canManage={canManage} /></TabsContent>
          <TabsContent value="simulator"><SimulatorPanel /></TabsContent>
          <TabsContent value="calls"><CallsPanel canManage={canManage} /></TabsContent>
        </Tabs>
      )}
    </AppPage>
  );
}
