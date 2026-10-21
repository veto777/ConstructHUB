import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";

/**
 * "Tell us what you'd like" — opened by apiRequest (lib/queryClient.ts) when a buy button's checkout answers
 * 503 checkout_paused (server/billing/checkout-pause.ts: Stripe has charges off). The request is saved and sent
 * to the owner's alerts so the team can set the customer up. One <CheckoutPausedHost /> at the app root.
 */
// ConstructHUB orange as literals: the --mkt-* variables exist only inside marketing layouts, not in the dialog portal.
const BRAND_BUTTON = "bg-[#F97316] hover:bg-[#E4640A] text-white";

let state: { open: boolean; item: string } = { open: false, item: "" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** True while checkout is paused, so a buy button can open the form before any sign-in step. */
export function useCheckoutPaused(): boolean {
  const { data } = useQuery<{ paused: boolean }>({ queryKey: ["/api/billing/checkout-paused"], staleTime: 60_000, retry: false });
  return data?.paused === true;
}

export function openCheckoutPausedForm(item: string): void {
  state = { open: true, item };
  emit();
}

function close() {
  state = { ...state, open: false };
  emit();
}

export function CheckoutPausedHost() {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
  // Keyed by each opening so the form starts fresh with the new item.
  return s.open ? <CheckoutPausedDialog key={s.item} item={s.item} /> : null;
}

function CheckoutPausedDialog({ item }: { item: string }) {
  const me = queryClient.getQueryData<any>(["/api/auth/me"]);
  const [form, setForm] = useState({
    name: (me?.displayName || me?.companyName || "") as string,
    email: (me?.email || "") as string,
    phone: "",
    item,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/checkout-paused/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, page: window.location.pathname }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.message || "Could not send your request. Please try again.");
      else setSent(true);
    } catch {
      setError("Could not send your request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-checkout-paused">
        {sent ? (
          <div className="py-4 text-center space-y-3" data-testid="checkout-paused-sent">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
            <DialogTitle>Got it. We'll be in touch shortly.</DialogTitle>
            <DialogDescription>Our team will contact you to get you set up.</DialogDescription>
            <Button onClick={close} className={`mt-2 ${BRAND_BUTTON}`} data-testid="button-checkout-paused-done">Done</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-[#F97316]" /> Tell us what you'd like</DialogTitle>
              <DialogDescription>
                Online checkout is paused for a moment. Leave your details and our team will reach out to get you set up.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="cp-name">Name</Label>
              <Input id="cp-name" required value={form.name} onChange={set("name")} autoComplete="name" data-testid="input-checkout-paused-name" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-email">Email</Label>
                <Input id="cp-email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" data-testid="input-checkout-paused-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-phone">Phone</Label>
                <Input id="cp-phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" data-testid="input-checkout-paused-phone" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-item">What would you like?</Label>
              <Input id="cp-item" value={form.item} onChange={set("item")} placeholder="Plan, tool or package" data-testid="input-checkout-paused-item" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-note">Anything else? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea id="cp-note" rows={2} value={form.note} onChange={set("note")} data-testid="input-checkout-paused-note" />
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-checkout-paused-error">{error}</p>}
            <Button type="submit" className={`w-full ${BRAND_BUTTON}`} disabled={busy} data-testid="button-checkout-paused-send">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send my request
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
