/**
 * /press-releases — the ConstructHUB Press Wire (shared/press.ts). Loud on purpose (owner, 2026-10-15: "make it loud and
 * flashy"): the outlets, the three packages, then the work: tell us the news → the AI writes it to the wire's rules →
 * approve → it goes out → live link and report come back by email. Every number and outlet name on this page comes
 * from the wire's own 2026 sheets (server/data/press-outlets.json) or the price book (shared/press.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileText, Flame, Globe2, Image as ImageIcon, Loader2, Newspaper, Radio, Rocket, Send, Sparkles, Star, Trophy, Tv, XCircle, Zap } from "lucide-react";
import {
  PRESS_HEADLINE_OUTLETS, PRESS_NEWS_TYPES, PRESS_PACKAGES, PRESS_PROGRAM_CREDITS, PRESS_PROGRAM_FREE, PRESS_PROGRAM_PAID, PRESS_STATUS_HELP, PRESS_STATUS_LABELS,
  pressPackagePrice, type PressGuidelineIssue, type PressOrderView, type PressPackage, type PressReleaseInput, type PressReleaseStatus, type PressReleaseText, type PressReleaseView, type PressTier,
} from "@shared/press";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, PageHeader, Section } from "@/components/app-ui";
import { HelpButton } from "@/components/help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Overview = {
  packages: PressPackage[];
  credits: Record<PressTier, number>;
  orders: PressOrderView[];
  releases: PressReleaseView[];
  outletCounts: Record<PressTier, number>;
  setup: { ai: boolean; mailbox: boolean; wire: boolean; photos: boolean };
  pacing: { lastSubmittedAt: string | null; recommendedGapDays: number };
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString("en-US");
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/press/overview"] });
const tierWord = (t: PressTier) => (t === "premium" ? "Premium" : "Wire");

const STATUS_TONE: Record<PressReleaseStatus, string> = {
  draft: "bg-slate-100 text-slate-700", ready: "bg-amber-100 text-amber-800", queued: "bg-amber-100 text-amber-800", submitted: "bg-blue-100 text-blue-800",
  changes_requested: "bg-orange-100 text-orange-800", live: "bg-emerald-100 text-emerald-800", reported: "bg-emerald-100 text-emerald-800", cancelled: "bg-slate-100 text-slate-500",
};

const EMPTY_INPUT: PressReleaseInput = { newsType: "launch", companyName: "", website: "", city: "", state: "", contactName: "", contactEmail: "", contactPhone: "", details: "", spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: "", photos: [] };

/** A sample release, so an empty page shows what the writer produces (owner: sample previews on empty states). */
const SAMPLE: PressReleaseText = {
  headline: "Ridgeline Roofing Opens Second Crew to Serve Whatcom County Homeowners",
  subheadline: "The Bellingham roofer adds a dedicated repair team after a record year of storm work",
  dateline: "BELLINGHAM, WA / October 15, 2026 /",
  body: "Ridgeline Roofing, a residential roofing contractor serving Whatcom County since 2014, today announced the addition of a second full-time crew dedicated to roof repairs and emergency storm response. The new team begins work on November 1 and brings the company's field staff to eleven.\n\nThe expansion follows a year in which repair requests more than doubled after the February and September wind storms. Homeowners who called for a leak repair were waiting up to three weeks; the new crew is expected to bring that to under five business days.\n\n\"Repairs were getting pushed behind full replacements, and nobody with a leak wants to hear 'three weeks',\" said Dana Ortiz, owner of Ridgeline Roofing. \"A crew that only does repairs means a homeowner gets a tarp the same day and a fix the same week.\"\n\nThe repair crew is led by foreman Luis Marquez, who joined Ridgeline in 2019. The company has also added a second service truck and a dedicated repair phone line.\n\nRidgeline Roofing is licensed and bonded in Washington and holds the GAF Master Elite certification. Repair estimates are free within Whatcom County.",
  boilerplate: "About Ridgeline Roofing\nRidgeline Roofing is a residential roofing contractor based in Bellingham, Washington. Founded in 2014, the company installs and repairs asphalt shingle, metal and flat roofs for homeowners across Whatcom County. Ridgeline is licensed and bonded in Washington and a GAF Master Elite contractor. More at https://www.ridgelineroofing.example.",
  mediaContact: "Dana Ortiz\nRidgeline Roofing\ndana@ridgelineroofing.example\n(360) 555-0142\nhttps://www.ridgelineroofing.example",
};

