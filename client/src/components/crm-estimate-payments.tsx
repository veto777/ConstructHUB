/**
 * Payments on a signed estimate (owner, 2026-10-21): the balance at a glance,
 * "Request a payment" for any amount (deposit, a progress payment, the final
 * balance), "Record a payment" for a check / cash / Zelle in hand, and every
 * payment's receipt to view, download or send again.
 *
 * A request is an invoice on the estimate (POST /api/crm/estimates/:id/invoice
 * — progress billing that never passes 100%), emailed (and texted, when
 * texting is set up) with a link where the client pays online or reads how to
 * pay by check or Zelle. The dollars typed are what the client pays, tax
 * included. Every send and every recorded payment asks first, the same way
 * Send does on an estimate.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { confirmAction } from "@/components/confirm-dialog";
import { MANUAL_PAYMENT_METHODS } from "@shared/payment-settings";
import { depositCreditFor } from "@shared/estimate-ledger";
import { CircleDollarSign, Download, ExternalLink, HandCoins, Loader2, Mail, Send } from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const todayLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const cents = (s: string) => Math.round((parseFloat(s) || 0) * 100);
/** "Received on" as an ISO instant at local noon. */
const noonIso = (d: string) => { const x = new Date(`${d || todayLocal()}T12:00:00`); return (Number.isNaN(x.getTime()) ? new Date() : x).toISOString(); };

type Ledger = {
  estimate: { id: string; number: string | null; title: string; depositCents: number | null; taxRateBps: number };
  customer: { displayName: string; email: string | null; phone: string | null } | null;
  ledger: { contractCents: number; paidCents: number; refundedCents: number; processingCents: number; billedCents: number;
    openRequestsCents: number; remainingToBillCents: number; balanceCents: number; paidInFull: boolean };
  billedBps: number; remainingBps: number;
  requests: { id: string; number: string | null; title: string; status: string; totalCents: number; paidCents: number; dueNowCents: number;
    dueAt: string | null; sentAt: string | null; clientLink: string }[];
  payments: { id: string; receiptNumber: string | null; amountCents: number; refundedCents: number; method: string; provider: string;
    note: string | null; status: string; paidAt: string | null; invoiceId: string | null; invoiceNumber: string | null; receiptUrl: string | null }[];
  uninvoicedDeposits: { id: string; amountCents: number; refundedCents: number; status: string; paidAt: string | null }[];
  offlineInstructions: string | null;
  sms: boolean;
};

type RequestKind = "deposit" | "progress" | "final";
const KIND_LABEL: Record<RequestKind, string> = { deposit: "Deposit", progress: "Progress payment", final: "Final balance" };

