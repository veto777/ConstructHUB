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
      toast({ title: "Sync complete", description: `${data?.imported ?? 0} new lead(s) across ${data?.accountsSynced ?? 0} account(s).` });
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
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-lsa-leads">
      {/* Connection header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-green-600" />
                Google Local Services Ads (LSA)
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {!status?.configured
                  ? "Google Ads isn't configured on the server yet — add the app credentials to enable LSA."
                  : status.connected
                    ? "Your leads pull in automatically. Connect Telegram to get a DM the moment a new lead arrives, and manually report bad leads to Google for a billing credit."
                    : "Connect your own Google account to pull in your LSA phone-call & message leads (with phone numbers)."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {status?.connected ? (
                <>
                  <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="flex items-center gap-2" data-testid="button-sync">
                    <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    {syncMutation.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                  <Button variant="ghost" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} className="flex items-center gap-2" data-testid="button-disconnect">
                    <Unplug className="w-4 h-4" /> Disconnect
                  </Button>
                </>
              ) : status?.configured ? (
                <Button onClick={connect} className="flex items-center gap-2" data-testid="button-connect">
                  <Link2 className="w-4 h-4" /> Connect Google Ads
                </Button>
              ) : null}
            </div>
          </div>
          {status?.configured && !status.connected && status.redirectUri && (
            <RedirectUriHelp redirectUri={status.redirectUri} />
          )}
        </CardHeader>
        {status?.connected && status.connection && (
          <CardContent className="space-y-3">
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
            <TelegramPanel status={status} />
          </CardContent>
        )}
      </Card>

      {status?.connected && !selectedAccount && (
        <AccountsOverview onOpen={setSelectedAccount} />
      )}
      {status?.connected && selectedAccount && (
        <AccountDetail account={selectedAccount} onBack={() => setSelectedAccount(null)} />
      )}
    </div>
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
          <Button size="sm" onClick={() => linkMutation.mutate()} disabled={linkMutation.isPending} className="flex items-center gap-1" data-testid="button-telegram-link">
            <Send className="w-4 h-4" /> {linkMutation.isPending ? "Starting…" : "Link Telegram"}
          </Button>
          {deepLink && <a href={deepLink} target="_blank" rel="noreferrer" className="text-xs text-sky-600 underline">Open Telegram</a>}
        </div>
      )}
    </div>
  );
}

// ── Accounts overview ────────────────────────────────────────────────────────────
function AccountsOverview({ onOpen }: { onOpen: (a: LsaAccount) => void }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery<{ accounts: LsaAccount[]; total: number }>({
    queryKey: ["/api/lsa/accounts", debouncedQ, page],
    queryFn: () => getJson(`/api/lsa/accounts?q=${encodeURIComponent(debouncedQ)}&page=${page}&pageSize=${pageSize}`),
    refetchInterval: 60000,
  });
  const accounts = data?.accounts || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2"><Building2 className="w-5 h-5" /> Your Google Ads accounts</CardTitle>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" className="pl-8 w-64 h-9" data-testid="input-search-accounts" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No accounts yet. Once your first sync finishes, every Google Ads account you can access will appear here.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onOpen(a)}
                  className="w-full text-left border rounded-lg p-3 hover-elevate flex items-center justify-between gap-3"
                  data-testid={`card-account-${a.customerId}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate flex items-center gap-2">
                      {a.descriptiveName || `Account ${a.customerId}`}
                      {a.lsaEnrolled === true && <Badge className="bg-green-100 text-green-700 border-green-200">LSA</Badge>}
                      {a.isManager && <Badge variant="secondary">Manager</Badge>}
                      {!a.enabled && <Badge variant="outline">Paused</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.customerId}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="text-right">
                      <div className="font-semibold">{a.leadCount ?? 0}</div>
                      <div className="text-xs text-muted-foreground">leads</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-red-600">{a.chargedCount ?? 0}</div>
                      <div className="text-xs text-muted-foreground">charged</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
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
      </CardContent>
    </Card>
  );
}

// ── Account detail (leads + disputes) ────────────────────────────────────────────
function AccountDetail({ account, onBack }: { account: LsaAccount; onBack: () => void }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "charged" | "disputed">("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = useQuery<{ leads: LsaLead[]; total: number }>({
    queryKey: ["/api/lsa/leads", account.customerId, filter, page],
    queryFn: () => getJson(`/api/lsa/leads?customerId=${account.customerId}&filter=${filter}&page=${page}&pageSize=${pageSize}`),
    // Poll fast while any dispute is in flight so the live stickers update.
    refetchInterval: (query) => {
      const d = query.state.data as { leads: LsaLead[] } | undefined;
      const active = d?.leads?.some((l) => l.disputeStatus === "queued" || l.disputeStatus === "sending");
      return active ? 4000 : 30000;
    },
  });
  const leads = useMemo(() => data?.leads || [], [data]);
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

  const totalSpend = account.costTotal != null ? Number(account.costTotal) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onBack} data-testid="button-back-accounts"><ArrowLeft className="w-4 h-4" /> Accounts</Button>
            <CardTitle className="text-lg">{account.descriptiveName || `Account ${account.customerId}`}</CardTitle>
            <span className="text-xs text-muted-foreground">{account.customerId}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Stat label="Total leads" value={String(account.leadCount ?? 0)} testid="stat-leads" />
          <Stat label="Charged leads" value={String(account.chargedCount ?? 0)} testid="stat-charged" />
          <Stat label="Disputed" value={String(account.disputedCount ?? 0)} testid="stat-disputed" />
          <Stat label="Total spend" value={`$${money(totalSpend)}`} red testid="stat-spend" />
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-4">
          {([["all", "All"], ["charged", "Charged"], ["disputed", "Disputed"]] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)} data-testid={`button-filter-${v}`}>{label}</Button>
          ))}
        </div>

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
                <Button size="sm" onClick={submitBatch} disabled={selected.size === 0 || batchDispute.isPending} className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1" data-testid="button-report-now">
                  <ThumbsDown className="w-4 h-4" /> {batchDispute.isPending ? "Queuing…" : `Report ${selected.size || ""} now`}
                </Button>
                {selected.size > 0 && <Button size="sm" variant="ghost" onClick={clearSelection} data-testid="button-clear-selection">Clear</Button>}
              </div>
            </div>
            {scheduleOpen && selected.size > 0 && (
              <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-900 p-3">
                <div className="text-sm font-medium flex items-center gap-1"><Clock className="w-4 h-4" /> Scatter {selected.size} dispute{selected.size > 1 ? "s" : ""} across a date range</div>
                <div className="flex flex-wrap items-end gap-3 mt-2">
                  <label className="text-xs"><span className="block mb-1">From</span>
                    <input type="date" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-schedule-start" />
                  </label>
                  <label className="text-xs"><span className="block mb-1">To</span>
                    <input type="date" value={scheduleEnd} min={scheduleStart} onChange={(e) => setScheduleEnd(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-schedule-end" />
                  </label>
                  <Button size="sm" onClick={submitSchedule} disabled={batchSchedule.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1" data-testid="button-submit-schedule">
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
          <p className="text-sm text-muted-foreground py-6 text-center">No leads {filter !== "all" ? `(${filter})` : ""} for this account yet.</p>
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
                      <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /><a href={`tel:${lead.contactPhone}`} className="text-blue-600 hover:underline">{lead.contactPhone}</a></div>
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
    </Card>
  );
}

function Stat({ label, value, red, testid }: { label: string; value: string; red?: boolean; testid?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${red ? "text-red-600" : "text-foreground"}`} data-testid={testid}>{value}</div>
    </div>
  );
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
  if (s === "scheduled") return <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 flex items-center gap-1"><Clock className="w-3 h-3" /> Scheduled</Badge>;
  if (s === "queued") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1"><Clock className="w-3 h-3" /> Queued</Badge>;
  if (s === "sending") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Sending</Badge>;
  if (s === "disputed") return <Badge className="bg-purple-100 text-purple-700 border-purple-200 flex items-center gap-1"><ThumbsDown className="w-3 h-3" /> Disputed</Badge>;
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
        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => bad.mutate()} disabled={bad.isPending} data-testid={`button-confirm-bad-${lead.leadId}`}>
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
      <Button size="sm" variant="outline" className="flex items-center gap-1 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setPicking(true)} data-testid={`button-bad-${lead.leadId}`}>
        <ThumbsDown className="w-3.5 h-3.5" /> Bad
      </Button>
    </div>
  );
}
