import { Check, X, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

/**
 * The last step before any plan is paid for (owner, 2026-10-07): say exactly
 * what the buyer is getting and what they are NOT getting, from the price book,
 * and make them confirm it. ConstructHUB and the CRM are two products — nobody
 * should find out which one they bought after the card is charged. A promised
 * but not-yet-live feature is flagged line by line and wears a "Coming soon"
 * badge instead of reading like it works today.
 */
export type PurchaseReviewFeature = { text: string; comingSoon?: boolean };
export type PurchaseReview = {
  /** "ConstructHUB Pro" / "CRM Essentials". */
  name: string;
  /** "ConstructHUB platform" / "ConstructHUB CRM" — which of the two products this is. */
  product: string;
  /** "$79/mo", already formatted. */
  price: string;
  /** e.g. "7-day free trial for a first CRM subscription. Cancel any time." */
  note?: string;
  /** One line set apart above the lists (the founding member offer while it is open). */
  highlight?: string;
  /** Plain strings, or lines flagged comingSoon (shared/plans.ts COMING_MODULES) to wear the badge. */
  included: readonly (string | PurchaseReviewFeature)[];
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
            {review.highlight && (
              <p className="rounded-md border border-emerald-600/40 bg-emerald-600/5 px-3 py-2 text-[13px] font-medium" data-testid="text-review-highlight">
                {review.highlight}
              </p>
            )}
            <div className="grid gap-5 sm:grid-cols-2 text-[14px]">
              <div data-testid="list-review-included">
                <p className="font-semibold mb-2">What you get</p>
                <ul className="space-y-1.5">
                  {review.included.map((item) => {
                    const line = typeof item === "string" ? { text: item } : item;
                    return (
                      <li key={line.text} className="flex items-start gap-2 leading-snug">
                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{line.text}</span>
                          {line.comingSoon && (
                            <Badge variant="outline" className="rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide">Coming soon</Badge>
                          )}
                        </div>
                      </li>
                    );
                  })}
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
