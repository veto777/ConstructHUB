import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { parseDollarInput, dollarInputError } from "@/lib/dollar-input";
import {
  FileText, ReceiptText, UserPlus, MessageSquare, Users, Loader2, Mail, Phone,
} from "lucide-react";

/**
 * The global Create menu — one button in the CRM shell (sidebar header and
 * the mobile ribbon's More sheet) opening Estimate / Invoice / Lead /
 * Message / Customer. Each item takes the shortest honest path:
 *
 *   - Estimate → /crm/estimates/new (the existing flow).
 *   - Invoice  → pick a client, say what it's for and the amount; a draft
 *     invoice with that one line is created via POST /api/crm/invoices and
 *     you land on the client page to send it.
 *   - Lead     → a small dialog that creates the client (dedupe idiom) plus a
 *     project in the FIRST pipeline stage ("lead") — there is no lead entity
 *     by design (brain doc §3), the pipeline's first swimlane IS the lead list.
 *   - Message  → quick-message composer: email always works; the Text channel
 *     is grayed out with a pointer to Settings → SMS when SMS isn't
 *     configured — never a clickable dead button.
 *   - Customer → the same small client dialog (portal auto-created).
 *
 * `onNavigate` fires whenever an action leaves the page (a link, or a dialog
 * that lands you somewhere) so a host sheet — the ribbon's More sheet, the
 * phone sidebar — can close instead of covering the page it just opened.
 */

type OnNavigate = (() => void) | undefined;

// Same shape the server's zod .email() accepts, checked before the round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A typed-but-malformed email (blank is fine — email is optional). */
const emailInvalid = (email: string) => email.trim() !== "" && !EMAIL_RE.test(email.trim());

/**
 * A create call's error as a sentence. A 400 carries zod `issues` — name the
 * field ("Enter a valid email address.") instead of "Invalid customer".
 */
function createErrorMessage(e: any): string {
  try {
    const body = JSON.parse(String(e?.message ?? "").replace(/^\d{3}:\s*/, ""));
    const fields: string[] = (body?.issues ?? []).map((i: any) => String(i?.path?.[0] ?? ""));
    if (fields.includes("email")) return "Enter a valid email address.";
    if (fields.includes("phone")) return "That phone number is too long.";
    if (fields.includes("displayName")) return "Enter a name (up to 200 characters).";
  } catch { /* not JSON — fall through */ }
  return apiErrorMessage(e);
}

const money = (c?: number | null) =>
  c == null ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

type ClientLite = {
  id: string; displayName: string; email: string | null; phone: string | null;
};

/** Search-pick a client — shared by the Invoice and Message dialogs. */
function ClientPicker({ value, onChange }: {
  value: ClientLite | null;
  onChange: (c: ClientLite | null) => void;
}) {
  const [q, setQ] = useState("");
  const { data: clients } = useQuery<ClientLite[]>({
    queryKey: ["/api/crm/customers", q ? `?q=${encodeURIComponent(q)}` : ""],
    queryFn: async () => {
      const r = await fetch(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-3 py-2"
        data-testid="picked-client">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{value.displayName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {[value.email, value.phone].filter(Boolean).join(" · ") || "No contact details"}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}
          data-testid="button-change-client">Change</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input placeholder="Search clients by name, email or phone"
        value={q} onChange={(e) => setQ(e.target.value)}
        data-testid="input-message-client-search" />
      <div className="max-h-48 overflow-y-auto rounded-lg border divide-y" data-testid="client-pick-list">
        {(clients ?? []).slice(0, 25).map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(c)}
            data-testid={`pick-client-${c.id}`}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent transition-colors">
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{c.displayName}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
              </span>
            </span>
          </button>
        ))}
        {clients && clients.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground">No clients match.</div>
        )}
      </div>
    </div>
  );
}

// ── Customer / Lead ─────────────────────────────────────────────────────────

const EMPTY_CLIENT = { displayName: "", email: "", phone: "", addressLine1: "", note: "" };

