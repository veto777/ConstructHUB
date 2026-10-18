/**
 * "How was the deposit / final payment received?" — the pop-up that keeps
 * off-platform money on the books (server/crm/payment-reconcile.ts).
 *
 * Mounted once in the CRM shell. It asks the server for the open prompt
 * series addressed to this seat whose scheduled day has arrived (day 1, 3, 5
 * after approval / close-out by default — Settings → Payments) and shows the
 * first one as a dialog that must be answered:
 *   - **Record the payment** — amount, a REQUIRED payment type (check, cash,
 *     wire, card…), the date, a note, and a photo / copy of the check
 *     (optional or required per Settings). A deposit lands on the signed
 *     estimate; a final payment on the job's open invoice.
 *   - **Not received yet** — the pop-up comes back on the next scheduled day.
 *   - **Nothing was due** — closes the series, with a reason on the record.
 * An online payment that lands in the meantime closes the series by itself.
 *
 * The same dialog opens from the Payments page's "needs reconciling" list
 * and from a reminder's link (?reconcile=<id> on the client page).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { MANUAL_PAYMENT_METHODS } from "@shared/payment-settings";
import { Camera, Loader2 } from "lucide-react";

export type ReconcilePromptRow = {
  id: string; kind: "deposit" | "final"; title: string; body: string | null;
  customerId: string | null; customerName: string; projectId: string; projectName: string | null;
  estimateId: string | null; invoiceIds: string[]; expectedCents: number | null;
  /** For a final payment: the first invoice that still owes something (decided by the server now, not at creation). */
  payableInvoiceId?: string | null; payableInvoiceNumber?: string | null;
  anchorAt: string; daysSince: number; days: number[]; sentDays: number[]; promptFrom: string;
  photo: "off" | "optional" | "required"; assignedToMe: boolean;
};

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const todayLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const receivedAtIso = (day: string) => { const d = new Date(`${day || todayLocal()}T12:00:00`); return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString(); };

