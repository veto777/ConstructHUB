import { AppPage, Section, AppTabsList, Toolbar, Notice, appTable, appTableCards } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { SamplePreview } from "@/components/sample-preview";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Phone,
  Mail,
  Calendar,
  PhoneCall,
  RefreshCw,
  Link2,
  AlertTriangle,
  DollarSign,
  ThumbsDown,
  ThumbsUp,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wrench,
  Tag,
  Search,
  Send,
  Unplug,
  Building2,
  ArrowLeft,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LsaConnectionInfo {
  connectedEmail?: string | null;
  telegramLinked: boolean;
  telegramUsername?: string | null;
  telegramLinkToken?: string | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  lastSyncCount?: number | null;
  lastCostTotal?: string | null;
  lastDiscoveryAt?: string | null;
}
interface LsaStatus {
  configured: boolean;
  connected: boolean;
  telegramConfigured: boolean;
  botUsername?: string | null;
  redirectUri?: string | null;
  connection: LsaConnectionInfo | null;
}
interface LsaAccount {
  id: string;
  customerId: string;
  descriptiveName?: string | null;
  isManager?: boolean | null;
  lsaEnrolled?: boolean | null;
  enabled: boolean;
  leadCount?: number | null;
  chargedCount?: number | null;
  disputedCount?: number | null;
  costTotal?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
}
interface LsaLead {
  id: string;
  leadId: string;
  customerId?: string | null;
  leadType?: string | null;
  categoryId?: string | null;
  serviceId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  leadStatus?: string | null;
  leadCharged?: boolean | null;
  leadCost?: string | null;
  feedbackSubmitted?: boolean | null;
  surveyAnswer?: string | null;
  disputeReason?: string | null;
  creditState?: string | null;
  disputeStatus?: string | null;
  disputeScheduledAt?: string | null;
  leadCreationTime?: string | null;
  createdAt?: string | null;
}

// Google's SurveyDissatisfiedReason values. The first three get credited most
// reliably, so they're flagged "best" and used as the rotating batch defaults.
const BEST_REASONS = ["JOB_TYPE_MISMATCH", "SOLICITATION", "DUPLICATE"];
const DISSATISFIED_REASONS: { value: string; label: string; best?: boolean }[] = [
  { value: "JOB_TYPE_MISMATCH", label: "Service I don't offer", best: true },
  { value: "SOLICITATION", label: "Sales call / solicitation", best: true },
  { value: "DUPLICATE", label: "Duplicate lead", best: true },
  { value: "GEO_MISMATCH", label: "Outside my service area" },
  { value: "NOT_READY_TO_BOOK", label: "Customer wasn't ready to book" },
];

function reasonLabel(v?: string | null): string {
  if (!v) return "";
  return DISSATISFIED_REASONS.find((r) => r.value === v)?.label || v;
}
function lsaTypeLabel(t?: string | null): string {
  switch ((t || "").toUpperCase()) {
    case "PHONE_CALL": return "Phone call";
    case "MESSAGE": return "Message";
    case "BOOKING": return "Booking";
    default: return t || "Lead";
  }
}
function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
type LeadFilter = "all" | "charged" | "disputed";

/** A plain three-step card above a bare form (owner 2026-10-15: explain every form in a busy contractor's words). */
function HowThisWorks({ steps, testId }: { steps: string[]; testId?: string }) {
  return (
    <Section flush testId={testId}>
      <CardHeader><CardTitle className="g-card__title g-card__title--md">How this works</CardTitle></CardHeader>
      <CardContent><ol className="list-decimal space-y-1.5 pl-5 text-sm">{steps.map((st) => <li key={st}>{st}</li>)}</ol></CardContent>
    </Section>
  );
}

/** Obviously made-up accounts and leads, shown only while the real list is empty (components/sample-preview.tsx rules). */
function SampleAccounts() {
  return (
    <>
      <GoogleStatGrid cols={4} className="mb-3">
        <GoogleStat label="Accounts" value="2" />
        <GoogleStat label="Leads" value="31" />
        <GoogleStat label="Charged" value="19" tone="bad" />
        <GoogleStat label="Spend" value="$1,240.00" />
      </GoogleStatGrid>
      <GoogleList>
        <GoogleListRow size="md" title="Sample Roofing Co." badges={<span className="g-chip g-chip--sm g-open">LSA</span>} meta={["123-456-7890", "22 leads", <span key="c" className="g-closed">14 charged</span>, "$940.00 spend"]} actions={<><GooglePill size="sm" label="Open leads" /><GooglePill size="sm" label="Charged leads" /></>} />
        <GoogleListRow size="md" title="Sample Plumbing LLC" badges={<span className="g-chip g-chip--sm g-open">LSA</span>} meta={["123-456-7891", "9 leads", <span key="c" className="g-closed">5 charged</span>, "$300.00 spend"]} actions={<><GooglePill size="sm" label="Open leads" /><GooglePill size="sm" label="Charged leads" /></>} />
      </GoogleList>
    </>
  );
}
function SampleLeads() {
  return (
    <GoogleList>
      <GoogleListRow size="md" title="Sample caller · Phone call" badges={<span className="g-chip g-chip--sm g-closed">Charged · $38.00</span>} meta={["Roof repair", "(555) 010-0001", "Today 9:14 AM"]} actions={<><GooglePill size="sm" label="Good" /><GooglePill size="sm" label="Bad" /></>} />
      <GoogleListRow size="md" title="Sample homeowner · Message" badges={<span className="g-chip g-chip--sm">Not charged</span>} meta={["Gutter cleaning", "sample@example.com", "Yesterday 4:02 PM"]} actions={<><GooglePill size="sm" label="Good" /><GooglePill size="sm" label="Bad" /></>} />
    </GoogleList>
  );
}

