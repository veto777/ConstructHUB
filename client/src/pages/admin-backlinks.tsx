/**
 * /admin/backlinks — the Backlinks database (prototype, shared/backlinks.ts): every site a contractor's link
 * could come from, found by search or import, read and graded by our crawler, measured for authority, and
 * pitched once an admin approves the draft. Progress is measured against the owner's goal: sell packages at
 * 5,000 quality (A/B) sources, aim for 10,000.
 *
 * Platform admins only (403 to anyone else; the second factor is handled like /admin/issues). Nothing here is
 * shown to customers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format } from "date-fns";
import { ArrowDown, Ban, CheckCircle2, ExternalLink, Link2, Loader2, Lock, Mail, Maximize2, Play, RotateCcw, Upload, X, XCircle } from "lucide-react";
import {
  BACKLINK_ADMIN_STATUSES, BACKLINK_KINDS, BACKLINK_KIND_LABELS, BACKLINK_STATUSES, BACKLINK_STATUS_LABELS, BACKLINK_TIERS, PBN_POLICY, ANCHOR_POLICY, toDr, reasonWithDr,
  type BacklinkKind, type BacklinkSource, type BacklinkSourceRow, type BacklinkStatus, type BacklinkSummary,
} from "@shared/backlinks";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { appPageTitle } from "@/lib/page-titles";
import { VerificationCancelled } from "@/components/recent-auth";

type ListPayload = { rows: BacklinkSourceRow[]; total: number };
const PAGE = 50;

const TIER_TONE: Record<string, PillTone> = { A: "success", B: "teal", C: "warning", X: "danger" };
const STATUS_TONE: Record<BacklinkStatus, PillTone> = {
  discovered: "neutral", vetting: "info", qualified: "success", rejected: "danger", contacted: "info", replied: "violet",
  agreed: "teal", active: "success", do_not_contact: "neutral",
};
const n = (v: number) => v.toLocaleString("en-US");
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}

function GoalCard({ s }: { s: BacklinkSummary }) {
  const pct = Math.min(100, (s.quality / s.goal.target) * 100);
  const toSell = Math.max(0, s.goal.sell - s.quality);
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="card-backlinks-goal">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Quality sources (tier A or B)</div>
          <div className="text-3xl font-semibold tabular-nums">{n(s.quality)} <span className="text-base font-normal text-muted-foreground">of {n(s.goal.target)}</span></div>
        </div>
        <div className="text-sm text-muted-foreground">
          {toSell > 0 ? <>{n(toSell)} more before packages go on sale ({n(s.goal.sell)})</> : <span className="font-medium text-primary">Ready to sell packages</span>}
        </div>
      </div>
      <div className="relative mt-3">
        <Progress value={pct} aria-label="Progress to the goal" />
        <span className="absolute top-0 h-2 w-0.5 bg-foreground/60" style={{ left: `${(s.goal.sell / s.goal.target) * 100}%` }} title={`Sell at ${n(s.goal.sell)}`} />
      </div>
    </div>
  );
}

function ConfigNotice({ s }: { s: BacklinkSummary }) {
  const missing: string[] = [];
  if (!s.config.dataSource) missing.push("search and authority data are not connected (the SEO data login in the server .env) — only imports and vetting run");
  if (!s.config.worker) missing.push("automation is off (BACKLINKS_WORKER_ENABLED=true turns it on) — use the Run buttons");
  if (!s.config.outreachSend) missing.push("sending is off — approved pitches wait (needs a separate outreach mailbox and a postal address)");
  if (!missing.length) return null;
  return (
    <Notice tone="info" title="Prototype settings" testId="notice-backlinks-config">
      <ul className="list-disc space-y-0.5 pl-4">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
    </Notice>
  );
}

function RunButtons() {
  const { toast } = useToast();
  const run = useMutation({
    mutationFn: async (step: string) => (await apiRequest("POST", "/api/admin/backlinks/run", { step })).json(),
    onSuccess: (r: any, step) => {
      toast({ title: `Ran: ${step}`, description: Object.entries(r).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${typeof v === "number" ? Math.round(v * 100) / 100 : v}`).join(" · ") });
      void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/backlinks") });
    },
    onError: (e) => toast({ title: "Could not run that step", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const steps: [string, string][] = [["discover", "Search (5 queries)"], ["vet", "Vet 25"], ["measure", "Measure authority"], ["draft", "Draft pitches"]];
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map(([step, label]) => (
        <Button key={step} size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(step)} data-testid={`button-backlinks-run-${step}`}>
          {run.isPending && run.variables === step ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}{label}
        </Button>
      ))}
    </div>
  );
}

function ImportBox() {
  const { toast } = useToast();
  const [kind, setKind] = useState<BacklinkKind>("guest_post");
  const [lines, setLines] = useState("");
  const imp = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/backlinks/import", { kind, lines })).json(),
    onSuccess: (r: { read: number; added: number; alreadyKnown: number }) => {
      toast({ title: `${n(r.added)} new sites added`, description: `${n(r.read)} read · ${n(r.alreadyKnown)} already in the database. They are vetted next.` });
      setLines("");
      void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/backlinks") });
    },
    onError: (e) => toast({ title: "Import failed", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="space-y-2" data-testid="form-backlinks-import">
      <Select value={kind} onValueChange={(v) => setKind(v as BacklinkKind)}>
        <SelectTrigger className="w-56" aria-label="Kind of source" data-testid="select-backlinks-import-kind"><SelectValue /></SelectTrigger>
        <SelectContent>{BACKLINK_KINDS.filter((k) => k !== "pbn").map((k) => <SelectItem key={k} value={k}>{BACKLINK_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Textarea rows={5} aria-label="Domains or URLs to import" value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"One domain or URL per line\nexample-home-blog.com\nhttps://example-news.com/write-for-us"} data-testid="input-backlinks-import" />
      <Button size="sm" disabled={!lines.trim() || imp.isPending} onClick={() => imp.mutate()} data-testid="button-backlinks-import">
        {imp.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}Import
      </Button>
    </div>
  );
}

const refreshBacklinks = () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/backlinks") });
const sourceKey = (id: number | null) => ["/api/admin/backlinks/sources", String(id)];
const useSource = (id: number | null, enabled = true) => useQuery<BacklinkSource>({
  queryKey: sourceKey(id), enabled: id !== null && enabled, queryFn: () => getJson(`/api/admin/backlinks/sources/${id}`),
});

/** What Approve does, in the owner's words (2026-10-25: "what does it approve exactly?"). */
function approveHelp(sendingOn: boolean) {
  return sendingOn
    ? "Approve queues this exact email. The worker sends approved emails from the outreach mailbox, up to the daily cap, and the site moves to Contacted."
    : "Approve queues this exact email; nothing is sent yet. Sending is off until the separate outreach mailbox and the postal address are set. Then approved emails go out from that mailbox, up to 30 a day, and the site moves to Contacted.";
}