function ClientFields({ form, setForm, idPrefix, showNote }: {
  form: typeof EMPTY_CLIENT;
  setForm: (f: typeof EMPTY_CLIENT) => void;
  idPrefix: string;
  showNote?: boolean;
}) {
  // Flag a malformed email once they've left the field, not mid-typing.
  const [emailTouched, setEmailTouched] = useState(false);
  const badEmail = emailTouched && emailInvalid(form.email);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Name *</Label>
        <Input id={`${idPrefix}-name`} data-testid={`input-${idPrefix}-name`} value={form.displayName}
          placeholder="Joe & Mary Kane" maxLength={200}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input id={`${idPrefix}-email`} type="email" data-testid={`input-${idPrefix}-email`} value={form.email}
          aria-invalid={badEmail || undefined} onBlur={() => setEmailTouched(true)}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        {badEmail && (
          <p className="mt-1 text-xs text-destructive" data-testid={`error-${idPrefix}-email`}>
            Enter a valid email address, like joe@example.com.
          </p>
        )}
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
        <Input id={`${idPrefix}-phone`} data-testid={`input-${idPrefix}-phone`} value={form.phone}
          maxLength={40} inputMode="tel"
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-addr`}>Address</Label>
        <Input id={`${idPrefix}-addr`} data-testid={`input-${idPrefix}-addr`} value={form.addressLine1}
          maxLength={200}
          onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
      </div>
      {showNote && (
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-note`}>Note</Label>
          <Textarea id={`${idPrefix}-note`} rows={3} data-testid={`input-${idPrefix}-note`} value={form.note}
            placeholder="Where's the leak? What did they ask for?" maxLength={20000}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/** The dedupe idiom: a 409 names the existing client(s) — link, don't force.
 *  Following a link closes the dialog (it would otherwise stay on top). */
function DupeError({ error, onOpen }: { error: any; onOpen: () => void }) {
  let matches: { id: string; displayName: string }[] = [];
  try {
    // apiRequest errors read "409: {json}" — strip the status prefix.
    const parsed = JSON.parse(String(error?.message ?? "").replace(/^\d+:\s*/, ""));
    matches = parsed?.matches ?? [];
  } catch { /* not a dupe error — render the plain message below */ }
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
      data-testid="dupe-error">
      A client with that email or phone already exists.
      {matches.map((m) => (
        <Link key={m.id} href={`/crm/clients/${m.id}`} onClick={onOpen}
          data-testid={`link-dupe-client-${m.id}`}
          className="block text-primary hover:underline font-medium">
          Open {m.displayName} →
        </Link>
      ))}
    </div>
  );
}

/** The shared create-client body; throws a readable error before the POST. */
function clientBody(form: typeof EMPTY_CLIENT, nameRequired: string) {
  const body: any = {
    displayName: form.displayName.trim(),
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    addressLine1: form.addressLine1.trim() || null,
    notes: form.note.trim() || null,
  };
  if (!body.displayName) throw new Error(nameRequired);
  if (body.email && !EMAIL_RE.test(body.email)) throw new Error("Enter a valid email address.");
  return body;
}

