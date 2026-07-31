import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Plus, Loader2, Send, Eye, CheckCircle2, XCircle, Copy,
  FileText, Trash2, Receipt, Landmark, Clock, Layers, Ban, Mail, Phone, MapPin,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, InitialAvatar, SectionTitle, statusTone,
} from "@/components/crm-ui";
import { EstimateEngagement } from "@/components/crm-engagement";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : null);

interface Item {
  kind: string; name: string; description?: string | null;
  quantityMilli: number; unit?: string | null; unitPriceCents: number;
  taxable: boolean; hiddenFromClient: boolean;
}

const BLANK: Item = {
  kind: "labor", name: "", description: "", quantityMilli: 1000,
  unit: "", unitPriceCents: 0, taxable: true, hiddenFromClient: false,
};

/**
 * Good / better / best tiers for one estimate. Options are presentation-only
 * (the priced line items stay canonical); they render on the client's public
 * page. showTotal defaults off — Leap leaked tier pricing up front and it
 * scared clients off before they read the scope.
 */
function EstimateOptionsDialog({ estimate, open, onOpenChange }: {
  estimate: any; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: options, isLoading } = useQuery<any[]>({
    queryKey: [`/api/crm/estimates/${estimate.id}/options`],
    enabled: open,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [showTotal, setShowTotal] = useState(false);

  const add = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/estimates/${estimate.id}/options`, {
        name,
        tier: (options?.length ?? 0) + 1,
        description: description || null,
        totalCents: Math.round((parseFloat(total) || 0) * 100),
        recommended,
        showTotal,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${estimate.id}/options`] });
      setName(""); setDescription(""); setTotal(""); setRecommended(false); setShowTotal(false);
      toast({ title: "Option added", description: "It appears on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Could not add option", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Good / better / best — {estimate.number}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !options?.length ? (
          <p className="text-sm text-muted-foreground">
            No options yet. Add two or three and the client picks between them on their estimate page.
          </p>
        ) : (
          <div className="space-y-2">
            {options.map((o: any) => (
              <div key={o.id} className="border rounded-md p-3 flex flex-wrap items-center justify-between gap-2"
                data-testid={`option-${o.id}`}>
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {o.name}
                    {o.recommended && <Badge className="text-[10px]">recommended</Badge>}
                  </div>
                  {o.description && <div className="text-sm text-muted-foreground truncate">{o.description}</div>}
                </div>
                {o.totalCents != null && (
                  <div className="font-medium">{money(o.totalCents)}{!o.showTotal && <span className="text-xs text-muted-foreground"> · hidden from client</span>}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <Separator />
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="opt-name">Option name *</Label>
              <Input id="opt-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder={["Good", "Better", "Best"][(options?.length ?? 0)] ?? "Premium"}
                data-testid="input-option-name" />
            </div>
            <div>
              <Label htmlFor="opt-total">Total $</Label>
              <Input id="opt-total" type="number" step="0.01" value={total}
                onChange={(e) => setTotal(e.target.value)} data-testid="input-option-total" />
            </div>
          </div>
          <div>
            <Label htmlFor="opt-desc">Description (optional)</Label>
            <Textarea id="opt-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="30-year architectural shingles, standard underlayment" />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={recommended} onCheckedChange={(c) => setRecommended(c === true)}
                data-testid="check-option-recommended" />
              Recommended
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showTotal} onCheckedChange={(c) => setShowTotal(c === true)}
                data-testid="check-option-show-total" />
              Show the total to the client
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}
            data-testid="button-save-option">
            {add.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add option
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CrmClientPage() {
  const [, params] = useRoute("/crm/clients/:id");
  const id = params?.id;
  const { toast } = useToast();

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canEstimate = me?.permissions?.manageEstimates === true;
  const canSeePrices = me?.permissions?.seePrices === true;
  const canInvoice = me?.permissions?.manageInvoices === true;
  const canTakePayment = me?.permissions?.takePayment === true;
  const canManageJobs = me?.permissions?.manageJobs === true;

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: [`/api/crm/customers/${id}`],
    enabled: !!id,
  });

  const { data: invoices, isError: invoicesError } = useQuery<any[]>({
    queryKey: [`/api/crm/invoices?customerId=${id}`],
    enabled: !!id && canSeePrices,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/crm/invoices?customerId=${id}`] });
  };

  // ── New project ───────────────────────────────────────────────────────────
  const [projOpen, setProjOpen] = useState(false);
  const [projName, setProjName] = useState("");
  const createProject = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/projects", { customerId: id, name: projName })).json(),
    onSuccess: () => {
      setProjOpen(false); setProjName("");
      refresh();
      toast({ title: "Project created" });
    },
    onError: (e: any) => toast({ title: "Could not create project", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Estimate options (good / better / best) ───────────────────────────────
  const [optsFor, setOptsFor] = useState<any | null>(null);

  // ── Invoices ──────────────────────────────────────────────────────────────
  const convert = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/invoice`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Invoice created from the approved estimate" }); },
    onError: (e: any) => toast({ title: "Could not convert", description: String(e.message ?? e), variant: "destructive" }),
  });

  const sendInvoice = useMutation({
    mutationFn: async (invoiceId: string) =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/send`, {})).json(),
    onSuccess: (r: any) => {
      refresh();
      if (r.emailed) {
        toast({ title: "Invoice sent" });
      } else {
        navigator.clipboard?.writeText(window.location.origin + r.link);
        toast({ title: "Email failed — payment link copied", description: "Send it to your client directly.", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });

  const [payFor, setPayFor] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("check");
  const [payNote, setPayNote] = useState("");
  const recordPayment = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${payFor.id}/payments`, {
        amountCents: Math.round((parseFloat(payAmount) || 0) * 100),
        method: payMethod,
        note: payNote || null,
      })).json(),
    onSuccess: () => {
      setPayFor(null); setPayAmount(""); setPayNote("");
      refresh();
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: String(e.message ?? e), variant: "destructive" }),
  });

  const voidInvoice = useMutation({
    mutationFn: async (invoiceId: string) =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/void`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Invoice voided" }); },
    onError: (e: any) => toast({ title: "Could not void", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Estimate builder ──────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Estimate");
  const [intro, setIntro] = useState("");
  const [taxPct, setTaxPct] = useState("0");
  const [items, setItems] = useState<Item[]>([{ ...BLANK }]);

  const subtotal = items.reduce(
    (s, i) => s + (i.kind === "discount" ? 0 : Math.round((i.unitPriceCents * i.quantityMilli) / 1000)), 0);
  const discount = items.reduce(
    (s, i) => s + (i.kind === "discount" ? Math.round((i.unitPriceCents * i.quantityMilli) / 1000) : 0), 0);
  const taxBps = Math.round(parseFloat(taxPct || "0") * 100);
  const tax = Math.round((Math.max(0, subtotal - discount) * taxBps) / 10000);
  const total = Math.max(0, subtotal - discount + tax);

  const createEstimate = useMutation({
    mutationFn: async () => {
      const clean = items.filter((i) => i.name.trim());
      if (!clean.length) throw new Error("Add at least one line item");
      return (await apiRequest("POST", "/api/crm/estimates", {
        customerId: id, title, introText: intro || null, taxRateBps: taxBps,
        items: clean.map((i, idx) => ({ ...i, sortOrder: idx, description: i.description || null, unit: i.unit || null })),
      })).json();
    },
    onSuccess: () => {
      setOpen(false);
      setItems([{ ...BLANK }]); setIntro(""); setTitle("Estimate"); setTaxPct("0");
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
      toast({ title: "Estimate created" });
    },
    onError: (e: any) => toast({ title: "Could not create estimate", description: String(e.message ?? e), variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/send`, {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
      if (r.emailed) {
        toast({ title: "Estimate sent", description: `Emailed to ${r.estimate?.sentToEmail ?? "the client"}.` });
      } else {
        navigator.clipboard?.writeText(window.location.origin + r.link);
        toast({
          title: "Email failed — link copied",
          description: "Send this link to your client directly.",
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return (
      <ErrorCard
        title={isError ? "Couldn't load this client" : "Client not found"}
        description={isError ? "Check your connection and refresh the page." : "This client may have been removed."}
      >
        <Link href="/crm/clients">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> All clients</Button>
        </Link>
      </ErrorCard>
    );
  }

  const c = data.customer;
  const estimates = data.estimates ?? [];

  return (
    <CrmPage>
      <Link href="/crm/clients">
        <Button variant="ghost" size="sm" className="-ml-2" data-testid="link-back-clients">
          <ArrowLeft className="h-4 w-4 mr-1" /> All clients
        </Button>
      </Link>

      {/* Identity card: who this is and how to reach them. */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <InitialAvatar name={c.displayName} className="h-14 w-14 text-lg" />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
                {c.companyName && <div className="text-sm text-muted-foreground mt-0.5">{c.companyName}</div>}
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                  {c.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{c.email}</span>}
                  {c.phone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{c.phone}</span>}
                  {(c.addressLine1 || c.city) && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {[c.addressLine1, c.city, c.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {data.portalPath && (
              <Button variant="outline" size="sm" data-testid="button-copy-portal"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.origin + data.portalPath);
                  toast({ title: "Client portal link copied" });
                }}>
                <Copy className="h-4 w-4 mr-2" /> Copy portal link
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <SectionTitle
            icon={FileText}
            title="Estimates"
            description="You'll see exactly when the client opens one."
          />
          {canEstimate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-estimate"><Plus className="h-4 w-4 mr-2" /> New estimate</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                <DialogHeader><DialogTitle>New estimate for {c.displayName}</DialogTitle></DialogHeader>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="e-title">Title</Label>
                    <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)}
                      data-testid="input-estimate-title" />
                  </div>
                  <div>
                    <Label htmlFor="e-tax">Tax %</Label>
                    <Input id="e-tax" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="e-intro">Message to the client</Label>
                  <Textarea id="e-intro" rows={2} value={intro} onChange={(e) => setIntro(e.target.value)}
                    placeholder="Thanks for having us out — here's the scope we discussed." />
                </div>

                <Separator />
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={idx} className="grid gap-2 sm:grid-cols-12 items-end border rounded-md p-2"
                      data-testid={`line-item-${idx}`}>
                      <div className="sm:col-span-5">
                        <Label className="text-xs">Description</Label>
                        <Input value={it.name} placeholder="Tear off & dispose existing roof"
                          onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Qty</Label>
                        <Input type="number" step="0.01" value={it.quantityMilli / 1000}
                          onChange={(e) => setItems(items.map((x, i) => i === idx
                            ? { ...x, quantityMilli: Math.round((parseFloat(e.target.value) || 0) * 1000) } : x))} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Unit price</Label>
                        <Input type="number" step="0.01" value={(it.unitPriceCents / 100).toString()}
                          onChange={(e) => setItems(items.map((x, i) => i === idx
                            ? { ...x, unitPriceCents: Math.round((parseFloat(e.target.value) || 0) * 100) } : x))} />
                      </div>
                      <div className="sm:col-span-2 text-sm">
                        <Label className="text-xs">Line</Label>
                        <div className="h-9 flex items-center font-medium">
                          {money(Math.round((it.unitPriceCents * it.quantityMilli) / 1000))}
                        </div>
                      </div>
                      <div className="sm:col-span-1">
                        <Button variant="ghost" size="sm" data-testid={`button-remove-item-${idx}`}
                          onClick={() => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : [{ ...BLANK }])}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setItems([...items, { ...BLANK }])}
                    data-testid="button-add-item">
                    <Plus className="h-4 w-4 mr-2" /> Add line
                  </Button>
                </div>

                <div className="text-sm space-y-1 text-right">
                  <div>Subtotal <span className="font-medium ml-3">{money(subtotal)}</span></div>
                  {discount > 0 && <div>Discount <span className="font-medium ml-3">−{money(discount)}</span></div>}
                  <div>Tax <span className="font-medium ml-3">{money(tax)}</span></div>
                  <div className="text-lg font-bold">Total <span className="ml-3">{money(total)}</span></div>
                </div>

                <DialogFooter>
                  <Button onClick={() => createEstimate.mutate()} disabled={createEstimate.isPending}
                    data-testid="button-save-estimate">
                    {createEstimate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create estimate
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {!estimates.length && (
            <EmptyState
              compact
              icon={FileText}
              title="No estimates yet"
              description="Build one from a template or from scratch — the client approves it online."
            />
          )}
          {estimates.map((e: any) => (
            <div key={e.id} className="rounded-lg border p-4 space-y-2.5 hover:border-border/80 transition-colors" data-testid={`estimate-${e.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2.5">
                    {e.number} · {e.title}
                    <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                  </div>
                  {canSeePrices && (
                    <div className="text-sm text-muted-foreground mt-0.5 tabular-nums">{money(e.totalCents)}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => setOptsFor(e)}
                      data-testid={`button-options-${e.id}`}>
                      <Layers className="h-4 w-4 mr-2" /> Options
                    </Button>
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant={e.sentAt ? "outline" : "default"}
                      onClick={() => send.mutate(e.id)} disabled={send.isPending}
                      data-testid={`button-send-${e.id}`}>
                      {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      {e.sentAt ? "Resend" : "Send"}
                    </Button>
                  )}
                  {canInvoice && e.approvedAt && (
                    <Button size="sm" variant="outline"
                      onClick={() => convert.mutate(e.id)} disabled={convert.isPending}
                      data-testid={`button-convert-${e.id}`}>
                      {convert.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />}
                      Create invoice
                    </Button>
                  )}
                </div>
              </div>

              {/* The tracking strip — sent, opened, answered. */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {e.sentAt && <span className="flex items-center gap-1"><Send className="h-3 w-3" /> Sent {when(e.sentAt)}</span>}
                {e.firstViewedAt ? (
                  <span className="flex items-center gap-1 text-foreground font-medium">
                    <Eye className="h-3 w-3" /> Opened {when(e.firstViewedAt)}
                    {e.viewCount > 1 && ` · ${e.viewCount} views`}
                  </span>
                ) : e.sentAt ? (
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Not opened yet</span>
                ) : null}
                {e.approvedAt && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Approved {when(e.approvedAt)}
                    {e.signatureName && ` by ${e.signatureName}`}
                  </span>
                )}
                {e.declinedAt && (
                  <span className="flex items-center gap-1 text-destructive font-medium">
                    <XCircle className="h-3 w-3" /> Declined {when(e.declinedAt)}
                  </span>
                )}
              </div>

              {/* Engagement (visits/time) + expiry + Extend — self-contained. */}
              <EstimateEngagement estimate={e} canManage={canEstimate} onChanged={refresh} />
            </div>
          ))}
        </CardContent>
      </Card>

      {canSeePrices && (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={Receipt}
              title="Invoices"
              description="Send the link, take the payment online, or record a check."
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {invoicesError ? (
              <p className="text-sm text-destructive flex items-center gap-2">
                Couldn't load invoices — refresh to try again.
              </p>
            ) : !invoices?.length && (
              <EmptyState
                compact
                icon={Receipt}
                title="No invoices yet"
                description="Approve an estimate, then convert it — the client pays online."
              />
            )}
            {invoices?.map((inv: any) => {
              const due = Math.max(0, (inv.totalCents ?? 0) - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
              const open = !inv.voidedAt && !inv.paidAt && due > 0;
              return (
                <div key={inv.id} className="rounded-lg border p-4 space-y-2" data-testid={`invoice-${inv.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2.5">
                        {inv.number} · {inv.title}
                        <StatusPill tone={inv.paidAt ? "success" : inv.voidedAt ? "danger" : statusTone(inv.status)}>
                          {inv.status}
                        </StatusPill>
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 tabular-nums">
                        {money(inv.totalCents)}{inv.paidCents > 0 && !inv.paidAt ? ` · ${money(inv.paidCents)} paid` : ""}
                        {open ? ` · ${money(due)} due` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canInvoice && !inv.voidedAt && (
                        <Button size="sm" variant={inv.sentAt ? "outline" : "default"}
                          onClick={() => sendInvoice.mutate(inv.id)} disabled={sendInvoice.isPending}
                          data-testid={`button-send-invoice-${inv.id}`}>
                          <Send className="h-4 w-4 mr-2" /> {inv.sentAt ? "Resend" : "Send"}
                        </Button>
                      )}
                      {inv.publicToken && (
                        <Button size="sm" variant="ghost" data-testid={`button-copy-invoice-${inv.id}`}
                          onClick={() => {
                            navigator.clipboard?.writeText(`${window.location.origin}/i/${inv.publicToken}`);
                            toast({ title: "Payment link copied" });
                          }}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      {canTakePayment && open && (
                        <Button size="sm" variant="outline" data-testid={`button-record-payment-${inv.id}`}
                          onClick={() => { setPayFor(inv); setPayAmount((due / 100).toFixed(2)); }}>
                          <Landmark className="h-4 w-4 mr-2" /> Record payment
                        </Button>
                      )}
                      {canInvoice && !inv.voidedAt && !(inv.paidCents > 0) && (
                        <Button size="sm" variant="ghost" data-testid={`button-void-invoice-${inv.id}`}
                          disabled={voidInvoice.isPending}
                          onClick={() => {
                            if (window.confirm(`Void ${inv.number}? This can't be undone.`)) voidInvoice.mutate(inv.id);
                          }}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <SectionTitle
            title="Projects"
            description="Approving an estimate moves its project to Approved automatically."
          />
          {canManageJobs && (
            <Dialog open={projOpen} onOpenChange={setProjOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-new-project">
                  <Plus className="h-4 w-4 mr-2" /> New project
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New project for {c.displayName}</DialogTitle></DialogHeader>
                <div>
                  <Label htmlFor="p-name">Project name</Label>
                  <Input id="p-name" value={projName} onChange={(e) => setProjName(e.target.value)}
                    placeholder="Kitchen remodel" data-testid="input-project-name" />
                </div>
                <DialogFooter>
                  <Button onClick={() => createProject.mutate()}
                    disabled={!projName.trim() || createProject.isPending} data-testid="button-save-project">
                    {createProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create project
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {!data.projects?.length && (
            <EmptyState
              compact
              icon={FileText}
              title="No projects yet"
              description="A project tracks the job from approval to final invoice."
            />
          )}
          {data.projects?.map((p: any) => (
            <Link key={p.id} href={`/crm/projects/${p.id}`}>
              <div className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3 hover:bg-accent transition-colors cursor-pointer"
                data-testid={`project-${p.id}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.number} · {p.name}</div>
                  <div className="text-sm text-muted-foreground">{p.stageLabel} · {p.stageGroup}</div>
                </div>
                {canSeePrices && p.contractValueCents != null && (
                  <div className="font-medium tabular-nums shrink-0">{money(p.contractValueCents)}</div>
                )}
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Good / better / best options for one estimate. */}
      {optsFor && (
        <EstimateOptionsDialog estimate={optsFor} open={!!optsFor}
          onOpenChange={(o) => !o && setOptsFor(null)} />
      )}

      {/* Record an offline payment against an open invoice. */}
      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {payFor?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pay-amount">Amount received ($)</Label>
              <Input id="pay-amount" type="number" step="0.01" value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)} data-testid="input-payment-amount" />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="ach">Bank transfer</SelectItem>
                  <SelectItem value="card">Card (taken another way)</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Input id="pay-note" value={payNote} onChange={(e) => setPayNote(e.target.value)}
                placeholder="Check #1042" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => recordPayment.mutate()}
              disabled={!(parseFloat(payAmount) > 0) || recordPayment.isPending} data-testid="button-save-payment">
              {recordPayment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
