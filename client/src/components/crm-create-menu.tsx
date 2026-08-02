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
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  FileText, ReceiptText, UserPlus, MessageSquare, Users, Loader2, Mail, Phone,
} from "lucide-react";

/**
 * The global Create menu — one button in the CRM shell (sidebar header and
 * the mobile ribbon's More sheet) opening Estimate / Invoice / Lead /
 * Message / Customer. Each item takes the shortest honest path:
 *
 *   - Estimate → /crm/estimates/new (the existing flow).
 *   - Invoice  → pick a client; a draft invoice is created via the existing
 *     POST /api/crm/invoices and you land on the client page to finish it.
 *   - Lead     → a small dialog that creates the client (dedupe idiom) plus a
 *     project in the FIRST pipeline stage ("lead") — there is no lead entity
 *     by design (brain doc §3), the pipeline's first swimlane IS the lead list.
 *   - Message  → quick-message composer: email always works; the Text channel
 *     is grayed out with a pointer to Settings → Integrations when SMS isn't
 *     configured — never a clickable dead button.
 *   - Customer → the same small client dialog (portal auto-created).
 */

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
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Name *</Label>
        <Input id={`${idPrefix}-name`} data-testid={`input-${idPrefix}-name`} value={form.displayName}
          placeholder="Joe & Mary Kane"
          onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input id={`${idPrefix}-email`} type="email" data-testid={`input-${idPrefix}-email`} value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
        <Input id={`${idPrefix}-phone`} data-testid={`input-${idPrefix}-phone`} value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-addr`}>Address</Label>
        <Input id={`${idPrefix}-addr`} data-testid={`input-${idPrefix}-addr`} value={form.addressLine1}
          onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
      </div>
      {showNote && (
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-note`}>Note</Label>
          <Textarea id={`${idPrefix}-note`} rows={3} data-testid={`input-${idPrefix}-note`} value={form.note}
            placeholder="Where's the leak? What did they ask for?"
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/** The dedupe idiom: a 409 names the existing client(s) — link, don't force. */
function DupeError({ error }: { error: any }) {
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
        <Link key={m.id} href={`/crm/clients/${m.id}`}
          data-testid={`link-dupe-client-${m.id}`}
          className="block text-primary hover:underline font-medium">
          Open {m.displayName} →
        </Link>
      ))}
    </div>
  );
}

function CustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [dupe, setDupe] = useState<any>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        notes: form.note.trim() || null,
      };
      if (!body.displayName) throw new Error("A client name is required");
      return (await apiRequest("POST", "/api/crm/customers", body)).json();
    },
    onSuccess: (c: any) => {
      onOpenChange(false);
      setForm({ ...EMPTY_CLIENT });
      setDupe(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client created", description: "Their portal was created automatically." });
      navigate(`/crm/clients/${c.id}`);
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").includes("409")) { setDupe(e); return; }
      toast({ title: "Could not create client", description: String(e.message ?? e), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setDupe(null); }}>
      <DialogContent data-testid="dialog-create-customer">
        <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
        <ClientFields form={form} setForm={setForm} idPrefix="customer" />
        {dupe && <DupeError error={dupe} />}
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-save-customer">
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [dupe, setDupe] = useState<any>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        notes: form.note.trim() || null,
      };
      if (!body.displayName) throw new Error("A name is required");
      const customer = await (await apiRequest("POST", "/api/crm/customers", body)).json();
      // A lead IS a project in the first pipeline stage — no separate entity.
      const project = await (await apiRequest("POST", "/api/crm/projects", {
        customerId: customer.id,
        name: `${body.displayName} — lead`,
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
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").includes("409")) { setDupe(e); return; }
      toast({ title: "Could not create lead", description: String(e.message ?? e), variant: "destructive" });
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
        {dupe && <DupeError error={dupe} />}
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

function InvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [client, setClient] = useState<ClientLite | null>(null);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/invoices", {
        customerId: client!.id,
        title: title.trim() || "Invoice",
      })).json(),
    onSuccess: (inv: any) => {
      onOpenChange(false);
      setClient(null);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/crm/invoices"] });
      toast({ title: `Draft ${inv.number ?? "invoice"} created`, description: "Add line items, then send it from the client page." });
      navigate(`/crm/clients/${client!.id}`);
    },
    onError: (e: any) => toast({ title: "Could not create invoice", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-invoice">
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <ClientPicker value={client} onChange={setClient} />
        {client && (
          <div>
            <Label htmlFor="inv-title">Title</Label>
            <Input id="inv-title" data-testid="input-invoice-title" value={title}
              placeholder="Invoice" onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={!client || create.isPending}
            data-testid="button-save-invoice">
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create draft invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Message ─────────────────────────────────────────────────────────────────

function MessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [client, setClient] = useState<ClientLite | null>(null);
  const [channel, setChannel] = useState<"email" | "text">("email");
  const [body, setBody] = useState("");

  const { data: smsStatus } = useQuery<any>({ queryKey: ["/api/crm/sms/status"] });
  const textingOn = smsStatus?.configured === true;

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
    onError: (e: any) => toast({ title: "Message not sent", description: String(e.message ?? e), variant: "destructive" }),
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
                  Texting is off — enable it in{" "}
                  <Link href="/crm/settings" data-testid="link-enable-texting"
                    className="text-primary hover:underline font-medium">
                    Settings → Integrations
                  </Link>
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

export function CrmCreateMenu({ trigger }: { trigger: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const perms = me?.permissions ?? {};

  const [customerOpen, setCustomerOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" data-testid="create-menu">
          {/* Estimate is ungated, like the ribbon's one-tap "New estimate". */}
          <DropdownMenuItem data-testid="create-item-estimate"
            onSelect={() => navigate("/crm/estimates/new")}>
            <FileText className="h-4 w-4 mr-2" /> Estimate
          </DropdownMenuItem>
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

      <CustomerDialog open={customerOpen} onOpenChange={setCustomerOpen} />
      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} />
      <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} />
      <MessageDialog open={messageOpen} onOpenChange={setMessageOpen} />
    </>
  );
}
