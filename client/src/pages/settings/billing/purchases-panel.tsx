import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/queryClient";
import { Receipt } from "lucide-react";
import { formatDate, formatMoney } from "./format";
import { PURCHASE_KIND_LABELS, type Purchase, type PurchasesResponse } from "./types";

/**
 * Billing → Purchases: one-time payments outside the subscription (courses,
 * done-for-you services, reinstatement) with Stripe's receipt for each.
 */
export function PurchasesPanel() {
  const { data, isLoading, error } = useQuery<PurchasesResponse>({ queryKey: ["/api/billing/purchases"] });
  const purchases = data?.purchases ?? [];

  return (
    <Card data-testid="card-purchases">
      <CardHeader>
        <CardTitle className="text-lg">Purchases</CardTitle>
        <CardDescription>One-time payments: courses, services and reinstatement. A receipt is emailed for each one.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="text-purchases-error">Couldn't load purchases. {apiErrorMessage(error)}</p>
        ) : purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-4" data-testid="text-purchases-empty">No one-time purchases on this account.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table data-testid="table-purchases">
                <TableHeader>
                  <TableRow>
                    <TableHead>Purchase</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => (
                    <TableRow key={p.id} data-testid={`row-purchase-${p.id}`}>
                      <TableCell className="font-medium max-w-sm" data-testid={`text-purchase-description-${p.id}`}>{p.description || "Purchase"}</TableCell>
                      <TableCell><Badge variant="outline" data-testid={`badge-purchase-kind-${p.id}`}>{PURCHASE_KIND_LABELS[p.kind] || p.kind}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap" data-testid={`text-purchase-date-${p.id}`}>{formatDate(p.created)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap" data-testid={`text-purchase-amount-${p.id}`}>{formatMoney(p.amount, p.currency)}</TableCell>
                      <TableCell className="text-right"><ReceiptLink p={p} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="md:hidden space-y-3" data-testid="list-purchases">
              {purchases.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 space-y-2" data-testid={`card-purchase-${p.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{p.description || "Purchase"}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.created)}</p>
                    </div>
                    <Badge variant="outline">{PURCHASE_KIND_LABELS[p.kind] || p.kind}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                    <ReceiptLink p={p} idSuffix="-m" />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** `idSuffix` keeps the phone card's test id distinct from the table row's. */
function ReceiptLink({ p, idSuffix = "" }: { p: Purchase; idSuffix?: string }) {
  if (!p.receiptUrl) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Button asChild variant="ghost" size="sm" className="h-8 px-2">
      <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-purchase-receipt${idSuffix}-${p.id}`}>
        <Receipt className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Receipt
      </a>
    </Button>
  );
}

export default PurchasesPanel;
