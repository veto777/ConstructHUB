/**
 * /admin/backlinks — the Backlinks database (prototype, shared/backlinks.ts): every site a contractor's link
 * could come from, found by search or import, read and graded by our crawler, measured for authority, and
 * pitched once an admin approves the draft. Progress is measured against the owner's goal: sell packages at
 * 5,000 quality (A/B) sources, aim for 10,000.
 *
 * Platform admins only (403 to anyone else; the second factor is handled like /admin/issues). Nothing here is
 * shown to customers.
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format } from "date-fns";
import { CheckCircle2, ExternalLink, Link2, Loader2, Lock, Mail, Play, RotateCcw, Upload } from "lucide-react";
import {
  BACKLINK_ADMIN_STATUSES, BACKLINK_KINDS, BACKLINK_KIND_LABELS, BACKLINK_STATUSES, BACKLINK_STATUS_LABELS, BACKLINK_TIERS, PBN_POLICY, ANCHOR_POLICY,
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
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
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
        <SelectTrigger className="w-56" data-testid="select-backlinks-import-kind"><SelectValue /></SelectTrigger>
        <SelectContent>{BACKLINK_KINDS.filter((k) => k !== "pbn").map((k) => <SelectItem key={k} value={k}>{BACKLINK_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"One domain or URL per line\nexample-home-blog.com\nhttps://example-news.com/write-for-us"} data-testid="input-backlinks-import" />
      <Button size="sm" disabled={!lines.trim() || imp.isPending} onClick={() => imp.mutate()} data-testid="button-backlinks-import">
        {imp.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}Import
      </Button>
    </div>
  );
}

function SourceSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: s, isLoading } = useQuery<BacklinkSource>({
    queryKey: ["/api/admin/backlinks/sources", String(id)], enabled: id !== null, queryFn: () => getJson(`/api/admin/backlinks/sources/${id}`),
  });
  const refresh = () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/backlinks") });
  const [price, setPrice] = useState("");
  const setStatus = useMutation({
    mutationFn: async (status: string) => (await apiRequest("POST", `/api/admin/backlinks/sources/${id}/status`, {
      status, ...(price.trim() ? { priceUsd: Number(price) } : {}),
    })).json(),
    onSuccess: () => { setPrice(""); refresh(); },
    onError: (e) => toast({ title: "Could not update", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const recheck = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/backlinks/sources/${id}/recheck`, {})).json(),
    onSuccess: () => { toast({ title: "Queued for vetting" }); refresh(); },
    onError: (e) => toast({ title: "Could not re-check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: async (oid: number) => (await apiRequest("POST", `/api/admin/backlinks/outreach/${oid}/approve`, {})).json(),
    onSuccess: () => { toast({ title: "Approved", description: "It is sent when sending is switched on." }); refresh(); },
    onError: (e) => toast({ title: "Could not approve", description: apiErrorMessage(e), variant: "destructive" }),
  });
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
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[s.status]}>{BACKLINK_STATUS_LABELS[s.status]}</StatusPill>
              {s.tier && <StatusPill tone={TIER_TONE[s.tier]}>Tier {s.tier}{s.score != null ? ` · ${s.score}` : ""}</StatusPill>}
              <StatusPill tone="neutral" dot={false}>Links: {s.linkType}</StatusPill>
              {s.metrics?.rank != null && <StatusPill tone="neutral" dot={false}>Rank {s.metrics.rank}/1000</StatusPill>}
            </div>
            {s.kind === "pbn" && <Notice tone="warning" title="Blocked">{PBN_POLICY}</Notice>}
            <div>
              <h3 className="mb-1 text-sm font-semibold">Why this grade</h3>
              <ul className="space-y-0.5 text-sm text-muted-foreground">{s.reasons.length ? s.reasons.map((r) => <li key={r}>{r}</li>) : <li>Not vetted yet.</li>}</ul>
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
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Set status</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="w-32" inputMode="decimal" placeholder="Price $ (opt.)" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} data-testid="input-backlink-price" />
                {BACKLINK_ADMIN_STATUSES.filter((x) => x !== s.status).map((x) => (
                  <Button key={x} size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate(x)} data-testid={`button-backlink-status-${x}`}>{BACKLINK_STATUS_LABELS[x]}</Button>
                ))}
                <Button size="sm" variant="ghost" disabled={recheck.isPending || s.status === "vetting"} onClick={() => recheck.mutate()} data-testid="button-backlink-recheck"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Re-check</Button>
              </div>
              {s.priceUsd != null && <p className="text-sm text-muted-foreground">Agreed price: ${s.priceUsd}{s.turnaroundDays != null ? ` · ${s.turnaroundDays} days` : ""}</p>}
            </div>
            {s.outreach.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Outreach</h3>
                <p className="text-xs text-muted-foreground">{ANCHOR_POLICY}</p>
                {s.outreach.map((o) => (
                  <div key={o.id} className="rounded-lg border p-3 text-sm" data-testid={`outreach-${o.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0" />{o.toEmail}</span>
                      <StatusPill tone={o.status === "draft" ? "warning" : o.status === "sent" ? "success" : "info"}>{o.status}</StatusPill>
                    </div>
                    <p className="mt-2 font-medium">{o.subject}</p>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-muted-foreground">{o.body}</pre>
                    {o.status === "draft" && (
                      <Button size="sm" className="mt-2" disabled={approve.isPending} onClick={() => approve.mutate(o.id)} data-testid={`button-outreach-approve-${o.id}`}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div>
              <h3 className="mb-1 text-sm font-semibold">History</h3>
              <ul className="space-y-0.5 text-xs text-muted-foreground">{s.events.map((e, i) => <li key={i}>{format(new Date(e.at), "MMM d, h:mm a")} — {e.type.replace(/_/g, " ")}</li>)}</ul>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AdminBacklinksPage() {
  useDocumentTitle("Backlinks | ConstructHUB");
  const [kind, setKind] = useState<string>("all");
  const [status, setStatusFilter] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: s, error, isLoading, refetch } = useQuery<BacklinkSummary>({
    queryKey: ["/api/admin/backlinks/summary"], queryFn: () => getJson("/api/admin/backlinks/summary"),
    refetchInterval: (qq) => (qq.state.data ? 60_000 : false),
  });
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (kind !== "all") params.set("kind", kind);
  if (status !== "all") params.set("status", status);
  if (tier === "quality") params.set("quality", "1"); else if (tier !== "all") params.set("tier", tier);
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
    setKind(next); setTier("all"); setStatusFilter("all"); setQ(""); setPage(0);
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

        <Section title="Sources" icon={Link2} id="backlinks-sources">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input className="w-48" placeholder="Search domain" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="input-backlinks-search" />
            <Select value={kind} onValueChange={filter(setKind)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All kinds</SelectItem>{BACKLINK_KINDS.map((k) => <SelectItem key={k} value={k}>{BACKLINK_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={tier} onValueChange={filter(setTier)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All tiers</SelectItem><SelectItem value="quality">Quality (A+B)</SelectItem>{BACKLINK_TIERS.map((t) => <SelectItem key={t} value={t}>Tier {t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={filter(setStatusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All statuses</SelectItem>{BACKLINK_STATUSES.map((x) => <SelectItem key={x} value={x}>{BACKLINK_STATUS_LABELS[x]} ({n(s.byStatus[x])})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="divide-y rounded-lg border" data-testid="list-backlink-sources">
            {(list?.rows ?? []).map((r) => (
              <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50" data-testid={`row-backlink-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.domain}</div>
                  <div className="truncate text-xs text-muted-foreground">{BACKLINK_KIND_LABELS[r.kind]}{r.niches.length ? ` · ${r.niches.slice(0, 3).join(", ")}` : ""}{r.contactEmails.length ? " · has email" : ""}</div>
                </div>
                {r.rank != null && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">rank {r.rank}</span>}
                {r.tier && <StatusPill tone={TIER_TONE[r.tier]} dot={false}>{r.tier}{r.score != null ? ` ${r.score}` : ""}</StatusPill>}
                <StatusPill tone={STATUS_TONE[r.status]}>{BACKLINK_STATUS_LABELS[r.status]}</StatusPill>
              </button>
            ))}
            {list && !list.rows.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No sources match. Run a search or import a list.</p>}
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
      <SourceSheet id={openId} onClose={() => setOpenId(null)} />
    </AppPage>
  );
}
