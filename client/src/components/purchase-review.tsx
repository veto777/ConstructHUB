import { Check, X, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The last step before any plan is paid for (owner, 2026-10-07): say exactly
 * what the buyer is getting and what they are NOT getting, from the price book,
 * and make them confirm it. ConstructHUB and the CRM are two products — nobody
 * should find out which one they bought after the card is charged.
 */
export type PurchaseReview = {
  /** "ConstructHUB Pro" / "CRM Essentials". */
  name: string;
  /** "ConstructHUB platform" / "ConstructHUB CRM" — which of the two products this is. */
  product: string;
  /** "$79/mo", already formatted. */
  price: string;
  /** e.g. "7-day free trial for a first CRM subscription. Cancel any time." */
  note?: string;
  included: readonly string[];
  notIncluded: readonly string[];
};

export function PurchaseReviewDialog({ review, pending, confirmLabel = "Continue to payment", onConfirm, onClose }: {
  review: PurchaseReview | null;
  pending?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={!!review} onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-purchase-review">
        {review && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle data-testid="text-review-title">
                You're buying {review.name} — {review.price}
              </AlertDialogTitle>
              <AlertDialogDescription data-testid="text-review-product">
                This is the <strong>{review.product}</strong>. {review.note}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-5 sm:grid-cols-2 text-[14px]">
              <div data-testid="list-review-included">
                <p className="font-semibold mb-2">What you get</p>
                <ul className="space-y-1.5">
                  {review.included.map((line) => (
                    <li key={line} className="flex items-start gap-2 leading-snug">
                      <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /><span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div data-testid="list-review-not-included">
                <p className="font-semibold mb-2">What you are NOT getting</p>
                <ul className="space-y-1.5">
                  {review.notIncluded.map((line) => (
                    <li key={line} className="flex items-start gap-2 leading-snug text-muted-foreground">
                      <X className="w-4 h-4 shrink-0 mt-0.5 text-red-600" /><span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending} data-testid="button-review-cancel">Go back</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(e) => { e.preventDefault(); onConfirm(); }}
                data-testid="button-review-confirm"
              >
                {pending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
