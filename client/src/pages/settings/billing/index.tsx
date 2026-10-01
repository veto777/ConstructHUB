/**
 * Billing panels (Ahrefs-style Billing → Subscriptions / Invoices / Payment
 * methods / Purchases). Each panel is a standalone component that reads its
 * own endpoint; `BillingPanel` composes them behind tabs and
 * `BillingSettingsPage` wraps that in a page for the /settings/billing route.
 * The settings shell can import any of them.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/hooks/use-url-param";
import { SubscriptionsPanel, type SubscriptionsPanelProps } from "./subscriptions-panel";
import { InvoicesPanel, type InvoicesPanelProps } from "./invoices-panel";
import { PaymentMethodsPanel, type PaymentMethodsPanelProps } from "./payment-methods-panel";
import { PurchasesPanel } from "./purchases-panel";

export { SubscriptionsPanel, InvoicesPanel, PaymentMethodsPanel, PurchasesPanel };
export type { SubscriptionsPanelProps, InvoicesPanelProps, PaymentMethodsPanelProps };
export * from "./types";
export { formatMoney, formatDate, formatDateTime, formatPeriod, formatCount } from "./format";

export type BillingTab = "subscriptions" | "invoices" | "payment-methods" | "purchases";
export const BILLING_TABS: readonly { id: BillingTab; label: string }[] = [
  { id: "subscriptions", label: "Subscriptions" },
  { id: "invoices", label: "Invoices" },
  { id: "payment-methods", label: "Payment methods" },
  { id: "purchases", label: "Purchases" },
];
const isBillingTab = (v: unknown): v is BillingTab => BILLING_TABS.some((t) => t.id === v);

export type BillingPanelProps = {
  /** Controlled tab; when omitted the open tab lives in ?billing= so a reload or shared link reopens it. */
  tab?: BillingTab;
  onTabChange?: (tab: BillingTab) => void;
  subscriptions?: SubscriptionsPanelProps;
  invoices?: InvoicesPanelProps;
  paymentMethods?: PaymentMethodsPanelProps;
};

export function BillingPanel({ tab, onTabChange, subscriptions, invoices, paymentMethods }: BillingPanelProps = {}) {
  const [param, setParam] = useUrlParam("billing");
  const active: BillingTab = tab ?? (isBillingTab(param) ? param : "subscriptions");
  const change = (next: string) => {
    if (!isBillingTab(next)) return;
    onTabChange?.(next);
    if (tab === undefined) setParam(next === "subscriptions" ? null : next);
  };
  return (
    <Tabs value={active} onValueChange={change} className="space-y-4" data-testid="tabs-billing">
      <TabsList className="h-auto w-full justify-start flex-wrap gap-1 bg-transparent p-0 border-b rounded-none">
        {BILLING_TABS.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 py-2"
            data-testid={`tab-billing-${t.id}`}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="subscriptions" className="mt-0"><SubscriptionsPanel {...subscriptions} /></TabsContent>
      <TabsContent value="invoices" className="mt-0"><InvoicesPanel {...invoices} /></TabsContent>
      <TabsContent value="payment-methods" className="mt-0"><PaymentMethodsPanel {...paymentMethods} /></TabsContent>
      <TabsContent value="purchases" className="mt-0"><PurchasesPanel /></TabsContent>
    </Tabs>
  );
}

/** The /settings/billing page: a heading and the tabbed panels. */
export default function BillingSettingsPage() {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-billing-title">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">Your subscription, invoices, payment methods and one-time purchases.</p>
        </div>
        <BillingPanel />
      </div>
    </div>
  );
}
