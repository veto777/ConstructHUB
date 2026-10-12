import { expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deliveryLabelOf, presentCallTask, withEscalationEvidence, type CallTask } from "./call-tasks";
import { sentToPersonCondition } from "./calls";
import { CallDetailSheet, DeliverySection, EscalationRow, automaticRetriesText } from "../../client/src/pages/crm-call-assistant/calls-detail";
import { CallLog } from "../../client/src/pages/crm-call-assistant/calls";
import { CallResults } from "../../client/src/pages/crm-call-assistant/results";
import { OverviewPanel } from "../../client/src/pages/crm-call-assistant/overview";
import { PersonaSection } from "../../client/src/pages/crm-call-assistant/studio/section-persona";
import { EscalationsSection } from "../../client/src/pages/crm-call-assistant/studio/section-rest";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { callAssistantProfile } from "../../scripts/tutorials/seed-call-assistant";

vi.mock("../../client/src/components/ui/sheet", () => {
  const part = ({ children, className, ...props }: any) => createElement("div", { className, "data-testid": props["data-testid"] }, children);
  return { Sheet: part, SheetContent: part, SheetHeader: part, SheetTitle: part, SheetDescription: part, SheetTrigger: part, SheetFooter: part, SheetClose: part };
});

function render(component: ComponentType<any>, props: any, entries: [unknown[], any][] = [], errorKey?: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  for (const [key, value] of entries) client.setQueryData(key, value);
  if (errorKey) client.getQueryCache().build(client, { queryKey: errorKey }).setState({ status: "error", error: new Error("offline"), fetchStatus: "idle" });
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/call-assistant" }, createElement(QueryClientProvider, { client }, createElement(TooltipProvider, {}, createElement(component, props)))));
}
const task = (over: Partial<CallTask> = {}): CallTask => ({
  id: 1, callId: "c", orgId: "o", kind: "lead", key: "lead", payload: {}, state: "done", attempts: 1,
  lastError: null, result: null, nextAttemptAt: new Date(), giveUpAt: new Date(), leasedUntil: null, createdAt: new Date(), doneAt: null, ...over,
});
const worker = { running: true, intervalSeconds: 60, lastRunAt: null, lastOk: true };
const summary = { total: 4, outcomes: { alerted: 1, voicemail: 2, hangup: 1 }, sentToPerson: 2, recordings: 0, minutes: 5, lines: [] };

it("names only a failed CRM step as CRM delivery failed, including mixed tasks and non-lead calls", () => {
  const sms = task({ kind: "notification", key: "notification:sms:one", payload: { channel: "sms" }, state: "failed" });
  expect(deliveryLabelOf([task(), sms])).toBe("Text not sent");
  expect(deliveryLabelOf([sms])).toBe("Text not sent");
  expect(deliveryLabelOf([task({ state: "failed" }), sms])).toBe("CRM delivery failed");
  expect(deliveryLabelOf([task(), { ...sms, result: { uncertain: true } }])).toBe("Delivery uncertain");
  expect(deliveryLabelOf([task({ kind: "escalation", state: "failed" })])).toBe("Notification not sent");
  const html = render(CallLog, { onOpen: vi.fn(), outcome: "all", setOutcome: vi.fn() }, [[
    ["/api/crm/voice/calls?page=1&limit=25"], { calls: [{ id: "c", callerName: "Caller", deliveryState: "failed", deliveryLabel: deliveryLabelOf([task(), sms]) }], total: 1 },
  ]]);
  expect(html).toContain("Text not sent");
  expect(html).not.toContain("CRM delivery failed");
});

it.each(["Delivery uncertain; verify with the carrier before resending.", "Delivery outcome unknown: response lost", "confirmation could not be saved"])("does not offer retry for %s", lastError => {
  const t = presentCallTask(task({ kind: "escalation", state: "failed", lastError }));
  expect(t.uncertain).toBe(true);
  const html = render(DeliverySection, { callId: "c", delivery: { state: "failed", tasks: [t], worker } });
  expect(html).toContain("Delivery uncertain");
  expect(html).toContain("Verify with the carrier");
  expect(html).not.toContain("Retry now");
  expect(html).not.toContain(">Failed<");
});