function isDisputable(lead: LsaLead): boolean {
  if (lead.feedbackSubmitted) return false;
  const s = lead.disputeStatus || "";
  return s !== "queued" && s !== "sending" && s !== "disputed" && s !== "scheduled";
}
// Spread N disputes across a date range, each at a random business-hour moment.
function scatterRunAts(count: number, startMs: number, endMs: number): number[] {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const span = Math.max(hi - lo, 60_000);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(lo + Math.floor(Math.random() * span));
    d.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);
    let t = d.getTime();
    if (t < Date.now() + 60_000) t = Date.now() + 60_000 + Math.floor(Math.random() * 600_000);
    out.push(t);
  }
  return out;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

// A reason <select> that groups the best (most-credited) reasons up top.
function ReasonSelect({ value, onChange, disabled, testid }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; testid?: string;
}) {
  const best = DISSATISFIED_REASONS.filter((r) => r.best);
  const other = DISSATISFIED_REASONS.filter((r) => !r.best);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid={testid}
      className="text-sm rounded-md border border-input bg-background px-2 py-1"
    >
      <optgroup label="Best for getting credited">
        {best.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </optgroup>
      <optgroup label="Other reasons">
        {other.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </optgroup>
    </select>
  );
}

export default function LsaLeadsPage() {
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<LsaAccount | null>(null);
  const [initialFilter, setInitialFilter] = useState<LeadFilter>("all");

  const { data: status } = useQuery<LsaStatus>({
    queryKey: ["/api/lsa/status"],
    refetchInterval: 15000,
  });

  // Surface the OAuth redirect outcome (?connect=ok|error|norefresh) as a toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (!connect) return;
    if (connect === "ok") {
      toast({ title: "Google Ads connected", description: "Pulling in your accounts and leads…" });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/accounts"] });
    } else if (connect === "norefresh") {
      toast({ title: "Couldn't finish connecting", description: "Google didn't return a refresh token. Remove the app's access in your Google account and try again.", variant: "destructive" });
    } else {
      toast({ title: "Connection failed", description: "Please try connecting again.", variant: "destructive" });
    }
    window.history.replaceState({}, "", "/lsa-leads");
  }, [toast]);

  const syncMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lsa/sync")).json(),
    onSuccess: (data: any) => {
      toast({ title: "Sync complete", description: `${data?.imported ?? 0} new lead(s) across ${data?.accountsScanned ?? 0} account(s).` });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/leads"] });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e?.message || "Please try again.", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lsa/disconnect")).json(),
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Your Google Ads account was unlinked." });
      setSelectedAccount(null);
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/status"] });
    },
  });

  const connect = () => { window.location.href = "/api/lsa/oauth/start"; };

  return (
    <AppPage testId="page-lsa-leads" className="[&_button]:min-h-10 [&_select]:min-h-10">
      {/* Google's page format (owner, 2026-10-07): a quiet header, hairline rows, pill actions, stat tiles. */}
      <GoogleSectionHeader as="h1" title="LSA leads" description="Read your Local Services Ads leads and report the bad ones to Google, account by account." flush actions={<>
              {status?.connected ? (
                <>
                  <GooglePill
                    icon={RefreshCw}
                    variant="solid"
                    label={syncMutation.isPending ? "Syncing…" : "Sync now"}
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className={syncMutation.isPending ? "[&>svg]:animate-spin" : undefined}
                    testId="button-sync"
                  />
                  <details className="relative"><summary className="g-pill cursor-pointer list-none [&::-webkit-details-marker]:hidden">More</summary><div className="absolute right-0 z-20 mt-2 rounded-xl border bg-card p-2 shadow-sm">
                    <GooglePill icon={Unplug} variant="quiet" label="Disconnect" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} testId="button-disconnect" />
                  </div></details>
                </>
              ) : status?.configured ? (
                <GooglePill icon={Link2} variant="solid" label="Connect Google Ads" onClick={connect} testId="button-connect" />
              ) : <GooglePill variant="solid" label="Connect Google Ads" disabled />}</>} />
      {!status?.configured && <Notice tone="warning">Google Ads setup is required before you can connect.</Notice>}
      {status && !status.configured && (
        <HowThisWorks testId="how-lsa-leads" steps={["Choose Connect Google Ads and allow access with the Google account that can see your Local Services Ads.", "Choose Sync now: every Google Ads account you can reach appears below with its leads.", "Open an account and rate each lead Good or Bad; a Bad rating is reported to Google with the reason you pick."]} />
      )}
      {status?.configured && <Section title="Connection" contentClassName="space-y-3">
          {status?.configured && !status.connected && (
            <HowThisWorks testId="how-lsa-leads" steps={["Choose Connect Google Ads and allow access with the Google account that can see your Local Services Ads.", "Choose Sync now: every Google Ads account you can reach appears below with its leads.", "Open an account and rate each lead Good or Bad; a Bad rating is reported to Google with the reason you pick."]} />
          )}
          {status?.configured && !status.connected && status.redirectUri && (
            <RedirectUriHelp redirectUri={status.redirectUri} />
          )}
        {status?.connected && status.connection && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
              {status.connection.lastSyncAt && <span data-testid="text-last-sync">Last synced {new Date(status.connection.lastSyncAt).toLocaleString()}</span>}
              {status.connection.lastDiscoveryAt && <span>Accounts discovered {new Date(status.connection.lastDiscoveryAt).toLocaleString()}</span>}
            </div>
            {status.connection.lastSyncError && (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="break-all">Last sync issue: {status.connection.lastSyncError}</span>
              </div>
            )}
<details><summary className="cursor-pointer py-2 text-sm font-medium">Telegram notifications</summary><TelegramPanel status={status} /></details>
          </div>
        )}
      </Section>}

      {status && !status.connected && (
        <SamplePreview what="what you’ll see once Google Ads is connected" testId="sample-lsa-accounts" cta={<GooglePill size="sm" variant="solid" icon={Link2} label="Connect Google Ads" onClick={connect} disabled={!status.configured} />}>
          <SampleAccounts />
        </SamplePreview>
      )}
      {status?.connected && !selectedAccount && (
        <AccountsOverview onOpen={(a, f) => { setInitialFilter(f ?? "all"); setSelectedAccount(a); }} onSync={() => syncMutation.mutate()} syncing={syncMutation.isPending} />
      )}
      {status?.connected && selectedAccount && (
        <AccountDetail key={`${selectedAccount.customerId}-${initialFilter}`} account={selectedAccount} initialFilter={initialFilter} onBack={() => setSelectedAccount(null)} />
      )}
    </AppPage>
  );
}

