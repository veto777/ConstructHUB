import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAdminToken } from "@/lib/admin-auth";
import { serviceLabel, categoryLabel, isNotOffered } from "@/lib/lsa-services";
import {
  Phone,
  Mail,
  Calendar,
  PhoneCall,
  RefreshCw,
  Link2,
  AlertTriangle,
  DollarSign,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  X,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wrench,
  Tag,
} from "lucide-react";

// Google Local Services Ads lead (imported from the Google Ads API).
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
  // Local dispute pipeline: null | queued | sending | disputed | failed.
  disputeStatus?: string | null;
  disputeScheduledAt?: string | null;
  leadCreationTime?: string | null;
  createdAt?: string | null;
}

// Reasons a lead can be marked "bad" — these map to Google's
// SurveyDissatisfiedReason and are how a lead gets flagged for a billing credit.
// The first three are the ones Google credits most reliably, so they're listed
// first and used as the auto-varied defaults for batch reports.
const BEST_REASONS = ["JOB_TYPE_MISMATCH", "SPAM", "SOLICITATION"];

// Spread N disputes across a date range, each at a random business-hour moment
// (~9am–6pm), so they trickle out over days/weeks instead of all at once —
// which looks far more natural to Google than one big burst.
function scatterRunAts(count: number, startMs: number, endMs: number): number[] {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const span = Math.max(hi - lo, 60_000);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(lo + Math.floor(Math.random() * span));
    d.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);
    let t = d.getTime();
    // Never schedule in the past — push at least a minute out.
    if (t < Date.now() + 60_000) t = Date.now() + 60_000 + Math.floor(Math.random() * 600_000);
    out.push(t);
  }
  return out;
}
const DISSATISFIED_REASONS: { value: string; label: string; best?: boolean }[] = [
  { value: "JOB_TYPE_MISMATCH", label: "Service I don't offer", best: true },
  { value: "SPAM", label: "Spam / bot / scam", best: true },
  { value: "SOLICITATION", label: "Sales call / solicitation", best: true },
  { value: "GEO_MISMATCH", label: "Outside my service area" },
  { value: "NOT_READY_TO_BOOK", label: "Customer wasn't ready to book" },
  { value: "DUPLICATE", label: "Duplicate lead" },
];

function reasonLabel(v?: string | null): string {
  if (!v) return "";
  return DISSATISFIED_REASONS.find((r) => r.value === v)?.label || v;
}

// A reason <select> that groups the 3 best (most-credited) reasons up top.
function ReasonSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const best = DISSATISFIED_REASONS.filter((r) => r.best);
  const other = DISSATISFIED_REASONS.filter((r) => !r.best);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={
        className ||
        "text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
      }
    >
      <optgroup label="Best for getting credited">
        {best.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </optgroup>
      <optgroup label="Other reasons">
        {other.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </optgroup>
    </select>
  );
}

interface LsaStatus {
  configured: boolean;
  connected: boolean;
  leadCount: number;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  lastSyncCount?: number;
  lastCostTotal?: string | null;
}

type PageSize = 50 | 100 | "all";

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

// A lead can still be disputed only if it isn't already rated or in the pipeline.
function isDisputable(lead: LsaLead): boolean {
  if (lead.feedbackSubmitted) return false;
  const s = lead.disputeStatus || "";
  return s !== "queued" && s !== "sending" && s !== "disputed" && s !== "scheduled";
}

