/** Isolated browser fixture for the actual components, used when the lane DB is unavailable. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultVoiceProfile } from "../shared/voice-profile";
import { VOICE_PERSONA_LIST } from "../shared/voice-personas";
import { CALL_ASSISTANT_TIERS } from "../shared/plans";
import { StudioEditor } from "../client/src/pages/crm-call-assistant/studio/editor";
import { CallDetailSheet } from "../client/src/pages/crm-call-assistant/calls-detail";
import { OverviewPanel } from "../client/src/pages/crm-call-assistant/overview";
import { TooltipProvider } from "../client/src/components/ui/tooltip";
import "../client/src/index.css";

const profile = defaultVoiceProfile({ name: "Summit Roofing Co.", state: "FL" });
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
client.setQueryData(["/api/crm/voice/personas"], { personas: VOICE_PERSONA_LIST });
client.setQueryData(["/api/crm/voice/calls", "layout-call"], {
  id: "layout-call", callNo: 10, callerName: "Sample caller", fromNumber: "+19415550160", startedAt: "2026-10-11T10:00:00Z",
  endedAt: "2026-10-11T10:02:30Z", durationSeconds: 150, outcome: "alerted", persona: "janice", recordingState: "none",
  summary: "The caller requested a callback about an urgent site issue. Verify the text with the carrier before sending again.",
  delivery: { state: "failed", worker: { running: true }, tasks: [{ id: 1, key: "escalation:urgent", kind: "escalation", label: "Escalation — Emergency", state: "failed", uncertain: true, attempts: 1, lastError: "Delivery uncertain; verify with the carrier before resending.", giveUpAt: "2026-10-14T10:00:00Z" }] },
  escalations: [{ id: 1, kindLabel: "Emergency", kind: "urgent", channel: "sms", recipientName: "Office", recipient: "+19415550161", sentCount: 1, lastSentAt: null, state: "waiting", lastError: "Delivery uncertain; verify with the carrier before resending." }],
  transcript: Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? "caller" : "assistant", text: i % 2 ? "Please ask the office to call me back about the work at the property." : "I've taken your message and callback details for the office." })),
});
client.setQueryData(["/api/crm/voice/calls?limit=5&spam=all"], { calls: [{ id: "layout-call", fromNumber: "+19415550160", outcome: "alerted", summary: "Callback requested" }] });
client.setQueryData(["/api/crm/voice/calls/summary?range=30d"], { total: 4, outcomes: { alerted: 1, voicemail: 2, hangup: 1 }, sentToPerson: 2, recordings: 0, minutes: 5, lines: [] });
const view = new URLSearchParams(location.search).get("view");
document.documentElement.classList.add("app-theme");
const tier = CALL_ASSISTANT_TIERS[0];
const status = { enabled: true, numbers: [{ status: "active", phoneNumber: "+19415550142" }], engine: { configured: false, reachable: false, models: false, checkedAt: "" },
  allowance: { minutes: tier.includedMinutes, numbers: tier.includedNumbers }, pricing: { includedMinutes: tier.includedMinutes, overageCentsPerMinute: tier.overageCentsPerMinute }, profile: { status: "live", publishedVersion: 1 },
  addon: { key: "call_assistant", name: "Call Assistant", preview: false }, plan: null, usage: { month: "2026-10", calls: 4, minutes: 5, overageMinutes: 0 } };
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}><TooltipProvider>
    <main className="g-surface" style={{ marginLeft: innerWidth >= 768 ? 224 : 0, padding: 16 }}>
      <h1 className="text-xl font-semibold">Call Assistant — layout test fixture</h1>
      {view === "overview" ? <OverviewPanel status={status} loading={false} /> : <StudioEditor data={{ profile, status: "live", publishedVersion: 1 } as any} canManage onRunWizard={() => {}} />}
    </main>
    {view === "call" && <CallDetailSheet callId="layout-call" onClose={() => {}} />}
  </TooltipProvider></QueryClientProvider>,
);
