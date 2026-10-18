/**
 * Take a payment — the flow the owner couldn't find.
 *
 * One dialog, every honest way money arrives, used from BOTH the client page's
 * payment section and the Payments page's "select a client" card:
 *   - **Invoice first, when there is none**: a signed estimate (or a custom
 *     amount) becomes an invoice right here — the full signed total, a
 *     percentage, or a dollar amount, with an optional discount — so the
 *     payment screen is always reachable once a contract is signed.
 *   - **Online**: ask the server for a hosted Stripe Checkout link (card and/or
 *     ACH on the contractor's own connected account) and copy it into a
 *     text/email. With a card fee configured, a bank link (no fee) and a card
 *     link (fee disclosed first) are made separately. Session creation only —
 *     the client completes the charge on Stripe's page; nothing is captured here.
 *   - **Manual**: record cash/check/wire/card against the invoice, or a
 *     deposit against the signed estimate — the payment type is REQUIRED so
 *     every dollar is tracked, with an optional photo of the check.
 *
 * Money moves in integer cents; the text fields are dollars typed by a human.
 * Every payment write carries an Idempotency-Key, so a double-click or a
 * retried request never records twice (server/crm/payment-guard.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
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
import { Camera, Copy, ExternalLink, FilePlus2, Landmark, Link2, Loader2 } from "lucide-react";
import { CardFeeConfirm, pct as feePct, type CardFeeQuote } from "@/components/card-fee-confirm";
import { MANUAL_PAYMENT_METHODS } from "@shared/payment-settings";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** What an invoice still owes right now (retainage stays withheld). */
export function invoiceDueCents(inv: any): number {
  return Math.max(0, (inv.totalCents ?? 0) - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
}

const ONLINE_OFF_TEXT =
  "Online payment links need a connected Stripe account that can take charges — set it up on the Payments page.";

/** Clipboard write that reports whether it happened (denied permission or an
 *  insecure context → false), so nothing claims "copied" when it wasn't. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Payment states that mean an estimate's deposit is already paid (or settling). */
const DEPOSIT_TAKEN = ["succeeded", "processing", "partially_refunded", "refunded"];

const todayLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
/** A per-form idempotency key; plain HTTP (a LAN address) has no crypto.randomUUID. */
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
/** "Received on" as an ISO instant at local noon; an emptied field means today. */
const receivedAtIso = (day: string) => { const d = new Date(`${day || todayLocal()}T12:00:00`); return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString(); };

/** The signed total an approved estimate reads for (what the server bills against). */
const signedTotalCents = (e: any): number => Number(e.approvedTotalCents ?? e.totalCents ?? 0) || 0;

/** The required payment-type dropdown (shared by the invoice and deposit forms). */
function MethodSelect({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId} aria-label="Payment type"><SelectValue placeholder="Pick one…" /></SelectTrigger>
      <SelectContent>
        {MANUAL_PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function TakePaymentDialog({
  customerName, customerId, invoices, estimates, payments, open, onOpenChange, onChanged,
}: {
  customerName: string;
  /** The client — needed to create an invoice or file a check photo from here. */
  customerId?: string;
  /** Every invoice for this client; the dialog keeps only the payable ones. */
  invoices: any[] | undefined;
  /** The client's estimates — signed ones with an unpaid deposit get a deposit link. */
  estimates?: any[] | undefined;
  /** The client's payments, when the caller has them — hides deposits already paid. */
  payments?: any[] | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Caller invalidates its queries after a payment lands. */
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  // Online links need a connected Stripe account that can charge. Once the
  // status says there is none, say so instead of offering a button that can
  // only fail (while it loads, the button stays and the server answers).
  const { data: payStatus } = useQuery<any>({ queryKey: ["/api/crm/payments/status"], enabled: open });
  const onlineOff = Boolean(payStatus) && !payStatus.account?.chargesEnabled;
  // The org's pass-through card fee (Settings → Payments). With one set, a
  // link is made for ONE rail: a bank link (no fee) or a card link that carries
  // the fee as its own line — after the staff member has seen what to tell the
  // client. Without one, a single link offers both rails as before.
  const cardFeeBps: number | null = payStatus?.cardFee?.bps ? Number(payStatus.cardFee.bps) : null;
  const quoteFor = (cents: number): CardFeeQuote | null => {
    if (!cardFeeBps) return null;
    const feeCents = Math.round((cents * cardFeeBps) / 10000);
    return { bps: cardFeeBps, feeCents, totalCents: cents + feeCents };
  };
  const achOffered = payStatus?.account?.achEnabled !== false;
  const photoRule: "off" | "optional" | "required" = payStatus?.reconcile?.photo ?? "optional";
  const [feeConfirm, setFeeConfirm] = useState<{ kind: "invoice" } | { kind: "deposit"; estimateId: string; amountCents: number } | null>(null);
  const payable = (invoices ?? []).filter((i) => !i.voidedAt && invoiceDueCents(i) > 0);
  const signed = (estimates ?? []).filter((e) => e.approvedAt);
  // A deposit is not credited to later invoices, so once an estimate has a
  // live invoice, collecting its deposit too would bill the client twice.
  const deposits = signed.filter((e) =>
    (e.depositCents ?? 0) >= 50
    && !(payments ?? []).some((p) => p.estimateId === e.id && DEPOSIT_TAKEN.includes(p.status))
    && !(invoices ?? []).some((i) => i.estimateId === e.id && !i.voidedAt));

  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [depositLink, setDepositLink] = useState<{ estimateId: string; url: string } | null>(null);
  // One idempotency key per dialog open and per form — a double-click replays, never doubles.
  const [idem, setIdem] = useState(() => uid());

  const inv = payable.find((i) => i.id === invoiceId) ?? payable[0] ?? null;
  const due = inv ? invoiceDueCents(inv) : 0;
  // What the button records, in whole cents — "0.001" is $0.00, not a payment.
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  // ── Create an invoice here (signed estimate or custom amount) ─────────────
  const [newInvOpen, setNewInvOpen] = useState(false);
  const [newInv, setNewInv] = useState({
    source: "" as string, mode: "full" as "full" | "percent" | "amount", percent: "", amount: "",
    discountKind: "amount" as "amount" | "percent", discount: "", title: "",
  });
  const sourceEstimate = signed.find((e) => e.id === newInv.source) ?? null;

  // Seed the form when the dialog OPENS — never on a background refetch of the invoice list, which would wipe a
  // half-typed payment and swap the idempotency key under a retry.
  useEffect(() => {
    if (!open) return;
    setLink(null);
    setDepositLink(null);
    setNote("");
    setMethod("");
    setIdem(uid());
    if (inv) {
      setInvoiceId(inv.id);
      setAmount((due / 100).toFixed(2));
    }
    setNewInvOpen(!inv);
    setNewInv((f) => ({ ...f, source: signed[0]?.id ?? "custom", title: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // When the list changes while open (an invoice was just created here, or paid), keep a valid selection and
  // open the create form only if nothing is left to pay.
  useEffect(() => {
    if (!open) return;
    if (!payable.length) { setNewInvOpen(true); return; }
    if (!payable.some((i) => i.id === invoiceId)) {
      const next = payable[0];
      setInvoiceId(next.id);
      setAmount((invoiceDueCents(next) / 100).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoices]);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    setLink(null);
    const next = payable.find((i) => i.id === id);
    if (next) setAmount((invoiceDueCents(next) / 100).toFixed(2));
  };

  const newInvPreview = useMemo(() => {
    const base = sourceEstimate ? signedTotalCents(sourceEstimate) : Math.round((parseFloat(newInv.amount) || 0) * 100);
    let draw = base;
    if (sourceEstimate && newInv.mode === "percent") draw = Math.round((base * (parseFloat(newInv.percent) || 0)) / 100);
    if (sourceEstimate && newInv.mode === "amount") draw = Math.round((parseFloat(newInv.amount) || 0) * 100);
    const disc = newInv.discountKind === "percent"
      ? Math.round((draw * (parseFloat(newInv.discount) || 0)) / 100)
      : Math.round((parseFloat(newInv.discount) || 0) * 100);
    return { base, draw, disc: Math.max(0, disc), total: Math.max(0, draw - Math.max(0, disc)) };
  }, [sourceEstimate, newInv]);

  const createInvoice = useMutation({
    mutationFn: async () => {
      const headers = { "Idempotency-Key": `${idem}:invoice` };
      if (sourceEstimate) {
        const body: Record<string, unknown> = { title: newInv.title.trim() || undefined };
        if (newInv.mode === "percent") body.percentBps = Math.round((parseFloat(newInv.percent) || 0) * 100);
        else if (newInv.mode === "amount") body.amountCents = Math.round((parseFloat(newInv.amount) || 0) * 100);
        else body.percentBps = 10000;
        if (newInvPreview.disc > 0) {
          if (newInv.discountKind === "percent") body.discountBps = Math.round((parseFloat(newInv.discount) || 0) * 100);
          else body.discountCents = newInvPreview.disc;
        }
        return (await apiRequest("POST", `/api/crm/estimates/${sourceEstimate.id}/invoice`, body, { headers })).json();
      }
      if (!customerId) throw new Error("Open this from the client's page to bill a custom amount.");
      const title = newInv.title.trim() || "Invoice";
      const items: any[] = [{ kind: "labor", name: title, quantityMilli: 1000, unitPriceCents: newInvPreview.draw, taxable: false }];
      if (newInvPreview.disc > 0) items.push({ kind: "discount", name: "Discount", quantityMilli: 1000, unitPriceCents: newInvPreview.disc, taxable: false });
      return (await apiRequest("POST", "/api/crm/invoices", { customerId, title, items }, { headers })).json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r?.number ?? "Invoice"} created`, description: `${money(r?.totalCents)} — take the payment below.` });
      if (r?.id) setInvoiceId(r.id);
      setNewInvOpen(false);
      setNewInv((f) => ({ ...f, percent: "", amount: "", discount: "", title: "" }));
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Could not create the invoice", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const newInvValid = sourceEstimate
    ? (newInv.mode === "full" || (newInv.mode === "percent" ? (parseFloat(newInv.percent) || 0) > 0 && (parseFloat(newInv.percent) || 0) <= 100 : newInvPreview.draw >= 100))
      && newInvPreview.total > 0
    : newInvPreview.draw >= 100 && newInvPreview.total > 0 && !!customerId;

  // ── Manual: an invoice payment already in hand ───────────────────────────
  const recordManual = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${inv.id}/payments`, {
        amountCents,
        method,
        note: note || null,
      }, { headers: { "Idempotency-Key": `${idem}:${inv.id}` } })).json(),
    onSuccess: (r: any) => {
      // Only promise the receipt the server says it is sending.
      const receipt = r?.receiptQueued
        ? "the client gets a receipt."
        : r?.receiptSkippedReason === "no_email"
          ? `no receipt emailed — ${customerName} has no email address on file.`
          : r?.receiptSkippedReason === "receipts_off"
            ? "no receipt sent — automatic receipts are turned off in Settings."
            : r?.receiptSkippedReason === "no_phone"
              ? `no text receipt — ${customerName} has no cell number on file.`
              : "no receipt was sent.";
      toast({ title: "Payment recorded", description: `${inv.number} updated — ${receipt}` });
      onOpenChange(false);
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Manual: a deposit received off the platform, against the signed estimate ──
  const [depositForm, setDepositForm] = useState<{ estimateId: string; amount: string; method: string; paidOn: string; note: string; file: File | null } | null>(null);
  const depositFileRef = useRef<HTMLInputElement>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const depositNeedsPhoto = photoRule === "required" && (depositForm?.method === "check" || depositForm?.method === "cash");
  const recordDeposit = useMutation({
    mutationFn: async () => {
      if (!depositForm) throw new Error("Nothing to record");
      let proofAttachmentId: string | null = null;
      if (depositForm.file && customerId) {
        setUploadingProof(true);
        try {
          const fd = new FormData();
          fd.append("kind", "payment_proof");
          fd.append("refId", customerId);
          fd.append("file", depositForm.file);
          const r = await fetch("/api/crm/attachments", { method: "POST", body: fd, credentials: "include" });
          if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "The photo didn't upload");
          proofAttachmentId = (await r.json())?.id ?? null;
        } finally { setUploadingProof(false); }
      }
      return (await apiRequest("POST", `/api/crm/estimates/${depositForm.estimateId}/payments`, {
        amountCents: Math.round((parseFloat(depositForm.amount) || 0) * 100),
        method: depositForm.method, note: depositForm.note.trim() || null,
        paidAt: receivedAtIso(depositForm.paidOn), proofAttachmentId,
      }, { headers: { "Idempotency-Key": `${idem}:deposit:${depositForm.estimateId}` } })).json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Deposit recorded", description: `${money(r?.payment?.amountCents)} is on ${customerName}'s record${r?.reconciledPrompts ? " — the reconcile reminder is cleared." : "."}` });
      setDepositForm(null);
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Could not record the deposit", description: apiErrorMessage(e), variant: "destructive" }),
  });

  /** How the link pays, for the toast: one rail when pinned, both otherwise. */
  const paysBy = (m: "card" | "ach" | undefined, feeCents?: number) =>
    m === "card" ? `they pay by card (includes the ${money(feeCents ?? 0)} card processing fee).`
      : m === "ach" ? "they pay straight from their bank — no fee."
        : "they pay by card or bank (ACH).";

  const makeLink = useMutation({
    mutationFn: async (m?: "card" | "ach") =>
      (await apiRequest("POST", `/api/crm/invoices/${inv.id}/payment-link`, m ? { method: m } : {})).json(),
    onSuccess: async (r: any, m) => {
      setFeeConfirm(null);
      setLink(r.url ?? null);
      setLinkCopied(false);
      if (r.url) {
        const copied = await copyText(r.url);
        setLinkCopied(copied);
        toast(copied
          ? { title: "Payment link created — copied", description: `Text or email it to the client; ${paysBy(m, r.cardFeeCents)}` }
          : { title: "Payment link created", description: `Copy it from the box below, then text or email it to the client; ${paysBy(m, r.cardFeeCents)}` });
      }
      onChanged?.();
    },
    onError: (e: any) => { setFeeConfirm(null); toast({ title: "Can't create an online payment link", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  const makeDepositLink = useMutation({
    mutationFn: async ({ estimateId, method: m }: { estimateId: string; method?: "card" | "ach" }) => ({
      estimateId, method: m,
      r: await (await apiRequest("POST", `/api/crm/estimates/${estimateId}/payment-link`, m ? { method: m } : {})).json(),
    }),
    onSuccess: async ({ estimateId, method: m, r }: { estimateId: string; method?: "card" | "ach"; r: any }) => {
      setFeeConfirm(null);
      if (r.url) {
        setDepositLink({ estimateId, url: r.url });
        const copied = await copyText(r.url);
        toast(copied
          ? { title: "Deposit link created — copied", description: `Text or email it to the client; ${paysBy(m, r.cardFeeCents)}` }
          : { title: "Deposit link created", description: `Copy it from the box below, then text or email it to the client; ${paysBy(m, r.cardFeeCents)}` });
      }
      onChanged?.();
    },
    onError: (e: any) => { setFeeConfirm(null); toast({ title: "Can't create a deposit link", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  const depositPending = (estimateId: string) => makeDepositLink.isPending && makeDepositLink.variables?.estimateId === estimateId;

  const invoiceForm = (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3" data-testid="take-new-invoice">
      <div className="text-sm font-medium flex items-center gap-2"><FilePlus2 className="h-4 w-4" /> Create an invoice to bill against</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Bill from</Label>
          <Select value={newInv.source} onValueChange={(v) => setNewInv((f) => ({ ...f, source: v, mode: "full" }))}>
            <SelectTrigger data-testid="select-new-invoice-source"><SelectValue placeholder="Pick a signed estimate or a custom amount" /></SelectTrigger>
            <SelectContent>
              {signed.map((e) => (
                <SelectItem key={e.id} value={e.id} data-testid={`new-invoice-source-${e.id}`}>
                  {e.number} · {e.title} — {money(signedTotalCents(e))} signed
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom amount (no estimate)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {sourceEstimate ? (
          <>
            <div>
              <Label>How much</Label>
              <Select value={newInv.mode} onValueChange={(v) => setNewInv((f) => ({ ...f, mode: v as typeof f.mode }))}>
                <SelectTrigger data-testid="select-new-invoice-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full signed total</SelectItem>
                  <SelectItem value="percent">A percentage</SelectItem>
                  <SelectItem value="amount">A dollar amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newInv.mode === "percent" && (
              <div>
                <Label htmlFor="new-inv-pct">Percent of the signed total</Label>
                <Input id="new-inv-pct" type="number" min={1} max={100} step="1" value={newInv.percent}
                  onChange={(e) => setNewInv((f) => ({ ...f, percent: e.target.value }))} placeholder="e.g. 50" data-testid="input-new-invoice-percent" />
              </div>
            )}
            {newInv.mode === "amount" && (
              <div>
                <Label htmlFor="new-inv-amt">Amount to bill now ($)</Label>
                <Input id="new-inv-amt" type="number" min={1} step="0.01" value={newInv.amount}
                  onChange={(e) => setNewInv((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 5000" data-testid="input-new-invoice-amount" />
              </div>
            )}
          </>
        ) : (
          <div>
            <Label htmlFor="new-inv-amt">Amount ($)</Label>
            <Input id="new-inv-amt" type="number" min={1} step="0.01" value={newInv.amount}
              onChange={(e) => setNewInv((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 2500" data-testid="input-new-invoice-amount" />
          </div>
        )}
        <div>
          <Label htmlFor="new-inv-title">Title {sourceEstimate ? "(optional)" : ""}</Label>
          <Input id="new-inv-title" value={newInv.title} onChange={(e) => setNewInv((f) => ({ ...f, title: e.target.value }))}
            placeholder={sourceEstimate ? sourceEstimate.title : "Service call"} data-testid="input-new-invoice-title" />
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label htmlFor="new-inv-disc">Discount {newInv.discountKind === "percent" ? "(%)" : "($)"}</Label>
            <Input id="new-inv-disc" type="number" min={0} step={newInv.discountKind === "percent" ? "1" : "0.01"} value={newInv.discount}
              onChange={(e) => setNewInv((f) => ({ ...f, discount: e.target.value }))} placeholder="0" data-testid="input-new-invoice-discount" />
          </div>
          <Select value={newInv.discountKind} onValueChange={(v) => setNewInv((f) => ({ ...f, discountKind: v as typeof f.discountKind }))}>
            <SelectTrigger className="w-20" data-testid="select-new-invoice-discount-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="amount">$</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground tabular-nums" data-testid="text-new-invoice-preview">
          {newInvPreview.disc > 0 ? <>{money(newInvPreview.draw)} − {money(newInvPreview.disc)} discount = </> : null}
          <strong className="text-foreground">{money(newInvPreview.total)}</strong>{sourceEstimate && newInv.mode !== "full" ? ` of ${money(newInvPreview.base)} signed` : ""}
          {sourceEstimate && (sourceEstimate.taxRateBps ?? 0) > 0 ? " before tax" : ""}
          {sourceEstimate && (payments ?? []).some((p) => p.estimateId === sourceEstimate.id && !p.invoiceId && DEPOSIT_TAKEN.includes(p.status)) ? " · the deposit already received is credited to this invoice" : ""}
        </span>
        <div className="flex gap-2">
          {inv && <Button size="sm" variant="ghost" onClick={() => setNewInvOpen(false)}>Cancel</Button>}
          <Button size="sm" onClick={() => createInvoice.mutate()} disabled={!newInvValid || createInvoice.isPending} data-testid="button-create-invoice-here">
            {createInvoice.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create invoice
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-take-payment">
        <DialogHeader>
          <DialogTitle>Take a payment — {customerName}</DialogTitle>
          <DialogDescription>Collect a deposit or an invoice payment from this client.</DialogDescription>
        </DialogHeader>

        {deposits.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2.5" data-testid="take-deposits">
            <div className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Deposit on a signed estimate
            </div>
            {deposits.map((e) => (
              <div key={e.id} className="space-y-2" data-testid={`take-deposit-${e.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">{e.number} · {e.title} — {money(e.depositCents)} deposit</span>
                  {!onlineOff && depositLink?.estimateId !== e.id && (cardFeeBps ? (
                    <div className="flex flex-wrap gap-1.5">
                      {achOffered && (
                        <Button size="sm" variant="outline" onClick={() => makeDepositLink.mutate({ estimateId: e.id, method: "ach" })}
                          disabled={makeDepositLink.isPending} data-testid={`button-deposit-link-ach-${e.id}`}>
                          {depositPending(e.id) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Landmark className="h-4 w-4 mr-2" />}
                          Bank link — no fee
                        </Button>
                      )}
                      <Button size="sm" variant="outline"
                        onClick={() => setFeeConfirm({ kind: "deposit", estimateId: e.id, amountCents: e.depositCents })}
                        disabled={makeDepositLink.isPending} data-testid={`button-deposit-link-card-${e.id}`}>
                        <Link2 className="h-4 w-4 mr-2" />
                        Card link — adds {feePct(cardFeeBps)}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => makeDepositLink.mutate({ estimateId: e.id })}
                      disabled={makeDepositLink.isPending} data-testid={`button-deposit-link-${e.id}`}>
                      {depositPending(e.id) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                      Create deposit link
                    </Button>
                  ))}
                </div>
                {depositLink && depositLink.estimateId === e.id && (
                  <div className="flex gap-2">
                    <Input readOnly value={depositLink.url} className="text-xs" data-testid="input-deposit-link"
                      onFocus={(ev) => ev.target.select()} />
                    <Button size="sm" variant="outline" aria-label="Copy deposit link"
                      onClick={async () => {
                        toast(await copyText(depositLink.url)
                          ? { title: "Copied" }
                          : { title: "Copy failed", description: "Select the link and copy it by hand.", variant: "destructive" });
                      }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {/* Took the deposit by check, cash or wire? Record it against the signed estimate — payment type required. */}
                {depositForm && depositForm.estimateId === e.id ? (() => { const df = depositForm; return (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2" data-testid={`take-deposit-record-${e.id}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor={`dep-amt-${e.id}`}>Amount received ($)</Label>
                        <Input id={`dep-amt-${e.id}`} type="number" step="0.01" min={0} value={df.amount}
                          onChange={(ev) => setDepositForm((f) => f && ({ ...f, amount: ev.target.value }))} data-testid="input-deposit-amount" />
                      </div>
                      <div>
                        <Label>Payment type <span className="text-destructive">*</span></Label>
                        <MethodSelect value={df.method} onChange={(v) => setDepositForm((f) => f && ({ ...f, method: v }))} testId="select-deposit-method" />
                      </div>
                      <div>
                        <Label htmlFor={`dep-date-${e.id}`}>Received on</Label>
                        <Input id={`dep-date-${e.id}`} type="date" max={todayLocal()} value={df.paidOn}
                          onChange={(ev) => setDepositForm((f) => f && ({ ...f, paidOn: ev.target.value }))} data-testid="input-deposit-date" />
                      </div>
                      <div>
                        <Label htmlFor={`dep-note-${e.id}`}>Note</Label>
                        <Input id={`dep-note-${e.id}`} value={df.note} placeholder="Check #1042"
                          onChange={(ev) => setDepositForm((f) => f && ({ ...f, note: ev.target.value }))} data-testid="input-deposit-note" />
                      </div>
                    </div>
                    {photoRule !== "off" && customerId && (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Photo or copy of the check{depositNeedsPhoto ? <span className="text-destructive"> *</span> : <span className="text-muted-foreground"> (optional)</span>}
                          {df.file && <span className="truncate max-w-[10rem] text-muted-foreground" data-testid="text-deposit-photo-name">· {df.file.name}</span>}</span>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => depositFileRef.current?.click()} data-testid="button-deposit-photo">{df.file ? "Change" : "Add"}</Button>
                        <input ref={depositFileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
                          onChange={(ev) => setDepositForm((f) => f && ({ ...f, file: ev.target.files?.[0] ?? null }))} data-testid="input-deposit-photo" />
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setDepositForm(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => recordDeposit.mutate()} data-testid="button-record-deposit"
                        disabled={recordDeposit.isPending || uploadingProof || !df.method || Math.round((parseFloat(df.amount) || 0) * 100) < 1 || (depositNeedsPhoto && !df.file)}>
                        {(recordDeposit.isPending || uploadingProof) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Record deposit
                      </Button>
                    </div>
                  </div>
                ); })() : (
                  <button type="button" className="text-xs text-primary hover:underline" data-testid={`button-record-deposit-open-${e.id}`}
                    onClick={() => setDepositForm({ estimateId: e.id, amount: ((e.depositCents ?? 0) / 100).toFixed(2), method: "", paidOn: todayLocal(), note: "", file: null })}>
                    Already received this deposit by check, cash or wire? Record it
                  </button>
                )}
              </div>
            ))}
            {onlineOff && <p className="text-xs text-muted-foreground">{ONLINE_OFF_TEXT}</p>}
          </div>
        )}

        {!inv ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="take-payment-no-invoices">
              No open invoices for {customerName}.{signed.length ? " Bill the signed estimate below — in full, a percentage or a set amount — then take the payment." : " Create one below, then take the payment."}
            </p>
            {invoiceForm}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Invoice</Label>
                {!newInvOpen && (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setNewInvOpen(true)} data-testid="button-new-invoice-toggle">
                    + New invoice
                  </button>
                )}
              </div>
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
            {newInvOpen && invoiceForm}

            {/* Rail 1: online — hosted Stripe Checkout on the contractor's account. */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Online — card or bank (ACH)
              </div>
              <p className="text-xs text-muted-foreground">
                A secure Stripe link for {money(due)}. The client pays by card or straight from
                their bank; money lands in your connected Stripe account.
                {cardFeeBps && (
                  <> Your {feePct(cardFeeBps)} card fee applies to card links only: {money(quoteFor(due)?.totalCents ?? due)} by card, {money(due)} by bank.</>
                )}
              </p>
              {link ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input readOnly value={link} className="text-xs" data-testid="input-checkout-link"
                      onFocus={(e) => e.target.select()} />
                    <Button size="sm" variant="outline" data-testid="button-copy-checkout-result"
                      onClick={async () => {
                        const copied = await copyText(link);
                        if (copied) setLinkCopied(true);
                        toast(copied
                          ? { title: "Copied" }
                          : { title: "Copy failed", description: "Select the link and copy it by hand.", variant: "destructive" });
                      }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={link} target="_blank" rel="noopener noreferrer" data-testid="link-open-checkout">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {linkCopied ? "Copied to your clipboard. " : ""}The link expires after the client pays or abandons it.
                  </p>
                </div>
              ) : onlineOff ? (
                <p className="text-xs font-medium" data-testid="text-online-links-off">{ONLINE_OFF_TEXT}</p>
              ) : cardFeeBps ? (
                <div className="flex flex-wrap gap-2">
                  {achOffered && (
                    <Button size="sm" variant="default" onClick={() => makeLink.mutate("ach")}
                      disabled={makeLink.isPending} data-testid="button-create-checkout-link-ach">
                      {makeLink.isPending && makeLink.variables === "ach" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Landmark className="h-4 w-4 mr-2" />}
                      Bank link — no fee
                    </Button>
                  )}
                  <Button size="sm" variant={achOffered ? "outline" : "default"} onClick={() => setFeeConfirm({ kind: "invoice" })}
                    disabled={makeLink.isPending} data-testid="button-create-checkout-link-card">
                    <Link2 className="h-4 w-4 mr-2" />
                    Card link — adds {feePct(cardFeeBps)}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="default" onClick={() => makeLink.mutate(undefined)}
                  disabled={makeLink.isPending} data-testid="button-create-checkout-link">
                  {makeLink.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                  Create payment link
                </Button>
              )}
            </div>

            <Separator />

            {/* Rail 2: manual — money already in hand. The payment type is required so every dollar is tracked. */}
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
                  <Label>Payment type <span className="text-destructive">*</span></Label>
                  <MethodSelect value={method} onChange={setMethod} testId="select-take-method" />
                </div>
              </div>
              {cardFeeBps && (method === "credit_card" || method === "card") && (
                <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2" data-testid="text-manual-card-fee">
                  Your {feePct(cardFeeBps)} card fee: on {money(amountCents)} that is {money(quoteFor(amountCents)?.feeCents ?? 0)} more,
                  {" "}{money(quoteFor(amountCents)?.totalCents ?? amountCents)} total. Tell the client before you charge the card, and record the
                  invoice amount here — the fee is not part of what the invoice is owed.
                </p>
              )}
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
              disabled={amountCents < 1 || !method || recordManual.isPending}
              title={!method ? "Pick the payment type first" : undefined}
              data-testid="button-record-manual-payment">
              {recordManual.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record {amountCents >= 1 ? money(amountCents) : "payment"}
            </Button>
          </DialogFooter>
        )}

        {/* The staff-side fee disclosure: what to tell the client before a card link goes out. */}
        {feeConfirm && (() => {
          const base = feeConfirm.kind === "invoice" ? due : feeConfirm.amountCents;
          const quote = quoteFor(base);
          if (!quote) return null;
          const pending = feeConfirm.kind === "invoice" ? makeLink.isPending : makeDepositLink.isPending;
          const go = (m: "card" | "ach") => feeConfirm.kind === "invoice"
            ? makeLink.mutate(m)
            : makeDepositLink.mutate({ estimateId: feeConfirm.estimateId, method: m });
          return (
            <CardFeeConfirm
              open onOpenChange={(o) => { if (!o) setFeeConfirm(null); }}
              audience="staff" amountCents={base} quote={quote} achAvailable={achOffered} pending={pending}
              onCard={() => go("card")} onBank={() => go("ach")}
            />
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
