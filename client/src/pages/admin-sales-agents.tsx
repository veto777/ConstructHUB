import { AppPage, Notice } from "@/components/app-ui";
import { GoogleList, GooglePill, GoogleSectionHeader, GoogleStat, GoogleStatGrid } from "@/components/google";
/**
 * /admin/sales-agents (+ /admin/sales-agents/leads) — the console for the outbound AI sales callers
 * ("ch-sales", sales.constructhub.us): the campaign switch, the call stats, the voice library (which voices
 * are in the calling rotation, with a sample of each), the recent calls, and the leads the callers work
 * through (filters, search, CSV/JSON import, and how a scraper connects).
 *
 * Platform admins only: every /api/admin/sales-agents/* route is requirePlatformAdmin (server/sales-agents.ts),
 * which proxies to the engine with a token this page never sees. The admin second factor (403 reauth) is
 * handled by apiRequest, as on /admin/youtube. Voice samples are static files in /sales-voices/<id>.mp3.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Download, ExternalLink, FileUp, Loader2, Lock, Pause, Play, RefreshCw, Search } from "lucide-react";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { appPageTitle } from "@/lib/page-titles";
import { VerificationCancelled } from "@/components/recent-auth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chunk, parseLeadFile, type ParsedLeads } from "@/lib/sales-leads-import";
import { cn } from "@/lib/utils";

// ── API shapes (server/sales-agents.ts passes the engine's JSON through) ─────────────────────────────

type Engine = "kokoro" | "orpheus" | "qwen";
type Voice = {
  id: string; name: string; gender: string; engine: Engine; voice: string;
  active: boolean; usable: boolean; note: string; defaultActive: boolean; sample: string;
};
type Stats = {
  leads: Record<string, number>;
  outcomes: Record<string, number>;
  calls24h: number;
  minutes24h: number;
  dnc: number;
  followups_open: number;
  dialer: { running: boolean; lines: number; maxLines: number; changed: string; lastError: string };
};
type Call = {
  call_sid: string; started_at: number; direction: string; persona: string; outcome: string; duration_s: number;
  score: number | null; summary: string; business: string; phone: string; trade: string; city: string; state: string; link: string;
};
type Lead = {
  id: number; phone: string; business: string; contact_name: string; trade: string; city: string; state: string;
  website: string; email: string; source: string; linetype: string; status: string; attempts: number; outcome: string;
  created_at: number; updated_at: number;
};
type LeadsPage = { total: number; leads: Lead[]; facets: Record<string, Record<string, number>> };
type Config = { apiUrl: string; configured: boolean; maxBatch: number };
type ImportResult = { added: number; duplicates: number; invalid: number; on_dnc: number };

const BASE = "/api/admin/sales-agents";
const K = { config: `${BASE}/config`, stats: `${BASE}/stats`, voices: `${BASE}/voices`, calls: `${BASE}/calls`, leads: `${BASE}/leads` };
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();

function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────────

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const humanize = (s: string) => { const t = s.replace(/[_-]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const whenEt = (unix: number) => (unix ? `${ET.format(new Date(unix * 1000))} ET` : "—");
const duration = (s: number) => { const n = Math.max(0, Math.round(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
/** +18135550123 → (813) 555-0123; anything else as it came. */
const phoneFmt = (p: string) => { const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || ""); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || "—"; };
const place = (city: string, state: string) => [city, state].filter(Boolean).join(", ") || "—";

type Tone = "good" | "info" | "warn" | "bad" | "muted";
const TONE: Record<Tone, string> = {
  good: "!text-[var(--g-green)]",
  info: "!text-primary",
  warn: "!text-amber-700 dark:!text-amber-400",
  bad: "!text-[var(--g-red)]",
  muted: "",
};
const OUTCOME_TONE: Record<string, Tone> = {
  demo_booked: "good", trial_link: "good", send_info: "good", interested: "good",
  callback_later: "info",
  not_interested: "warn", hung_up: "warn", gatekeeper: "warn",
  do_not_call: "bad", wrong_number: "bad", failed: "bad",
  voicemail: "muted", "no-answer": "muted", busy: "warn", canceled: "muted", "in-progress": "info", completed: "muted",
};
const STATUS_TONE: Record<string, Tone> = { ready: "info", new: "info", calling: "good", hold_mobile: "warn", dnc: "bad", done: "muted" };