/** The dialog for ONE prompt. `onDone` fires after any answer that closes it. */
export function ReconcileDialog({ prompt, open, onOpenChange, onDone }: {
  prompt: ReconcilePromptRow; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"record" | "none">("record");
  const [amount, setAmount] = useState(prompt.expectedCents != null ? (prompt.expectedCents / 100).toFixed(2) : "");
  const [method, setMethod] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const idem = useMemo(() => uid(), [prompt.id]); // one key per prompt → a double-click never records twice
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const needsPhoto = prompt.photo === "required" && (method === "check" || method === "cash");

  const invalidate = () => {
    queryClient.invalidateQueries({ predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return k.startsWith("/api/crm/reconcile") || k.startsWith("/api/crm/payments") || k.startsWith("/api/crm/invoices")
        || k.startsWith("/api/crm/estimates") || k.startsWith("/api/crm/tasks") || k.startsWith("/api/crm/home");
    } });
  };

  const record = useMutation({
    mutationFn: async () => {
      let proofAttachmentId: string | null = null;
      if (file && prompt.customerId) {
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append("kind", "payment_proof");
          fd.append("refId", prompt.customerId);
          fd.append("file", file);
          const r = await fetch("/api/crm/attachments", { method: "POST", body: fd, credentials: "include" });
          if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "The photo didn't upload");
          proofAttachmentId = (await r.json())?.id ?? null;
        } finally { setUploading(false); }
      }
      const body = { amountCents, method, note: note.trim() || null, paidAt: receivedAtIso(paidOn), proofAttachmentId };
      const headers = { "Idempotency-Key": idem };
      if (prompt.kind === "deposit" && prompt.estimateId) {
        return (await apiRequest("POST", `/api/crm/estimates/${prompt.estimateId}/payments`, body, { headers })).json();
      }
      // The final payment lands on the first invoice that still owes something; date and check photo ride along.
      const invoiceId = prompt.payableInvoiceId;
      if (!invoiceId) throw new Error("This job has no open invoice to record against — open Take a payment on the client's page to bill it first.");
      return (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/payments`, body, { headers })).json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded", description: `${money(amountCents)} by ${MANUAL_PAYMENT_METHODS.find((m) => m.value === method)?.label.toLowerCase() ?? method} is on ${prompt.customerName}'s record.` });
      invalidate(); onOpenChange(false); onDone?.();
    },
    onError: (e: any) => toast({ title: "Could not record the payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const answer = useMutation({
    mutationFn: async (action: "not_yet" | "no_payment_due") =>
      (await apiRequest("POST", `/api/crm/reconcile/${prompt.id}/answer`, { action, note: note.trim() || null })).json(),
    onSuccess: (r: any, action) => {
      toast(action === "not_yet"
        ? { title: "We'll ask again", description: r?.promptFrom ? `Next prompt ${new Date(r.promptFrom).toLocaleDateString()}.` : "On the next scheduled day." }
        : { title: "Noted", description: "No payment was due — it's on the client's record." });
      invalidate(); onOpenChange(false); onDone?.();
    },
    onError: (e: any) => toast({ title: "Could not save that", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const busy = record.isPending || answer.isPending || uploading;
  const what = prompt.kind === "deposit" ? "deposit" : "final payment";
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid={`dialog-reconcile-${prompt.kind}`}>
        <AlertDialogHeader>
          <AlertDialogTitle>How was {prompt.customerName}'s {what} received?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                {prompt.projectName ?? "The job"} was {prompt.kind === "deposit" ? "approved" : "closed out"} {prompt.daysSince === 0 ? "today" : `${prompt.daysSince} day${prompt.daysSince === 1 ? "" : "s"} ago`}
                {prompt.expectedCents != null ? <> and <strong className="text-foreground">{money(prompt.expectedCents)}</strong> is expected</> : ""}, but no payment is on file.
                Online payments land on their own — a check, cash or wire needs the payment type entered here so the books stay right.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex gap-2 text-sm" role="tablist">
          <Button size="sm" variant={mode === "record" ? "default" : "outline"} onClick={() => setMode("record")} data-testid="button-reconcile-mode-record">Record the payment</Button>
          <Button size="sm" variant={mode === "none" ? "default" : "outline"} onClick={() => setMode("none")} data-testid="button-reconcile-mode-none">Nothing was due</Button>
        </div>

        {mode === "record" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rec-amount">Amount received ($)</Label>
                <Input id="rec-amount" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-reconcile-amount" />
              </div>
              <div>
                <Label>Payment type <span className="text-destructive">*</span></Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger data-testid="select-reconcile-method" aria-label="Payment type"><SelectValue placeholder="Pick one…" /></SelectTrigger>
                  <SelectContent>
                    {MANUAL_PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rec-date">Received on</Label>
                <Input id="rec-date" type="date" value={paidOn} max={todayLocal()} onChange={(e) => setPaidOn(e.target.value)} data-testid="input-reconcile-date" />
              </div>
              <div>
                <Label htmlFor="rec-note">Note</Label>
                <Input id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Check #1042" data-testid="input-reconcile-note" />
              </div>
            </div>
            {prompt.photo !== "off" && (
              <div className="rounded-lg border p-3 text-sm space-y-2" data-testid="reconcile-photo">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><Camera className="h-4 w-4" /> Photo or copy of the check {needsPhoto ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}</span>
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-reconcile-photo">{file ? "Change" : "Add"}</Button>
                </div>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-reconcile-photo" />
                {file && <p className="text-xs text-muted-foreground truncate" data-testid="text-reconcile-photo-name">{file.name}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="rec-why">Why was nothing due? <span className="text-destructive">*</span></Label>
            <Input id="rec-why" value={note} onChange={(e) => setNote(e.target.value)} placeholder="No deposit on this job — paid on completion" data-testid="input-reconcile-why" />
          </div>
        )}

        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => answer.mutate("not_yet")} disabled={busy} data-testid="button-reconcile-not-yet">
            Not received yet
          </Button>
          {mode === "record" ? (
            <Button onClick={() => record.mutate()} disabled={busy || amountCents < 1 || !method || (needsPhoto && !file)} data-testid="button-reconcile-record">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record {amountCents >= 1 ? money(amountCents) : "payment"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => answer.mutate("no_payment_due")} disabled={busy || note.trim().length < 3} data-testid="button-reconcile-none">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Nothing was due — close this
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The shell-level feed: shows the first due prompt, then the next, until none are due. */
export function ReconcilePrompts() {
  const [location] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const enabled = !!me?.member && me?.crm?.active !== false && !/^\/(e|i|co|jc|portal|lead-form|auth)\b/.test(location);
  const { data } = useQuery<{ due: ReconcilePromptRow[]; open: number }>({
    queryKey: ["/api/crm/reconcile/due"], enabled, refetchInterval: 5 * 60 * 1000, retry: false,
  });
  // A reminder link (?reconcile=<id>) opens that prompt straight away, due or not.
  const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("reconcile") : null;
  const { data: openList } = useQuery<{ open: ReconcilePromptRow[] }>({ queryKey: ["/api/crm/reconcile/open"], enabled: enabled && !!wanted, retry: false });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const current = useMemo(() => {
    const fromLink = wanted ? openList?.open.find((p) => p.id === wanted) : null;
    if (fromLink && !dismissed.has(fromLink.id)) return fromLink;
    return (data?.due ?? []).find((p) => !dismissed.has(p.id)) ?? null;
  }, [data, openList, wanted, dismissed]);
  // Re-arm after the feed refreshes (an answered prompt is no longer in it).
  useEffect(() => { if (data) setDismissed(new Set()); }, [data?.due?.length]);
  if (!current) return null;
  return (
    <ReconcileDialog key={current.id} prompt={current} open
      onOpenChange={(o) => { if (!o) setDismissed((s) => new Set([...s, current.id])); }} />
  );
}