function Marquee({ names }: { names: string[] }) {
  const doubled = [...names, ...names];
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30 py-3" aria-label="Outlets" data-testid="press-marquee">
      <div className="press-marquee flex w-max gap-8 whitespace-nowrap px-4 text-sm font-semibold uppercase tracking-wider text-white/90">
        {doubled.map((o, i) => <span key={i} className="flex items-center gap-2"><Star className="h-3 w-3 text-amber-300" aria-hidden="true" />{o}</span>)}
      </div>
      <style>{`.press-marquee{animation:press-scroll 60s linear infinite}@keyframes press-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media (prefers-reduced-motion:reduce){.press-marquee{animation:none;flex-wrap:wrap;white-space:normal;width:auto}}`}</style>
    </div>
  );
}

function Hero({ counts }: { counts: Record<PressTier, number> }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-600 via-rose-600 to-indigo-800 p-6 text-white shadow-xl sm:p-10" data-testid="press-hero">
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-amber-300/30 blur-3xl" aria-hidden="true" />
      <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest"><Flame className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" /> New · Press Wire</div>
        <h2 className="text-3xl font-black leading-tight sm:text-5xl">Put your company in the <span className="bg-gradient-to-r from-amber-200 to-yellow-400 bg-clip-text text-transparent">national news.</span></h2>
        <p className="mt-3 max-w-2xl text-base text-white/90 sm:text-lg">Tell us what happened. The writer turns it into a wire-ready press release, we send it to the wire, and the live link and distribution report land in your inbox.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { v: `${n(counts.premium)}+`, l: "Premium outlets", i: Tv },
            { v: `${n(counts.budget)}+`, l: "Wire outlets", i: Radio },
            { v: "AP · Bloomberg · Reuters", l: "On the Premium wire", i: Globe2 },
            { v: "Yahoo Finance", l: "On every release", i: Newspaper },
          ].map((s) => (
            <div key={s.l} className="rounded-xl bg-white/10 p-3 backdrop-blur">
              <s.i className="mb-1 h-5 w-5 text-amber-200" aria-hidden="true" />
              <div className="text-lg font-black leading-tight sm:text-xl">{s.v}</div>
              <div className="text-xs uppercase tracking-wide text-white/75">{s.l}</div>
            </div>
          ))}
        </div>
        <div className="mt-6"><Marquee names={PRESS_HEADLINE_OUTLETS.premium} /></div>
      </div>
    </div>
  );
}