export function EstimatePayments({ estimate, canTakePayment, canInvoice, onChanged }: {
  estimate: { id: string; number?: string | null; approvedAt?: string | null };
  canTakePayment: boolean;
  canInvoice: boolean;
  onChanged?: () => void;
}) {
  const key = [`/api/crm/estimates/${estimate.id}/ledger`];
  const { data, isLoading, error } = useQuery<Ledger>({ queryKey: key, enabled: !!estimate.approvedAt });
  const changed = () => { queryClient.invalidateQueries({ queryKey: key }); onChanged?.(); };

  const [reqOpen, setReqOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);

  if (!estimate.approvedAt) return null;
  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading payments…</div>;
  if (error || !data) return <div className="text-xs text-destructive">Couldn't load this estimate's payments — refresh to try again.</div>;

  const l = data.ledger;
  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3" data-testid={`estimate-payments-${estimate.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-2"><CircleDollarSign className="h-4 w-4" /> Payments</div>
        <div className="flex flex-wrap gap-2">
          {canInvoice && l.remainingToBillCents > 0 && (
            <Button size="sm" variant="outline" onClick={() => setReqOpen(true)} data-testid={`button-request-payment-${estimate.id}`}>
              <Send className="h-4 w-4 mr-2" /> Request a payment
            </Button>
          )}
          {canTakePayment && !l.paidInFull && (
            <Button size="sm" variant="outline" onClick={() => setRecOpen(true)} data-testid={`button-record-payment-${estimate.id}`}>
              <HandCoins className="h-4 w-4 mr-2" /> Record a payment
            </Button>
          )}
        </div>
      </div>

      {/* The balance at a glance. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm" data-testid={`estimate-ledger-${estimate.id}`}>
        <Stat label="Contract" value={money(l.contractCents)} />
        <Stat label="Paid" value={money(l.paidCents)} tone="good" />
        <Stat label="Requested, not paid" value={money(l.openRequestsCents)} />
        {l.paidInFull
          ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5"><div className="text-[11px] text-muted-foreground">Balance</div><div className="font-semibold text-emerald-700 dark:text-emerald-400">PAID IN FULL</div></div>
          : <Stat label="Balance" value={money(l.balanceCents)} strong />}
      </div>
      {l.processingCents > 0 && <p className="text-xs text-muted-foreground">{money(l.processingCents)} by bank transfer is still settling (bank transfers take a few days).</p>}

      {data.requests.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Payment requests</div>
          {data.requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-md border bg-background px-2.5 py-1.5" data-testid={`payment-request-${r.id}`}>
              <span className="min-w-0">{r.number} · {r.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {money(r.totalCents)}
                {r.dueNowCents > 0 ? ` · ${money(r.dueNowCents)} due${r.dueAt ? ` ${day(r.dueAt)}` : ""}` : " · paid"}
                {r.sentAt ? ` · sent ${day(r.sentAt)}` : " · not sent"}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.payments.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Payments received · receipts</div>
          {data.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-md border bg-background px-2.5 py-1.5" data-testid={`payment-row-${p.id}`}>
              <span className="min-w-0">
                <span className="font-medium tabular-nums">{money(p.amountCents)}</span>
                <span className="text-muted-foreground"> · {p.method} · {day(p.paidAt)}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}{p.status === "processing" ? " · settling" : ""}{p.refundedCents > 0 ? ` · ${money(p.refundedCents)} refunded` : ""}</span>
                {p.note && !/^Card processing fee/.test(p.note) && <span className="block text-xs text-muted-foreground truncate max-w-[28rem]">{p.note}</span>}
              </span>
              {p.receiptUrl && (
                <span className="flex items-center gap-1">
                  {p.receiptNumber && <span className="text-xs text-muted-foreground mr-1">{p.receiptNumber}</span>}
                  <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                    <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-receipt-${p.id}`}><ExternalLink className="h-3.5 w-3.5 mr-1" />Receipt</a>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" asChild aria-label="Download receipt">
                    <a href={`${p.receiptUrl}?download=1`} data-testid={`link-receipt-download-${p.id}`}><Download className="h-3.5 w-3.5" /></a>
                  </Button>
                  {(canTakePayment || canInvoice) && <ResendReceipt payment={p} customer={data.customer} sms={data.sms} onSent={changed} />}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {reqOpen && <RequestPaymentDialog data={data} open={reqOpen} onOpenChange={setReqOpen} onDone={changed} />}
      {recOpen && <RecordPaymentDialog data={data} open={recOpen} onOpenChange={setRecOpen} onDone={changed} />}
    </div>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: "good"; strong?: boolean }) {
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${strong ? "font-semibold" : ""} ${tone === "good" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{value}</div>
    </div>
  );
}

function ResendReceipt({ payment, customer, sms, onSent }: { payment: Ledger["payments"][number]; customer: Ledger["customer"]; sms: boolean; onSent: () => void }) {
  const { toast } = useToast();
  const send = useMutation({
    mutationFn: async (alsoText: boolean) => (await apiRequest("POST", `/api/crm/payments/${payment.id}/receipt/send`, { sms: alsoText })).json(),
    onSuccess: (r: any) => { toast({ title: `Receipt ${r.receiptNumber} sent`, description: [r.emailed ? `Emailed to ${r.to}` : null, r.texted ? "texted" : null].filter(Boolean).join(" · ") }); onSent(); },
    onError: (e: any) => toast({ title: "Could not send the receipt", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const canText = sms && !!customer?.phone;
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={send.isPending || !customer?.email} data-testid={`button-resend-receipt-${payment.id}`}
      title={customer?.email ? "Email this receipt to the client again" : "Add the client's email address first"}
      onClick={() => confirmAction({
        id: "resend-receipt",
        title: `Send ${payment.receiptNumber ?? "this receipt"} to ${customer?.displayName ?? "the client"}?`,
        description: <span className="block space-y-1">
          <span className="block">To: <strong>{customer?.email}</strong>{canText ? <> · text to <strong>{customer?.phone}</strong></> : null}</span>
          <span className="block">{money(payment.amountCents)} by {payment.method.toLowerCase()} on {day(payment.paidAt)}.</span>
        </span>,
        confirmLabel: "Yes, send the receipt", destructive: false,
        onConfirm: () => send.mutate(canText),
      })}>
      {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** "Request a payment": what kind, how much, label, due date — reviewed in a confirm popup, then created and sent. */
function RequestPaymentDialog({ data, open, onOpenChange, onDone }: { data: Ledger; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const l = data.ledger;
  const hasDepositPaid = data.payments.some((p) => p.status === "succeeded" || p.status === "partially_refunded");
  const firstKind: RequestKind = !hasDepositPaid && !data.requests.length ? "deposit" : "progress";
  const [kind, setKind] = useState<RequestKind>(firstKind);
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [amount, setAmount] = useState(() => firstKind === "deposit" && (data.estimate.depositCents ?? 0) > 0
    ? (Math.min(data.estimate.depositCents!, l.remainingToBillCents) / 100).toFixed(2) : "");
  const [percent, setPercent] = useState("");
  const [label, setLabel] = useState("");
  const [due, setDue] = useState(inDays(firstKind === "deposit" ? 0 : 7));
  const [alsoText, setAlsoText] = useState(data.sms && !!data.customer?.phone);
  const [idem] = useState(uid);

  const pickKind = (k: RequestKind) => {
    setKind(k);
    if (k === "final") { setMode("amount"); setAmount((l.remainingToBillCents / 100).toFixed(2)); }
    else if (k === "deposit" && (data.estimate.depositCents ?? 0) > 0) { setMode("amount"); setAmount((Math.min(data.estimate.depositCents!, l.remainingToBillCents) / 100).toFixed(2)); }
    else if (kind === "final") setAmount("");
  };

  // What this request bills, tax included.
  const requestCents = kind === "final" ? l.remainingToBillCents
    : mode === "percent" ? Math.round((l.contractCents * (parseFloat(percent) || 0)) / 100) : cents(amount);
  const percentBps = kind === "final" ? data.remainingBps : mode === "percent" ? Math.round((parseFloat(percent) || 0) * 100) : null;
  // A deposit taken on the estimate before any request is credited to the first request it fits in (server rule).
  const credit = useMemo(() => depositCreditFor(data.uninvoicedDeposits, requestCents), [data, requestCents]);
  const dueNow = Math.max(0, requestCents - credit);
  const balanceAfter = Math.max(0, l.balanceCents - dueNow);
  const title = (label.trim() || (kind === "deposit" ? "Deposit" : kind === "final" ? "Final balance" : "Progress payment")).slice(0, 200);
  const dueInDays = Math.max(0, Math.round((new Date(`${due}T12:00:00`).getTime() - new Date(`${todayLocal()}T12:00:00`).getTime()) / 86400000));

  const tooMuch = requestCents > l.remainingToBillCents || (percentBps != null && percentBps > data.remainingBps);
  const valid = requestCents >= 100 && !tooMuch && (mode !== "percent" || (percentBps ?? 0) >= 1) && !!data.customer?.email;

  const go = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { title, dueInDays, requestKind: kind };
      if (percentBps != null) body.percentBps = percentBps;
      else { body.amountCents = requestCents; body.amountIncludesTax = true; }
      const inv = await (await apiRequest("POST", `/api/crm/estimates/${data.estimate.id}/invoice`, body, { headers: { "Idempotency-Key": `${idem}:request` } })).json();
      const sent = await (await apiRequest("POST", `/api/crm/invoices/${inv.id}/send`, { sms: alsoText })).json().catch((e: any) => ({ sendError: apiErrorMessage(e) }));
      return { inv, sent };
    },
    onSuccess: ({ inv, sent }: any) => {
      if (sent?.sendError) toast({ title: `${inv.number} created, but it didn't send`, description: `${sent.sendError} Send it from Invoices.`, variant: "destructive" });
      else toast({ title: `${inv.number} sent — ${money(Math.max(0, (inv.totalCents ?? 0) - (inv.paidCents ?? 0)))} requested`,
        description: [sent?.emailed ? `Emailed to ${data.customer?.email}` : "Email failed — send the link from Invoices", sent?.texted ? "texted" : null].filter(Boolean).join(" · ") });
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Could not create the request", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const review = () => confirmAction({
    id: "send-payment-request",
    title: `Send ${data.customer?.displayName ?? "the client"} a payment request for ${money(dueNow)}?`,
    description: <span className="block space-y-1 text-sm">
      <span className="block">To: <strong>{data.customer?.email}</strong>{alsoText && data.customer?.phone ? <> · text to <strong>{data.customer.phone}</strong></> : null}</span>
      <span className="block">{data.estimate.number} · {title}{kind === "final" ? "" : ` · due ${day(noonIso(due))}`}</span>
      <span className="block">Request: <strong>{money(requestCents)}</strong>{data.estimate.taxRateBps > 0 ? " (tax included)" : ""}</span>
      {credit > 0 && <span className="block">Deposit already received, credited: −{money(credit)} → <strong>{money(dueNow)} due</strong></span>}
      <span className="block">Balance still owed after this is paid: <strong>{balanceAfter === 0 ? "$0.00 — paid in full" : money(balanceAfter)}</strong></span>
      <span className="block text-muted-foreground">They get a link to pay online{data.offlineInstructions ? ", plus your check / Zelle instructions" : ""}.</span>
    </span>,
    confirmLabel: "Yes, send the request", destructive: false,
    onConfirm: () => go.mutate(),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-request-payment">
        <DialogHeader>
          <DialogTitle>Request a payment — {data.estimate.number}</DialogTitle>
          <DialogDescription>
            Contract {money(l.contractCents)} · paid {money(l.paidCents)} · {money(l.remainingToBillCents)} left to request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>What is it for</Label>
            <Select value={kind} onValueChange={(v) => pickKind(v as RequestKind)}>
              <SelectTrigger data-testid="select-request-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["deposit", "progress", "final"] as RequestKind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {kind === "final" ? (
            <p className="text-sm rounded-md border bg-muted/30 px-3 py-2">Everything not yet requested: <strong>{money(l.remainingToBillCents)}</strong></p>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <Label htmlFor="req-amt">{mode === "percent" ? "Percent of the contract" : `Amount ($${data.estimate.taxRateBps > 0 ? ", tax included" : ""})`}</Label>
                {mode === "percent"
                  ? <Input id="req-amt" type="number" min={1} max={100} step="1" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 25" data-testid="input-request-percent" />
                  : <Input id="req-amt" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" data-testid="input-request-amount" />}
              </div>
              <Select value={mode} onValueChange={(v) => setMode(v as "amount" | "percent")}>
                <SelectTrigger className="w-20" data-testid="select-request-mode"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="amount">$</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="req-label">Label</Label>
              <Input id="req-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200}
                placeholder={kind === "progress" ? "Materials delivered — 25%" : KIND_LABEL[kind]} data-testid="input-request-label" />
            </div>
            <div>
              <Label htmlFor="req-due">Due</Label>
              <Input id="req-due" type="date" min={todayLocal()} value={due} onChange={(e) => setDue(e.target.value)} data-testid="input-request-due" />
            </div>
          </div>
          {data.sms && data.customer?.phone && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={alsoText} onCheckedChange={(v) => setAlsoText(v === true)} data-testid="checkbox-request-sms" /> Also text the link to {data.customer.phone}</label>
          )}
          <div className="text-sm tabular-nums rounded-md border bg-muted/30 px-3 py-2 space-y-0.5" data-testid="text-request-preview">
            <div className="flex justify-between"><span>This request</span><strong>{money(requestCents)}</strong></div>
            {credit > 0 && <div className="flex justify-between text-muted-foreground"><span>Deposit already received, credited</span><span>−{money(credit)}</span></div>}
            {credit > 0 && <div className="flex justify-between"><span>Due from the client</span><strong>{money(dueNow)}</strong></div>}
            <div className="flex justify-between text-muted-foreground"><span>Balance after this is paid</span><span>{money(balanceAfter)}</span></div>
          </div>
          {tooMuch && <p className="text-xs text-destructive" data-testid="text-request-too-much">Only {money(l.remainingToBillCents)} is left to request on this contract.</p>}
          {!data.customer?.email && <p className="text-xs text-destructive">This client has no email address. Add one first.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={review} disabled={!valid || go.isPending} data-testid="button-review-request">
            {go.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Review &amp; send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Record a payment": money already in hand — amount, how, when, check # / reference, note. Asks before saving. */
function RecordPaymentDialog({ data, open, onOpenChange, onDone }: { data: Ledger; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const openRequests = data.requests.filter((r) => r.dueNowCents > 0);
  // With live requests the money is applied to one of them; with none, it's a deposit on the estimate itself.
  const onEstimate = data.requests.length === 0;
  const [target, setTarget] = useState(openRequests[0]?.id ?? "");
  const req = openRequests.find((r) => r.id === target) ?? null;
  const cap = onEstimate ? data.ledger.balanceCents : req?.dueNowCents ?? 0;
  const [amount, setAmount] = useState(() => (onEstimate
    ? ((data.estimate.depositCents && data.estimate.depositCents > 0 && data.ledger.paidCents === 0 ? Math.min(data.estimate.depositCents, cap) : cap) / 100)
    : (cap / 100)).toFixed(2));
  const [method, setMethod] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [idem] = useState(uid);
  const amountCents = cents(amount);
  const methodLabel = MANUAL_PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "";
  const fullNote = [reference.trim() ? (method === "check" ? `Check #${reference.trim().replace(/^#/, "")}` : `Ref ${reference.trim()}`) : null, note.trim() || null].filter(Boolean).join(" — ") || null;
  const valid = amountCents >= 1 && amountCents <= cap && !!method && (onEstimate || !!req);

  const save = useMutation({
    mutationFn: async () => {
      const body = { amountCents, method, note: fullNote, paidAt: noonIso(paidOn) };
      const headers = { headers: { "Idempotency-Key": `${idem}:${onEstimate ? "estimate" : req!.id}` } };
      return (await apiRequest("POST", onEstimate ? `/api/crm/estimates/${data.estimate.id}/payments` : `/api/crm/invoices/${req!.id}/payments`, body, headers)).json();
    },
    onSuccess: (r: any) => {
      const receipt = r?.receiptSkippedReason === "no_email" || !data.customer?.email ? " No receipt emailed — the client has no email on file."
        : r?.receiptSkippedReason === "receipts_off" ? " Automatic receipts are off in Settings — send one from the payment row."
          : " The client gets a receipt by email.";
      toast({ title: `${money(amountCents)} recorded`, description: `${methodLabel} on ${data.estimate.number}.${receipt}` });
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Could not record the payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const review = () => confirmAction({
    id: "record-payment",
    title: `Record ${money(amountCents)} from ${data.customer?.displayName ?? "the client"}?`,
    description: <span className="block space-y-1 text-sm">
      <span className="block">{methodLabel} · received {day(noonIso(paidOn))}{fullNote ? ` · ${fullNote}` : ""}</span>
      <span className="block">Applied to: <strong>{onEstimate ? `${data.estimate.number} (on the estimate)` : `${req?.number} · ${req?.title}`}</strong></span>
      <span className="block">Balance after: <strong>{data.ledger.balanceCents - amountCents <= 0 ? "$0.00 — PAID IN FULL" : money(data.ledger.balanceCents - amountCents)}</strong></span>
      <span className="block text-muted-foreground">A numbered receipt is emailed to {data.customer?.email ?? "the client"} automatically.</span>
    </span>,
    confirmLabel: "Yes, record it", destructive: false,
    onConfirm: () => save.mutate(),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-record-estimate-payment">
        <DialogHeader>
          <DialogTitle>Record a payment — {data.estimate.number}</DialogTitle>
          <DialogDescription>Money you already received: check, cash, Zelle, financing… Balance {money(data.ledger.balanceCents)}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!onEstimate && (
            openRequests.length ? (
              <div>
                <Label>Apply it to</Label>
                <Select value={target} onValueChange={(v) => { setTarget(v); const r = openRequests.find((x) => x.id === v); if (r) setAmount((r.dueNowCents / 100).toFixed(2)); }}>
                  <SelectTrigger data-testid="select-record-target"><SelectValue placeholder="Pick a payment request" /></SelectTrigger>
                  <SelectContent>
                    {openRequests.map((r) => <SelectItem key={r.id} value={r.id}>{r.number} · {r.title} — {money(r.dueNowCents)} due</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-sm rounded-md border bg-muted/30 px-3 py-2">Every payment request on this estimate is paid. Request the rest first ("Request a payment"), then record the money against it.</p>
            )
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="rec-amt">Amount received ($)</Label>
              <Input id="rec-amt" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-record-amount" />
            </div>
            <div>
              <Label>Paid by <span className="text-destructive">*</span></Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger data-testid="select-record-method" aria-label="Payment type"><SelectValue placeholder="Pick one…" /></SelectTrigger>
                <SelectContent>{MANUAL_PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rec-date">Received on</Label>
              <Input id="rec-date" type="date" max={todayLocal()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} data-testid="input-record-date" />
            </div>
            <div>
              <Label htmlFor="rec-ref">{method === "check" ? "Check #" : "Reference #"}</Label>
              <Input id="rec-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "check" ? "1042" : "Confirmation #"} maxLength={80} data-testid="input-record-reference" />
            </div>
          </div>
          <div>
            <Label htmlFor="rec-note">Note (optional)</Label>
            <Input id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-testid="input-record-note" />
          </div>
          {amountCents > cap && <p className="text-xs text-destructive">Only {money(cap)} is due {onEstimate ? "on this contract" : "on that request"}.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={review} disabled={!valid || save.isPending} data-testid="button-review-record-payment">
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record {amountCents >= 1 ? money(amountCents) : "payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
