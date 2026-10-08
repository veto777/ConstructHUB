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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { EMAIL_RE, customerErrorMessage } from "@/lib/crm-customer-errors";
import { milliToQty, priceToCents, qtyToMilli } from "@/lib/estimate-math";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Plus, Loader2, Send, Eye, Check, CheckCircle2, XCircle, Copy,
  FileText, Trash2, Receipt, Landmark, Clock, Layers, Ban, Mail, Phone, MapPin, BellRing,
  Pencil, Search, Calendar, MessageSquare, CreditCard, Undo2,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, InitialAvatar, SectionTitle, statusTone,
} from "@/components/crm-ui";
import { EstimateEngagement } from "@/components/crm-engagement";
import { EstimateDiscounts } from "@/components/crm-discounts";
import { EstimateAttach, CustomerPhotos, CustomerComments, OrgPamphlets } from "@/components/client-uploads";
import { JobcamPanel } from "@/components/jobcam/project-panel";
import { CustomerMeasurements } from "@/components/client-measurements";
import { TakePaymentDialog, invoiceDueCents } from "@/components/crm-take-payment";
import { CustomerNotes, CustomerTimeline, ViewAsClientButton } from "@/components/crm-client-360";
import { InvoiceReceiptButton } from "@/components/crm-receipt";
import { QuickBid } from "@/components/crm-quick-bid";
import { AppointmentForm, type Appointment } from "@/components/crm-appointment-form";
import { InfoTip } from "@/components/info-tip";
import { confirmAction } from "@/components/confirm-dialog";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : null);

/** Readable labels for a payment's stored method slug (as on /crm/payments). */
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", check: "Check", wire: "Wire transfer", credit_card: "Credit card",
  ach: "Bank transfer (ACH)", card: "Card", other: "Other",
};

