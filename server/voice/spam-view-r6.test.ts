import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";

function render(component: any, props: any, key: string, data?: any) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (data) client.setQueryData([key], data);
  const query = client.getQueryCache().build(client, { queryKey: [key] });
  query.setState({ status: "error", error: new Error("Poll failed"), fetchStatus: "idle" });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(TooltipProvider, {}, createElement(component, props))));
}

it("keeps the saved spam ledger on failed polls and offers Retry", async () => {
  const { SpamView } = await import("../../client/src/pages/crm-call-assistant/calls");
  const html = render(SpamView, { onOpen: vi.fn(), canManage: false }, "/api/crm/voice/spam", {
    entries: [{ id: 1, phoneNumber: "+18135550100", strikes: 2, calls: 3, lastReason: "Saved spam reason", lastCallAt: "2026-10-01T12:00:00Z" }], blocked: 1,
  });
  expect(html).toContain("table-spam-ledger");
  expect(html).toContain("Saved spam reason");
  expect(html).toContain("Showing saved data — refresh failed");
  expect(html).toContain("Retry");
  expect(html).not.toContain("No spam yet");
  const empty = render(SpamView, { onOpen: vi.fn(), canManage: false }, "/api/crm/voice/spam");
  expect(empty).toContain("Unavailable");
  expect(empty).not.toContain("No spam yet");
});
