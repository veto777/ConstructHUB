/**
 * /admin/partnerships/pricing — Partner pricing (owner, 2026-10-25: "a separate area for the list of companies and their
 * costs … make it all organized"). Every price a press-release wire, directory, article site or news outlet has quoted us,
 * one row each, grouped by what it buys and sorted cheapest per item first so wires and tiers compare side by side.
 * Prices are read from their emails on media@ and support@ (server/media-inbox/worker.ts) or typed in here. Platform admins only.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { ArrowLeft, Loader2, Lock, MessageSquare, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import {
  MEDIA_PARTNER_KINDS, MEDIA_PARTNER_KIND_LABELS, MEDIA_PARTNER_STATUS_LABELS, MEDIA_PRICE_CATEGORIES, MEDIA_PRICE_CATEGORY_LABELS, MEDIA_PRICE_UNITS, perItem,
  type MediaPartner, type MediaPartnerKind, type MediaPartnerStatus, type MediaPriceCategory, type MediaPriceRow, type MediaPriceUnit,
} from "@shared/media-inbox";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";

type Unpriced = { id: number; company: string; domain: string | null; kind: MediaPartnerKind; status: MediaPartnerStatus; costTerms: string | null; apiTerms: string | null; minCommitment: string | null };
type PricesPayload = { rows: MediaPriceRow[]; unpriced: Unpriced[] };
type Draft = { id?: number; partnerId: number | null; category: MediaPriceCategory; product: string; price: string; quantity: string; unit: MediaPriceUnit; notes: string; quotedAt: string };

const PARTNER_TONE: Record<MediaPartnerStatus, PillTone> = { talking: "info", agreed: "teal", finalized: "success", declined: "neutral" };
const UNIT_LABELS: Record<MediaPriceUnit, string> = { each: "each", "per month": "a month", "per year": "a year", "one-time": "one-time", "per listing / month": "per listing a month" };
const PRICES_URL = "/api/admin/media-inbox/prices";
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/media-inbox") });
const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (o: Partial<Draft> = {}): Draft => ({ partnerId: null, category: "press_release", product: "", price: "", quantity: "", unit: "each", notes: "", quotedAt: today(), ...o });
/** A company's conversation on the Partnerships page. */
const conversationHref = (partnerId: number) => `/admin/partnerships?open=${partnerId}`;
/** Owner, 2026-10-25: "make sure all the containers you can click". A whole card or row opens the company; buttons inside it keep their own action. */
const stop = (e: MouseEvent) => e.stopPropagation();
const opensOn = (open: () => void) => ({
  role: "button" as const, tabIndex: 0, onClick: open,
  onKeyDown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } },
});
const cardId = (partnerId: number) => `pricing-card-${partnerId}`;
/** What the per-item column shows: a bundle over its size, a one-off price as it is, "Free" for $0. Monthly fees have no per-item price. */
const perItemLabel = (r: MediaPriceRow) => {
  if (!r.quantity && r.unit !== "each" && r.unit !== "one-time") return "—";
  const v = perItem(r);
  return v === 0 ? "Free" : money(v);
};

/** One company's prices in a category, with its API and minimum terms. */
type Group = { partnerId: number; company: string; domain: string | null; status: MediaPartnerStatus; contact: string | null; apiTerms: string | null; minCommitment: string | null; rows: MediaPriceRow[]; best: number | null };

function groupRows(rows: MediaPriceRow[]): Group[] {
  const by = new Map<number, Group>();
  for (const r of rows) {
    const g = by.get(r.partnerId) ?? { partnerId: r.partnerId, company: r.company, domain: r.domain, status: r.status, contact: [r.contactName, r.contactEmail].filter(Boolean).join(" · ") || null, apiTerms: r.apiTerms, minCommitment: r.minCommitment, rows: [], best: null };
    g.rows.push(r);
    const each = r.unit === "each" || r.unit === "one-time" ? perItem(r) : null;
    if (each != null && (g.best == null || each < g.best)) g.best = each;
    by.set(r.partnerId, g);
  }
  // Cheapest per item first; companies without a one-off price after them.
  return [...by.values()].sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || a.company.localeCompare(b.company));
}

