import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EscalationRow } from "../../client/src/pages/crm-call-assistant/calls-detail";

function render(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(EscalationRow, { e: {
      id: 7, state: "waiting", kindLabel: "Emergency", recipient: "+15555550123", channel: "sms",
      sentCount: 0, lastSentAt: null, lastError: null, ...overrides,
    } as any })));
}
it("shows the setup failure instead of a sent count or waiting-on-recipient claim", () => {
  const html = render({ lastError: "Not sent: texting isn't set up." });
  expect(html).toContain("Not sent: texting isn&#x27;t set up.");
  expect(html).toContain("Needs attention");
  expect(html).not.toContain("sent 1×");
  expect(html).not.toContain("waiting on");
});
it("shows uncertainty and paused automatic sends, including a legacy crash claim", () => {
  for (const row of [{ lastError: "Delivery uncertain; verify with the carrier before resending." }, { sentCount: 1 }]) {
    const html = render(row);
    expect(html).toContain("Delivery uncertain");
    expect(html).toContain("Automatic sends are paused");
    expect(html).not.toContain("sent 1×");
    expect(html).not.toContain("Last send failed");
  }
});
it("shows real sends, but prioritizes reminder and owner failures over past successes", () => {
  expect(render({ sentCount: 2, lastSentAt: "2026-10-11T09:00:00Z" })).toContain("sent 2×");
  const html = render({ sentCount: 2, lastSentAt: "2026-10-11T09:00:00Z", lastError: "Owner alert: Recipient opted out" });
  expect(html).toContain("Owner alert: Recipient opted out");
  expect(html).not.toContain("sent 2×");
});
it("identifies a pending details update despite an earlier successful first send", () => {
  for (const reason of ["Not sent: texting isn't set up.", "Delivery uncertain; verify with the carrier before resending."]) {
    const html = render({ sentCount: 1, lastSentAt: "2026-10-11T09:00:00Z", lastError: `Details update not sent: ${reason}` });
    expect(html).toContain("Details update not sent:");
    expect(html).not.toContain("sent 1×");
    expect(html).not.toContain("waiting on");
    if (reason.startsWith("Delivery uncertain")) expect(html).toContain("Automatic sends are paused");
  }
});
