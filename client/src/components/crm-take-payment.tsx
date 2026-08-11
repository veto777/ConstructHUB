/**
 * Take a payment — the flow the owner couldn't find.
 *
 * One dialog, two honest rails, used from BOTH the client page's payment
 * section and the Payments page's "select a client" card:
 *   - **Online**: ask the server for a hosted Stripe Checkout link (card +
 *     ACH on the contractor's own connected account) and copy it into a
 *     text/email. Session creation only — the client completes the charge on
 *     Stripe's page; nothing is captured here.
 *   - **Manual**: record cash/check/wire/card-on-file against the invoice
 *     (the existing POST /api/crm/invoices/:id/payments path).
 *
 * Money moves in integer cents; the text field is dollars typed by a human.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Copy, ExternalLink, Landmark, Link2, Loader2 } from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** What an invoice still owes right now (retainage stays withheld). */
export function invoiceDueCents(inv: any): number {
  return Math.max(0, (inv.totalCents ?? 0) - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
}

export function TakePaymentDialog({ customerName, invoices, open, onOpenChange, onChanged }: {
  customerName: string;
  /** Every invoice for this client; the dialog keeps only the payable ones. */
  invoices: any[] | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Caller invalidates its queries after a payment lands. */
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const payable = (invoices ?? []).filter((i) => !i.voidedAt && invoiceDueCents(i) > 0);

  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const inv = payable.find((i) => i.id === invoiceId) ?? payable[0] ?? null;
  const due = inv ? invoiceDueCents(inv) : 0;

  // (Re)seed the form whenever the dialog opens or the invoice list shifts.
  useEffect(() => {
    if (!open) return;
    setLink(null);
    setNote("");
    if (inv) {
      setInvoiceId(inv.id);
      setAmount((due / 100).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoices]);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    setLink(null);
    const next = payable.find((i) => i.id === id);
    if (next) setAmount((invoiceDueCents(next) / 100).toFixed(2));
  };

  const recordManual = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${inv.id}/payments`, {
        amountCents: Math.round((parseFloat(amount) || 0) * 100),
        method,
        note: note || null,
      })).json(),
    onSuccess: () => {
      toast({ title: "Payment recorded", description: `${inv.number} updated — the client gets a receipt.` });
      onOpenChange(false);
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const makeLink = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${inv.id}/payment-link`, {})).json(),
    onSuccess: (r: any) => {
      setLink(r.url ?? null);
      if (r.url) {
        navigator.clipboard?.writeText(r.url).catch(() => {});
        toast({ title: "Payment link created — copied", description: "Text or email it to the client; they pay by card or bank (ACH)." });
      }
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Can't create an online payment link", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-take-payment">
        <DialogHeader>
          <DialogTitle>Take a payment — {customerName}</DialogTitle>
        </DialogHeader>

        {!inv ? (
          <p className="text-sm text-muted-foreground" data-testid="take-payment-no-invoices">
            No open invoices for {customerName}. Convert an approved estimate to an invoice first —
            then come back here to take the payment.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Invoice</Label>
              <Select value={inv.id} onValueChange={pickInvoice}>
                <SelectTrigger data-testid="select-take-invoice"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {payable.map((i) => (
                    <SelectItem key={i.id} value={i.id} data-testid={`take-invoice-${i.id}`}>
                      {i.number} · {i.title} — {money(invoiceDueCents(i))} due
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Rail 1: online — hosted Stripe Checkout on the contractor's account. */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Online — card or bank (ACH)
              </div>
              <p className="text-xs text-muted-foreground">
                A secure Stripe link for {money(due)}. The client pays by card or straight from
                their bank; money lands in your connected Stripe account.
              </p>
              {link ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input readOnly value={link} className="text-xs" data-testid="input-checkout-link"
                      onFocus={(e) => e.target.select()} />
                    <Button size="sm" variant="outline" data-testid="button-copy-checkout-result"
                      onClick={() => { navigator.clipboard?.writeText(link); toast({ title: "Copied" }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={link} target="_blank" rel="noopener noreferrer" data-testid="link-open-checkout">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Copied to your clipboard. The link expires after the client pays or abandons it.
                  </p>
                </div>
              ) : (
                <Button size="sm" variant="default" onClick={() => makeLink.mutate()}
                  disabled={makeLink.isPending} data-testid="button-create-checkout-link">
                  {makeLink.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                  Create payment link
                </Button>
              )}
            </div>

            <Separator />

            {/* Rail 2: manual — money already in hand. */}
            <div className="space-y-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <Landmark className="h-4 w-4" /> Already paid you — record it
              </div>
              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label htmlFor="take-amount">Amount received ($)</Label>
                  <Input id="take-amount" type="number" step="0.01" value={amount}
                    onChange={(e) => setAmount(e.target.value)} data-testid="input-take-amount" />
                </div>
                <div>
                  <Label>Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger data-testid="select-take-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="wire">Wire transfer</SelectItem>
                      <SelectItem value="credit_card">Credit card</SelectItem>
                      <SelectItem value="ach">Bank transfer (ACH)</SelectItem>
                      <SelectItem value="card">Card (taken another way)</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="take-note">Note (optional)</Label>
                <Input id="take-note" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Check #1042" data-testid="input-take-note" />
              </div>
            </div>
          </div>
        )}

        {inv && (
          <DialogFooter>
            <Button onClick={() => recordManual.mutate()}
              disabled={!(parseFloat(amount) > 0) || recordManual.isPending}
              data-testid="button-record-manual-payment">
              {recordManual.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record {parseFloat(amount) > 0 ? money(Math.round(parseFloat(amount) * 100)) : "payment"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
