/** Press Wire: editorial product surface; account and writer flows remain API-backed. */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, AlertTriangle, Check, CheckCircle2, Clock, FileText, Globe2, Image as ImageIcon, Info, Lightbulb, Loader2, Newspaper, Package, Send, XCircle } from "lucide-react";
import {
  PRESS_CREDIT_MONTHS, PRESS_AUTOPILOT_MAX_DAY, PRESS_HEADLINE_OUTLETS, PRESS_NEWS_TYPES, PRESS_PACKAGES, PRESS_TIERS, PRESS_TIER_INFO, PRESS_TIER_LABEL, pressPackage, PRESS_PROGRAM_CREDITS, PRESS_PROGRAM_FREE, PRESS_PROGRAM_PAID, PRESS_STATUS_HELP, PRESS_STATUS_LABELS,
  pressPackagePrice, type PressAutopilotView, type PressGuidelineIssue, type PressIdea, type PressPackageKey, type PressOrderView, type PressPackage, type PressPrefill, type PressPrefillField, type PressReleaseInput, type PressReleaseStatus, type PressReleaseText, type PressReleaseView, type PressTier,
} from "@shared/press";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid, StatusPill, appTable, appTableCards } from "@/components/app-ui";
import type { PillTone } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PressAutomationSettings, PressStatusStrip, ReleaseAutomationBadges, WriterSendControl } from "@/components/press/press-automation";
import { HelpButton } from "@/components/help-button";
import "@/components/press/press-wire.css";

type Overview = {
  packages: PressPackage[];
  credits: Record<PressTier, number>;
  orders: PressOrderView[];
  releases: PressReleaseView[];
  outletCounts: Record<PressTier, number>;
  setup: { ai: boolean; mailbox: boolean; wire: boolean; photos: boolean };
  pacing: { lastSubmittedAt: string | null; recommendedGapDays: number };
  autopilot: PressAutopilotView;
};
/** What "Draft it" on a story idea hands the writer. */
type Seed = { newsType: PressReleaseInput["newsType"]; details: string; ideaKey: string };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString("en-US");
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["/api/press/overview"] }), queryClient.invalidateQueries({ queryKey: ["/api/press/ideas"] })]);
const tierWord = (t: PressTier) => PRESS_TIER_LABEL[t];
const day = (iso: string, withYear = false) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), ...(iso.length === 10 ? { timeZone: "UTC" } : {}) });

/** "Today" when the autopilot date is today (UTC, as the worker counts days), else "Nov 5". */
const draftDay = (iso: string, withYear = false) => (iso === new Date().toISOString().slice(0, 10) ? "Today" : day(iso, withYear));

const STATUS_TONE: Record<PressReleaseStatus, PillTone> = {
  draft: "neutral", ready: "warning", queued: "warning", submitted: "info", changes_requested: "warning", live: "success", reported: "success", cancelled: "neutral",
};

const EMPTY_INPUT: PressReleaseInput = { newsType: "launch", companyName: "", website: "", city: "", state: "", contactName: "", contactEmail: "", contactPhone: "", details: "", spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: "", photos: [] };
const PREFILL_LABEL: Record<PressPrefillField, string> = { companyName: "company", website: "website", city: "city", state: "state", contactName: "contact name", contactEmail: "contact email", contactPhone: "contact phone", about: "about" };

/** A sample release, so an empty page shows what the writer produces (owner: sample previews on empty states). */
const SAMPLE: PressReleaseText = {
  headline: "Ridgeline Roofing Opens Second Crew to Serve Franklin County Homeowners",
  subheadline: "The Columbus roofer adds a dedicated repair team after a record year of storm work",
  dateline: "COLUMBUS, OH / October 15, 2026 /",
  body: "Ridgeline Roofing, a residential roofing contractor serving Franklin County since 2014, today announced the addition of a second full-time crew dedicated to roof repairs and emergency storm response. The new team begins work on November 1 and brings the company's field staff to eleven.\n\nThe expansion follows a year in which repair requests more than doubled after the February and September wind storms. Homeowners who called for a leak repair were waiting up to three weeks; the new crew is expected to bring that to under five business days.\n\n\"Repairs were getting pushed behind full replacements, and nobody with a leak wants to hear 'three weeks',\" said Dana Ortiz, owner of Ridgeline Roofing. \"A crew that only does repairs means a homeowner gets a tarp the same day and a fix the same week.\"\n\nThe repair crew is led by foreman Luis Marquez, who joined Ridgeline in 2019. The company has also added a second service truck and a dedicated repair phone line.\n\nRidgeline Roofing is licensed and bonded in Ohio and holds the GAF Master Elite certification. Repair estimates are free within Franklin County.",
  boilerplate: "About Ridgeline Roofing\nRidgeline Roofing is a residential roofing contractor based in Columbus, Ohio. Founded in 2014, the company installs and repairs asphalt shingle, metal and flat roofs for homeowners across Franklin County. Ridgeline is licensed and bonded in Ohio and a GAF Master Elite contractor. More at https://www.ridgelineroofing.example.",
  mediaContact: "Dana Ortiz\nRidgeline Roofing\ndana@ridgelineroofing.example\n(614) 555-0142\nhttps://www.ridgelineroofing.example",
};

/* ── Packages ─────────────────────────────────────────────────────────────── */

