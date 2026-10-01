import { useInfiniteQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/queryClient";
import { ExternalLink, FileDown, Loader2 } from "lucide-react";
import { formatDate, formatMoney, formatPeriod, getJson } from "./format";
import { INVOICE_STATUS_LABELS, type BillingInvoice, type InvoicesResponse } from "./types";

export type InvoicesPanelProps = {
  /** Invoices per page (default 20). */
  pageSize?: number;
};

const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" =>
  status === "paid" ? "default" : status === "open" ? "secondary" : status === "uncollectible" ? "destructive" : "outline";

/** The amount an invoice stands for: what was paid, or what is still due. */
const invoiceAmount = (inv: BillingInvoice) => (inv.status === "paid" ? inv.amountPaid : inv.amountDue || inv.amountPaid);

/**
 * Billing → Invoices: every Stripe invoice on the account, newest first, with
 * Stripe's hosted page ("View") and PDF. Pages by cursor
 * (?starting_after=<last id>) exactly as the endpoint does.
 */
export function InvoicesPanel({ pageSize = 20 }: InvoicesPanelProps = {}) {
  const query = useInfiniteQuery<InvoicesResponse, Error, { pages: InvoicesResponse[] }, readonly unknown[], string | null>({
    queryKey: ["/api/billing/invoices", { limit: pageSize }],
    queryFn: ({ pageParam }) => getJson<InvoicesResponse>(
      `/api/billing/invoices?limit=${pageSize}${pageParam ? `&starting_after=${encodeURIComponent(pageParam)}` : ""}`,
    ),
    initialPageParam: null,
    getNextPageParam: (last) => (last.hasMore && last.invoices.length ? last.invoices[last.invoices.length - 1].id : undefined),
  });
  const invoices = query.data?.pages.flatMap((p) => p.invoices) ?? [];

  return (
    <Card data-testid="card-invoices">
      <CardHeader>
        <CardTitle className="text-lg">Invoices</CardTitle>
        <CardDescription>Every invoice for your subscription and add-ons. Each one is also emailed to you when it's paid.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="space-y-2" aria-busy="true"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : query.error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="text-invoices-error">Couldn't load invoices. {apiErrorMessage(query.error)}</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-4" data-testid="text-invoices-empty">
            No invoices yet. Your first one is created when a plan starts billing.
          </p>
        ) : (
          <>
            {/* Wide screens: a table. */}
            <div className="hidden md:block">
              <Table data-testid="table-invoices">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Documents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-medium">
                        <span data-testid={`text-invoice-number-${inv.id}`}>{inv.number || inv.id}</span>
                        {inv.description && <p className="text-xs text-muted-foreground font-normal max-w-xs truncate">{inv.description}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" data-testid={`text-invoice-date-${inv.id}`}>{formatDate(inv.created)}</TableCell>
                      <TableCell className="whitespace-nowrap" data-testid={`text-invoice-period-${inv.id}`}>{formatPeriod(inv.periodStart, inv.periodEnd)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap" data-testid={`text-invoice-amount-${inv.id}`}>{formatMoney(invoiceAmount(inv), inv.currency)}</TableCell>
                      <TableCell><Badge variant={statusVariant(inv.status)} data-testid={`badge-invoice-status-${inv.id}`}>{INVOICE_STATUS_LABELS[inv.status] || inv.status}</Badge></TableCell>
                      <TableCell className="text-right"><InvoiceLinks inv={inv} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Phones: one card per invoice, nothing to scroll sideways. */}
            <ul className="md:hidden space-y-3" data-testid="list-invoices">
              {invoices.map((inv) => (
                <li key={inv.id} className="rounded-lg border p-3 space-y-2" data-testid={`card-invoice-${inv.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{inv.number || inv.id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(inv.created)} · {formatPeriod(inv.periodStart, inv.periodEnd)}</p>
                    </div>
                    <Badge variant={statusVariant(inv.status)}>{INVOICE_STATUS_LABELS[inv.status] || inv.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold tabular-nums">{formatMoney(invoiceAmount(inv), inv.currency)}</span>
                    <InvoiceLinks inv={inv} idSuffix="-m" />
                  </div>
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} data-testid="button-invoices-more">
                  {query.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** `idSuffix` keeps the phone card's test ids distinct from the table row's. */
function InvoiceLinks({ inv, idSuffix = "" }: { inv: BillingInvoice; idSuffix?: string }) {
  if (!inv.hostedInvoiceUrl && !inv.invoicePdf) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center justify-end gap-1">
      {inv.hostedInvoiceUrl && (
        <Button asChild variant="ghost" size="sm" className="h-8 px-2">
          <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-invoice-view${idSuffix}-${inv.id}`}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" aria-hidden="true" />View
          </a>
        </Button>
      )}
      {inv.invoicePdf && (
        <Button asChild variant="ghost" size="sm" className="h-8 px-2">
          <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" data-testid={`link-invoice-pdf${idSuffix}-${inv.id}`}>
            <FileDown className="h-3.5 w-3.5 mr-1" aria-hidden="true" />PDF
          </a>
        </Button>
      )}
    </div>
  );
}

export default InvoicesPanel;
