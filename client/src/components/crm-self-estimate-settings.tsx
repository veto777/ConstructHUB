/**
 * Settings → "Client self-estimate" (also a tab on the Price book page).
 *
 * The estimator sets up, PER DIVISION, the products a client may price on
 * their own ("Curious what a roof replacement would cost?"): Siding per ft²,
 * Roofing per ft² or per square, Windows per window, Doors per door. A
 * product without a price is shown to the client as "Request a price" — no
 * number is ever invented. Server: server/crm/self-estimate.ts (manageSettings
 * OR manageEstimates; saving prices also needs See prices).
 */
import { bundleRuleOf, bundleRuleText } from "@shared/scope-category";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { SectionTitle } from "@/components/crm-ui";
import { Calculator, ArrowUp, ArrowDown, Trash2, Plus, Loader2 } from "lucide-react";
import {
  SELF_ESTIMATE_TRADES, SELF_ESTIMATE_TRADE_META,
  type NormalizedDivisionConfig, type SelfEstimateTrade, type SelfEstimateProduct,
} from "@shared/self-estimate";

type ConfigResponse = {
  divisionKey: string;
  divisions: { key: string; name: string }[];
  config: NormalizedDivisionConfig;
  canEditPrices: boolean;
  discountSource: { code: string; label: string; percentBps: number; conditions: string | null; rule?: unknown }[];
  pricebookItems: { id: string; name: string; unit: string; pricingMode: string; unitPrices?: Record<string, number | null> }[];
};