function Packages({ credits, onBuy, buying }: { credits: Record<PressTier, number>; onBuy: (key: string, tier: PressTier) => void; buying: string | null }) {
  const [qty, setQty] = useState<PressPackageKey>("single");
  const pkg = pressPackage(qty)!;
  return (
    <div className="space-y-6">
      <div className="wire-segment inline-flex rounded-lg border p-1" role="radiogroup" aria-label="How many releases">
        {PRESS_PACKAGES.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={qty === p.key} tabIndex={qty === p.key ? 0 : -1} onClick={() => setQty(p.key)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const current = PRESS_PACKAGES.findIndex((item) => item.key === qty);
              const next = event.key === "Home" ? 0 : event.key === "End" ? PRESS_PACKAGES.length - 1 : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + PRESS_PACKAGES.length) % PRESS_PACKAGES.length;
              setQty(PRESS_PACKAGES[next].key);
              (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
            }}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", qty === p.key ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            data-testid={`press-qty-${p.key}`}>
            {p.key === "single" ? "1 release" : `${PRESS_PROGRAM_PAID} + ${PRESS_PROGRAM_FREE} free`}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3" data-testid="press-packages">
        {PRESS_TIERS.map((tier) => {
          const info = PRESS_TIER_INFO[tier];
          const price = pressPackagePrice(pkg, tier);
          const popular = tier === "national";
          const busy = buying === `${tier}:${pkg.key}`;
          return (
            <div key={tier} className={cn("wire-package flex min-w-0 flex-col rounded-xl border bg-card p-5 lg:p-7", popular && "wire-package-featured")} data-testid={`press-package-${tier}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{PRESS_TIER_LABEL[tier]}</h3>
                {popular && <Badge variant="outline" className="wire-featured-label">Recommended</Badge>}
              </div>
              <p className="mt-3 min-h-10 text-sm text-muted-foreground">{info.tagline}</p>
              <div className="mt-6 text-4xl font-semibold tabular-nums tracking-tighter lg:text-[2.75rem]">
                {usd(price)}
                {pkg.credits > 1 && <span className="mt-2 block text-sm font-normal tracking-normal text-muted-foreground">for {pkg.credits} releases</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {pkg.credits > 1 ? `${usd(Math.round(price / pkg.credits))} a release, one a month for a year` : `or ${usd(pressPackagePrice(pressPackage("program_12")!, tier))} for ${PRESS_PROGRAM_CREDITS} (${PRESS_PROGRAM_FREE} free)`}
              </p>
              <ul className="mt-4 flex-1 space-y-2 border-t pt-4 text-sm">
                {info.perks.map((perk) => <li key={perk} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{perk}</span></li>)}
              </ul>
              <Button className={cn("mt-7 h-11 w-full", popular && "wire-primary")} variant={popular ? "default" : "outline"} onClick={() => onBuy(pkg.key, tier)} disabled={buying !== null} data-testid={`press-buy-${tier}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Buy ${PRESS_TIER_LABEL[tier]}${pkg.credits > 1 ? " program" : ""}`}
              </Button>
              {credits[tier] > 0 && <p className="mt-2 text-center text-xs text-muted-foreground">You have {credits[tier]} {PRESS_TIER_LABEL[tier]} credit{credits[tier] > 1 ? "s" : ""} left</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Where it runs ────────────────────────────────────────────────────────── */

function OutletsDialog({ tier, onClose }: { tier: PressTier | null; onClose: () => void }) {
  const url = tier ? `/api/press/outlets?tier=${tier}` : null;
  const { data, isLoading } = useQuery<{ outlets: string[] }>({ queryKey: [url], queryFn: () => getJson(url!), enabled: !!url });
  const [q, setQ] = useState("");
  const list = useMemo(() => (data?.outlets ?? []).filter((o) => o.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <Dialog open={!!tier} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tier ? tierWord(tier) : ""} distribution: every outlet</DialogTitle>
          <DialogDescription>The wire's published 2026 U.S. list for this package. Some publications choose what they post.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search outlets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search outlets" />
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border p-2 text-sm">
          {isLoading ? <div className="p-4 text-muted-foreground">Loading…</div> : (
            <>
              <div className="mb-2 px-1 text-xs text-muted-foreground">{n(list.length)} outlet{list.length === 1 ? "" : "s"}</div>
              <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">{list.map((o) => <li key={o} className="truncate">{o}</li>)}</ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Reach({ counts, onOpen }: { counts: Record<PressTier, number> | null; onOpen: (t: PressTier) => void }) {
  return (
    <div className={appTable.wrapper} data-testid="press-reach">
      <table className={appTable.table}>
        <thead className={cn(appTable.thead, appTableCards.thead)}>
          <tr><th className={appTable.th}>Distribution</th><th className={appTable.th}>Outlets</th><th className={appTable.th}>Headline outlets</th><th className={appTable.th}><span className="sr-only">Full list</span></th></tr>
        </thead>
        <tbody>
          {PRESS_TIERS.map((t) => (
            <tr key={t} className={cn(appTable.tr, appTableCards.tr)}>
              <td className={cn(appTable.td, appTableCards.td, "font-medium sm:whitespace-nowrap")}>{tierWord(t)}</td>
              <td className={cn(appTable.td, appTableCards.td, "sm:whitespace-nowrap")}>
                <span className="tabular-nums">{counts ? `${n(counts[t])} outlets` : "…"}</span>
                {PRESS_TIER_INFO[t].pickups && <div className="text-xs text-muted-foreground">Typically {PRESS_TIER_INFO[t].pickups} sites run it</div>}
              </td>
              <td className={cn(appTable.td, appTableCards.td, "text-muted-foreground")}>{PRESS_HEADLINE_OUTLETS[t].slice(0, 6).join(", ")}<span className="mt-1 block text-xs">+ {PRESS_HEADLINE_OUTLETS[t].length - 6} more headline outlets</span></td>
              <td className={cn(appTable.td, appTableCards.td, "sm:text-right")}>
                <Button variant="outline" size="sm" onClick={() => onOpen(t)} data-testid={`press-outlets-${t}`}>See every outlet</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── The release itself ───────────────────────────────────────────────────── */

function ReleasePreview({ text, compact = false }: { text: PressReleaseText; compact?: boolean }) {
  return (
    <article className={cn("wire-preview rounded-lg border bg-card p-5 text-sm leading-relaxed sm:p-7", compact && "wire-preview-compact")} data-testid="press-preview">
      <div className="wire-masthead"><span>ConstructHUB <strong>Press Wire</strong></span><span>{compact ? "Sample release" : "Press release"}</span></div>
      <h3 className="font-display text-2xl font-semibold leading-tight">{text.headline}</h3>
      {text.subheadline && <p className="mt-1 text-muted-foreground">{text.subheadline}</p>}
      <div className="mt-3 whitespace-pre-wrap"><span className="font-medium">{text.dateline}</span> {compact ? text.body.split("\n\n")[0] : text.body}</div>
      {!compact && text.boilerplate && <div className="mt-3 whitespace-pre-wrap border-t pt-3 text-muted-foreground">{text.boilerplate}</div>}
      {!compact && text.mediaContact && <div className="mt-3 whitespace-pre-wrap text-muted-foreground"><span className="font-medium text-foreground">Media contact</span>{"\n"}{text.mediaContact}</div>}
    </article>
  );
}

function Issues({ issues }: { issues: PressGuidelineIssue[] }) {
  if (!issues.length) return <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="press-issues-none"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Passes every guideline check we can run. The wire's editors have the final say.</div>;
  return (
    <ul className="space-y-1.5 text-sm" data-testid="press-issues">
      {issues.map((i, k) => (
        <li key={k} className={cn("flex gap-2 rounded-lg border px-3 py-2", i.blocking ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100" : "border-border bg-muted/60")}>
          {i.blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
          <span><span className="font-medium">{i.rule}.</span> {i.detail}{i.blocking ? " (must be fixed)" : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="font-medium">{label}</span>{hint && <span className="ml-1 text-xs text-muted-foreground">{hint}</span>}<div className="mt-1">{children}</div></label>;
}

/** The writer: facts → draft → edits → approve. One release at a time. */
function Writer({ release, seed, credits, setup, onClose }: { release: PressReleaseView | null; seed: Seed | null; credits: Record<PressTier, number>; setup: Overview["setup"]; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tier, setTier] = useState<PressTier>(release?.tier ?? (PRESS_TIERS.find((t) => credits[t] > 0) ?? "budget"));
  const [input, setInput] = useState<PressReleaseInput>(release?.input ?? (seed ? { ...EMPTY_INPUT, newsType: seed.newsType, details: seed.details } : EMPTY_INPUT));
  const [text, setText] = useState<PressReleaseText | null>(release?.text ?? null);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState<PressReleaseView | null>(release);
  const [filled, setFilled] = useState<PressPrefillField[]>([]);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const set = (k: keyof PressReleaseInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput((v) => ({ ...v, [k]: e.target.value }));
  const editable = !row || ["draft", "changes_requested"].includes(row.status);

  // A new release starts from what the account already has; only empty fields are filled, never what was typed.
  const prefill = useQuery<PressPrefill>({ queryKey: ["/api/press/prefill"], queryFn: () => getJson("/api/press/prefill"), enabled: !release, staleTime: 60_000 });
  useEffect(() => {
    const values = prefill.data?.values;
    if (!values || release || prefillApplied) return;
    const got = (Object.entries(values) as [PressPrefillField, string][]).filter(([k, val]) => val && !input[k]);
    setPrefillApplied(true);
    if (!got.length) return;
    setInput((v) => { const next = { ...v }; for (const [k, val] of got) if (!next[k]) next[k] = val; return next; });
    setFilled(got.map(([k]) => k));
  }, [prefill.data, release, prefillApplied, input]);

  const save = useMutation({
    mutationFn: async (): Promise<PressReleaseView> => {
      if (!row) return (await apiRequest("POST", "/api/press/releases", { tier, input, ...(seed ? { ideaKey: seed.ideaKey } : {}) })).json();
      return (await apiRequest("PATCH", `/api/press/releases/${row.id}`, { input, ...(text ? { text } : {}) })).json();
    },
    onSuccess: (r) => { setRow(r); setInput(r.input); setText(r.text); void refresh(); },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const draft = useMutation({
    mutationFn: async (): Promise<PressReleaseView> => {
      const r = await save.mutateAsync();
      return (await apiRequest("POST", `/api/press/releases/${r.id}/draft`, { notes })).json();
    },
    onSuccess: (r) => { setRow(r); setText(r.text); setNotes(""); setEditing(false); void refresh(); toast({ title: "Draft ready", description: "Read it, edit anything, then approve." }); },
    onError: (e: any) => toast({ title: "The writer could not finish", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async (): Promise<PressReleaseView> => {
      const r = await save.mutateAsync();
      return (await apiRequest("POST", `/api/press/releases/${r.id}/approve`, {})).json();
    },
    onSuccess: (r) => { setRow(r); void refresh(); toast({ title: "On its way to the wire", description: "One credit used. You get an email when the editors answer." }); onClose(); },
    onError: async (e: any) => {
      const msg = apiErrorMessage(e);
      toast({ title: msg.includes("credit") ? "No credit left" : "Not sent", description: msg, variant: "destructive" });
      if (row) { const r: PressReleaseView = await (await apiRequest("GET", `/api/press/releases/${row.id}`)).json(); setRow(r); }
    },
  });
  const upload = useMutation({
    mutationFn: async (files: FileList): Promise<PressReleaseView> => {
      const r = row ?? (await save.mutateAsync());
      const form = new FormData();
      Array.from(files).slice(0, 4).forEach((f) => form.append("photos", f));
      const res = await fetch(`/api/press/releases/${r.id}/photos`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Upload failed");
      return res.json();
    },
    onSuccess: (r) => { setRow(r); setInput((v) => ({ ...v, photos: r.input.photos })); },
    onError: (e: any) => toast({ title: "Photo not added", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/press/releases/${row!.id}/cancel`, {})).json(),
    onSuccess: () => { void refresh(); onClose(); },
  });

  const busy = save.isPending || draft.isPending || approve.isPending || upload.isPending;
  const noCredit = credits[tier] < 1 && !row?.orderId;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{row ? `${row.code} · ${PRESS_STATUS_LABELS[row.status]}` : "Write a press release"}</DialogTitle>
          <DialogDescription>{row ? PRESS_STATUS_HELP[row.status] : "Give the facts. The writer drafts a release to the wire's editorial rules; you read it, change anything, and approve. Nothing is sent, and no credit is used, until you approve."}</DialogDescription>
        </DialogHeader>

        {row?.status === "changes_requested" && row.wireNotes && (
          <Notice tone="warning" title="The editors asked for changes">
            <div className="whitespace-pre-wrap">{row.wireNotes}</div>
            <div className="mt-1 text-xs">The draft below was already revised for these points. Read it and approve to send it back; no extra credit is used.</div>
          </Notice>
        )}
        {row?.liveUrl && <Notice tone="success" title="Live on the wire"><a className="underline" href={row.liveUrl} target="_blank" rel="noreferrer">{row.liveUrl}</a></Notice>}
        {row?.report && (
          <Notice tone="info" title="Distribution report">
            <div>{row.report.summary}</div>
            <div className="mt-1 flex flex-wrap gap-3 font-medium">
              {row.report.outlets != null && <span>{n(row.report.outlets)} outlets</span>}{row.report.views != null && <span>{n(row.report.views)} views</span>}{row.report.clicks != null && <span>{n(row.report.clicks)} clicks</span>}
            </div>
            {row.report.attachments.length > 0 && <div className="mt-1">{row.report.attachments.map((a) => <a key={a.url} className="mr-3 underline" href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}</div>}
          </Notice>
        )}

        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            {!row && (
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Distribution">
                {PRESS_TIERS.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tier === t} onClick={() => setTier(t)}
                    className={cn("min-w-0 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tier === t ? "border-primary ring-1 ring-primary" : "border-border")}
                    data-testid={`press-writer-tier-${t}`}>
                    <div className="truncate font-medium">{tierWord(t)}</div>
                    <div className="truncate text-xs text-muted-foreground">{credits[t]} credit{credits[t] === 1 ? "" : "s"} left</div>
                  </button>
                ))}
              </div>
            )}
            {noCredit && <Notice tone="warning" title={`No ${tierWord(tier)} credit`}>Pick a package first. You can still fill in the facts now.</Notice>}
            {!row && filled.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="press-prefill-note">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Filled from your account: {filled.map((f) => PREFILL_LABEL[f]).join(", ")}. Check them before you write.</span>
              </p>
            )}
            <Field label="What kind of news is it?">
              <Select value={input.newsType} onValueChange={(v) => setInput((x) => ({ ...x, newsType: v as PressReleaseInput["newsType"] }))} disabled={!editable}>
                <SelectTrigger data-testid="press-news-type"><SelectValue /></SelectTrigger>
                <SelectContent>{PRESS_NEWS_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name"><Input value={input.companyName} onChange={set("companyName")} disabled={!editable} data-testid="press-company" /></Field>
              <Field label="Website" hint="https://…"><Input value={input.website} onChange={set("website")} disabled={!editable} data-testid="press-website" /></Field>
              <Field label="City"><Input value={input.city} onChange={set("city")} disabled={!editable} data-testid="press-city" /></Field>
              <Field label="State" hint="e.g. OH"><Input value={input.state} onChange={set("state")} disabled={!editable} data-testid="press-state" /></Field>
            </div>
            <Field label="What happened?" hint="Plain words. Dates, numbers, names and places you want in the release. Only these facts are used.">
              <Textarea rows={7} value={input.details} onChange={set("details")} disabled={!editable} placeholder="We opened a second crew for roof repairs on November 1. Repair requests doubled after the February and September storms…" data-testid="press-details" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Spokesperson" hint="who is quoted"><Input value={input.spokesperson} onChange={set("spokesperson")} disabled={!editable} placeholder="Dana Ortiz" /></Field>
              <Field label="Their title"><Input value={input.spokespersonTitle} onChange={set("spokespersonTitle")} disabled={!editable} placeholder="Owner" /></Field>
            </div>
            <Field label="What they want to say" hint="the writer shapes it into the quote"><Textarea rows={2} value={input.quoteNotes} onChange={set("quoteNotes")} disabled={!editable} /></Field>
            <Field label="About the company" hint="years in business, services, areas, licences, for the closing paragraph"><Textarea rows={3} value={input.about} onChange={set("about")} disabled={!editable} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Media contact name"><Input value={input.contactName} onChange={set("contactName")} disabled={!editable} data-testid="press-contact-name" /></Field>
              <Field label="Contact email" hint="required by the wire"><Input type="email" value={input.contactEmail} onChange={set("contactEmail")} disabled={!editable} data-testid="press-contact-email" /></Field>
              <Field label="Contact phone"><Input value={input.contactPhone} onChange={set("contactPhone")} disabled={!editable} /></Field>
            </div>
            <div>
              <div className="text-sm font-medium">Photos <span className="text-xs font-normal text-muted-foreground">up to 6, sent with the release</span></div>
              <div className="mt-1 flex flex-wrap gap-2">
                {input.photos.map((p, i) => (
                  <div key={p.key || i} className="relative h-20 w-20 overflow-hidden rounded-lg border">
                    <img src={p.url} alt={p.caption || `Photo ${i + 1}`} className="h-full w-full object-cover" />
                    {editable && <button type="button" className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-xs text-white" aria-label="Remove photo" onClick={() => setInput((v) => ({ ...v, photos: v.photos.filter((_, k) => k !== i) }))}>×</button>}
                  </div>
                ))}
                {editable && input.photos.length < 6 && setup.photos && (
                  <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed text-muted-foreground hover:bg-muted">
                    {upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" aria-hidden="true" />}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ""; }} data-testid="press-photo-input" />
                    <span className="sr-only">Add photos</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            {text ? (
              <>
                {editing && editable ? (
                  <div className="space-y-2">
                    <Field label="Headline"><Input value={text.headline} onChange={(e) => setText({ ...text, headline: e.target.value })} /></Field>
                    <Field label="Subheadline"><Input value={text.subheadline} onChange={(e) => setText({ ...text, subheadline: e.target.value })} /></Field>
                    <Field label="Dateline"><Input value={text.dateline} onChange={(e) => setText({ ...text, dateline: e.target.value })} /></Field>
                    <Field label="Body"><Textarea rows={14} value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })} /></Field>
                    <Field label="About the company"><Textarea rows={4} value={text.boilerplate} onChange={(e) => setText({ ...text, boilerplate: e.target.value })} /></Field>
                    <Field label="Media contact"><Textarea rows={4} value={text.mediaContact} onChange={(e) => setText({ ...text, mediaContact: e.target.value })} /></Field>
                    <Button variant="outline" size="sm" onClick={() => { setEditing(false); save.mutate(); }} disabled={busy}>Done editing</Button>
                  </div>
                ) : <ReleasePreview text={text} />}
                <Issues issues={row?.issues ?? []} />
                <WriterSendControl release={row} />
                {editable && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-sm font-medium">Want it different?</div>
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shorter. Lead with the storm damage. Mention the free estimates in the first paragraph." data-testid="press-notes" />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => draft.mutate()} disabled={busy || !setup.ai} data-testid="press-rewrite">{draft.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Rewrite</Button>
                      {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>Edit the text myself</Button>}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <FileText className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <div className="mt-2 text-sm font-medium">Your draft shows here</div>
                <div className="text-sm text-muted-foreground">Fill in the facts, then press Write it.</div>
              </div>
            )}
          </div>
        </div>

        {editable && (
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => save.mutate()} disabled={busy}>Save draft</Button>
              {row && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancel.mutate()} disabled={busy}>Cancel release</Button>}
            </div>
            {noCredit ? (
              <Button onClick={() => { onClose(); navigate("/press-releases#packages"); }}>Pick a package</Button>
            ) : !text ? (
              <Button onClick={() => draft.mutate()} disabled={busy || !setup.ai || input.details.length < 80} data-testid="press-write">{draft.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Writing…</> : "Write it"}</Button>
            ) : (
              <Button onClick={() => approve.mutate()} disabled={busy || editing || (row?.issues ?? []).some((i) => i.blocking)} data-testid="press-approve">{approve.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" aria-hidden="true" />} Approve and send{row?.orderId ? "" : " (1 credit)"}</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Story ideas + autopilot ──────────────────────────────────────────────── */

function Ideas({ ideas, loading, onDraft }: { ideas: PressIdea[]; loading: boolean; onDraft: (i: PressIdea) => void }) {
  const { toast } = useToast();
  const dismiss = useMutation({
    mutationFn: async (key: string) => (await apiRequest("POST", `/api/press/ideas/${encodeURIComponent(key)}/dismiss`, {})).json(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["/api/press/ideas"] }),
    onError: (e: any) => toast({ title: "Could not dismiss", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Looking through your account…</div>;
  if (!ideas.length) {
    return (
      <div className="space-y-3 text-sm" data-testid="press-ideas-empty">
        <p className="text-muted-foreground">No story ideas in your account data right now. Ideas come from things like a new division, a project or Google review milestone, a round anniversary, new team members, or awards on your Call Assistant profile. You can write about any of these at any time:</p>
        <div className="flex flex-wrap gap-1.5">{PRESS_NEWS_TYPES.map((t) => <Badge key={t.key} variant="outline" className="font-normal">{t.label}</Badge>)}</div>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-lg border" data-testid="press-ideas">
      {ideas.map((i) => (
        <li key={i.key} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4" data-testid={`press-idea-${i.key}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{i.title}</span>
              <Badge variant="outline" className="font-normal">{PRESS_NEWS_TYPES.find((t) => t.key === i.newsType)?.label.split(":")[0]}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{i.why}</p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {i.facts.map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" /><span className="min-w-0 break-words">{f}</span></li>)}
            </ul>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => onDraft(i)} data-testid={`press-idea-draft-${i.key}`}>Draft it</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(i.key)} disabled={dismiss.isPending} data-testid={`press-idea-dismiss-${i.key}`}>Dismiss</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Autopilot({ view }: { view: PressAutopilotView }) {
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (v: { enabled: boolean; dayOfMonth: number }): Promise<PressAutopilotView> => (await apiRequest("PUT", "/api/press/autopilot", v)).json(),
    onSuccess: () => void refresh(),
    onError: (e: any) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="wire-autopilot space-y-4 rounded-xl border bg-muted/40 p-5" data-testid="press-autopilot">
      <div className="flex flex-col gap-5">
        <label className="flex items-start gap-3">
          <Switch checked={view.enabled} onCheckedChange={(enabled) => save.mutate({ enabled, dayOfMonth: view.dayOfMonth })} disabled={save.isPending} aria-label="Draft one release a month for me" data-testid="press-autopilot-switch" />
          <span className="text-sm">
            <span className="block font-medium">Draft one release a month for me</span>
            <span className="block text-muted-foreground">The writer drafts from your top story idea. You get a notification to review it. Nothing is sent and no credit is used until you approve.</span>
          </span>
        </label>
        <div className="flex items-center gap-2 text-sm sm:shrink-0">
          <span className="text-muted-foreground">Day of the month</span>
          <Select value={String(view.dayOfMonth)} onValueChange={(v) => save.mutate({ enabled: view.enabled, dayOfMonth: Number(v) })} disabled={save.isPending}>
            <SelectTrigger className="w-20" data-testid="press-autopilot-day" aria-label="Day of the month"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: PRESS_AUTOPILOT_MAX_DAY }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {view.enabled && (
        <p className="text-xs text-muted-foreground" data-testid="press-autopilot-next">
          {view.nextDraftOn ? `Next draft: ${draftDay(view.nextDraftOn, true).replace(/^Today$/, "today, on the next hourly check")}.` : "Paused until you have a release credit."}{view.lastResult ? ` Last check: ${view.lastResult}` : ""}
        </p>
      )}
    </div>
  );
}

/* ── Your releases ────────────────────────────────────────────────────────── */

const STEPS = ["Pick a package", "Tell us what happened (and add photos)", "Read the draft, change anything, approve", "The wire's editors review it, usually within a business day", "You get the live link, then the distribution report, by email"];

function Timeline({ releases, onOpen }: { releases: PressReleaseView[]; onOpen: (r: PressReleaseView) => void }) {
  if (!releases.length) {
    return (
      <div className="wire-empty" data-testid="press-releases-empty">
        <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div><h3 className="font-semibold">Your first story starts here.</h3>
          <p className="mt-1 text-sm text-muted-foreground">Write a release or draft one from a story idea. Review the text before it goes to the wire.</p>
          <details className="mt-3 text-sm"><summary className="cursor-pointer">How publishing works</summary>
            <ol className="mt-3 space-y-2">{STEPS.map((s, i) => <li key={s}>{i + 1}. {s}</li>)}</ol>
          </details>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y border-y" data-testid="press-releases-list">
      {releases.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-3 px-2 py-5 hover:bg-muted/40">
          <button type="button" className="min-w-0 flex-1 basis-56 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(r)} data-testid={`press-release-${r.id}`}>
            <div className="break-words text-base font-semibold">{r.text?.headline ?? `${r.input.companyName}: ${PRESS_NEWS_TYPES.find((t) => t.key === r.input.newsType)?.label ?? "release"}`}</div>
            <div className="text-xs text-muted-foreground">{r.code} · {tierWord(r.tier)} · {day(r.updatedAt, true)}{r.liveAt ? ` · live ${day(r.liveAt)}` : ""}</div>
          </button>
          <ReleaseAutomationBadges release={r} />
          <StatusPill tone={STATUS_TONE[r.status]} title={PRESS_STATUS_HELP[r.status]}>{PRESS_STATUS_LABELS[r.status]}</StatusPill>
          {r.liveUrl && <a className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring" href={r.liveUrl} target="_blank" rel="noreferrer">Read release <ExternalLink className="h-3.5 w-3.5" /></a>}
          {r.status === "changes_requested" && <StatusPill tone="danger">Action needed</StatusPill>}
        </li>
      ))}
    </ul>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

/** The top 10 headline outlets of Plus and of Premium (shared/press.ts order), each named once and tagged with the lowest package that has it, on a slow loop. */
const CAROUSEL_OUTLETS: { name: string; tier: "premium" | "national" }[] = (() => {
  const seen = new Set<string>(), out: { name: string; tier: "premium" | "national" }[] = [];
  for (const tier of ["national", "premium"] as const)
    for (const name of PRESS_HEADLINE_OUTLETS[tier].filter((o) => o !== "ACCESS Newswire").slice(0, 10))
      if (!seen.has(name)) { seen.add(name); out.push({ name, tier }); }
  return out;
})();

function OutletCarousel() {
  // Rendered twice for a seamless loop; the copy is hidden from screen readers.
  const row = (copy: boolean) => (
    <ul className="wire-carousel-row" aria-hidden={copy || undefined}>
      {CAROUSEL_OUTLETS.map((o) => (
        <li key={o.name}><span className="wire-carousel-name">{o.name}</span><span className="wire-carousel-tier">{PRESS_TIER_LABEL[o.tier]}</span></li>
      ))}
    </ul>
  );
  return (
    <div className="wire-carousel" data-testid="press-outlet-carousel">
      <div className="wire-carousel-track">{row(false)}{row(true)}</div>
    </div>
  );
}

export default function PressReleasesPage() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Overview>({ queryKey: ["/api/press/overview"], queryFn: () => getJson("/api/press/overview"), refetchInterval: 30_000 });
  const ideas = useQuery<{ ideas: PressIdea[] }>({ queryKey: ["/api/press/ideas"], queryFn: () => getJson("/api/press/ideas"), staleTime: 60_000 });
  const [outletsTier, setOutletsTier] = useState<PressTier | null>(null);
  const [writer, setWriter] = useState<{ open: boolean; release: PressReleaseView | null; seed: Seed | null }>({ open: false, release: null, seed: null });
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => { document.title = "Press Releases | ConstructHUB"; }, []);
  // Back from Stripe (?paid=<order>) or an email or bell link (?release=<id>).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("paid")) { toast({ title: "Package bought", description: "Your credits are ready. Write your first release." }); window.history.replaceState({}, "", "/press-releases"); void refresh(); }
    if (q.get("canceled")) { window.history.replaceState({}, "", "/press-releases"); }
  }, [toast]);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("release"));
    const r = data?.releases.find((x) => x.id === id);
    if (r && !writer.open) { setWriter({ open: true, release: r, seed: null }); window.history.replaceState({}, "", "/press-releases"); }
  }, [data, writer.open]);

  const buy = useMutation({
    mutationFn: async ({ key, tier }: { key: string; tier: PressTier }) => { setBuying(`${tier}:${key}`); return (await apiRequest("POST", "/api/press/orders", { packageKey: key, tier })).json() as Promise<{ url: string }>; },
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => { setBuying(null); toast({ title: "Couldn't open checkout", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  const credits = data?.credits ?? { budget: 0, national: 0, premium: 0 };
  const totalCredits = credits.budget + credits.national + credits.premium;
  const last = data?.pacing.lastSubmittedAt ? new Date(data.pacing.lastSubmittedAt) : null;
  const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
  const active = (data?.releases ?? []).filter((r) => r.status !== "cancelled");
  const live = active.filter((r) => r.status === "live" || r.status === "reported").length;
  const sent = active.filter((r) => !["draft", "ready", "changes_requested"].includes(r.status)).length;
  // The widest distribution the account can send on now.
  const reachTier = [...PRESS_TIERS].reverse().find((t) => credits[t] > 0) ?? null;
  const autopilot = data?.autopilot;
  const openNew = (seed: Seed | null = null) => setWriter({ open: true, release: null, seed });

  return (
    <AppPage width="wide" className="press-wire" testId="page-press-releases">
      <header className="wire-page-masthead" data-testid="press-masthead">
        <div className="wire-page-dateline">
          <span>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
          <span className="wire-page-dateline-name">ConstructHUB Press Wire</span>
        </div>
        <div className="wire-page-title-row">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1>Press <span>Releases.</span></h1>
              <HelpButton k="press-releases" />
            </div>
            <p>Your news on the national wire: written for you, reviewed by editors, reported back to you.</p>
          </div>
          <dl className="wire-page-ticker" aria-label="Your press account">
            <div><dt>Credits</dt><dd>{data ? n(totalCredits) : "…"}</dd></div>
            <div><dt>Live</dt><dd>{data ? n(live) : "…"}</dd></div>
            <div><dt>Autopilot</dt><dd className={autopilot?.enabled ? "is-on" : undefined}>{!data ? "…" : autopilot?.enabled ? "On" : "Off"}</dd></div>
          </dl>
        </div>
      </header>
      {error && <Notice tone="danger" title="Could not load">{apiErrorMessage(error)}</Notice>}

      <section className="wire-hero" aria-labelledby="wire-headline">
        <div className="wire-hero-copy">
          <p className="wire-eyebrow">Your company. National news.</p>
          <h2 id="wire-headline">Good work<br />deserves<br /><span>the headlines.</span></h2>
          <p className="wire-hero-description">Take your company’s next chapter to the national newsrooms. We write the release. You approve it. The wire takes it from there.</p>
          <Button className="wire-hero-cta" onClick={() => openNew()} disabled={!data} data-testid="press-new">Write a release <ArrowRight className="ml-3 h-4 w-4" /></Button>
          <a className="wire-package-link" href="#packages">Compare distribution packages <ArrowRight className="h-4 w-4" /></a>
        </div>
        <div className="wire-hero-paper">
          <div className="wire-preview-label"><span>From your business to the wire</span><Newspaper className="h-4 w-4" /></div>
          <ReleasePreview text={SAMPLE} compact />
          <p className="mt-4 text-xs text-muted-foreground">An example of the finished release. Your draft uses your facts, your company and your voice.</p>
        </div>
      </section>

      <section className="wire-proof" aria-label="Distribution outlets">
        <p className="wire-eyebrow">On the distribution list</p>
        <OutletCarousel />
        <p className="text-xs text-muted-foreground">Availability varies by package. Distribution is not a guarantee of editorial coverage.</p>
      </section>

      <div className="wire-stats">
      <StatGrid cols={4} className="sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Credits left" value={data ? n(totalCredits) : "…"} testId="press-credits"
          hint={totalCredits > 0 ? PRESS_TIERS.filter((t) => credits[t] > 0).map((t) => `${credits[t]} ${tierWord(t)}`).join(" · ") : "Pick a package to start"} href={totalCredits > 0 ? undefined : "#packages"} />
        <Stat label="Releases live" value={data ? n(live) : "…"} hint={sent > 0 ? `of ${n(sent)} sent to the wire` : "None sent yet"} testId="press-live" />
        <Stat label="Next autopilot draft" value={!data ? "…" : autopilot?.nextDraftOn ? draftDay(autopilot.nextDraftOn) : autopilot?.enabled ? "Paused" : "Off"} testId="press-next-draft"
          hint={autopilot?.enabled ? (autopilot.nextDraftOn ? `Day ${autopilot.dayOfMonth} of each month` : "Paused: no credit left") : "Turn it on beside Story ideas"} />
        <Stat label="Reach" value={reachTier && data ? `${n(data.outletCounts[reachTier])}` : "None yet"} testId="press-reach-stat"
          hint={reachTier ? `outlets on ${tierWord(reachTier)}, the tier you have credits for` : "Outlets depend on the package"} />
      </StatGrid>
      </div>

      <section className="wire-engine" aria-labelledby="wire-engine-heading">
        <div className="wire-section-heading"><div><p className="wire-eyebrow">A publishing rhythm</p><h2 id="wire-engine-heading">The next story is already taking shape.</h2></div><p>Ideas from your account. A draft each month.<br />You always have the final word.</p></div>
        <ol className="wire-flow" aria-label="Your publishing workflow">
          {[
            { label: "Story idea", value: ideas.data ? `${n(ideas.data.ideas.length)} available` : "Checking account…" },
            { label: "Draft", value: data ? `${active.filter((r) => r.status === "draft").length} in progress` : "Loading…" },
            { label: "You approve", value: data ? `${active.filter((r) => (r.status === "draft" && !!r.text) || r.status === "changes_requested").length} to review` : "Loading…" },
            { label: "On the wire", value: data ? `${n(sent)} sent` : "Loading…" },
            { label: "Report", value: data ? `${active.filter((r) => r.status === "reported").length} delivered` : "Loading…" },
          ].map((step, i) => <li key={step.label}><span className="wire-step-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span><div><h3>{step.label}</h3><p>{step.value}</p></div>{i < 4 && <ArrowRight className="wire-flow-arrow h-4 w-4" aria-hidden="true" />}</li>)}
        </ol>
        <PressStatusStrip />
        <div className="wire-engine-body">
          <Section title="Story ideas" icon={Lightbulb} description="Found in your account. Every fact is yours." testId="press-ideas-section" className="wire-ideas-panel">
            {ideas.isError ? <Notice tone="danger" title="Could not load story ideas">{apiErrorMessage(ideas.error)}</Notice> : <Ideas ideas={ideas.data?.ideas ?? []} loading={ideas.isLoading} onDraft={(i) => openNew({ newsType: i.newsType, details: i.detailsDraft, ideaKey: i.key })} />}
          </Section>
          <aside className="min-w-0">
            {autopilot ? <Autopilot view={autopilot} /> : <p className="p-5 text-sm text-muted-foreground">{error ? "Automation settings unavailable." : "Loading automation settings…"}</p>}
            <PressAutomationSettings />
          </aside>
        </div>
      </section>

      <Section
        className="wire-open-section"
        title="Your releases"
        icon={Clock}
        description={daysSince != null && daysSince < (data?.pacing.recommendedGapDays ?? 28) && totalCredits > 0 ? `Last one went out ${daysSince} day${daysSince === 1 ? "" : "s"} ago. For the best results, space releases about a month apart.` : "Each release's status, its live link and its report. Click one to open it."}
        actions={active.length > 0 ? <Button size="sm" variant="outline" onClick={() => openNew()}>New release</Button> : null}
      >
        {isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : <Timeline releases={active} onOpen={(r) => setWriter({ open: true, release: r, seed: null })} />}
      </Section>

      <Section className="wire-pricing wire-open-section" id="packages" title="Choose your reach" icon={Package} description={`Every release is written to the wire's editorial guidelines, sent with your photos, and reported back. Buy ${PRESS_PROGRAM_PAID} and get ${PRESS_PROGRAM_CREDITS}.`}>
        <Packages credits={credits} onBuy={(key, tier) => buy.mutate({ key, tier })} buying={buying} />
        <p className="mt-4 text-xs text-muted-foreground">Credits are good for {PRESS_CREDIT_MONTHS} months. One release a month keeps a company in the news. The wire does not refund a release its editors refuse for breaking the content rules, so the writer checks every draft against those rules before you approve it.</p>
      </Section>

      <Section className="wire-distribution wire-open-section" title="Where it runs" icon={Globe2} description="The wire's published U.S. lists: the newsrooms each release is sent to. Fewer sites actually run it; some publications choose what they post.">
        <Reach counts={data?.outletCounts ?? null} onOpen={setOutletsTier} />
      </Section>

      {(data?.orders.length ?? 0) > 0 && (
        <Section title="Your purchases" flush>
          <ul className="divide-y border-t text-sm">
            {data!.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <span className="font-medium">{o.packageName}</span>
                <span className="text-muted-foreground">{o.status === "paid" ? `${o.creditsLeft} of ${o.credits} left${o.expiresAt ? ` · good until ${day(o.expiresAt, true)}` : ""}` : "Awaiting payment"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <OutletsDialog tier={outletsTier} onClose={() => setOutletsTier(null)} />
      {writer.open && data && <Writer key={writer.release?.id ?? writer.seed?.ideaKey ?? "new"} release={writer.release} seed={writer.seed} credits={credits} setup={data.setup} onClose={() => setWriter({ open: false, release: null, seed: null })} />}
    </AppPage>
  );
}