it("uses escalation receipts when the task error is generic, and agrees with the escalation row", () => {
  const e = { id: 1, kind: "urgent", kindLabel: "Emergency", sentCount: 1, lastSentAt: null, lastError: null, state: "waiting", recipient: "Office", channel: "sms" };
  const t = withEscalationEvidence(task({ kind: "escalation", payload: { kind: "urgent" }, state: "failed", lastError: "Owner alert failed" }), [e]);
  expect(deliveryLabelOf([t])).toBe("Delivery uncertain");
  expect(presentCallTask(t).uncertain).toBe(true);
  expect(render(EscalationRow, { e })).toContain("Delivery uncertain");
  const html = render(DeliverySection, { callId: "c", delivery: { state: "failed", worker,
    tasks: [presentCallTask(t), presentCallTask(task({ kind: "notification", state: "failed", lastError: "Carrier rejected" }))],
  } });
  expect(html).not.toContain('data-testid="button-call-delivery-retry"');
});

it("uses future tense before the retry deadline and past tense at/after it", () => {
  const at = "2026-10-12T12:00:00Z";
  expect(automaticRetriesText(at, Date.parse(at) - 1)).toMatch(/^Automatic retries stop /);
  expect(automaticRetriesText(at, Date.parse(at))).toMatch(/^Automatic retries stopped /);
  expect(automaticRetriesText("2026-10-12 12:00:00", Date.parse(at) + 1)).toMatch(/^Automatic retries stopped /);
});

it("separates messages from hangups and includes office alerts in the person tile", () => {
  const html = render(CallResults, { onPick: vi.fn() }, [[["/api/crm/voice/calls/summary?range=30d"], summary]]);
  expect(html).toMatch(/data-testid="text-results-hangup">1</);
  expect(html).toMatch(/data-testid="text-results-voicemail">2</);
  expect(html).toMatch(/data-testid="text-results-alerted">2</);
  const query = new PgDialect().sqlToQuery(sentToPersonCondition(sql`c.id`, sql`c.outcome`)).sql;
  expect(query).toContain("e.call_id = c.id");
  expect(query).toContain("e.sent_count > 0 AND e.last_sent_at IS NOT NULL");
});

it("never replaces failed results queries with zero tiles", () => {
  const key = ["/api/crm/voice/calls/summary?range=30d"];
  for (const entries of [[], [[key, summary]]] as [unknown[], any][][]) {
    const html = render(CallResults, { onPick: vi.fn() }, entries, key);
    expect(html).toContain("Couldn&#x27;t load the results");
    expect(html).not.toContain('data-testid="text-results-hangup"');
  }
});

it("lets Persona cards fill their container, keeps names whole, and exposes keyboard focus", () => {
  const html = render(PersonaSection, { value: callAssistantProfile().persona, onChange: vi.fn() });
  expect(html).toContain("repeat(auto-fill,minmax(min(100%,16rem),1fr))");
  expect(html).toMatch(/whitespace-nowrap font-medium">Janice</);
  expect(html).toContain("focus-visible:ring-2");
});

it("keeps the detail header outside its scrolling body and removes the internal call reference", () => {
  const html = render(CallDetailSheet, { callId: "c", onClose: vi.fn() }, [[["/api/crm/voice/calls", "c"], {
    id: "c", callerName: "Caller", callSid: "INTERNAL_REFERENCE", transcript: [], escalations: [], endedAt: "2026-10-01T00:00:00Z", outcome: "info",
  }]]);
  expect(html).toContain("flex flex-col w-full sm:max-w-2xl overflow-hidden");
  expect(html).toContain('class="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="scroll-call-detail"');
  expect(html).not.toContain("INTERNAL_REFERENCE");
});

const status = { enabled: true, numbers: [{ status: "active", phoneNumber: "+19415550100" }], engine: { configured: false },
  allowance: { minutes: 100, numbers: 1 }, pricing: {}, profile: { status: "live", publishedVersion: 1 },
  addon: { name: "Call Assistant" }, usage: { calls: 10, minutes: 5 } };
it("offers live accounts real follow-up and plain support guidance", () => {
  const html = render(OverviewPanel, { status, loading: false });
  expect(html).toContain("Review your latest calls and follow up");
  expect(html).not.toContain("Try a test conversation");
  expect(html).toContain("Contact support to connect your assistant");
  expect(html).not.toContain("Engine not configured");
});
it("hides the engine badge for an outside receptionist", () => {
  const html = render(OverviewPanel, { status: { ...status, profile: null, external: { name: "Janice", callsLast30Days: 10, lastCallAt: "2026-10-10", lines: [] } }, loading: false });
  expect(html).not.toContain('data-testid="pill-overview-engine"');
});
it("labels escalation rules by their situation instead of their internal key", () => {
  const html = render(EscalationsSection, { value: callAssistantProfile().escalations, onChange: vi.fn() });
  expect(html).toContain("Urgent site issue");
  expect(html).not.toContain("site-urgent");
});
