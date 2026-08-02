/**
 * Quick Bid — the owner's one-visit bid flow on the client detail page.
 *
 * Pick per-sqft SKUs (siding, paint, re-roof…) → the server prices them from
 * the client's latest ready HOVER/CladAI measurement report (sqft straight
 * from the report, waste on the quantity) → edit-first review of the created
 * draft estimate → send dialog with a prefilled, editable message that goes
 * out via the standard estimate send endpoint (email).
 *
 * Self-contained mount: CrmClientPage renders <QuickBid … /> in the Estimates
 * card header; everything else lives here. The button stays disabled (with an
 * honest reason) until the client has a ready report with a usable sqft
 * metric and the price book has at least one per_sqft SKU.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Ruler, Send, Zap } from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const fmtSf = (n?: number | null) =>
  n === null || n === undefined ? null : n.toLocaleString("en-US", { maximumFractionDigits: 1 });

type ReviewLine = {
  id?: string; name: string; description?: string | null;
  quantityMilli: number; unitPriceCents: number; taxable: boolean;
};

export function QuickBid({ customerId, customerEmail, customerAddress }: {
  customerId: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
}) {
  const { toast } = useToast();

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const orgName: string = me?.org?.name ?? "";

  const { data: measData } = useQuery<any>({
    queryKey: [`/api/crm/customers/${customerId}/measurements`],
    enabled: !!customerId,
  });
  const { data: pbItems } = useQuery<any[]>({ queryKey: ["/api/crm/pricebook/items"] });

  // The server bids from the LATEST ready report — mirror that choice here so
  // the button's enabled state and the dialog summary tell the truth.
  const measurement = useMemo(() => {
    const rows: any[] = measData?.measurements ?? [];
    return rows.find((m) => m.status === "ready" && (m.roofAreaSf || m.sidingSqft)) ?? null;
  }, [measData]);

  const perSqftItems = useMemo(
    () => (pbItems ?? []).filter((i) => i.pricingMode === "per_sqft"),
    [pbItems],
  );

  const disabledReason = !measurement
    ? "Quick Bid needs a ready measurement report with square footage first."
    : !perSqftItems.length
      ? "No per-sqft SKUs in the price book yet."
      : null;

  // ── Step 1: pick the SKUs ────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // ── Step 2: edit-first review of the created draft ───────────────────────
  const [estimate, setEstimate] = useState<any | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [dirty, setDirty] = useState(false);

  const subtotal = lines.reduce((s, l) => s + Math.round((l.unitPriceCents * l.quantityMilli) / 1000), 0);
  const taxableBase = lines.reduce(
    (s, l) => s + (l.taxable ? Math.round((l.unitPriceCents * l.quantityMilli) / 1000) : 0), 0);
  const tax = Math.round((taxableBase * (estimate?.taxRateBps ?? 0)) / 10000);
  const total = subtotal + tax;

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/quick-bid", {
        customerId,
        itemIds: Object.keys(picked).filter((k) => picked[k]),
      })).json(),
    onSuccess: (r: any) => {
      setEstimate(r.estimate);
      setLines((r.items ?? [])
        .slice()
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((i: any) => ({
          id: i.id, name: i.name, description: i.description,
          quantityMilli: i.quantityMilli, unitPriceCents: i.unitPriceCents, taxable: i.taxable,
        })));
      setDirty(false);
      setStep("review");
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customerId}`] });
    },
    onError: (e: any) => toast({ title: "Quick Bid couldn't price this", description: String(e.message ?? e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", `/api/crm/estimates/${estimate.id}/items`, {
        items: lines.map((l, idx) => ({
          kind: "labor", name: l.name, description: l.description ?? null,
          quantityMilli: l.quantityMilli, unit: "sf",
          unitPriceCents: l.unitPriceCents, taxable: l.taxable,
          hiddenFromClient: false, sortOrder: idx,
        })),
      })).json(),
    onSuccess: (r: any) => {
      setEstimate(r);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customerId}`] });
      toast({ title: "Bid updated" });
    },
    onError: (e: any) => toast({ title: "Could not save the bid", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Step 3: the send dialog (message box → email) ────────────────────────
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendMsg, setSendMsg] = useState("");

  const openSend = async () => {
    if (dirty) {
      // Never email numbers that aren't what's on screen — save first.
      try { await save.mutateAsync(); } catch { return; }
    }
    const addr = measurement
      ? [measurement.addressLine1, measurement.city, measurement.state].filter(Boolean).join(", ")
      : (customerAddress ?? "");
    setSendTo(customerEmail ?? "");
    setSendMsg(`${orgName} — your estimate ${estimate?.number ?? ""} for ${addr}`.trim());
    setSendOpen(true);
  };

  const send = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/estimates/${estimate.id}/send`, {
        email: sendTo || undefined, message: sendMsg || undefined,
      })).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customerId}`] });
      setSendOpen(false);
      setOpen(false);
      setStep("pick");
      setPicked({});
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

  const setLine = (idx: number, patch: Partial<ReviewLine>) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  return (
    <>
      <Button size="sm" variant="outline" disabled={!!disabledReason}
        title={disabledReason ?? "Price per-sqft SKUs from the latest measurement report"}
        onClick={() => { setStep("pick"); setOpen(true); }}
        data-testid="button-quick-bid">
        <Zap className="h-4 w-4 mr-2" /> Quick Bid
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setStep("pick"); setEstimate(null); setDirty(false); } }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto"
          data-testid={step === "pick" ? "dialog-quick-bid" : "dialog-quick-bid-review"}>
          {step === "pick" ? (
            <>
              <DialogHeader><DialogTitle>Quick Bid — price from the report</DialogTitle></DialogHeader>
              {measurement && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                  data-testid="text-quick-bid-measurement">
                  <div className="flex items-center gap-2 font-medium">
                    <Ruler className="h-4 w-4" />
                    Latest {measurement.provider} report
                    {measurement.addressLine1 ? ` — ${measurement.addressLine1}` : ""}
                  </div>
                  <div className="text-muted-foreground mt-0.5 tabular-nums">
                    {[
                      fmtSf(measurement.roofAreaSf) && `Roof ${fmtSf(measurement.roofAreaSf)} sq ft`,
                      fmtSf(measurement.sidingSqft) && `Siding ${fmtSf(measurement.sidingSqft)} sq ft`,
                      measurement.wastePercent != null && `Waste ${measurement.wastePercent}%`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs">Per-sqft SKUs to include</Label>
                {perSqftItems.map((i) => {
                  const noRate = !(i.rateCentsPerSqft > 0);
                  return (
                    <label key={i.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${noRate ? "opacity-60" : "cursor-pointer hover:bg-accent"}`}
                      data-testid={`quick-bid-item-${i.id}`}>
                      <Checkbox
                        checked={!!picked[i.id]}
                        disabled={noRate}
                        onCheckedChange={(c) => setPicked({ ...picked, [i.id]: c === true })}
                        data-testid={`check-quick-bid-item-${i.id}`} />
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{i.name}</span>
                        {i.customFields?.quickBidRate?.placeholder && !noRate && (
                          <span className="ml-2 text-xs text-amber-600">placeholder rate</span>
                        )}
                      </span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {noRate ? "no rate set — edit in price book" : `${money(i.rateCentsPerSqft)}/sq ft · ${i.sqftMetric ?? "auto"}`}
                      </span>
                    </label>
                  );
                })}
              </div>
              <DialogFooter>
                <Button
                  onClick={() => create.mutate()}
                  disabled={!Object.values(picked).some(Boolean) || create.isPending}
                  data-testid="button-create-quick-bid">
                  {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Zap className="h-4 w-4 mr-2" /> Quick Bid
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Review your bid — {estimate?.number}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Quantities came straight from the measurement report (waste included). Adjust anything before it goes out.
              </p>
              <div className="space-y-2">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-12 items-end border rounded-md p-2"
                    data-testid={`quick-bid-line-${idx}`}>
                    <div className="sm:col-span-5 min-w-0">
                      <Label className="text-xs">{l.name}</Label>
                      {l.description && (
                        <div className="text-xs text-muted-foreground truncate">{l.description}</div>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Sq ft</Label>
                      <Input type="number" step="0.1" value={l.quantityMilli / 1000}
                        onChange={(e) => setLine(idx, { quantityMilli: Math.round((parseFloat(e.target.value) || 0) * 1000) })}
                        data-testid={`input-quick-bid-qty-${idx}`} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">$/sq ft</Label>
                      <Input type="number" step="0.01" value={(l.unitPriceCents / 100).toString()}
                        onChange={(e) => setLine(idx, { unitPriceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                        data-testid={`input-quick-bid-price-${idx}`} />
                    </div>
                    <div className="sm:col-span-3 text-sm text-right">
                      <Label className="text-xs">Line</Label>
                      <div className="h-9 flex items-center justify-end font-medium"
                        data-testid={`text-quick-bid-line-total-${idx}`}>
                        {money(Math.round((l.unitPriceCents * l.quantityMilli) / 1000))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-sm space-y-1 text-right">
                <div>Subtotal <span className="font-medium ml-3" data-testid="text-quick-bid-subtotal">{money(subtotal)}</span></div>
                <div>Tax <span className="font-medium ml-3" data-testid="text-quick-bid-tax">{money(tax)}</span></div>
                <div className="text-lg font-bold">Total <span className="ml-3" data-testid="text-quick-bid-total">{money(total)}</span></div>
              </div>
              <Separator />
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => save.mutate()}
                  disabled={!dirty || save.isPending} data-testid="button-quick-bid-save">
                  {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save edits
                </Button>
                <Button onClick={openSend} disabled={save.isPending}
                  data-testid="button-quick-bid-send-open">
                  <Send className="h-4 w-4 mr-2" /> Send…
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* The message box — prefilled, editable, goes out by email. */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent data-testid="dialog-quick-bid-send">
          <DialogHeader>
            <DialogTitle>Send estimate {estimate?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="qb-to">To</Label>
              <Input id="qb-to" type="email" value={sendTo}
                onChange={(e) => setSendTo(e.target.value)} data-testid="input-quick-bid-email" />
            </div>
            <div>
              <Label htmlFor="qb-msg">Message</Label>
              <Textarea id="qb-msg" rows={4} value={sendMsg}
                onChange={(e) => setSendMsg(e.target.value)} data-testid="textarea-quick-bid-message" />
            </div>
            <p className="text-xs text-muted-foreground">
              The email includes the approve-online link and starts the estimate's expiry clock.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => send.mutate()} disabled={!sendTo.trim() || send.isPending}
              data-testid="button-quick-bid-send">
              {send.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Send className="h-4 w-4 mr-2" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