function Packages({ credits, onBuy, buying }: { credits: Record<PressTier, number>; onBuy: (key: string, tier: PressTier) => void; buying: string | null }) {
  const [programTier, setProgramTier] = useState<PressTier>("budget");
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="press-packages">
      {PRESS_PACKAGES.map((p, i) => {
        const tier: PressTier = p.tier === "choose" ? programTier : p.tier;
        const price = pressPackagePrice(p, tier);
        const hot = p.key === "program_12";
        return (
          <div key={p.key} className={`relative flex flex-col rounded-2xl border-2 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${hot ? "border-orange-500 bg-gradient-to-b from-orange-50 to-white dark:from-orange-950/40 dark:to-background" : "border-border bg-card"}`} data-testid={`press-package-${p.key}`}>
            <div className={`absolute -top-3 left-4 rounded-full px-3 py-0.5 text-[11px] font-black uppercase tracking-widest text-white ${hot ? "bg-orange-600" : i === 1 ? "bg-indigo-600" : "bg-slate-700"}`}>{p.flashy}</div>
            <div className="mt-2 flex items-center gap-2 text-lg font-black">{i === 0 ? <Zap className="h-5 w-5 text-amber-500" aria-hidden="true" /> : i === 1 ? <Trophy className="h-5 w-5 text-indigo-500" aria-hidden="true" /> : <Rocket className="h-5 w-5 text-orange-600" aria-hidden="true" />}{p.name}</div>
            <div className="text-sm text-muted-foreground">{p.tagline}</div>
            <div className="mt-3 text-3xl font-black">{usd(price)}{p.credits > 1 && <span className="ml-2 text-sm font-semibold text-muted-foreground">for {p.credits} releases</span>}</div>
            {p.credits > 1 && <div className="text-xs font-semibold text-emerald-700">{usd(Math.round(price / p.credits))} a release · {PRESS_PROGRAM_FREE} free</div>}
            {p.tier === "choose" && (
              <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Program tier">
                {(["budget", "premium"] as PressTier[]).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={programTier === t} onClick={() => setProgramTier(t)} className={`flex-1 rounded-lg border px-2 py-1.5 text-sm font-semibold ${programTier === t ? "border-orange-600 bg-orange-600 text-white" : "border-border"}`} data-testid={`press-program-${t}`}>{tierWord(t)}</button>
                ))}
              </div>
            )}
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {p.perks.map((perk) => <li key={perk} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />{perk}</li>)}
            </ul>
            <Button className={`mt-5 w-full font-bold ${hot ? "bg-orange-600 hover:bg-orange-700" : ""}`} onClick={() => onBuy(p.key, tier)} disabled={buying !== null} data-testid={`press-buy-${p.key}`}>
              {buying === p.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Get {p.name} <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></>}
            </Button>
            {credits[tier] > 0 && p.credits === 1 && <div className="mt-2 text-center text-xs text-muted-foreground">You have {credits[tier]} {tierWord(tier)} credit{credits[tier] > 1 ? "s" : ""} left</div>}
          </div>
        );
      })}
    </div>
  );
}

function OutletsDialog({ tier, onClose }: { tier: PressTier | null; onClose: () => void }) {
  const url = tier ? `/api/press/outlets?tier=${tier}` : null;
  const { data, isLoading } = useQuery<{ outlets: string[] }>({ queryKey: [url], queryFn: () => getJson(url!), enabled: !!url });
  const [q, setQ] = useState("");
  const list = useMemo(() => (data?.outlets ?? []).filter((o) => o.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <Dialog open={!!tier} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tier === "premium" ? "Premium" : "Wire"} distribution: every outlet</DialogTitle>
          <DialogDescription>The wire's 2026 U.S. {tier === "premium" ? "Premium" : "Budget"} list, as published. Some publications exercise editorial discretion over what they post.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search outlets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search outlets" />
        <div className="max-h-[55vh] overflow-y-auto rounded-md border p-2 text-sm">
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

function Reach({ counts, onOpen }: { counts: Record<PressTier, number>; onOpen: (t: PressTier) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="press-reach">
      {(["premium", "budget"] as PressTier[]).map((t) => (
        <div key={t} className={`rounded-2xl p-5 text-white ${t === "premium" ? "bg-gradient-to-br from-indigo-700 to-violet-900" : "bg-gradient-to-br from-slate-700 to-slate-900"}`}>
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-white/70">{tierWord(t)} distribution</div>
            <div className="text-2xl font-black">{n(counts[t])}+ outlets</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESS_HEADLINE_OUTLETS[t].map((o) => <span key={o} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{o}</span>)}
          </div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => onOpen(t)} data-testid={`press-outlets-${t}`}>See every outlet</Button>
        </div>
      ))}
    </div>
  );
}

function ReleasePreview({ text }: { text: PressReleaseText }) {
  return (
    <article className="rounded-xl border bg-white p-6 font-serif text-[15px] leading-relaxed text-slate-900 shadow-inner dark:bg-slate-50" data-testid="press-preview">
      <h3 className="font-sans text-2xl font-black leading-tight">{text.headline}</h3>
      {text.subheadline && <p className="mt-1 font-sans text-base italic text-slate-600">{text.subheadline}</p>}
      <div className="mt-4 whitespace-pre-wrap"><strong>{text.dateline}</strong> {text.body}</div>
      {text.boilerplate && <div className="mt-4 whitespace-pre-wrap border-t pt-3 text-sm">{text.boilerplate}</div>}
      {text.mediaContact && <div className="mt-4 whitespace-pre-wrap text-sm"><strong className="font-sans">Media Contact</strong>{"\n"}{text.mediaContact}</div>}
    </article>
  );
}

