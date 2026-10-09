import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeSubscription, type SubscriptionInfo } from "@/lib/pricing-display";

const mocks = vi.hoisted(() => ({ subscription: {} as SubscriptionInfo, mutation: null as any, request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: any) => { mocks.mutation = options; return { isPending: false }; },
  useQuery: () => ({ data: undefined }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/settings", vi.fn()] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request, apiErrorMessage: String }));
vi.mock("@/components/call-assistant-billing-card", () => ({ CallAssistantBillingCard: () => null }));
vi.mock("@/components/talk-to-sales", () => ({ TalkToSalesButton: () => null, TalkToSalesDialog: () => null }));
vi.mock("./use-billing", () => ({
  useSubscription: () => ({ data: mocks.subscription, view: describeSubscription(mocks.subscription) }),
  useEntitlements: () => ({ data: undefined }),
  useBillingActions: () => ({ portal: {}, addon: {}, showError: vi.fn(), refreshBilling: vi.fn() }),
  useAddonChange: () => ({ checking: false }),
}));
import { PlanBillingSection } from "./plan-billing";
const render = () => renderToStaticMarkup(createElement(PlanBillingSection, {} as any));
beforeEach(() => {
  mocks.subscription = { plan: "agency", status: "active", stripeSubscriptionId: "sub_legacy", billingInterval: "month", agencyLocations: 30 };
  mocks.request.mockReset().mockResolvedValue({ json: async () => ({}) });
});

it("shows the editor for banded Agency and sends only the requested location count", async () => {
  expect(render()).toContain('data-testid="row-billing-locations"');
  await mocks.mutation.mutationFn(31);
  expect(mocks.request).toHaveBeenCalledWith("POST", "/api/stripe/change-plan", { locations: 31 });
});

it("shows Unlimited's fixed price with no legacy location editor", () => {
  mocks.subscription.agencyLocations = null;
  const markup = render();
  expect(markup).not.toContain('data-testid="row-billing-locations"');
  expect(markup).toContain("$449/mo");
});

it("does not let an inactive banded subscription edit locations", () => {
  mocks.subscription.status = "canceled";
  expect(render()).not.toContain('data-testid="row-billing-locations"');
});