function PriceTable({ g, lowest, onOpen, onEdit, onDelete }: { g: Group; lowest: number | null; onOpen: () => void; onEdit: (r: MediaPriceRow) => void; onDelete: (r: MediaPriceRow) => void }) {
  return (
    <div id={cardId(g.partnerId)} {...opensOn(onOpen)} aria-label={`Open ${g.company}`}
      className="cursor-pointer scroll-mt-24 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`card-pricing-${g.partnerId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
            {g.company}
            <StatusPill tone={PARTNER_TONE[g.status]}>{MEDIA_PARTNER_STATUS_LABELS[g.status]}</StatusPill>
            {g.best != null && lowest != null && g.best === lowest && <StatusPill tone="success" dot={false}>{lowest === 0 ? "Free" : "Lowest per item"}</StatusPill>}
          </h3>
          <p className="text-xs text-foreground/70">{[g.domain, g.contact].filter(Boolean).join(" · ")}</p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={conversationHref(g.partnerId)} onClick={stop} data-testid={`link-pricing-conversation-${g.partnerId}`}><MessageSquare className="mr-2 h-4 w-4" />Conversation</Link>
        </Button>
      </div>
      <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium text-foreground/70">API</dt><dd>{g.apiTerms ?? "Not said yet"}</dd>
        <dt className="font-medium text-foreground/70">Minimum</dt><dd>{g.minCommitment ?? "None mentioned"}</dd>
      </dl>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-foreground/60">
              <th className="py-2 pr-3 font-medium">What it buys</th>
              <th className="py-2 pr-3 text-right font-medium">Price</th>
              <th className="py-2 pr-3 text-right font-medium">Per item</th>
              <th className="py-2 pr-3 font-medium">Notes</th>
              <th className="py-2 pr-3 font-medium">Quoted</th>
              <th className="py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top" data-testid={`row-price-${r.id}`}>
                <td className="py-2 pr-3 font-medium">{r.product}{r.quantity ? <span className="font-normal text-foreground/70"> · {r.quantity.toLocaleString("en-US")} items</span> : null}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(r.price)} <span className="text-xs text-foreground/60">{UNIT_LABELS[r.unit]}</span></td>
                <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{perItemLabel(r)}</td>
                <td className="py-2 pr-3 text-foreground/80">{r.notes ?? ""}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-foreground/70">{format(new Date(`${r.quotedAt}T12:00:00`), "MMM d, yyyy")}<br />{r.source}</td>
                <td className="whitespace-nowrap py-1 text-right" onClick={stop}>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${r.product}`} onClick={() => onEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${r.product}`} onClick={() => onDelete(r)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceSheet({ draft, partners, onClose }: { draft: Draft | null; partners: MediaPartner[]; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Draft | null>(draft);
  const [newCo, setNewCo] = useState<{ company: string; domain: string; kind: MediaPartnerKind } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let partnerId = f!.partnerId;
      if (!f!.id && newCo) partnerId = (await (await apiRequest("POST", "/api/admin/media-inbox/partners", { company: newCo.company.trim(), domain: newCo.domain.trim().toLowerCase() || null, kind: newCo.kind })).json()).id;
      const body = {
        category: f!.category, product: f!.product.trim(), price: f!.price.trim() ? Number(f!.price.replace(/[$,\s]/g, "")) : null,
        quantity: f!.quantity.trim() ? Number(f!.quantity.replace(/[,\s]/g, "")) : null, unit: f!.unit, notes: f!.notes.trim() || null, quotedAt: f!.quotedAt,
      };
      return (await apiRequest("POST", f!.id ? `${PRICES_URL}/${f!.id}` : PRICES_URL, f!.id ? body : { ...body, partnerId })).json();
    },
    onSuccess: () => { toast({ title: "Price saved" }); setNewCo(null); void refresh(); onClose(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!draft || !f) return null;
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const priceOk = !f.price.trim() || Number.isFinite(Number(f.price.replace(/[$,\s]/g, "")));
  const qtyOk = !f.quantity.trim() || (Number.isInteger(Number(f.quantity.replace(/[,\s]/g, ""))) && Number(f.quantity.replace(/[,\s]/g, "")) >= 2);
  const ready = f.product.trim() && priceOk && qtyOk && (f.id || f.partnerId || newCo?.company.trim());
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} data-testid="sheet-price">
        <SheetHeader>
          <SheetTitle>{f.id ? "Edit price" : "Add a price"}</SheetTitle>
          <SheetDescription>A bundle is its total price with how many items it buys; the per-item price is worked out from them.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 text-sm">
          {!f.id && (
            newCo ? (
              <div className="grid gap-2 rounded-lg border p-3">
                <Input placeholder="Company name" value={newCo.company} onChange={(e) => setNewCo({ ...newCo, company: e.target.value })} data-testid="input-price-new-company" />
                <Input placeholder="Website (example.com)" value={newCo.domain} onChange={(e) => setNewCo({ ...newCo, domain: e.target.value })} />
                <Select value={newCo.kind} onValueChange={(v) => setNewCo({ ...newCo, kind: v as MediaPartnerKind })}>
                  <SelectTrigger aria-label="Kind of company"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEDIA_PARTNER_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_PARTNER_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setNewCo(null)}>Pick an existing company instead</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={f.partnerId ? String(f.partnerId) : ""} onValueChange={(v) => setF({ ...f, partnerId: Number(v) })}>
                  <SelectTrigger aria-label="Company" data-testid="select-price-company"><SelectValue placeholder="Company" /></SelectTrigger>
                  <SelectContent>{[...partners].sort((a, b) => a.company.localeCompare(b.company)).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.company}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setNewCo({ company: "", domain: "", kind: "news" })}>New company</Button>
              </div>
            )
          )}
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v as MediaPriceCategory })}>
            <SelectTrigger aria-label="What it is for"><SelectValue /></SelectTrigger>
            <SelectContent>{MEDIA_PRICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{MEDIA_PRICE_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
          </Select>
          <Input aria-label="What it buys" placeholder="What it buys (e.g. Corporate Package bundle)" value={f.product} onChange={set("product")} data-testid="input-price-product" />
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Price in dollars" inputMode="decimal" placeholder="Price ($)" value={f.price} onChange={set("price")} data-testid="input-price-amount" />
            <Input aria-label="Items in the bundle" inputMode="numeric" placeholder="Items (bundle size)" value={f.quantity} onChange={set("quantity")} />
          </div>
          {(!priceOk || !qtyOk) && <p className="text-xs text-destructive">{!priceOk ? "The price must be a number." : "A bundle size is a whole number of 2 or more."}</p>}
          <Select value={f.unit} onValueChange={(v) => setF({ ...f, unit: v as MediaPriceUnit })}>
            <SelectTrigger aria-label="Billing"><SelectValue /></SelectTrigger>
            <SelectContent>{MEDIA_PRICE_UNITS.map((u) => <SelectItem key={u} value={u}>{UNIT_LABELS[u]}</SelectItem>)}</SelectContent>
          </Select>
          <Input aria-label="Notes" placeholder="Notes (discount, validity, what is included)" value={f.notes} onChange={set("notes")} />
          <Input aria-label="Date quoted" type="date" value={f.quotedAt} onChange={set("quotedAt")} />
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate()} data-testid="button-price-save">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save price
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminPartnerPricingPage() {
  useDocumentTitle("Partner pricing");
  const { toast } = useToast();
  const [tab, setTab] = useState<"all" | MediaPriceCategory>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [, navigate] = useLocation();
  const open = (partnerId: number) => navigate(conversationHref(partnerId));
  /** Switch tab, then bring a card or section into view once it has rendered. */
  const show = (t: typeof tab, selector: string | null) => {
    setTab(t);
    if (selector) window.setTimeout(() => document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const { data, error, isLoading, refetch } = useQuery<PricesPayload>({ queryKey: [PRICES_URL], queryFn: () => getJson(PRICES_URL), retry: false });
  const { data: partners } = useQuery<MediaPartner[]>({ queryKey: ["/api/admin/media-inbox/partners"], queryFn: () => getJson("/api/admin/media-inbox/partners"), enabled: !!data });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `${PRICES_URL}/${id}/delete`, {}),
    onSuccess: () => { toast({ title: "Price removed" }); void refresh(); },
    onError: (e) => toast({ title: "Not removed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const byCategory = useMemo(() => {
    const m = new Map<MediaPriceCategory, MediaPriceRow[]>();
    for (const r of data?.rows ?? []) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return m;
  }, [data]);

  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!data) {
    const reauth = error instanceof VerificationCancelled || /reauth/.test(String((error as Error | null)?.message ?? ""));
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-pricing-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{reauth ? "Verify it's you" : "Platform admins only"}</h1>
        {reauth && <Button className="mt-4" onClick={() => void refetch()}>Verify identity</Button>}
      </div>
    );
  }

  const companies = new Set(data.rows.map((r) => r.partnerId)).size;
  // A row without a price never counts as the cheapest.
  const releaseRows = (byCategory.get("press_release") ?? []).filter((r) => r.price != null && (r.unit === "each" || r.unit === "one-time"));
  const cheapestRow = releaseRows.reduce<MediaPriceRow | null>((m, r) => (m == null || (perItem(r) ?? Infinity) < (perItem(m) ?? Infinity) ? r : m), null);
  const cheapestRelease = cheapestRow ? perItem(cheapestRow) ?? Infinity : Infinity;
  const shown = MEDIA_PRICE_CATEGORIES.filter((c) => (tab === "all" || tab === c) && byCategory.get(c)?.length);
  const edit = (r: MediaPriceRow) => setDraft({ id: r.id, partnerId: r.partnerId, category: r.category, product: r.product, price: r.price == null ? "" : String(r.price), quantity: r.quantity ? String(r.quantity) : "", unit: r.unit, notes: r.notes ?? "", quotedAt: r.quotedAt });

  return (
    <AppPage testId="page-admin-partner-pricing">
      <Link href="/admin/partnerships" className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />Partnerships</Link>
      <GoogleSectionHeader as="h1" title="Partner pricing" description="Every price a wire, directory, article site or news outlet has quoted us, one row each and cheapest per item first. Read from their emails to media@ and support@, or added here." flush />
      <div className="min-w-0 space-y-4">
        <StatGrid cols={4}>
          <Stat label="Companies with prices" value={companies.toLocaleString("en-US")} onClick={() => show("all", null)} testId="stat-pricing-companies" />
          <Stat label="Prices on file" value={data.rows.length.toLocaleString("en-US")} onClick={() => show("all", null)} testId="stat-pricing-prices" />
          <Stat label="Cheapest press release" value={Number.isFinite(cheapestRelease) ? money(cheapestRelease) : "—"} hint={cheapestRow ? `${cheapestRow.company}, per release at its bundle size` : "per release, at its bundle size"}
            onClick={() => show("press_release", cheapestRow ? `#${cardId(cheapestRow.partnerId)}` : null)} testId="stat-pricing-cheapest" />
          <Stat label="Terms not itemized" value={data.unpriced.length.toLocaleString("en-US")} hint="their words, below" onClick={() => show(tab, "[data-testid=section-unpriced]")} testId="stat-pricing-unpriced" />
        </StatGrid>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              {MEDIA_PRICE_CATEGORIES.filter((c) => byCategory.get(c)?.length).map((c) => (
                <TabsTrigger key={c} value={c} data-testid={`tab-pricing-${c}`}>{MEDIA_PRICE_CATEGORY_LABELS[c]} ({new Set(byCategory.get(c)!.map((r) => r.partnerId)).size})</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button onClick={() => setDraft(emptyDraft(tab === "all" ? {} : { category: tab }))} data-testid="button-price-add"><Plus className="mr-2 h-4 w-4" />Add a price</Button>
        </div>

        {!data.rows.length && <Notice tone="info" title="No prices yet">Prices appear here as companies quote them.</Notice>}

        {shown.map((c) => {
          const groups = groupRows(byCategory.get(c)!);
          const lowest = groups.reduce<number | null>((m, g) => (g.best != null && (m == null || g.best < m) ? g.best : m), null);
          return (
            <Section key={c} title={MEDIA_PRICE_CATEGORY_LABELS[c]} icon={Receipt} testId={`section-pricing-${c}`}
              description={`${groups.length} ${groups.length === 1 ? "company" : "companies"}, cheapest per item first. Per item = a bundle's price over its size.`}>
              <div className="space-y-3">
                {groups.map((g) => <PriceTable key={g.partnerId} g={g} lowest={lowest} onOpen={() => open(g.partnerId)} onEdit={edit} onDelete={(r) => { if (window.confirm(`Remove “${r.product}” from ${r.company}?`)) remove.mutate(r.id); }} />)}
              </div>
            </Section>
          );
        })}

        {data.unpriced.length > 0 && (
          <Section title="Terms not itemized yet" testId="section-unpriced" description="Companies that mentioned money, an API or a minimum without a price we could put in a row. Their words, as they wrote them.">
            <ul className="divide-y text-sm">
              {data.unpriced.map((u) => (
                <li key={u.id} {...opensOn(() => open(u.id))} aria-label={`Open ${u.company}`}
                  className="-mx-2 flex cursor-pointer flex-wrap items-start justify-between gap-2 rounded-lg px-2 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`row-unpriced-${u.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">{u.company}<StatusPill tone={PARTNER_TONE[u.status]}>{MEDIA_PARTNER_STATUS_LABELS[u.status]}</StatusPill></div>
                    <div className="text-xs text-foreground/70">{[u.domain, MEDIA_PARTNER_KIND_LABELS[u.kind]].filter(Boolean).join(" · ")}</div>
                    {u.costTerms && <p className="mt-1">{u.costTerms}</p>}
                    {u.apiTerms && <p className="mt-1 text-foreground/80">API: {u.apiTerms}</p>}
                    {u.minCommitment && <p className="mt-1 text-foreground/80">Minimum: {u.minCommitment}</p>}
                  </div>
                  <div className="flex gap-2" onClick={stop}>
                    <Button size="sm" variant="outline" asChild><Link href={conversationHref(u.id)}>Conversation</Link></Button>
                    <Button size="sm" onClick={() => setDraft(emptyDraft({ partnerId: u.id, category: u.kind === "directory" ? "listing" : u.kind === "article" ? "article" : "other" }))}>Add price</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      {draft && <PriceSheet key={`${draft.id ?? "new"}-${draft.partnerId ?? ""}`} draft={draft} partners={partners ?? []} onClose={() => setDraft(null)} />}
    </AppPage>
  );
}