function Issues({ issues }: { issues: PressGuidelineIssue[] }) {
  if (!issues.length) return <div className="flex items-center gap-2 text-sm text-emerald-700" data-testid="press-issues-none"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Passes every guideline check we can run. The wire's editors have the final say.</div>;
  return (
    <ul className="space-y-1.5 text-sm" data-testid="press-issues">
      {issues.map((i, k) => (
        <li key={k} className={`flex gap-2 rounded-md px-2 py-1.5 ${i.blocking ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          {i.blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span><strong>{i.rule}.</strong> {i.detail}{i.blocking ? " (must be fixed)" : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="font-semibold">{label}</span>{hint && <span className="ml-1 text-xs text-muted-foreground">{hint}</span>}<div className="mt-1">{children}</div></label>;
}

/** The writer: facts → draft → edits → approve. One release at a time. */
function Writer({ release, credits, setup, onClose }: { release: PressReleaseView | null; credits: Record<PressTier, number>; setup: Overview["setup"]; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tier, setTier] = useState<PressTier>(release?.tier ?? (credits.premium > 0 && credits.budget === 0 ? "premium" : "budget"));
  const [input, setInput] = useState<PressReleaseInput>(release?.input ?? EMPTY_INPUT);
  const [text, setText] = useState<PressReleaseText | null>(release?.text ?? null);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState<PressReleaseView | null>(release);
  const set = (k: keyof PressReleaseInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput((v) => ({ ...v, [k]: e.target.value }));
  const editable = !row || ["draft", "changes_requested"].includes(row.status);

  const save = useMutation({
    mutationFn: async (): Promise<PressReleaseView> => {
      if (!row) return (await apiRequest("POST", "/api/press/releases", { tier, input })).json();
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
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-orange-500" aria-hidden="true" />{row ? `${row.code} · ${PRESS_STATUS_LABELS[row.status]}` : "Write a press release"}</DialogTitle>
          <DialogDescription>{row ? PRESS_STATUS_HELP[row.status] : "Give the facts. The writer drafts a release to the wire's editorial rules; you read it, change anything, and approve. Nothing is sent, and no credit is used, until you approve."}</DialogDescription>
        </DialogHeader>

        {row?.status === "changes_requested" && row.wireNotes && (
          <Notice tone="warning" title="The editors asked for changes">
            <div className="whitespace-pre-wrap text-sm">{row.wireNotes}</div>
            <div className="mt-1 text-xs">The draft below was already revised for these points. Read it and approve to send it back; no extra credit is used.</div>
          </Notice>
        )}
        {row?.liveUrl && <Notice tone="success" title="Live on the wire"><a className="underline" href={row.liveUrl} target="_blank" rel="noreferrer">{row.liveUrl}</a></Notice>}
        {row?.report && (
          <Notice tone="info" title="Distribution report">
            <div className="text-sm">{row.report.summary}</div>
            <div className="mt-1 flex flex-wrap gap-3 text-sm font-semibold">
              {row.report.outlets != null && <span>{n(row.report.outlets)} outlets</span>}{row.report.views != null && <span>{n(row.report.views)} views</span>}{row.report.clicks != null && <span>{n(row.report.clicks)} clicks</span>}
            </div>
            {row.report.attachments.length > 0 && <div className="mt-1 text-sm">{row.report.attachments.map((a) => <a key={a.url} className="mr-3 underline" href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}</div>}
          </Notice>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            {!row && (
              <div className="flex gap-2" role="radiogroup" aria-label="Distribution">
                {(["budget", "premium"] as PressTier[]).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tier === t} onClick={() => setTier(t)} className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm ${tier === t ? "border-orange-600 bg-orange-50 dark:bg-orange-950/40" : "border-border"}`} data-testid={`press-writer-tier-${t}`}>
                    <div className="font-bold">{tierWord(t)}</div>
                    <div className="text-xs text-muted-foreground">{credits[t]} credit{credits[t] === 1 ? "" : "s"} left</div>
                  </button>
                ))}
              </div>
            )}
            {noCredit && <Notice tone="warning" title={`No ${tierWord(tier)} credit`}>Pick a package above first. You can still fill in the facts now.</Notice>}
            <Field label="What kind of news is it?">
              <Select value={input.newsType} onValueChange={(v) => setInput((x) => ({ ...x, newsType: v as PressReleaseInput["newsType"] }))} disabled={!editable}>
                <SelectTrigger data-testid="press-news-type"><SelectValue /></SelectTrigger>
                <SelectContent>{PRESS_NEWS_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name"><Input value={input.companyName} onChange={set("companyName")} disabled={!editable} data-testid="press-company" /></Field>
              <Field label="Website" hint="https://…"><Input value={input.website} onChange={set("website")} disabled={!editable} /></Field>
              <Field label="City"><Input value={input.city} onChange={set("city")} disabled={!editable} /></Field>
              <Field label="State" hint="e.g. WA"><Input value={input.state} onChange={set("state")} disabled={!editable} /></Field>
            </div>
            <Field label="What happened?" hint="Plain words. Dates, numbers, names and places you want in the release. Only these facts are used.">
              <Textarea rows={7} value={input.details} onChange={set("details")} disabled={!editable} placeholder="We opened a second crew for roof repairs on November 1. Repair requests doubled after the February and September storms…" data-testid="press-details" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Spokesperson" hint="who is quoted"><Input value={input.spokesperson} onChange={set("spokesperson")} disabled={!editable} placeholder="Dana Ortiz" /></Field>
              <Field label="Their title"><Input value={input.spokespersonTitle} onChange={set("spokespersonTitle")} disabled={!editable} placeholder="Owner" /></Field>
            </div>
            <Field label="What they want to say" hint="the writer shapes it into the quote"><Textarea rows={2} value={input.quoteNotes} onChange={set("quoteNotes")} disabled={!editable} /></Field>
            <Field label="About the company" hint="years in business, services, areas, licences — for the closing paragraph"><Textarea rows={3} value={input.about} onChange={set("about")} disabled={!editable} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Media contact name"><Input value={input.contactName} onChange={set("contactName")} disabled={!editable} /></Field>
              <Field label="Contact email" hint="required by the wire"><Input type="email" value={input.contactEmail} onChange={set("contactEmail")} disabled={!editable} data-testid="press-contact-email" /></Field>
              <Field label="Contact phone"><Input value={input.contactPhone} onChange={set("contactPhone")} disabled={!editable} /></Field>
            </div>
            <div>
              <div className="text-sm font-semibold">Photos <span className="text-xs font-normal text-muted-foreground">up to 6, sent with the release</span></div>
              <div className="mt-1 flex flex-wrap gap-2">
                {input.photos.map((p, i) => (
                  <div key={p.key || i} className="relative h-20 w-20 overflow-hidden rounded-md border">
                    <img src={p.url} alt={p.caption || `Photo ${i + 1}`} className="h-full w-full object-cover" />
                    {editable && <button type="button" className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-xs text-white" aria-label="Remove photo" onClick={() => setInput((v) => ({ ...v, photos: v.photos.filter((_, k) => k !== i) }))}>×</button>}
                  </div>
                ))}
                {editable && input.photos.length < 6 && setup.photos && (
                  <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted">
                    {upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" aria-hidden="true" />}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ""; }} data-testid="press-photo-input" />
                    <span className="sr-only">Add photos</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
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
                {editable && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-sm font-semibold">Want it different?</div>
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shorter. Lead with the storm damage. Mention the free estimates in the first paragraph." data-testid="press-notes" />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => draft.mutate()} disabled={busy || !setup.ai} data-testid="press-rewrite">{draft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />} Rewrite</Button>
                      {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>Edit the text myself</Button>}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-5 text-center">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <div className="mt-2 font-semibold">Your draft shows here</div>
                <div className="text-sm text-muted-foreground">Fill in the facts on the left, then press Write it.</div>
              </div>
            )}
          </div>
        </div>

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => save.mutate()} disabled={busy}>Save draft</Button>
              {row && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancel.mutate()} disabled={busy}>Cancel release</Button>}
            </div>
            <div className="flex gap-2">
              {noCredit ? (
                <Button className="bg-orange-600 font-bold hover:bg-orange-700" onClick={() => { onClose(); navigate("/press-releases#packages"); }}>Pick a package</Button>
              ) : !text ? (
                <Button className="bg-orange-600 font-bold hover:bg-orange-700" onClick={() => draft.mutate()} disabled={busy || !setup.ai || input.details.length < 80} data-testid="press-write">{draft.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Writing…</> : <><Sparkles className="mr-1 h-4 w-4" aria-hidden="true" /> Write it</>}</Button>
              ) : (
                <Button className="bg-emerald-600 font-bold hover:bg-emerald-700" onClick={() => approve.mutate()} disabled={busy || editing || (row?.issues ?? []).some((i) => i.blocking)} data-testid="press-approve">{approve.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" aria-hidden="true" />} Approve &amp; send to the wire{row?.orderId ? "" : " (1 credit)"}</Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Timeline({ releases, onOpen }: { releases: PressReleaseView[]; onOpen: (r: PressReleaseView) => void }) {
  if (!releases.length) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-xl border border-dashed p-6">
          <div className="text-lg font-black">No releases yet</div>
          <p className="mt-1 text-sm text-muted-foreground">Here is the kind of release the writer produces from a few sentences about your news. Yours uses your company, your facts and your quote; nothing is invented.</p>
          <ol className="mt-4 space-y-2 text-sm">
            {["Pick a package", "Tell us what happened (and add photos)", "Read the draft, change anything, approve", "The wire's editors review it, usually within a business day", "You get the live link, then the distribution report, by email"].map((s, i) => <li key={s} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-[11px] font-black text-white">{i + 1}</span>{s}</li>)}
          </ol>
        </div>
        <div><div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Sample</div><ReleasePreview text={SAMPLE} /></div>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-xl border" data-testid="press-releases-list">
      {releases.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 hover:bg-muted/40">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(r)} data-testid={`press-release-${r.id}`}>
            <div className="truncate font-semibold">{r.text?.headline ?? `${r.input.companyName}: ${PRESS_NEWS_TYPES.find((t) => t.key === r.input.newsType)?.label ?? "release"}`}</div>
            <div className="text-xs text-muted-foreground">{r.code} · {tierWord(r.tier)} · {new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{r.liveAt ? ` · live ${new Date(r.liveAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</div>
          </button>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONE[r.status]}`} title={PRESS_STATUS_HELP[r.status]}>{PRESS_STATUS_LABELS[r.status]}</span>
          {r.liveUrl && <a className="text-xs font-semibold text-orange-600 underline" href={r.liveUrl} target="_blank" rel="noreferrer">Read it</a>}
          {r.status === "changes_requested" && <Badge variant="destructive">Action needed</Badge>}
        </li>
      ))}
    </ul>
  );
}

export default function PressReleasesPage() {
  const { toast } = useToast();
  const [location] = useLocation();
  const { data, isLoading, error } = useQuery<Overview>({ queryKey: ["/api/press/overview"], queryFn: () => getJson("/api/press/overview"), refetchInterval: 30_000 });
  const [outletsTier, setOutletsTier] = useState<PressTier | null>(null);
  const [writer, setWriter] = useState<{ open: boolean; release: PressReleaseView | null }>({ open: false, release: null });
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => { document.title = "Press Releases | ConstructHUB"; }, []);
  // Back from Stripe (?paid=<order>) or an email link (?release=<id>).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("paid")) { toast({ title: "Package bought", description: "Your credits are ready. Write your first release." }); window.history.replaceState({}, "", "/press-releases"); void refresh(); }
    if (q.get("canceled")) { window.history.replaceState({}, "", "/press-releases"); }
  }, [toast]);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("release"));
    const r = data?.releases.find((x) => x.id === id);
    if (r && !writer.open) { setWriter({ open: true, release: r }); window.history.replaceState({}, "", "/press-releases"); }
  }, [data, writer.open]);

  const buy = useMutation({
    mutationFn: async ({ key, tier }: { key: string; tier: PressTier }) => { setBuying(key); return (await apiRequest("POST", "/api/press/orders", { packageKey: key, tier })).json() as Promise<{ url: string }>; },
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => { setBuying(null); toast({ title: "Couldn't open checkout", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  const credits = data?.credits ?? { budget: 0, premium: 0 };
  const totalCredits = credits.budget + credits.premium;
  const last = data?.pacing.lastSubmittedAt ? new Date(data.pacing.lastSubmittedAt) : null;
  const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
  const active = (data?.releases ?? []).filter((r) => r.status !== "cancelled");

  return (
    <AppPage width="wide" testId="page-press-releases">
      <PageHeader
        title={<span className="flex items-center gap-2">Press Releases <HelpButton k="press-releases" /></span>}
        icon={Newspaper}
        accent="orange"
        description="Your news on the national wire: written for you, reviewed by editors, reported back to you."
        meta={totalCredits > 0 ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800" data-testid="press-credits">{totalCredits} credit{totalCredits === 1 ? "" : "s"} ready</span> : null}
        actions={<Button className="bg-orange-600 font-bold hover:bg-orange-700" onClick={() => setWriter({ open: true, release: null })} disabled={isLoading} data-testid="press-new"><Sparkles className="mr-1 h-4 w-4" aria-hidden="true" /> Write a release</Button>}
      />
      {error && <Notice tone="danger" title="Could not load">{apiErrorMessage(error)}</Notice>}
      <div className="space-y-8">
        <Hero counts={data?.outletCounts ?? { budget: 336, premium: 5221 }} />

        <Section id="packages" title="Pick a package" description={`Every release is written to the wire's editorial guidelines, sent with your photos, and reported back. Buy ${PRESS_PROGRAM_PAID} and get ${PRESS_PROGRAM_CREDITS}.`} icon={Rocket}>
          <Packages credits={credits} onBuy={(key, tier) => buy.mutate({ key, tier })} buying={buying} />
          <p className="mt-3 text-xs text-muted-foreground">Credits are good for 12 months. One release a month is the cadence that keeps a company in the news; the program schedules it. A release the editors refuse for breaking the content rules is not refunded by the wire, which is why the writer checks every draft against those rules before you approve it.</p>
        </Section>

        <Section title="Where it runs" description="The wire's published U.S. distribution lists. Some publications exercise editorial discretion over what they post." icon={Globe2}>
          <Reach counts={data?.outletCounts ?? { budget: 336, premium: 5221 }} onOpen={setOutletsTier} />
        </Section>

        <Section
          title="Your releases"
          description={daysSince != null && daysSince < (data?.pacing.recommendedGapDays ?? 28) && totalCredits > 0 ? `Last one went out ${daysSince} day${daysSince === 1 ? "" : "s"} ago. For the best results, space releases about a month apart.` : "Each release's status, its live link and its report. Click one to open it."}
          icon={Clock}
          actions={active.length > 0 ? <Button size="sm" variant="outline" onClick={() => setWriter({ open: true, release: null })}>New release</Button> : null}
        >
          {isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : <Timeline releases={active} onOpen={(r) => setWriter({ open: true, release: r })} />}
        </Section>

        {(data?.orders.length ?? 0) > 0 && (
          <Section title="Your packages" icon={Trophy}>
            <ul className="divide-y rounded-xl border text-sm">
              {data!.orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="font-semibold">{o.packageName} · {tierWord(o.tier)}</span>
                  <span className="text-muted-foreground">{o.status === "paid" ? `${o.creditsLeft} of ${o.credits} left${o.expiresAt ? ` · good until ${new Date(o.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}` : "Awaiting payment"}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <OutletsDialog tier={outletsTier} onClose={() => setOutletsTier(null)} />
      {writer.open && data && <Writer release={writer.release} credits={credits} setup={data.setup} onClose={() => setWriter({ open: false, release: null })} />}
      <span className="sr-only">{location}</span>
    </AppPage>
  );
}