/** The 409 body of an unforced client delete: what the whole tree holds. */
type ClientTree = { estimates: number; invoices: number; projects: number; appointments: number };

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
  const { data: options, isLoading, isError } = useQuery<any[]>({
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
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load options — check your connection and try again.
          </p>
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
                  {/* A client-selectable scope always shows its price on the
                      public page (the client can't choose blind), so only a
                      display tier can really be "hidden from client". */}
                  {o.totalCents != null && (
                    <div className="font-medium">{money(o.totalCents)}{!o.showTotal && !(Array.isArray(o.items) && o.items.length > 0) && <span className="text-xs text-muted-foreground"> · hidden from client</span>}</div>
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
            {/* With lines the option is a scope the client ticks, and the
                public page always prices it — a "hide the total" box there
                would promise something the page doesn't do. */}
            {lines.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="text-option-total-always-shown">
                Selectable scopes always show their price so the client can choose.
              </p>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showTotal} onCheckedChange={(c) => setShowTotal(c === true)}
                  data-testid="check-option-show-total" />
                Show the total to the client
              </label>
            )}
          </div>
        </div>

        {/* A whole price-book package becomes a scoped option in one click —
            the server expands it, prices it, and attaches the lines. */}
        {(packages ?? []).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>…or add a whole package as an option</Label>
              <p className="text-xs text-muted-foreground">
                A package becomes a scope the client can tick, so its price always shows.
              </p>
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

/** Strip formatting so `tel:`/`sms:` get digits (keeps a leading +). "(555) 123-4567" → "5551234567". */
function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Open an address in the device's default maps app. Apple devices → Apple Maps (`maps://` is the
 * native scheme; iOS/macOS also hand `maps.apple.com` to the app). Android → `geo:` opens the
 * user's chosen maps app. Everything else → Google Maps in the browser.
 */
function mapsHref(address: string): string {
  const q = encodeURIComponent(address);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) return `https://maps.apple.com/?q=${q}`;
  if (/Android/i.test(ua)) return `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** datetime-local input value in the browser's own timezone. */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Default visit slot: tomorrow 9–10 AM local. "Now + 24h" copied the current
 *  hour, so a late-evening click prefilled an 11 PM–midnight visit. */
function nextVisitSlot(): { start: Date; end: Date } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 3600000) };
}

/** Send links come back absolute from the server; never prefix the origin twice. */
const absoluteLink = (link: string) =>
  /^https?:\/\//i.test(link) ? link : new URL(link, window.location.origin).toString();

/** Clipboard write that reports whether it actually happened (denied/insecure → false). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Edit-dialog fields; only the ones that actually changed are PATCHed. */
const EDIT_FIELDS = [
  "displayName", "companyName", "email", "phone", "addressLine1", "city", "state", "postalCode", "notes",
] as const;
type EditForm = Record<(typeof EDIT_FIELDS)[number], string>;

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

  const { data, isLoading, isError, error } = useQuery<any>({
    queryKey: [`/api/crm/customers/${id}`],
    enabled: !!id,
  });
  // The default queryFn throws "404: …" for a missing client — that is "not
  // found", not a connection problem.
  const notFound = isError && /^404:/.test(String((error as any)?.message ?? ""));

  const { data: invoices, isError: invoicesError } = useQuery<any[]>({
    queryKey: [`/api/crm/invoices?customerId=${id}`],
    enabled: !!id && canSeePrices,
  });

  // ── The HUB: this page is the fast track for everything about the client ──
  // Payments (history + outstanding), their appointments, and the message
  // thread all mount right here alongside estimates/invoices/projects.

  const { data: payments } = useQuery<any[]>({
    queryKey: [`/api/crm/payments?customerId=${id}`],
    enabled: !!id && canSeePrices,
  });

  const { data: apptData } = useQuery<any>({
    queryKey: ["/api/crm/appointments", "client-hub"],
    queryFn: async () => {
      const from = new Date(Date.now() - 30 * 86400000).toISOString();
      const to = new Date(Date.now() + 365 * 86400000).toISOString();
      return (await apiRequest("GET", `/api/crm/appointments?from=${from}&to=${to}`, undefined)).json();
    },
    enabled: !!id,
  });
  const appointments = (apptData?.appointments ?? []).filter((a: any) => a.customerId === id);

  // Edit / reschedule / delete a visit right here (same dialog as the calendar
  // page). Crew list only matters to editors, so only they fetch it.
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const { data: membersData } = useQuery<any>({
    queryKey: ["/api/crm/members"], enabled: !!id && canManageJobs,
  });

  const { data: thread } = useQuery<any>({
    queryKey: [`/api/crm/inbox/${id}`],
    enabled: !!id && canManageCustomers,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/crm/invoices?customerId=${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/crm/payments?customerId=${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/appointments"] });
    queryClient.invalidateQueries({ queryKey: [`/api/crm/inbox/${id}`] });
    // Sibling surfaces the client page also writes to (staleTime is Infinity,
    // so only explicit invalidation ever refreshes them): the schedule page's
    // agenda view and the org-wide Payments page.
    queryClient.invalidateQueries({ queryKey: ["/api/crm/schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/payments"] });
  };

  // ── Schedule an appointment (lands on the calendar + this page) ──────────
  const [apptOpen, setApptOpen] = useState(false);
  const [apptTitle, setApptTitle] = useState("");
  const [apptStart, setApptStart] = useState("");
  const [apptEnd, setApptEnd] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const scheduleAppt = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/appointments", {
        customerId: id,
        title: apptTitle.trim(),
        startsAt: new Date(apptStart).toISOString(),
        endsAt: apptEnd ? new Date(apptEnd).toISOString() : null,
        notes: apptNotes.trim() || null,
      })).json(),
    onSuccess: (r: any) => {
      setApptOpen(false); setApptTitle(""); setApptStart(""); setApptEnd(""); setApptNotes("");
      refresh();
      const clash = r?.conflicts?.length ? ` Heads up: overlaps ${r.conflicts.length} other visit(s).` : "";
      toast({ title: "Appointment scheduled", description: `It's on the calendar.${clash}` });
    },
    onError: (e: any) => {
      // Lane a1 owns the calendar; if the appointment API isn't deployed yet,
      // say so plainly instead of dead-clicking.
      const msg = apiErrorMessage(e);
      toast({
        title: "Could not schedule",
        description: /not found|404/i.test(msg) ? "Scheduling isn't available on this server yet." : msg,
        variant: "destructive",
      });
    },
  });

  // ── Take a payment (online link or manual record) ─────────────────────────
  const [takeOpen, setTakeOpen] = useState(false);

  // ── Message thread (client portal comments) ───────────────────────────────
  const [replyBody, setReplyBody] = useState("");
  const sendReply = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/inbox/${id}/reply`, { body: replyBody.trim() })).json(),
    onSuccess: (r: any) => {
      setReplyBody("");
      queryClient.invalidateQueries({ queryKey: [`/api/crm/inbox/${id}`] });
      // Word the toast from what actually happened: the portal post always
      // lands; the email copy only goes out when there's an address on file.
      const email: string | null = data?.customer?.email ?? null;
      if (r?.emailed === true) {
        toast({ title: "Message sent", description: `Posted to their portal and emailed to ${email ?? "the client"}.` });
      } else if (!email) {
        toast({ title: "Posted to their portal", description: "No email on file, so no email copy was sent. Add one with Edit." });
      } else if (r?.emailed === false) {
        toast({
          title: "Posted to their portal — email failed",
          description: r.emailError ? String(r.emailError) : `The email copy to ${email} didn't go out.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Posted to their portal", description: `We also tried emailing a copy to ${email}.` });
      }
    },
    onError: (e: any) => toast({ title: "Could not send", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── New project ───────────────────────────────────────────────────────────
  const [projOpen, setProjOpen] = useState(false);
  const [projName, setProjName] = useState("");
  const createProject = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/projects", { customerId: id, name: projName })).json(),
    onSuccess: () => {
      setProjOpen(false); setProjName("");
      refresh();
      // staleTime is Infinity: without this the pipeline board (and the home
      // page's pipeline rollup) keep showing the pre-create cache for the rest
      // of the session — the exact "Add to pipeline did nothing" report.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Project created", description: "It's in the Lead column on the pipeline." });
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
    onError: (e: any) => toast({ title: "Could not send reminder", description: apiErrorMessage(e), variant: "destructive" }),
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
    onSuccess: async (r: any) => {
      refresh();
      if (r.emailed) {
        toast({ title: "Invoice sent" });
      } else {
        const link = absoluteLink(r.link);
        const copied = await copyText(link);
        toast({
          title: copied ? "Email failed — payment link copied" : "Email failed",
          description: copied ? "Send it to your client directly." : `Send this payment link to your client directly: ${link}`,
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => toast({ title: "Could not send", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const [payFor, setPayFor] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("check");
  const [payNote, setPayNote] = useState("");
  // What the button records, in whole cents — "0.001" is $0.00, not a payment.
  const payAmountCents = Math.round((parseFloat(payAmount) || 0) * 100);
  const recordPayment = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/invoices/${payFor.id}/payments`, {
        amountCents: payAmountCents,
        method: payMethod,
        note: payNote || null,
      })).json(),
    onSuccess: (r: any) => {
      const number = payFor?.number;
      setPayFor(null); setPayAmount(""); setPayNote("");
      refresh();
      // Only promise the receipt the server says it is sending (same wording
      // as the Take-a-payment dialog).
      const name = data?.customer?.displayName ?? "the client";
      const receipt = r?.receiptQueued
        ? "the client gets an emailed receipt."
        : r?.receiptSkippedReason === "no_email"
          ? `no receipt emailed — ${name} has no email address on file.`
          : r?.receiptSkippedReason === "receipts_off"
            ? "no receipt emailed — automatic receipts are turned off in Settings."
            : "no receipt was emailed.";
      toast({ title: "Payment recorded", description: `${number ? `${number} updated — ` : ""}${receipt}` });
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Owner: reverse a mistyped manual payment (same flow as /crm/payments) ──
  const [reverseFor, setReverseFor] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const reverse = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/payments/${reverseFor.id}/reverse`, { reason: reverseReason })).json(),
    onSuccess: () => {
      toast({ title: "Payment reversed", description: "The invoice balance is restored and the reversal is on the client's notes." });
      setReverseFor(null);
      setReverseReason("");
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not reverse the payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const voidInvoice = useMutation({
    mutationFn: async (invoiceId: string) =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/void`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Invoice voided" }); },
    onError: (e: any) => toast({ title: "Could not void", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Owner-only hard delete (test-record cleanup) ──────────────────────────
  // The first confirm sends a plain DELETE. A client with nothing attached is
  // deleted there; otherwise the server answers 409 with what the whole tree
  // holds (every visit, whatever its date — counts this page could only
  // estimate), and the dialog asks again with those numbers before ?force=1.
  const [delOpen, setDelOpen] = useState(false);
  const [delTree, setDelTree] = useState<ClientTree | null>(null);
  const deleteClient = useMutation({
    mutationFn: async (force: boolean): Promise<{ deleted: true } | { deleted: false; tree: ClientTree }> => {
      try {
        await apiRequest("DELETE", `/api/crm/customers/${id}${force ? "?force=1" : ""}`);
        return { deleted: true };
      } catch (e: any) {
        const m = /^409:\s*([\s\S]*)$/.exec(String(e?.message ?? ""));
        let body: any = null;
        try { body = m ? JSON.parse(m[1]) : null; } catch { /* not the counts body */ }
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        if (!force && body && typeof body.estimates === "number") {
          return {
            deleted: false,
            tree: { estimates: n(body.estimates), invoices: n(body.invoices), projects: n(body.projects), appointments: n(body.appointments) },
          };
        }
        throw e;
      }
    },
    onSuccess: (r) => {
      if (!r.deleted) { setDelTree(r.tree); return; }
      setDelOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client deleted" });
      setLocation("/crm/clients");
    },
    onError: (e: any) => {
      setDelOpen(false);
      setDelTree(null);
      toast({ title: "Could not delete client", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  // ── Edit client — the send flow tells the contractor "add an email first";
  // without this dialog there was no UI anywhere to do that. ─────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(
    () => Object.fromEntries(EDIT_FIELDS.map((k) => [k, ""])) as EditForm,
  );
  const openEdit = () => {
    const c = data?.customer ?? {};
    setEditForm(Object.fromEntries(EDIT_FIELDS.map((k) => [k, c[k] ?? ""])) as EditForm);
    setEditOpen(true);
  };
  const updateClient = useMutation({
    mutationFn: async () => {
      // Only what changed goes up — the activity log names the fields sent,
      // so a City fix must not read as "updated name, email, phone, …".
      const c = data?.customer ?? {};
      const norm = (v: unknown) => String(v ?? "").trim() || null;
      const patch: Record<string, string | null> = {};
      for (const k of EDIT_FIELDS) {
        const next = norm(editForm[k]);
        if (next !== norm(c[k])) patch[k] = next;
      }
      if (patch.email && !EMAIL_RE.test(patch.email)) throw new Error("Enter a valid email address.");
      if (!Object.keys(patch).length) return { unchanged: true };
      return (await apiRequest("PATCH", `/api/crm/customers/${id}`, patch)).json();
    },
    onSuccess: (r: any) => {
      setEditOpen(false);
      if (r?.unchanged) {
        toast({ title: "Nothing to save", description: "No details were changed." });
        return;
      }
      refresh();
      // The clients list caches too (staleTime Infinity) — keep its row current.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client updated" });
    },
    onError: (e: any) => toast({ title: "Could not update client", description: customerErrorMessage(e), variant: "destructive" }),
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

  // "Also text it" — defaults to the org's setting, overridable per send.
  const { data: smsStatus } = useQuery<any>({ queryKey: ["/api/crm/sms/status"] });
  const { data: orgForSms } = useQuery<any>({ queryKey: ["/api/crm/org"] });
  const [alsoText, setAlsoText] = useState<boolean>(false);
  useEffect(() => {
    setAlsoText((orgForSms?.customFields as any)?.smsEstimates === true);
  }, [orgForSms?.customFields]);

  const send = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/send`, { sms: alsoText })).json(),
    onSuccess: async (r: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
      if (r.emailed) {
        const textPart = r.texted ? " and texted" : r.smsError ? ` (text failed: ${r.smsError})` : "";
        toast({ title: "Estimate sent", description: `Emailed to ${r.estimate?.sentToEmail ?? "the client"}${textPart}.` });
      } else {
        const link = absoluteLink(r.link);
        const copied = await copyText(link);
        toast({
          title: copied ? "Email failed — link copied" : "Email failed",
          description: copied ? "Send this link to your client directly." : `Send this link to your client directly: ${link}`,
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
  // The same read-only preview for an invoice (15-minute grant; paying is
  // disabled on that page).
  const previewInvoice = useMutation({
    mutationFn: async (invoiceId: string) =>
      (await apiRequest("POST", `/api/crm/invoices/${invoiceId}/preview-link`, {})).json(),
    onSuccess: (r: any) => { if (r.url) window.open(r.url, "_blank", "noopener"); },
    onError: (e: any) => toast({ title: "Could not open preview", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    const connectionProblem = isError && !notFound;
    // A 404 only says this workspace can't show that client — it may have
    // been deleted, the link may be wrong, or it may belong to another
    // workspace or a part of the business you can't see. Don't claim which;
    // point back to the list.
    return (
      <ErrorCard
        title={connectionProblem ? "Couldn't load this client" : "This client isn't available"}
        description={connectionProblem
          ? "Check your connection and refresh the page."
          : "It may have been deleted, the link may be wrong, or it may belong to another workspace. " +
            "Find the client from All clients."}
      >
        <Link href="/crm/clients">
          <Button variant="outline" size="sm" data-testid="link-error-back-clients">
            <ArrowLeft className="h-4 w-4 mr-1" /> All clients
          </Button>
        </Link>
      </ErrorCard>
    );
  }

  const c = data.customer;
  const estimates = data.estimates ?? [];

  // One prefill for both Schedule buttons.
  const openSchedule = () => {
    const { start, end } = nextVisitSlot();
    setApptTitle(`${c.displayName} — site visit`);
    setApptStart(toLocalInput(start));
    setApptEnd(toLocalInput(end));
    setApptOpen(true);
  };

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
                {c.companyName && c.companyName !== c.displayName && (
                  <div className="text-sm text-muted-foreground mt-0.5">{c.companyName}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                  {c.email && (
                    <span className="flex items-center gap-1.5">
                      <a href={`mailto:${c.email}`} title="Send an email"
                        className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline underline-offset-2 transition-colors"
                        data-testid="link-client-email">
                        <Mail className="h-3.5 w-3.5" />{c.email}
                      </a>
                    </span>
                  )}
                  {c.phone && (
                    <span className="flex items-center gap-1.5">
                      <a href={`tel:${telHref(c.phone)}`} title="Call"
                        className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline underline-offset-2 transition-colors"
                        data-testid="link-client-phone">
                        <Phone className="h-3.5 w-3.5" />{c.phone}
                      </a>
                      <span className="inline-flex items-center gap-0.5 ml-0.5">
                        <a href={`tel:${telHref(c.phone)}`} title="Call" aria-label="Call client"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border bg-background text-foreground/70 hover:text-foreground hover:bg-accent transition-colors"
                          data-testid="button-client-call">
                          <Phone className="h-3 w-3" />
                        </a>
                        <a href={`sms:${telHref(c.phone)}`} title="Text" aria-label="Text client"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border bg-background text-foreground/70 hover:text-foreground hover:bg-accent transition-colors"
                          data-testid="button-client-text">
                          <MessageSquare className="h-3 w-3" />
                        </a>
                      </span>
                    </span>
                  )}
                  {(c.addressLine1 || c.city) && (() => {
                    const address = [c.addressLine1, [c.city, c.state].filter(Boolean).join(", "), c.postalCode]
                      .filter(Boolean).join(" ").replace(/, +/g, ", ");
                    const label = [c.addressLine1, c.city, c.state].filter(Boolean).join(", ");
                    return (
                      <span className="flex items-center gap-1.5">
                        <a href={mapsHref(address)} target="_blank" rel="noopener noreferrer" title="Open in Maps"
                          className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline underline-offset-2 transition-colors"
                          data-testid="link-client-address">
                          <MapPin className="h-3.5 w-3.5" />{label}
                        </a>
                      </span>
                    );
                  })()}
                </div>
                {/* The New-client dialog's Notes land on the customer row —
                    this is the one place they show (team-only, never the portal). */}
                {typeof c.notes === "string" && c.notes.trim() && (
                  <div className="mt-3 max-w-2xl rounded-md border bg-muted/40 px-3 py-2" data-testid="client-intake-notes">
                    <div className="text-xs font-medium text-muted-foreground">Intake notes</div>
                    <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm">{c.notes.trim()}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManageCustomers && data.portalPath && <ViewAsClientButton customerId={id!} />}
              {canManageCustomers && (
                <>
                  <Button variant="outline" size="sm" data-testid="button-edit-client" onClick={openEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Dialog open={editOpen} onOpenChange={setEditOpen}>
                    <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-client">
                      <DialogHeader><DialogTitle>Edit {c.displayName}</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="edit-name">Name</Label>
                          <Input id="edit-name" value={editForm.displayName} data-testid="input-edit-name" maxLength={200}
                            onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor="edit-company">Company (optional)</Label>
                          <Input id="edit-company" value={editForm.companyName} data-testid="input-edit-company" maxLength={200}
                            onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })} />
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
                            <Input id="edit-phone" type="tel" value={editForm.phone} data-testid="input-edit-phone" maxLength={40}
                              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="edit-address">Address</Label>
                          <Input id="edit-address" value={editForm.addressLine1} data-testid="input-edit-address" maxLength={200}
                            onChange={(e) => setEditForm({ ...editForm, addressLine1: e.target.value })} />
                        </div>
                        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                          <div className="col-span-2 sm:col-span-1">
                            <Label htmlFor="edit-city">City</Label>
                            <Input id="edit-city" value={editForm.city} maxLength={120}
                              onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor="edit-state">State</Label>
                            <Input id="edit-state" value={editForm.state} maxLength={40}
                              onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor="edit-zip">ZIP</Label>
                            <Input id="edit-zip" value={editForm.postalCode} maxLength={20}
                              onChange={(e) => setEditForm({ ...editForm, postalCode: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="edit-notes">Intake notes</Label>
                          <Textarea id="edit-notes" rows={3} value={editForm.notes} data-testid="input-edit-notes"
                            placeholder="Only your team sees these."
                            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
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
                  onClick={async () => {
                    const link = absoluteLink(data.portalPath);
                    toast(await copyText(link)
                      ? { title: "Client portal link copied" }
                      : { title: "Couldn't copy the link", description: link, variant: "destructive" });
                  }}>
                  <Copy className="h-4 w-4 mr-2" /> Copy portal link
                </Button>
              )}
              {isOwner && (
                // Two steps: the plain delete first; if the client has
                // anything attached, the server's 409 counts (the whole tree,
                // not what this page happens to have loaded) and a second,
                // explicit confirm before ?force=1.
                <AlertDialog open={delOpen}
                  onOpenChange={(o) => { if (deleteClient.isPending) return; setDelOpen(o); if (!o) setDelTree(null); }}>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-delete-client"
                      className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-testid="dialog-delete-client">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {delTree ? `Delete ${c.displayName} and everything under them?` : `Delete ${c.displayName}?`}
                      </AlertDialogTitle>
                      <AlertDialogDescription data-testid="text-delete-client-detail">
                        {delTree
                          ? `${c.displayName} has ${delTree.estimates} estimate(s), ${delTree.invoices} invoice(s), ` +
                            `${delTree.projects} project(s) and ${delTree.appointments} calendar visit(s). ` +
                            "Deleting removes the entire tree — every document with its line items, payments and " +
                            "history, every project record (change orders, punch list, daily logs, selections, " +
                            "budget and costs) and every visit. This cannot be undone."
                          : `This permanently deletes ${c.displayName}. If they have any estimates, invoices, ` +
                            "projects or calendar visits, you'll see how many and confirm again before anything " +
                            "is removed. This cannot be undone."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-delete-client" disabled={deleteClient.isPending}>
                        Cancel
                      </AlertDialogCancel>
                      {delTree ? (
                        <Button variant="destructive" disabled={deleteClient.isPending}
                          data-testid="button-confirm-delete-client-force"
                          onClick={() => deleteClient.mutate(true)}>
                          {deleteClient.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Delete everything
                        </Button>
                      ) : (
                        <Button variant="destructive" disabled={deleteClient.isPending}
                          data-testid="button-confirm-delete-client"
                          onClick={() => deleteClient.mutate(false)}>
                          {deleteClient.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Delete permanently
                        </Button>
                      )}
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fast-track actions — this page is the HUB for the whole relationship:
          schedule, estimate, pipeline, payment, all one tap from the client. */}
      {(canManageJobs || canEstimate || canTakePayment) && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-2" data-testid="client-quick-actions">
            <span className="text-sm font-medium text-muted-foreground mr-1">Quick actions</span>
            {canManageJobs && (
              <Button size="sm" variant="outline" data-testid="button-schedule-appointment"
                onClick={openSchedule}>
                <Calendar className="h-4 w-4 mr-2" /> Schedule appointment
              </Button>
            )}
            {canEstimate && (
              <Button size="sm" variant="outline" data-testid="button-quick-estimate" onClick={() => setOpen(true)}>
                <FileText className="h-4 w-4 mr-2" /> New estimate
              </Button>
            )}
            {canManageJobs && (
              <Button size="sm" variant="outline" data-testid="button-quick-pipeline" onClick={() => setProjOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add to pipeline
              </Button>
            )}
            {canTakePayment && (
              <Button size="sm" data-testid="button-take-payment" onClick={() => setTakeOpen(true)}>
                <CreditCard className="h-4 w-4 mr-2" /> Take a payment
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payments — see what this client owes and what they've paid, and take
          a payment (online link or manual record) without leaving the page. */}
      {canSeePrices && (() => {
        const outstanding = (invoices ?? []).reduce((s, i) => s + (i.voidedAt ? 0 : invoiceDueCents(i)), 0);
        const history = (payments ?? []).filter((p) => p.status !== "pending" || p.provider === "stripe");
        return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <SectionTitle
                icon={CreditCard}
                title="Payments"
                description="Take a payment online (card/ACH link) or record cash, check or wire."
                infoKey="client-payments"
              />
              {canTakePayment && (
                <Button size="sm" data-testid="button-take-payment-section" onClick={() => setTakeOpen(true)}>
                  <CreditCard className="h-4 w-4 mr-2" /> Take a payment
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Outstanding balance</span>{" "}
                  <span className="font-semibold tabular-nums" data-testid="text-outstanding-balance">{money(outstanding)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Collected to date</span>{" "}
                  <span className="font-semibold tabular-nums" data-testid="text-collected">
                    {money((payments ?? []).filter((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status)).reduce((s, p) => s + Math.max(0, (p.amountCents ?? 0) - (p.refundedCents ?? 0)), 0))}
                  </span>
                </div>
              </div>
              {!history.length ? (
                <EmptyState
                  compact
                  icon={CreditCard}
                  title="No payments yet"
                  description="Take a payment above — send the client a secure card/ACH link, or record a check you already have."
                />
              ) : (
                <div className="space-y-2">
                  {history.slice(0, 25).map((p) => (
                    <div key={p.id} className="rounded-lg border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
                      data-testid={`client-payment-${p.id}`}>
                      <div>
                        <div className="font-medium tabular-nums">
                          {money(p.amountCents)}
                          <span className="text-muted-foreground font-normal text-sm">
                            {" "}· {p.method ?? p.provider} · {p.purpose}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.refundedCents > 0 && <span>{money(p.refundedCents)} refunded · </span>}
                          {when(p.paidAt ?? p.createdAt)}{p.note ? ` · ${p.note}` : ""}
                        </div>
                        {p.status === "reversed" && p.failureReason && (
                          <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-payment-reversed-${p.id}`}>
                            {p.failureReason}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Owner-only undo for a mistyped manual record (same
                            flow as the Payments page). */}
                        {isOwner && p.provider === "manual" && p.status === "succeeded" && (
                          <Button size="sm" variant="ghost" onClick={() => { setReverseFor(p); setReverseReason(""); }}
                            data-testid={`button-reverse-payment-${p.id}`}>
                            <Undo2 className="h-4 w-4 mr-1" /> Reverse
                          </Button>
                        )}
                        <StatusPill tone={statusTone(p.status)}>{p.status}</StatusPill>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Schedule — this client's appointments, straight from the calendar. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <SectionTitle
            icon={Calendar}
            title="Schedule"
            description="Appointments for this client — they also land on the calendar."
          />
          {canManageJobs && (
            <Button size="sm" variant="outline" data-testid="button-schedule-appointment-section"
              onClick={openSchedule}>
              <Calendar className="h-4 w-4 mr-2" /> Schedule appointment
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {!appointments.length ? (
            <EmptyState
              compact
              icon={Calendar}
              title="Nothing scheduled"
              description="Schedule an appointment or project start — it lands on the calendar and here."
            />
          ) : (
            appointments.slice(0, 15).map((a: any) => (
              <div key={a.id}
                className={`rounded-lg border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2${canManageJobs ? " cursor-pointer hover:bg-muted/50" : ""}`}
                data-testid={`appointment-${a.id}`}
                role={canManageJobs ? "button" : undefined}
                tabIndex={canManageJobs ? 0 : undefined}
                onClick={canManageJobs ? () => setEditingAppt(a) : undefined}
                onKeyDown={canManageJobs ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAppt(a); } } : undefined}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.allDay ? `${new Date(a.startsAt).toLocaleDateString()} · All day`
                      : <>{when(a.startsAt)}{a.endsAt ? ` – ${new Date(a.endsAt).toLocaleTimeString()}` : ""}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={statusTone(a.status)}>{a.status}</StatusPill>
                  {canManageJobs && (
                    <Button size="sm" variant="ghost" className="h-7 px-2"
                      data-testid={`button-edit-appointment-${a.id}`}
                      onClick={(e) => { e.stopPropagation(); setEditingAppt(a); }}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
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
                        <Label className="text-xs">Item</Label>
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
                      {/* The scope the client actually reads — persists to the
                          line's description and renders on the estimate. */}
                      <div className="sm:col-span-12">
                        <Label className="text-xs">Scope &amp; details (shown to the client)</Label>
                        <Textarea rows={2} value={it.description ?? ""}
                          data-testid={`input-item-scope-${idx}`}
                          placeholder="What's included — materials, prep, warranty, exclusions…"
                          onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
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
                  {/* A signed estimate's number is what the client signed for
                      (after any optional discounts they ticked), not the quote. */}
                  {canSeePrices && (() => {
                    const signed = e.approvedAt && e.approvedTotalCents != null;
                    return (
                      <div className="text-sm text-muted-foreground mt-0.5 tabular-nums" data-testid={`text-estimate-total-${e.id}`}>
                        {money(signed ? e.approvedTotalCents : e.totalCents)}
                        {signed && e.approvedTotalCents !== e.totalCents && (
                          <span className="text-xs"> · signed · quoted {money(e.totalCents)}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  {/* Edit verbiage / add work scopes — opens the full editor.
                      Available on drafts AND sent estimates (the client link
                      reflects edits immediately); hidden once signed/approved. */}
                  {canEstimate && canSeePrices && !e.approvedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => setLocation(`/crm/estimates/${e.id}?edit=1`)}
                      data-testid={`button-edit-estimate-${e.id}`}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </Button>
                  )}
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
                  {canEstimate && !e.approvedAt && !e.declinedAt && smsStatus?.configured && c.phone && smsStatus?.canTextClients !== false && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
                      data-testid={`toggle-send-sms-${e.id}`}>
                      <Checkbox checked={alsoText} onCheckedChange={(v) => setAlsoText(v === true)} />
                      Also text it
                    </label>
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && smsStatus?.canTextClients === false && c.phone && (
                    <span className="text-xs text-muted-foreground" title="Connect your own number to text clients — Settings → Text messaging. Client texting needs your own carrier registration."
                      data-testid={`note-send-sms-byo-${e.id}`}>
                      Texting clients needs your own number (Settings → Text messaging)
                    </span>
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
                  {/* One invoice per signed estimate from here: once a live
                      (non-void) invoice exists, name it instead of offering a
                      second one — the server refuses a draw past 100% anyway. */}
                  {canInvoice && e.approvedAt && (() => {
                    const estInvoices = (invoices ?? []).filter((i: any) => i.estimateId === e.id && !i.voidedAt);
                    return estInvoices.length > 0 ? (
                      <span className="text-xs text-muted-foreground" data-testid={`text-invoiced-${e.id}`}>
                        Invoiced · {estInvoices.map((i: any) => i.number).join(", ")}
                      </span>
                    ) : (
                      <Button size="sm" variant="outline"
                        onClick={() => convert.mutate(e.id)} disabled={convert.isPending}
                        data-testid={`button-convert-${e.id}`}>
                        {convert.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />}
                        Create invoice
                      </Button>
                    );
                  })()}
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
                        {money(inv.totalCents)}{inv.refundedCents > 0 ? ` · ${money(inv.refundedCents)} refunded` : ""}{inv.paidCents > 0 && !inv.paidAt ? ` · ${money(inv.paidCents)} paid` : ""}
                        {open ? ` · ${money(due)} due` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canInvoice && !inv.voidedAt && (() => {
                        // Same rules as the send route (409s): a $0 invoice or
                        // one with nothing due has nothing to send. The title
                        // sits on a wrapper — a disabled button gets no hover.
                        const noSend = (inv.totalCents ?? 0) <= 0
                          ? "This invoice is $0 — add line items before sending it."
                          : due <= 0
                            ? (inv.paidCents ?? 0) >= (inv.totalCents ?? 0)
                              ? "Already paid in full — there's nothing to send."
                              : "Nothing is due right now — the rest is retainage held until closeout."
                            : null;
                        return (
                          <span title={noSend ?? undefined} className="inline-flex">
                            <Button size="sm" variant={inv.sentAt ? "outline" : "default"}
                              onClick={() => sendInvoice.mutate(inv.id)} disabled={!!noSend || sendInvoice.isPending}
                              data-testid={`button-send-invoice-${inv.id}`}>
                              <Send className="h-4 w-4 mr-2" /> {inv.sentAt ? "Resend" : "Send"}
                            </Button>
                          </span>
                        );
                      })()}
                      {/* What the client sees, read-only (a voided invoice's page
                          only says it was cancelled, so it gets no preview). */}
                      {canInvoice && !inv.voidedAt && (
                        <Button size="sm" variant="ghost"
                          onClick={() => previewInvoice.mutate(inv.id)} disabled={previewInvoice.isPending}
                          data-testid={`button-preview-invoice-${inv.id}`}>
                          {previewInvoice.isPending && previewInvoice.variables === inv.id
                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            : <Eye className="h-4 w-4 mr-2" />}
                          Preview
                        </Button>
                      )}
                      {/* A voided invoice's link answers 410 — never offer to copy it. */}
                      {inv.publicToken && !inv.voidedAt && (
                        <Button size="sm" variant="ghost" data-testid={`button-copy-invoice-${inv.id}`}
                          aria-label={`Copy payment link for ${inv.number}`} title="Copy payment link"
                          onClick={async () => {
                            const link = absoluteLink(`/i/${inv.publicToken}`);
                            toast(await copyText(link)
                              ? { title: "Payment link copied" }
                              : { title: "Couldn't copy the link", description: link, variant: "destructive" });
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
                      {canInvoice && !inv.voidedAt && ((inv.paidCents ?? 0) > 0 || (inv.refundedCents ?? 0) > 0) && (
                        <InvoiceReceiptButton invoiceId={inv.id} invoiceNumber={inv.number} />
                      )}
                      {canInvoice && !inv.voidedAt && !(inv.paidCents > 0) && (
                        <Button size="sm" variant="ghost" data-testid={`button-void-invoice-${inv.id}`}
                          aria-label={`Void invoice ${inv.number}`} title="Void invoice"
                          disabled={voidInvoice.isPending}
                          onClick={() => {
                            confirmAction({
                              id: "void-invoice",
                              title: `Void invoice ${inv.number}?`,
                              description: "The invoice is cancelled and can no longer be paid. It stays in the list, marked void, for your records. This can't be undone — to bill this work you would create a new invoice.",
                              confirmLabel: "Void invoice",
                              onConfirm: () => voidInvoice.mutate(inv.id),
                            });
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

      {/* Messages — the client's portal thread, right on their page. */}
      {canManageCustomers && (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={MessageSquare}
              title="Messages"
              description="The client's thread — replies land in their portal, and in their email when one is on file."
            />
          </CardHeader>
          <CardContent className="space-y-3">
            {!thread?.messages?.length ? (
              <EmptyState
                compact
                icon={MessageSquare}
                title="No messages yet"
                description="When the client writes from their portal, the thread shows up here."
              />
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="client-message-thread">
                {thread.messages.map((m: any) => (
                  <div key={m.id} className={`rounded-lg border px-3 py-2 text-sm ${m.fromClient ? "" : "bg-accent/50"}`}
                    data-testid={`message-${m.id}`}>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{m.authorName}{m.fromClient ? " (client)" : ""}</span>
                      <span>{when(m.createdAt)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{m.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-start">
              <Textarea rows={2} value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
                placeholder={`Message ${c.displayName}…`} className="flex-1"
                data-testid="input-client-reply" />
              <Button size="sm" onClick={() => sendReply.mutate()}
                disabled={!replyBody.trim() || sendReply.isPending}
                data-testid="button-client-reply">
                {sendReply.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
      <CustomerPhotos customerId={id!} canUpload={me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true} />
      {/* JobCam — the crew's job-site shots across this client's projects (same shelf as Project Photos). */}
      <Card data-testid="section-customer-jobcam"><CardContent className="p-4 sm:p-5"><JobcamPanel customerId={id!} /></CardContent></Card>
      <CustomerComments customerId={id!} />
      <OrgPamphlets />

      {/* Good / better / best options for one estimate. */}
      {optsFor && (
        <EstimateOptionsDialog estimate={optsFor} open={!!optsFor}
          onOpenChange={(o) => !o && setOptsFor(null)} />
      )}

      {/* Take a payment — online checkout link or manual record. */}
      {/* estimates → a "Deposit on a signed estimate" link; payments → hides
          deposits already paid. */}
      <TakePaymentDialog
        customerName={c.displayName}
        invoices={invoices}
        estimates={estimates}
        payments={payments}
        open={takeOpen}
        onOpenChange={setTakeOpen}
        onChanged={refresh}
      />

      {/* Owner: reverse a manual payment recorded by mistake. */}
      <Dialog open={!!reverseFor} onOpenChange={(o) => { if (!o) { setReverseFor(null); setReverseReason(""); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-reverse-payment">
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {reverseFor && <>{money(reverseFor.amountCents)} · {METHOD_LABELS[reverseFor.method] ?? reverseFor.method ?? "manual"} from {c.displayName}.</>}{" "}
              The payment stays in the history marked "reversed", the invoice balance goes back up,
              and the reason is noted on the client. Use this for a payment recorded by mistake.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Input id="reverse-reason" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Typed $1,000 instead of $100" data-testid="input-reverse-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => reverse.mutate()}
              disabled={reverseReason.trim().length < 3 || reverse.isPending} data-testid="button-confirm-reverse">
              {reverse.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reverse payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule an appointment — lands on the calendar and this page. */}
      <Dialog open={apptOpen} onOpenChange={setApptOpen}>
        <DialogContent data-testid="dialog-schedule-appointment">
          <DialogHeader>
            <DialogTitle>Schedule — {c.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="appt-title">Title</Label>
              <Input id="appt-title" value={apptTitle} onChange={(e) => setApptTitle(e.target.value)}
                placeholder="Site visit, measure, project start…" data-testid="input-appointment-title" />
            </div>
            <div className="grid gap-3 grid-cols-2">
              <div>
                <Label htmlFor="appt-start">Starts</Label>
                <Input id="appt-start" type="datetime-local" value={apptStart}
                  onChange={(e) => setApptStart(e.target.value)} data-testid="input-appointment-start" />
              </div>
              <div>
                <Label htmlFor="appt-end">Ends</Label>
                <Input id="appt-end" type="datetime-local" value={apptEnd}
                  onChange={(e) => setApptEnd(e.target.value)} data-testid="input-appointment-end" />
              </div>
            </div>
            <div>
              <Label htmlFor="appt-notes">Notes (optional)</Label>
              <Textarea id="appt-notes" rows={2} value={apptNotes} onChange={(e) => setApptNotes(e.target.value)}
                placeholder="Gate code, dogs, bring samples…" data-testid="input-appointment-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => scheduleAppt.mutate()}
              disabled={!apptTitle.trim() || !apptStart || scheduleAppt.isPending}
              data-testid="button-save-appointment">
              {scheduleAppt.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit / reschedule / delete one of this client's visits — the same
          dialog the calendar page uses, so the two never drift. */}
      <Dialog open={!!editingAppt} onOpenChange={(o) => !o && setEditingAppt(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-appointment">
          {editingAppt && (
            <AppointmentForm
              key={editingAppt.id}
              initial={editingAppt}
              defaultDate={null}
              members={membersData?.members ?? []}
              projects={data.projects ?? []}
              customers={[{ id: c.id, displayName: c.displayName }]}
              onClose={() => { setEditingAppt(null); refresh(); }}
            />
          )}
        </DialogContent>
      </Dialog>

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
              disabled={payAmountCents < 1 || recordPayment.isPending} data-testid="button-save-payment">
              {recordPayment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record {payAmountCents >= 1 ? money(payAmountCents) : "payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