// ── OAuth redirect-URI helper ─────────────────────────────────────────────────────
function RedirectUriHelp({ redirectUri }: { redirectUri: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast({ title: "Copied", description: "Redirect URI copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: redirectUri, variant: "destructive" });
    }
  };
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="box-redirect-uri">
      <div className="flex items-start gap-2 text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-2 min-w-0">
          <p className="font-medium">One-time Google setup (covers all users &amp; accounts)</p>
          <p className="text-amber-700">
            Register this single redirect URI in your Google Cloud OAuth client under{" "}
            <span className="font-medium">Authorized redirect URIs</span>. You only do this once —
            every user who connects, and every Google Ads account they add, uses this same URI, so
            you never touch cloud settings again as you scale.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-2 py-1 rounded bg-white border border-amber-200 text-amber-900 break-all" data-testid="text-redirect-uri">
              {redirectUri}
            </code>
            <Button size="sm" variant="outline" onClick={copy} className="h-7 gap-1" data-testid="button-copy-redirect-uri">
              <Send className="w-3 h-3" /> Copy
            </Button>
          </div>
          <p className="text-amber-700">
            Also publish the OAuth consent screen (set it to <span className="font-medium">In production</span>)
            so any Google user can connect without being added as a test user.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Telegram linking ────────────────────────────────────────────────────────────
function TelegramPanel({ status }: { status: LsaStatus }) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const conn = status.connection!;

  const linkMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lsa/telegram/link", { username })).json(),
    onSuccess: (data: any) => {
      setDeepLink(data?.deepLink || null);
      if (data?.deepLink) window.open(data.deepLink, "_blank");
      toast({ title: "Almost there", description: "Press Start in the Telegram chat that just opened to finish linking." });
      queryClient.invalidateQueries({ queryKey: ["/api/lsa/status"] });
    },
    onError: (e: any) => toast({ title: "Couldn't start linking", description: e?.message || "Try again.", variant: "destructive" }),
  });
  const unlinkMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lsa/telegram/unlink")).json(),
    onSuccess: () => { setDeepLink(null); toast({ title: "Telegram unlinked" }); queryClient.invalidateQueries({ queryKey: ["/api/lsa/status"] }); },
  });

  if (!status.telegramConfigured) {
    return (
      <div className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
        Telegram alerts aren't configured on the server yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3" data-testid="panel-telegram">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Send className="w-4 h-4 text-sky-500" /> Telegram lead alerts
        {conn.telegramLinked && <Badge className="bg-green-100 text-green-700 border-green-200">Linked</Badge>}
      </div>
      {conn.telegramLinked ? (
        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
          <span>You'll get a DM the moment a new lead arrives.</span>
          <Button size="sm" variant="ghost" onClick={() => unlinkMutation.mutate()} disabled={unlinkMutation.isPending} data-testid="button-telegram-unlink">Unlink</Button>
        </div>
      ) : (
        <div className="flex items-end gap-2 mt-2 flex-wrap">
          <label className="text-xs text-muted-foreground">
            <span className="block mb-1">Your Telegram @username (optional)</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@yourname" className="w-48 h-9" data-testid="input-telegram-username" />
          </label>
          <Button variant="outline" size="sm" onClick={() => linkMutation.mutate()} disabled={linkMutation.isPending} className="flex items-center gap-1" data-testid="button-telegram-link">
            <Send className="w-4 h-4" /> {linkMutation.isPending ? "Starting…" : "Link Telegram"}
          </Button>
          {deepLink && <a href={deepLink} target="_blank" rel="noreferrer" className="text-xs text-sky-600 underline">Open Telegram</a>}
        </div>
      )}
    </div>
  );
}