function Chip({ tone = "muted", children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return <span className={cn("g-chip g-chip--sm !normal-case whitespace-nowrap", TONE[tone])} data-testid={testId} title={title}>{children}</span>;
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────────────

export default function AdminSalesAgentsPage() {
  const [location, setLocation] = useLocation();
  const leadId = /^\/admin\/sales-agents\/leads\/(\d+)\/?$/.exec(location)?.[1] ?? null;
  const tab: "overview" | "leads" | "calllog" = location.startsWith("/admin/sales-agents/leads") ? "leads"
    : location.startsWith("/admin/sales-agents/call-log") ? "calllog" : "overview";
  useDocumentTitle(appPageTitle(leadId ? location : tab === "leads" ? "/admin/sales-agents/leads" : tab === "calllog" ? "/admin/sales-agents/call-log" : "/admin/sales-agents")!);
  const stats = useQuery<Stats>({ queryKey: [K.stats], queryFn: () => getJson<Stats>(K.stats), retry: false, refetchInterval: 30_000 });

  if (stats.isLoading && !stats.data) {
    return <AppPage testId="page-admin-sales-agents-loading"><div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /></div></AppPage>;
  }
  if (!stats.data) {
    const fail = failure(stats.error);
    const verify = stats.error instanceof VerificationCancelled || fail.body?.reauth === true;
    const forbidden = !verify && (fail.status === 401 || fail.status === 403);
    const notConfigured = fail.body?.code === "sales_agents_not_configured";
    return (
      <AppPage testId="page-admin-sales-agents-denied" width="narrow">
        <div className="py-12 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">
            {verify ? "Verify it's you" : forbidden ? "Platform admins only" : notConfigured ? "Sales engine not connected" : "Couldn't reach the sales engine"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {verify ? "Admin tools need a recent identity check." : forbidden ? "Only the people who run ConstructHUB can use Sales Agents." : apiErrorMessage(stats.error, "Try again in a moment.")}
          </p>
          {!forbidden && <GooglePill variant="solid" className="mt-4" label={verify ? "Verify identity" : "Try again"} onClick={() => void stats.refetch()} testId="button-sales-agents-retry" />}
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage testId="page-admin-sales-agents" width="wide">
      <CampaignHeader stats={stats.data} />
      <nav className="flex flex-wrap gap-2" aria-label="Sales Agents sections">
        <GooglePill label="Overview" selected={tab === "overview"} ariaPressed={tab === "overview"} onClick={() => setLocation("/admin/sales-agents")} testId="tab-sales-agents-overview" />
        <GooglePill label="Leads" selected={tab === "leads"} ariaPressed={tab === "leads"} onClick={() => setLocation("/admin/sales-agents/leads")} testId="tab-sales-agents-leads" />
        <GooglePill label="Call log" selected={tab === "calllog"} ariaPressed={tab === "calllog"} onClick={() => setLocation("/admin/sales-agents/call-log")} testId="tab-sales-agents-calllog" />
      </nav>
      {leadId ? (
        <LeadFile id={leadId} />
      ) : tab === "overview" ? (
        <>
          <StatTiles stats={stats.data} />
          <VoiceLibrary />
          <RecentCalls />
        </>
      ) : tab === "calllog" ? (
        <CallLog />
      ) : (
        <LeadsSection />
      )}
    </AppPage>
  );
}

// ── Campaign switch ──────────────────────────────────────────────────────────────────────────────────

function CampaignHeader({ stats }: { stats: Stats }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const d = stats.dialer;
  const campaign = useMutation({
    mutationFn: async (running: boolean) => (await apiRequest("POST", `${BASE}/campaign`, { running })).json(),
    onSuccess: (_r, running) => {
      void queryClient.invalidateQueries({ queryKey: [K.stats] });
      toast({ title: running ? "Campaign started" : "Campaign paused", description: running ? "The AI callers are dialing leads now." : "No new calls will be placed. Calls already in progress finish." });
    },
    onError: (e) => toast({ title: "Couldn't change the campaign", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <>
      <GoogleSectionHeader as="h1" title="Sales Agents" flush
        description="AI sales callers: campaign, voices, calls and leads."
        actions={<>
          <Chip tone={d.running ? "good" : "muted"} testId="badge-sales-campaign">
            {d.running ? `Running · ${d.lines}/${d.maxLines} lines` : "Paused"}
          </Chip>
          {d.running ? (
            <GooglePill icon={Pause} label={campaign.isPending ? "Pausing…" : "Pause"} disabled={campaign.isPending} onClick={() => campaign.mutate(false)} testId="button-sales-campaign-pause" />
          ) : (
            <GooglePill variant="solid" icon={Play} label={campaign.isPending ? "Starting…" : "Start campaign"} disabled={campaign.isPending} onClick={() => setConfirmOpen(true)} testId="button-sales-campaign-start" />
          )}
          <GooglePill variant="quiet" icon={RefreshCw} label="Refresh" ariaLabel="Refresh" onClick={() => void queryClient.invalidateQueries({ queryKey: [BASE], refetchType: "active", predicate: (q) => String(q.queryKey[0]).startsWith(BASE) })} testId="button-sales-refresh" />
        </>}
      />
      {d.lastError && (
        <Notice tone="danger" title="The dialer's last error" testId="notice-sales-last-error">
          <span className="break-words">{d.lastError}</span>
        </Notice>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start the campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts real outbound calls. The AI callers will dial leads that are ready, up to {d.maxLines} at a time, with the voices in rotation. You can pause at any moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-sales-campaign-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-sales-campaign-confirm" onClick={() => campaign.mutate(true)}>Start calling</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Stat tiles ───────────────────────────────────────────────────────────────────────────────────────

function StatTiles({ stats }: { stats: Stats }) {
  const o = stats.outcomes ?? {}, l = stats.leads ?? {};
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
  return (
    <section data-testid="section-sales-stats">
      <h2 className="sr-only">Numbers</h2>
      <GoogleStatGrid cols={4}>
        <GoogleStat label="Calls, last 24 h" value={n(stats.calls24h)} testId="stat-sales-calls24h" />
        <GoogleStat label="Minutes, last 24 h" value={(stats.minutes24h ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} testId="stat-sales-minutes24h" />
        <GoogleStat label="Demos booked" value={n(o.demo_booked)} testId="stat-sales-demos" />
        <GoogleStat label="Trial links sent" value={n(o.trial_link)} testId="stat-sales-trials" />
        <GoogleStat label="Send info" value={n(o.send_info)} testId="stat-sales-send-info" />
        <GoogleStat label="Callbacks" value={n(o.callback_later)} testId="stat-sales-callbacks" />
        <GoogleStat label="Do-not-call list" value={n(stats.dnc)} hint={o.do_not_call ? `${n(o.do_not_call)} calls ended with do-not-call` : undefined} testId="stat-sales-dnc" />
        <GoogleStat label="Open follow-ups" value={n(stats.followups_open)} testId="stat-sales-followups" />
        <GoogleStat label="Leads ready" value={n((l.ready ?? 0) + (l.new ?? 0))} testId="stat-sales-leads-ready" />
        <GoogleStat label="Leads held" value={n(l.hold_mobile)} hint="Mobile, needs consent" testId="stat-sales-leads-held" />
      </GoogleStatGrid>
    </section>
  );
}

// ── Voice library ────────────────────────────────────────────────────────────────────────────────────

const ENGINES: { key: Engine; label: string; status: string; tone: Tone }[] = [
  { key: "kokoro", label: "Kokoro", status: "Live-ready", tone: "good" },
  { key: "orpheus", label: "Orpheus", status: "Needs dedicated GPU", tone: "warn" },
  { key: "qwen", label: "Qwen", status: "Brand pronunciation pending", tone: "warn" },
];

function VoiceLibrary() {
  const { toast } = useToast();
  const voices = useQuery<{ voices: Voice[] }>({ queryKey: [K.voices], queryFn: () => getJson(K.voices), retry: false });
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await apiRequest("POST", `${K.voices}/${encodeURIComponent(id)}`, { active })).json() as Promise<{ voice: Voice; warning?: string }>,
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: [K.voices] });
      const before = queryClient.getQueryData<{ voices: Voice[] }>([K.voices]);
      if (before) queryClient.setQueryData([K.voices], { voices: before.voices.map((v) => (v.id === id ? { ...v, active } : v)) });
      return { before };
    },
    onError: (e, { id }, ctx) => {
      if (ctx?.before) queryClient.setQueryData([K.voices], ctx.before);
      toast({ title: `Couldn't change ${titleCase(id)}`, description: apiErrorMessage(e), variant: "destructive" });
    },
    onSuccess: (r, { id }) => {
      const cur = queryClient.getQueryData<{ voices: Voice[] }>([K.voices]);
      if (cur && r?.voice) queryClient.setQueryData([K.voices], { voices: cur.voices.map((v) => (v.id === id ? { ...v, ...r.voice } : v)) });
      setWarnings((w) => ({ ...w, [id]: r?.warning || "" }));
      if (r?.warning) toast({ title: "Saved, with a warning", description: r.warning });
    },
  });

  // Owner rule: no voice named Michael is ever shown.
  const list = (voices.data?.voices ?? []).filter((v) => v.name.trim().toLowerCase() !== "michael");
  const inRotation = list.filter((v) => v.active && v.usable).length;

  return (
    <section data-testid="section-sales-voices">
      <GoogleSectionHeader title="Voice library" count={list.length || null}
        description={voices.data ? `${inRotation} usable voice${inRotation === 1 ? "" : "s"} in the calling rotation.` : "The voices the AI callers can use."} />
      {voices.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading voices" /></div>}
      {voices.error && <Notice tone="danger" title="Couldn't load the voices" testId="notice-sales-voices-error">{apiErrorMessage(voices.error)}</Notice>}
      <div className="space-y-6">
        {ENGINES.map((eng) => {
          const group = list.filter((v) => v.engine === eng.key);
          if (!group.length) return null;
          return (
            <div key={eng.key} data-testid={`group-sales-voices-${eng.key}`}>
              <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                {eng.label} <Chip tone={eng.tone}>{eng.status}</Chip> <span className="text-muted-foreground">{group.length}</span>
              </h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((v) => (
                  <VoiceCard key={v.id} voice={v} engineLabel={eng.label} warning={warnings[v.id]}
                    pending={toggle.isPending && toggle.variables?.id === v.id}
                    onToggle={(active) => toggle.mutate({ id: v.id, active })} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function VoiceCard({ voice: v, engineLabel, warning, pending, onToggle }: { voice: Voice; engineLabel: string; warning?: string; pending: boolean; onToggle: (active: boolean) => void }) {
  const switchId = `switch-voice-${v.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid={`card-sales-voice-${v.id}`} data-active={v.active ? "true" : "false"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium">{v.name}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip>{titleCase(v.gender || "voice")}</Chip>
            <Chip tone="info">{engineLabel}</Chip>
            {!v.usable && <Chip tone="warn" title="Saved in the rotation does nothing until this voice is usable">Not usable yet</Chip>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch id={switchId} checked={v.active} disabled={pending} onCheckedChange={onToggle} data-testid={`switch-sales-voice-${v.id}`} aria-describedby={`${switchId}-label`} />
          <label htmlFor={switchId} id={`${switchId}-label`} className="text-xs text-muted-foreground">In rotation</label>
        </div>
      </div>
      {v.note && <p className="text-sm text-muted-foreground">{v.note}</p>}
      {/* preload=none: 22 players must not pull 3 MB on an iPhone before anyone presses play. */}
      <audio controls preload="none" className="w-full" src={`/sales-voices/${encodeURIComponent(v.id)}.mp3`} data-testid={`audio-sales-voice-${v.id}`}>
        <a href={`/sales-voices/${encodeURIComponent(v.id)}.mp3`}>Play {v.name}'s sample</a>
      </audio>
      {warning && <Notice tone="warning" testId={`notice-sales-voice-warning-${v.id}`}>{warning}</Notice>}
    </li>
  );
}

// ── Recent calls ─────────────────────────────────────────────────────────────────────────────────────

function RecentCalls() {
  const calls = useQuery<{ calls: Call[] }>({ queryKey: [K.calls], queryFn: () => getJson(`${K.calls}?limit=50`), retry: false, refetchInterval: 30_000 });
  const list = calls.data?.calls ?? [];
  return (
    <section data-testid="section-sales-calls">
      <GoogleSectionHeader title="Recent calls" count={calls.data ? list.length : null} description="Open a call for its transcript and recording." />
      {calls.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading calls" /></div>}
      {calls.error && <Notice tone="danger" title="Couldn't load the calls" testId="notice-sales-calls-error">{apiErrorMessage(calls.error)}</Notice>}
      {calls.data && list.length === 0 && <p className="py-6 text-sm text-muted-foreground">No calls yet.</p>}
      {list.length > 0 && (
        <>
          {/* Phones: one card per call. */}
          <GoogleList as="ul" className="md:hidden" testId="list-sales-calls">
            {list.map((c) => (
              <li key={c.call_sid} className="space-y-1.5 py-3" data-testid={`row-sales-call-${c.call_sid}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.business || phoneFmt(c.phone)}</span>
                  <OutcomePill outcome={c.outcome} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {whenEt(c.started_at)} · {titleCase(c.persona || "—")} · {duration(c.duration_s)}{c.score != null ? ` · interest ${c.score}/10` : ""}
                  {c.business ? ` · ${phoneFmt(c.phone)}` : ""}
                </p>
                {c.summary && <p className="line-clamp-3 text-sm">{c.summary}</p>}
                {c.link && <OpenCall link={c.link} />}
              </li>
            ))}
          </GoogleList>
          {/* Desktop: the table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm" data-testid="table-sales-calls">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">When (ET)</th>
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 pr-3 font-medium">Length</th>
                  <th className="py-2 pr-3 font-medium">Interest</th>
                  <th className="py-2 pr-3 font-medium">Summary</th>
                  <th className="py-2 font-medium"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.call_sid} className="border-b align-top last:border-0" data-testid={`row-sales-call-table-${c.call_sid}`}>
                    <td className="whitespace-nowrap py-2 pr-3">{whenEt(c.started_at)}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.business || "—"}</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">{phoneFmt(c.phone)}</div>
                    </td>
                    <td className="py-2 pr-3">{titleCase(c.persona || "—")}</td>
                    <td className="py-2 pr-3"><OutcomePill outcome={c.outcome} /></td>
                    <td className="py-2 pr-3 tabular-nums">{duration(c.duration_s)}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.score != null ? `${c.score}/10` : "—"}</td>
                    <td className="max-w-md py-2 pr-3"><p className="line-clamp-2" title={c.summary}>{c.summary || "—"}</p></td>
                    <td className="py-2">{c.link && <OpenCall link={c.link} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const OutcomePill = ({ outcome }: { outcome: string }) => <Chip tone={OUTCOME_TONE[outcome] ?? "muted"}>{humanize(outcome || "in progress")}</Chip>;
const OpenCall = ({ link }: { link: string }) => <GooglePill size="sm" icon={ExternalLink} label="Open" href={link} external testId="link-sales-call-open" />;

// ── Leads ────────────────────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
const FACETS: { key: string; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "trade", label: "Trade" },
  { key: "state", label: "State" },
  { key: "source", label: "Source" },
  { key: "linetype", label: "Line type" },
];
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function LeadsSection() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (search) p.set("q", search);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  }, [filters, search, offset]);
  const leads = useQuery<LeadsPage>({ queryKey: [K.leads, params], queryFn: () => getJson(`${K.leads}?${params}`), retry: false, placeholderData: (prev) => prev });
  const config = useQuery<Config>({ queryKey: [K.config], queryFn: () => getJson(K.config), retry: false });

  const setFilter = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setOffset(0); };
  const total = leads.data?.total ?? 0;
  const rows = leads.data?.leads ?? [];
  const anyFilter = Object.values(filters).some(Boolean) || !!search;

  return (
    <section className="space-y-4" data-testid="section-sales-leads">
      <GoogleSectionHeader title="Leads" count={leads.data ? total.toLocaleString("en-US") : null}
        description="The businesses the AI callers work through."
        actions={<GooglePill variant="solid" icon={FileUp} label="Import leads" onClick={() => setImportOpen(true)} testId="button-sales-leads-import" />} />
      <p className="text-sm text-muted-foreground" data-testid="text-sales-leads-statuses">
        <strong className="font-medium text-foreground">ready</strong> / <strong className="font-medium text-foreground">new</strong> = will be called ·{" "}
        <strong className="font-medium text-foreground">hold_mobile</strong> = cell/VoIP numbers the AI won't dial without written consent ·{" "}
        <strong className="font-medium text-foreground">dnc</strong> = asked not to be called.
      </p>

      <form className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="search"
        onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setOffset(0); }}>
        <div className="relative col-span-2 sm:col-span-3 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (q.trim() !== search) { setSearch(q.trim()); setOffset(0); } }}
            placeholder="Search business, phone…" aria-label="Search leads" className="h-10 pl-9 text-base sm:text-sm" data-testid="input-sales-leads-search" />
        </div>
        {FACETS.map((f) => {
          const counts = leads.data?.facets?.[f.key] ?? {};
          const values = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          const cur = filters[f.key] ?? "";
          return (
            <select key={f.key} aria-label={f.label} className={selectClass} value={cur} onChange={(e) => setFilter(f.key, e.target.value)} data-testid={`select-sales-leads-${f.key}`}>
              <option value="">{f.label}: all</option>
              {cur && !counts[cur] && <option value={cur}>{cur}</option>}
              {values.map(([v, n]) => <option key={v} value={v}>{v} ({n.toLocaleString("en-US")})</option>)}
            </select>
          );
        })}
      </form>
      {anyFilter && (
        <div><GooglePill size="sm" variant="quiet" label="Clear filters" onClick={() => { setFilters({}); setQ(""); setSearch(""); setOffset(0); }} testId="button-sales-leads-clear" /></div>
      )}

      {leads.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading leads" /></div>}
      {leads.error && <Notice tone="danger" title="Couldn't load the leads" testId="notice-sales-leads-error">{apiErrorMessage(leads.error)}</Notice>}
      {leads.data && rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">{anyFilter ? "No leads match these filters." : "No leads yet. Import a file or connect your scraper."}</p>}

      {rows.length > 0 && (
        <>
          <GoogleList as="ul" className="md:hidden" testId="list-sales-leads">
            {rows.map((l) => (
              <li key={l.id} className="space-y-1 py-3" data-testid={`row-sales-lead-${l.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <LeadLink id={l.id} label={l.business || phoneFmt(l.phone)} />
                  <Chip tone={STATUS_TONE[l.status] ?? "muted"}>{l.status}</Chip>
                </div>
                <p className="text-sm">{phoneFmt(l.phone)} <span className="text-muted-foreground">· {l.linetype || "unknown line"}</span></p>
                <p className="text-xs text-muted-foreground">
                  {[l.trade, place(l.city, l.state), `${l.attempts} ${l.attempts === 1 ? "try" : "tries"}`, l.outcome && humanize(l.outcome), l.source].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </GoogleList>
          <div className={cn("hidden overflow-x-auto md:block", leads.isFetching && "opacity-70")}>
            <table className="w-full text-left text-sm" data-testid="table-sales-leads">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  {["Business", "Phone", "Trade", "City / state", "Line type", "Status", "Tries", "Last outcome", "Source"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b align-top last:border-0" data-testid={`row-sales-lead-table-${l.id}`}>
                    <td className="py-2 pr-3">
                      <LeadLink id={l.id} label={l.business || "(no name)"} />
                      {l.contact_name && <div className="text-xs text-muted-foreground">{l.contact_name}</div>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{phoneFmt(l.phone)}</td>
                    <td className="py-2 pr-3">{l.trade || "—"}</td>
                    <td className="py-2 pr-3">{place(l.city, l.state)}</td>
                    <td className="py-2 pr-3">{l.linetype || "—"}</td>
                    <td className="py-2 pr-3"><Chip tone={STATUS_TONE[l.status] ?? "muted"}>{l.status}</Chip></td>
                    <td className="py-2 pr-3 tabular-nums">{l.attempts}</td>
                    <td className="py-2 pr-3">{l.outcome ? <OutcomePill outcome={l.outcome} /> : "—"}</td>
                    <td className="py-2 pr-3 text-xs">{l.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground" data-testid="text-sales-leads-range">
              {(offset + 1).toLocaleString("en-US")}–{(offset + rows.length).toLocaleString("en-US")} of {total.toLocaleString("en-US")}
            </span>
            <div className="flex gap-2">
              <GooglePill size="sm" label="Previous" disabled={offset === 0 || leads.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} testId="button-sales-leads-prev" />
              <GooglePill size="sm" label="Next" disabled={offset + rows.length >= total || leads.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)} testId="button-sales-leads-next" />
            </div>
          </div>
        </>
      )}

      <details className="rounded-xl border p-4 text-sm" data-testid="details-sales-scraper">
        <summary className="cursor-pointer font-medium">Connect your scraper</summary>
        <div className="mt-3 space-y-2">
          <p>Send leads straight to the calling engine with an HTTP POST:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" data-testid="text-sales-scraper-endpoint">{`POST ${config.data?.apiUrl ?? "https://sales.constructhub.us"}/api/leads
Authorization: Bearer <token from the admin>
Content-Type: application/json

{"source": "scraper-tampa-hvac",
 "leads": [{"phone": "+18135550123", "business": "…", "trade": "HVAC",
            "city": "Tampa", "state": "FL", "website": "…", "email": "…", "contact_name": "…"}]}`}</pre>
          <p className="text-muted-foreground">
            The bearer token comes from the admin; it is never shown on this page. The answer counts what was added, duplicates, invalid numbers and numbers on the do-not-call list.
            {config.data && !config.data.configured && " This server has no engine token set, so the page cannot reach the engine."}
          </p>
        </div>
      </details>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} maxBatch={config.data?.maxBatch ?? 2000} />
    </section>
  );
}

/** The business name, linking to its lead file. */
const LeadLink = ({ id, label }: { id: number | string; label: ReactNode }) => (
  <Link href={`/admin/sales-agents/leads/${id}`} className="font-medium text-primary underline-offset-4 hover:underline" data-testid={`link-sales-lead-${id}`}>{label}</Link>
);

// ── Import ───────────────────────────────────────────────────────────────────────────────────────────

function ImportDialog({ open, onOpenChange, maxBatch }: { open: boolean; onOpenChange: (o: boolean) => void; maxBatch: number }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedLeads | null>(null);
  const [parseError, setParseError] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [runError, setRunError] = useState("");

  const reset = () => { setFileName(""); setParsed(null); setParseError(""); setSource(""); setProgress(null); setResult(null); setRunError(""); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = async (file: File | undefined) => {
    setParsed(null); setParseError(""); setResult(null); setRunError("");
    if (!file) return;
    setFileName(file.name);
    try {
      const p = parseLeadFile(file.name, await file.text());
      setParsed(p);
      setSource(p.source || `import-${file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file"}`);
      if (!p.leads.length) setParseError("No rows with a phone number were found. The file needs a phone (or phone_number / tel) column.");
    } catch (e) {
      setParseError(`Couldn't read that file: ${(e as Error)?.message || "not valid CSV or JSON"}`);
    }
  };

  const run = async () => {
    if (!parsed?.leads.length) return;
    setBusy(true); setRunError(""); setResult(null);
    const batches = chunk(parsed.leads, Math.max(1, Math.min(2000, maxBatch)));
    const sum: ImportResult = { added: 0, duplicates: 0, invalid: 0, on_dnc: 0 };
    setProgress({ done: 0, total: batches.length });
    try {
      for (let i = 0; i < batches.length; i++) {
        const r = await (await apiRequest("POST", K.leads, { source: source.trim() || "admin-import", leads: batches[i] })).json();
        sum.added += Number(r?.added) || 0; sum.duplicates += Number(r?.duplicates) || 0;
        sum.invalid += Number(r?.invalid) || 0; sum.on_dnc += Number(r?.on_dnc) || 0;
        setProgress({ done: i + 1, total: batches.length });
        setResult({ ...sum });
      }
      toast({ title: "Leads imported", description: `${sum.added.toLocaleString("en-US")} added.` });
    } catch (e) {
      setRunError(`${apiErrorMessage(e)} The batches before this one were saved.`);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === K.leads || q.queryKey[0] === K.stats });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy) return; if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="dialog-sales-leads-import">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>
            A CSV with a header row or a JSON list. Columns understood: phone, business (or name / company), trade (or category), city, state, website (or url), email, contact (or owner).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="block w-full text-sm file:mr-3 file:rounded-full file:border file:bg-background file:px-4 file:py-2 file:text-sm file:font-medium"
            onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} data-testid="input-sales-leads-file" />
          {parseError && <Notice tone="danger" testId="notice-sales-import-parse">{parseError}</Notice>}
          {parsed && parsed.leads.length > 0 && (
            <>
              <p data-testid="text-sales-import-parsed">
                <strong>{parsed.leads.length.toLocaleString("en-US")}</strong> leads in {fileName}
                {parsed.skipped ? ` (${parsed.skipped.toLocaleString("en-US")} rows without a phone skipped)` : ""}.
              </p>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Source label (which list or scraper these came from)</span>
                <Input value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} className="text-base sm:text-sm" data-testid="input-sales-import-source" />
              </label>
            </>
          )}
          {progress && busy && <p className="text-muted-foreground">Sending batch {Math.min(progress.done + 1, progress.total)} of {progress.total}…</p>}
          {result && (
            <ul className="grid grid-cols-2 gap-2" data-testid="list-sales-import-result">
              <li className="rounded-lg border p-2"><span className="block text-xs text-muted-foreground">Added</span><span className="text-lg">{result.added.toLocaleString("en-US")}</span></li>
              <li className="rounded-lg border p-2"><span className="block text-xs text-muted-foreground">Duplicates</span><span className="text-lg">{result.duplicates.toLocaleString("en-US")}</span></li>
              <li className="rounded-lg border p-2"><span className="block text-xs text-muted-foreground">Invalid</span><span className="text-lg">{result.invalid.toLocaleString("en-US")}</span></li>
              <li className="rounded-lg border p-2"><span className="block text-xs text-muted-foreground">On do-not-call</span><span className="text-lg">{result.on_dnc.toLocaleString("en-US")}</span></li>
            </ul>
          )}
          {runError && <Notice tone="danger" testId="notice-sales-import-error">{runError}</Notice>}
        </div>
        <DialogFooter className="gap-2">
          <GooglePill label={result && !busy ? "Done" : "Cancel"} disabled={busy} onClick={() => { reset(); onOpenChange(false); }} testId="button-sales-import-close" />
          {!(result && !busy && !runError) && (
            <GooglePill variant="solid" icon={busy ? Loader2 : FileUp} label={busy ? "Importing…" : "Import"} disabled={busy || !parsed?.leads.length} onClick={() => void run()} testId="button-sales-import-run" />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Lead file ────────────────────────────────────────────────────────────────────────────────────────

type Turn = { role: "caller" | "assistant" | string; text: string; t?: number };
type FileCall = {
  call_sid: string; started_at: number; direction: string; persona: string; outcome: string; duration_s: number; score: number | null;
  summary: string; captured: Record<string, unknown> | null; transcript: Turn[] | null; link: string;
};
type LeadFileData = {
  lead: Lead & Record<string, unknown>;
  calls: FileCall[];
  consents: { kind: string; quote: string; call_sid: string; created_at: number }[];
  followups: { kind: string; detail: string; done: boolean | number; created_at: number }[];
  on_dnc: boolean;
};

const CAPTURED_LABELS: Record<string, string> = {
  contact_name: "Contact", email: "Email", mobile_for_text: "Mobile for texts", callback_time: "Callback time",
  current_software: "Current software", team_size: "Team size", trade: "Trade", notes: "Notes", interest: "Interest",
};
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

function LeadFile({ id }: { id: string }) {
  const file = useQuery<LeadFileData>({ queryKey: [K.leads, "file", id], queryFn: () => getJson(`${K.leads}/${id}`), retry: false });
  const [, setLocation] = useLocation();
  const back = <GooglePill size="sm" variant="quiet" label="← All leads" href="/admin/sales-agents/leads" onClick={(e) => { e.preventDefault(); setLocation("/admin/sales-agents/leads"); }} testId="link-sales-lead-back" />;

  if (file.isLoading) return <section>{back}<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading lead" /></div></section>;
  if (!file.data) return <section className="space-y-3">{back}<Notice tone="danger" title="Couldn't load this lead" testId="notice-sales-lead-error">{apiErrorMessage(file.error)}</Notice></section>;

  const { lead: l, calls, consents, followups } = file.data;
  return (
    <section className="space-y-6" data-testid="section-sales-lead-file">
      <div>{back}</div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-normal">{l.business || phoneFmt(l.phone)}</h2>
          <Chip tone={STATUS_TONE[l.status] ?? "muted"}>{l.status}</Chip>
          {file.data.on_dnc && <Chip tone="bad">On do-not-call list</Chip>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Phone"><a className="text-primary" href={`tel:${l.phone}`}>{phoneFmt(l.phone)}</a></Fact>
          {l.contact_name && <Fact label="Contact">{l.contact_name}</Fact>}
          <Fact label="Trade">{l.trade || "—"}</Fact>
          <Fact label="City / state">{place(l.city, l.state)}</Fact>
          <Fact label="Line type">{l.linetype || "—"}{typeof l.carrier === "string" && l.carrier.trim() ? ` · ${l.carrier.trim()}` : ""}</Fact>
          <Fact label="Source">{l.source || "—"}</Fact>
          <Fact label="Tries">{l.attempts}{l.outcome ? ` · last: ${humanize(l.outcome)}` : ""}</Fact>
          {l.website && <Fact label="Website"><a className="break-all text-primary underline-offset-4 hover:underline" href={safeHref(l.website)} target="_blank" rel="noopener noreferrer">{l.website}</a></Fact>}
          {l.email && <Fact label="Email"><a className="break-all text-primary underline-offset-4 hover:underline" href={`mailto:${l.email}`}>{l.email}</a></Fact>}
          {typeof l.notes === "string" && l.notes && <Fact label="Notes">{l.notes}</Fact>}
        </dl>
      </div>

      <div data-testid="section-sales-lead-consents">
        <GoogleSectionHeader as="h3" title="Agreed to" count={consents.length} />
        {consents.length === 0 ? <p className="text-sm text-muted-foreground">Nothing agreed on a call yet.</p> : (
          <ul className="space-y-2">
            {consents.map((c, i) => (
              <li key={`${c.call_sid}-${i}`} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Chip tone="good">{humanize(c.kind)}</Chip><span className="text-xs text-muted-foreground">{whenEt(c.created_at)}</span></div>
                {c.quote && <blockquote className="mt-2 border-l-2 pl-3 italic">“{c.quote}”</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div data-testid="section-sales-lead-followups">
        <GoogleSectionHeader as="h3" title="Follow-ups" count={followups.length} />
        {followups.length === 0 ? <p className="text-sm text-muted-foreground">No follow-ups.</p> : (
          <ul className="space-y-2">
            {followups.map((f, i) => (
              <li key={i} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={f.done ? "muted" : "info"}>{humanize(f.kind)}</Chip>
                  <span className="text-xs text-muted-foreground">{f.done ? "Done" : "Open"} · {whenEt(f.created_at)}</span>
                </div>
                {f.detail && <p className="mt-1.5 whitespace-pre-line break-words">{f.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div data-testid="section-sales-lead-calls">
        <GoogleSectionHeader as="h3" title="Calls" count={calls.length} />
        {calls.length === 0 ? <p className="text-sm text-muted-foreground">No calls yet.</p> : (
          <ul className="space-y-2">{calls.map((c) => <LeadCallCard key={c.call_sid} call={c} />)}</ul>
        )}
      </div>
    </section>
  );
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex gap-2"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>
);

function LeadCallCard({ call: c }: { call: FileCall }) {
  const captured = Object.entries(c.captured ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
  const transcript = (c.transcript ?? []).filter((t) => t?.text);
  const agent = titleCase(c.persona || "Agent");
  return (
    <li className="rounded-xl border" data-testid={`card-sales-lead-call-${c.call_sid}`}>
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3 text-sm">
          <span className="font-medium">{whenEt(c.started_at)}</span>
          <span className="text-muted-foreground">{humanize(c.direction)} · {agent} · {duration(c.duration_s)}{c.score != null ? ` · interest ${c.score}/10` : ""}</span>
          <OutcomePill outcome={c.outcome} />
        </summary>
        <div className="space-y-3 border-t p-3 text-sm">
          {c.summary && <p>{c.summary}</p>}
          {captured.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {captured.map(([k, v]) => <Fact key={k} label={CAPTURED_LABELS[k] ?? humanize(k)}>{String(v)}</Fact>)}
            </dl>
          )}
          {transcript.length > 0 ? (
            <ol className="space-y-2" aria-label="Transcript">
              {transcript.map((t, i) => {
                const ours = t.role === "assistant";
                return (
                  <li key={i} className={cn("flex", ours ? "justify-start" : "justify-end")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2", ours ? "bg-muted" : "bg-primary/10")}>
                      <p className="text-xs font-medium text-muted-foreground">{ours ? agent : "Them"}</p>
                      <p className="whitespace-pre-line break-words">{t.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-muted-foreground">No transcript for this call.</p>}
          {c.link && <GooglePill size="sm" icon={ExternalLink} label="Open recording" href={c.link} external testId="link-sales-lead-call-recording" />}
        </div>
      </details>
    </li>
  );
}

// ── Call log ─────────────────────────────────────────────────────────────────────────────────────────

type LogCall = {
  call_sid: string; started_at: number; ended_at: number | null; direction: string; from_number: string; to_number: string;
  persona: string; status: string; amd: string; outcome: string; duration_s: number; lead_id: number | null; business: string;
};
/** What happened on the attempt: the conversation's outcome, else the line's status (no-answer, busy, failed…). */
const result = (c: LogCall) => c.outcome || c.status || "unknown";

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const isoEt = (unix: number | null) => (unix ? new Date(unix * 1000).toLocaleString("en-US", { timeZone: "America/New_York" }) : "");

function CallLog() {
  const log = useQuery<{ calls: LogCall[] }>({ queryKey: [`${BASE}/calllog`], queryFn: () => getJson(`${BASE}/calllog?limit=500`), retry: false, refetchInterval: 30_000 });
  const [outcome, setOutcome] = useState("");
  const all = log.data?.calls ?? [];
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of all) m[result(c)] = (m[result(c)] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [all]);
  const rows = outcome ? all.filter((c) => result(c) === outcome) : all;

  const exportCsv = () => {
    const head = ["started_et", "ended_et", "direction", "from", "to", "business", "lead_id", "agent", "status", "outcome", "duration_s", "amd", "call_sid"];
    const lines = rows.map((c) => [isoEt(c.started_at), isoEt(c.ended_at), c.direction, c.from_number, c.to_number, c.business, c.lead_id ?? "", c.persona, c.status, c.outcome, c.duration_s, c.amd, c.call_sid].map(csvCell).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sales-call-log-${new Date().toISOString().slice(0, 10)}${outcome ? `-${outcome}` : ""}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const who = (c: LogCall) => {
    const other = c.direction === "inbound" ? c.from_number : c.to_number;
    return c.lead_id ? <LeadLink id={c.lead_id} label={c.business || phoneFmt(other)} /> : <span>{c.business || phoneFmt(other)}</span>;
  };

  return (
    <section className="space-y-4" data-testid="section-sales-calllog">
      <GoogleSectionHeader title="Call log" count={log.data ? rows.length.toLocaleString("en-US") : null}
        description="Every attempt, including no-answer, busy, failed and voicemail. Latest 500."
        actions={<GooglePill icon={Download} label="Export CSV" disabled={!rows.length} onClick={exportCsv} testId="button-sales-calllog-export" />} />
      <select aria-label="Outcome" className={cn(selectClass, "sm:w-72")} value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="select-sales-calllog-outcome">
        <option value="">Outcome: all</option>
        {counts.map(([v, n]) => <option key={v} value={v}>{humanize(v)} ({n})</option>)}
      </select>
      {log.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading call log" /></div>}
      {log.error && <Notice tone="danger" title="Couldn't load the call log" testId="notice-sales-calllog-error">{apiErrorMessage(log.error)}</Notice>}
      {log.data && rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No calls{outcome ? " with this outcome" : " yet"}.</p>}
      {rows.length > 0 && (
        <>
          <GoogleList as="ul" className="md:hidden" testId="list-sales-calllog">
            {rows.map((c) => (
              <li key={c.call_sid} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">{who(c)}<OutcomePill outcome={result(c)} /></div>
                <p className="text-xs text-muted-foreground">
                  {whenEt(c.started_at)} · {humanize(c.direction)} · {titleCase(c.persona || "—")} · {duration(c.duration_s)}{c.amd ? ` · AMD ${c.amd}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">{phoneFmt(c.from_number)} → {phoneFmt(c.to_number)}</p>
              </li>
            ))}
          </GoogleList>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm" data-testid="table-sales-calllog">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>{["When (ET)", "Direction", "From → to", "Business", "Agent", "Outcome", "Length", "AMD"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.call_sid} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{whenEt(c.started_at)}</td>
                    <td className="py-2 pr-3">{humanize(c.direction)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs">{phoneFmt(c.from_number)}<br />→ {phoneFmt(c.to_number)}</td>
                    <td className="py-2 pr-3">{who(c)}</td>
                    <td className="py-2 pr-3">{titleCase(c.persona || "—")}</td>
                    <td className="py-2 pr-3"><OutcomePill outcome={result(c)} /></td>
                    <td className="py-2 pr-3 tabular-nums">{duration(c.duration_s)}</td>
                    <td className="py-2 pr-3">{c.amd ? humanize(c.amd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
