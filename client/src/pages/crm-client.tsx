import { useEffect, useRef, useState } from "react";
import { ClientSection, ClientSections, useClientPageLayout } from "@/components/client-page-layout";
import { PricebookItemInput } from "@/components/pricebook-item-input";
import { takeoffQuantityForLine, type HoverTakeoff } from "@shared/hover-takeoff";
import { JobStageControl } from "@/components/job-stage";
import { useJobFlow } from "@/components/job-flow-settings";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, useSearch, Link } from "wouter";
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
import { cleanOfferConditions } from "@shared/discount-presets";
import {
  ArrowLeft, Plus, Loader2, Send, Eye, Check, CheckCircle2, XCircle, Copy,
  FileText, Trash2, Receipt, Landmark, Clock, Layers, Ban, Mail, Phone, MapPin, BellRing,
  Pencil, Search, Calendar, MessageSquare, CreditCard, Undo2, Info, GripVertical, MailCheck,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, InitialAvatar, SectionTitle, statusTone,
} from "@/components/crm-ui";
import { EstimateEngagement } from "@/components/crm-engagement";
import { EstimateDiscounts } from "@/components/crm-discounts";
import { EstimateAttach, CustomerPhotos, CustomerComments, OrgPamphlets } from "@/components/client-uploads";
import { EstimateDefaultFiles } from "@/components/estimate-attachments-card";
import { JobcamPanel } from "@/components/jobcam/project-panel";
import { CustomerMeasurements } from "@/components/client-measurements";
import { HoverTakeoffCard } from "@/components/hover-takeoff-card";
import { TakePaymentDialog, invoiceDueCents } from "@/components/crm-take-payment";
import { deadLeadOf } from "@shared/bid-status";
import { CustomerNotes, CustomerTimeline, ViewAsClientButton } from "@/components/crm-client-360";
import { InvoiceReceiptButton } from "@/components/crm-receipt";
import { ClientDocuments } from "@/components/client-documents";
import { QuickBid } from "@/components/crm-quick-bid";
import { AppointmentForm, type Appointment } from "@/components/crm-appointment-form";
import { InfoTip } from "@/components/info-tip";
import { useEstimateTaxRate, TaxRateNote, bpsToPctText } from "@/components/estimate-tax-rate";
import { useEstimateAutosave, AutosaveIndicator, useDialogFullscreen, FullscreenToggle } from "@/components/estimate-autosave";
import {
  OptionTabsBar, EstimateMenu, TemplatesMenu, NameDialog, ClientPickerDialog, ConfirmDeleteOption,
  type OptionAction, type EstimateAction, type EstimateTemplate,
} from "@/components/estimate-option-tabs";
import {
  autoTitleFrom, autosavePayload, contractorDiscountLine, defaultOffers, discountFromOptionLines, draftHasContent, lineHasContent, offersPayload, snapshotFromEstimate,
  type ContractorDiscount, type DraftOffer, type EstimateDraftSnapshot,
} from "@shared/estimate-draft";
import { computeApprovalTotals } from "@shared/estimate-totals";
import { DISCOUNT_PRESETS } from "@shared/discount-presets";
import { SCOPE_CATEGORIES, SCOPE_CATEGORY_LABEL, bundleRuleOf, bundleRuleText, effectiveOffer, lineCategory } from "@shared/scope-category";
import { HelpButton } from "@/components/help-button";
import { confirmAction } from "@/components/confirm-dialog";
import { EstimatePayments } from "@/components/crm-estimate-payments";
import { MANUAL_PAYMENT_METHODS } from "@shared/payment-settings";
import { InterestBadge, useClientInterest } from "@/components/crm-interest-badge";
import { SortButtons, useTableSort, type SortColumn } from "@/components/sortable-th";