const centsToInput = (c: number | null, div = 100) => (c === null || c === undefined ? "" : String(+(c / div).toFixed(4)));
const inputToCents = (v: string, mul = 100): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * mul) : null;
};
const newId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "product"}-${Math.random().toString(36).slice(2, 6)}`;

export function SelfEstimateSettingsCard() {
  const { toast } = useToast();
  const [division, setDivision] = useState<string | null>(null);
  const url = `/api/crm/self-estimate/config${division ? `?division=${encodeURIComponent(division)}` : ""}`;
  const { data, isLoading, error } = useQuery<ConfigResponse>({ queryKey: [url], retry: false });
  const [cfg, setCfg] = useState<NormalizedDivisionConfig | null>(null);
  useEffect(() => { if (data) setCfg(structuredClone(data.config)); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { saved: _saved, ...config } = cfg as any;
      return (await apiRequest("PUT", "/api/crm/self-estimate/config", { divisionKey: data!.divisionKey, config })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      toast({ title: "Self-estimate saved", description: "Clients in this division see these products and prices." });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (error) return null; // no permission: the card simply isn't there
  const header = (
    <CardHeader>
      <SectionTitle icon={Calculator} title="Client self-estimate"
        description={'Your clients can price the work that isn\'t on their bid ("Curious what a roof replacement would cost?"). Set your own products and prices per division — a product without a price shows "Request a price". Every look and request lands on the client\'s timeline.'} />
    </CardHeader>
  );
  if (isLoading || !data || !cfg) {
    return <Card data-testid="card-self-estimate">{header}<CardContent><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>;
  }
  const canPrice = data.canEditPrices;
  const setTrade = (t: SelfEstimateTrade, patch: Partial<NormalizedDivisionConfig["trades"][SelfEstimateTrade]>) =>
    setCfg((c) => c && ({ ...c, trades: { ...c.trades, [t]: { ...c.trades[t], ...patch } } }));
  const setProducts = (t: SelfEstimateTrade, fn: (p: SelfEstimateProduct[]) => SelfEstimateProduct[]) =>
    setTrade(t, { products: fn(cfg.trades[t].products) });

  return (
    <Card data-testid="card-self-estimate">
      {header}
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          {data.divisions.length > 1 && (
            <div className="space-y-1.5 min-w-48">
              <Label>Division</Label>
              <Select value={data.divisionKey} onValueChange={(v) => setDivision(v)}>
                <SelectTrigger data-testid="select-se-division"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.divisions.map((d) => <SelectItem key={d.key} value={d.key}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm font-medium pb-2">
            <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v === true })} data-testid="switch-se-enabled" />
            Offer self-estimates to clients{data.divisions.length > 1 ? " in this division" : ""}
          </label>
        </div>
        {!cfg.saved && (
          <p className="text-xs text-muted-foreground">
            Nothing is set up for this division yet — the product names below are a starting list with no prices.
          </p>
        )}
        {!canPrice && <p className="text-xs text-amber-700">Your seat can't see prices, so prices are hidden and can't be saved here.</p>}

        {SELF_ESTIMATE_TRADES.map((trade) => {
          const t = cfg.trades[trade];
          const meta = SELF_ESTIMATE_TRADE_META[trade];
          // Roofing is stored per square; the estimator may type per ft².
          const roofSqft = trade === "roofing" && t.priceEntry === "sqft";
          const mul = roofSqft ? 10_000 : 100;
          const per = trade === "siding" ? "per ft²" : trade === "roofing" ? (roofSqft ? "per ft²" : "per square") : trade === "windows" ? "per window" : "per door";
          const pbUnitKey = trade;
          return (
            <div key={trade} className="rounded-lg border p-3 space-y-3" data-testid={`se-settings-${trade}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 font-medium">
                  <Switch checked={t.enabled} onCheckedChange={(v) => setTrade(trade, { enabled: v === true })} data-testid={`switch-se-trade-${trade}`} />
                  {meta.label}
                </label>
                {trade === "roofing" && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Type prices</span>
                    <Select value={t.priceEntry} onValueChange={(v) => setTrade(trade, { priceEntry: v as "sqft" | "square" })}>
                      <SelectTrigger className="h-8 w-36" data-testid="select-se-roof-entry"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="square">per square</SelectItem>
                        <SelectItem value="sqft">per ft²</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {t.enabled && (
                <>
                  {t.products.map((p, i) => (
                    <div key={p.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] items-start border-t pt-2" data-testid={`se-product-${trade}-${p.id}`}>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Checkbox checked={p.enabled} onCheckedChange={(v) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, enabled: v === true } : x)))}
                            aria-label={`Offer ${p.name}`} />
                          <Input value={p.name} className="h-9" aria-label="Product name"
                            onChange={(e) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            data-testid={`input-se-name-${trade}-${i}`} />
                        </div>
                        <Input value={p.description ?? ""} className="h-8 text-xs" placeholder="Short description (optional)"
                          onChange={(e) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, description: e.target.value || null } : x)))} />
                        <Input value={p.photoUrl ?? ""} className="h-8 text-xs" placeholder="Photo link https://… (optional)"
                          onChange={(e) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, photoUrl: e.target.value.trim() || null } : x)))} />
                      </div>
                      <div className="space-y-1.5">
                        <Select value={p.source} onValueChange={(v) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, source: v as any } : x)))}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Type a price</SelectItem>
                            <SelectItem value="pricebook">From price book</SelectItem>
                          </SelectContent>
                        </Select>
                        {p.source === "manual" ? (
                          <div className="relative">
                            <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
                            <CentsInput className="h-9 pl-5" disabled={!canPrice} placeholder="No price" cents={p.unitPriceCents} mul={mul}
                              onChange={(c) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, unitPriceCents: c } : x)))}
                              testId={`input-se-price-${trade}-${i}`} />
                            <span className="text-[11px] text-muted-foreground">{per}</span>
                          </div>
                        ) : (
                          <Select value={p.pbItemId ?? ""} onValueChange={(v) => setProducts(trade, (ps) => ps.map((x, j) => (j === i ? { ...x, pbItemId: v } : x)))}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick an item" /></SelectTrigger>
                            <SelectContent>
                              {data.pricebookItems.map((it) => {
                                const up = it.unitPrices?.[pbUnitKey];
                                return (
                                  <SelectItem key={it.id} value={it.id}>
                                    {it.name}{up === null ? " — can't price " + per : up !== undefined ? ` — $${(up / (trade === "roofing" && roofSqft ? 10_000 : 100)).toLocaleString("en-US")} ${per}` : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="flex sm:flex-col gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} aria-label="Move up"
                          onClick={() => setProducts(trade, (ps) => { const n = [...ps]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === t.products.length - 1} aria-label="Move down"
                          onClick={() => setProducts(trade, (ps) => { const n = [...ps]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Remove ${p.name}`}
                          onClick={() => setProducts(trade, (ps) => ps.filter((_, j) => j !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" disabled={t.products.length >= 12}
                    onClick={() => setProducts(trade, (ps) => [...ps, {
                      id: newId("product"), name: "New product", description: null, photoUrl: null, enabled: true,
                      source: "manual", unitPriceCents: null, pbItemId: null,
                    }])} data-testid={`button-se-add-${trade}`}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add a product
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-3 border-t pt-3">
                    <MoneyField label="Minimum job price (optional)" cents={t.minimumCents} disabled={!canPrice}
                      onChange={(c) => setTrade(trade, { minimumCents: c })} />
                    {trade === "roofing" && (
                      <>
                        <MoneyField label={`2nd layer tear-off, ${per} (optional)`} cents={t.extraLayerCents} mul={mul} disabled={!canPrice}
                          onChange={(c) => setTrade(trade, { extraLayerCents: c })} />
                        <MoneyField label="Gutters per linear ft (optional)" cents={t.guttersPerLfCents} disabled={!canPrice}
                          onChange={(c) => setTrade(trade, { guttersPerLfCents: c })} />
                      </>
                    )}
                    {(trade === "siding" || trade === "roofing") && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">{meta.label} ft² per ft² of home (optional)</Label>
                        <Input type="number" min={0.1} max={10} step="0.05" className="h-9"
                          placeholder="Not set — clients enter the area"
                          value={t.houseSqftFactorBps ? String(t.houseSqftFactorBps / 10_000) : ""}
                          onChange={(e) => { const n = parseFloat(e.target.value); setTrade(trade, { houseSqftFactorBps: Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : null }); }} />
                        <p className="text-[11px] text-muted-foreground">Your own rule of thumb. Without it, a client with no measurements is asked for the {trade === "siding" ? "wall" : "roof"} area.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="space-y-2">
          <Label>Discounts clients may claim (your Bid discounts — claimed ones are marked "to be verified")</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.discountSource.map((d) => (
              <label key={d.code} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={cfg.discountCodes.includes(d.code)}
                  onCheckedChange={(v) => setCfg({ ...cfg, discountCodes: v === true ? [...new Set([...cfg.discountCodes, d.code])] : cfg.discountCodes.filter((c) => c !== d.code) })}
                  data-testid={`checkbox-se-offer-${d.code}`} />
                {bundleRuleOf(d.rule)
                  ? <>{d.label}: <span className="text-primary">{bundleRuleText(bundleRuleOf(d.rule)!)}</span></>
                  : <>{d.label} <span className="text-primary">−{d.percentBps / 100}%</span></>}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="se-range">Range ±%</Label>
            <Input id="se-range" type="number" min={0} max={50} step="1" value={cfg.rangeBps / 100}
              onChange={(e) => setCfg({ ...cfg, rangeBps: Math.max(0, Math.min(5_000, Math.round((parseFloat(e.target.value) || 0) * 100))) })}
              data-testid="input-se-range" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="se-disclaimer">Disclaimer (always shown with the ballpark)</Label>
            <Textarea id="se-disclaimer" rows={2} value={cfg.disclaimer} onChange={(e) => setCfg({ ...cfg, disclaimer: e.target.value })}
              data-testid="input-se-disclaimer" />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !canPrice || cfg.disclaimer.trim().length < 10}
            data-testid="button-se-save">
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save self-estimate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MoneyField({ label, cents, onChange, mul = 100, disabled }: {
  label: string; cents: number | null; onChange: (c: number | null) => void; mul?: number; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
        <CentsInput className="h-9 pl-5" placeholder="Not set" disabled={disabled} cents={cents} mul={mul} onChange={onChange} />
      </div>
    </div>
  );
}

/** A dollar input that keeps what is typed ("4.") and reports cents; an empty box is "no price". */
function CentsInput({ cents, mul, onChange, className, placeholder, disabled, testId }: {
  cents: number | null; mul: number; onChange: (c: number | null) => void;
  className?: string; placeholder?: string; disabled?: boolean; testId?: string;
}) {
  const [text, setText] = useState(centsToInput(cents, mul));
  useEffect(() => {
    if (inputToCents(text, mul) !== cents) setText(centsToInput(cents, mul));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents, mul]);
  return (
    <Input type="number" min={0} step="0.01" inputMode="decimal" className={className} placeholder={placeholder}
      disabled={disabled} value={text} data-testid={testId}
      onChange={(e) => { setText(e.target.value); onChange(inputToCents(e.target.value, mul)); }} />
  );
}
