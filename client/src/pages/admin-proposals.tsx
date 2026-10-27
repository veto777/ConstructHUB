/**
 * /admin/proposals — the proposal builder (shared/proposals.ts): reusable templates (an SEO or reputation
 * program with its packages and prices) and offers made from them for one recipient. An offer is emailed as a
 * link (/proposal/<token>) where the recipient chooses services, signs and pays — ACH free, card + the card fee.
 * /admin/proposals/:id is the editor for either kind.
 *
 * Platform admins only (the API answers 403 to anyone else; the second factor is handled like /admin/issues).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format } from "date-fns";
import {
  ArrowDown, ArrowLeft, ArrowUp, Archive, BellOff, BellRing, CalendarClock, Copy, CreditCard, Eye, FilePlus2, FileSignature, FileText, Loader2, Lock, Mail, Plus, Receipt, RotateCcw, Save, Send, Trash2, Upload, XCircle,
} from "lucide-react";
import {
  DEFAULT_CARD_FEE_BPS, DEFAULT_FULL_PAY_DISCOUNT_BPS, MAX_PDF_BYTES, MIN_PAYMENT_CENTS, PROPOSAL_STATUS_LABELS, REMINDER_EVERY_HOURS, autoPayLines, autoPaySchedule, cardFeeCents, defaultSelection, evenPlan, formatBps, formatMoney, isoDay, planNextDue, priceSelection, standardTerms,
  type ProposalContent, type ProposalDetail, type ProposalGroup, type ProposalItem, type ProposalRow, type ProposalStatus, type ProposalSummary,
} from "@shared/proposals";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { SamplePreview } from "@/components/sample-preview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { cn } from "@/lib/utils";
import { appPageTitle } from "@/lib/page-titles";
import { VerificationCancelled } from "@/components/recent-auth";

const STATUS_TONE: Record<ProposalStatus, PillTone> = {
  draft: "neutral", sent: "info", viewed: "violet", signed: "warning", partial: "teal", processing: "teal", paid: "success",
  payment_failed: "danger", declined: "danger", void: "neutral", archived: "neutral",
};
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const rid = () => Math.random().toString(36).slice(2, 10);
const invalidate = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/proposals") });
function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}

function Gate({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  const f = failure(error);
  if (error instanceof VerificationCancelled || f.body?.reauth === true) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-proposals-verify">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Verify it's you</h1>
        <Button className="mt-4" onClick={retry}>Verify identity</Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-proposals-denied">
      <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">{f.status === 401 || f.status === 403 ? "Platform admins only" : `Couldn't load ${what}`}</h1>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- list

function NewOfferDialog({ open, onClose, templates }: { open: boolean; onClose: () => void; templates: ProposalRow[] }) {
  const { toast } = useToast();
  const [, go] = useLocation();
  const [from, setFrom] = useState<string>("blank");
  const [rname, setRname] = useState(""); const [remail, setRemail] = useState(""); const [rco, setRco] = useState("");
  useEffect(() => { if (open && templates.length && from === "blank") setFrom(String(templates[0].id)); }, [open, templates.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: async () => {
      const made: ProposalDetail = await (await apiRequest("POST", "/api/admin/proposals", { kind: "offer", ...(from !== "blank" ? { fromId: Number(from) } : {}), ...(rname ? { name: `${rname}${rco ? ` — ${rco}` : ""}` } : {}) })).json();
      if (rname || remail || rco) await apiRequest("PUT", `/api/admin/proposals/${made.id}`, { recipientName: rname, recipientEmail: remail, recipientCompany: rco });
      return made;
    },
    onSuccess: (m) => { void invalidate(); onClose(); go(`/admin/proposals/${m.id}`); },
    onError: (e) => toast({ title: "Couldn't create the offer", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New offer</DialogTitle><DialogDescription>Start from a template — every section, package, price and the attached PDF are copied — then customize it for this client.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Start from</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger data-testid="select-offer-template"><SelectValue /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}<SelectItem value="blank">Blank proposal</SelectItem></SelectContent>
            </Select></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="no-name">Client name</Label><Input id="no-name" value={rname} onChange={(e) => setRname(e.target.value)} data-testid="input-offer-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="no-co">Company</Label><Input id="no-co" value={rco} onChange={(e) => setRco(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="no-email">Client email</Label><Input id="no-email" type="email" value={remail} onChange={(e) => setRemail(e.target.value)} data-testid="input-offer-email" /></div>
        </div>
        <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-create-offer">{create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create offer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Upload your own proposal PDF: the server lays it out as sections and pickable packages plus the contract terms. */
function ImportPdfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [, go] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"offer" | "template">("offer");
  const [rname, setRname] = useState(""); const [remail, setRemail] = useState(""); const [rco, setRco] = useState("");
  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a PDF");
      if (file.size > MAX_PDF_BYTES) throw new Error(`The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
      const dataBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Couldn't read the file")); r.readAsDataURL(file); });
      const { jobId } = await (await apiRequest("POST", "/api/admin/proposals/import", { kind, fileName: file.name, dataBase64, ...(kind === "offer" ? { recipientName: rname || undefined, recipientEmail: remail || undefined, recipientCompany: rco || undefined } : {}) })).json() as { jobId: string };
      // The server reads the PDF in the background (it can take a few minutes); check every few seconds.
      for (const stop = Date.now() + 15 * 60_000; Date.now() < stop;) {
        await new Promise((r) => setTimeout(r, 4000));
        const j = await getJson<{ status: "running" | "done" | "failed"; proposalId: number | null; error: string | null }>(`/api/admin/proposals/import/${jobId}`);
        if (j.status === "failed") throw new Error(j.error || "Couldn't build the proposal");
        if (j.status === "done" && j.proposalId) return getJson<ProposalDetail>(`/api/admin/proposals/${j.proposalId}`);
      }
      throw new Error("Reading the PDF is taking too long. Check the Offers list in a few minutes.");
    },
    onSuccess: (m) => {
      void invalidate(); onClose(); go(`/admin/proposals/${m.id}`);
      toast({ title: "Proposal built from your PDF", description: `${m.content.sections.length} sections and ${m.content.groups.reduce((n, g) => n + g.items.length, 0)} options. Check the prices and wording, then send.` });
    },
    onError: (e) => toast({ title: "Couldn't build the proposal", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !run.isPending && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload your proposal PDF</DialogTitle><DialogDescription>We turn it into the online proposal: your pages become sections, every priced service becomes an option the client can pick, and the contract terms are added (nothing guaranteed, no refunds, results tracked and every piece of work proven monthly). When the client signs, they and you get the signed service agreement as a PDF, like CRM contracts. You review everything — and can send yourself a proof — before it goes out.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="imp-file">Proposal PDF</Label>
            <Input id="imp-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-import-pdf" /></div>
          <div className="space-y-1.5"><Label>Make it</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger data-testid="select-import-kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="offer">An offer for one client</SelectItem><SelectItem value="template">A template to reuse</SelectItem></SelectContent>
            </Select></div>
          {kind === "offer" && <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="imp-name">Client name</Label><Input id="imp-name" value={rname} onChange={(e) => setRname(e.target.value)} placeholder="From the PDF if left blank" /></div>
              <div className="space-y-1.5"><Label htmlFor="imp-co">Company</Label><Input id="imp-co" value={rco} onChange={(e) => setRco(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="imp-email">Client email</Label><Input id="imp-email" type="email" value={remail} onChange={(e) => setRemail(e.target.value)} /></div>
          </>}
        </div>
        <DialogFooter><Button onClick={() => run.mutate()} disabled={run.isPending || !file} data-testid="button-import-pdf">
          {run.isPending ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Reading your PDF… this can take a few minutes</> : <><Upload className="mr-1.5 h-4 w-4" />Build the proposal</>}
        </Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SampleRows() {
  const rows = [
    { name: "Starter SEO — Example Dental", status: "paid" as const, total: 1_500_000, who: "Dr. Example" },
    { name: "Reputation restoration — Example LLC", status: "signed" as const, total: 2_207_000, who: "Jordan Example" },
    { name: "Pro SEO — Example Roofing", status: "viewed" as const, total: 3_300_000, who: "Sam Example" },
  ];
  return (
    <SamplePreview what="what your offers look like once you send some">
      <div className="divide-y rounded-lg border bg-card">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.who}</div></div>
            <span className="text-sm tabular-nums">{formatMoney(r.total)}</span>
            <StatusPill tone={STATUS_TONE[r.status]}>{PROPOSAL_STATUS_LABELS[r.status]}</StatusPill>
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}

function ProposalList() {
  useDocumentTitle(appPageTitle("/admin/proposals")!);
  const { toast } = useToast();
  const [, go] = useLocation();
  const [tab, setTab] = useState<"offer" | "template" | "archived">("offer");
  const [newOffer, setNewOffer] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const url = tab === "archived" ? "/api/admin/proposals?archived=1" : `/api/admin/proposals?kind=${tab}`;
  const { data, error, isLoading, refetch } = useQuery<{ rows: ProposalRow[]; summary: ProposalSummary }>({ queryKey: [url], queryFn: () => getJson(url) });
  const { data: tpl } = useQuery<{ rows: ProposalRow[] }>({ queryKey: ["/api/admin/proposals?kind=template"], queryFn: () => getJson("/api/admin/proposals?kind=template"), enabled: !!data });
  const newTemplate = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/proposals", { kind: "template" })).json() as Promise<ProposalDetail>,
    onSuccess: (m) => { void invalidate(); go(`/admin/proposals/${m.id}`); },
    onError: (e) => toast({ title: "Couldn't create the template", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!data) return <Gate error={error} retry={() => void refetch()} what="proposals" />;
  const s = data.summary;
  const rows = tab === "archived" ? data.rows.filter((r) => r.status === "archived") : data.rows;

  return (
    <AppPage testId="page-admin-proposals">
      <GoogleSectionHeader as="h1" title="Proposals" count={s.offers || null}
        description="Build a proposal once, send a custom offer to each client, and let them pick services, e-sign and pay online — ACH with no fee, card with a fee added."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => newTemplate.mutate()} disabled={newTemplate.isPending} data-testid="button-new-template"><FilePlus2 className="mr-1.5 h-4 w-4" />New template</Button>
          <Button variant="outline" size="sm" onClick={() => setNewOffer(true)} data-testid="button-new-offer"><Plus className="mr-1.5 h-4 w-4" />New offer</Button>
          <Button size="sm" onClick={() => setImportOpen(true)} data-testid="button-import-proposal"><Upload className="mr-1.5 h-4 w-4" />Upload your PDF</Button>
        </div>} flush />
      <div className="min-w-0 space-y-4">
        <StatGrid cols={4}>
          <Stat label="Templates" value={String(s.templates)} hint="reusable proposals" onClick={() => setTab("template")} selected={tab === "template"} testId="stat-proposals-templates" />
          <Stat label="Offers sent" value={String(s.sent)} hint={`${s.opened} opened`} onClick={() => setTab("offer")} selected={tab === "offer"} testId="stat-proposals-sent" />
          <Stat label="Signed" value={String(s.signed)} hint={`${formatMoney(s.signedValueCents)} contract value`} testId="stat-proposals-signed" />
          <Stat label="Paid" value={String(s.paid)} hint={`${formatMoney(s.paidCents)} collected`} tone={s.paid ? "good" : "default"} testId="stat-proposals-paid" />
        </StatGrid>

        <Section title="How this works" description="Templates hold your packages and prices; an offer is a copy you tailor for one client.">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Fastest: <b>Upload your PDF</b> — your proposal becomes the online version with pickable options and the contract terms. Check it, then send.</li>
            <li>Or make a <b>template</b>: branding, written sections, the PDF you'd normally send, and packages of priced services (choose-one tiers or add-ons).</li>
            <li>Click <b>New offer</b>, pick the template and the client, then change anything — prices, packages, wording — for that client only.</li>
            <li><b>Send</b> emails a secure link. The client chooses services, signs on screen and pays: bank transfer (ACH) free, card with the card fee added. You get an email at each step.</li>
          </ol>
        </Section>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="offer" data-testid="tab-proposals-offers">Offers ({s.offers})</TabsTrigger>
            <TabsTrigger value="template" data-testid="tab-proposals-templates">Templates ({s.templates})</TabsTrigger>
            <TabsTrigger value="archived" data-testid="tab-proposals-archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        {rows.length === 0 ? (
          tab === "offer" && s.offers === 0 ? <SampleRows /> : <p className="rounded-lg border px-3 py-8 text-center text-sm text-muted-foreground">{tab === "template" ? "No templates yet — click New template." : "Nothing here."}</p>
        ) : (
          <div className="divide-y rounded-lg border bg-card" data-testid="list-proposals">
            {rows.map((r) => (
              <Link key={r.id} href={`/admin/proposals/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50" data-testid={`row-proposal-${r.id}`}>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.isTest && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">TEST</span>}{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.kind === "offer" ? [r.recipientName, r.recipientCompany, r.recipientEmail].filter(Boolean).join(" · ") || "No recipient yet" : r.title || "Template"} · updated {ago(r.updatedAt)}
                  </div>
                </div>
                {r.viewCount > 0 && !r.signedAt && <span className="hidden text-xs text-muted-foreground md:inline" title={r.lastViewedAt ? `Last opened ${format(new Date(r.lastViewedAt), "PPp")}` : undefined}>opened {r.viewCount}×</span>}
                {r.contractTotalCents != null && <span className="hidden text-sm tabular-nums sm:inline">{formatMoney(r.contractTotalCents)}</span>}
                {r.kind === "offer" ? <StatusPill tone={STATUS_TONE[r.status]}>{PROPOSAL_STATUS_LABELS[r.status]}</StatusPill> : <StatusPill tone="neutral" dot={false}>Template</StatusPill>}
              </Link>
            ))}
          </div>
        )}
      </div>
      <NewOfferDialog open={newOffer} onClose={() => setNewOffer(false)} templates={tpl?.rows ?? []} />
      <ImportPdfDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </AppPage>
  );
}

// ---------------------------------------------------------------------------------------------- editor

const dollars = (cents: number) => (cents / 100).toString();
const toCents = (s: string) => { const v = Math.round(parseFloat(s.replace(/[$,\s]/g, "")) * 100); return Number.isFinite(v) && v >= 0 ? v : 0; };

function MoneyInput({ cents, onChange, testId }: { cents: number; onChange: (c: number) => void; testId?: string }) {
  const [txt, setTxt] = useState(dollars(cents));
  useEffect(() => { if (toCents(txt) !== cents) setTxt(dollars(cents)); }, [cents]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input className="pl-6 tabular-nums" inputMode="decimal" value={txt} onChange={(e) => { setTxt(e.target.value); onChange(toCents(e.target.value)); }} data-testid={testId} /></div>
  );
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
}