function CustomerDialog({ open, onOpenChange, onNavigate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onNavigate: OnNavigate;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [dupe, setDupe] = useState<any>(null);

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/customers", clientBody(form, "A client name is required."))).json(),
    onSuccess: (c: any) => {
      onOpenChange(false);
      setForm({ ...EMPTY_CLIENT });
      setDupe(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client created", description: "Their portal was created automatically." });
      navigate(`/crm/clients/${c.id}`);
      onNavigate?.();
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").startsWith("409")) { setDupe(e); return; }
      toast({ title: "Could not create client", description: createErrorMessage(e), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setDupe(null); }}>
      <DialogContent data-testid="dialog-create-customer">
        <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
        <ClientFields form={form} setForm={setForm} idPrefix="customer" />
        {dupe && (
          <DupeError error={dupe}
            onOpen={() => { onOpenChange(false); setDupe(null); onNavigate?.(); }} />
        )}
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-save-customer">
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadDialog({ open, onOpenChange, onNavigate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onNavigate: OnNavigate;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [dupe, setDupe] = useState<any>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body = clientBody(form, "A name is required.");
      const customer = await (await apiRequest("POST", "/api/crm/customers", body)).json();
      // A lead IS a project in the first pipeline stage — no separate entity.
      // (Project names cap at 200 characters, like client names.)
      const project = await (await apiRequest("POST", "/api/crm/projects", {
        customerId: customer.id,
        name: `${body.displayName.slice(0, 193)} — lead`,
        status: "lead",
        addressLine1: body.addressLine1,
      })).json();
      return { customer, project };
    },
    onSuccess: ({ project }: any) => {
      onOpenChange(false);
      setForm({ ...EMPTY_CLIENT });
      setDupe(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      toast({ title: "Lead added", description: "It's on the pipeline in the Lead column." });
      navigate("/crm/pipeline");
      onNavigate?.();
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").startsWith("409")) { setDupe(e); return; }
      toast({ title: "Could not create lead", description: createErrorMessage(e), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setDupe(null); }}>
      <DialogContent data-testid="dialog-create-lead">
        <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Lands on the pipeline in the Lead column — ready to estimate.
        </p>
        <ClientFields form={form} setForm={setForm} idPrefix="lead" showNote />
        {dupe && (
          <DupeError error={dupe}
            onOpen={() => { onOpenChange(false); setDupe(null); onNavigate?.(); }} />
        )}
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-save-lead">
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invoice ─────────────────────────────────────────────────────────────────

/**
 * A quick invoice is ONE line: what it's for + the amount. There is no draft
 * line-item editor after creation (the draft card offers Send / Copy / Void),
 * so the dialog collects the line up front rather than creating a $0.00 draft
 * with a promise to "add line items" later. Itemized invoices come from an
 * approved estimate.
 */
function InvoiceDialog({ open, onOpenChange, onNavigate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onNavigate: OnNavigate;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [client, setClient] = useState<ClientLite | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const cents = parseDollarInput(amount);
  const amountError = amount.trim() ? dollarInputError(amount) : null;
  const ready = !!client && title.trim().length > 0 && cents !== null && !Number.isNaN(cents) && cents > 0;

  const reset = () => { setClient(null); setTitle(""); setAmount(""); };

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/invoices", {
        customerId: client!.id,
        title: title.trim(),
        items: [{ name: title.trim(), quantityMilli: 1000, unitPriceCents: cents }],
      })).json(),
    onSuccess: (inv: any) => {
      const customerId = client!.id;
      onOpenChange(false);
      reset();
      // Every invoice list key starts with this path — the client page's is
      // `/api/crm/invoices?customerId=…`, a different first element.
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/crm/invoices"),
      });
      toast({
        title: `Draft ${inv.number ?? "invoice"} created${inv.totalCents != null ? ` — ${money(inv.totalCents)}` : ""}`,
        description: "Review it and send it from the client page.",
      });
      navigate(`/crm/clients/${customerId}`);
      onNavigate?.();
    },
    onError: (e: any) => toast({ title: "Could not create invoice", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-invoice">
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <ClientPicker value={client} onChange={setClient} />
        {client && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="inv-title">What's it for? *</Label>
              <Input id="inv-title" data-testid="input-invoice-title" value={title} maxLength={200}
                placeholder="Gutter repair — labor and materials" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="inv-amount">Amount *</Label>
              <Input id="inv-amount" data-testid="input-invoice-amount" value={amount} inputMode="decimal"
                placeholder="$1,250" aria-invalid={!!amountError || undefined}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            {amountError && (
              <p className="sm:col-span-3 -mt-1 text-xs text-destructive" data-testid="error-invoice-amount">
                {amountError}
              </p>
            )}
            <p className="sm:col-span-3 text-xs text-muted-foreground">
              One line, no tax. For an itemized invoice, invoice an approved estimate from the client page.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}
            data-testid="button-save-invoice">
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create draft invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Message ─────────────────────────────────────────────────────────────────

function MessageDialog({ open, onOpenChange, onNavigate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onNavigate: OnNavigate;
}) {
  const { toast } = useToast();
  // The Settings links leave the page — close this dialog (and any host sheet).
  const leave = () => { onOpenChange(false); onNavigate?.(); };
  const [client, setClient] = useState<ClientLite | null>(null);
  const [channel, setChannel] = useState<"email" | "text">("email");
  const [body, setBody] = useState("");

  const { data: smsStatus } = useQuery<any>({ queryKey: ["/api/crm/sms/status"] });
  // Client texting needs the org's OWN registered number — the shared
  // platform number only texts the team (contractor notifications).
  const textingOn = smsStatus?.configured === true && smsStatus?.canTextClients !== false;

  const send = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/messages", {
        customerId: client!.id, channel, body: body.trim(),
      })).json(),
    onSuccess: () => {
      onOpenChange(false);
      setBody("");
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${client!.id}/timeline`] });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${client!.id}/notes`] });
      toast({ title: channel === "email" ? "Email sent" : "Text sent", description: `It's on ${client!.displayName}'s timeline.` });
    },
    onError: (e: any) => toast({ title: "Message not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const noEmail = client != null && !client.email;
  const noPhone = client != null && !client.phone;
  const canSend = !!client && body.trim().length > 0 &&
    (channel === "email" ? !noEmail : textingOn && !noPhone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-quick-message">
        <DialogHeader><DialogTitle>Quick message</DialogTitle></DialogHeader>
        <ClientPicker value={client} onChange={setClient} />

        {client && (
          <>
            {/* Channel picker — Text is grayed out with the way to turn it on
                when SMS isn't configured. Never a dead button. */}
            <div className="space-y-2">
              <Label>Send via</Label>
              <div className="grid grid-cols-2 gap-2" data-testid="channel-picker">
                <button type="button" onClick={() => setChannel("email")}
                  data-testid="channel-email"
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    channel === "email" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                  <Mail className="h-4 w-4 shrink-0" /> Email
                </button>
                <button type="button"
                  onClick={() => textingOn && setChannel("text")}
                  disabled={!textingOn}
                  data-testid="channel-text"
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    !textingOn
                      ? "cursor-not-allowed opacity-50 bg-muted/40 text-muted-foreground"
                      : channel === "text" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                  <Phone className="h-4 w-4 shrink-0" /> Text
                </button>
              </div>
              {!textingOn && (
                <p className="text-xs text-muted-foreground" data-testid="text-texting-off-hint">
                  {smsStatus?.configured && smsStatus?.canTextClients === false ? (
                    <>
                      Texting clients needs a client-texting number — set one up in{" "}
                      <Link href="/crm/settings#sms" data-testid="link-enable-texting" onClick={leave}
                        className="text-primary hover:underline font-medium">
                        Settings → SMS
                      </Link>.
                    </>
                  ) : (
                    <>
                      Texting is off — enable it in{" "}
                      <Link href="/crm/settings#sms" data-testid="link-enable-texting" onClick={leave}
                        className="text-primary hover:underline font-medium">
                        Settings → SMS
                      </Link>
                    </>
                  )}
                </p>
              )}
              {channel === "email" && noEmail && (
                <p className="text-xs text-muted-foreground" data-testid="text-no-email-hint">
                  This client has no email address — add one on their client page first.
                </p>
              )}
              {channel === "text" && noPhone && (
                <p className="text-xs text-muted-foreground" data-testid="text-no-phone-hint">
                  This client has no phone number — add one on their client page first.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="qm-body">Message</Label>
              <Textarea id="qm-body" rows={4} data-testid="input-message-body" value={body}
                placeholder="Hi Joe — we're running about 30 minutes late today."
                onChange={(e) => setBody(e.target.value)} />
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={() => send.mutate()} disabled={!canSend || send.isPending}
            data-testid="button-send-message">
            {send.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send {channel === "email" ? "email" : "text"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The menu ────────────────────────────────────────────────────────────────

export function CrmCreateMenu({ trigger, onNavigate }: {
  trigger: React.ReactNode;
  /** Called after any Create action navigates away (close a host sheet). */
  onNavigate?: () => void;
}) {
  const [, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const perms = me?.permissions ?? {};

  const [customerOpen, setCustomerOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);

  // A seat that can create nothing (a field crew by default) gets no Create button at all.
  const canCreateAnything = perms.manageEstimates === true || perms.manageInvoices === true || perms.manageCustomers === true;
  if (me && !canCreateAnything) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" data-testid="create-menu">
          {/* Each entry needs the permission its API route enforces — nothing here leads to a refusal. */}
          {perms.manageEstimates === true && (
            <DropdownMenuItem data-testid="create-item-estimate"
              onSelect={() => { navigate("/crm/estimates/new"); onNavigate?.(); }}>
              <FileText className="h-4 w-4 mr-2" /> Estimate
            </DropdownMenuItem>
          )}
          {perms.manageInvoices === true && (
            <DropdownMenuItem data-testid="create-item-invoice" onSelect={() => setInvoiceOpen(true)}>
              <ReceiptText className="h-4 w-4 mr-2" /> Invoice
            </DropdownMenuItem>
          )}
          {perms.manageCustomers === true && perms.manageJobs === true && (
            <DropdownMenuItem data-testid="create-item-lead" onSelect={() => setLeadOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Lead
            </DropdownMenuItem>
          )}
          {perms.manageCustomers === true && (
            <DropdownMenuItem data-testid="create-item-message" onSelect={() => setMessageOpen(true)}>
              <MessageSquare className="h-4 w-4 mr-2" /> Message
            </DropdownMenuItem>
          )}
          {perms.manageCustomers === true && (
            <DropdownMenuItem data-testid="create-item-customer" onSelect={() => setCustomerOpen(true)}>
              <Users className="h-4 w-4 mr-2" /> Customer
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomerDialog open={customerOpen} onOpenChange={setCustomerOpen} onNavigate={onNavigate} />
      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} onNavigate={onNavigate} />
      <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} onNavigate={onNavigate} />
      <MessageDialog open={messageOpen} onOpenChange={setMessageOpen} onNavigate={onNavigate} />
    </>
  );
}