export default function AdminLsaLeads() {
  const { toast } = useToast();

  const { data: lsaStatus } = useQuery<LsaStatus>({
    queryKey: ["/api/admin/google-ads/status"],
    queryFn: () => apiRequest("/api/admin/google-ads/status"),
    refetchInterval: 15000,
  });

  const { data: lsaLeadsData } = useQuery<LsaLead[]>({
    queryKey: ["/api/admin/google-ads/leads"],
    queryFn: () => apiRequest("/api/admin/google-ads/leads"),
    enabled: Boolean(lsaStatus?.connected),
    // Poll fast while disputes are queued/sending so stickers update live;
    // otherwise back off to a calm 30s (the server auto-syncs Google every 2 min).
    refetchInterval: (query) => {
      const data = query.state.data as LsaLead[] | undefined;
      const active = data?.some((l) => l.disputeStatus === "queued" || l.disputeStatus === "sending");
      return active ? 4000 : 30000;
    },
  });
  const lsaLeads = useMemo(() => lsaLeadsData || [], [lsaLeadsData]);

  // Billing roll-up. lastCostTotal is the REAL total Google billed (exact);
  // the per-lead figures are that spend spread across each day's charged leads.
  const chargedLeads = lsaLeads.filter((l) => l.leadCharged === true);
  const totalSpend =
    lsaStatus?.lastCostTotal != null
      ? Number(lsaStatus.lastCostTotal)
      : chargedLeads.reduce((sum, l) => sum + (l.leadCost != null ? Number(l.leadCost) : 0), 0);
  const avgPerLead = chargedLeads.length > 0 ? totalSpend / chargedLeads.length : 0;
  const queuedCount = lsaLeads.filter((l) => l.disputeStatus === "queued" || l.disputeStatus === "sending").length;

  const syncLsa = useMutation({
    mutationFn: () =>
      apiRequest("/api/admin/google-ads/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() ?? ""}` },
      }),
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast({ title: "Google LSA synced", description: `${data.imported ?? 0} lead(s) imported.` });
      } else {
        toast({ title: "Sync had a problem", description: data?.error || "Please try again.", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/leads"] });
    },
    onError: (e: any) => {
      toast({ title: "Sync failed", description: e?.message || "Please try again.", variant: "destructive" });
    },
  });

  // --- Filters & sorting --------------------------------------------------
  const [chargeFilter, setChargeFilter] = useState<"all" | "charged" | "uncharged">("all");
  const [minCost, setMinCost] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<"date-desc" | "date-asc" | "cost-desc" | "cost-asc">("date-desc");

  const leadDateMs = (l: LsaLead) => {
    const raw = l.leadCreationTime || l.createdAt;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const leadCostNum = (l: LsaLead) => {
    if (l.leadCost == null) return null;
    const n = Number(l.leadCost);
    return Number.isFinite(n) ? n : null;
  };

  const filtersActive =
    chargeFilter !== "all" || minCost.trim() !== "" || maxCost.trim() !== "" || dateFrom !== "" || dateTo !== "";
  const clearFilters = () => {
    setChargeFilter("all"); setMinCost(""); setMaxCost(""); setDateFrom(""); setDateTo("");
  };

  const filteredLeads = useMemo(() => {
    const lo = minCost.trim() === "" ? null : Number(minCost);
    const hi = maxCost.trim() === "" ? null : Number(maxCost);
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
    const out = lsaLeads.filter((l) => {
      if (chargeFilter === "charged" && l.leadCharged !== true) return false;
      if (chargeFilter === "uncharged" && l.leadCharged === true) return false;
      const cost = leadCostNum(l);
      if (lo != null && Number.isFinite(lo) && (cost == null || cost < lo)) return false;
      if (hi != null && Number.isFinite(hi) && (cost == null || cost > hi)) return false;
      if (fromMs != null || toMs != null) {
        const d = leadDateMs(l);
        if (fromMs != null && d < fromMs) return false;
        if (toMs != null && d > toMs) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      switch (sortKey) {
        case "cost-asc": return (leadCostNum(a) ?? 0) - (leadCostNum(b) ?? 0);
        case "cost-desc": return (leadCostNum(b) ?? 0) - (leadCostNum(a) ?? 0);
        case "date-asc": return leadDateMs(a) - leadDateMs(b);
        case "date-desc":
        default: return leadDateMs(b) - leadDateMs(a);
      }
    });
    return out;
  }, [lsaLeads, chargeFilter, minCost, maxCost, dateFrom, dateTo, sortKey]);

  // --- Pagination ---------------------------------------------------------
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(1);
  const total = filteredLeads.length;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);
  // Jump back to page 1 whenever the filter/sort changes so results aren't hidden.
  useEffect(() => {
    setPage(1);
  }, [chargeFilter, minCost, maxCost, dateFrom, dateTo, sortKey]);
  const pageLeads =
    pageSize === "all" ? filteredLeads : filteredLeads.slice((page - 1) * pageSize, page * pageSize);

  // --- Expandable detail rows --------------------------------------------
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // --- Bulk dispute selection (per-lead reasons, auto-varied) -------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonByLead, setReasonByLead] = useState<Record<string, string>>({});

  // Future-date scheduling — scatter the selected disputes across a date range.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDaysISO = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const [scheduleStart, setScheduleStart] = useState(() => addDaysISO(1));
  const [scheduleEnd, setScheduleEnd] = useState(() => addDaysISO(7));

  // Default a freshly-selected lead to a reason that rotates through the 3 best,
  // so a batch never reports everything with the same reason (that looks spammy).
  const setLeadReason = (leadId: string, reason: string) =>
    setReasonByLead((prev) => ({ ...prev, [leadId]: reason }));

  const toggleSelect = (leadId: string) => {
    const isOn = selected.has(leadId);
    if (isOn) {
      // Deselect: drop the lead and its reason so a later reselect re-rotates.
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
      setReasonByLead((r) => {
        const next = { ...r };
        delete next[leadId];
        return next;
      });
    } else {
      const lead = lsaLeads.find((l) => l.leadId === leadId);
      // A lead for a service we don't offer is, by definition, "Service I don't
      // offer" — so default it there instead of the rotated reason.
      const defaultReason = isNotOffered(lead?.serviceId)
        ? "JOB_TYPE_MISMATCH"
        : BEST_REASONS[selected.size % BEST_REASONS.length];
      setSelected((prev) => new Set(prev).add(leadId));
      setReasonByLead((r) => ({ ...r, [leadId]: defaultReason }));
    }
  };

  const eligibleOnPage = pageLeads.filter(isDisputable);
  const allPageSelected = eligibleOnPage.length > 0 && eligibleOnPage.every((l) => selected.has(l.leadId));
  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      const ids = eligibleOnPage.map((l) => l.leadId);
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setReasonByLead((r) => {
        const next = { ...r };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    } else {
      let i = selected.size;
      const reasons: Record<string, string> = {};
      eligibleOnPage.forEach((l) => {
        if (!selected.has(l.leadId)) {
          // Not-offered leads always get "Service I don't offer"; the rest rotate
          // through the 3 best reasons so the batch doesn't look automated.
          if (isNotOffered(l.serviceId)) {
            reasons[l.leadId] = "JOB_TYPE_MISMATCH";
          } else {
            reasons[l.leadId] = BEST_REASONS[i % BEST_REASONS.length];
            i++;
          }
        }
      });
      setSelected((prev) => {
        const next = new Set(prev);
        eligibleOnPage.forEach((l) => next.add(l.leadId));
        return next;
      });
      setReasonByLead((r) => ({ ...reasons, ...r }));
    }
  };

  // Leads on this page that are for a service we don't offer and can still be
  // reported. Only CHARGED leads are included — disputing a lead Google never
  // billed you for recovers nothing and just pads your dispute count.
  const notOfferedOnPage = eligibleOnPage.filter(
    (l) => isNotOffered(l.serviceId) && l.leadCharged === true,
  );
  // One click: select every "not offered" lead on the page, each with the
  // accurate "Service I don't offer" reason.
  const selectAllNotOffered = () => {
    if (notOfferedOnPage.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      notOfferedOnPage.forEach((l) => next.add(l.leadId));
      return next;
    });
    setReasonByLead((prev) => {
      const next = { ...prev };
      notOfferedOnPage.forEach((l) => { next[l.leadId] = "JOB_TYPE_MISMATCH"; });
      return next;
    });
  };

  // Re-spread the 3 best reasons across everything currently selected.
  const autoVaryReasons = () => {
    setReasonByLead((prev) => {
      const next = { ...prev };
      let i = 0;
      Array.from(selected).forEach((leadId) => {
        const lead = lsaLeads.find((l) => l.leadId === leadId);
        // Leave not-offered leads on the accurate "Service I don't offer" reason.
        if (isNotOffered(lead?.serviceId)) {
          next[leadId] = "JOB_TYPE_MISMATCH";
        } else {
          next[leadId] = BEST_REASONS[i % BEST_REASONS.length];
          i++;
        }
      });
      return next;
    });
    toast({ title: "Reasons mixed up", description: "Spread across the 3 best reasons so it doesn't look automated." });
  };

  const batchDispute = useMutation({
    mutationFn: (items: { leadId: string; reason: string }[]) =>
      apiRequest("/api/admin/google-ads/leads/dispute-batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() ?? ""}` },
        body: JSON.stringify({ items }),
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Disputes queued",
        description: `${data?.queued ?? 0} lead(s) will be reported to Google one at a time, 30–60 seconds apart.`,
      });
      setSelected(new Set());
      setReasonByLead({});
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/leads"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't queue disputes", description: e?.message || "Please try again.", variant: "destructive" });
    },
  });

  const submitBatch = () => {
    const items = Array.from(selected).map((leadId) => ({
      leadId,
      reason: reasonByLead[leadId] || BEST_REASONS[0],
    }));
    if (items.length === 0) return;
    batchDispute.mutate(items);
  };

  const batchSchedule = useMutation({
    mutationFn: (items: { leadId: string; reason: string; runAt: number }[]) =>
      apiRequest("/api/admin/google-ads/leads/schedule-batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() ?? ""}` },
        body: JSON.stringify({ items }),
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Disputes scheduled",
        description: `${data?.scheduled ?? 0} lead(s) will be reported automatically, scattered between ${scheduleStart} and ${scheduleEnd}.`,
      });
      setSelected(new Set());
      setReasonByLead({});
      setScheduleOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/leads"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't schedule disputes", description: e?.message || "Please try again.", variant: "destructive" });
    },
  });

  const submitSchedule = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const startMs = new Date(`${scheduleStart}T00:00:00`).getTime();
    const endMs = new Date(`${scheduleEnd}T23:59:59`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      toast({ title: "Pick a start and end date", variant: "destructive" });
      return;
    }
    const times = scatterRunAts(ids.length, startMs, endMs);
    const items = ids.map((leadId, i) => ({
      leadId,
      reason: reasonByLead[leadId] || BEST_REASONS[0],
      runAt: times[i],
    }));
    batchSchedule.mutate(items);
  };

  const connectGoogleAds = () => {
    window.open("/api/admin/google-ads/oauth/start", "_blank", "width=520,height=700");
  };

  return (
    <AdminLayout title="Google LSA Leads">
      <div className="space-y-6">
        {/* Connection / sync header */}
        <Card className="border-blue-200">
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PhoneCall className="w-5 h-5 text-green-600" />
                  Google Local Services Ads (LSA)
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {!lsaStatus?.configured
                    ? "Google Ads is not configured on the server yet."
                    : lsaStatus.connected
                      ? "Leads pull in automatically every couple of minutes — no need to hit Sync. You also get a Telegram alert the moment a new one arrives."
                      : "Connect your Google account to pull in LSA phone-call & message leads (with phone numbers)."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lsaStatus?.connected ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => syncLsa.mutate()}
                      disabled={syncLsa.isPending}
                      className="flex items-center gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${syncLsa.isPending ? "animate-spin" : ""}`} />
                      {syncLsa.isPending ? "Syncing…" : "Sync now"}
                    </Button>
                    <Button variant="ghost" onClick={connectGoogleAds} className="flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Reconnect
                    </Button>
                  </>
                ) : lsaStatus?.configured ? (
                  <Button onClick={connectGoogleAds} className="flex items-center gap-2">
                    <Link2 className="w-4 h-4" />
                    Connect Google Ads
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          {lsaStatus?.connected && (
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500">Total leads</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{lsaLeads.length}</div>
                </div>
                <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500">Charged leads</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{chargedLeads.length}</div>
                </div>
                <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500">Total Google Ads spend</div>
                  <div className="text-xl font-bold text-red-600 flex items-center">
                    <DollarSign className="w-4 h-4" />{money(totalSpend)}
                  </div>
                </div>
                <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-3">
                  <div className="text-xs text-gray-500">Avg per charged lead</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
                    <DollarSign className="w-4 h-4" />{money(avgPerLead)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 dark:text-gray-400 mt-3">
                {lsaStatus.lastSyncAt && (
                  <span>Last updated {new Date(lsaStatus.lastSyncAt).toLocaleString()}</span>
                )}
                <span>New leads refresh on their own about every 2 minutes.</span>
              </div>
              {queuedCount > 0 && (
                <div className="flex items-start gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-3 mt-4">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {queuedCount} dispute(s) in progress — being sent to Google one at a time, 30–60 seconds apart, so it
                    never looks automated. You can leave this page; it keeps going.
                  </span>
                </div>
              )}
              {lsaStatus.lastSyncError && (
                <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 mt-4">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="break-all">Last sync issue: {lsaStatus.lastSyncError}</span>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Leads list */}
        {lsaStatus?.connected && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg">Leads from Google Ads</CardTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Show:</span>
                  {([50, 100, "all"] as PageSize[]).map((size) => (
                    <Button
                      key={String(size)}
                      size="sm"
                      variant={pageSize === size ? "default" : "outline"}
                      onClick={() => { setPageSize(size); setPage(1); }}
                    >
                      {size === "all" ? "All" : size}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {lsaLeads.length > 0 ? (
                <>
                  {/* Filter & sort bar */}
                  <div className="rounded-lg border bg-white dark:bg-gray-900/20 dark:border-gray-700 p-3 mb-4">
                    <div className="flex items-end gap-3 flex-wrap">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Charged?</div>
                        <div className="flex items-center gap-1">
                          {([["all", "All"], ["charged", "Charged"], ["uncharged", "Not charged"]] as const).map(([v, label]) => (
                            <Button key={v} size="sm" variant={chargeFilter === v ? "default" : "outline"} onClick={() => setChargeFilter(v)}>
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <label className="text-xs text-gray-500">
                        <span className="block mb-1">Min $</span>
                        <input type="number" inputMode="numeric" min="0" value={minCost} onChange={(e) => setMinCost(e.target.value)} placeholder="0" className="w-24 border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </label>
                      <label className="text-xs text-gray-500">
                        <span className="block mb-1">Max $</span>
                        <input type="number" inputMode="numeric" min="0" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="any" className="w-24 border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </label>
                      <label className="text-xs text-gray-500">
                        <span className="block mb-1">From date</span>
                        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </label>
                      <label className="text-xs text-gray-500">
                        <span className="block mb-1">To date</span>
                        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </label>
                      <label className="text-xs text-gray-500">
                        <span className="block mb-1">Sort by</span>
                        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} className="border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700">
                          <option value="date-desc">Newest first</option>
                          <option value="date-asc">Oldest first</option>
                          <option value="cost-asc">Cost: low to high</option>
                          <option value="cost-desc">Cost: high to low</option>
                        </select>
                      </label>
                      {filtersActive && (
                        <Button size="sm" variant="ghost" onClick={clearFilters} className="text-gray-600">Clear filters</Button>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Showing {total} of {lsaLeads.length} lead{lsaLeads.length === 1 ? "" : "s"}{filtersActive ? " (filtered)" : ""}.
                    </div>
                  </div>

                  {/* Bulk dispute toolbar */}
                  <div className="rounded-lg border bg-gray-50 dark:bg-gray-900/40 dark:border-gray-700 p-3 mb-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-red-600"
                          checked={allPageSelected}
                          onChange={toggleSelectAllPage}
                          disabled={eligibleOnPage.length === 0}
                        />
                        Select all on page
                      </label>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{selected.size} selected</span>
                      {notOfferedOnPage.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={selectAllNotOffered}
                          disabled={batchDispute.isPending}
                          className="border-orange-300 text-orange-800 hover:bg-orange-50 flex items-center gap-1"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Select {notOfferedOnPage.length} not-offered
                        </Button>
                      )}
                      <div className="flex items-center gap-2 ml-auto flex-wrap">
                        {selected.size > 1 && (
                          <Button size="sm" variant="outline" onClick={autoVaryReasons} disabled={batchDispute.isPending}>
                            Mix up reasons
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setScheduleOpen((v) => !v)}
                          disabled={selected.size === 0 || batchDispute.isPending || batchSchedule.isPending}
                          className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 flex items-center gap-1"
                        >
                          <Clock className="w-4 h-4" />
                          Schedule for later
                        </Button>
                        <Button
                          size="sm"
                          onClick={submitBatch}
                          disabled={selected.size === 0 || batchDispute.isPending}
                          className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1"
                        >
                          <ThumbsDown className="w-4 h-4" />
                          {batchDispute.isPending ? "Queuing…" : `Report ${selected.size || ""} now (spaced out)`}
                        </Button>
                        {selected.size > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setReasonByLead({}); }}>
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    {selected.size > 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        Each lead gets its own reason (auto-mixed across the 3 best so it doesn't look spammy). Set a
                        lead's reason in its row below before reporting.
                      </p>
                    )}
                    {scheduleOpen && selected.size > 0 && (
                      <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-900 p-3">
                        <div className="text-sm font-medium text-indigo-900 dark:text-indigo-200 flex items-center gap-1">
                          <Clock className="w-4 h-4" /> Scatter {selected.size} dispute{selected.size > 1 ? "s" : ""} across a date range
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          Each lead gets reported on its own at a random business-hour moment between these dates — so they
                          trickle out naturally instead of all at once. You can close the app; the schedule runs on the server.
                        </p>
                        <div className="flex flex-wrap items-end gap-3 mt-2">
                          <label className="text-xs text-gray-700 dark:text-gray-300">
                            <span className="block mb-1">From</span>
                            <input
                              type="date"
                              value={scheduleStart}
                              min={todayISO()}
                              onChange={(e) => setScheduleStart(e.target.value)}
                              className="border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700"
                            />
                          </label>
                          <label className="text-xs text-gray-700 dark:text-gray-300">
                            <span className="block mb-1">To</span>
                            <input
                              type="date"
                              value={scheduleEnd}
                              min={scheduleStart}
                              onChange={(e) => setScheduleEnd(e.target.value)}
                              className="border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:border-gray-700"
                            />
                          </label>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setScheduleStart(addDaysISO(1)); setScheduleEnd(addDaysISO(7)); }} disabled={batchSchedule.isPending}>This week</Button>
                            <Button size="sm" variant="outline" onClick={() => { setScheduleStart(addDaysISO(1)); setScheduleEnd(addDaysISO(14)); }} disabled={batchSchedule.isPending}>2 weeks</Button>
                            <Button size="sm" variant="outline" onClick={() => { setScheduleStart(addDaysISO(1)); setScheduleEnd(addDaysISO(30)); }} disabled={batchSchedule.isPending}>This month</Button>
                          </div>
                          <Button
                            size="sm"
                            onClick={submitSchedule}
                            disabled={batchSchedule.isPending}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1"
                          >
                            <Clock className="w-4 h-4" />
                            {batchSchedule.isPending ? "Scheduling…" : `Schedule ${selected.size}`}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {pageLeads.length === 0 && (
                      <div className="text-center py-8 text-gray-500 text-sm">
                        No leads match these filters.{" "}
                        <button className="underline hover:text-gray-700" onClick={clearFilters}>Clear filters</button>
                      </div>
                    )}
                    {pageLeads.map((lead) => {
                      const selectable = isDisputable(lead);
                      const isSelected = selected.has(lead.leadId);
                      const svc = serviceLabel(lead.serviceId);
                      const cat = categoryLabel(lead.categoryId);
                      const notOffered = isNotOffered(lead.serviceId);
                      const isOpen = expanded.has(lead.id);
                      return (
                        <div key={lead.id} className="border rounded-lg p-4 hover:shadow-sm transition-shadow dark:border-gray-700">
                          <div className="flex justify-between items-start flex-wrap gap-2">
                            <div className="flex items-start gap-2">
                              {selectable && (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 mt-1 accent-red-600"
                                  checked={isSelected}
                                  onChange={() => toggleSelect(lead.leadId)}
                                  title="Select for bulk dispute"
                                />
                              )}
                              <div>
                                <div className="font-semibold text-gray-900 dark:text-white">
                                  {lead.contactName || "Google LSA lead"}
                                </div>
                                {svc && (
                                  <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1 mt-0.5">
                                    <Wrench className="w-3.5 h-3.5 text-gray-500" />
                                    <span className="font-medium">{svc}</span>
                                    {cat && <span className="text-gray-400">· {cat}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {notOffered && (
                                <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Service not offered — disputable
                                </Badge>
                              )}
                              <Badge variant="secondary">{lsaTypeLabel(lead.leadType)}</Badge>
                              {lead.leadStatus && <Badge variant="outline">{lead.leadStatus}</Badge>}
                              {lead.leadCharged === true && (
                                <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200">
                                  Charged{lead.leadCost != null ? ` · $${Number(lead.leadCost).toFixed(2)}` : ""}
                                </Badge>
                              )}
                              {lead.leadCharged === false && (
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Not charged</Badge>
                              )}
                              {(lead.leadCreationTime || lead.createdAt) && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date((lead.leadCreationTime || lead.createdAt) as string).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-sm">
                            {lead.contactPhone && (
                              <div className="flex items-center gap-2">
                                <Phone className="w-4 h-4 text-gray-500" />
                                <a href={`tel:${lead.contactPhone}`} className="text-blue-700 hover:underline">{lead.contactPhone}</a>
                              </div>
                            )}
                            {lead.contactEmail && (
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-gray-500" />
                                <span>{lead.contactEmail}</span>
                              </div>
                            )}
                            {!lead.contactPhone && !lead.contactEmail && (
                              <div className="text-gray-500 italic">No contact details on this lead type</div>
                            )}
                          </div>

                          {/* Per-lead reason picker (only when this lead is selected for a batch report) */}
                          {isSelected && (
                            <div className="flex items-center gap-2 flex-wrap mt-3 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-2">
                              <span className="text-xs text-red-700 dark:text-red-300">Report reason:</span>
                              <ReasonSelect
                                value={reasonByLead[lead.leadId] || BEST_REASONS[0]}
                                onChange={(v) => setLeadReason(lead.leadId, v)}
                                disabled={batchDispute.isPending}
                              />
                            </div>
                          )}

                          {/* Expandable details */}
                          <button
                            type="button"
                            onClick={() => toggleExpand(lead.id)}
                            className="mt-3 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
                          >
                            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            {isOpen ? "Hide details" : "More details"}
                          </button>
                          {isOpen && (
                            <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                              <DetailRow icon={<Wrench className="w-3.5 h-3.5" />} label="Service requested" value={svc || "—"} />
                              <DetailRow icon={<Tag className="w-3.5 h-3.5" />} label="Category" value={cat || "—"} />
                              <DetailRow label="Lead type" value={lsaTypeLabel(lead.leadType)} />
                              <DetailRow label="Lead status" value={lead.leadStatus || "—"} />
                              <DetailRow label="Name" value={lead.contactName || "—"} />
                              <DetailRow label="Phone" value={lead.contactPhone || "—"} />
                              <DetailRow label="Email" value={lead.contactEmail || "—"} />
                              <DetailRow
                                label="Charged"
                                value={
                                  lead.leadCharged === true
                                    ? `Yes${lead.leadCost != null ? ` · $${Number(lead.leadCost).toFixed(2)}` : ""}`
                                    : lead.leadCharged === false
                                      ? "No"
                                      : "—"
                                }
                              />
                              <DetailRow
                                label="Received"
                                value={
                                  lead.leadCreationTime || lead.createdAt
                                    ? new Date((lead.leadCreationTime || lead.createdAt) as string).toLocaleString()
                                    : "—"
                                }
                              />
                              <DetailRow label="Credit state" value={lead.creditState || "—"} />
                              <DetailRow
                                label="Your rating"
                                value={
                                  lead.disputeReason
                                    ? `Reported · ${reasonLabel(lead.disputeReason)}`
                                    : (lead.surveyAnswer || "Not rated")
                                }
                              />
                              <DetailRow label="Google lead ID" value={lead.leadId} mono />
                            </div>
                          )}

                          <LeadRating lead={lead} />
                        </div>
                      );
                    })}
                  </div>

                  {/* Pager */}
                  {pageSize !== "all" && totalPages > 1 && (
                    <div className="flex items-center justify-between gap-3 mt-4 text-sm">
                      <span className="text-gray-500">
                        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex items-center gap-1">
                          <ChevronLeft className="w-4 h-4" /> Prev
                        </Button>
                        <span>Page {page} of {totalPages}</span>
                        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="flex items-center gap-1">
                          Next <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No LSA leads imported yet. Click <span className="font-medium">Sync now</span> to pull the latest.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}

function DetailRow({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 min-w-[110px] flex items-center gap-1">{icon}{label}</span>
      <span className={`text-gray-900 dark:text-gray-100 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

// Per-lead rating control. "Good" sends a SATISFIED rating to Google; "Bad" opens
// a reason picker and sends DISSATISFIED + reason, which is how a lead is flagged
// for a billing credit. Live stickers reflect the dispute pipeline so we never
// dispute the same lead twice.
function LeadRating({ lead }: { lead: LsaLead }) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState(BEST_REASONS[0]);

  const rate = useMutation({
    mutationFn: (body: { surveyAnswer: string; dissatisfiedReason?: string }) =>
      apiRequest(`/api/admin/google-ads/leads/${lead.leadId}/feedback`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() ?? ""}` },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast({ title: "Lead rated", description: "Your rating was sent to Google." });
      setPicking(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/leads"] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't rate this lead",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const cancelSchedule = useMutation({
    mutationFn: () =>
      apiRequest("/api/admin/google-ads/leads/unschedule", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() ?? ""}` },
        body: JSON.stringify({ leadIds: [lead.leadId] }),
      }),
    onSuccess: () => {
      toast({ title: "Schedule cancelled", description: "This lead won't be disputed." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/google-ads/leads"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't cancel", description: e?.message || "Please try again.", variant: "destructive" });
    },
  });

  const status = lead.disputeStatus || "";

  // Scheduled for a future date — show when, and allow cancelling before it sends.
  if (status === "scheduled") {
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
        <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-200 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Scheduled{lead.disputeScheduledAt ? ` for ${new Date(lead.disputeScheduledAt).toLocaleString()}` : ""}
        </Badge>
        {lead.disputeReason && <span className="text-xs text-gray-500">({reasonLabel(lead.disputeReason)})</span>}
        <Button
          size="sm"
          variant="ghost"
          disabled={cancelSchedule.isPending}
          onClick={() => cancelSchedule.mutate()}
          className="text-gray-600 h-7 px-2"
        >
          {cancelSchedule.isPending ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    );
  }

  // Queued for a spaced-out dispute — locked so it can't be disputed again.
  if (status === "queued") {
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Queued — waiting its turn
        </Badge>
      </div>
    );
  }

  // Mid-flight to Google right now.
  if (status === "sending") {
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Sending to Google…
        </Badge>
      </div>
    );
  }

  // Already rated — show the result (and any credit status from a dispute).
  if (lead.feedbackSubmitted || status === "disputed") {
    const answer = (lead.surveyAnswer || "").toUpperCase();
    const isBad = answer.includes("DISSATISFIED") || status === "disputed";
    const isGood = answer === "SATISFIED" || answer === "VERY_SATISFIED";
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
        {isGood ? (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Rated good
          </Badge>
        ) : (
          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Disputed
          </Badge>
        )}
        {isBad && lead.disputeReason && (
          <span className="text-xs text-gray-500">({reasonLabel(lead.disputeReason)})</span>
        )}
        {lead.creditState && (
          <Badge variant="outline">Credit: {lead.creditState}</Badge>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {status === "failed" && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1 mb-2 w-fit">
          <AlertTriangle className="w-3 h-3" />
          Last dispute didn't go through — you can try again.
        </div>
      )}
      {!picking ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Rate this lead:</span>
          <Button
            size="sm"
            variant="outline"
            disabled={rate.isPending}
            onClick={() => rate.mutate({ surveyAnswer: "SATISFIED" })}
            className="flex items-center gap-1 text-green-700 border-green-200 hover:bg-green-50"
          >
            <ThumbsUp className="w-4 h-4" />
            Good lead
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rate.isPending}
            onClick={() => setPicking(true)}
            className="flex items-center gap-1 text-red-700 border-red-200 hover:bg-red-50"
          >
            <ThumbsDown className="w-4 h-4" />
            Bad lead
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-2">
          <span className="text-xs text-red-700 dark:text-red-300">Why was it bad?</span>
          <ReasonSelect value={reason} onChange={setReason} disabled={rate.isPending} />
          <Button
            size="sm"
            disabled={rate.isPending}
            onClick={() => rate.mutate({ surveyAnswer: "DISSATISFIED", dissatisfiedReason: reason })}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {rate.isPending ? "Sending…" : "Submit & request credit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rate.isPending}
            onClick={() => setPicking(false)}
            className="flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