/** The status and approve actions for one source. `onDone` runs after a change succeeds (review mode moves on). */
function useSourceActions(id: number | null, onDone?: (what: string) => void) {
  const { toast } = useToast();
  const setStatus = useMutation({
    mutationFn: async (v: { status: string; priceUsd?: number }) => (await apiRequest("POST", `/api/admin/backlinks/sources/${id}/status`, v)).json(),
    onSuccess: (_r, v) => { refreshBacklinks(); onDone?.(BACKLINK_STATUS_LABELS[v.status as BacklinkStatus] ?? v.status); },
    onError: (e) => toast({ title: "Could not update", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const recheck = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/backlinks/sources/${id}/recheck`, {})).json(),
    onSuccess: () => { toast({ title: "Queued for vetting" }); refreshBacklinks(); },
    onError: (e) => toast({ title: "Could not re-check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async (oid: number) => (await apiRequest("POST", `/api/admin/backlinks/outreach/${oid}/approve`, {})).json(),
    onSuccess: () => { refreshBacklinks(); if (onDone) onDone("Email approved"); else toast({ title: "Email approved", description: "It is sent when sending is switched on." }); },
    onError: (e) => toast({ title: "Could not approve", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return { setStatus, recheck, approve, busy: setStatus.isPending || approve.isPending };
}

function SourceDetail({ s, sendingOn, actions }: { s: BacklinkSource; sendingOn: boolean; actions: ReturnType<typeof useSourceActions> }) {
  const [price, setPrice] = useState("");
  const { setStatus, recheck, approve } = actions;
  const set = (status: string) => { setStatus.mutate({ status, ...(price.trim() ? { priceUsd: Number(price) } : {}) }); setPrice(""); };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATUS_TONE[s.status]}>{BACKLINK_STATUS_LABELS[s.status]}</StatusPill>
        {s.tier && <StatusPill tone={TIER_TONE[s.tier]}>Tier {s.tier}{s.score != null ? ` · ${s.score}` : ""}</StatusPill>}
        <StatusPill tone="neutral" dot={false}>Links: {s.linkType}</StatusPill>
        {s.metrics?.rank != null && <StatusPill tone="neutral" dot={false}>DR {toDr(s.metrics.rank)}</StatusPill>}
      </div>
      {s.kind === "pbn" && <Notice tone="warning" title="Blocked">{PBN_POLICY}</Notice>}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Why this grade</h3>
        <ul className="space-y-0.5 text-sm text-muted-foreground">{s.reasons.length ? s.reasons.map((r) => <li key={r}>{reasonWithDr(r)}</li>) : <li>Not vetted yet.</li>}</ul>
      </div>
      {s.signals && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Page title</span><span className="truncate">{s.signals.title ?? "—"}</span>
          <span className="text-muted-foreground">Words</span><span>{n(s.signals.words)}</span>
          <span className="text-muted-foreground">Outbound links</span><span>{n(s.signals.outboundLinks)} ({s.signals.rel.dofollow} follow · {s.signals.rel.nofollow} nofollow · {s.signals.rel.sponsored} sponsored)</span>
          <span className="text-muted-foreground">Takes submissions</span><span>{s.signals.submissionHints.join(", ") || "not shown"}</span>
          <span className="text-muted-foreground">Contact</span>
          <span className="break-all">{s.contactEmails.join(", ") || (s.contactUrl ? <a className="underline" href={s.contactUrl} target="_blank" rel="noreferrer noopener">contact page</a> : "none published")}</span>
          {s.metrics && (<><span className="text-muted-foreground">Referring domains</span><span>{s.metrics.referringDomains ?? "—"} · spam {s.metrics.spamScore ?? "—"}/100</span>
            <span className="text-muted-foreground">Google visits / month</span><span>{s.metrics.organicTraffic == null ? "not measured" : `about ${n(Math.round(s.metrics.organicTraffic))}`}</span></>)}
        </div>
      )}
      {s.outreach.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Pitch email</h3>
          <p className="text-xs text-muted-foreground">{ANCHOR_POLICY}</p>
          {s.outreach.map((o) => (
            <div key={o.id} className="rounded-lg border p-3 text-sm" data-testid={`outreach-${o.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0" />{o.toEmail}</span>
                <StatusPill tone={o.status === "draft" ? "warning" : o.status === "sent" ? "success" : "info"}>{o.status === "draft" ? "Waiting for approval" : o.status === "approved" ? "Approved, not sent yet" : o.status}</StatusPill>
              </div>
              <p className="mt-2 font-medium">{o.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-muted-foreground">{o.body}</pre>
              {o.status === "draft" && (
                <div className="mt-2 space-y-1">
                  <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(o.id)} data-testid={`button-outreach-approve-${o.id}`}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve this email</Button>
                  <p className="text-xs text-muted-foreground" data-testid={`text-outreach-approve-help-${o.id}`}>{approveHelp(sendingOn)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Set status</h3>
        <p className="text-xs text-muted-foreground">Moves the site in the pipeline. It never sends an email.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-32" inputMode="decimal" aria-label="Price in dollars (optional)" placeholder="Price $ (opt.)" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} data-testid="input-backlink-price" />
          {BACKLINK_ADMIN_STATUSES.filter((x) => x !== s.status).map((x) => (
            <Button key={x} size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => set(x)} data-testid={`button-backlink-status-${x}`}>{BACKLINK_STATUS_LABELS[x]}</Button>
          ))}
          <Button size="sm" variant="ghost" disabled={recheck.isPending || s.status === "vetting"} onClick={() => recheck.mutate()} data-testid="button-backlink-recheck"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Re-check</Button>
        </div>
        {s.priceUsd != null && <p className="text-sm text-muted-foreground">Agreed price: ${s.priceUsd}{s.turnaroundDays != null ? ` · ${s.turnaroundDays} days` : ""}</p>}
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">History</h3>
        <ul className="space-y-0.5 text-xs text-muted-foreground">{s.events.map((e, i) => <li key={i}>{format(new Date(e.at), "MMM d, h:mm a")} — {e.type.replace(/_/g, " ")}</li>)}</ul>
      </div>
    </div>
  );
}

function SourceSheet({ id, sendingOn, onClose }: { id: number | null; sendingOn: boolean; onClose: () => void }) {
  const { data: s, isLoading } = useSource(id);
  const actions = useSourceActions(id);
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="sheet-backlink-source">
        {isLoading || !s ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" /> : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 break-all">
                {s.domain}
                <a href={`https://${s.domain}/`} target="_blank" rel="noreferrer noopener" aria-label="Open the site"><ExternalLink className="h-4 w-4 text-muted-foreground" /></a>
              </SheetTitle>
              <SheetDescription>{BACKLINK_KIND_LABELS[s.kind]} · found {ago(s.createdAt)}{s.discoveredVia ? ` by “${s.discoveredVia}”` : ""}</SheetDescription>
            </SheetHeader>
            <SourceDetail s={s} sendingOn={sendingOn} actions={actions} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const REVIEW_PAGE = 200;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** One full-screen slide in review mode. Details load only for the slide on screen and its neighbours. */
function ReviewSlide({ row, index, total, near, decided, sendingOn, slideRef }: {
  row: BacklinkSourceRow; index: number; total: number; near: boolean; decided: string | undefined; sendingOn: boolean; slideRef: (el: HTMLElement | null) => void;
}) {
  const { data: s } = useSource(row.id, near);
  const actions = useSourceActions(row.id);
  return (
    <section ref={slideRef} data-index={index} className="min-h-full snap-start border-b px-4 py-8 sm:px-8" data-testid={`review-slide-${row.id}`}>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 break-all text-2xl font-semibold">
            {row.domain}
            <a href={`https://${row.domain}/`} target="_blank" rel="noreferrer noopener" aria-label="Open the site"><ExternalLink className="h-4 w-4 text-muted-foreground" /></a>
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground">{n(index + 1)} of {n(total)}</span>
        </div>
        <p className="text-sm text-muted-foreground">{BACKLINK_KIND_LABELS[row.kind]}{row.niches.length ? ` · ${row.niches.slice(0, 3).join(", ")}` : ""}{s ? ` · found ${ago(s.createdAt)}${s.discoveredVia ? ` by “${s.discoveredVia}”` : ""}` : ""}</p>
        {decided && <Notice tone="success" title={`Done: ${decided}`} testId={`notice-review-decided-${row.id}`}>Scroll on, or change it below.</Notice>}
        {row.rejectReason && <p className="text-sm text-muted-foreground">Rejected: {reasonWithDr(row.rejectReason)}</p>}
        {s ? <SourceDetail s={s} sendingOn={sendingOn} actions={actions} /> : <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>
    </section>
  );
}

/**
 * Review mode (owner 2026-10-25: "a full screen where you scroll from potential to next one"): the current filter's
 * sources one per screen. The bar at the bottom decides the source on screen and moves to the next one.
 * Keys: ↓/J next · ↑/K back · A approve email · R reject · D do not contact · Esc close.
 */
function ReviewMode({ params, sendingOn, onClose }: { params: URLSearchParams; sendingOn: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const base = useMemo(() => { const p = new URLSearchParams(params); p.delete("offset"); p.set("limit", String(REVIEW_PAGE)); return p.toString(); }, [params]);
  // Its own key (not /api/admin/backlinks…) so a decision doesn't reshuffle the slides under the reader.
  const list = useInfiniteQuery<ListPayload>({
    queryKey: ["backlinks-review", base], initialPageParam: 0,
    queryFn: ({ pageParam }) => getJson(`/api/admin/backlinks/sources?${base}&offset=${pageParam}`),
    getNextPageParam: (last, all) => { const got = all.reduce((t, p) => t + p.rows.length, 0); return got < last.total && last.rows.length ? got : undefined; },
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const [current, setCurrent] = useState(0);
  const [decided, setDecided] = useState<Record<number, string>>({});
  const scroller = useRef<HTMLDivElement | null>(null);
  const slides = useRef<(HTMLElement | null)[]>([]);

  // The slide crossing the middle of the screen is the current one.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.index));
    }, { root, rootMargin: "-50% 0px -50% 0px" });
    slides.current.slice(0, rows.length).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [rows.length]);
  useEffect(() => {
    if (current >= rows.length - 10 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [current, rows.length, list]);

  const goTo = useCallback((i: number) => {
    const el = slides.current[Math.max(0, Math.min(i, rows.length - 1))];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [rows.length]);
  const row = rows[current] ?? null;
  const { data: s } = useSource(row?.id ?? null);
  const draft = s?.outreach.find((o) => o.status === "draft") ?? null;
  const done = useCallback((what: string) => {
    if (row) setDecided((d) => ({ ...d, [row.id]: what }));
    toast({ title: `${row?.domain ?? "Source"}: ${what}` });
    goTo(current + 1);
  }, [row, current, goTo, toast]);
  const actions = useSourceActions(row?.id ?? null, done);
  const act = useCallback((key: "approve" | "reject" | "dnc") => {
    if (!row || actions.busy) return;
    if (key === "approve") { if (draft) actions.approve.mutate(draft.id); }
    else actions.setStatus.mutate({ status: key === "reject" ? "rejected" : "do_not_contact" });
  }, [row, actions, draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") onClose();
      else if (k === "arrowdown" || k === "j") { e.preventDefault(); goTo(current + 1); }
      else if (k === "arrowup" || k === "k") { e.preventDefault(); goTo(current - 1); }
      else if (k === "a") act("approve");
      else if (k === "r") act("reject");
      else if (k === "d") act("dnc");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goTo, act, onClose]);
  useEffect(() => { const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Review sources" data-testid="review-backlinks">
      <div className="flex items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Review sources</div>
          <div className="truncate text-xs text-muted-foreground">{total ? `${n(Math.min(current + 1, total))} of ${n(total)}` : "Loading…"} · {Object.keys(decided).length} decided · ↓ next · ↑ back · A approve · R reject · D do not contact · Esc close</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close review" data-testid="button-review-close"><X className="h-4 w-4" /></Button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 snap-y snap-proximity overflow-y-auto" data-testid="review-scroller">
        {rows.map((r, i) => (
          <ReviewSlide key={r.id} row={r} index={i} total={total} near={Math.abs(i - current) <= 1} decided={decided[r.id]} sendingOn={sendingOn}
            slideRef={(el) => { slides.current[i] = el; }} />
        ))}
        {list.isFetchingNextPage && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading more" />}
        {list.data && !rows.length && <p className="px-4 py-20 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>}
        {list.data && rows.length > 0 && !list.hasNextPage && <p className="px-4 py-12 text-center text-sm text-muted-foreground">That's all {n(total)}. <button type="button" className="underline" onClick={onClose}>Close review</button></p>}
      </div>
      <div className="border-t bg-card px-4 py-3 sm:px-6" data-testid="review-decision-bar">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <Button disabled={!draft || actions.busy} onClick={() => act("approve")} title={approveHelp(sendingOn)} data-testid="button-review-approve">
            <CheckCircle2 className="mr-1.5 h-4 w-4" />{draft ? "Approve email" : "No email to approve"}<kbd className="ml-2 text-xs opacity-70">A</kbd>
          </Button>
          <Button variant="outline" disabled={!row || actions.busy || s?.status === "rejected"} onClick={() => act("reject")} data-testid="button-review-reject">
            <XCircle className="mr-1.5 h-4 w-4" />Reject site<kbd className="ml-2 text-xs opacity-70">R</kbd>
          </Button>
          <Button variant="outline" disabled={!row || actions.busy || s?.status === "do_not_contact"} onClick={() => act("dnc")} data-testid="button-review-dnc">
            <Ban className="mr-1.5 h-4 w-4" />Do not contact<kbd className="ml-2 text-xs opacity-70">D</kbd>
          </Button>
          <Button variant="ghost" disabled={current + 1 >= rows.length} onClick={() => goTo(current + 1)} data-testid="button-review-next">
            Skip<ArrowDown className="ml-1.5 h-4 w-4" />
          </Button>
          <p className="w-full text-xs text-muted-foreground">{draft ? approveHelp(sendingOn) : "Each choice saves and moves to the next site. Skip leaves this one as it is."}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminBacklinksPage() {
  useDocumentTitle(appPageTitle("/admin/backlinks")!);
  const [view, setView] = useState<"kept" | "rejected">("kept");
  const [kind, setKind] = useState<string>("all");
  const [status, setStatusFilter] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const { data: s, error, isLoading, refetch } = useQuery<BacklinkSummary>({
    queryKey: ["/api/admin/backlinks/summary"], queryFn: () => getJson("/api/admin/backlinks/summary"),
    refetchInterval: (qq) => (qq.state.data ? 60_000 : false),
  });
  const params = new URLSearchParams({ view, limit: String(PAGE), offset: String(page * PAGE) });
  if (kind !== "all") params.set("kind", kind);
  if (view === "kept" && status !== "all") params.set("status", status);
  if (view === "kept") { if (tier === "quality") params.set("quality", "1"); else if (tier !== "all") params.set("tier", tier); }
  if (q.trim()) params.set("q", q.trim());
  const listUrl = `/api/admin/backlinks/sources?${params}`;
  const { data: list } = useQuery<ListPayload>({ queryKey: [listUrl], queryFn: () => getJson(listUrl), enabled: !!s, placeholderData: keepPreviousData });
  const fail = useMemo(() => (error ? failure(error) : null), [error]);

  if (isLoading && !s) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!s && (error instanceof VerificationCancelled || fail?.body?.reauth === true)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-backlinks-verify">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Verify it's you</h1>
        <Button className="mt-4" onClick={() => void refetch()}>Verify identity</Button>
      </div>
    );
  }
  if (!s) {
    const forbidden = fail?.status === 401 || fail?.status === 403;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-backlinks-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{forbidden ? "Platform admins only" : "Couldn't load the backlinks database"}</h1>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE));
  const filter = (set: (v: string) => void) => (v: string) => { set(v); setPage(0); };
  // A tile is a list: clicking it shows every source of that kind (all tiers and statuses) in Sources below.
  const showList = (k: string) => {
    const next = kind === k ? "all" : k;
    setView("kept"); setKind(next); setTier("all"); setStatusFilter("all"); setQ(""); setPage(0);
    if (next !== "all") document.getElementById("backlinks-sources")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <AppPage testId="page-admin-backlinks">
      <GoogleSectionHeader as="h1" title="Backlinks database" count={s.total || null} description="Sites that can link to a contractor: found, vetted, measured and pitched automatically." flush />
      <div className="min-w-0 space-y-4">
        <ConfigNotice s={s} />
        <GoalCard s={s} />
        <StatGrid cols={4}>
          {BACKLINK_KINDS.filter((k) => k !== "pbn").map((k) => (
            <Stat key={k} label={BACKLINK_KIND_LABELS[k]} value={n(s.byKind[k].quality)} hint={`quality · ${n(s.byKind[k].total)} found`} testId={`stat-backlinks-${k}`}
              onClick={() => showList(k)} selected={kind === k} />
          ))}
          <Stat label="Blocked PBNs" value={n(s.byKind.pbn.total)} hint="never counted or sold" tone={s.byKind.pbn.total ? "bad" : "default"}
            onClick={() => showList("pbn")} selected={kind === "pbn"} testId="stat-backlinks-pbn" />
          <Stat label="This month's data spend" value={`$${s.spend.usd.toFixed(2)}`} hint={`cap $${s.spend.capUsd}`} />
          <Stat label="Searches run" value={`${n(s.queries.run)} / ${n(s.queries.total)}`} hint={`last ${ago(s.lastRunAt)}`} />
          <Stat label="Waiting to vet" value={n(s.byStatus.discovered + s.byStatus.vetting)} />
        </StatGrid>

        <Section title="Run now" description="The worker does these every minute when automation is on.">
          <RunButtons />
        </Section>

        <Section title="Sources" icon={Link2} id="backlinks-sources"
          actions={<Button size="sm" disabled={!list?.total} onClick={() => setReviewing(true)} data-testid="button-backlinks-review"><Maximize2 className="mr-1.5 h-3.5 w-3.5" />Review one by one{list?.total ? ` (${n(list.total)})` : ""}</Button>}>
          {/* Rejected sources (tier X) live on their own tab, each with the reason it was rejected. */}
          <Tabs value={view} onValueChange={(v) => { setView(v as "kept" | "rejected"); setTier("all"); setStatusFilter("all"); setPage(0); }} className="mb-3">
            <TabsList>
              <TabsTrigger value="kept" data-testid="tab-backlinks-kept">Kept ({n(s.total - s.byStatus.rejected)})</TabsTrigger>
              <TabsTrigger value="rejected" data-testid="tab-backlinks-rejected">Rejected ({n(s.byStatus.rejected)})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input className="w-48" aria-label="Search domain" placeholder="Search domain" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="input-backlinks-search" />
            <Select value={kind} onValueChange={filter(setKind)}>
              <SelectTrigger className="w-44" aria-label="Kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All kinds</SelectItem>{BACKLINK_KINDS.map((k) => <SelectItem key={k} value={k}>{BACKLINK_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
            {view === "kept" && <>
            <Select value={tier} onValueChange={filter(setTier)}>
              <SelectTrigger className="w-36" aria-label="Tier"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All tiers</SelectItem><SelectItem value="quality">Quality (A+B)</SelectItem>{BACKLINK_TIERS.filter((t) => t !== "X").map((t) => <SelectItem key={t} value={t}>Tier {t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={filter(setStatusFilter)}>
              <SelectTrigger className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All statuses</SelectItem>{BACKLINK_STATUSES.filter((x) => x !== "rejected").map((x) => <SelectItem key={x} value={x}>{BACKLINK_STATUS_LABELS[x]} ({n(s.byStatus[x])})</SelectItem>)}</SelectContent>
            </Select>
            </>}
          </div>
          <div className="divide-y rounded-lg border" data-testid="list-backlink-sources">
            {(list?.rows ?? []).map((r) => (
              <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50" data-testid={`row-backlink-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.domain}</div>
                  <div className="truncate text-xs text-muted-foreground">{BACKLINK_KIND_LABELS[r.kind]}{r.niches.length ? ` · ${r.niches.slice(0, 3).join(", ")}` : ""}{r.contactEmails.length ? " · has email" : ""}</div>
                  {r.rejectReason && <div className="truncate text-xs text-muted-foreground" data-testid={`text-backlink-reject-${r.id}`}>{reasonWithDr(r.rejectReason)}</div>}
                </div>
                {r.rank != null && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">DR {toDr(r.rank)}</span>}
                {r.tier && <StatusPill tone={TIER_TONE[r.tier]} dot={false}>{r.tier}{r.score != null ? ` ${r.score}` : ""}</StatusPill>}
                <StatusPill tone={STATUS_TONE[r.status]}>{BACKLINK_STATUS_LABELS[r.status]}</StatusPill>
              </button>
            ))}
            {list && !list.rows.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{view === "rejected" ? "No rejected sources match." : "No sources match. Run a search or import a list."}</p>}
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{n(list?.total ?? 0)} sources · page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Import a list" description="Domains or URLs you already have (one per line). They go through the same vetting; nothing is trusted unread.">
          <ImportBox />
        </Section>
      </div>
      <SourceSheet id={openId} sendingOn={s.config.outreachSend} onClose={() => setOpenId(null)} />
      {reviewing && <ReviewMode params={params} sendingOn={s.config.outreachSend} onClose={() => { setReviewing(false); refreshBacklinks(); }} />}
    </AppPage>
  );
}
