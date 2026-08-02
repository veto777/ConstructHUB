import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { INFO_CONTENT } from "@/lib/info-content";
import { cn } from "@/lib/utils";

/**
 * The little ⓘ next to a feature's title. Opens a plain-English dialog —
 * what it does, why you'd use it, one concrete example — for people who'd
 * rather ask the screen than call someone. The visual icon is 16px; the
 * button itself is a 44px touch target (negative margins keep it from
 * inflating the title row it sits in).
 *
 * Every key must exist in INFO_CONTENT (lib/info-content.ts); a missing key
 * renders nothing rather than a dead icon, and the static vitest check
 * (server/crm/info-content.test.ts) fails the build for it.
 *
 * Note: Esc and backdrop closes are handled here as well as by Radix. The
 * app's @radix-ui/react-dismissable-layer (1.1.6) has a mount race — on a
 * layer's second mount its "add to layers" effect fires the internal update
 * event before the layer's own listener registers (same passive-effect
 * flush), so depending on scheduling the layer stays at index -1 and Radix
 * silently ignores Escape and outside clicks on every second open. These
 * handlers are idempotent with Radix's (both just set open=false), so the
 * dialog closes every way, every time.
 */
export function InfoTip({ k, className }: { k: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const entry = INFO_CONTENT[k];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(`[data-testid="info-dialog-${k}"]`)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, k]);

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid={`info-tip-${k}`}
          aria-label={`What is this? ${entry.title}`}
          // Tips can sit inside table rows and list items — never let the
          // click toggle or navigate whatever wraps the icon.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex h-11 w-11 -my-2.5 -mx-1.5 shrink-0 items-center justify-center rounded-full",
            "text-muted-foreground/60 transition-colors hover:text-primary hover:bg-primary/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid={`info-dialog-${k}`}>
        <DialogHeader>
          <DialogTitle data-testid={`info-title-${k}`}>{entry.title}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed"
            data-testid={`info-body-${k}`}>
            {entry.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