// ── Accounts overview ────────────────────────────────────────────────────────────
function AccountsOverview({ onOpen, onSync, syncing }: { onOpen: (a: LsaAccount, filter?: LeadFilter) => void; onSync: () => void; syncing: boolean }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, error } = useQuery<{ accounts: LsaAccount[]; total: number }>({
    queryKey: ["/api/lsa/accounts", debouncedQ, page],
    queryFn: () => getJson(`/api/lsa/accounts?q=${encodeURIComponent(debouncedQ)}&page=${page}&pageSize=${pageSize}`),
    refetchInterval: 60000,
  });
  const accounts = data?.accounts || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The summary row adds up the accounts on this page only, and says so.
  const sums = accounts.reduce((n, a) => ({ leads: n.leads + (a.leadCount ?? 0), charged: n.charged + (a.chargedCount ?? 0), disputed: n.disputed + (a.disputedCount ?? 0), spend: n.spend + (a.costTotal != null ? Number(a.costTotal) : 0), lsa: n.lsa + (a.lsaEnrolled === true ? 1 : 0) }), { leads: 0, charged: 0, disputed: 0, spend: 0, lsa: 0 });
  const scope = totalPages > 1 ? `Accounts on this page (${accounts.length} of ${total})` : undefined;

  if (error) return <Notice tone="warning">Accounts could not be loaded. Please try again.</Notice>;

  return (
    <section data-testid="section-lsa-accounts">
      <GoogleSectionHeader
        title="Your Google Ads accounts"
        count={total > 0 ? total : null}
        flush
        actions={(
          <div className="g-search w-full sm:w-72" role="search">
            <Search aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" aria-label="Search accounts" data-testid="input-search-accounts" />
          </div>
        )}
      />
      <div>
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading accounts…</div>
        ) : accounts.length === 0 ? (
          debouncedQ ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No account matches “{debouncedQ}”.</p>
          ) : (
            <SamplePreview what="what you’ll see once your first sync finishes" testId="sample-lsa-accounts" cta={<GooglePill size="sm" variant="solid" icon={RefreshCw} label={syncing ? "Syncing…" : "Sync now"} onClick={onSync} disabled={syncing} />}>
              <SampleAccounts />
            </SamplePreview>
          )
        ) : (
          <>
            {/* The SEO Suite look (owner 2026-10-15): a quiet summary row, then one card per account with its numbers and actions. */}
            <GoogleStatGrid cols={4} className="mb-3">
              <GoogleStat label="Accounts" value={total.toLocaleString()} hint={sums.lsa ? `${sums.lsa} with Local Services Ads${scope ? " on this page" : ""}` : undefined} testId="stat-accounts" />
              <GoogleStat label="Leads" value={sums.leads.toLocaleString()} hint={scope} testId="stat-leads-total" />
              <GoogleStat label="Charged" value={sums.charged.toLocaleString()} tone={sums.charged > 0 ? "bad" : "default"} hint={sums.disputed ? `${sums.disputed} disputed` : scope} testId="stat-charged-total" />
              <GoogleStat label="Spend" value={`$${money(sums.spend)}`} hint={scope ?? "Across these accounts"} testId="stat-spend-total" />
            </GoogleStatGrid>
            <GoogleList>
              {accounts.map((a) => (
                <GoogleListRow
                  key={a.id}
                  size="md"
                  testId={`card-account-${a.customerId}`}
                  title={a.descriptiveName || `Account ${a.customerId}`}
                  className="relative cursor-pointer rounded-md hover:bg-muted/50 transition-colors [&_h3_button]:!no-underline focus-within:ring-2 focus-within:ring-ring focus-within:rounded-md [&_h3_button]:after:absolute [&_h3_button]:after:inset-0"
                  onOpen={() => onOpen(a)}
                  badges={<>
                    {a.lsaEnrolled === true && <span className="g-chip g-chip--sm g-open">LSA</span>}
                    {a.isManager && <span className="g-chip g-chip--sm">Manager</span>}
                    {!a.enabled && <span className="g-chip g-chip--sm">Paused</span>}
                  </>}
                  meta={[
                    a.customerId,
                    `${a.leadCount ?? 0} leads`,
                    <span key="charged" className={(a.chargedCount ?? 0) > 0 ? "g-closed" : undefined}>{a.chargedCount ?? 0} charged</span>,
                    (a.disputedCount ?? 0) > 0 ? `${a.disputedCount} disputed` : null,
                    a.costTotal != null ? `$${money(Number(a.costTotal))} spend` : null,
                  ]}
                  line={a.lastError ? <span className="text-amber-700">Last sync issue: {a.lastError}</span> : a.lastSyncAt ? `Synced ${new Date(a.lastSyncAt).toLocaleString()}` : "Not synced yet"}
                  trailing={<ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
                  actions={<div className="relative z-10 flex flex-wrap gap-2"><GooglePill size="sm" label="Open leads" onClick={(e) => { e.stopPropagation(); onOpen(a); }} testId={`button-open-leads-${a.customerId}`} />{(a.chargedCount ?? 0) > 0 && <GooglePill size="sm" label={`${a.chargedCount} charged`} onClick={(e) => { e.stopPropagation(); onOpen(a, "charged"); }} testId={`button-open-charged-${a.customerId}`} />}</div>}
                />
              ))}
            </GoogleList>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-4 text-sm">
                <span className="text-muted-foreground">Page {page} of {totalPages} · {total} accounts</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-accounts-prev"><ChevronLeft className="w-4 h-4" /> Prev</Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} data-testid="button-accounts-next">Next <ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ── Account detail (leads + disputes) ────────────────────────────────────────────
function AccountDetail({ account, initialFilter = "all", onBack }: { account: LsaAccount; initialFilter?: LeadFilter; onBack: () => void }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<LeadFilter>(initialFilter);
  // A typed value beside the three preset filters: matches name, phone, email, service, lead type and any status word on this page.
  const [find, setFind] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, error } = useQuery<{ leads: LsaLead[]; total: number }>({
    queryKey: ["/api/lsa/leads", account.customerId, filter, page],
    queryFn: () => getJson(`/api/lsa/leads?customerId=${account.customerId}&filter=${filter}&page=${page}&pageSize=${pageSize}`),
    // Poll fast while any dispute is in flight so the live stickers update.
    refetchInterval: (query) => {
      const d = query.state.data as { leads: LsaLead[] } | undefined;
      const active = d?.leads?.some((l) => l.disputeStatus === "queued" || l.disputeStatus === "sending");
      return active ? 4000 : 30000;
    },
  });
  const allLeads = useMemo(() => data?.leads || [], [data]);
  const leads = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (!needle) return allLeads;
    return allLeads.filter((l) => [l.contactName, l.contactPhone, l.contactEmail, l.serviceId, l.categoryId, lsaTypeLabel(l.leadType), l.leadStatus, l.disputeStatus, l.creditState, l.surveyAnswer, reasonLabel(l.disputeReason), l.leadCharged === true ? "charged" : l.leadCharged === false ? "not charged" : ""].some((v) => (v || "").toLowerCase().includes(needle)));
  }, [allLeads, find]);
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Selection + per-lead reasons for batch disputes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonByLead, setReasonByLead] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const addDaysISO = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const [scheduleStart, setScheduleStart] = useState(() => addDaysISO(1));
  const [scheduleEnd, setScheduleEnd] = useState(() => addDaysISO(7));

  useEffect(() => { setPage(1); }, [filter]);

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const eligibleOnPage = leads.filter(isDisputable);
  const allPageSelected = eligibleOnPage.length > 0 && eligibleOnPage.every((l) => selected.has(l.leadId));

  const toggleSelect = (leadId: string) => {
    if (selected.has(leadId)) {
      setSelected((prev) => { const n = new Set(prev); n.delete(leadId); return n; });
      setReasonByLead((r) => { const n = { ...r }; delete n[leadId]; return n; });
    } else {
      setSelected((prev) => new Set(prev).add(leadId));
      setReasonByLead((r) => ({ ...r, [leadId]: BEST_REASONS[selected.size % BEST_REASONS.length] }));
    }
  };
  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      const ids = eligibleOnPage.map((l) => l.leadId);
      setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
      setReasonByLead((r) => { const n = { ...r }; ids.forEach((id) => delete n[id]); return n; });
    } else {
      let i = selected.size;
      const reasons: Record<string, string> = {};
      eligibleOnPage.forEach((l) => { if (!selected.has(l.leadId)) reasons[l.leadId] = BEST_REASONS[i++ % BEST_REASONS.length]; });
      setSelected((prev) => { const n = new Set(prev); eligibleOnPage.forEach((l) => n.add(l.leadId)); return n; });
      setReasonByLead((r) => ({ ...reasons, ...r }));
    }
  };
  const clearSelection = () => { setSelected(new Set()); setReasonByLead({}); };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lsa/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/lsa/accounts"] });
  };

  const batchDispute = useMutation({
    mutationFn: async (items: { leadId: string; reason: string }[]) => (await apiRequest("POST", "/api/lsa/disputes", { items })).json(),
    onSuccess: (d: any) => {
      toast({ title: "Disputes queued", description: `${d?.queued ?? 0} lead(s) will be reported one at a time, 30–60s apart.` });
      clearSelection(); invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't queue disputes", description: e?.message || "Try again.", variant: "destructive" }),
  });
  const batchSchedule = useMutation({
    mutationFn: async (items: { leadId: string; reason: string; runAt: number }[]) => (await apiRequest("POST", "/api/lsa/disputes/schedule", { items })).json(),
    onSuccess: (d: any) => {
      toast({ title: "Disputes scheduled", description: `${d?.scheduled ?? 0} lead(s) scattered between ${scheduleStart} and ${scheduleEnd}.` });
      clearSelection(); setScheduleOpen(false); invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't schedule", description: e?.message || "Try again.", variant: "destructive" }),
  });

  const submitBatch = () => {
    const items = Array.from(selected).map((leadId) => ({ leadId, reason: reasonByLead[leadId] || BEST_REASONS[0] }));
    if (items.length) batchDispute.mutate(items);
  };
  const submitSchedule = () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const startMs = new Date(`${scheduleStart}T00:00:00`).getTime();
    const endMs = new Date(`${scheduleEnd}T23:59:59`).getTime();
    const times = scatterRunAts(ids.length, startMs, endMs);
    const items = ids.map((leadId, i) => ({ leadId, reason: reasonByLead[leadId] || BEST_REASONS[0], runAt: times[i] }));
    batchSchedule.mutate(items);
  };

  if (error) return <Notice tone="warning">Leads could not be loaded. <Button variant="outline" onClick={onBack}>Back to accounts</Button></Notice>;

  const totalSpend = account.costTotal != null ? Number(account.costTotal) : 0;

  return (
    <Section flush>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap items-center gap-2">
            <GooglePill icon={ArrowLeft} size="sm" variant="quiet" label="Accounts" onClick={onBack} testId="button-back-accounts" />
            <CardTitle className="g-card__title g-card__title--md">{account.descriptiveName || `Account ${account.customerId}`}</CardTitle>
            <span className="text-xs text-muted-foreground">{account.customerId}</span>
          </div>
        </div>
        <GoogleStatGrid cols={4} className="mt-3">
          <LeadStat label="Total leads" value={String(account.leadCount ?? 0)} testid="stat-leads" />
          <LeadStat label="Charged leads" value={String(account.chargedCount ?? 0)} testid="stat-charged" />
          <LeadStat label="Disputed" value={String(account.disputedCount ?? 0)} testid="stat-disputed" />
          <LeadStat label="Total spend" value={`$${money(totalSpend)}`} red testid="stat-spend" />
        </GoogleStatGrid>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <Toolbar className="mb-4" filters={<>
          {([["all", "All"], ["charged", "Charged"], ["disputed", "Disputed"]] as const).map(([v, label]) => (
            <GooglePill key={v} size="sm" selected={filter === v} ariaPressed={filter === v} label={label} onClick={() => setFilter(v)} testId={`button-filter-${v}`} />
          ))}
          <div className="g-search w-full sm:w-64" role="search"><Search aria-hidden="true" /><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, phone, service or status…" aria-label="Filter the leads on this page" data-testid="input-find-leads" /></div>
        </>} />

        {/* Bulk dispute toolbar */}
        {eligibleOnPage.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" className="h-4 w-4 accent-red-600" checked={allPageSelected} onChange={toggleSelectAllPage} data-testid="checkbox-select-all" />
                Select all on page
              </label>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setScheduleOpen((v) => !v)} disabled={selected.size === 0} className="flex items-center gap-1" data-testid="button-toggle-schedule">
                  <Clock className="w-4 h-4" /> Schedule for later
                </Button>
                <Button variant="outline" size="sm" onClick={submitBatch} disabled={selected.size === 0 || batchDispute.isPending} className="flex items-center gap-1" data-testid="button-report-now">
                  <ThumbsDown className="w-4 h-4" /> {batchDispute.isPending ? "Queuing…" : selected.size ? `Report ${selected.size} now` : "Report now"}
                </Button>
                {selected.size > 0 && <Button size="sm" variant="ghost" onClick={clearSelection} data-testid="button-clear-selection">Clear</Button>}
              </div>
            </div>
            {scheduleOpen && selected.size > 0 && (
              <div className="mt-3 rounded-md border border-border bg-muted bg-muted border-border p-3">
                <div className="text-sm font-medium flex items-center gap-1"><Clock className="w-4 h-4" /> Scatter {selected.size} dispute{selected.size > 1 ? "s" : ""} across a date range</div>
                <div className="flex flex-wrap items-end gap-3 mt-2">
                  <label className="text-xs"><span className="block mb-1">From</span>
                    <input type="date" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-schedule-start" />
                  </label>
                  <label className="text-xs"><span className="block mb-1">To</span>
                    <input type="date" value={scheduleEnd} min={scheduleStart} onChange={(e) => setScheduleEnd(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-schedule-end" />
                  </label>
                  <Button variant="outline" size="sm" onClick={submitSchedule} disabled={batchSchedule.isPending} className="flex items-center gap-1" data-testid="button-submit-schedule">
                    <Clock className="w-4 h-4" /> {batchSchedule.isPending ? "Scheduling…" : `Schedule ${selected.size}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Leads list */}
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading leads…</div>
        ) : leads.length === 0 ? (
          find.trim() ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No lead on this page matches “{find.trim()}”.</p>
          ) : filter !== "all" ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No {filter} leads for this account yet.</p>
          ) : (
            <SamplePreview what="what a lead looks like once this account has synced one" testId="sample-lsa-leads">
              <SampleLeads />
            </SamplePreview>
          )
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => {
              const selectable = isDisputable(lead);
              const isSelected = selected.has(lead.leadId);
              const isOpen = expanded.has(lead.id);
              return (
                <div key={lead.id} className="border rounded-lg p-4 dark:border-gray-700" data-testid={`row-lead-${lead.leadId}`}>
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <div className="flex items-start gap-2">
                      {selectable && (
                        <input type="checkbox" className="h-4 w-4 mt-1 accent-red-600" checked={isSelected} onChange={() => toggleSelect(lead.leadId)} data-testid={`checkbox-lead-${lead.leadId}`} />
                      )}
                      <div>
                        <div className="font-semibold text-foreground">{lead.contactName || "Google LSA lead"}</div>
                        {(lead.serviceId || lead.categoryId) && (
                          <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Wrench className="w-3.5 h-3.5" />
                            <span>{lead.serviceId || "—"}</span>
                            {lead.categoryId && <span className="text-gray-400">· {lead.categoryId}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <DisputeSticker lead={lead} />
                      <Badge variant="secondary">{lsaTypeLabel(lead.leadType)}</Badge>
                      {lead.leadCharged === true && (
                        <Badge className="bg-red-100 text-red-700 border-red-200">Charged{lead.leadCost != null ? ` · $${Number(lead.leadCost).toFixed(2)}` : ""}</Badge>
                      )}
                      {lead.leadCharged === false && <Badge className="bg-green-100 text-green-700 border-green-200">Not charged</Badge>}
                      {(lead.leadCreationTime || lead.createdAt) && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />{new Date((lead.leadCreationTime || lead.createdAt) as string).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-sm">
                    {lead.contactPhone && (
                      <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /><a href={`tel:${lead.contactPhone}`} className="text-muted-foreground hover:underline">{lead.contactPhone}</a></div>
                    )}
                    {lead.contactEmail && (
                      <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" /><span>{lead.contactEmail}</span></div>
                    )}
                    {!lead.contactPhone && !lead.contactEmail && <div className="text-muted-foreground italic">No contact details on this lead type</div>}
                  </div>

                  {isSelected && (
                    <div className="flex items-center gap-2 flex-wrap mt-3 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-2">
                      <span className="text-xs text-red-700 dark:text-red-300">Report reason:</span>
                      <ReasonSelect value={reasonByLead[lead.leadId] || BEST_REASONS[0]} onChange={(v) => setReasonByLead((r) => ({ ...r, [lead.leadId]: v }))} disabled={batchDispute.isPending} testid={`select-reason-${lead.leadId}`} />
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3">
                    <button type="button" onClick={() => toggleExpand(lead.id)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid={`button-expand-${lead.leadId}`}>
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{isOpen ? "Hide details" : "More details"}
                    </button>
                    <LeadRating lead={lead} onDone={invalidate} />
                  </div>

                  {isOpen && (
                    <div className="mt-2 rounded-md border bg-muted/40 p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <DetailRow icon={<Wrench className="w-3.5 h-3.5" />} label="Service" value={lead.serviceId || "—"} />
                      <DetailRow icon={<Tag className="w-3.5 h-3.5" />} label="Category" value={lead.categoryId || "—"} />
                      <DetailRow label="Lead type" value={lsaTypeLabel(lead.leadType)} />
                      <DetailRow label="Lead status" value={lead.leadStatus || "—"} />
                      <DetailRow label="Credit state" value={lead.creditState || "—"} />
                      <DetailRow label="Your rating" value={lead.disputeReason ? `Reported · ${reasonLabel(lead.disputeReason)}` : (lead.surveyAnswer || "Not rated")} />
                      <DetailRow label="Google lead ID" value={lead.leadId} mono />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pager */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 mt-4 text-sm">
            <span className="text-muted-foreground">Page {page} of {totalPages} · {total} leads</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-leads-prev"><ChevronLeft className="w-4 h-4" /> Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} data-testid="button-leads-next">Next <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Section>
  );
}

function LeadStat({ label, value, red, testid }: { label: string; value: string; red?: boolean; testid?: string }) {
  return <GoogleStat label={label} value={<span data-testid={testid}>{value}</span>} tone={red ? "bad" : "default"} />;
}

function DetailRow({ label, value, icon, mono }: { label: string; value: string; icon?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground min-w-[110px] flex items-center gap-1">{icon}{label}</span>
      <span className={`text-foreground break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

// Live sticker reflecting the local dispute pipeline so we never double-dispute.
function DisputeSticker({ lead }: { lead: LsaLead }) {
  const s = lead.disputeStatus;
  if (s === "scheduled") return <Badge className="bg-muted text-muted-foreground border-border flex items-center gap-1"><Clock className="w-3 h-3" /> Scheduled</Badge>;
  if (s === "queued") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1"><Clock className="w-3 h-3" /> Queued</Badge>;
  if (s === "sending") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Sending</Badge>;
  if (s === "disputed") return <Badge className="bg-muted text-muted-foreground border-border flex items-center gap-1"><ThumbsDown className="w-3 h-3" /> Disputed</Badge>;
  if (s === "failed") return <Badge className="bg-red-100 text-red-700 border-red-200 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Failed</Badge>;
  if (lead.feedbackSubmitted && lead.surveyAnswer === "SATISFIED") return <Badge className="bg-green-100 text-green-700 border-green-200 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Good</Badge>;
  return null;
}

// Per-lead rating: "Good" sends SATISFIED; "Bad" opens a reason picker and queues
// a single dispute through the same spaced pipeline as a batch.
function LeadRating({ lead, onDone }: { lead: LsaLead; onDone: () => void }) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState(BEST_REASONS[0]);

  const good = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/lsa/leads/${lead.leadId}/good`)).json(),
    onSuccess: () => { toast({ title: "Marked as a good lead" }); onDone(); },
    onError: (e: any) => toast({ title: "Couldn't submit", description: e?.message || "Try again.", variant: "destructive" }),
  });
  const bad = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lsa/disputes", { items: [{ leadId: lead.leadId, reason }] })).json(),
    onSuccess: () => { toast({ title: "Dispute queued", description: "It'll be reported to Google shortly." }); setPicking(false); onDone(); },
    onError: (e: any) => toast({ title: "Couldn't queue dispute", description: e?.message || "Try again.", variant: "destructive" }),
  });

  if (!isDisputable(lead)) return <span />;

  if (picking) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <ReasonSelect value={reason} onChange={setReason} disabled={bad.isPending} testid={`select-single-reason-${lead.leadId}`} />
        <Button variant="outline" size="sm" className="" onClick={() => bad.mutate()} disabled={bad.isPending} data-testid={`button-confirm-bad-${lead.leadId}`}>
          {bad.isPending ? "Queuing…" : "Report"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)} data-testid={`button-cancel-bad-${lead.leadId}`}>Cancel</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="flex items-center gap-1" onClick={() => good.mutate()} disabled={good.isPending} data-testid={`button-good-${lead.leadId}`}>
        <ThumbsUp className="w-3.5 h-3.5" /> Good
      </Button>
      <Button size="sm" variant="outline" className="flex items-center gap-1 border-red-200 text-red-700" onClick={() => setPicking(true)} data-testid={`button-bad-${lead.leadId}`}>
        <ThumbsDown className="w-3.5 h-3.5" /> Bad
      </Button>
    </div>
  );
}
