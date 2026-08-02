import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ReceiptText, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { StatusPill } from "@/components/crm-ui";
import { InfoTip } from "@/components/info-tip";

/**
 * The 1–2 button receipt: click "Receipt" to open the receipt-to-date preview
 * (every payment + what's still owing), click "Send receipt" to email it to
 * the client. Mounted on invoice rows in the Documents Center and on the
 * client page's Invoices section.
 */

const money = (c?: number | null) =>
  c == null ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

export function InvoiceReceiptButton({
  invoiceId, invoiceNumber,
}: { invoiceId: string; invoiceNumber?: string | null }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: receipt, isLoading, isError } = useQuery<any>({
    queryKey: [`/api/crm/invoices/${invoiceId}/receipt`],
    enabled: open,
  });

  const send = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/receipt/send`, {})).json(),
    onSuccess: (r: any) => {
      if (r.emailed) {
        toast({ title: `Receipt emailed to ${r.to}` });
      } else {
        // SMTP down (dev) — the address is still named so nothing is ambiguous.
        toast({
          title: `Couldn't email the receipt to ${r.to}`,
          description: "The email server didn't accept it — try again in a moment.",
          variant: "destructive",
        });
      }
    },
    onError: (e: any) =>
      toast({ title: "Could not send the receipt", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <>
      <Button
        size="sm" variant="ghost"
        data-testid={`button-receipt-${invoiceId}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <ReceiptText className="h-4 w-4 mr-1.5" /> Receipt
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-1">
                Receipt — {receipt?.invoice?.number ?? invoiceNumber ?? "invoice"}
                <InfoTip k="receipts" />
              </span>
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !receipt ? (
            <p className="text-sm text-destructive p-2">Couldn't load the receipt — refresh and try again.</p>
          ) : (
            <div className="space-y-4" data-testid="receipt-preview">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{receipt.company?.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {receipt.invoice?.number}{receipt.invoice?.title ? ` · ${receipt.invoice.title}` : ""}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Bill to: {receipt.customer?.displayName}
                  </div>
                </div>
                {receipt.paidInFull && (
                  <StatusPill tone="success">
                    <span data-testid="receipt-paid-in-full">PAID IN FULL</span>
                  </StatusPill>
                )}
              </div>

              {receipt.items?.length > 0 && (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {receipt.items.filter((i: any) => i.kind !== "discount").map((i: any, idx: number) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="px-3 py-1.5">{i.name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {(i.quantityMilli / 1000).toLocaleString("en-US")}{i.unit ? ` ${i.unit}` : ""}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(i.lineTotalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-sm text-right">
                Invoice total <span className="font-medium">{money(receipt.totalCents)}</span>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Payments received
                </div>
                {receipt.payments?.length ? (
                  <div className="rounded-md border">
                    <table className="w-full text-sm">
                      <tbody>
                        {receipt.payments.map((p: any) => (
                          <tr key={p.id} className="border-b last:border-0" data-testid={`receipt-payment-${p.id}`}>
                            <td className="px-3 py-1.5 text-muted-foreground">{day(p.paidAt)}</td>
                            <td className="px-3 py-1.5">
                              {p.method ?? "payment"}{p.note ? ` — ${p.note}` : ""}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{money(p.amountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
                )}
              </div>

              <div className="text-sm text-right space-y-0.5">
                <div>Total paid <span className="font-medium" data-testid="receipt-total-paid">{money(receipt.totalPaidCents)}</span></div>
                <div>
                  Balance owing{" "}
                  <span className="font-medium" data-testid="receipt-balance">{money(receipt.balanceCents)}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => send.mutate()}
              disabled={!receipt || send.isPending}
              data-testid="button-send-receipt"
            >
              {send.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Send className="h-4 w-4 mr-2" /> Send receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
