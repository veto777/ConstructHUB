import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
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
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { milliToQty, priceToCents, qtyToMilli } from "@/lib/estimate-math";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Plus, Loader2, Send, Eye, Check, CheckCircle2, XCircle, Copy,
  FileText, Trash2, Receipt, Landmark, Clock, Layers, Ban, Mail, Phone, MapPin, BellRing,
  Pencil, Search,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, InitialAvatar, SectionTitle, statusTone,
} from "@/components/crm-ui";
import { EstimateEngagement } from "@/components/crm-engagement";
import { EstimateDiscounts } from "@/components/crm-discounts";
import { EstimateAttach, CustomerPhotos, CustomerComments, OrgPamphlets } from "@/components/client-uploads";
import { CustomerMeasurements } from "@/components/client-measurements";
import { CustomerNotes, CustomerTimeline, ViewAsClientButton } from "@/components/crm-client-360";
import { InvoiceReceiptButton } from "@/components/crm-receipt";
import { QuickBid } from "@/components/crm-quick-bid";
import { InfoTip } from "@/components/info-tip";

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
 * Good / better / best options for one estimate, in two honest flavours:
 * an option WITH line items is a client-selectable scope — it renders as a
 * checkbox on the public estimate page and the server computes its totals
 * from the lines (never from a typed-in total). An option WITHOUT items is
 * a legacy display tier. Lines come from the price book (same tap-to-add
 * search as the quick builder) or whole packages via options/from-package.
 * showTotal defaults off — Leap leaked tier pricing up front and it scared
 * clients off before they read the scope.
 */
