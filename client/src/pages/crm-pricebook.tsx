import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  BookOpen, Plus, Loader2, Package, Wrench, Calculator, Percent, Sparkles, AlertTriangle,
  Pencil, Trash2,
} from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, SectionTitle, crmTable } from "@/components/crm-ui";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export default function CrmPriceBookPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("items");
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.managePriceBook === true;
  const seeCosts = me?.permissions?.seeCosts === true;

  const { data: meta } = useQuery<any>({ queryKey: ["/api/crm/pricebook/meta"] });
  const { data: items, isLoading: itemsLoading, isError: itemsError } =
    useQuery<any[]>({ queryKey: ["/api/crm/pricebook/items"] });
  const { data: materials, isLoading: matsLoading, isError: matsError } =
    useQuery<any[]>({ queryKey: ["/api/crm/pricebook/materials"] });
  const { data: labor, isLoading: laborLoading, isError: laborError } =
    useQuery<any[]>({ queryKey: ["/api/crm/pricebook/labor-rates"] });

  const listState = (loading: boolean, error: boolean, rows: any[] | undefined, empty: string) => {
    if (loading) return (
      <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
    );
    if (error) return (
      <p className="text-sm text-destructive flex items-center gap-2 p-2">
        <AlertTriangle className="h-4 w-4" /> Couldn't load — refresh to try again.
      </p>
    );
    if (!rows?.length) return <p className="text-sm text-muted-foreground p-2">{empty}</p>;
    return null;
  };

  const itemsState = listState(itemsLoading, itemsError, items,
    `No SKUs yet.${canManage ? " Add one below, or seed the starter set above." : ""}`);
  const matsState = listState(matsLoading, matsError, materials, "No materials yet.");
  const laborState = listState(laborLoading, laborError, labor, "No labor rates yet.");

  const invalidate = () => {
    ["items", "materials", "labor-rates"].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [`/api/crm/pricebook/${k}`] }));
  };

  const seed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/seed", {})).json(),
    onSuccess: (r: any) => { invalidate(); toast({ title: "Starter price book added", description: r.note }); },
    onError: (e: any) => toast({ title: "Could not seed", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── new material ──
  const [mat, setMat] = useState({ name: "", sku: "", unit: "ea", cost: "", price: "", waste: "0" });
  const addMat = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/materials", {
      name: mat.name, sku: mat.sku || null, unit: mat.unit,
      costCents: Math.round((parseFloat(mat.cost) || 0) * 100),
      priceCents: Math.round((parseFloat(mat.price) || 0) * 100),
      wasteFactorBps: Math.round((parseFloat(mat.waste) || 0) * 100),
    })).json(),
    onSuccess: () => { invalidate(); setMat({ name: "", sku: "", unit: "ea", cost: "", price: "", waste: "0" }); toast({ title: "Material added" }); },
    onError: (e: any) => toast({ title: "Could not add", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── new labor rate ──
  const [lab, setLab] = useState({ name: "", cost: "", price: "" });
  const addLab = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/labor-rates", {
      name: lab.name,
      hourlyCostCents: Math.round((parseFloat(lab.cost) || 0) * 100),
      hourlyPriceCents: Math.round((parseFloat(lab.price) || 0) * 100),
    })).json(),
    onSuccess: () => { invalidate(); setLab({ name: "", cost: "", price: "" }); toast({ title: "Labor rate added" }); },
  });

  // ── price chart SKU: add / edit / delete ──
  const emptyItemForm = {
    name: "", code: "", unit: "ea", pricingMode: "computed",
    flatPrice: "", flatCost: "", description: "",
  };
  // dlg.id null → creating; otherwise editing that item.
  const [dlg, setDlg] = useState<{ id: string | null; form: typeof emptyItemForm } | null>(null);
  const openEdit = (i: any) => setDlg({
    id: i.id,
    form: {
      name: i.name ?? "", code: i.code ?? "", unit: i.unit ?? "ea",
      pricingMode: i.pricingMode ?? "computed",
      flatPrice: i.flatPriceCents != null ? (i.flatPriceCents / 100).toString() : "",
      flatCost: i.flatCostCents != null ? (i.flatCostCents / 100).toString() : "",
      description: i.description ?? "",
    },
  });
  const saveItem = useMutation({
    mutationFn: async () => {
      if (!dlg) throw new Error("No item");
      const body: any = {
        name: dlg.form.name, code: dlg.form.code || null,
        unit: dlg.form.unit, pricingMode: dlg.form.pricingMode,
        description: dlg.form.description || null,
      };
      if (dlg.form.pricingMode === "flat") {
        body.flatPriceCents = Math.round((parseFloat(dlg.form.flatPrice) || 0) * 100);
        body.flatCostCents = Math.round((parseFloat(dlg.form.flatCost) || 0) * 100);
      }
      const r = await apiRequest(dlg.id ? "PATCH" : "POST",
        dlg.id ? `/api/crm/pricebook/items/${dlg.id}` : "/api/crm/pricebook/items", body);
      return r.json();
    },
    onSuccess: () => {
      invalidate(); setDlg(null);
      toast({ title: dlg?.id ? "SKU updated" : "SKU added" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: String(e.message ?? e), variant: "destructive" }),
  });
  const delItem = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/pricebook/items/${id}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: "SKU deleted" }); },
    onError: (e: any) => toast({ title: "Could not delete", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── formula tester ──
  const [f, setF] = useState({ formula: "ceil([SQUARES] * (1 + [WASTE]/100))", squares: "32", waste: "10" });
  const [fres, setFres] = useState<string | null>(null);
  const testF = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/crm/pricebook/formula/test", {
        formula: f.formula,
        symbols: { SQUARES: parseFloat(f.squares) || 0, WASTE: parseFloat(f.waste) || 0 },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || j.message);
      return j;
    },
    onSuccess: (j: any) => setFres(`= ${j.result}  (symbols: ${j.symbols.join(", ") || "none"})`),
    onError: (e: any) => setFres(`✕ ${String(e.message ?? e)}`),
  });

  // ── assembly preview ──
  const [prev, setPrev] = useState<{ id: string; qty: string } | null>(null);
  const { data: preview } = useQuery<any>({
    queryKey: [`/api/crm/pricebook/items/${prev?.id}/preview`, prev?.qty],
    enabled: !!prev,
    queryFn: async () => {
      const r = await apiRequest("POST", `/api/crm/pricebook/items/${prev!.id}/preview`, {
        quantityMilli: Math.round((parseFloat(prev!.qty) || 0) * 1000),
      });
      return r.json();
    },
  });

  return (
    <CrmPage>
      <CrmPageHeader
        icon={BookOpen}
        title="Price book"
        subtitle="Price each SKU once, then estimate by quantity. Waste factors are a real field, not a formula trick."
        actions={canManage && !itemsLoading && !items?.length ? (
          <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending} data-testid="button-seed-pb">
            {seed.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Add starter roofing set
          </Button>
        ) : undefined}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted/60 p-1 flex-wrap h-auto max-w-full justify-start sm:h-10 sm:flex-nowrap">
          <TabsTrigger value="items"><Package className="h-4 w-4 mr-1" /> Price Chart</TabsTrigger>
          <TabsTrigger value="materials"><Wrench className="h-4 w-4 mr-1" /> Materials</TabsTrigger>
          <TabsTrigger value="labor"><Percent className="h-4 w-4 mr-1" /> Labor</TabsTrigger>
          <TabsTrigger value="formula"><Calculator className="h-4 w-4 mr-1" /> Formulas</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4 space-y-3">
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setDlg({ id: null, form: { ...emptyItemForm } })}
                data-testid="button-add-item">
                <Plus className="h-4 w-4 mr-1" /> Add SKU
              </Button>
            </div>
          )}
          {itemsState && !items?.length && !itemsLoading && !itemsError ? (
            <Card>
              <EmptyState
                icon={Package}
                title="No SKUs yet"
                description={canManage
                  ? "Add your first SKU above, or seed the starter roofing set."
                  : "Each SKU bundles materials and labor into one priced unit."}
              />
            </Card>
          ) : itemsState ? (
            <Card><CardContent className="py-2">{itemsState}</CardContent></Card>
          ) : null}
          {items?.map((i) => (
            <Card key={i.id} data-testid={`pb-item-${i.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                      {i.code ? `${i.code} · ` : ""}per {i.unit}
                      <Badge variant="outline" className="text-[10px] font-normal">{i.pricingMode}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input className="w-24 h-9" placeholder="qty"
                      defaultValue={prev && prev.id === i.id ? prev.qty : ""}
                      onChange={(e) => setPrev({ id: i.id, qty: e.target.value })}
                      data-testid={`input-qty-${i.id}`} />
                    <Button size="sm" variant="outline" onClick={() => setPrev({ id: i.id, qty: prev?.qty || "1" })}
                      data-testid={`button-preview-${i.id}`}>
                      Preview
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(i)}
                          data-testid={`button-edit-item-${i.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => {
                            if (window.confirm(`Delete "${i.name}"? It stays on estimates that already use it.`)) {
                              delItem.mutate(i.id);
                            }
                          }}
                          disabled={delItem.isPending}
                          data-testid={`button-delete-item-${i.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {i.formulaSymbols?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    formula uses: {i.formulaSymbols.map((s: string) => `[${s}]`).join(" ")}
                  </div>
                )}
                {prev?.id === i.id && preview && (
                  <div className={`${crmTable.wrapper} mt-2`}>
                    <table className={crmTable.table}>
                      <thead className={crmTable.thead}><tr>
                        <th className={crmTable.th}>Expands to</th><th className={crmTable.thRight}>Qty</th>
                        <th className={crmTable.thRight}>Price</th><th className={crmTable.thRight}>Line</th>
                      </tr></thead>
                      <tbody>
                        {preview.lines?.map((l: any, n: number) => (
                          <tr key={n} className="border-t">
                            <td className={crmTable.td}>{l.name}</td>
                            <td className={crmTable.tdRight}>{(l.quantityMilli / 1000).toFixed(2)} {l.unit}</td>
                            <td className={crmTable.tdRight}>{money(l.unitPriceCents)}</td>
                            <td className={crmTable.tdRight}>{money(Math.round(l.unitPriceCents * l.quantityMilli / 1000))}</td>
                          </tr>
                        ))}
                        <tr className="border-t font-medium bg-muted/30">
                          <td className={crmTable.td} colSpan={3}>Total</td>
                          <td className={crmTable.tdRight}>{money(preview.totalPriceCents)}</td>
                        </tr>
                        {seeCosts && preview.marginBps != null && (
                          <tr className="border-t text-xs text-muted-foreground">
                            <td className={crmTable.td} colSpan={4}>
                              cost {money(preview.totalCostCents)} · margin {(preview.marginBps / 100).toFixed(1)}%
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {preview.warnings?.length > 0 && (
                      <div className="p-2 text-xs text-destructive flex items-start gap-1 border-t">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{preview.warnings.join(" ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="materials" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle title="Materials"
                description="Waste % is applied to quantity when a SKU expands." />
            </CardHeader>
            <CardContent className="space-y-4">
              {canManage && (
                <div className="grid gap-2 sm:grid-cols-12 items-end rounded-lg border bg-muted/30 p-3">
                  <div className="sm:col-span-4"><Label className="text-xs">Name</Label>
                    <Input value={mat.name} onChange={(e) => setMat({ ...mat, name: e.target.value })}
                      placeholder="Architectural shingles" data-testid="input-mat-name" /></div>
                  <div className="sm:col-span-2"><Label className="text-xs">SKU</Label>
                    <Input value={mat.sku} onChange={(e) => setMat({ ...mat, sku: e.target.value })} /></div>
                  <div className="sm:col-span-1"><Label className="text-xs">Unit</Label>
                    <Input value={mat.unit} onChange={(e) => setMat({ ...mat, unit: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Label className="text-xs">Cost $</Label>
                    <Input type="number" value={mat.cost} onChange={(e) => setMat({ ...mat, cost: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Label className="text-xs">Price $</Label>
                    <Input type="number" value={mat.price} onChange={(e) => setMat({ ...mat, price: e.target.value })} /></div>
                  <div className="sm:col-span-1 flex gap-1">
                    <div><Label className="text-xs">Waste%</Label>
                      <Input className="w-16" type="number" value={mat.waste}
                        onChange={(e) => setMat({ ...mat, waste: e.target.value })} /></div>
                    <Button className="self-end" size="sm" disabled={!mat.name || addMat.isPending}
                      onClick={() => addMat.mutate()} data-testid="button-add-material"><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
              {!materials?.length && !matsLoading && !matsError ? (
                <EmptyState compact icon={Wrench} title="No materials yet"
                  description="Materials carry a cost, a price and a waste factor." />
              ) : (
                <div className={crmTable.wrapper}>
                  <table className={crmTable.table}>
                    <thead className={crmTable.thead}><tr>
                      <th className={crmTable.th}>Material</th><th className={crmTable.th}>Unit</th>
                      {seeCosts && <th className={crmTable.thRight}>Cost</th>}
                      <th className={crmTable.thRight}>Price</th><th className={crmTable.thRight}>Waste</th>
                      {seeCosts && <th className={crmTable.thRight}>Margin</th>}
                    </tr></thead>
                    <tbody>
                      {materials?.map((m) => {
                        const margin = seeCosts && m.priceCents > 0
                          ? ((m.priceCents - m.costCents) / m.priceCents * 100).toFixed(0) + "%" : "—";
                        return (
                          <tr key={m.id} className={crmTable.tr} data-testid={`pb-mat-${m.id}`}>
                            <td className={crmTable.td}>
                              <div className="font-medium">{m.name}</div>
                              {m.sku && <div className="text-xs text-muted-foreground">{m.sku}</div>}
                            </td>
                            <td className={crmTable.td}>{m.unit}</td>
                            {seeCosts && <td className={crmTable.tdRight}>{money(m.costCents)}</td>}
                            <td className={`${crmTable.tdRight} font-medium`}>{money(m.priceCents)}</td>
                            <td className={crmTable.tdRight}>{(m.wasteFactorBps / 100).toFixed(0)}%</td>
                            {seeCosts && <td className={crmTable.tdRight}>{margin}</td>}
                          </tr>
                        );
                      })}
                      {matsState && <tr><td className="p-1" colSpan={6}>{matsState}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle title="Labor rates"
                description="Cost is what you pay; price is what you charge." />
            </CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                  <div className="flex-1 min-w-[160px]"><Label className="text-xs">Name</Label>
                    <Input value={lab.name} onChange={(e) => setLab({ ...lab, name: e.target.value })}
                      placeholder="Roofing crew" data-testid="input-lab-name" /></div>
                  <div><Label className="text-xs">Cost/hr $</Label>
                    <Input type="number" value={lab.cost} onChange={(e) => setLab({ ...lab, cost: e.target.value })} /></div>
                  <div><Label className="text-xs">Price/hr $</Label>
                    <Input type="number" value={lab.price} onChange={(e) => setLab({ ...lab, price: e.target.value })} /></div>
                  <Button size="sm" disabled={!lab.name || addLab.isPending} onClick={() => addLab.mutate()}
                    data-testid="button-add-labor"><Plus className="h-4 w-4" /></Button>
                </div>
              )}
              {laborState}
              {!labor?.length && !laborLoading && !laborError && (
                <EmptyState compact icon={Percent} title="No labor rates yet" />
              )}
              {labor?.map((l) => (
                <div key={l.id} className="rounded-lg border px-4 py-3 flex items-center justify-between gap-2">
                  <div className="font-medium flex items-center gap-2">
                    {l.name}{l.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
                  </div>
                  <div className="text-sm tabular-nums">
                    {seeCosts && <span className="text-muted-foreground mr-3">cost {money(l.hourlyCostCents)}/hr</span>}
                    <span className="font-medium">{money(l.hourlyPriceCents)}/hr</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formula" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle title="Formula tester" description={meta?.formulaHelp} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Formula</Label>
                <Input value={f.formula} onChange={(e) => { setF({ ...f, formula: e.target.value }); setFres(null); }}
                  className="font-mono" data-testid="input-formula" />
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div><Label className="text-xs">[SQUARES]</Label>
                  <Input className="w-24" type="number" value={f.squares}
                    onChange={(e) => setF({ ...f, squares: e.target.value })} /></div>
                <div><Label className="text-xs">[WASTE]</Label>
                  <Input className="w-24" type="number" value={f.waste}
                    onChange={(e) => setF({ ...f, waste: e.target.value })} /></div>
                <Button size="sm" onClick={() => testF.mutate()} disabled={testF.isPending} data-testid="button-test-formula">
                  {testF.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Test
                </Button>
              </div>
              {fres && (
                <div className={`text-sm font-mono rounded-lg border bg-muted/30 px-3 py-2 ${fres.startsWith("✕") ? "text-destructive" : ""}`}
                  data-testid="text-formula-result">{fres}</div>
              )}
              <Separator />
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Available symbols: {meta?.symbols?.map((s: string) => `[${s}]`).join(" ")}</div>
                <div>
                  Formulas are parsed by our own evaluator, not <code>eval</code> — only numbers,
                  <code> + - * / %</code>, parentheses and min/max/ceil/floor/round are accepted.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!dlg} onOpenChange={(open) => { if (!open) setDlg(null); }}>
        <DialogContent data-testid="dialog-item">
          <DialogHeader>
            <DialogTitle>{dlg?.id ? "Edit SKU" : "Add SKU"}</DialogTitle>
          </DialogHeader>
          {dlg && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={dlg.form.name}
                    onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, name: e.target.value } })}
                    placeholder="Re-roof, architectural" data-testid="input-item-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Code</Label>
                  <Input value={dlg.form.code}
                    onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, code: e.target.value } })}
                    placeholder="RR-ARCH-1L" data-testid="input-item-code" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unit</Label>
                  <Select value={dlg.form.unit}
                    onValueChange={(v) => setDlg({ ...dlg, form: { ...dlg.form, unit: v } })}>
                    <SelectTrigger data-testid="select-item-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(meta?.units ?? ["ea", "sq", "sf", "lf", "hr", "job"]).map((u: string) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pricing mode</Label>
                  <Select value={dlg.form.pricingMode}
                    onValueChange={(v) => setDlg({ ...dlg, form: { ...dlg.form, pricingMode: v } })}>
                    <SelectTrigger data-testid="select-item-pricing"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(meta?.pricingModes ?? ["flat", "computed", "formula", "percentage"]).map((m: string) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {dlg.form.pricingMode === "flat" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Price $</Label>
                      <Input type="number" value={dlg.form.flatPrice}
                        onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, flatPrice: e.target.value } })}
                        data-testid="input-item-flat-price" />
                    </div>
                    {seeCosts && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Cost $</Label>
                        <Input type="number" value={dlg.form.flatCost}
                          onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, flatCost: e.target.value } })}
                          data-testid="input-item-flat-cost" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea rows={2} value={dlg.form.description}
                  onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, description: e.target.value } })}
                  data-testid="input-item-description" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)} data-testid="button-cancel-item">Cancel</Button>
            <Button disabled={!dlg?.form.name || saveItem.isPending} onClick={() => saveItem.mutate()}
              data-testid="button-save-item">
              {saveItem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dlg?.id ? "Save changes" : "Add SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