function OrderButtons({ onUp, onDown, onRemove, label }: { onUp: () => void; onDown: () => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onUp} aria-label={`Move ${label} up`}><ArrowUp className="h-4 w-4" /></Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onDown} aria-label={`Move ${label} down`}><ArrowDown className="h-4 w-4" /></Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={onRemove} aria-label={`Remove ${label}`}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function ItemEditor({ item, onChange, onUp, onDown, onRemove }: { item: ProposalItem; onChange: (i: ProposalItem) => void; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  const set = (p: Partial<ProposalItem>) => onChange({ ...item, ...p });
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3" data-testid={`editor-item-${item.id}`}>
      <div className="flex items-start gap-2">
        <Input className="font-medium" value={item.name} onChange={(e) => set({ name: e.target.value })} placeholder="Service name" aria-label="Service name" />
        <OrderButtons onUp={onUp} onDown={onDown} onRemove={onRemove} label={item.name || "service"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1"><Label className="text-xs">Price</Label><MoneyInput cents={item.priceCents} onChange={(c) => set({ priceCents: c })} /></div>
        <div className="space-y-1"><Label className="text-xs">Billing</Label>
          <Select value={item.billing} onValueChange={(v) => set({ billing: v as ProposalItem["billing"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="one_time">One-time</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
          </Select></div>
        <div className="space-y-1"><Label className="text-xs">Minimum months</Label>
          <Input type="number" min={1} max={60} disabled={item.billing !== "monthly"} value={item.termMonths} onChange={(e) => set({ termMonths: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></div>
        <div className="space-y-1"><Label className="text-xs">Badge</Label><Input value={item.badge} maxLength={40} onChange={(e) => set({ badge: e.target.value })} placeholder="Recommended" /></div>
      </div>
      <Textarea rows={2} value={item.description} onChange={(e) => set({ description: e.target.value })} placeholder="Short description" aria-label="Description" />
      <Textarea rows={3} value={item.bullets.join("\n")} onChange={(e) => set({ bullets: e.target.value.split("\n").slice(0, 40) })} placeholder={"What's included — one per line"} aria-label="What's included" />
      <Textarea rows={2} value={item.info} onChange={(e) => set({ info: e.target.value })} placeholder="The “i” on this option: why it's better than the one before" aria-label="Info" />
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><Switch checked={item.included} onCheckedChange={(v) => set({ included: v })} /> Always included (can't be removed)</label>
        {item.billing === "monthly" && <span className="text-muted-foreground">Term total {formatMoney(item.priceCents * item.termMonths)}</span>}
      </div>
    </div>
  );
}

function GroupEditor({ group, onChange, onUp, onDown, onRemove }: { group: ProposalGroup; onChange: (g: ProposalGroup) => void; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  const set = (p: Partial<ProposalGroup>) => onChange({ ...group, ...p });
  const setItems = (items: ProposalItem[]) => set({ items });
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4" data-testid={`editor-group-${group.id}`}>
      <div className="flex items-start gap-2">
        <Input className="text-base font-semibold" value={group.name} onChange={(e) => set({ name: e.target.value })} placeholder="Package group (e.g. SEO program)" aria-label="Group name" />
        <OrderButtons onUp={onUp} onDown={onDown} onRemove={onRemove} label={group.name || "group"} />
      </div>
      <Textarea rows={2} value={group.description} onChange={(e) => set({ description: e.target.value })} placeholder="What the client is choosing here" aria-label="Group description" />
      <Textarea rows={2} value={group.info} onChange={(e) => set({ info: e.target.value })} placeholder="The “i” beside this heading: how the options compare" aria-label="Group info" />
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <div className="flex items-center gap-2"><span className="text-muted-foreground">Client can choose</span>
          <Select value={group.select} onValueChange={(v) => set({ select: v as ProposalGroup["select"] })}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="one">Only one (tiers)</SelectItem><SelectItem value="many">Any number</SelectItem></SelectContent>
          </Select></div>
        <label className="flex items-center gap-2"><Switch checked={group.required} onCheckedChange={(v) => set({ required: v })} /> Must choose one</label>
      </div>
      <div className="space-y-2">
        {group.items.map((it, i) => (
          <ItemEditor key={it.id} item={it} onChange={(n) => setItems(group.items.map((x, j) => (j === i ? n : x)))}
            onUp={() => setItems(move(group.items, i, -1))} onDown={() => setItems(move(group.items, i, 1))} onRemove={() => setItems(group.items.filter((_, j) => j !== i))} />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setItems([...group.items, { id: rid(), name: "New service", description: "", bullets: [], priceCents: 0, billing: "one_time", termMonths: 1, defaultSelected: false, included: false, badge: "", info: "" }])} data-testid={`button-add-item-${group.id}`}>
        <Plus className="mr-1.5 h-4 w-4" /> Add service
      </Button>
    </div>
  );
}

const SCRIPT_FONT = `"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive`;

function SendDialog({ p, c, who, expires, open, onClose, beforeSend }: {
  p: ProposalDetail; c: ProposalContent; who: { name: string; company: string; email: string }; expires: string;
  open: boolean; onClose: () => void; beforeSend: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(who.email);
  const [cc, setCc] = useState(p.recipientCc.join(", "));
  const [subject, setSubject] = useState(`${c.title || "Your proposal"} — ${c.brand.name}`);
  const [message, setMessage] = useState(c.intro);
  // Send is two steps: the email, then a confirmation of everything that goes out (owner, 2026-10-24).
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  useEffect(() => { if (open) { setTo(who.email); setCc(p.recipientCc.join(", ")); setSubject(`${c.title || "Your proposal"} — ${c.brand.name}`); setMessage(c.intro); setStep("edit"); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ccList = cc.split(/[,;\s]+/).filter(Boolean);
  const send = useMutation({
    mutationFn: async () => { await beforeSend(); return (await apiRequest("POST", `/api/admin/proposals/${p.id}/send`, { to, cc: ccList, subject, message })).json(); },
    onSuccess: () => { toast({ title: "Proposal sent", description: `Emailed to ${to}${ccList.length ? `, cc ${ccList.join(", ")}` : ""}.` }); void invalidate(); onClose(); },
    onError: (e) => toast({ title: "Couldn't send", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const pay = c.payment;
  const options = c.groups.reduce((n, g) => n + g.items.length, 0);
  const longest = Math.max(1, ...c.groups.flatMap((g) => g.items.filter((i) => i.billing === "monthly").map((i) => i.termMonths)));
  const warnings = [
    !who.name.trim() && "No client name — the agreement and email will say “there”.",
    who.email && to.trim().toLowerCase() !== who.email.trim().toLowerCase() && `Sending to ${to}, not the client email on file (${who.email}).`,
    !p.file && "No PDF attached.",
    expires && new Date(`${expires}T23:59:59`).getTime() < Date.now() && "The expiry date has already passed — the client won't be able to sign.",
  ].filter(Boolean) as string[];
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-1.5"><dt className="w-36 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 flex-1 break-words font-medium">{value || <span className="text-muted-foreground">—</span>}</dd></div>
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {step === "edit" ? (<>
          <DialogHeader><DialogTitle>Send for signature</DialogTitle><DialogDescription>Emails a secure link from support@constructhub.us under the {c.brand.name} name. Replies go to {c.brand.contactEmail || "support@constructhub.us"}.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="sd-to">To</Label><Input id="sd-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-send-to" /></div>
            <div className="space-y-1.5"><Label htmlFor="sd-cc">CC (optional)</Label><Input id="sd-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com, …" data-testid="input-send-cc" />
              <p className="text-xs text-muted-foreground">Separate several with commas. They also get the signed agreement and the payment receipt.</p></div>
            <div className="space-y-1.5"><Label htmlFor="sd-sub">Subject</Label><Input id="sd-sub" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="sd-msg">Message</Label><Textarea id="sd-msg" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={() => setStep("confirm")} disabled={!to.trim()} data-testid="button-send-review"><Send className="mr-1.5 h-4 w-4" />Review &amp; send</Button></DialogFooter>
        </>) : (<>
          <DialogHeader><DialogTitle>Confirm before sending</DialogTitle><DialogDescription>Check that everything is right. The client gets the link as soon as you confirm.</DialogDescription></DialogHeader>
          {warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="send-warnings">
              {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
          <dl className="divide-y text-sm" data-testid="send-confirm-summary">
            {row("Client", [who.name, who.company].filter(Boolean).join(", "))}
            {row("To", to)}
            {row("CC", ccList.join(", "))}
            {row("Subject", subject)}
            {row("Proposal", c.title)}
            {row("Options offered", `${options} in ${c.groups.length} group${c.groups.length === 1 ? "" : "s"}`)}
            {row("Payment", `${pay.plan === "choice" ? "Client chooses monthly or pay in full" : pay.plan === "full" ? "Pay in full" : "Monthly"}${pay.fullPayDiscountBps && pay.plan !== "monthly" ? ` · ${formatBps(pay.fullPayDiscountBps)} off for paying in full` : ""}`)}
            {row("Methods", [pay.achEnabled && "Bank transfer (no fee)", pay.cardEnabled && `Card (+${formatBps(pay.cardFeeBps)})`].filter(Boolean).join(" · "))}
            {row("Auto-pay", pay.endAfterMonths ? `Each service for its own term; the longest run ${Math.max(pay.endAfterMonths, longest)} months, then stop` : "Each service for its own term; the longest keep billing every month")}
            {row("Signed for " + c.brand.name, `${c.countersign.name}${c.countersign.title ? `, ${c.countersign.title}` : ""}`)}
            {row("Replies go to", c.brand.contactEmail || "support@constructhub.us")}
            {row("Expires", expires ? format(new Date(`${expires}T12:00:00`), "PPP") : "Never")}
            {row("Attached PDF", p.file?.name ?? "")}
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setStep("edit")} disabled={send.isPending}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending} data-testid="button-send-confirm">{send.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Confirm &amp; send</Button>
          </DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created", document_attached: "PDF attached", document_removed: "PDF removed", sent: "Sent", opened: "Opened by the client", opened_again: "Opened again", test_sent: "Test sent", proof_sent: "Proof sent",
  signed: "Signed", declined: "Declined", checkout_started: "Went to payment", ach_started: "ACH payment started (clearing)", paid: "Paid",
  payment_received: "Payment received", autopay_scheduled: "Auto-pay scheduled", autopay_missing: "Auto-pay not set up", overpaid: "Overpaid",
  payment_failed: "Payment failed", void: "Voided", archived: "Archived", restored: "Restored",
  invoice_sent: "Invoice sent", reminder_sent: "Payment reminder sent (invoice)", invoice_failed: "Invoice not sent", reminders_paused: "Daily invoices paused", reminders_resumed: "Daily invoices resumed",
  plan_set: "Payment plan set", plan_removed: "Payment plan removed",
};

type SavedCard = { id: string; brand: string; last4: string; expMonth: number | null; expYear: number | null; name: string | null };
const dayText = (day: string) => format(new Date(`${day}T12:00:00`), "MMM d, yyyy");
const cents = (typed: string) => Math.round(Number(typed.replace(/[$,\s]/g, "")) * 100);

/**
 * Payments we run for the client (owner, 2026-10-27): from their signed card authorization form, on a payment plan
 * that replaces what was due at signing. A new card is typed into Stripe Checkout here (it never touches our
 * server) and saved; later payments charge the saved card in one click.
 */
function ChargePanel({ p }: { p: ProposalDetail }) {
  const { toast } = useToast();
  const bal = p.balance!;
  const total = p.totals!.contractTotalCents;
  const plan = p.paymentPlan;
  const paidIn = bal.paidCents + bal.pendingCents;
  const cap = plan ? Math.max(0, total - paidIn) : bal.remainingCents;
  const next = plan ? planNextDue(plan, paidIn) : null;
  const suggested = bal.remainingCents > 0 ? bal.remainingCents : next?.cents ?? cap;
  const feeBps = p.content.payment.cardEnabled ? p.content.payment.cardFeeBps : 0; // the server's rule
  const [typed, setTyped] = useState("");
  const amount = typed.trim() ? cents(typed) : suggested;
  const problem = !Number.isFinite(amount) || amount < Math.min(MIN_PAYMENT_CENTS, cap) ? `At least ${formatMoney(Math.min(MIN_PAYMENT_CENTS, cap), { cents: true })}.` : amount > cap ? `At most ${formatMoney(cap, { cents: true })}.` : null;
  const fee = problem ? 0 : cardFeeCents(amount, feeBps);
  const [confirm, setConfirm] = useState<SavedCard | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const cardsUrl = `/api/admin/proposals/${p.id}/cards`;
  const { data: cards = [], isLoading: cardsLoading } = useQuery<SavedCard[]>({ queryKey: [cardsUrl], queryFn: () => getJson(cardsUrl) });

  useEffect(() => { // back from Stripe Checkout
    const q = new URLSearchParams(window.location.search).get("charged");
    if (!q) return;
    toast(q === "1" ? { title: "Card charged", description: "Stripe took the payment and saved the card for the next ones." } : { title: "No charge made", description: "The Stripe page was closed before paying." });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const charge = useMutation({
    mutationFn: async (paymentMethodId?: string) => (await apiRequest("POST", `/api/admin/proposals/${p.id}/charge`, { amountCents: amount, paymentMethodId })).json(),
    onSuccess: (j: { url?: string; result?: string }) => {
      if (j.url) { window.location.href = j.url; return; }
      toast({ title: j.result === "processing" ? "Charge started" : "Card charged", description: `${formatMoney(amount + fee, { cents: true })} incl. the ${formatBps(feeBps)} card fee.` });
      setConfirm(null); setTyped(""); void invalidate();
    },
    onError: (e) => { toast({ title: "The charge didn't go through", description: apiErrorMessage(e), variant: "destructive" }); setConfirm(null); void invalidate(); },
  });

  let covered = 0;
  return (
    <Section title="Charge the client's card" description={plan ? `Payment plan · ${formatMoney(bal.remainingCents, { cents: true })} due now · ${formatMoney(cap, { cents: true })} left on the contract.` : `${formatMoney(bal.remainingCents, { cents: true })} due today. Use this with a signed card authorization from the client.`}>
      <div className="space-y-3 text-sm" data-testid="panel-charge">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium"><CalendarClock className="h-4 w-4" />Payment plan</span>
            <Button size="sm" variant="ghost" onClick={() => setPlanOpen(true)} data-testid="button-edit-plan">{plan ? "Change" : "Set up"}</Button></div>
          {plan ? (
            <ul className="space-y-0.5" data-testid="plan-installments">{plan.installments.map((x, i) => {
              covered += x.cents;
              const done = covered <= bal.paidCents + bal.pendingCents;
              const due = x.dueOn <= isoDay(new Date());
              return <li key={i} className={cn("flex justify-between gap-2", done ? "text-emerald-700" : due ? "font-medium text-amber-700" : "text-muted-foreground")}>
                <span>{i + 1}. {dayText(x.dueOn)}{done ? " · paid" : due ? " · due" : ""}</span><span className="tabular-nums">{formatMoney(x.cents, { cents: true })}</span></li>;
            })}</ul>
          ) : <p className="text-xs text-muted-foreground">None — the client owes what was due at signing. A plan splits the contract total into dated payments (no auto-pay; you charge each one).</p>}
        </div>
        {cap > 0 && (<div className="space-y-2 border-t pt-3">
          <Label htmlFor="charge-amount">Amount to charge (before the {formatBps(feeBps)} card fee)</Label>
          <Input id="charge-amount" inputMode="decimal" placeholder={(suggested / 100).toFixed(2)} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="input-charge-amount" />
          {problem ? <p className="text-xs text-red-600">{problem}</p> : <p className="text-xs text-muted-foreground">Card is charged {formatMoney(amount + fee, { cents: true })} ({formatMoney(amount, { cents: true })} + {formatMoney(fee, { cents: true })} fee).{next && bal.remainingCents <= 0 ? ` Next payment on the plan: ${dayText(next.dueOn)}.` : ""}</p>}
          <div className="space-y-1.5">
            {cardsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : cards.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                <span className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" />{c.brand.toUpperCase()} ••{c.last4}{c.expMonth ? ` · ${String(c.expMonth).padStart(2, "0")}/${String(c.expYear ?? "").slice(-2)}` : ""}</span>
                <Button size="sm" onClick={() => setConfirm(c)} disabled={!!problem || charge.isPending} data-testid="button-charge-saved">Charge</Button>
              </div>
            ))}
            <Button size="sm" variant={cards.length ? "outline" : "default"} onClick={() => charge.mutate(undefined)} disabled={!!problem || charge.isPending} data-testid="button-charge-new">
              {charge.isPending && !confirm ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}Charge a new card</Button>
            <p className="text-xs text-muted-foreground">Opens Stripe's secure card page: type the card and billing address from the client's authorization form. The card is saved for the next payments. If the bank asks for a code, it goes to the cardholder.</p>
          </div>
        </div>)}
      </div>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && !charge.isPending && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Charge {formatMoney(amount + fee, { cents: true })}?</DialogTitle>
            <DialogDescription>{confirm?.brand.toUpperCase()} ••{confirm?.last4} is charged now: {formatMoney(amount, { cents: true })} + {formatMoney(fee, { cents: true })} card fee. {p.recipientEmail ? `${p.recipientEmail} gets a receipt.` : ""}</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={charge.isPending}>Cancel</Button>
            <Button onClick={() => confirm && charge.mutate(confirm.id)} disabled={charge.isPending} data-testid="button-charge-confirm">{charge.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}Charge now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {planOpen && <PlanDialog p={p} onClose={() => setPlanOpen(false)} />}
    </Section>
  );
}

/** Equal payments of the contract total: how many, how many up front, then one a month from the first date. */
function PlanDialog({ p, onClose }: { p: ProposalDetail; onClose: () => void }) {
  const { toast } = useToast();
  const total = p.totals!.contractTotalCents;
  const [count, setCount] = useState(String(p.paymentPlan?.installments.length ?? 6));
  const [upFront, setUpFront] = useState("2");
  const [start, setStart] = useState(isoDay(new Date()));
  const n = Math.trunc(Number(count)), u = Math.trunc(Number(upFront));
  const bad = !(n >= 1 && n <= 60) ? "1 to 60 payments." : !(u >= 1 && u <= n) ? "Up front: at least 1, at most every payment." : !/^\d{4}-\d{2}-\d{2}$/.test(start) ? "Pick the first date." : null;
  const list = bad ? [] : evenPlan(total, n, u, start);
  const save = useMutation({
    mutationFn: async (installments: typeof list | null) => (await apiRequest("PUT", `/api/admin/proposals/${p.id}/plan`, { installments })).json(),
    onSuccess: (_d, v) => { toast({ title: v ? "Payment plan saved" : "Payment plan removed" }); void invalidate(); onClose(); },
    onError: (e) => toast({ title: "Couldn't save the plan", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Payment plan</DialogTitle>
          <DialogDescription>Splits the contract total of {formatMoney(total, { cents: true })} into equal payments. It replaces the {formatMoney(p.totals!.dueTodayCents, { cents: true })} due at signing; there's no auto-pay — you charge each payment here.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1"><Label htmlFor="pl-n">Payments</Label><Input id="pl-n" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} data-testid="input-plan-count" /></div>
          <div className="space-y-1"><Label htmlFor="pl-u">Up front</Label><Input id="pl-u" inputMode="numeric" value={upFront} onChange={(e) => setUpFront(e.target.value)} data-testid="input-plan-upfront" /></div>
          <div className="space-y-1"><Label htmlFor="pl-s">First date</Label><Input id="pl-s" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        </div>
        {bad ? <p className="text-xs text-red-600">{bad}</p> : (
          <ul className="space-y-0.5 text-sm" data-testid="plan-preview">{list.map((x, i) => <li key={i} className="flex justify-between"><span>{i + 1}. {dayText(x.dueOn)}{i < u ? " · up front" : ""}</span><span className="tabular-nums">{formatMoney(x.cents, { cents: true })}</span></li>)}</ul>
        )}
        <DialogFooter className="gap-2">
          {p.paymentPlan && <Button variant="outline" onClick={() => save.mutate(null)} disabled={save.isPending}>Remove plan</Button>}
          <Button onClick={() => save.mutate(list)} disabled={!!bad || save.isPending} data-testid="button-plan-save">{save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Save plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What's still due today, invoiced (owner, 2026-10-25): send an invoice for all of it or part of it, see what went
 * out, and pause the daily one that starts a day after the client's first payment.
 */
function InvoicePanel({ p }: { p: ProposalDetail }) {
  const { toast } = useToast();
  const bal = p.balance!;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState("");
  const amount = typed.trim() ? Math.round(Number(typed.replace(/[$,\s]/g, "")) * 100) : bal.remainingCents;
  const floor = Math.min(MIN_PAYMENT_CENTS, bal.remainingCents);
  const problem = !Number.isFinite(amount) || amount < floor ? `At least ${formatMoney(floor, { cents: true })}.` : amount > bal.remainingCents ? `At most ${formatMoney(bal.remainingCents, { cents: true })} (what's left).` : null;
  const partPaid = bal.paidCents + bal.pendingCents > 0;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/proposals/${p.id}/invoice`, { amountCents: amount, message: message.trim() || undefined })).json(),
    onSuccess: () => { toast({ title: "Invoice sent", description: `${formatMoney(amount, { cents: true })} to ${p.recipientEmail}${p.recipientCc.length ? ` (cc ${p.recipientCc.join(", ")})` : ""}.` }); setOpen(false); setTyped(""); setMessage(""); void invalidate(); },
    onError: (e) => toast({ title: "Couldn't send the invoice", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const pause = useMutation({
    mutationFn: async (paused: boolean) => (await apiRequest("POST", `/api/admin/proposals/${p.id}/reminders`, { paused })).json(),
    onSuccess: () => void invalidate(),
    onError: (e) => toast({ title: "Couldn't change the daily invoice", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const auto = p.isTest ? "Off on test copies."
    : p.invoices.paused ? "Paused — no automatic invoices."
    : partPaid ? `On — an invoice for what's left every ${REMINDER_EVERY_HOURS} hours (9am–6pm Pacific) until it's paid.`
    : "Starts a day after the client's first payment, then daily until it's paid.";
  return (
    <Section title="Invoices" description={`${formatMoney(bal.remainingCents, { cents: true })} still due today.`}>
      <div className="space-y-2 text-sm" data-testid="panel-invoices">
        <div className="flex gap-2">{p.invoices.paused ? <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}<span>Daily invoice: {auto}</span></div>
        <div className="text-xs text-muted-foreground">{p.invoices.count ? `${p.invoices.count} sent · last ${format(new Date(p.invoices.lastAt!), "PPp")}` : "None sent yet."}</div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => setOpen(true)} disabled={!p.recipientEmail} data-testid="button-send-invoice"><Receipt className="mr-1.5 h-4 w-4" />Send invoice</Button>
          {!p.isTest && <Button size="sm" variant="outline" onClick={() => pause.mutate(!p.invoices.paused)} disabled={pause.isPending} data-testid="button-pause-invoices">
            {p.invoices.paused ? <><BellRing className="mr-1.5 h-4 w-4" />Resume daily</> : <><BellOff className="mr-1.5 h-4 w-4" />Pause daily</>}</Button>}
        </div>
      </div>
      <Dialog open={open} onOpenChange={(v) => !send.isPending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send an invoice</DialogTitle>
            <DialogDescription>Emails {p.recipientEmail}{p.recipientCc.length ? ` (cc ${p.recipientCc.join(", ")})` : ""} an invoice PDF and a link to pay — any amount, on any card or bank account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-amount">Amount due now</Label>
              <Input id="inv-amount" inputMode="decimal" placeholder={`${(bal.remainingCents / 100).toFixed(2)} — everything left`} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="input-invoice-amount" />
              {problem ? <p className="text-xs text-red-600">{problem}</p> : <p className="text-xs text-muted-foreground">Leave blank for all {formatMoney(bal.remainingCents, { cents: true })}. A smaller amount fills in the pay page; the client can still pay more.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-message">Note (optional)</Label>
              <Textarea id="inv-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown above the invoice in the email." />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" asChild disabled={!!problem}><a href={`/api/admin/proposals/${p.id}/invoice.pdf?amountCents=${problem ? "" : amount}`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" />Preview PDF</a></Button>
            <Button onClick={() => send.mutate()} disabled={!!problem || send.isPending} data-testid="button-invoice-confirm">{send.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Send {problem ? "" : formatMoney(amount, { cents: true })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ProposalEditor({ id }: { id: number }) {
  const { toast } = useToast();
  const [, go] = useLocation();
  const url = `/api/admin/proposals/${id}`;
  const { data: p, error, isLoading, refetch } = useQuery<ProposalDetail>({ queryKey: [url], queryFn: () => getJson(url) });
  useDocumentTitle(p ? `${p.name} · Proposals` : appPageTitle("/admin/proposals")!);
  const [name, setName] = useState(""); const [rname, setRname] = useState(""); const [remail, setRemail] = useState(""); const [rco, setRco] = useState("");
  const [expires, setExpires] = useState("");
  const [c, setC] = useState<ProposalContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!p) return;
    setName(p.name); setRname(p.recipientName ?? ""); setRemail(p.recipientEmail ?? ""); setRco(p.recipientCompany ?? "");
    setExpires(p.expiresAt ? p.expiresAt.slice(0, 10) : ""); setC(p.content); setDirty(false);
  }, [p?.id, p?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = !!p && ["signed", "partial", "processing", "paid"].includes(p.status);
  const edit = (patch: Partial<ProposalContent>) => { setC((cur) => (cur ? { ...cur, ...patch } : cur)); setDirty(true); };
  const editNested = <K extends "brand" | "payment" | "countersign">(k: K, patch: Partial<ProposalContent[K]>) => { setC((cur) => (cur ? { ...cur, [k]: { ...cur[k], ...patch } } : cur)); setDirty(true); };

  const saveNow = async () => {
    if (!p || !c || locked) return;
    await apiRequest("PUT", url, {
      name, content: c, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : "",
      ...(p.kind === "offer" ? { recipientName: rname, recipientEmail: remail, recipientCompany: rco } : {}),
    });
    setDirty(false);
    await invalidate();
  };
  const save = useMutation({ mutationFn: saveNow, onSuccess: () => toast({ title: "Saved" }), onError: (e) => toast({ title: "Couldn't save", description: apiErrorMessage(e), variant: "destructive" }) });
  const action = useMutation({
    mutationFn: async (a: { kind: "offer" | "duplicate" | "status"; status?: string }) => {
      if (dirty) await saveNow();
      if (a.kind === "status") return (await apiRequest("POST", `${url}/status`, { status: a.status })).json();
      return (await apiRequest("POST", "/api/admin/proposals", { kind: a.kind === "offer" ? "offer" : p!.kind, fromId: id })).json();
    },
    onSuccess: (r: ProposalDetail, a) => { void invalidate(); if (a.kind !== "status") go(`/admin/proposals/${r.id}`); },
    onError: (e) => toast({ title: "That didn't work", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      if (f.size > MAX_PDF_BYTES) throw new Error(`The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
      const dataBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Couldn't read the file")); r.readAsDataURL(f); });
      return (await apiRequest("POST", `${url}/file`, { name: f.name, dataBase64 })).json();
    },
    onSuccess: () => { toast({ title: "PDF attached" }); void invalidate(); },
    onError: (e) => toast({ title: "Couldn't attach the PDF", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const removeFile = useMutation({ mutationFn: async () => (await apiRequest("DELETE", `${url}/file`)).json(), onSuccess: () => void invalidate() });

  // Every hook sits above the early returns below (React needs the same hooks on every render).
  const proof = useMutation({
    mutationFn: async () => { if (dirty) await saveNow(); return (await apiRequest("POST", `/api/admin/proposals/${p!.id}/proof`, {})).json() as Promise<{ to: string }>; },
    onSuccess: (r) => toast({ title: "Proof sent", description: `The exact email your client gets went to ${r.to}. Its link is a preview: opening it isn't a client view, and it can't be signed or paid.` }),
    onError: (e) => toast({ title: "Couldn't send the proof", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: async () => { if (dirty) await saveNow(); return (await apiRequest("POST", `/api/admin/proposals/${p!.id}/test`, {})).json() as Promise<{ to: string; link: string; id: number }>; },
    onSuccess: (r) => { toast({ title: "Test sent", description: `Check ${r.to}: open it and sign like the client would. You'll get the client's signed copy and the owner's copy. Payment is off on test copies.` }); void invalidate(); },
    onError: (e) => toast({ title: "Couldn't send the test", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const preview = useMemo(() => (c ? priceSelection(c, defaultSelection(c)) : null), [c]);
  const longestTerm = c ? Math.max(1, ...c.groups.flatMap((g) => g.items.filter((i) => i.billing === "monthly").map((i) => i.termMonths))) : 1;

  if (isLoading && !p) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!p || !c) return <Gate error={error} retry={() => void refetch()} what="this proposal" />;
  const link = `${window.location.origin}/proposal/${p.publicToken}`;
  const needsCountersign = p.kind === "offer" && c.countersign.name.trim().length < 2;
  // The Branding contact can be the signer: ticking "Signer" puts their name on the company signature.
  const contactSigns = !!c.brand.contactName.trim() && c.countersign.name.trim() === c.brand.contactName.trim();
  const askCountersign = () => {
    toast({ title: "Add your name first", description: `Fill in “Signed for ${c.brand.name}” at the bottom — it becomes the company signature.`, variant: "destructive" });
    document.getElementById("countersign")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const openPreview = async () => { if (dirty) await saveNow(); window.open(`/proposal/${p.publicToken}?preview=1`, "_blank", "noopener"); };

  return (
    <AppPage testId="page-admin-proposal-editor" width="wide">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link href="/admin/proposals"><ArrowLeft className="mr-1.5 h-4 w-4" />Proposals</Link></Button>
        {p.kind === "offer" ? <StatusPill tone={STATUS_TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</StatusPill> : <StatusPill tone="neutral" dot={false}>Template</StatusPill>}
        {p.viewCount > 0 && <span className="text-xs text-muted-foreground" data-testid="text-open-count">Opened {p.viewCount} time{p.viewCount === 1 ? "" : "s"}{p.lastViewedAt ? ` · last ${ago(p.lastViewedAt)}` : ""}</span>}
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
      <GoogleSectionHeader as="h1" helpKey="admin-proposals" title={p.name}
        description={p.kind === "template" ? "A reusable proposal. Create an offer from it for each client." : `Offer for ${[p.recipientName, p.recipientCompany].filter(Boolean).join(", ") || "—"}.`}
        actions={<div className="flex flex-wrap gap-2">
          {!locked && <Button size="sm" variant={dirty ? "default" : "outline"} onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-proposal">{save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Save</Button>}
          {p.kind === "offer" && <Button size="sm" variant="outline" onClick={() => void openPreview()} data-testid="button-preview-proposal"><Eye className="mr-1.5 h-4 w-4" />Preview</Button>}
          {p.kind === "offer" && <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast({ title: "Link copied", description: link }); }}><Copy className="mr-1.5 h-4 w-4" />Copy link</Button>}
          {p.kind === "offer" && <Button size="sm" variant="outline" onClick={() => proof.mutate()} disabled={proof.isPending} data-testid="button-proof-proposal">{proof.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Send me a proof</Button>}
          {p.kind === "offer" && !p.isTest && <Button size="sm" variant="outline" onClick={() => (needsCountersign ? askCountersign() : test.mutate())} disabled={test.isPending} data-testid="button-test-proposal">{test.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSignature className="mr-1.5 h-4 w-4" />}Send me a test to sign</Button>}
          {p.kind === "offer" && !p.isTest && !locked && !["void", "declined", "archived"].includes(p.status) && <Button size="sm" onClick={() => (needsCountersign ? askCountersign() : setSendOpen(true))} data-testid="button-send-proposal"><Mail className="mr-1.5 h-4 w-4" />{p.sentAt ? "Send again" : "Send"}</Button>}
          {p.kind === "template" && <Button size="sm" onClick={() => action.mutate({ kind: "offer" })} disabled={action.isPending} data-testid="button-offer-from-template"><FileSignature className="mr-1.5 h-4 w-4" />Create offer</Button>}
          {p.signature && <Button asChild size="sm" variant="outline"><a href={`${url}/signed.pdf`} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-4 w-4" />Signed PDF</a></Button>}
          <Button size="sm" variant="outline" onClick={() => action.mutate({ kind: "duplicate" })} disabled={action.isPending}><Copy className="mr-1.5 h-4 w-4" />Duplicate</Button>
          {p.kind === "offer" && !["void", "paid", "partial", "processing", "archived"].includes(p.status) && <Button size="sm" variant="outline" onClick={() => action.mutate({ kind: "status", status: "void" })}><XCircle className="mr-1.5 h-4 w-4" />Void</Button>}
          {p.status !== "archived" ? <Button size="sm" variant="ghost" onClick={() => action.mutate({ kind: "status", status: "archived" })}><Archive className="mr-1.5 h-4 w-4" />Archive</Button>
            : <Button size="sm" variant="ghost" onClick={() => action.mutate({ kind: "status", status: "draft" })}><RotateCcw className="mr-1.5 h-4 w-4" />Restore</Button>}
        </div>} flush />

      {locked && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">Signed proposals are locked. Duplicate this one to make a new version.</div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <fieldset disabled={locked} className="min-w-0 space-y-5">
          <Section title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pe-name">Internal name</Label><Input id="pe-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} data-testid="input-proposal-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="pe-exp">Expires (optional)</Label><Input id="pe-exp" type="date" value={expires} onChange={(e) => { setExpires(e.target.value); setDirty(true); }} /></div>
            </div>
            {p.kind === "offer" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5"><Label htmlFor="pe-rn">Client name</Label><Input id="pe-rn" value={rname} onChange={(e) => { setRname(e.target.value); setDirty(true); }} data-testid="input-recipient-name" /></div>
                <div className="space-y-1.5"><Label htmlFor="pe-rc">Company</Label><Input id="pe-rc" value={rco} onChange={(e) => { setRco(e.target.value); setDirty(true); }} /></div>
                <div className="space-y-1.5"><Label htmlFor="pe-re">Client email</Label><Input id="pe-re" type="email" value={remail} onChange={(e) => { setRemail(e.target.value); setDirty(true); }} data-testid="input-recipient-email" /></div>
              </div>
            )}
          </Section>

          <Section title="Branding" description="Whose proposal this is. The email goes out from support@constructhub.us under this name; replies go to the contact email.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Business name</Label><Input value={c.brand.name} onChange={(e) => editNested("brand", { name: e.target.value })} data-testid="input-brand-name" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Logo URL (https)</Label><Input value={c.brand.logoUrl} onChange={(e) => editNested("brand", { logoUrl: e.target.value })} placeholder="https://…/logo.png" /></div>
              <div className="space-y-1.5"><Label>Accent color</Label>
                <div className="flex gap-2"><input type="color" value={c.brand.accent} onChange={(e) => editNested("brand", { accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded border" aria-label="Accent color" />
                  <Input value={c.brand.accent} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && editNested("brand", { accent: e.target.value })} /></div></div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2"><Label>Contact name</Label>
                  {p.kind === "offer" && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={contactSigns} onCheckedChange={(v) => editNested("countersign", { name: v === true ? c.brand.contactName.trim() : "" })} disabled={!c.brand.contactName.trim()} data-testid="checkbox-contact-signs" />Signer</label>}</div>
                <Input value={c.brand.contactName} onChange={(e) => { const v = e.target.value; setC((cur) => (cur ? { ...cur, brand: { ...cur.brand, contactName: v }, ...(contactSigns ? { countersign: { ...cur.countersign, name: v.trim() } } : {}) } : cur)); setDirty(true); }} /></div>
              <div className="space-y-1.5"><Label>Contact email</Label><Input value={c.brand.contactEmail} onChange={(e) => editNested("brand", { contactEmail: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={c.brand.phone} onChange={(e) => editNested("brand", { phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Website</Label><Input value={c.brand.website} onChange={(e) => editNested("brand", { website: e.target.value })} /></div>
            </div>
          </Section>

          <Section title="Cover" description="The top of the client's page and the default email message.">
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={c.title} onChange={(e) => edit({ title: e.target.value })} placeholder="Reputation Restoration & Digital Authority" data-testid="input-proposal-title" /></div>
              <div className="space-y-1.5"><Label>Subtitle</Label><Input value={c.subtitle} onChange={(e) => edit({ subtitle: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Intro</Label><Textarea rows={4} value={c.intro} onChange={(e) => edit({ intro: e.target.value })} /></div>
            </div>
          </Section>

          <Section title="Attached PDF" description={`The full proposal document, shown on the client's page with open and download buttons (up to ${MAX_PDF_BYTES / 1024 / 1024} MB).`}>
            {p.file ? (
              <div className="flex flex-wrap items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" /><span className="font-medium">{p.file.name}</span><span className="text-xs text-muted-foreground">{(p.file.bytes / 1024 / 1024).toFixed(1)} MB</span>
                <Button asChild size="sm" variant="outline"><a href={`${url}/file`} target="_blank" rel="noreferrer">View</a></Button>
                {!locked && <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Replace</Button>}
                {!locked && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => removeFile.mutate()}>Remove</Button>}
              </div>
            ) : (
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending || locked} data-testid="button-attach-pdf">
                {upload.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Attach a PDF
              </Button>
            )}
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} data-testid="input-proposal-file" />
          </Section>

          <Section title="Written sections" description="Shown on the page above the packages. Blank line = new paragraph; start a line with “- ” for a bullet.">
            <div className="space-y-3">
              {c.sections.map((s, i) => (
                <div key={s.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex gap-2">
                    <Input className="w-48" value={s.eyebrow} onChange={(e) => edit({ sections: c.sections.map((x, j) => (j === i ? { ...x, eyebrow: e.target.value } : x)) })} placeholder="01 / Overview" aria-label="Label" />
                    <Input className="font-semibold" value={s.heading} onChange={(e) => edit({ sections: c.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} placeholder="Heading" aria-label="Heading" />
                    <OrderButtons label={s.heading || "section"} onUp={() => edit({ sections: move(c.sections, i, -1) })} onDown={() => edit({ sections: move(c.sections, i, 1) })} onRemove={() => edit({ sections: c.sections.filter((_, j) => j !== i) })} />
                  </div>
                  <Textarea rows={5} value={s.body} onChange={(e) => edit({ sections: c.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} aria-label="Body" />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => edit({ sections: [...c.sections, { id: rid(), eyebrow: "", heading: "", body: "" }] })} data-testid="button-add-section"><Plus className="mr-1.5 h-4 w-4" />Add section</Button>
            </div>
          </Section>

          <Section title="Packages & prices" description="Groups of services the client chooses from. “Only one” makes tiers (Starter / Pro / Premium); “Any number” makes add-ons.">
            <div className="space-y-4">
              {c.groups.map((g, i) => (
                <GroupEditor key={g.id} group={g} onChange={(n) => edit({ groups: c.groups.map((x, j) => (j === i ? n : x)) })}
                  onUp={() => edit({ groups: move(c.groups, i, -1) })} onDown={() => edit({ groups: move(c.groups, i, 1) })} onRemove={() => edit({ groups: c.groups.filter((_, j) => j !== i) })} />
              ))}
              <Button type="button" variant="outline" onClick={() => edit({ groups: [...c.groups, { id: rid(), name: "New package group", description: "", select: "one", required: false, info: "", items: [] }] })} data-testid="button-add-group"><Plus className="mr-1.5 h-4 w-4" />Add package group</Button>
            </div>
          </Section>

          <Section title="Payment" description="ACH never pays a fee. Card payments add the card fee as its own line.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Payment plan</Label>
                <Select value={c.payment.plan} onValueChange={(v) => editNested("payment", { plan: v as ProposalContent["payment"]["plan"] })}>
                  <SelectTrigger data-testid="select-payment-plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly — one-time items + first month today, then monthly</SelectItem>
                    <SelectItem value="full">Pay in full — the whole term today</SelectItem>
                    <SelectItem value="choice">Let the client choose</SelectItem>
                  </SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Card fee (%)</Label>
                <Input type="number" step="0.1" min={0} max={4} value={c.payment.cardFeeBps / 100} onChange={(e) => editNested("payment", { cardFeeBps: Math.max(0, Math.min(400, Math.round((Number(e.target.value) || 0) * 100))) })} data-testid="input-card-fee" />
                <p className="text-xs text-muted-foreground">Default {formatBps(DEFAULT_CARD_FEE_BPS)}.</p></div>
              <div className="space-y-1.5"><Label>Stop auto-pay after (months)</Label>
                <Input type="number" min={1} max={60} value={c.payment.endAfterMonths ?? ""} placeholder="Never — bills every month" onChange={(e) => editNested("payment", { endAfterMonths: e.target.value ? Math.max(1, Math.min(60, Number(e.target.value))) : null })} data-testid="input-end-after" />
                <p className="text-xs text-muted-foreground">Monthly services are charged automatically each month to the client's bank (ACH) or card, whichever they pay with. Leave blank to keep billing every month; a number stops it after that many months. It never stops before a package's minimum term{longestTerm > 1 ? ` (${longestTerm} months here)` : ""}.</p></div>
              <div className="space-y-1.5"><Label>Pay-in-full discount (%)</Label>
                <Input type="number" step="0.5" min={0} max={50} value={c.payment.fullPayDiscountBps / 100} onChange={(e) => editNested("payment", { fullPayDiscountBps: Math.max(0, Math.min(5000, Math.round((Number(e.target.value) || 0) * 100))) })} data-testid="input-full-pay-discount" />
                <p className="text-xs text-muted-foreground">Off the whole contract when the client pays the full term today. Default {formatBps(DEFAULT_FULL_PAY_DISCOUNT_BPS)}; 0 turns it off.</p></div>
              <div className="flex flex-col gap-3 pt-6 text-sm">
                <label className="flex items-center gap-2"><Switch checked={c.payment.achEnabled} onCheckedChange={(v) => editNested("payment", { achEnabled: v })} /> Offer bank transfer (ACH)</label>
                <label className="flex items-center gap-2"><Switch checked={c.payment.cardEnabled} onCheckedChange={(v) => editNested("payment", { cardEnabled: v })} /> Offer card</label>
              </div>
            </div>
          </Section>

          <Section title="Terms the client initials" description="The client initials before signing, like DocuSign, and can't sign until it's done. The initials and times print on the signed agreement with every term in full.">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><Switch checked={c.clauseInitials !== "each"} onCheckedChange={(v) => edit({ clauseInitials: v ? "once" : "each" })} data-testid="switch-initial-once" />
                One initial for all terms (the terms stay folded under “View the terms”)</label>
              {c.clauses.map((cl, i) => (
                <div key={cl.id} className="space-y-2 rounded-lg border p-3" data-testid={`editor-clause-${i}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="min-w-0 flex-1 font-semibold" value={cl.heading} onChange={(e) => edit({ clauses: c.clauses.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} placeholder="1. Initial commitment" aria-label="Clause heading" />
                    <label className="flex items-center gap-2 text-sm"><Switch checked={cl.initials} onCheckedChange={(v) => edit({ clauses: c.clauses.map((x, j) => (j === i ? { ...x, initials: v } : x)) })} /> Initials</label>
                    <OrderButtons label={cl.heading || "clause"} onUp={() => edit({ clauses: move(c.clauses, i, -1) })} onDown={() => edit({ clauses: move(c.clauses, i, 1) })} onRemove={() => edit({ clauses: c.clauses.filter((_, j) => j !== i) })} />
                  </div>
                  <Textarea rows={3} value={cl.body} onChange={(e) => edit({ clauses: c.clauses.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} aria-label="Clause text" />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => edit({ clauses: [...c.clauses, { id: rid(), heading: "", body: "", initials: true }] })} data-testid="button-add-clause"><Plus className="mr-1.5 h-4 w-4" />Add clause</Button>
            </div>
          </Section>

          <Section title="Terms & conditions" description="The contract: shown before signing and printed on the signed copy."
            actions={<Button variant="outline" size="sm" onClick={() => { if (!c.terms.trim() || window.confirm("Replace these terms with the standard service agreement?")) edit({ terms: standardTerms(c.brand.name) }); }} data-testid="button-standard-terms">Use the standard terms</Button>}>
            <Textarea rows={8} value={c.terms} onChange={(e) => edit({ terms: e.target.value })} data-testid="input-proposal-terms" />
          </Section>

          {p.kind === "offer" && (
            <div id="countersign">
              <Section title={`Signed for ${c.brand.name}`} description="Your signature on the agreement. Your name is filled in; the system draws the signature and dates it when you send. Required before sending.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="cs-name">Authorized representative</Label>
                    <Input id="cs-name" value={c.countersign.name} onChange={(e) => editNested("countersign", { name: e.target.value })} className={needsCountersign ? "border-red-400" : ""} data-testid="input-countersign-name" /></div>
                  <div className="space-y-1.5"><Label htmlFor="cs-title">Title</Label>
                    <Input id="cs-title" value={c.countersign.title} onChange={(e) => editNested("countersign", { title: e.target.value })} data-testid="input-countersign-title" /></div>
                </div>
                <div className="mt-4 grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                  <div><div className="text-xs text-muted-foreground">Representative signature</div>
                    <div className="mt-1 min-h-[44px] border-b border-foreground/40 pb-1 text-3xl" style={{ fontFamily: SCRIPT_FONT }} data-testid="countersign-signature">{c.countersign.name.trim() || " "}</div></div>
                  <div><div className="text-xs text-muted-foreground">Date</div>
                    <div className="mt-1 min-h-[44px] border-b border-foreground/40 pb-1 pt-3 text-sm">{format(p.countersignedAt ? new Date(p.countersignedAt) : new Date(), "PPP")}{!p.countersignedAt && <span className="text-muted-foreground"> (set when you send)</span>}</div></div>
                </div>
              </Section>
            </div>
          )}
        </fieldset>

        {/* Pinned while the editor scrolls, but never taller than the window: it scrolls on its own (the charge panel sits at the bottom). */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-2 lg:pr-1">
          {p.kind === "offer" && p.totals && (
            <Section title="What they chose">
              <ul className="space-y-1 text-sm">{p.totals.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-2"><span>{l.name}</span><span className="tabular-nums">{formatMoney(l.priceCents)}{l.billing === "monthly" ? "/mo" : ""}</span></li>)}</ul>
              <div className="mt-2 border-t pt-2 text-sm">
                {(p.totals.discountCents ?? 0) > 0 && <div className="flex justify-between text-emerald-700"><span>Paid in full ({formatBps(p.totals.discountBps ?? 0)} off)</span><span>−{formatMoney(p.totals.discountCents ?? 0)}</span></div>}
                <div className="flex justify-between font-semibold"><span>Contract total</span><span>{formatMoney(p.totals.contractTotalCents)}</span></div>
                <div className={cn("flex justify-between", p.paymentPlan && "text-muted-foreground line-through")}><span>Due at signing</span><span>{formatMoney(p.totals.dueTodayCents)}</span></div>
                {p.paymentPlan && <div className="flex justify-between"><span>Payment plan</span><span>{p.paymentPlan.installments.length} payments</span></div>}
                {p.payments.length > 0 ? (<>
                  {p.payments.map((x, i) => (
                    <div key={x.id} className={cn("flex justify-between gap-2", x.status === "failed" && "text-red-600 line-through")}>
                      <span>Payment {i + 1} · {x.method === "ach" ? "ACH" : "Card"}{x.cardLast4 ? ` ••${x.cardLast4}` : ""}{x.source === "admin" ? " · by us" : ""}{x.status === "processing" ? " (clearing)" : x.status === "failed" ? " (failed)" : ""}</span>
                      <span className="tabular-nums">{formatMoney(x.amountCents, { cents: true })}{x.feeCents ? ` +${formatMoney(x.feeCents, { cents: true })} fee` : ""}</span>
                    </div>
                  ))}
                  {p.balance && <div className="flex justify-between font-semibold"><span>{p.paymentPlan ? "Due now" : "Left to pay today"}</span><span className="tabular-nums">{formatMoney(p.balance.remainingCents, { cents: true })}</span></div>}
                </>) : p.payment.method && <div className="flex justify-between"><span>Paid by</span><span>{p.payment.method === "ach" ? "ACH" : `Card (+${formatMoney(p.payment.cardFeeCents)})`}</span></div>}
                {p.totals && !p.paymentPlan && autoPayLines(autoPaySchedule(p.content, p.totals)).map((l) => { const [when, v] = l.split(": "); return <div key={when} className="flex justify-between text-muted-foreground"><span>Auto-pay · {when}</span><span>{v}</span></div>; })}
                {p.autoPayStartsAt && <div className="text-xs text-muted-foreground">Auto-pay starts {format(new Date(p.autoPayStartsAt), "PPP")}</div>}
                {p.signature && <div className="mt-1 text-xs text-muted-foreground">Signed by {p.signature.name} · {format(new Date(p.signature.signedAt), "PPp")}{p.signature.ip ? ` · ${p.signature.ip}` : ""}</div>}
              </div>
            </Section>
          )}
          {p.kind === "offer" && p.signature && p.balance && p.balance.remainingCents > 0 && !["void", "archived", "declined"].includes(p.status) && <InvoicePanel p={p} />}
          {p.kind === "offer" && p.signature && p.balance && !p.isTest && !["void", "archived", "declined"].includes(p.status) && <ChargePanel p={p} />}
          {preview && (
            <Section title="Opening totals" description="Nothing is pre-selected: the client starts with only the included services and picks the rest.">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>One-time</span><span className="tabular-nums">{formatMoney(preview.oneTimeCents)}</span></div>
                <div className="flex justify-between"><span>Monthly</span><span className="tabular-nums">{formatMoney(preview.monthlyCents)}/mo</span></div>
                <div className="flex justify-between font-semibold"><span>Contract total</span><span className="tabular-nums">{formatMoney(preview.contractTotalCents)}</span></div>
              </div>
            </Section>
          )}
          <Section title="Activity">
            <ol className="space-y-2 text-sm">
              {[...p.events].reverse().slice(0, 40).map((e, i) => (
                <li key={i}><div className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</div><div className="text-xs text-muted-foreground">{format(new Date(e.at), "PPp")}{e.detail ? ` · ${e.detail}` : ""}</div></li>
              ))}
            </ol>
          </Section>
        </aside>
      </div>
      {p.kind === "offer" && <SendDialog p={p} c={c} who={{ name: rname, company: rco, email: remail }} expires={expires} open={sendOpen} onClose={() => setSendOpen(false)} beforeSend={async () => { if (dirty) await saveNow(); }} />}
    </AppPage>
  );
}

export default function AdminProposalsPage() {
  const [match, params] = useRoute("/admin/proposals/:id");
  const id = match ? Number(params?.id) : NaN;
  return Number.isInteger(id) && id > 0 ? <ProposalEditor id={id} /> : <ProposalList />;
}