interface OptionLine {
  /** Price-book item id (re-tapping the same item bumps its qty). */
  key: string;
  name: string;
  unit: string | null;
  taxable: boolean;
  /** Raw text keeps typing natural ("2." stays put); numbers are derived. */
  qtyText: string;
  priceText: string;
}

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

  // ── Scope lines: price-book search → tap-to-add cart ──────────────────────
  const [itemInput, setItemInput] = useState("");
  const [itemQ, setItemQ] = useState("");
  const [lines, setLines] = useState<OptionLine[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setItemQ(itemInput.trim()), 250);
    return () => clearTimeout(t);
  }, [itemInput]);

  const { data: pbItems } = useQuery<any[]>({
    queryKey: [`/api/crm/pricebook/items${itemQ ? `?q=${encodeURIComponent(itemQ)}` : ""}`],
    enabled: open,
  });

  const addItem = async (item: any) => {
    const existing = lines.find((l) => l.key === item.id);
    if (existing) {
      setLines(lines.map((l) => l.key === item.id
        ? { ...l, qtyText: String(qtyToMilli(l.qtyText) / 1000 + 1) }
        : l));
      return;
    }
    setAddingId(item.id);
    try {
      // Flat items carry their price; computed assemblies expand server-side
      // for one unit and the per-unit price is what the contractor edits.
      let priceCents: number | null = item.flatPriceCents ?? null;
      if (priceCents == null) {
        const r = await apiRequest("POST", `/api/crm/pricebook/items/${item.id}/preview`, { quantityMilli: 1000 });
        priceCents = (await r.json()).totalPriceCents ?? 0;
      }
      setLines((ls) => [...ls, {
        key: item.id, name: item.name, unit: item.unit ?? null, taxable: item.taxable ?? true,
        qtyText: "1", priceText: ((priceCents ?? 0) / 100).toString(),
      }]);
    } catch (e: any) {
      toast({ title: "Could not price that item", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  const setLine = (key: string, patch: Partial<OptionLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const linesSubtotal = lines.reduce(
    (s, l) => s + Math.round((priceToCents(l.priceText) * qtyToMilli(l.qtyText)) / 1000), 0);

  const resetForm = () => {
    setName(""); setDescription(""); setTotal("");
    setRecommended(false); setShowTotal(false); setLines([]); setItemInput("");
  };

  const add = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/estimates/${estimate.id}/options`, {
        name,
        tier: (options?.length ?? 0) + 1,
        description: description || null,
        // Lines present → the option is client-selectable and the server
        // computes totals from them; the typed total is only the display
        // tier's price and ignored when lines ride along.
        ...(lines.length
          ? {
            items: lines.map((l) => ({
              kind: "labor", name: l.name, unit: l.unit, taxable: l.taxable,
              quantityMilli: qtyToMilli(l.qtyText), unitPriceCents: priceToCents(l.priceText),
            })),
          }
          : { totalCents: Math.round((parseFloat(total) || 0) * 100) }),
        recommended,
        showTotal,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${estimate.id}/options`] });
      resetForm();
      toast({ title: "Option added", description: "It appears on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Could not add option", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (optionId: string) =>
      (await apiRequest("DELETE", `/api/crm/estimates/${estimate.id}/options/${optionId}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${estimate.id}/options`] });
      toast({ title: "Option removed" });
    },
    onError: (e: any) => toast({ title: "Could not remove option", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Packages: one click expands a price-book package into a scoped option ──
  const { data: packages } = useQuery<any[]>({
    queryKey: ["/api/crm/pricebook/packages"],
    enabled: open,
  });
  const [packageId, setPackageId] = useState("");
  const addPackage = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/estimates/${estimate.id}/options/from-package`, {
        packageId, recommended, showTotal,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${estimate.id}/options`] });
      setPackageId("");
      toast({ title: "Option added", description: "The package's scope rides along — the client can tick it." });
    },
    onError: (e: any) => toast({ title: "Could not add the package", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
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
                  <div className="font-medium flex flex-wrap items-center gap-2">
                    {o.name}
                    {o.recommended && <Badge className="text-[10px]">recommended</Badge>}
                    {Array.isArray(o.items) && o.items.length > 0
                      ? <Badge variant="secondary" className="text-[10px]">client picks · {o.items.length} line{o.items.length === 1 ? "" : "s"}</Badge>
                      : <Badge variant="outline" className="text-[10px]">display tier</Badge>}
                  </div>
                  {o.description && <div className="text-sm text-muted-foreground truncate">{o.description}</div>}
                </div>
                <div className="flex items-center gap-1">
                  {o.totalCents != null && (
                    <div className="font-medium">{money(o.totalCents)}{!o.showTotal && <span className="text-xs text-muted-foreground"> · hidden from client</span>}</div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(o.id)}
                    disabled={remove.isPending}
                    data-testid={`button-remove-option-${o.id}`} aria-label={`Remove ${o.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
                onChange={(e) => setTotal(e.target.value)} data-testid="input-option-total"
                disabled={lines.length > 0}
                placeholder={lines.length > 0 ? "computed from the lines" : undefined} />
            </div>
          </div>
          <div>
            <Label htmlFor="opt-desc">Description (optional)</Label>
            <Textarea id="opt-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="30-year architectural shingles, standard underlayment" />
          </div>

          {/* Scope lines: with lines the client ticks this option on their
              estimate page; without, it's a display tier only. */}
          <div className="rounded-md border border-dashed p-3 space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Add lines from the price book and this option becomes a checkbox the client can pick —
              the total is computed from the lines. No lines and it's a display tier only.
            </p>
            {lines.length > 0 && (
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.key} className="rounded-lg border p-2.5 space-y-2" data-testid={`option-line-${l.key}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-snug min-w-0">{l.name}</div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 -mr-1 -mt-1 text-muted-foreground"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        data-testid={`button-option-line-remove-${l.key}`} aria-label={`Remove ${l.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-20">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Qty{l.unit ? ` (${l.unit})` : ""}
                        </div>
                        <Input value={l.qtyText} inputMode="decimal" className="h-9"
                          onChange={(e) => setLine(l.key, { qtyText: e.target.value })}
                          data-testid={`input-option-line-qty-${l.key}`} aria-label={`Quantity for ${l.name}`} />
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Price $</div>
                        <Input value={l.priceText} inputMode="decimal" className="h-9"
                          onChange={(e) => setLine(l.key, { priceText: e.target.value })}
                          data-testid={`input-option-line-price-${l.key}`} aria-label={`Unit price for ${l.name}`} />
                      </div>
                      <div className="text-right tabular-nums font-medium text-sm pb-1.5 w-20">
                        {money(Math.round((priceToCents(l.priceText) * qtyToMilli(l.qtyText)) / 1000))}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="text-right text-sm">
                  Lines total <span className="font-semibold tabular-nums" data-testid="text-option-lines-total">{money(linesSubtotal)}</span>
                  <span className="text-xs text-muted-foreground"> · tax added at the estimate's rate</span>
                </div>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={itemInput} onChange={(e) => setItemInput(e.target.value)}
                placeholder="Search the price book to add a line…"
                className="h-10 pl-9"
                data-testid="input-option-item-search" />
            </div>
            {(pbItems ?? []).length > 0 && (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {(pbItems ?? []).slice(0, 8).map((i) => {
                  const inCart = lines.some((l) => l.key === i.id);
                  return (
                    <div key={i.id} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2"
                      data-testid={`option-pb-row-${i.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm leading-snug">{i.name}</div>
                        <div className="text-xs text-muted-foreground">
                          per {i.unit}{i.flatPriceCents != null ? ` · ${money(i.flatPriceCents)}` : ""}
                        </div>
                      </div>
                      <Button variant={inCart ? "secondary" : "outline"} size="sm" className="h-9 shrink-0"
                        disabled={addingId === i.id}
                        onClick={() => addItem(i)}
                        data-testid={`button-option-pb-add-${i.id}`}>
                        {addingId === i.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : inCart
                            ? <><Check className="h-4 w-4 mr-1" /> +1</>
                            : <><Plus className="h-4 w-4 mr-1" /> Add</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
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

        {/* A whole price-book package becomes a scoped option in one click —
            the server expands it, prices it, and attaches the lines. */}
        {(packages ?? []).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>…or add a whole package as an option</Label>
              <div className="flex gap-2">
                <Select value={packageId} onValueChange={setPackageId}>
                  <SelectTrigger className="flex-1" data-testid="select-option-package">
                    <SelectValue placeholder="Pick a price-book package" />
                  </SelectTrigger>
                  <SelectContent>
                    {(packages ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id} data-testid={`package-item-${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => addPackage.mutate()}
                  disabled={!packageId || addPackage.isPending}
                  data-testid="button-add-package-option">
                  {addPackage.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add package
                </Button>
              </div>
            </div>
          </>
        )}

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
  const [, setLocation] = useLocation();

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canEstimate = me?.permissions?.manageEstimates === true;
  const canSeePrices = me?.permissions?.seePrices === true;
  const canInvoice = me?.permissions?.manageInvoices === true;
  const canTakePayment = me?.permissions?.takePayment === true;
  const canManageJobs = me?.permissions?.manageJobs === true;
  const canManageCustomers = me?.permissions?.manageCustomers === true;
  // Hard delete is OWNER-only — the server gates on the role itself, so the
  // button simply doesn't render for admin/pm/office seats.
  const isOwner = me?.member?.role === "owner";

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
    onError: (e: any) => toast({ title: "Could not create project", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Estimate options (good / better / best) ───────────────────────────────
  const [optsFor, setOptsFor] = useState<any | null>(null);

  // ── Bid reminder (email + optional text) ──────────────────────────────────
  const remind = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/remind`, {})).json(),
    onSuccess: (r: any) => {
      refresh();
      const parts: string[] = [];
      if (r.emailed) parts.push("email sent");
      if (r.texted) parts.push(r.smsProvider === "log" ? "text recorded (SMS not configured)" : "text sent");
      toast({
        title: "Reminder recorded",
        description: parts.length ? parts.join(" + ") : "Nothing to send — the client has no reachable contact.",
      });
    },
    onError: (e: any) => toast({ title: "Could not send reminder", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Invoices ──────────────────────────────────────────────────────────────
  const convert = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/invoice`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Invoice created from the approved estimate" }); },
    onError: (e: any) => toast({ title: "Could not convert", description: apiErrorMessage(e), variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Could not send", description: apiErrorMessage(e), variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Could not record payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const voidInvoice = useMutation({
    mutationFn: async (invoiceId: string) =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/void`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Invoice voided" }); },
    onError: (e: any) => toast({ title: "Could not void", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Owner-only hard delete (test-record cleanup) ──────────────────────────
  const [delOpen, setDelOpen] = useState(false);
  const deleteClient = useMutation({
    mutationFn: async (force: boolean) =>
      (await apiRequest("DELETE", `/api/crm/customers/${id}${force ? "?force=1" : ""}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client deleted" });
      setLocation("/crm/clients");
    },
    onError: (e: any) => {
      setDelOpen(false);
      toast({ title: "Could not delete client", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  // ── Edit client — the send flow tells the contractor "add an email first";
  // without this dialog there was no UI anywhere to do that. ─────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: "", email: "", phone: "",
    addressLine1: "", city: "", state: "", postalCode: "",
  });
  const openEdit = () => {
    const c = data?.customer ?? {};
    setEditForm({
      displayName: c.displayName ?? "", email: c.email ?? "", phone: c.phone ?? "",
      addressLine1: c.addressLine1 ?? "", city: c.city ?? "", state: c.state ?? "",
      postalCode: c.postalCode ?? "",
    });
    setEditOpen(true);
  };
  const updateClient = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/crm/customers/${id}`, {
        displayName: editForm.displayName.trim(),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        addressLine1: editForm.addressLine1.trim() || null,
        city: editForm.city.trim() || null,
        state: editForm.state.trim() || null,
        postalCode: editForm.postalCode.trim() || null,
      })).json(),
    onSuccess: () => {
      setEditOpen(false);
      refresh();
      toast({ title: "Client updated" });
    },
    onError: (e: any) => toast({ title: "Could not update client", description: apiErrorMessage(e), variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Could not create estimate", description: apiErrorMessage(e), variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Could not send", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Contractor preview: the public page is email-gated now, so the CRM opens
  // a short-lived read-only preview link instead of the raw client URL.
  const preview = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/preview-link`, {})).json(),
    onSuccess: (r: any) => { if (r.url) window.open(r.url, "_blank", "noopener"); },
    onError: (e: any) => toast({ title: "Could not open preview", description: apiErrorMessage(e), variant: "destructive" }),
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
                <div className="flex items-center gap-1">
                  <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
                  <InfoTip k="client-detail" />
                </div>
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
            <div className="flex flex-wrap items-center gap-2">
              {canManageCustomers && <ViewAsClientButton customerId={id!} />}
              {canManageCustomers && (
                <>
                  <Button variant="outline" size="sm" data-testid="button-edit-client" onClick={openEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Dialog open={editOpen} onOpenChange={setEditOpen}>
                    <DialogContent className="max-w-md" data-testid="dialog-edit-client">
                      <DialogHeader><DialogTitle>Edit {c.displayName}</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="edit-name">Name</Label>
                          <Input id="edit-name" value={editForm.displayName} data-testid="input-edit-name"
                            onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor="edit-email">Email</Label>
                            <Input id="edit-email" type="email" value={editForm.email} data-testid="input-edit-email"
                              placeholder="Needed to send estimates"
                              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor="edit-phone">Phone</Label>
                            <Input id="edit-phone" type="tel" value={editForm.phone} data-testid="input-edit-phone"
                              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="edit-address">Address</Label>
                          <Input id="edit-address" value={editForm.addressLine1} data-testid="input-edit-address"
                            onChange={(e) => setEditForm({ ...editForm, addressLine1: e.target.value })} />
                        </div>
                        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                          <div className="col-span-2 sm:col-span-1">
                            <Label htmlFor="edit-city">City</Label>
                            <Input id="edit-city" value={editForm.city}
                              onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor="edit-state">State</Label>
                            <Input id="edit-state" value={editForm.state}
                              onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor="edit-zip">ZIP</Label>
                            <Input id="edit-zip" value={editForm.postalCode}
                              onChange={(e) => setEditForm({ ...editForm, postalCode: e.target.value })} />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={() => updateClient.mutate()}
                          disabled={!editForm.displayName.trim() || updateClient.isPending}
                          data-testid="button-save-client">
                          {updateClient.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save changes
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
              )}
              {data.portalPath && (
                <Button variant="outline" size="sm" data-testid="button-copy-portal"
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.origin + data.portalPath);
                    toast({ title: "Client portal link copied" });
                  }}>
                  <Copy className="h-4 w-4 mr-2" /> Copy portal link
                </Button>
              )}
              {isOwner && (() => {
                const estN = (data.estimates ?? []).length;
                const projN = (data.projects ?? []).length;
                const invN = (invoices ?? []).length;
                const hasDocs = estN + projN + invN > 0;
                return (
                  <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="button-delete-client"
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent data-testid="dialog-delete-client">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {c.displayName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {hasDocs
                            ? `This permanently deletes ${c.displayName} AND their entire tree: ` +
                              `${estN} estimate(s), ${invN} invoice(s) and ${projN} project(s), ` +
                              `with all line items, payments and history. This cannot be undone.`
                            : `This permanently deletes ${c.displayName}. This cannot be undone.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-cancel-delete-client">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="button-confirm-delete-client"
                          onClick={() => deleteClient.mutate(hasDocs)}
                        >
                          Delete permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <SectionTitle
            icon={FileText}
            title="Estimates"
            description="You'll see exactly when the client opens one."
            infoKey="client-estimates"
          />
          {canEstimate && (
            <QuickBid
              customerId={id!}
              customerEmail={c.email}
              customerAddress={[c.addressLine1, c.city, c.state].filter(Boolean).join(", ") || null}
            />
          )}
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
              description="Add lines right here, or tap them in from your price book in the full builder — the client approves it online."
              action={canEstimate ? (
                <Link href="/crm/estimates/new">
                  <Button variant="outline" size="sm" data-testid="link-full-builder">
                    Open the full builder
                  </Button>
                </Link>
              ) : undefined}
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
                  {canEstimate && (
                    <Button size="sm" variant="ghost"
                      onClick={() => preview.mutate(e.id)} disabled={preview.isPending}
                      data-testid={`button-preview-${e.id}`}>
                      {preview.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                      Preview
                    </Button>
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => setOptsFor(e)}
                      data-testid={`button-options-${e.id}`}>
                      <Layers className="h-4 w-4 mr-2" /> Options
                    </Button>
                  )}
                  {/* Optional client-selected discount offers — self-contained. */}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <EstimateDiscounts estimate={e} />
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant={e.sentAt ? "outline" : "default"}
                      onClick={() => send.mutate(e.id)} disabled={send.isPending}
                      data-testid={`button-send-${e.id}`}>
                      {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      {e.sentAt ? "Resend" : "Send"}
                    </Button>
                  )}
                  {/* Nudge a client whose estimate is sitting unanswered. */}
                  {canEstimate && e.sentAt && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => remind.mutate(e.id)} disabled={remind.isPending}
                      data-testid={`button-remind-${e.id}`}>
                      {remind.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BellRing className="h-4 w-4 mr-2" />}
                      Remind
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

              {/* Files pinned to this estimate — show on the client's gated page. */}
              <EstimateAttach estimateId={e.id} canManage={canEstimate} />
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
              infoKey="client-invoices"
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
                      {canInvoice && !inv.voidedAt && (inv.paidCents ?? 0) > 0 && (
                        <InvoiceReceiptButton invoiceId={inv.id} invoiceNumber={inv.number} />
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
            infoKey="client-projects"
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

      {/* Client 360 — the behaviour log + internal notes (self-contained mounts). */}
      <CustomerTimeline customerId={id!} />
      <CustomerNotes
        customerId={id!}
        canManage={canManageCustomers}
        meMemberId={me?.member?.id}
        meRole={me?.member?.role}
      />

      {/* Measurements — HOVER reports + manual entries (self-contained mount). */}
      <CustomerMeasurements customerId={id!} />

      {/* Client portal v2 — photos/comments from this client + the org pamphlet shelf. */}
      <CustomerPhotos customerId={id!} />
      <CustomerComments customerId={id!} />
      <OrgPamphlets />

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
                  <SelectItem value="wire">Wire transfer</SelectItem>
                  <SelectItem value="credit_card">Credit card</SelectItem>
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
