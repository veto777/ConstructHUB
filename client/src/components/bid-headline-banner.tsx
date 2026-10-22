import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { WARRANTY_ANCHOR, normalizeBidHeadline } from "@shared/bid-headline";

/*
 * The org's bid headline (shared/bid-headline.ts) as the client's estimate
 * page shows it: a theme-coloured banner above the scopes and line items, the
 * smaller disclosure line under the claim, and a jump to the warranty section.
 */
/** The org's bid headline banner — nothing at all when the org has none. */
export function BidHeadlineBanner({ headline: raw, hasWarranty }: { headline: unknown; hasWarranty: boolean }) {
  const headline = normalizeBidHeadline(raw);
  // Opened from the email's "Read the full warranty" link: the page renders
  // after the fetch, so the browser's own jump to #warranty found nothing.
  // The #warranty is then dropped from the address, so a later refresh opens at the top, not the warranty.
  useEffect(() => {
    if (!headline || !hasWarranty || window.location.hash !== `#${WARRANTY_ANCHOR}`) return;
    const t = setTimeout(() => {
      document.getElementById(WARRANTY_ANCHOR)?.scrollIntoView({ block: "start" });
      try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [!!headline, hasWarranty]);
  if (!headline) return null;
  return (
    <Card className="border-2 border-primary bg-primary/5 shadow-sm" data-testid="bid-headline" data-track-section="headline">
      <CardContent className="p-5 sm:p-6 flex items-start gap-3 sm:gap-4">
        <ShieldCheck className="h-8 w-8 text-primary shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug" data-testid="text-bid-headline">
            {headline.title}
          </p>
          {headline.subline && (
            <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-bid-headline-subline">
              {headline.subline}
            </p>
          )}
          {hasWarranty && (
            <a href={`#${WARRANTY_ANCHOR}`} className="inline-block text-sm font-medium text-primary hover:underline"
              onClick={(ev) => {
                // Scroll without putting #warranty in the address (a refresh would jump down again).
                const el = document.getElementById(WARRANTY_ANCHOR);
                if (!el) return;
                ev.preventDefault();
                el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              data-testid="link-bid-headline-warranty" data-track="warranty_open">
              Read the full warranty ↓
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
