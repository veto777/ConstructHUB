import { useEffect, useState } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ToolTabsList as TabsList } from "@/components/tool";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { apiIssueMessage } from "@/lib/api-issue-message";
import {
  BookOpen, Plus, Loader2, Package, Wrench, Calculator, Percent, Sparkles, AlertTriangle,
  Pencil, Trash2, Search,
} from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, SectionTitle, crmTable } from "@/components/crm-ui";
import { confirmAction } from "@/components/confirm-dialog";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const cents = (v: string) => Math.round((parseFloat(v) || 0) * 100);
const dollars = (c?: number | null) => (c === null || c === undefined ? "" : (c / 100).toString());

const TABS = ["items", "materials", "labor", "formula"] as const;
const FALLBACK_UNITS = ["ea", "sq", "sf", "lf", "hr", "job"];

/**
 * Pricing modes the SKU dialog can fully set up. computed/formula/percentage
 * need a materials-and-labor, formula or percent editor this dialog doesn't
 * have — offering them made SKUs that preview to $0 — so they only appear
 * when editing a SKU that already uses one (its setup is left untouched).
 */
const EDITABLE_MODES: Record<string, string> = { flat: "Flat price", per_sqft: "Per sq ft (measured)" };

/** Server field keys → the labels on these forms, for validation toasts. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name", code: "Code", sku: "SKU", unit: "Unit", costCents: "Cost", priceCents: "Price",
  wasteFactorBps: "Waste %", hourlyCostCents: "Cost/hr", hourlyPriceCents: "Price/hr",
  flatPriceCents: "Price", flatCostCents: "Cost", rateCentsPerSqft: "Rate", description: "Description",
};

/**
 * Starter templates — HCP-depth scope verbiage for the trades this company
 * actually sells. Picking one prefills the SKU dialog (price stays yours to
 * set); the description rides onto every estimate line built from the SKU,
 * which is what the client reads before deciding.
 */
const ITEM_TEMPLATES: {
  name: string; unit: string; pricingMode: string; sqftMetric?: string; description: string;
}[] = [
  {
    name: "HardiePlank lap siding — supply & install",
    unit: "sf", pricingMode: "per_sqft", sqftMetric: "siding",
    description:
      "Furnish and install James Hardie HardiePlank® fiber-cement lap siding on the elevations listed.\n" +
      "• Remove and dispose of existing siding where noted\n" +
      "• Inspect wall sheathing; report any rot before covering\n" +
      "• Install weather-resistive barrier and flash all openings\n" +
      "• Install siding per manufacturer specs, blind-nailed\n" +
      "• Caulk all joints and penetrations\n" +
      "• Daily cleanup and magnetic nail sweep\n" +
      "Backed by Hardie's 30-year product warranty and our workmanship warranty.",
  },
  {
    name: "HardiePanel vertical siding — supply & install",
    unit: "sf", pricingMode: "per_sqft", sqftMetric: "siding",
    description:
      "Furnish and install James Hardie HardiePanel® vertical fiber-cement panels with batten strips where shown.\n" +
      "• Weather-resistive barrier and flashing included\n" +
      "• Panels fastened per manufacturer spec\n" +
      "• Color-matched caulk at all seams\n" +
      "• 30-year Hardie product warranty included",
  },
  {
    name: "HardieTrim boards — supply & install",
    unit: "lf", pricingMode: "flat",
    description:
      "Furnish and install James Hardie HardieTrim® fiber-cement boards at corners, frieze, windows and doors.\n" +
      "• Primed, ready for paint\n" +
      "• All joints flashed and caulked\n" +
      "• Fastened per manufacturer spec",
  },
  {
    name: "Re-roof — architectural shingles",
    unit: "sf", pricingMode: "per_sqft", sqftMetric: "roof",
    description:
      "Complete tear-off and re-roof with architectural laminated shingles.\n" +
      "• Tear off existing roofing to the deck and dispose\n" +
      "• Inspect decking; replace damaged sheets at the unit price noted\n" +
      "• Ice & water shield at eaves, valleys and penetrations\n" +
      "• Synthetic underlayment over the entire deck\n" +
      "• New drip edge, pipe boots and step/counter flashing\n" +
      "• Ridge vent installed where the design allows\n" +
      "• Magnetic nail sweep and full site cleanup\n" +
      "Manufacturer's limited lifetime shingle warranty; workmanship warranty in writing.",
  },
  {
    name: "Standing-seam metal roof",
    unit: "sf", pricingMode: "per_sqft", sqftMetric: "roof",
    description:
      "Furnish and install a standing-seam metal roof system over new underlayment.\n" +
      "• Tear-off and disposal of existing roofing\n" +
      "• High-temp ice & water shield over the full deck\n" +
      "• 24-gauge panels, concealed fasteners, factory finish\n" +
      "• All trim, ridge, and flashing in matching metal\n" +
      "• 40-year finish warranty",
  },
  {
    name: "Exterior repaint — two coats",
    unit: "sf", pricingMode: "per_sqft", sqftMetric: "siding",
    description:
      "Prep and paint the exterior surfaces listed.\n" +
      "• Pressure wash and allow full dry time\n" +
      "• Scrape, sand and spot-prime failing areas\n" +
      "• Caulk gaps at trim, windows and doors\n" +
      "• Two finish coats of premium 100% acrylic exterior paint\n" +
      "• Mask and protect windows, roofing and landscaping\n" +
      "• Walkthrough and touch-up before final payment",
  },
  {
    name: "Seamless gutters — 5K aluminum",
    unit: "lf", pricingMode: "flat",
    description:
      "Furnish and install seamless 5\" K-style aluminum gutters with downspouts.\n" +
      "• Formed on site to exact lengths — no leaky seams\n" +
      "• Hidden hangers at 24\" on center\n" +
      "• Downspouts placed to move water away from the foundation\n" +
      "• Old gutters hauled away",
  },
  {
    name: "Window replacement — vinyl, per opening",
    unit: "ea", pricingMode: "flat",
    description:
      "Replace the window opening listed with a new insulated vinyl unit.\n" +
      "• Remove the existing unit and inspect the rough opening\n" +
      "• Flash and insulate the perimeter\n" +
      "• Set, level and fasten the new unit\n" +
      "• Interior/exterior seal and trim as noted\n" +
      "• Haul away the old window",
  },
  {
    name: "Soffit & fascia — supply & install",
    unit: "lf", pricingMode: "flat",
    description:
      "Furnish and install new soffit and fascia along the runs listed.\n" +
      "• Remove rotted material; sister in new framing where needed\n" +
      "• Vented soffit panels for attic airflow\n" +
      "• Color-matched aluminum or fiber-cement fascia wrap\n" +
      "• Sealed at all joints and corners",
  },
  {
    name: "Deck resurfacing — composite",
    unit: "sf", pricingMode: "flat",
    description:
      "Resurface the deck with composite decking on the existing frame.\n" +
      "• Inspect the frame and ledger; report any structural repairs before decking\n" +
      "• Remove old deck boards and dispose\n" +
      "• Install composite decking with hidden fasteners\n" +
      "• New picture-frame border and fascia\n" +
      "• 25-year manufacturer fade & stain warranty",
  },
];

