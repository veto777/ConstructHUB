import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { CallLog, EscalationsView } from "../../client/src/pages/crm-call-assistant/calls";
import { CallDetailSheet, DeliverySection } from "../../client/src/pages/crm-call-assistant/calls-detail";
vi.mock("../../client/src/components/ui/sheet", () => {
  const part = ({ children }: any) => createElement("div", {}, children);
  return { Sheet: part, SheetContent: part, SheetHeader: part, SheetTitle: part, SheetDescription: part, SheetTrigger: part, SheetFooter: part, SheetClose: part };
});

function render(component: any, props: any, key: string, data?: any) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (data) client.setQueryData([key], data);
  const query = client.getQueryCache().build(client, { queryKey: [key] });
  query.setState({ status: "error", error: new Error("Poll failed"), fetchStatus: "idle" });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(TooltipProvider, {}, createElement(component, props))));
}
it("keeps saved call rows, timestamp and touch-visible recording reason after a poll error", () => {
  const html = render(CallLog, { onOpen: vi.fn(), outcome: "all", setOutcome: vi.fn() }, "/api/crm/voice/calls?page=1&limit=25", {
    calls: [{ id: "saved-call", callerName: "Saved caller", startedAt: new Date().toISOString(), recordingState: "failed", recordingReason: "Upload retries expired" }], page: 1, limit: 25, total: 1,
  });
  expect(html).toContain("Saved caller");
  expect(html).toContain("Showing saved data");
  expect(html).toContain("Retry");
  expect(html).toMatch(/<p[^>]*>Upload retries expired<\/p>/);
  expect(html).not.toContain("No calls yet");
});
it("keeps saved escalations under the refresh warning", () => {
  const html = render(EscalationsView, { onOpen: vi.fn() }, "/api/crm/voice/escalations?open=1", {
    escalations: [{ id: 1, kindLabel: "Emergency", recipientName: "Saved recipient", channel: "sms", sentCount: 1, body: "Saved hand-off", createdAt: new Date().toISOString() }],
  });
  expect(html).toContain("Saved recipient");
  expect(html).toContain("Showing saved data");
  expect(html).toContain("Retry");
  expect(html).not.toContain("Nothing waiting");
});
it("initial errors never render the empty-call state", () => {
  const html = render(CallLog, { onOpen: vi.fn(), outcome: "all", setOutcome: vi.fn() }, "/api/crm/voice/calls?page=1&limit=25");
  expect(html).toContain("Poll failed");
  expect(html).not.toContain("No calls yet");
});

it("renders the drawer skeleton while its first request is pending", () => {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => new Promise(() => {}), retry: false, retryOnMount: false } } });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CallDetailSheet, { callId: "loading-call", onClose: vi.fn() })));
  expect(html).toContain('data-testid="skeleton-call-detail"');
  expect(html).toContain('aria-label="Loading call details"');
});
it("renders separate channel outcomes and explains that a disabled worker holds queued retries", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(DeliverySection, { callId: "call", delivery: {
    state: "pending", worker: { running: false, intervalSeconds: 60, lastRunAt: null, lastOk: null },
    tasks: [
      { id: 1, key: "notification:email:one", kind: "notification", label: "EMAIL — one@example.invalid", state: "done", attempts: 1, lastError: null, nextAttemptAt: null, giveUpAt: null, doneAt: null },
      { id: 2, key: "notification:sms:two", kind: "notification", label: "SMS — recipient two", state: "retrying", attempts: 1, lastError: "Carrier refused", nextAttemptAt: null, giveUpAt: null, doneAt: null },
    ],
  } })));
  expect(html).toContain("EMAIL — one@example.invalid");
  expect(html).toContain("SMS — recipient two");
  expect(html).toContain("Carrier refused");
  expect(html).toContain("Queued retries will run when it is enabled");
});

it("keeps CRM success distinct from unknown notifications and excludes unknown-only retry", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(DeliverySection, { callId: "call", delivery: {
    state: "failed", worker: { running: true, intervalSeconds: 60, lastRunAt: null, lastOk: null },
    tasks: [
      { id: 1, key: "lead", kind: "lead", label: "Client and project in your CRM", state: "done", attempts: 1, lastError: null, nextAttemptAt: null, giveUpAt: null, doneAt: null },
      { id: 2, key: "notification:sms:two", kind: "notification", label: "SMS — recipient two", state: "failed", attempts: 1, lastError: "Delivery outcome unknown: response lost", nextAttemptAt: null, giveUpAt: null, doneAt: null },
    ],
  } })));
  expect(html).toContain("CRM saved");
  expect(html).toContain("Notifications need attention");
  expect(html).toContain("Delivery uncertain");
  expect(html).toContain("Check with the recipient");
  expect(html).not.toContain('data-testid="button-call-delivery-retry"');
  expect(html).not.toContain("Fix the cause, then Retry now");
});
