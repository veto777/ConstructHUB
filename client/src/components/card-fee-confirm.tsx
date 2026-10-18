/**
 * The card-fee disclosure — the pop-up a payer sees before any card checkout
 * is created when the company passes its card processing fee through.
 *
 * Card-network and state rules require the fee to be stated before the
 * payer commits, as a percentage and a dollar amount, with the no-fee way to
 * pay beside it. So the dialog says the rate, the fee on THIS amount, the
 * card total, and offers bank transfer (no fee) as a first-class button when
 * the company accepts it. Nothing is created until the payer picks.
 *
 * `audience: "staff"` is the same disclosure worded for the contractor making
 * a card link on the client's behalf: it tells them what to say to the client
 * before the link goes out.
 */
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export type CardFeeQuote = { bps: number; feeCents: number; totalCents: number };

export const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

export function CardFeeConfirm({
  open, onOpenChange, amountCents, quote, achAvailable, pending, onCard, onBank, audience = "client", companyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is owed before the fee. */
  amountCents: number;
  quote: CardFeeQuote;
  /** Whether bank transfer is offered for this payment (the no-fee button). */
  achAvailable: boolean;
  pending?: boolean;
  onCard: () => void;
  onBank?: () => void;
  audience?: "client" | "staff";
  companyName?: string;
}) {
  const staff = audience === "staff";
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <AlertDialogContent data-testid="dialog-card-fee">
        <AlertDialogHeader>
          <AlertDialogTitle>{staff ? "Card link — tell the client about the fee" : "Paying by card adds a processing fee"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                {staff
                  ? <>Before you send this link, let the client know: paying by card adds a <strong className="text-foreground">{pct(quote.bps)} card processing fee</strong>.{achAvailable ? " Bank transfer (ACH) has no fee." : ""}</>
                  : <>{companyName ? `${companyName} passes` : "We pass"} the card network's processing cost through as a <strong className="text-foreground">{pct(quote.bps)} card processing fee</strong>. It shows as its own line on your receipt.{achAvailable ? " Bank transfer (ACH) has no fee." : ""}</>}
              </p>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-foreground" data-testid="card-fee-breakdown">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Amount due</span><span className="tabular-nums">{money(amountCents)}</span></div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Card processing fee ({pct(quote.bps)})</span>
                  <span className="tabular-nums" data-testid="text-card-fee-amount">{money(quote.feeCents)}</span>
                </div>
                <div className="flex justify-between gap-3 border-t pt-1 font-medium">
                  <span>Total by card</span><span className="tabular-nums" data-testid="text-card-fee-total">{money(quote.totalCents)}</span>
                </div>
                {achAvailable && (
                  <div className="flex justify-between gap-3 text-emerald-700 dark:text-emerald-400">
                    <span>Total by bank transfer</span><span className="tabular-nums">{money(amountCents)}</span>
                  </div>
                )}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending} data-testid="button-card-fee-back">
            {staff ? "Cancel" : "Go back"}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {achAvailable && onBank && (
              <Button variant="outline" onClick={onBank} disabled={pending} data-testid="button-card-fee-bank">
                {staff ? `Make a bank link instead (${money(amountCents)})` : `Pay ${money(amountCents)} by bank instead`}
              </Button>
            )}
            <Button onClick={onCard} disabled={pending} data-testid="button-card-fee-continue">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {staff ? `Make the card link (${money(quote.totalCents)})` : `Continue — pay ${money(quote.totalCents)} by card`}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
