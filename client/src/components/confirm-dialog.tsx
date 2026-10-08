import { useSyncExternalStore, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The product's confirmation dialog — the replacement for `window.confirm`.
 *
 * Native confirms can't explain what is about to happen, look foreign, and
 * are suppressed by some web views (the iPhone app shell among them), where
 * the action then silently never runs. This is the same shadcn AlertDialog
 * the hand-built "Delete estimate / Delete client" dialogs use, driven the
 * way toasts are: call `confirmAction({...})` from any handler; one
 * `<ConfirmHost />` mounted at the app root renders it.
 *
 *   confirmAction({
 *     id: "void-invoice",                       // → data-testid suffix
 *     title: "Void invoice INV-1042?",
 *     description: "…what happens, and whether it can be undone…",
 *     confirmLabel: "Void invoice",
 *     onConfirm: () => voidInvoice.mutate(id),
 *   });
 *
 * Focus moves to Cancel on open (the safe default for a destructive
 * question), is trapped while open, and returns to the button that asked;
 * Escape and Cancel dismiss without running anything.
 *
 * Test ids: `dialog-confirm-<id>`, `button-confirm-<id>`, `button-cancel-<id>`.
 */
export type ConfirmOptions = {
  /** Stable slug for the test ids, e.g. "void-invoice". */
  id: string;
  title: ReactNode;
  /** Exactly what will happen, and whether it can be undone. */
  description: ReactNode;
  /** The verb on the confirm button — never a bare "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button. Default true: these are destructive questions. */
  destructive?: boolean;
  onConfirm: () => void;
};

type State = { open: boolean; options: ConfirmOptions | null };

let state: State = { open: false, options: null };
const listeners = new Set<() => void>();
const emit = (next: State) => { state = next; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

// The dialog isn't opened through a Radix Trigger, so Radix has nowhere to
// send focus back to on close; remember the control that asked.
let opener: HTMLElement | null = null;

/** Ask before a destructive action. Nothing runs unless the user confirms. */
export function confirmAction(options: ConfirmOptions): void {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  emit({ open: true, options });
}

/** True while a confirmation is on screen — for global key handlers
 *  (e.g. the JobCam lightbox) that must not also act on its Escape. */
export function isConfirmOpen(): boolean {
  return state.open;
}

// The options stay in place while the dialog animates closed, so the text
// doesn't blank out mid-fade.
const close = () => { if (state.open) emit({ open: false, options: state.options }); };

/** Mount once, at the app root (next to the Toaster). */
export function ConfirmHost() {
  const { open, options } = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!options) return null;
  const destructive = options.destructive !== false;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      {/* Above the JobCam lightbox (z-70), below toasts (z-100). */}
      <AlertDialogContent
        className="z-[80]"
        overlayClassName="z-[80]"
        data-testid={`dialog-confirm-${options.id}`}
        onCloseAutoFocus={(e) => {
          // Back to the button that asked — unless the action removed it.
          e.preventDefault();
          if (opener?.isConnected) opener.focus();
          opener = null;
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{options.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words" data-testid={`text-confirm-${options.id}`}>
            {options.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`button-cancel-${options.id}`}>
            {options.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
            data-testid={`button-confirm-${options.id}`}
            onClick={() => options.onConfirm()}
          >
            {options.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