export default function CrmPriceBookPage() {
  const { toast } = useToast();
  // The tab lives in ?tab= so a reload (or a shared link) lands on the same one.
  const search = useSearch();
  const [, navigate] = useLocation();
  const tabParam = new URLSearchParams(search).get("tab");
  const tab = (TABS as readonly string[]).includes(tabParam ?? "") ? tabParam! : "items";
  const setTab = (t: string) => navigate(`/crm/pricebook?tab=${t}`, { replace: true });

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.managePriceBook === true;
  const seeCosts = me?.permissions?.seeCosts === true;
  const seePrices = me?.permissions?.seePrices === true;

  const { data: meta } = useQuery<any>({ queryKey: ["/api/crm/pricebook/meta"] });
  const units: string[] = meta?.units ?? FALLBACK_UNITS;

  // ── Price Chart search + category filter (the list route's ?q= / categoryId=) ──
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  const [catId, setCatId] = useState("all");
  const filtering = !!qDebounced || catId !== "all";
  const { data: categories } = useQuery<any[]>({ queryKey: ["/api/crm/pricebook/categories"] });
  const { data: items, isLoading: itemsLoading, isError: itemsError } = useQuery<any[]>({
    queryKey: ["/api/crm/pricebook/items", { q: qDebounced, categoryId: catId }],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (qDebounced) sp.set("q", qDebounced);
      if (catId !== "all") sp.set("categoryId", catId);
      const qs = sp.toString();
      const r = await fetch(`/api/crm/pricebook/items${qs ? `?${qs}` : ""}`, { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    },
    placeholderData: keepPreviousData,
  });
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

  const itemsState = listState(itemsLoading, itemsError, items, filtering
    ? "No SKUs match that search."
    : `No SKUs yet.${canManage ? " Add one below, or seed the starter set above." : ""}`);
  const matsState = listState(matsLoading, matsError, materials, "No materials yet.");
  const laborState = listState(laborLoading, laborError, labor, "No labor rates yet.");

  const invalidate = () => {
    ["items", "materials", "labor-rates"].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [`/api/crm/pricebook/${k}`] }));
    // SKU previews are priced from those same items, materials and labor
    // rates — re-price them too, or an open preview keeps the pre-edit total.
    queryClient.invalidateQueries({
      predicate: (q) => /^\/api\/crm\/pricebook\/items\/[^/]+\/preview$/.test(String(q.queryKey[0])),
    });
  };
  /** onError for every write: the server's own words, not its raw JSON. */
  const fail = (title: string) => (e: any) =>
    toast({ title, description: apiIssueMessage(e, FIELD_LABELS), variant: "destructive" });

  const seed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/seed", {})).json(),
    onSuccess: (r: any) => { invalidate(); toast({ title: "Starter price book added", description: r.note }); },
    onError: fail("Could not seed"),
  });

  // ── materials: add / edit / remove ──
  // Cost and price are only sent when this user can see them — a hidden
  // field must never overwrite the real number with a blank.
  const emptyMat = { name: "", sku: "", unit: "ea", cost: "", price: "", waste: "0" };
  const matBody = (m: typeof emptyMat) => ({
    name: m.name.trim(), sku: m.sku.trim() || null, unit: m.unit,
    ...(seeCosts ? { costCents: cents(m.cost) } : {}),
    ...(seePrices ? { priceCents: cents(m.price) } : {}),
    wasteFactorBps: Math.round((parseFloat(m.waste) || 0) * 100),
  });
  const [mat, setMat] = useState(emptyMat);
  const addMat = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/materials", matBody(mat))).json(),
    onSuccess: () => { invalidate(); setMat(emptyMat); toast({ title: "Material added" }); },
    onError: fail("Could not add material"),
  });
  const [matDlg, setMatDlg] = useState<{ id: string; form: typeof emptyMat } | null>(null);
  const saveMat = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/crm/pricebook/materials/${matDlg!.id}`, matBody(matDlg!.form))).json(),
    onSuccess: () => { invalidate(); setMatDlg(null); toast({ title: "Material updated" }); },
    onError: fail("Could not save material"),
  });
  const delMat = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/pricebook/materials/${id}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: "Material removed" }); },
    onError: fail("Could not remove material"),
  });

  // ── labor rates: add / edit / remove ──
  const emptyLab = { name: "", cost: "", price: "" };
  const labBody = (l: typeof emptyLab) => ({
    name: l.name.trim(),
    ...(seeCosts ? { hourlyCostCents: cents(l.cost) } : {}),
    ...(seePrices ? { hourlyPriceCents: cents(l.price) } : {}),
  });
  const [lab, setLab] = useState(emptyLab);
  const addLab = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/pricebook/labor-rates", labBody(lab))).json(),
    onSuccess: () => { invalidate(); setLab(emptyLab); toast({ title: "Labor rate added" }); },
    onError: fail("Could not add labor rate"),
  });
  const [labDlg, setLabDlg] = useState<{ id: string; form: typeof emptyLab } | null>(null);
  const saveLab = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/crm/pricebook/labor-rates/${labDlg!.id}`, labBody(labDlg!.form))).json(),
    onSuccess: () => { invalidate(); setLabDlg(null); toast({ title: "Labor rate updated" }); },
    onError: fail("Could not save labor rate"),
  });
  const delLab = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/pricebook/labor-rates/${id}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: "Labor rate removed" }); },
    onError: fail("Could not remove labor rate"),
  });

  // ── price chart SKU: add / edit / delete ──
  const emptyItemForm = {
    name: "", code: "", unit: "ea", pricingMode: "flat",
    flatPrice: "", flatCost: "", ratePerSqft: "", sqftMetric: "auto", description: "",
  };
  // dlg.id null → creating; otherwise editing that item. origMode is the
  // item's saved mode, kept selectable even when the dialog can't edit it.
  const [dlg, setDlg] = useState<{ id: string | null; origMode?: string; form: typeof emptyItemForm } | null>(null);
  const openEdit = (i: any) => setDlg({
    id: i.id,
    origMode: i.pricingMode,
    form: {
      name: i.name ?? "", code: i.code ?? "", unit: i.unit ?? "ea",
      pricingMode: i.pricingMode ?? "flat",
      flatPrice: dollars(i.flatPriceCents),
      flatCost: dollars(i.flatCostCents),
      ratePerSqft: dollars(i.rateCentsPerSqft),
      sqftMetric: i.sqftMetric ?? "auto",
      description: i.description ?? "",
    },
  });
  const modeOptions = [
    ...Object.keys(EDITABLE_MODES),
    ...(dlg?.origMode && !EDITABLE_MODES[dlg.origMode] ? [dlg.origMode] : []),
  ];
  // A blank price used to save as $0.00 — a flat SKU needs its price, a
  // per-sq-ft SKU its rate (only asked of users who can see prices).
  const priceMissing = !!dlg && seePrices && (
    (dlg.form.pricingMode === "flat" && !dlg.form.flatPrice.trim()) ||
    (dlg.form.pricingMode === "per_sqft" && !dlg.form.ratePerSqft.trim()));
  const saveItem = useMutation({
    mutationFn: async () => {
      if (!dlg) throw new Error("No item");
      const body: any = {
        name: dlg.form.name.trim(), code: dlg.form.code.trim() || null,
        unit: dlg.form.unit, pricingMode: dlg.form.pricingMode,
        description: dlg.form.description || null,
      };
      const opt = (v: string) => (v.trim() === "" ? null : cents(v));
      if (dlg.form.pricingMode === "flat") {
        if (seePrices) body.flatPriceCents = opt(dlg.form.flatPrice);
        if (seeCosts) body.flatCostCents = opt(dlg.form.flatCost);
      }
      if (dlg.form.pricingMode === "per_sqft") {
        if (seePrices) body.rateCentsPerSqft = opt(dlg.form.ratePerSqft);
        body.sqftMetric = dlg.form.sqftMetric === "auto" ? null : dlg.form.sqftMetric;
      }
      const r = await apiRequest(dlg.id ? "PATCH" : "POST",
        dlg.id ? `/api/crm/pricebook/items/${dlg.id}` : "/api/crm/pricebook/items", body);
      return r.json();
    },
    onSuccess: () => {
      invalidate(); setDlg(null);
      toast({ title: dlg?.id ? "SKU updated" : "SKU added" });
    },
    onError: fail("Could not save"),
  });
  const delItem = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/pricebook/items/${id}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: "SKU deleted" }); },
    onError: fail("Could not delete"),
  });

  // ── template picker (prefills the SKU dialog) ──
  const [tmplOpen, setTmplOpen] = useState(false);
  const useTemplate = (t: (typeof ITEM_TEMPLATES)[number]) => {
    setTmplOpen(false);
    setDlg({
      id: null,
      form: {
        ...emptyItemForm,
        name: t.name, unit: t.unit, pricingMode: t.pricingMode,
        sqftMetric: t.sqftMetric ?? "auto", description: t.description,
      },
    });
  };

  // ── formula tester ──
  const [f, setF] = useState({ formula: "ceil([SQUARES] * (1 + [WASTE]/100))", squares: "32", waste: "10" });
  const [fres, setFres] = useState<string | null>(null);
  const [fwarn, setFwarn] = useState<string[]>([]);
  const testF = useMutation({
    mutationFn: async () => {
      // Plain fetch, not apiRequest: this route answers a bad formula with
      // 400 { error }, and apiRequest would throw its raw "400: {json}" first.
      const r = await fetch("/api/crm/pricebook/formula/test", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formula: f.formula,
          symbols: { SQUARES: parseFloat(f.squares) || 0, WASTE: parseFloat(f.waste) || 0 },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || j.message || `Couldn't test the formula (${r.status}).`);
      return j;
    },
    onSuccess: (j: any) => {
      setFres(`= ${j.result}  (symbols: ${j.symbols.join(", ") || "none"})`);
      setFwarn(j.warnings ?? []);
    },
    onError: (e: any) => { setFres(`✕ ${String(e.message ?? e)}`); setFwarn([]); },
  });

  // ── assembly preview — each SKU keeps its own qty ──
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [prevId, setPrevId] = useState<string | null>(null);
  const prevQtyRaw = (prevId && qtyById[prevId]?.trim()) || "1";
  const prevQty = parseFloat(prevQtyRaw);
  const prevQtyBad = !Number.isFinite(prevQty) || prevQty < 0;
  const { data: preview, error: previewErr } = useQuery<any>({
    queryKey: [`/api/crm/pricebook/items/${prevId}/preview`, prevQtyRaw],
    enabled: !!prevId && !prevQtyBad,
    queryFn: async () => {
      const r = await apiRequest("POST", `/api/crm/pricebook/items/${prevId}/preview`, {
        quantityMilli: Math.round(prevQty * 1000),
      });
      return r.json();
    },
  });

  /** "$18,850.00 per job" for flat, "$4.25/sq ft" for per-sq-ft; unit only if prices are hidden. */
  const priceLabel = (i: any) => {
    if (i.pricingMode === "per_sqft") {
      if (i.rateCentsPerSqft === undefined) return "per sq ft";
      return i.rateCentsPerSqft != null ? `${money(i.rateCentsPerSqft)}/sq ft` : "no rate set";
    }
    if (i.pricingMode === "flat" && i.flatPriceCents !== undefined) {
      return i.flatPriceCents != null ? `${money(i.flatPriceCents)} per ${i.unit}` : `no price set · per ${i.unit}`;
    }
    return `per ${i.unit}`;
  };

  return (
    <CrmPage>
      <CrmPageHeader
        icon={BookOpen}
        title="Price book"
        infoKey="pricebook"
        subtitle="Price each SKU once, then estimate by quantity. Waste factors are a real field, not a formula trick."
        actions={canManage && !itemsLoading && !filtering && !items?.length ? (
          <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending} data-testid="button-seed-pb">
            {seed.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Add starter roofing set
          </Button>
        ) : undefined}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items"><Package className="h-4 w-4 mr-1" /> Price Chart</TabsTrigger>
          <TabsTrigger value="materials"><Wrench className="h-4 w-4 mr-1" /> Materials</TabsTrigger>
          <TabsTrigger value="labor"><Percent className="h-4 w-4 mr-1" /> Labor</TabsTrigger>
          <TabsTrigger value="formula"><Calculator className="h-4 w-4 mr-1" /> Formulas</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search SKUs by name or code" data-testid="input-search-items" />
            </div>
            {!!categories?.length && (
              <Select value={catId} onValueChange={setCatId}>
                <SelectTrigger className="w-44" data-testid="select-item-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {canManage && (
              <div className="flex gap-2 ml-auto">
                <Button size="sm" variant="outline" onClick={() => setTmplOpen(true)}
                  data-testid="button-from-template">
                  <Sparkles className="h-4 w-4 mr-1" /> From template
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDlg({ id: null, form: { ...emptyItemForm } })}
                  data-testid="button-add-item">
                  <Plus className="h-4 w-4 mr-1" /> Add SKU
                </Button>
              </div>
            )}
          </div>
          {!!items?.length && (
            <p className="text-xs text-muted-foreground" data-testid="text-item-count">
              {items.length >= 500
                ? "Showing the first 500 SKUs — search to narrow the list."
                : `${items.length} SKU${items.length === 1 ? "" : "s"}${filtering ? " found" : ""}`}
            </p>
          )}
          {itemsState && !items?.length && !itemsLoading && !itemsError && !filtering ? (
            <Card>
              <EmptyState
                icon={Package}
                title="No SKUs yet"
                description={canManage
                  ? "Add your first SKU, start from a template with the scope text written for you, or seed the starter roofing set."
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
                    <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
                      {i.code ? `${/^\d+$/.test(i.code) ? `SKU #${i.code}` : i.code} · ` : ""}
                      <span data-testid={`pb-item-price-${i.id}`}>{priceLabel(i)}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">{i.pricingMode}</Badge>
                      {i.pricingMode === "per_sqft" && i.customFields?.quickBidRate?.placeholder && (
                        <Badge variant="outline" className="text-[10px] font-normal text-amber-600 border-amber-600/40">
                          placeholder rate — set yours
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input className="w-24 h-9" type="number" min={0} step="any" placeholder="qty"
                      value={qtyById[i.id] ?? ""}
                      onChange={(e) => setQtyById({ ...qtyById, [i.id]: e.target.value })}
                      data-testid={`input-qty-${i.id}`} />
                    <Button size="sm" variant="outline" onClick={() => setPrevId(i.id)}
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
                            confirmAction({
                              id: "delete-item",
                              title: `Delete "${i.name}"?`,
                              description: "It is removed from the price book and can no longer be added to new estimates. Estimates that already use it keep it. This can't be undone here — to bring it back you would add it again.",
                              confirmLabel: "Delete item",
                              onConfirm: () => delItem.mutate(i.id),
                            });
                          }}
                          disabled={delItem.isPending}
                          data-testid={`button-delete-item-${i.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {i.description && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3"
                    data-testid={`pb-item-desc-${i.id}`}>
                    {i.description}
                  </p>
                )}
                {i.formulaSymbols?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    formula uses: {i.formulaSymbols.map((s: string) => `[${s}]`).join(" ")}
                  </div>
                )}
                {prevId === i.id && preview && !prevQtyBad && (
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
                            <td className={crmTable.td} colSpan={4} data-testid={`preview-margin-${i.id}`}>
                              {/* A blank SKU cost is saved as null (unknown); the server
                                  totals it as $0, which would read as a 100% margin. */}
                              {preview.lines?.some((l: any) => l.unitCostCents === null)
                                ? "No cost on file for this SKU, so no margin is shown."
                                : `cost ${money(preview.totalCostCents)} · margin ${(preview.marginBps / 100).toFixed(1)}%`}
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
                {prevId === i.id && (prevQtyBad || previewErr) && (
                  <p className="text-sm text-destructive mt-2" data-testid={`preview-error-${i.id}`}>
                    {prevQtyBad
                      ? "Quantity must be a number, 0 or more."
                      : `Couldn't preview this SKU: ${apiErrorMessage(previewErr)}`}
                  </p>
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
                <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                  <div className="flex-1 min-w-[180px]"><Label className="text-xs">Name</Label>
                    <Input value={mat.name} maxLength={200} onChange={(e) => setMat({ ...mat, name: e.target.value })}
                      placeholder="Architectural shingles" data-testid="input-mat-name" /></div>
                  <div className="w-28"><Label className="text-xs">SKU</Label>
                    <Input value={mat.sku} maxLength={80} onChange={(e) => setMat({ ...mat, sku: e.target.value })} /></div>
                  <div className="w-24"><Label className="text-xs">Unit</Label>
                    <Select value={mat.unit} onValueChange={(v) => setMat({ ...mat, unit: v })}>
                      <SelectTrigger data-testid="select-mat-unit"><SelectValue /></SelectTrigger>
                      <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                    </Select></div>
                  {seeCosts && (
                    <div className="w-28"><Label className="text-xs">Cost $</Label>
                      <Input type="number" min={0} step="0.01" value={mat.cost} onChange={(e) => setMat({ ...mat, cost: e.target.value })} /></div>
                  )}
                  {seePrices && (
                    <div className="w-28"><Label className="text-xs">Price $</Label>
                      <Input type="number" min={0} step="0.01" value={mat.price} onChange={(e) => setMat({ ...mat, price: e.target.value })} /></div>
                  )}
                  <div className="w-20"><Label className="text-xs">Waste%</Label>
                    <Input type="number" min={0} max={100} value={mat.waste}
                      onChange={(e) => setMat({ ...mat, waste: e.target.value })} /></div>
                  <Button size="sm" className="h-10" disabled={!mat.name.trim() || addMat.isPending}
                    onClick={() => addMat.mutate()} data-testid="button-add-material"><Plus className="h-4 w-4" /></Button>
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
                      {canManage && <th className={crmTable.thRight}><span className="sr-only">Actions</span></th>}
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
                            {canManage && (
                              <td className={`${crmTable.tdRight} whitespace-nowrap`}>
                                <Button size="sm" variant="ghost" data-testid={`button-edit-mat-${m.id}`}
                                  onClick={() => setMatDlg({ id: m.id, form: {
                                    name: m.name ?? "", sku: m.sku ?? "", unit: m.unit ?? "ea",
                                    cost: dollars(m.costCents), price: dollars(m.priceCents),
                                    waste: ((m.wasteFactorBps ?? 0) / 100).toString(),
                                  } })}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" disabled={delMat.isPending} data-testid={`button-delete-mat-${m.id}`}
                                  onClick={() => {
                                    confirmAction({
                                      id: "delete-material",
                                      title: `Remove "${m.name}" from the price book?`,
                                      description: "It can no longer be picked for new SKUs. SKUs already built on it keep pricing it. This can't be undone here — to bring it back you would add it again.",
                                      confirmLabel: "Remove material",
                                      onConfirm: () => delMat.mutate(m.id),
                                    });
                                  }}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {matsState && <tr><td className="p-1" colSpan={7}>{matsState}</td></tr>}
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
                    <Input value={lab.name} maxLength={120} onChange={(e) => setLab({ ...lab, name: e.target.value })}
                      placeholder="Roofing crew" data-testid="input-lab-name" /></div>
                  {seeCosts && (
                    <div><Label className="text-xs">Cost/hr $</Label>
                      <Input type="number" min={0} step="0.01" value={lab.cost} onChange={(e) => setLab({ ...lab, cost: e.target.value })} /></div>
                  )}
                  {seePrices && (
                    <div><Label className="text-xs">Price/hr $</Label>
                      <Input type="number" min={0} step="0.01" value={lab.price} onChange={(e) => setLab({ ...lab, price: e.target.value })} /></div>
                  )}
                  <Button size="sm" className="h-10" disabled={!lab.name.trim() || addLab.isPending} onClick={() => addLab.mutate()}
                    data-testid="button-add-labor"><Plus className="h-4 w-4" /></Button>
                </div>
              )}
              {laborState}
              {!labor?.length && !laborLoading && !laborError && (
                <EmptyState compact icon={Percent} title="No labor rates yet" />
              )}
              {labor?.map((l) => (
                <div key={l.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  data-testid={`pb-lab-${l.id}`}>
                  <div className="font-medium flex items-center gap-2">
                    {l.name}{l.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
                  </div>
                  <div className="flex items-center gap-1 text-sm tabular-nums">
                    {seeCosts && <span className="text-muted-foreground mr-3">cost {money(l.hourlyCostCents)}/hr</span>}
                    <span className="font-medium">{money(l.hourlyPriceCents)}/hr</span>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" className="ml-2" data-testid={`button-edit-lab-${l.id}`}
                          onClick={() => setLabDlg({ id: l.id, form: {
                            name: l.name ?? "", cost: dollars(l.hourlyCostCents), price: dollars(l.hourlyPriceCents),
                          } })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={delLab.isPending} data-testid={`button-delete-lab-${l.id}`}
                          onClick={() => {
                            confirmAction({
                              id: "delete-labor-rate",
                              title: `Remove "${l.name}"?`,
                              description: "This labor rate can no longer be picked for new SKUs. SKUs already built on it keep pricing it. This can't be undone here — to bring it back you would add it again.",
                              confirmLabel: "Remove labor rate",
                              onConfirm: () => delLab.mutate(l.id),
                            });
                          }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
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
                <Input value={f.formula} maxLength={500}
                  onChange={(e) => { setF({ ...f, formula: e.target.value }); setFres(null); setFwarn([]); }}
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
              {fwarn.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1" data-testid="text-formula-warning">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {fwarn.join(" ")}
                </p>
              )}
              <Separator />
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Available symbols: {meta?.symbols?.map((s: string) => `[${s}]`).join(" ")}</div>
                <div>
                  Formulas are parsed by our own evaluator, not <code>eval</code> — only numbers,
                  <code> + - * / %</code>, parentheses and min/max/ceil/floor/round are accepted.
                  Dividing by zero gives 0.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Template picker — prewritten scope text for the trades we sell. */}
      <Dialog open={tmplOpen} onOpenChange={setTmplOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="dialog-templates">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The scope text is written for you — set your price, tweak the words, save.
          </p>
          <div className="space-y-2">
            {ITEM_TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => useTemplate(t)}
                className="w-full text-left rounded-lg border bg-card px-3.5 py-3 hover:bg-accent transition-colors"
                data-testid={`template-${t.name.slice(0, 24).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  per {t.unit} · {t.pricingMode}
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                  {t.description}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dlg} onOpenChange={(open) => { if (!open) setDlg(null); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="dialog-item">
          <DialogHeader>
            <DialogTitle>{dlg?.id ? "Edit SKU" : "Add SKU"}</DialogTitle>
          </DialogHeader>
          {dlg && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={dlg.form.name} maxLength={200}
                    onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, name: e.target.value } })}
                    placeholder="Re-roof, architectural" data-testid="input-item-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Code</Label>
                  <Input value={dlg.form.code} maxLength={60}
                    onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, code: e.target.value } })}
                    placeholder="auto — next SKU number" data-testid="input-item-code" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unit</Label>
                  <Select value={dlg.form.unit}
                    onValueChange={(v) => setDlg({ ...dlg, form: { ...dlg.form, unit: v } })}>
                    <SelectTrigger data-testid="select-item-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {units.map((u: string) => (
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
                      {modeOptions.map((m) => (
                        <SelectItem key={m} value={m}>{EDITABLE_MODES[m] ?? `${m} (current setup)`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!EDITABLE_MODES[dlg.form.pricingMode] && (
                  <p className="sm:col-span-2 text-xs text-muted-foreground" data-testid="text-item-mode-note">
                    This SKU prices by its {dlg.form.pricingMode} setup, which this dialog can't edit — saving
                    keeps that setup as it is. Switch to a flat price or a per-sq-ft rate to price it here.
                  </p>
                )}
                {dlg.form.pricingMode === "flat" && (
                  <>
                    {seePrices && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Price $</Label>
                        <Input type="number" min={0} step="0.01" value={dlg.form.flatPrice}
                          onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, flatPrice: e.target.value } })}
                          data-testid="input-item-flat-price" />
                      </div>
                    )}
                    {seeCosts && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Cost $ (optional)</Label>
                        <Input type="number" min={0} step="0.01" value={dlg.form.flatCost}
                          onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, flatCost: e.target.value } })}
                          data-testid="input-item-flat-cost" />
                      </div>
                    )}
                  </>
                )}
                {dlg.form.pricingMode === "per_sqft" && (
                  <>
                    {seePrices && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Rate $/sq ft</Label>
                        <Input type="number" min={0} step="0.01" value={dlg.form.ratePerSqft}
                          onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, ratePerSqft: e.target.value } })}
                          placeholder="18.00" data-testid="input-item-rate-sqft" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Measured area</Label>
                      <Select value={dlg.form.sqftMetric}
                        onValueChange={(v) => setDlg({ ...dlg, form: { ...dlg.form, sqftMetric: v } })}>
                        <SelectTrigger data-testid="select-item-sqft-metric"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">auto (from the name)</SelectItem>
                          <SelectItem value="roof">roof sq ft</SelectItem>
                          <SelectItem value="siding">siding sq ft</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Scope / description (shows on every estimate built from this SKU)</Label>
                <Textarea rows={6} value={dlg.form.description} maxLength={4000}
                  onChange={(e) => setDlg({ ...dlg, form: { ...dlg.form, description: e.target.value } })}
                  placeholder={"What's included, line by line. The client reads this before deciding.\n• Tear off and dispose\n• New underlayment\n• …"}
                  data-testid="input-item-description" />
                <p className="text-[11px] text-muted-foreground">
                  Multi-line bullets are preserved on the client-facing estimate.
                </p>
              </div>
              {priceMissing && (
                <p className="text-xs text-destructive" data-testid="text-item-price-missing">
                  {dlg.form.pricingMode === "flat" ? "Enter a price" : "Enter a rate per sq ft"} — a blank one would price this SKU at $0.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)} data-testid="button-cancel-item">Cancel</Button>
            <Button disabled={!dlg?.form.name.trim() || priceMissing || saveItem.isPending} onClick={() => saveItem.mutate()}
              data-testid="button-save-item">
              {saveItem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dlg?.id ? "Save changes" : "Add SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!matDlg} onOpenChange={(open) => { if (!open) setMatDlg(null); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-material">
          <DialogHeader><DialogTitle>Edit material</DialogTitle></DialogHeader>
          {matDlg && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Name</Label>
                <Input value={matDlg.form.name} maxLength={200} data-testid="input-edit-mat-name"
                  onChange={(e) => setMatDlg({ ...matDlg, form: { ...matDlg.form, name: e.target.value } })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">SKU</Label>
                <Input value={matDlg.form.sku} maxLength={80}
                  onChange={(e) => setMatDlg({ ...matDlg, form: { ...matDlg.form, sku: e.target.value } })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Unit</Label>
                <Select value={matDlg.form.unit} onValueChange={(v) => setMatDlg({ ...matDlg, form: { ...matDlg.form, unit: v } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select></div>
              {seeCosts && (
                <div className="space-y-1.5"><Label className="text-xs">Cost $</Label>
                  <Input type="number" min={0} step="0.01" value={matDlg.form.cost}
                    onChange={(e) => setMatDlg({ ...matDlg, form: { ...matDlg.form, cost: e.target.value } })} /></div>
              )}
              {seePrices && (
                <div className="space-y-1.5"><Label className="text-xs">Price $</Label>
                  <Input type="number" min={0} step="0.01" value={matDlg.form.price} data-testid="input-edit-mat-price"
                    onChange={(e) => setMatDlg({ ...matDlg, form: { ...matDlg.form, price: e.target.value } })} /></div>
              )}
              <div className="space-y-1.5"><Label className="text-xs">Waste %</Label>
                <Input type="number" min={0} max={100} value={matDlg.form.waste}
                  onChange={(e) => setMatDlg({ ...matDlg, form: { ...matDlg.form, waste: e.target.value } })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatDlg(null)}>Cancel</Button>
            <Button disabled={!matDlg?.form.name.trim() || saveMat.isPending} onClick={() => saveMat.mutate()}
              data-testid="button-save-mat">
              {saveMat.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!labDlg} onOpenChange={(open) => { if (!open) setLabDlg(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-labor">
          <DialogHeader><DialogTitle>Edit labor rate</DialogTitle></DialogHeader>
          {labDlg && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Name</Label>
                <Input value={labDlg.form.name} maxLength={120} data-testid="input-edit-lab-name"
                  onChange={(e) => setLabDlg({ ...labDlg, form: { ...labDlg.form, name: e.target.value } })} /></div>
              {seeCosts && (
                <div className="space-y-1.5"><Label className="text-xs">Cost/hr $</Label>
                  <Input type="number" min={0} step="0.01" value={labDlg.form.cost}
                    onChange={(e) => setLabDlg({ ...labDlg, form: { ...labDlg.form, cost: e.target.value } })} /></div>
              )}
              {seePrices && (
                <div className="space-y-1.5"><Label className="text-xs">Price/hr $</Label>
                  <Input type="number" min={0} step="0.01" value={labDlg.form.price} data-testid="input-edit-lab-price"
                    onChange={(e) => setLabDlg({ ...labDlg, form: { ...labDlg.form, price: e.target.value } })} /></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabDlg(null)}>Cancel</Button>
            <Button disabled={!labDlg?.form.name.trim() || saveLab.isPending} onClick={() => saveLab.mutate()}
              data-testid="button-save-lab">
              {saveLab.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
