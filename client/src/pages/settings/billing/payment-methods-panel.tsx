import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { CreditCard } from "lucide-react";
import { cardBrandLabel, type PaymentMethodsResponse } from "./types";
import { useBillingPortal } from "./use-billing-portal";

export type PaymentMethodsPanelProps = {
  /** "Manage" (default: Stripe's billing portal, where cards are added, replaced and removed). */
  onManage?: () => void;
};

/** A card past its expiry month can't be charged; say so before Stripe does. */
function isExpired(expMonth: number, expYear: number, now = new Date()): boolean {
  if (!expMonth || !expYear) return false;
  return expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1);
}

/**
 * Billing → Payment methods: the cards Stripe holds for this account. Card
 * details never pass through ConstructHUB — adding or replacing one happens in
 * Stripe's portal, which is what "Manage" opens.
 */
export function PaymentMethodsPanel({ onManage }: PaymentMethodsPanelProps = {}) {
  const [, navigate] = useLocation();
  const portal = useBillingPortal();
  const manage = onManage ?? portal.open;
  const { data, isLoading, error } = useQuery<PaymentMethodsResponse>({ queryKey: ["/api/billing/payment-methods"] });
  const methods = data?.methods ?? [];

  return (
    <Card data-testid="card-payment-methods">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg">Payment methods</CardTitle>
          <CardDescription>Cards on file with Stripe. Card numbers never touch ConstructHUB.</CardDescription>
        </div>
        {methods.length > 0 && (
          <Button size="sm" variant="outline" onClick={manage} disabled={portal.isPending} data-testid="button-payment-methods-manage">
            {portal.isPending ? "Opening…" : "Manage"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true"><Skeleton className="h-14 w-full" /></div>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="text-payment-methods-error">Couldn't load payment methods. {apiErrorMessage(error)}</p>
        ) : methods.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-4" data-testid="text-payment-methods-empty">
            <p className="text-sm text-muted-foreground">No card on file. You enter one at checkout when you choose a plan.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/pricing")} data-testid="button-payment-methods-plans">See plans</Button>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="list-payment-methods">
            {methods.map((m) => {
              const expired = isExpired(m.expMonth, m.expYear);
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" data-testid={`row-payment-method-${m.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span data-testid={`text-payment-method-brand-${m.id}`}>{cardBrandLabel(m.brand)}</span>
                        {" "}<span className="tabular-nums" data-testid={`text-payment-method-last4-${m.id}`}>•••• {m.last4}</span>
                      </p>
                      <p className={`text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`} data-testid={`text-payment-method-exp-${m.id}`}>
                        {expired ? "Expired" : "Expires"} {String(m.expMonth).padStart(2, "0")}/{String(m.expYear).slice(-2)}
                      </p>
                    </div>
                  </div>
                  {m.isDefault && <Badge variant="outline" data-testid={`badge-payment-method-default-${m.id}`}>Default</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default PaymentMethodsPanel;