/** The client's estimate and invoice cards sort on every fact they show (in the browser — one client's documents). */
type ClientDocSortKey = "number" | "title" | "status" | "total" | "created";
const CLIENT_ESTIMATE_SORT_COLUMNS: SortColumn<ClientDocSortKey>[] = [
  { key: "number", label: "Number", kind: "number" },
  { key: "title", label: "Title", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "total", label: "Total", kind: "number" },
  { key: "created", label: "Created", kind: "date" },
];
type ClientInvoiceSortKey = ClientDocSortKey | "due";
const CLIENT_INVOICE_SORT_COLUMNS: SortColumn<ClientInvoiceSortKey>[] = [
  ...CLIENT_ESTIMATE_SORT_COLUMNS,
  { key: "due", label: "Due", kind: "date" },
];
/** "EST-12" → 12, so numbers sort as numbers. */
const docNumberValue = (n: unknown): number | null => {
  const digits = String(n ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : null;
};

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
  pricebookItemId?: string | null; unitCostCents?: number | null;
  /** Price-book list price + field when picked ("Update price book to $X"); scope category for bundles. */
  listPriceCents?: number | null; listField?: "flatPriceCents" | "rateCentsPerSqft" | null;
  scopeCategory?: string | null;
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
          <DialogDescription>Give the client scope options on this estimate to choose from.</DialogDescription>
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
  const flow = useJobFlow(me);
  const interestMap = useClientInterest(!!id && me?.permissions?.manageEstimates === true, { customerId: id });
  const canEstimate = me?.permissions?.manageEstimates === true;
  const canSeePrices = me?.permissions?.seePrices === true;
  const canInvoice = me?.permissions?.manageInvoices === true;
  const canTakePayment = me?.permissions?.takePayment === true;
  const canManageJobs = me?.permissions?.manageJobs === true;
  const canManageCustomers = me?.permissions?.manageCustomers === true;
  // Which containers show below, and in what order (shared/client-page-layout.ts).
  const layout = useClientPageLayout(me);
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

  const { data: invoicesRaw, isError: invoicesError } = useQuery<any[]>({
    queryKey: [`/api/crm/invoices?customerId=${id}`],
    enabled: !!id && canSeePrices,
  });
  const estimateSort = useTableSort<ClientDocSortKey>("created", "desc", "client-estimates", { keys: CLIENT_ESTIMATE_SORT_COLUMNS.map((c) => c.key) });
  const invoiceSort = useTableSort<ClientInvoiceSortKey>("created", "desc", "client-invoices", { keys: CLIENT_INVOICE_SORT_COLUMNS.map((c) => c.key) });
  const invoices = invoicesRaw ? invoiceSort.sorted(invoicesRaw, {
    number: (i: any) => docNumberValue(i.number),
    title: (i: any) => i.title,
    status: (i: any) => i.status,
    total: (i: any) => i.totalCents,
    created: (i: any) => i.createdAt,
    due: (i: any) => i.dueAt,
  }) : invoicesRaw;

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

  // Only once the client itself has loaded: for a missing or foreign client the
  // thread would just 404 alongside it.
  const { data: thread } = useQuery<any>({
    queryKey: [`/api/crm/inbox/${id}`],
    enabled: !!id && !!data && canManageCustomers,
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
  // The project the visit is for (the Job stage card books the start date against the current project).
  const [apptProjectId, setApptProjectId] = useState<string | null>(null);
  const scheduleAppt = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/appointments", {
        customerId: id,
        projectId: apptProjectId,
        title: apptTitle.trim(),
        startsAt: new Date(apptStart).toISOString(),
        endsAt: apptEnd ? new Date(apptEnd).toISOString() : null,
        notes: apptNotes.trim() || null,
      })).json(),
    onSuccess: (r: any) => {
      setApptOpen(false); setApptTitle(""); setApptStart(""); setApptEnd(""); setApptNotes(""); setApptProjectId(null);
      refresh();
      // The visit moves the job to Job Scheduled on its own (server/crm/job-stage-auto.ts) — show it everywhere.
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/attention"] });
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

  // ── Dead lead (owner, 2026-10-18): no response, dead end, tire kicker — with a reason, reversible ──
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadReason, setDeadReason] = useState("");
  const deadLead = deadLeadOf(data?.customer?.customFields);
  const markDead = useMutation({
    mutationFn: async (dead: boolean) =>
      (await apiRequest("POST", `/api/crm/customers/${id}/dead-lead`, { dead, reason: dead ? deadReason.trim() || null : null })).json(),
    onSuccess: (r: any) => {
      toast(r?.dead ? { title: "Marked as a dead lead", description: "It files under Dead lead on the Clients list; reopen it any time." } : { title: "Lead reopened" });
      setDeadOpen(false); setDeadReason("");
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/crm/customers") });
    },
    onError: (e: any) => toast({ title: "Could not update the lead", description: apiErrorMessage(e), variant: "destructive" }),
  });

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
  // Tax % is pre-filled from the job-site address (server/crm/tax.ts) until the user types in it.
  const [taxTouched, setTaxTouched] = useState(false);
  const taxRate = useEstimateTaxRate(id, open);
  useEffect(() => {
    if (open && taxRate.data && !taxTouched) setTaxPct(bpsToPctText(taxRate.data.bps));
  }, [open, taxRate.data, taxTouched]);
  const [items, setItems] = useState<Item[]>([{ ...BLANK }]);
  // Drag-to-reorder of the popup's line cards (grip in each card's top-left corner).
  const [dragLine, setDragLine] = useState<number | null>(null);
  const [dragOverLine, setDragOverLine] = useState<number | null>(null);

  // ── Never lose an estimate (owner, 2026-10-21) ─────────────────────────────
  // Every change is mirrored to this device; once there is content the estimate is autosaved to the server as a
  // draft (no email/SMS) and kept up to date. Outside click / Esc never close a dialog with content; the X asks.
  // A refresh reopens the dialog with everything restored. shared/estimate-draft.ts, components/estimate-autosave.tsx
  const { data: orgForDraft } = useQuery<any>({ queryKey: ["/api/crm/org"] });
  const [finalizing, setFinalizing] = useState(false);
  // Discounts in the dialog (owner, 2026-10-21): the org's offers the client may choose (crm_estimate_discounts,
  // a tiered bundle included) and the contractor's own discount, which is a kind:"discount" line.
  const [offers, setOffers] = useState<DraftOffer[] | null>(null);
  const [contractorDiscount, setContractorDiscount] = useState<ContractorDiscount | null>(null);
  // Options as tabs (estimate-options.ts): tab 0 is Option 1 = the estimate's own lines (items / contractorDiscount);
  // further tabs are options with their own lines and discount. Saved together via PUT …/option-set.
  type ExtraTab = { key: string; id: string | null; name: string; items: Item[]; cancelled: boolean; discount: ContractorDiscount | null };
  const [tab0, setTab0] = useState<{ id: string | null; name: string; cancelled: boolean }>({ id: null, name: "Option 1", cancelled: false });
  const [extraTabs, setExtraTabs] = useState<ExtraTab[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [optionApproval, setOptionApproval] = useState<"one" | "any">("any");
  const [renamingTab, setRenamingTab] = useState<number | null>(null);
  const [nameAsk, setNameAsk] = useState<{ title: string; label: string; initial: string; run: (name: string) => void } | null>(null);
  const [pickClientFor, setPickClientFor] = useState<((c: { id: string; displayName: string }) => void) | null>(null);
  const [deleteTab, setDeleteTab] = useState<number | null>(null);
  const tabKey = () => Math.random().toString(36).slice(2);
  const tabItems: Item[] = activeTab === 0 ? items : extraTabs[activeTab - 1]?.items ?? [];
  const setTabItems = (next: Item[] | ((cur: Item[]) => Item[])) => {
    if (activeTab === 0) { setItems(next as any); return; }
    const at = activeTab - 1;
    setExtraTabs((ts) => ts.map((t, i) => (i === at ? { ...t, items: typeof next === "function" ? (next as any)(t.items) : next } : t)));
  };
  const tabDiscount: ContractorDiscount | null = activeTab === 0 ? contractorDiscount : extraTabs[activeTab - 1]?.discount ?? null;
  const setTabDiscount = (d: ContractorDiscount | null) => {
    if (activeTab === 0) { setContractorDiscount(d); return; }
    const at = activeTab - 1;
    setExtraTabs((ts) => ts.map((t, i) => (i === at ? { ...t, discount: d } : t)));
  };
  // The title follows the lines live ("Siding Remodel + Exterior Painting") until the user types in it;
  // "↺ auto title" switches back. Persisted with the draft (autosaveMeta.autoTitle).
  const [autoTitle, setAutoTitle] = useState(true);
  // An existing estimate opened in this popup (drafts and unsent estimates open here, not in the full-page editor).
  const [editingEst, setEditingEst] = useState<{ id: string; number: string | null; autosave: boolean } | null>(null);
  // The tax rate that estimate was saved with (keeping it is not "you changed it").
  const [savedTaxBps, setSavedTaxBps] = useState<number | null>(null);
  useEffect(() => {
    // Option 1 still empty while another option has lines: name the estimate after those.
    const source = items.some(lineHasContent) ? items
      : extraTabs.find((t) => !t.cancelled && t.items.some(lineHasContent))?.items ?? items;
    if (autoTitle) setTitle(autoTitleFrom(source));
  }, [autoTitle, items, extraTabs]);
  useEffect(() => {
    if (open && offers === null && orgForDraft) setOffers(defaultOffers(orgForDraft.customFields, DISCOUNT_PRESETS));
  }, [open, offers, orgForDraft]);
  const draftSnapshot: EstimateDraftSnapshot & { optionTabs?: any; optionApproval?: "one" | "any" } = {
    title, autoTitle, intro, taxPct, taxTouched, items, offers: offers ?? undefined, contractorDiscount,
    // A refresh restores an opened estimate as THAT estimate (not "New estimate"), with its saved tax rate.
    editing: editingEst, savedTaxBps,
    // Mirrored with the rest, so a refresh brings every option back too.
    optionTabs: extraTabs.length ? { tab0, extra: extraTabs } : undefined,
    optionApproval,
  };
  const autosave = useEstimateAutosave({
    orgId: orgForDraft?.id ?? null, customerId: id, open, snapshot: draftSnapshot, paused: finalizing,
  });
  const fullscreen = useDialogFullscreen(me?.member?.id ?? me?.user?.id ?? null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [resumeOffer, setResumeOffer] = useState<{ id: string; title: string; updatedAt?: string } | null>(null);
  const loadSnapshot = (snap: EstimateDraftSnapshot) => {
    setAutoTitle(snap.autoTitle !== false);
    setTitle(snap.title || "Estimate");
    setOffers(snap.offers ? snap.offers.map((o) => ({ ...o, conditions: cleanOfferConditions(o.conditions) })) : null);
    setContractorDiscount(snap.contractorDiscount ?? null);
    const ot = (snap as any).optionTabs;
    setTab0(ot?.tab0 ?? { id: null, name: "Option 1", cancelled: false });
    setExtraTabs(Array.isArray(ot?.extra) ? ot.extra : []);
    setOptionApproval((snap as any).optionApproval === "one" ? "one" : "any");
    setActiveTab(0);
    setIntro(snap.intro ?? "");
    setTaxPct(snap.taxPct ?? "0");
    setTaxTouched(!!snap.taxTouched);
    setItems(snap.items.length
      ? snap.items.map((i) => ({ ...BLANK, ...i, description: i.description ?? "", unit: i.unit ?? "", hiddenFromClient: !!i.hiddenFromClient }))
      : [{ ...BLANK }]);
  };
  const resetForm = () => {
    setItems([{ ...BLANK }]); setIntro(""); setTitle("Estimate"); setAutoTitle(true); setTaxPct("0"); setTaxTouched(false);
    setResumeOffer(null);
    setEditingEst(null);
    setSavedTaxBps(null);
    setOffers(null);
    setContractorDiscount(null);
    setTab0({ id: null, name: "Option 1", cancelled: false });
    setExtraTabs([]);
    setActiveTab(0);
    setOptionApproval("any");
    optionsJson.current = "";
  };
  /** Open a saved estimate (draft / unsent) in this popup: lines, scopes, tax, message; saves back to the same id. */
  const openEstimateInPopup = async (estimateId: string) => {
    try {
      const r = await (await apiRequest("GET", `/api/crm/estimates/${estimateId}`)).json();
      const disc = await (await apiRequest("GET", `/api/crm/estimates/${estimateId}/discounts`)).json().catch(() => null);
      const saved: DraftOffer[] | undefined = disc?.offers?.length
        ? disc.offers.map((o: any) => ({ code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null, enabled: o.enabled, rule: o.rule ?? null }))
        : undefined;
      const snap: any = snapshotFromEstimate(r.estimate, r.items ?? [], saved);
      const opts: any[] = await (await apiRequest("GET", `/api/crm/estimates/${estimateId}/options`)).json().catch(() => []);
      const tabbed = (opts ?? []).filter((o) => o.isMain || (Array.isArray(o.items) && o.items.length));
      if (tabbed.length >= 2) {
        const main = tabbed.find((o) => o.isMain) ?? null;
        const toItems = (xs: any[]): Item[] => xs.map((i) => ({ ...BLANK, ...i, description: i.description ?? "", unit: i.unit ?? "", hiddenFromClient: !!i.hiddenFromClient }));
        snap.optionTabs = {
          tab0: { id: main?.id ?? null, name: main?.name ?? "Option 1", cancelled: !!main?.cancelledAt },
          extra: tabbed.filter((o) => o !== main).map((o) => {
            // The option's generated discount line becomes its discount again (a % keeps following the prices).
            const d = discountFromOptionLines<any>(o.items ?? []);
            return { key: o.id, id: o.id, name: o.name, items: toItems(d.items), cancelled: !!o.cancelledAt, discount: d.discount };
          }),
        };
      }
      snap.optionApproval = r.estimate.optionApproval === "one" ? "one" : "any";
      loadSnapshot(snap);
      autosave.adopt(estimateId, snap);
      setEditingEst({ id: estimateId, number: r.estimate.number ?? null, autosave: !!r.estimate.autosave });
      setSavedTaxBps(typeof r.estimate.taxRateBps === "number" ? r.estimate.taxRateBps : null);
      setResumeOffer(null);
      setOpen(true);
    } catch (e: any) {
      toast({ title: "Could not open the estimate", description: apiErrorMessage(e), variant: "destructive" });
    }
  };
  // ?openEstimate=<id> (from the Estimates list, or "Copy to another client") opens that estimate here. Keyed on the
  // client + estimate, because navigating to another client reuses this page component.
  const search = useSearch();
  const [openedFromUrl, setOpenedFromUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !orgForDraft?.id) return;
    const want = new URLSearchParams(search).get("openEstimate");
    if (!want || openedFromUrl === `${id}:${want}`) return;
    setOpenedFromUrl(`${id}:${want}`);
    window.history.replaceState(null, "", window.location.pathname);
    void openEstimateInPopup(want);
  }, [id, orgForDraft?.id, search]);
  // After a refresh (or a crash): reopen with everything that was typed.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !orgForDraft?.id || restoredFor === id) return;
    setRestoredFor(id);
    const m = autosave.readMirror();
    if (m && m.open && (draftHasContent(m) || m.editing)) {
      loadSnapshot(m);
      autosave.adopt(m.draftId ?? m.editing?.id ?? null);
      if (m.editing) setEditingEst(m.editing);
      setSavedTaxBps(typeof m.savedTaxBps === "number" ? m.savedTaxBps : null);
      setOpen(true);
      toast({ title: "Your unsaved estimate is back", description: "Everything you typed was kept." });
    }
  }, [id, orgForDraft?.id]);

  // Totals: shared/estimate-totals.ts, the same function the server recomputes with (tax after discounts).
  const taxBps = Math.round(parseFloat(taxPct || "0") * 100);
  const cdLine = contractorDiscountLine(tabDiscount, tabItems);
  const totals = computeApprovalTotals([...tabItems, ...(cdLine ? [cdLine] : [])], taxBps, []);
  const subtotal = totals.subtotalCents;
  const discount = totals.lineDiscountCents;
  const tax = totals.taxCents;
  const total = totals.totalCents;

  // The client's HOVER takeoff (if any): a picked price-book item takes its quantity from it.
  const { data: takeoffData } = useQuery<{ takeoff: HoverTakeoff | null }>({
    queryKey: [`/api/crm/customers/${id}/takeoff`],
    enabled: !!id && open,
    retry: false,
  });
  const estTakeoff = takeoffData?.takeoff ?? null;
  // Any HOVER capture on file makes the job stage read Bid at the very least.
  const { data: stageTakeoff } = useQuery<{ takeoff: unknown; takeoffs?: unknown[] }>({
    queryKey: [`/api/crm/customers/${id}/takeoff`, "stage"],
    queryFn: async () => (await apiRequest("GET", `/api/crm/customers/${id}/takeoff`)).json(),
    enabled: !!id,
    retry: false,
  });

  const optionsJson = useRef("");
  // The tabs' server ids as of the last option-set save (state lags inside an async handler; see "copy").
  const optIdsRef = useRef<{ main: string | null; extra: (string | null)[] }>({ main: null, extra: [] });
  optIdsRef.current = { main: tab0.id, extra: extraTabs.map((t) => t.id) };
  // autosavePayload keeps a priced line with no name as "Untitled item" — the totals counted it, so it is saved.
  const optionSetBody = () => ({
    options: extraTabs.length === 0 ? [] : [
      { id: tab0.id, name: tab0.name, cancelled: tab0.cancelled, items: autosavePayload({ ...draftSnapshot, items }).items },
      ...extraTabs.map((t) => ({
        id: t.id, name: t.name, cancelled: t.cancelled,
        items: autosavePayload({ ...draftSnapshot, items: t.items, contractorDiscount: t.discount }).items,
      })),
    ],
  });
  const syncOptions = async (estId: string) => {
    const body = optionSetBody();
    const json = JSON.stringify([body, optionApproval]);
    if (json === optionsJson.current) return;
    if (!body.options.length && !tab0.id && optionsJson.current === "") { optionsJson.current = json; return; }
    const r = await (await apiRequest("PUT", `/api/crm/estimates/${estId}/option-set`, body)).json();
    await apiRequest("PUT", `/api/crm/estimates/${estId}/option-approval`, { mode: optionApproval });
    const rows: any[] = r.options ?? [];
    const main = rows.find((o) => o.isMain);
    // Rows come back in tab order (tier); an empty new tab must get its id too, or every save adds another row.
    const extra = rows.filter((o) => !o.isMain && Array.isArray(o.items));
    setTab0((t) => ({ ...t, id: main?.id ?? null }));
    setExtraTabs((ts) => ts.map((t, i) => ({ ...t, id: extra[i]?.id ?? t.id })));
    optIdsRef.current = { main: main?.id ?? null, extra: extraTabs.map((t, i) => extra[i]?.id ?? t.id) };
    optionsJson.current = json;
  };
  useEffect(() => {
    if (!open || !autosave.draftId) return;
    const t = setTimeout(() => { syncOptions(autosave.draftId!).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [open, autosave.draftId, JSON.stringify(extraTabs), JSON.stringify(tab0), optionApproval, JSON.stringify(items)]);

  const flushAll = async (): Promise<string | null> => {
    const id = await autosave.saveNow();
    const estId = id ?? autosave.draftId;
    if (estId) await syncOptions(estId);
    return estId;
  };
  const optionLines = (i: number) => (i === 0 ? items : extraTabs[i - 1]?.items ?? []).filter(lineHasContent);
  const saveTemplate = (name: string, tabIndex: number | null) => {
    const lines = tabIndex == null ? items.filter(lineHasContent) : optionLines(tabIndex);
    const disc = tabIndex == null || tabIndex === 0 ? contractorDiscount : extraTabs[tabIndex - 1]?.discount ?? null;
    return apiRequest("POST", "/api/crm/estimate-templates", {
      name, title: tabIndex == null ? title : null, introText: intro || null,
      items: autosavePayload({ ...draftSnapshot, items: lines, contractorDiscount: null }).items,
      offers: offers ? offersPayload(offers) : null, contractorDiscount: disc,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/estimate-templates"] });
      toast({ title: "Template saved", description: name });
    }).catch((e: any) => toast({ title: "Could not save the template", description: apiErrorMessage(e), variant: "destructive" }));
  };
  const openCopy = (est: any) => {
    toast({ title: `Copied to ${est.number ?? "a new estimate"}`, description: "Opening it now." });
    autosave.keepClosed(); autosave.reset(); resetForm(); setOpen(false);
    queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
    if (est.customerId === id) void openEstimateInPopup(est.id);
    else setLocation(`/crm/clients/${est.customerId}?openEstimate=${est.id}`);
  };
  const onOptionAction = async (i: number, a: OptionAction) => {
    const name = i === 0 ? tab0.name : extraTabs[i - 1]?.name ?? "";
    if (a === "rename") { setRenamingTab(i); return; }
    if (a === "duplicate") {
      const src = i === 0 ? items : extraTabs[i - 1].items;
      const copy: Item[] = src.map((x) => ({ ...x }));
      setExtraTabs((ts) => [...ts, { key: tabKey(), id: null, name: `${name} (copy)`, items: copy, cancelled: false, discount: i === 0 ? contractorDiscount : extraTabs[i - 1].discount }]);
      setActiveTab(extraTabs.length + 1);
      return;
    }
    if (a === "cancel" || a === "restore") {
      const v = a === "cancel";
      if (i === 0) setTab0((t) => ({ ...t, cancelled: v }));
      else setExtraTabs((ts) => ts.map((t, j) => (j === i - 1 ? { ...t, cancelled: v } : t)));
      return;
    }
    if (a === "delete") { setDeleteTab(i); return; }
    if (a === "template") {
      setNameAsk({ title: "Save option as template", label: "A name you'll recognise in the Templates list.", initial: name, run: (n) => void saveTemplate(n, i) });
      return;
    }
    // copy to a new estimate: the option must be saved first
    const estId = await flushAll();
    if (!estId) { toast({ title: "Add a line first", description: "There is nothing to copy yet." }); return; }
    // Read after the flush: a tab saved just now has its id only in the ref, not in this render's state.
    const optId = i === 0 ? optIdsRef.current.main : optIdsRef.current.extra[i - 1] ?? null;
    const go = async (customerId?: string) => {
      try {
        const est = optId
          ? await (await apiRequest("POST", `/api/crm/estimates/${estId}/options/${optId}/copy-to-estimate`, customerId ? { customerId } : {})).json()
          : await (await apiRequest("POST", `/api/crm/estimates/${estId}/duplicate`, customerId ? { customerId } : {})).json();
        openCopy(est);
      } catch (e: any) {
        toast({ title: "Could not copy", description: apiErrorMessage(e), variant: "destructive" });
      }
    };
    if (a === "copy-same") await go();
    else setPickClientFor(() => (c: { id: string }) => { setPickClientFor(null); void go(c.id); });
  };
  const onEstimateAction = async (a: EstimateAction) => {
    if (a === "template") {
      setNameAsk({ title: "Save estimate as template", label: "Lines, scopes, discounts and the message are saved.", initial: title, run: (n) => void saveTemplate(n, null) });
      return;
    }
    const estId = await flushAll();
    if (!estId) { toast({ title: "Add a line first", description: "There is nothing to copy yet." }); return; }
    const go = async (customerId?: string) => {
      try { openCopy(await (await apiRequest("POST", `/api/crm/estimates/${estId}/duplicate`, customerId ? { customerId } : {})).json()); }
      catch (e: any) { toast({ title: "Could not copy", description: apiErrorMessage(e), variant: "destructive" }); }
    };
    if (a === "duplicate") await go();
    else setPickClientFor(() => (c: { id: string }) => { setPickClientFor(null); void go(c.id); });
  };
  const templateItems = (t: EstimateTemplate): Item[] =>
    (t.items ?? []).filter((x: any) => x.kind !== "discount").map((x: any) => ({ ...BLANK, ...x, description: x.description ?? "", unit: x.unit ?? "", hiddenFromClient: !!x.hiddenFromClient }));
  const applyTemplate = (t: EstimateTemplate) => {
    setItems(templateItems(t).length ? templateItems(t) : [{ ...BLANK }]);
    if (t.introText) setIntro(t.introText);
    if (t.title) { setTitle(t.title); setAutoTitle(false); }
    if (Array.isArray(t.offers) && t.offers.length) setOffers(t.offers as any);
    setContractorDiscount(t.contractorDiscount ?? null);
    setActiveTab(0);
    toast({ title: `Started from "${t.name}"` });
  };
  const addTemplateAsOption = (t: EstimateTemplate) => {
    setExtraTabs((ts) => [...ts, { key: tabKey(), id: null, name: t.name.slice(0, 80), items: templateItems(t), cancelled: false, discount: t.contractorDiscount ?? null }]);
    setActiveTab(extraTabs.length + 1);
  };

  // 0 idle; 1 = the promoted option just landed (the auto title follows it this render); 2 = create.
  const [createAfterPromote, setCreateAfterPromote] = useState(0);
  const createOrPromote = () => {
    if (!items.some(lineHasContent)) {
      const k = extraTabs.findIndex((t) => !t.cancelled && t.items.some(lineHasContent));
      if (k >= 0) {
        const next = extraTabs[k];
        setItems(next.items);
        setContractorDiscount(next.discount);
        setTab0({ id: next.id, name: next.name, cancelled: next.cancelled });
        setExtraTabs((ts) => ts.filter((_, j) => j !== k));
        setActiveTab(0);
        setCreateAfterPromote(1);
        return;
      }
    }
    createEstimate.mutate();
  };
  useEffect(() => {
    if (createAfterPromote === 1) { setCreateAfterPromote(2); return; }
    if (createAfterPromote !== 2) return;
    setCreateAfterPromote(0);
    createEstimate.mutate();
  }, [createAfterPromote]); // eslint-disable-line react-hooks/exhaustive-deps

  const createEstimate = useMutation({
    mutationFn: async () => {
      // A line with a price but no name yet is saved as "Untitled item" (autosavePayload), as the totals counted it.
      if (!items.some(lineHasContent)) throw new Error("Add at least one line item");
      const body = autosavePayload(draftSnapshot);
      const putOffers = async (estId: string) => {
        if (offers) await apiRequest("PUT", `/api/crm/estimates/${estId}/discounts`, { offers: offersPayload(offers) });
      };
      setFinalizing(true);
      // Wait for an autosave POST still on its way, so its draft is the one saved here (never a second estimate).
      const draftId = await autosave.settle();
      let ok = false;
      try {
        // Already autosaved as a draft, or an existing estimate opened here: save THAT estimate — never a duplicate.
        if (draftId) {
          const saved = await (await apiRequest("PATCH", `/api/crm/estimates/${draftId}`, { ...body, autosave: false })).json();
          await putOffers(draftId);
          await syncOptions(draftId);
          ok = true;
          return saved;
        }
        const created = await (await apiRequest("POST", "/api/crm/estimates", { customerId: id, ...body })).json();
        await putOffers(created.id);
        if (extraTabs.length) await syncOptions(created.id);
        ok = true;
        return created;
      } finally {
        if (!ok) autosave.release();
        setFinalizing(false);
      }
    },
    onSuccess: () => {
      const wasEditing = editingEst && !editingEst.autosave;
      setOpen(false);
      autosave.reset();
      resetForm();
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
      toast({ title: wasEditing ? "Estimate saved" : "Estimate created" });
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

  // "Send me a proof": the client's exact email, to the logged-in member only
  // (the link inside is a read-only preview; nothing about the estimate changes).
  const proof = useMutation({
    mutationFn: async (estimateId: string) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/send-proof`, {})).json(),
    onSuccess: (r: any) => toast({ title: `Proof sent to ${r.to}` }),
    onError: (e: any) => toast({ title: "Could not send proof", description: apiErrorMessage(e), variant: "destructive" }),
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
        level={1}
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
  const estimates = estimateSort.sorted(data.estimates ?? [], {
    number: (e: any) => docNumberValue(e.number),
    title: (e: any) => e.title,
    status: (e: any) => e.status,
    // A signed estimate's figure is what the client signed for.
    total: (e: any) => (e.approvedAt && e.approvedTotalCents != null ? e.approvedTotalCents : e.totalCents),
    created: (e: any) => e.createdAt,
  });

  // One prefill for both Schedule buttons; the Job stage card passes the project (a start date, not a site visit).
  const openSchedule = (projectId?: string | null) => {
    const { start, end } = nextVisitSlot();
    setApptProjectId(projectId ?? null);
    setApptTitle(projectId ? `${c.displayName} — project start` : `${c.displayName} — site visit`);
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
                {/* Phone width: the "i" and Watch wrap under a long name instead of widening the page. */}
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                  <h1 className="text-2xl font-semibold tracking-tight break-words">{c.displayName}</h1>
                  <InfoTip k="client-detail" />
                  {/* The client-page walkthrough (quick actions). Static key: this title is not a CrmPageHeader. */}
                  <HelpButton k="crm-client-quick-actions" videoOnly />
                </div>
                {interestMap?.byCustomer[c.id] && (
                  <div className="mt-1"><InterestBadge summary={interestMap.byCustomer[c.id]} testId="badge-client-interest-page" /></div>
                )}
                {c.companyName && c.companyName !== c.displayName && (
                  <div className="text-sm text-muted-foreground mt-0.5">{c.companyName}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                  {c.email && (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <a href={`mailto:${c.email}`} title="Send an email"
                        className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-foreground hover:underline underline-offset-2 transition-colors"
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
              {deadLead && (
                <span className="inline-flex items-center rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  title={`Since ${new Date(deadLead.at).toLocaleDateString()}${deadLead.reason ? ` — ${deadLead.reason}` : ""}`} data-testid="pill-dead-lead">
                  Dead lead{deadLead.reason ? ` · ${deadLead.reason}` : ""}
                </span>
              )}
              {(canManageCustomers || canEstimate) && (deadLead ? (
                <Button variant="outline" size="sm" onClick={() => markDead.mutate(false)} disabled={markDead.isPending} data-testid="button-reopen-lead">
                  Reopen lead
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setDeadOpen(true)} data-testid="button-dead-lead">
                  Dead lead
                </Button>
              ))}
              <Dialog open={deadOpen} onOpenChange={setDeadOpen}>
                <DialogContent className="max-w-md" data-testid="dialog-dead-lead">
                  <DialogHeader>
                    <DialogTitle>Mark {c.displayName} as a dead lead?</DialogTitle>
                    <DialogDescription>No response, a dead end, a tire kicker — say which, so the next person knows. It moves to the Dead lead tab and can be reopened any time.</DialogDescription>
                  </DialogHeader>
                  <div>
                    <Label htmlFor="dead-reason">Why</Label>
                    <Input id="dead-reason" value={deadReason} onChange={(e) => setDeadReason(e.target.value)} placeholder="No response after three calls" maxLength={300} data-testid="input-dead-reason" />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeadOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={() => markDead.mutate(true)} disabled={markDead.isPending || deadReason.trim().length < 3} data-testid="button-confirm-dead-lead">
                      Mark dead lead
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {canManageCustomers && data.portalPath && <ViewAsClientButton customerId={id!} />}
              {canManageCustomers && (
                <>
                  <Button variant="outline" size="sm" data-testid="button-edit-client" onClick={openEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Dialog open={editOpen} onOpenChange={setEditOpen}>
                    <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-client">
                      <DialogHeader><DialogTitle>Edit {c.displayName}</DialogTitle><DialogDescription>Update this client's name and contact details.</DialogDescription></DialogHeader>
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

      {/* Where this client's job stands: Bid → Bid Submitted → Approved → Job Scheduled → In progress → Closed out
          (shared/job-stage.ts), with the start-date reminder, the scheduled visit and the punch list & walkthrough. */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <p className="mb-3 text-sm font-bold">Job stage</p>
          <JobStageControl customer={c} estimates={estimates} projects={data.projects ?? []} appointments={appointments}
            companyName={me?.org?.name ?? "us"} canEdit={canManageJobs} measured={!!stageTakeoff?.takeoffs?.length || !!stageTakeoff?.takeoff}
            canSeePrices={canSeePrices} canAttach={canManageCustomers} canText={canManageCustomers}
            celebrations={(me?.org?.customFields as any)?.celebrations !== false} flow={flow}
            onSchedule={canManageJobs ? openSchedule : undefined} />
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
                onClick={() => openSchedule()}>
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

      {/* The HOVER report's details, imported (renders nothing without a HOVER capture). */}
      {/* The containers below sit in the account's order (Settings → Client page); owners/admins can remove one. */}
      <ClientSections layout={layout}>
      <ClientSection id="hover" layout={layout} when={!!id}>
      {id && <HoverTakeoffCard customerId={id} />}
      </ClientSection>
      <ClientSection id="payments" layout={layout} when={canSeePrices}>
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
      </ClientSection>
      <ClientSection id="schedule" layout={layout}>
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
              onClick={() => openSchedule()}>
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
      </ClientSection>
      <ClientSection id="estimates" layout={layout}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
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
            <Dialog open={open} onOpenChange={(next) => {
              if (next) {
                // An unfinished autosaved draft for this client: offer to continue it instead of starting a duplicate.
                const prior = (data?.estimates ?? []).find((x: any) => x.autosave && x.status === "draft" && !x.sentAt);
                if (prior && !autosave.draftId && !autosave.hasContent) setResumeOffer({ id: prior.id, title: prior.title, updatedAt: prior.updatedAt });
                setOpen(true);
                return;
              }
              // An existing estimate opened here is saved as you type: one last save, then close.
              if (editingEst && !editingEst.autosave) {
                void autosave.saveNow().then((saved) => {
                  // Read the LIVE status: this render's value is from before the save.
                  if (!saved || autosave.getStatus() === "error") {
                    toast({ title: "Not saved to the server", description: "Your changes are kept on this device; try closing again in a moment.", variant: "destructive" });
                    return;
                  }
                  autosave.keepClosed(); autosave.reset(); resetForm(); setOpen(false);
                  queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
                });
                return;
              }
              // Outside click and Esc are blocked below; the X with content asks first.
              if (autosave.hasContent) { setConfirmClose(true); return; }
              setOpen(false);
              autosave.reset();
            }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-estimate"><Plus className="h-4 w-4 mr-2" /> New estimate</Button>
              </DialogTrigger>
              <DialogContent
                className={fullscreen.full
                  ? "max-w-none w-screen h-[100dvh] max-h-[100dvh] sm:rounded-none overflow-y-auto flex flex-col"
                  : "max-w-3xl max-h-[92vh] overflow-y-auto"}
                onInteractOutside={(e) => { if (autosave.hasContent) e.preventDefault(); }}
                onEscapeKeyDown={(e) => { if (autosave.hasContent) e.preventDefault(); }}
                data-testid="dialog-new-estimate" data-fullscreen={fullscreen.full ? "1" : "0"}>
                <FullscreenToggle full={fullscreen.full} onToggle={fullscreen.toggle} />
                <div className="flex flex-wrap items-center justify-end gap-2 pr-16 -mb-2">
                  <TemplatesMenu onUse={applyTemplate} onAddAsOption={addTemplateAsOption} />
                  <EstimateMenu onAction={onEstimateAction} />
                </div>
                <DialogHeader>
                  <DialogTitle>{editingEst ? `Estimate ${editingEst.number ?? ""} for ${c.displayName}` : `New estimate for ${c.displayName}`}</DialogTitle>
                  <DialogDescription>
                    Add the line items, then save it as a draft or send it. Your work saves itself as you type.
                    {autosave.draftId && (
                      <> {" "}<button type="button" className="text-primary hover:underline" data-testid="link-open-full-editor"
                        onClick={async () => {
                          const saved = await autosave.saveNow();
                          const target = saved ?? autosave.draftId;
                          if (!target) return;
                          autosave.keepClosed(); autosave.reset(); resetForm(); setOpen(false);
                          setLocation(`/crm/estimates/${target}?edit=1&full=1`);
                        }}>Open full editor</button></>
                    )}
                  </DialogDescription>
                </DialogHeader>
                {resumeOffer && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm flex flex-wrap items-center gap-2" data-testid="banner-resume-draft">
                    <span className="flex-1 min-w-[12rem]">You have an unfinished draft, <strong>{resumeOffer.title}</strong>. Continue it?</span>
                    <Button size="sm" data-testid="button-resume-draft" onClick={() => openEstimateInPopup(resumeOffer.id)}>Continue draft</Button>
                    <Button size="sm" variant="outline" data-testid="button-start-new-draft" onClick={() => setResumeOffer(null)}>Start a new one</Button>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="e-title">Title</Label>
                      {autoTitle ? (
                        <span className="text-[11px] text-muted-foreground" data-testid="text-auto-title">auto, from the lines</span>
                      ) : (
                        <button type="button" className="text-[11px] text-primary hover:underline" data-testid="button-auto-title"
                          title="Name the estimate after its lines again" onClick={() => setAutoTitle(true)}>↺ auto title</button>
                      )}
                    </div>
                    <Input id="e-title" value={title} onChange={(e) => { setAutoTitle(false); setTitle(e.target.value); }}
                      data-testid="input-estimate-title" />
                  </div>
                  <div>
                    <Label htmlFor="e-tax">Tax %</Label>
                    <Input id="e-tax" inputMode="decimal" value={taxPct} data-testid="input-estimate-tax"
                      onChange={(e) => { setTaxTouched(true); setTaxPct(e.target.value); }} />
                  </div>
                </div>
                <TaxRateNote rate={taxRate.data} loading={taxRate.isLoading} currentBps={taxBps} savedBps={savedTaxBps} />
                <div>
                  <Label htmlFor="e-intro">Message to the client</Label>
                  <Textarea id="e-intro" rows={fullscreen.full ? 4 : 2} value={intro} onChange={(e) => setIntro(e.target.value)}
                    placeholder="Thanks for having us out — here's the scope we discussed." />
                </div>

                <Separator />
                {/* Options as tabs: "Option 1 | Option 2 | + Add option" (estimate-options.ts). */}
                <OptionTabsBar
                  tabs={[{ key: "main", name: tab0.name, cancelled: tab0.cancelled }, ...extraTabs.map((t) => ({ key: t.key, name: t.name, cancelled: t.cancelled }))]}
                  active={activeTab}
                  onSelect={setActiveTab}
                  onAdd={() => { setExtraTabs((ts) => [...ts, { key: tabKey(), id: null, name: `Option ${ts.length + 2}`, items: [{ ...BLANK }], cancelled: false, discount: null }]); setActiveTab(extraTabs.length + 1); }}
                  onAction={(i, a) => void onOptionAction(i, a)}
                  renamingIndex={renamingTab}
                  onRename={(i, n) => {
                    setRenamingTab(null);
                    if (!n) return;
                    if (i === 0) setTab0((t) => ({ ...t, name: n.slice(0, 80) }));
                    else setExtraTabs((ts) => ts.map((t, j) => (j === i - 1 ? { ...t, name: n.slice(0, 80) } : t)));
                  }} />
                {extraTabs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="row-option-approval">
                    <span className="text-muted-foreground">Customer can approve</span>
                    <select value={optionApproval} onChange={(e) => setOptionApproval(e.target.value as "one" | "any")}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm" data-testid="select-option-approval">
                      <option value="one">Only one option</option>
                      <option value="any">Any options</option>
                    </select>
                    {(activeTab === 0 ? tab0.cancelled : extraTabs[activeTab - 1]?.cancelled) && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">This option is cancelled — hidden from the client.</span>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {tabItems.map((it, idx) => (
                    // A clearly outlined card per scope; drag it by the grip (top-left) to reorder.
                    <div key={idx}
                      className={`relative grid gap-2 sm:grid-cols-12 items-end rounded-md border-2 border-foreground/25 p-2 pl-8 ${dragOverLine === idx && dragLine !== null && dragLine !== idx ? "ring-2 ring-primary" : ""} ${dragLine === idx ? "opacity-50" : ""}`}
                      draggable={dragLine === idx}
                      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(idx)); }}
                      onDragOver={(ev) => { if (dragLine === null) return; ev.preventDefault(); setDragOverLine(idx); }}
                      onDrop={(ev) => {
                        ev.preventDefault();
                        const from = dragLine;
                        setDragLine(null); setDragOverLine(null);
                        if (from === null || from === idx) return;
                        setTabItems((cur) => { const a = [...cur]; const [m] = a.splice(from, 1); a.splice(idx, 0, m); return a; });
                      }}
                      onDragEnd={() => { setDragLine(null); setDragOverLine(null); }}
                      data-testid={`line-item-${idx}`}>
                      <span className="absolute left-1.5 top-2 cursor-grab active:cursor-grabbing rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Drag to reorder" aria-label={`Drag to reorder line ${idx + 1}`}
                        onMouseDown={() => setDragLine(idx)} onMouseUp={() => setDragLine(null)}
                        data-testid={`drag-line-${idx}`}>
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="sm:col-span-5">
                        <Label className="text-xs">Item</Label>
                        {/* Search the price book; a pick fills the line (and the qty from the HOVER takeoff when one matches). */}
                        <PricebookItemInput value={it.name} placeholder="Search your price book, or type an item" testId={`input-item-name-${idx}`}
                          onChange={(v) => setTabItems(tabItems.map((x, i) => i === idx ? { ...x, name: v } : x))}
                          quantityFor={(line) => (estTakeoff ? takeoffQuantityForLine(line, estTakeoff)?.quantity ?? null : null)}
                          onPick={(pb) => {
                            const fromHover = estTakeoff ? takeoffQuantityForLine({ name: pb.name, unit: pb.unit }, estTakeoff) : null;
                            // Functional update: a slow price lookup never puts back lines edited meanwhile.
                            setTabItems((cur) => cur.map((x, i) => i === idx ? {
                              ...x, name: pb.name, unit: pb.unit ?? "", description: pb.description, taxable: pb.taxable,
                              unitPriceCents: pb.unitPriceCents, quantityMilli: Math.round((fromHover?.quantity ?? 1) * 1000),
                              pricebookItemId: pb.id, listPriceCents: pb.listPriceCents, listField: pb.listField,
                              scopeCategory: pb.scopeCategory,
                            } : x));
                            if (pb.fromLastUse) toast({ title: "Last price and scope filled in", description: "From the last estimate this item was on." });
                            if (fromHover) toast({ title: `Quantity from HOVER: ${fromHover.quantity} ${pb.unit ?? ""}`.trim(), description: "Check it before you send." });
                          }} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Qty</Label>
                        <Input type="number" step="0.01" value={it.quantityMilli / 1000}
                          onChange={(e) => setTabItems(tabItems.map((x, i) => i === idx
                            ? { ...x, quantityMilli: Math.round((parseFloat(e.target.value) || 0) * 1000) } : x))} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Unit price</Label>
                        <Input type="number" step="0.01" value={(it.unitPriceCents / 100).toString()}
                          onChange={(e) => setTabItems(tabItems.map((x, i) => i === idx
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
                          onClick={() => setTabItems(tabItems.length > 1 ? tabItems.filter((_, i) => i !== idx) : [{ ...BLANK }])}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {/* Scope category (bundle discounts) and, for a re-priced price-book line, the one-click list update. */}
                      <div className="sm:col-span-12 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Scope</span>
                        <select value={lineCategory(it)} data-testid={`select-item-category-${idx}`}
                          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                          onChange={(e) => setTabItems(tabItems.map((x, i) => i === idx ? { ...x, scopeCategory: e.target.value } : x))}>
                          {SCOPE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{SCOPE_CATEGORY_LABEL[cat]}</option>)}
                        </select>
                        {it.pricebookItemId && it.listField && it.listPriceCents != null && it.unitPriceCents !== it.listPriceCents
                          && me?.permissions?.managePriceBook && (
                          <button type="button" className="text-primary hover:underline" data-testid={`button-update-pricebook-${idx}`}
                            onClick={async () => {
                              try {
                                await apiRequest("PATCH", `/api/crm/pricebook/items/${it.pricebookItemId}`, { [it.listField!]: it.unitPriceCents });
                                setTabItems((cur) => cur.map((x, i) => i === idx ? { ...x, listPriceCents: it.unitPriceCents } : x));
                                queryClient.invalidateQueries({ queryKey: ["/api/crm/pricebook/items"] });
                                toast({ title: `Price book updated to ${money(it.unitPriceCents)}`, description: it.name });
                              } catch (e: any) {
                                toast({ title: "Could not update the price book", description: apiErrorMessage(e), variant: "destructive" });
                              }
                            }}>
                            Update price book to {money(it.unitPriceCents)} (list {money(it.listPriceCents)})
                          </button>
                        )}
                      </div>
                      {/* The scope the client actually reads — persists to the
                          line's description and renders on the estimate. */}
                      <div className="sm:col-span-12">
                        <Label className="text-xs">Scope &amp; details (shown to the client)</Label>
                        <Textarea rows={fullscreen.full ? 8 : 2} value={it.description ?? ""}
                          className={fullscreen.full ? "min-h-[28vh]" : undefined}
                          data-testid={`input-item-scope-${idx}`}
                          placeholder="What's included — materials, prep, warranty, exclusions…"
                          onChange={(e) => setTabItems(tabItems.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setTabItems([...tabItems, { ...BLANK }])}
                    data-testid="button-add-item">
                    <Plus className="h-4 w-4 mr-2" /> Add line
                  </Button>
                </div>

                <div className="rounded-md border p-3 space-y-3" data-testid="section-estimate-discounts">
                  <div className="text-sm font-medium">Discounts</div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end">
                    <div>
                      <Label className="text-xs">Your discount (shows as a line)</Label>
                      <Input value={tabDiscount?.label ?? ""} placeholder="Discount"
                        data-testid="input-contractor-discount-label"
                        onChange={(e) => setTabDiscount({ mode: tabDiscount?.mode ?? "amount", value: tabDiscount?.value ?? "", label: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Amount</Label>
                      <Input className="w-28" inputMode="decimal" value={tabDiscount?.value ?? ""} placeholder="0"
                        data-testid="input-contractor-discount-value"
                        onChange={(e) => setTabDiscount({ mode: tabDiscount?.mode ?? "amount", label: tabDiscount?.label ?? "", value: e.target.value })} />
                    </div>
                    <select value={tabDiscount?.mode ?? "amount"} data-testid="select-contractor-discount-mode"
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      onChange={(e) => setTabDiscount({ label: tabDiscount?.label ?? "", value: tabDiscount?.value ?? "", mode: e.target.value as "amount" | "percent" })}>
                      <option value="amount">$</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                  {(offers ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">Offers the client can choose on the estimate page</div>
                      {(offers ?? []).map((o, oi) => {
                        const eff = effectiveOffer(o, [...tabItems, ...(cdLine ? [cdLine] : [])]);
                        const rule = bundleRuleOf(o.rule);
                        return (
                          <label key={o.code} className={`flex items-start gap-2 text-sm ${eff.available ? "" : "opacity-60"}`} data-testid={`offer-${o.code}`}>
                            <Checkbox checked={o.enabled} className="mt-0.5"
                              onCheckedChange={(v) => setOffers((cur) => (cur ?? []).map((x, j) => j === oi ? { ...x, enabled: v === true } : x))}
                              data-testid={`check-offer-${o.code}`} />
                            <span>
                              {o.label}{" "}
                              <span className="text-primary">{!eff.available ? "not available"
                                : o.code === "price_match" && !(eff.percentBps > 0) ? "we'll match it"
                                : `−${Number((eff.percentBps / 100).toFixed(2))}%`}</span>
                              {o.conditions && (
                                // What the client must do to qualify (shown to them too) — e.g. price match needs the competing estimate.
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button type="button" className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground"
                                      aria-label={`How to qualify for ${o.label}`} onClick={(ev) => ev.stopPropagation()}
                                      data-testid={`info-offer-${o.code}`}>
                                      <Info className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 text-sm" side="top">{o.conditions}</PopoverContent>
                                </Popover>
                              )}
                              {rule && <span className="block text-xs text-muted-foreground">{bundleRuleText(rule)}</span>}
                              {!eff.available && eff.reason && <span className="block text-xs text-amber-700 dark:text-amber-400" data-testid={`text-offer-reason-${o.code}`}>{eff.reason}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="text-sm space-y-1 text-right">
                  <div>Subtotal <span className="font-medium ml-3">{money(subtotal)}</span></div>
                  {discount > 0 && <div>Discount <span className="font-medium ml-3">−{money(discount)}</span></div>}
                  <div>Tax <span className="font-medium ml-3">{money(tax)}</span></div>
                  <div className="text-lg font-bold">Total <span className="ml-3">{money(total)}</span></div>
                </div>

                <DialogFooter className="items-center gap-2">
                  <span className="mr-auto"><AutosaveIndicator status={autosave.status} savedAt={autosave.savedAt} error={autosave.error} /></span>
                  <Button onClick={createOrPromote} disabled={createEstimate.isPending || createAfterPromote > 0}
                    data-testid="button-save-estimate">
                    {createEstimate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {editingEst && !editingEst.autosave ? "Save estimate" : "Create estimate"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canEstimate && (
            <>
              <NameDialog open={!!nameAsk} title={nameAsk?.title ?? ""} label={nameAsk?.label ?? ""} initial={nameAsk?.initial ?? ""}
                onCancel={() => setNameAsk(null)} onSubmit={(n) => { const run = nameAsk?.run; setNameAsk(null); run?.(n); }} />
              <ClientPickerDialog open={!!pickClientFor} excludeId={id} onCancel={() => setPickClientFor(null)}
                onPick={(cl) => pickClientFor?.(cl)} />
              <ConfirmDeleteOption name={deleteTab == null ? null : deleteTab === 0 ? tab0.name : extraTabs[deleteTab - 1]?.name ?? null}
                onCancel={() => setDeleteTab(null)}
                onConfirm={() => {
                  const i = deleteTab!;
                  setDeleteTab(null);
                  if (i === 0) {
                    // Option 1 goes: the next option becomes Option 1 (the estimate's own lines).
                    const [next, ...rest] = extraTabs;
                    if (!next) return;
                    setItems(next.items.length ? next.items : [{ ...BLANK }]);
                    setContractorDiscount(next.discount);
                    setTab0({ id: next.id, name: next.name, cancelled: next.cancelled });
                    setExtraTabs(rest);
                  } else {
                    setExtraTabs((ts) => ts.filter((_, j) => j !== i - 1));
                  }
                  setActiveTab(0);
                }} />
            </>
          )}
          {canEstimate && (
            <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
              <AlertDialogContent data-testid="dialog-confirm-close-estimate">
                <AlertDialogHeader>
                  <AlertDialogTitle>Keep this estimate?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Save it as a draft on {c.displayName}'s estimates to finish later, or throw it away.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2">
                  <AlertDialogCancel data-testid="button-keep-editing">Keep editing</AlertDialogCancel>
                  <Button variant="outline" data-testid="button-discard-estimate" onClick={async () => {
                    const draft = await autosave.settle();
                    if (draft) {
                      try { await apiRequest("DELETE", `/api/crm/estimates/${draft}/autosave`); } catch { /* best-effort; it stays a draft */ }
                    }
                    autosave.reset();
                    resetForm();
                    setConfirmClose(false);
                    setOpen(false);
                    queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
                  }}>Discard</Button>
                  <Button data-testid="button-save-draft-close" onClick={async () => {
                    const saved = await autosave.saveNow();
                    if (!saved) {
                      toast({ title: "Not saved to the server", description: "It is kept on this device; try again in a moment.", variant: "destructive" });
                      setConfirmClose(false);
                      return;
                    }
                    autosave.keepClosed();
                    autosave.reset();
                    resetForm();
                    setConfirmClose(false);
                    setOpen(false);
                    queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${id}`] });
                    toast({ title: "Saved as a draft", description: "It's in this client's estimates." });
                  }}>Save as draft</Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
          {estimates.length > 1 && (
            <SortButtons columns={CLIENT_ESTIMATE_SORT_COLUMNS.filter((col) => col.key !== "total" || canSeePrices)}
              sort={estimateSort.sort} onSort={estimateSort.onSort} onChange={estimateSort.setSort} testId="sort-client-estimates" />
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
                <div className="flex flex-wrap items-center gap-2">
                  {/* Edit verbiage / add work scopes — opens the full editor.
                      Available on drafts AND sent estimates (the client link
                      reflects edits immediately); hidden once signed/approved. */}
                  {canEstimate && canSeePrices && !e.approvedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => openEstimateInPopup(e.id)}
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
                    <span className="text-xs text-muted-foreground" title="Texting clients needs a client-texting number — set one up in Settings → Text messaging."
                      data-testid={`note-send-sms-number-${e.id}`}>
                      Texting clients needs a client-texting number (Settings → Text messaging)
                    </span>
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant={e.sentAt ? "outline" : "default"}
                      // Never send by accident: confirm who gets it and what it says first (owner, 2026-10-21).
                      onClick={() => confirmAction({
                        id: "send-estimate",
                        title: `${e.sentAt ? "Resend" : "Send"} estimate ${e.number ?? ""} to ${c.firstName ?? c.name ?? "the client"}?`.replace(/\s+/g, " "),
                        description: (
                          <div className="space-y-1.5 text-sm" data-testid="send-confirm-details">
                            <div><span className="text-muted-foreground">To:</span> <span className="font-medium">{c.email || "no email on file"}</span>
                              {alsoText && c.phone ? <> · <span className="text-muted-foreground">text to</span> <span className="font-medium">{c.phone}</span></> : null}</div>
                            <div><span className="text-muted-foreground">Estimate:</span> <span className="font-medium">{e.number} · {e.title}</span></div>
                            <div><span className="text-muted-foreground">Total:</span> <span className="font-medium">{money(e.totalCents)}</span>
                              {e.depositCents ? <> · <span className="text-muted-foreground">deposit</span> <span className="font-medium">{money(e.depositCents)}</span></> : null}
                              {" "}· <span className="text-muted-foreground">tax</span> <span className="font-medium">{((e.taxRateBps ?? 0) / 100).toString()}%</span></div>
                            <div className="text-muted-foreground">The client gets an email with a link to view and approve it.</div>
                          </div>
                        ),
                        confirmLabel: e.sentAt ? "Yes, resend it" : "Yes, send it", destructive: false,
                        onConfirm: () => send.mutate(e.id),
                      })} disabled={send.isPending}
                      data-testid={`button-send-${e.id}`}>
                      {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      {e.sentAt ? "Resend" : "Send"}
                    </Button>
                  )}
                  {canEstimate && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant="ghost"
                      onClick={() => proof.mutate(e.id)} disabled={proof.isPending}
                      title="Email yourself exactly what the client would get"
                      data-testid={`button-send-proof-${e.id}`}>
                      {proof.isPending && proof.variables === e.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MailCheck className="h-4 w-4 mr-2" />}
                      Send me a proof
                    </Button>
                  )}
                  {/* Nudge a client whose estimate is sitting unanswered. */}
                  {canEstimate && e.sentAt && !e.approvedAt && !e.declinedAt && (
                    <Button size="sm" variant="ghost"
                      title="Emails the client a reminder to look at this estimate (and texts them if texting is set up)"
                      onClick={() => confirmAction({
                        id: "remind-estimate",
                        title: `Send ${c.firstName ?? c.name ?? "the client"} a reminder about ${e.number ?? "this estimate"}?`,
                        description: (
                          <div className="space-y-1.5 text-sm" data-testid="remind-confirm-details">
                            <div><span className="text-muted-foreground">To:</span> <span className="font-medium">{c.email || "no email on file"}</span>
                              {c.phone && smsStatus?.canTextClients !== false && smsStatus?.configured ? <> · <span className="text-muted-foreground">text to</span> <span className="font-medium">{c.phone}</span></> : null}</div>
                            <div className="text-muted-foreground">A short "your estimate is waiting for you" message with the same link. Nothing about the estimate changes.</div>
                          </div>
                        ),
                        confirmLabel: "Yes, send the reminder", destructive: false,
                        onConfirm: () => remind.mutate(e.id),
                      })} disabled={remind.isPending}
                      data-testid={`button-remind-${e.id}`}>
                      {remind.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BellRing className="h-4 w-4 mr-2" />}
                      Send client a reminder
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

              {/* Signed: the balance, payment requests, recorded payments and their receipts. */}
              {e.approvedAt && canSeePrices && (
                <EstimatePayments estimate={e} canTakePayment={canTakePayment} canInvoice={canInvoice} onChanged={refresh} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      </ClientSection>
      <ClientSection id="invoices" layout={layout} when={canSeePrices}>
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
            {(invoices?.length ?? 0) > 1 && (
              <SortButtons columns={CLIENT_INVOICE_SORT_COLUMNS} sort={invoiceSort.sort} onSort={invoiceSort.onSort}
                onChange={invoiceSort.setSort} testId="sort-client-invoices" />
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
                              onClick={() => confirmAction({
                                id: "send-invoice",
                                title: `${inv.sentAt ? "Resend" : "Send"} ${inv.number ?? "this invoice"} to ${c.firstName ?? c.name ?? "the client"}?`,
                                description: (
                                  <span className="block space-y-1">
                                    <span className="block">To: <strong>{c.email ?? "no email on file"}</strong></span>
                                    <span className="block">{inv.number} · {inv.title}</span>
                                    <span className="block">Amount due: <strong>{money(due)}</strong>{(inv.paidCents ?? 0) > 0 ? ` (of ${money(inv.totalCents)}; ${money(inv.paidCents)} already paid)` : ""}</span>
                                  </span>
                                ),
                                confirmLabel: inv.sentAt ? "Yes, resend it" : "Yes, send it", destructive: false,
                                onConfirm: () => sendInvoice.mutate(inv.id),
                              })} disabled={!!noSend || sendInvoice.isPending}
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
      </ClientSection>
      <ClientSection id="documents" layout={layout} when={canSeePrices}>
      {/* The whole paper trail — estimates, signed contracts, invoices, a receipt per payment (HCP imports included). */}
      {canSeePrices && id && <ClientDocuments customerId={id} />}
      </ClientSection>
      <ClientSection id="projects" layout={layout}>
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
                <DialogHeader><DialogTitle>New project for {c.displayName}</DialogTitle><DialogDescription>A project holds the job's schedule, photos, notes and money in one place.</DialogDescription></DialogHeader>
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
      </ClientSection>
      <ClientSection id="messages" layout={layout} when={canManageCustomers}>
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
      </ClientSection>
      <ClientSection id="measurements" layout={layout}>
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
      </ClientSection>
      <ClientSection id="photos" layout={layout}>
      {/* Client portal v2 — photos/comments from this client + the org pamphlet shelf. */}
      <CustomerPhotos customerId={id!} canUpload={me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true} />
      </ClientSection>
      <ClientSection id="jobcam" layout={layout}>
      {/* JobCam — the crew's job-site shots across this client's projects (same shelf as Project Photos). */}
      <Card data-testid="section-customer-jobcam"><CardContent className="p-4 sm:p-5"><JobcamPanel customerId={id!} /></CardContent></Card>
      </ClientSection>
      <ClientSection id="comments" layout={layout}>
      <CustomerComments customerId={id!} />
      <OrgPamphlets />
      <EstimateDefaultFiles />
      </ClientSection>
      </ClientSections>

      {/* Good / better / best options for one estimate. */}
      {optsFor && (
        <EstimateOptionsDialog estimate={optsFor} open={!!optsFor}
          onOpenChange={(o) => !o && setOptsFor(null)} />
      )}

      {/* Take a payment — online checkout link or manual record. */}
      {/* estimates → a "Deposit on a signed estimate" link; payments → hides
          deposits already paid. */}
      <TakePaymentDialog
          customerId={id}
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
            <DialogDescription>{apptProjectId ? "Put the project start on the calendar — the job moves to Job Scheduled on its own." : "Put a visit with this client on the calendar."}</DialogDescription>
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
                  onChange={(e) => {
                    // Moving the start keeps the visit's length: the end follows, so it can never sit before the start.
                    const next = e.target.value;
                    const prevStart = apptStart ? new Date(apptStart).getTime() : NaN;
                    const prevEnd = apptEnd ? new Date(apptEnd).getTime() : NaN;
                    const nextStart = next ? new Date(next).getTime() : NaN;
                    if (Number.isFinite(nextStart) && (!Number.isFinite(prevEnd) || prevEnd <= nextStart || Number.isFinite(prevStart))) {
                      const length = Number.isFinite(prevStart) && Number.isFinite(prevEnd) && prevEnd > prevStart ? prevEnd - prevStart : 2 * 3600_000;
                      setApptEnd(toLocalInput(new Date(nextStart + length)));
                    }
                    setApptStart(next);
                  }} data-testid="input-appointment-start" />
              </div>
              <div>
                <Label htmlFor="appt-end">Ends</Label>
                <Input id="appt-end" type="datetime-local" value={apptEnd}
                  onChange={(e) => setApptEnd(e.target.value)} data-testid="input-appointment-end" />
              </div>
            </div>
            {apptStart && apptEnd && new Date(apptEnd).getTime() <= new Date(apptStart).getTime() && (
              <p className="text-xs text-destructive" data-testid="text-appointment-end-before-start">The end is before the start — pick a later end time.</p>
            )}
            <div>
              <Label htmlFor="appt-notes">Notes (optional)</Label>
              <Textarea id="appt-notes" rows={2} value={apptNotes} onChange={(e) => setApptNotes(e.target.value)}
                placeholder="Gate code, dogs, bring samples…" data-testid="input-appointment-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => scheduleAppt.mutate()}
              disabled={!apptTitle.trim() || !apptStart || scheduleAppt.isPending || (!!apptEnd && new Date(apptEnd).getTime() <= new Date(apptStart).getTime())}
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
            <DialogDescription>Log a payment you received outside the app, such as cash or a check.</DialogDescription>
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
                  {MANUAL_PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
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
            <Button onClick={() => confirmAction({
                id: "record-invoice-payment",
                title: `Record ${money(payAmountCents)} on ${payFor?.number ?? "this invoice"}?`,
                description: `${MANUAL_PAYMENT_METHODS.find((m) => m.value === payMethod)?.label ?? payMethod}${payNote.trim() ? ` · ${payNote.trim()}` : ""}. A numbered receipt is emailed to the client automatically.`,
                confirmLabel: "Yes, record it", destructive: false,
                onConfirm: () => recordPayment.mutate(),
              })}
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
