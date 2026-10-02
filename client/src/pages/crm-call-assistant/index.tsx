import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Phone, Lock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrmPage, CrmPageHeader } from "@/components/crm-ui";
import { planRequiredFrom } from "@/components/plan-required";
import { ADDONS, PLANS, CALL_ASSISTANT_INCLUDED_MINUTES } from "@shared/plans";
import { callAssistantIntroShort, joinNames } from "@shared/plan-copy";
import { OverviewPanel } from "./overview";
import { NumbersPanel } from "./numbers";
import { StudioPanel } from "./studio";
import { SimulatorPanel } from "./simulator";
import { CallsPanel } from "./calls";

/**
 * /crm/call-assistant — the AI Call Assistant's home in the CRM
 * (docs/call-assistant/SPEC.md § Side ribbon). ARCHITECT-OWNED shell: the
 * tab strip, the plan gate and the deep link (?tab=). Each panel file is a
 * lane's (LANES.md): numbers.tsx and calls.tsx → their server lanes,
 * overview/studio/simulator → studio-frontend.
 *
 * Plan gate: GET /api/crm/voice/status answers for every member; `enabled`
 * is false when the org owner's subscription lacks the add-on, and every
 * other /api/crm/voice/* route answers the standard 402 plan_required body
 * (with `addon: "call_assistant"`). The gate card below is the one prompt.
 */
export const CALL_ASSISTANT_TABS = ["overview", "numbers", "studio", "simulator", "calls"] as const;
export type CallAssistantTab = (typeof CALL_ASSISTANT_TABS)[number];
const TAB_LABELS: Record<CallAssistantTab, string> = {
  overview: "Overview", numbers: "Numbers", studio: "Agent Studio", simulator: "Simulator", calls: "Calls",
};

export type VoiceStatus = {
  enabled: boolean;
  addon: { key: string; name: string; preview: boolean; availableOn: string[] };
  plan: string | null;
  allowance: { numbers: number; minutes: number };
  pricing: { includedMinutes: number; overageCentsPerMinute: number };
  engine: { configured: boolean; reachable: boolean; models: boolean; checkedAt: string };
  numbers: unknown[];
  profile: { status: string; publishedVersion: number | null } | null;
  usage: { month: string; minutes: number; calls: number; overageMinutes: number } | null;
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
  const message = body?.message || `${addon.name} is an add-on for the ${plans} plans. Add it in Settings → Billing to use it.`;
  return (
    <Card role="region" aria-labelledby="call-assistant-gate" data-testid="plan-required-callAssistant">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 id="call-assistant-gate" className="text-xl font-semibold leading-none tracking-tight">{addon.name}</h2>
          <Badge variant="secondary">Add-on</Badge>
          {preview && <Badge variant="outline" data-testid="badge-call-assistant-preview">Coming soon</Badge>}
        </div>
        <p className="text-sm" data-testid="text-plan-required-message">{message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Answers every call, 24/7, in a voice and name you choose, and says it is a virtual assistant when asked.</li>
          <li>Asks what the caller needs, the address, a name, a good email and the best time to call — then files the lead in your CRM.</li>
          <li>Texts or emails the right person for emergencies, existing customers and "I want a person"; screens telemarketers.</li>
          <li>Every call logged with a summary, transcript and recording.</li>
        </ul>
        <p className="text-sm">
          <span className="font-semibold" data-testid="text-plan-required-intro">{callAssistantIntroShort()}</span>, with 1 local number and {CALL_ASSISTANT_INCLUDED_MINUTES.toLocaleString("en-US")} minutes included, on the {plans} plans.
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
    navigate(`/crm/call-assistant?tab=${next}`, { replace: true });
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
  const canManage = me?.permissions?.manageSettings === true;

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Phone}
        title={<span data-testid="text-call-assistant-title">Call Assistant</span>}
        subtitle="An AI receptionist on your own local number: answers, qualifies, files the lead, pages the right person."
        actions={status.data?.profile?.status ? (
          <Badge variant={status.data.profile.status === "live" ? "default" : "secondary"} data-testid="badge-call-assistant-status">
            {status.data.profile.status}
          </Badge>
        ) : null}
      />

      {status.isError && planRequiredFrom(status.error) ? (
        <CallAssistantPlanRequired error={status.error} />
      ) : status.data && !enabled ? (
        <CallAssistantPlanRequired status={status.data} />
      ) : (
        <Tabs value={tab} onValueChange={goToTab} data-testid="tabs-call-assistant">
          <TabsList className="flex flex-wrap h-auto">
            {CALL_ASSISTANT_TABS.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`tab-call-assistant-${t}`}>{TAB_LABELS[t]}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview"><OverviewPanel status={status.data ?? null} loading={status.isLoading} /></TabsContent>
          <TabsContent value="numbers"><NumbersPanel canManage={canManage} /></TabsContent>
          <TabsContent value="studio"><StudioPanel canManage={canManage} /></TabsContent>
          <TabsContent value="simulator"><SimulatorPanel /></TabsContent>
          <TabsContent value="calls"><CallsPanel canManage={canManage} /></TabsContent>
        </Tabs>
      )}
    </CrmPage>
  );
}
