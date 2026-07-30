import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  BookOpen, Plus, Loader2, Package, Wrench, Calculator, Percent, Sparkles, AlertTriangle,
} from "lucide-react";

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
    `No assemblies yet.${canManage ? " Add the starter set above, or build one from materials." : ""}`);
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
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><BookOpen className="h-7 w-7" /> Price book</h1>
          <p className="text-muted-foreground mt-1">
            Build assemblies once, then estimate by quantity. Waste factors are a real field, not a formula trick.
          </p>
        </div>
        {canManage && !itemsLoading && !items?.length && (
          <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending} data-testid="button-seed-pb">
            {seed.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Add starter roofing set
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items"><Package className="h-4 w-4 mr-1" /> Assemblies</TabsTrigger>
          <TabsTrigger value="materials"><Wrench className="h-4 w-4 mr-1" /> Materials</TabsTrigger>
          <TabsTrigger value="labor"><Percent className="h-4 w-4 mr-1" /> Labor</TabsTrigger>
          <TabsTrigger value="formula"><Calculator className="h-4 w-4 mr-1" /> Formulas</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4 space-y-3">
          {itemsState && (
            <Card><CardContent className="py-2">{itemsState}</CardContent></Card>
          )}
          {items?.map((i) => (
            <Card key={i.id} data-testid={`pb-item-${i.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {i.code ? `${i.code} · ` : ""}per {i.unit}
                      {" · "}<Badge variant="outline" className="text-[10px]">{i.pricingMode}</Badge>
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
                  </div>
                </div>
                {i.formulaSymbols?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    formula uses: {i.formulaSymbols.map((s: string) => `[${s}]`).join(" ")}
                  </div>
                )}
                {prev?.id === i.id && preview && (
                  <div className="border rounded-md mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50"><tr>
                        <th className="text-left p-2">Expands to</th><th className="text-right p-2">Qty</th>
                        <th className="text-right p-2">Price</th><th className="text-right p-2">Line</th>
                      </tr></thead>
                      <tbody>
                        {preview.lines?.map((l: any, n: number) => (
                          <tr key={n} className="border-t">
                            <td className="p-2">{l.name}</td>
                            <td className="p-2 text-right">{(l.quantityMilli / 1000).toFixed(2)} {l.unit}</td>
                            <td className="p-2 text-right">{money(l.unitPriceCents)}</td>
                            <td className="p-2 text-right">{money(Math.round(l.unitPriceCents * l.quantityMilli / 1000))}</td>
                          </tr>
                        ))}
                        <tr className="border-t font-medium bg-muted/30">
                          <td className="p-2" colSpan={3}>Total</td>
                          <td className="p-2 text-right">{money(preview.totalPriceCents)}</td>
                        </tr>
                        {seeCosts && preview.marginBps != null && (
                          <tr className="border-t text-xs text-muted-foreground">
                            <td className="p-2" colSpan={4}>
                              cost {money(preview.totalCostCents)} · margin {(preview.marginBps / 100).toFixed(1)}%
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {preview.warnings?.length > 0 && (
                      <div className="p-2 text-xs text-destructive flex items-start gap-1">
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
            <CardHeader><CardTitle className="text-lg">Materials</CardTitle>
              <CardDescription>Waste % is applied to quantity when an assembly expands.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <div className="grid gap-2 sm:grid-cols-12 items-end border rounded-md p-2">
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr>
                    <th className="text-left p-2">Material</th><th className="text-left p-2">Unit</th>
                    {seeCosts && <th className="text-right p-2">Cost</th>}
                    <th className="text-right p-2">Price</th><th className="text-right p-2">Waste</th>
                    {seeCosts && <th className="text-right p-2">Margin</th>}
                  </tr></thead>
                  <tbody>
                    {materials?.map((m) => {
                      const margin = seeCosts && m.priceCents > 0
                        ? ((m.priceCents - m.costCents) / m.priceCents * 100).toFixed(0) + "%" : "—";
                      return (
                        <tr key={m.id} className="border-t" data-testid={`pb-mat-${m.id}`}>
                          <td className="p-2">
                            <div className="font-medium">{m.name}</div>
                            {m.sku && <div className="text-xs text-muted-foreground">{m.sku}</div>}
                          </td>
                          <td className="p-2">{m.unit}</td>
                          {seeCosts && <td className="p-2 text-right">{money(m.costCents)}</td>}
                          <td className="p-2 text-right">{money(m.priceCents)}</td>
                          <td className="p-2 text-right">{(m.wasteFactorBps / 100).toFixed(0)}%</td>
                          {seeCosts && <td className="p-2 text-right">{margin}</td>}
                        </tr>
                      );
                    })}
                    {matsState && <tr><td className="p-1" colSpan={6}>{matsState}</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Labor rates</CardTitle>
              <CardDescription>Cost is what you pay; price is what you charge.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <div className="flex flex-wrap gap-2 items-end">
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
              {labor?.map((l) => (
                <div key={l.id} className="border rounded-md p-3 flex items-center justify-between gap-2">
                  <div className="font-medium flex items-center gap-2">
                    {l.name}{l.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
                  </div>
                  <div className="text-sm">
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
              <CardTitle className="text-lg">Formula tester</CardTitle>
              <CardDescription>{meta?.formulaHelp}</CardDescription>
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
                <div className={`text-sm font-mono ${fres.startsWith("✕") ? "text-destructive" : ""}`}
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
    </div>
  );
}
