/**
 * Leads (/crm/leads): every request for work from every intake in one list (server/crm/leads.ts). Owner request
 * 2026-10-17: sync the forms on the contractor's own site, show them on a Leads page, connect it all in one place.
 *
 * Tabs by status with whole-list counts, search, a source filter, and per-row actions: details, mark contacted,
 * convert to client (a new client needs an address), archive, and the matched client when there is one. The
 * "Connect your lead sources" panel holds the form-sync script, the hosted form, Call Assistant and HOVER.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Magnet, Search, Loader2, Mail, Phone, MoreHorizontal, Copy, ChevronDown, Globe, PhoneCall, Ruler, FileCode2,
  CheckCircle2, Circle, ExternalLink, UserPlus, Archive, PhoneOutgoing, Eye, User, Megaphone, Link2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { marketingUrl } from "@/lib/site";
import { SegmentedTabs, TabCount } from "@/components/tool";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard, InitialAvatar, StatusPill, crmTable, crmTableCards, type PillTone } from "@/components/crm-ui";
import { SortSelect, SortableTh, useTableSort, type SortColumn } from "@/components/sortable-th";

type LeadStatus = "new" | "contacted" | "converted" | "archived" | "spam";
type LeadSource = "website_form" | "form_sync" | "call_assistant" | "import" | "manual";

interface Lead {
  id: string;
  source: LeadSource;
  sourceName: string;
  sourceLabel: string | null;
  /** Where it came from, as the contractor thinks of it (server/crm/lead-channel.ts): Google Ads, Facebook, Website, Phone call… */
  channel: { key: string; label: string; detail: string | null };
  name: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  service: string | null;
  message: string | null;
  pageUrl: string | null;
  fields: Record<string, string> | null;
  status: LeadStatus;
  customerId: string | null;
  customer: { id: string; displayName: string } | null;
  receivedAt: string;
}

interface LeadPage {
  rows: Lead[];
  total: number;
  counts: Record<LeadStatus, number>;
  limit: number;
  offset: number;
  everAny: boolean;
}

interface SourceStat { count: number; lastLeadAt: string | null; connected?: boolean }
interface Connect {
  canIntegrations: boolean;
  formSync: SourceStat & { snippet: string | null };
  websiteForm: SourceStat & { formUrl: string | null };
  callAssistant: SourceStat;
  hover: { connected: boolean; lastSyncAt: string | null };
}

const TABS: { key: LeadStatus; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "converted", label: "Converted" },
  { key: "archived", label: "Archived" },
  { key: "spam", label: "Spam" },
];

const SOURCES: { key: LeadSource | "all"; label: string }[] = [
  { key: "all", label: "All sources" },
  { key: "form_sync", label: "Your website forms" },
  { key: "website_form", label: "ConstructHUB form" },
  { key: "call_assistant", label: "Call Assistant" },
  { key: "import", label: "Imported" },
];

const STATUS_TONE: Record<LeadStatus, PillTone> = {
  new: "info", contacted: "warning", converted: "success", archived: "neutral", spam: "danger",
};

const PAGE_SIZE = 50;

/** Every column header sorts (GET /api/crm/leads?sort=&dir= — ordered in SQL so "Load more" keeps the order). */
type LeadSortKey = "name" | "contact" | "service" | "source" | "receivedAt";
const LEAD_SORT_KEYS: readonly LeadSortKey[] = ["name", "contact", "service", "source", "receivedAt"];
const LEAD_SORT_COLUMNS: SortColumn<LeadSortKey>[] = [
  { key: "name", label: "Lead", kind: "text" },
  { key: "contact", label: "Contact", kind: "text" },
  { key: "service", label: "Asked for", kind: "text" },
  { key: "source", label: "From", kind: "text" },
  { key: "receivedAt", label: "Received", kind: "date" },
];

const when = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** The Received column: the day on one line, the time under it, so the column stays narrow. */
const whenParts = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return [d.toLocaleDateString([], { month: "short", day: "numeric" }), d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })] as const;
};

const leadName = (l: Lead) => l.name || l.email || l.phone || "No name given";
const place = (l: Lead) => [l.addressLine1, l.city, l.state, l.postalCode].filter(Boolean).join(", ");

/** A 16px mark for the channel: a lettered badge in the site's colour, or an icon for the website, phone and the rest. */
const CHANNEL_BADGE: Record<string, { letter: string; className: string }> = {
  google_ads: { letter: "G", className: "border border-border bg-white text-[#4285F4]" },
  google: { letter: "G", className: "border border-border bg-white text-[#4285F4]" },
  meta_ads: { letter: "f", className: "bg-[#1877F2] text-white" },
  facebook: { letter: "f", className: "bg-[#1877F2] text-white" },
  instagram: { letter: "I", className: "bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white" },
  microsoft_ads: { letter: "B", className: "bg-[#008373] text-white" },
  bing: { letter: "B", className: "bg-[#008373] text-white" },
  youtube: { letter: "▶", className: "bg-[#FF0000] text-white" },
  tiktok: { letter: "T", className: "bg-black text-white" },
  yelp: { letter: "Y", className: "bg-[#D32323] text-white" },
  nextdoor: { letter: "N", className: "bg-[#8ED500] text-[#1f2a00]" },
  angi: { letter: "A", className: "bg-[#FF6153] text-white" },
  thumbtack: { letter: "T", className: "bg-[#009FD9] text-white" },
  houzz: { letter: "H", className: "bg-[#4DBC15] text-white" },
};
function ChannelMark({ k }: { k: string }) {
  const badge = CHANNEL_BADGE[k];
  if (badge) {
    return <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none ${badge.className}`}>{badge.letter}</span>;
  }
  const Icon = k === "phone" ? PhoneCall : k === "manual" ? UserPlus : k === "campaign" ? Megaphone : k === "referral" ? Link2 : Globe;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function readParams(): { tab: LeadStatus; q: string; source: LeadSource | "all"; lead: string | null } {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const t = p.get("tab");
  const s = p.get("source");
  return {
    tab: TABS.some((x) => x.key === t) ? (t as LeadStatus) : "new",
    q: p.get("q") ?? "",
    source: SOURCES.some((x) => x.key === s) ? (s as LeadSource | "all") : "all",
    lead: p.get("lead"),
  };
}

export default function CrmLeadsPage() {
  const { toast } = useToast();
  const [initial] = useState(readParams);
  const [tab, setTab] = useState<LeadStatus>(initial.tab);
  const [source, setSource] = useState<LeadSource | "all">(initial.source);
  const [q, setQ] = useState(initial.q);
  const [qDebounced, setQDebounced] = useState(initial.q);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const [openId, setOpenId] = useState<string | null>(initial.lead);
  const [converting, setConverting] = useState<Lead | null>(null);
  const { sort, setSort, onSort } = useTableSort<LeadSortKey>("receivedAt", "desc", "leads", { keys: LEAD_SORT_KEYS });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? params.set(k, v) : params.delete(k));
    set("q", qDebounced.trim() || null);
    set("tab", tab !== "new" ? tab : null);
    set("source", source !== "all" ? source : null);
    set("lead", openId);
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [qDebounced, tab, source, openId]);

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;
  const canJobs = me?.permissions?.manageJobs === true;
  const canSettings = me?.permissions?.manageSettings === true;

  const { data, isLoading, isError, isPlaceholderData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["/api/crm/leads", "list", tab, source, qDebounced, sort.key, sort.dir],
    enabled: canManage,
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<LeadPage> => {
      const params = new URLSearchParams({
        status: tab, limit: String(PAGE_SIZE), offset: String(pageParam), sort: sort.key, dir: sort.dir,
      });
      if (source !== "all") params.set("source", source);
      if (qDebounced.trim()) params.set("q", qDebounced.trim());
      const r = await fetch(`/api/crm/leads?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    getNextPageParam: (last: LeadPage) => {
      const next = last.offset + last.rows.length;
      return last.rows.length > 0 && next < last.total ? next : undefined;
    },
  });
  const rows = data ? Array.from(new Map(data.pages.flatMap((p) => p.rows).map((l) => [l.id, l] as const)).values()) : undefined;
  const latest = data?.pages[data.pages.length - 1];

  const { data: connect } = useQuery<Connect>({ queryKey: ["/api/crm/leads/connect"], enabled: canManage });
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const noLeadsEver = latest ? !latest.everAny : false;
  const panelIsOpen = panelOpen ?? noLeadsEver;

  const invalidate = () => queryClient.invalidateQueries({ predicate: (qq) => String(qq.queryKey[0] ?? "").startsWith("/api/crm/leads") });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LeadStatus }) =>
      (await apiRequest("PATCH", `/api/crm/leads/${id}`, { status })).json(),
    onSuccess: (_r, v) => {
      invalidate();
      toast({ title: v.status === "contacted" ? "Marked contacted" : v.status === "archived" ? "Lead archived" : v.status === "spam" ? "Moved to Spam" : "Lead updated" });
    },
    onError: (e: any) => toast({ title: "Could not update the lead", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied" }); }
    catch { toast({ title: "Copy failed", description: "Select the text and copy it by hand.", variant: "destructive" }); }
  };

  if (me && !canManage) {
    return (
      <CrmPage>
        <CrmPageHeader icon={Magnet} title="Leads" infoKey="leads" />
        <ErrorCard title="Leads are for the office" description="You need the Manage clients permission to see leads. Ask the account owner." />
      </CrmPage>
    );
  }

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Magnet}
        title="Leads"
        infoKey="leads"
        subtitle="Every request for work in one place: your website forms, the ConstructHUB form and your Call Assistant."
      />

      <ConnectPanel connect={connect} open={panelIsOpen} onOpenChange={setPanelOpen} onCopy={copyText} canSettings={canSettings} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="bg-card pl-9" placeholder="Search name, email, phone, address or message" aria-label="Search leads"
            value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-leads" />
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as LeadSource | "all")}>
          <SelectTrigger className="w-[200px] bg-card" aria-label="Lead source" data-testid="select-lead-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <SegmentedTabs as="group" label="Lead status" testId="tabs-lead-status">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)} data-testid={`tab-lead-${t.key}`}>
            {t.label} <TabCount>{latest?.counts?.[t.key] ?? 0}</TabCount>
          </button>
        ))}
      </SegmentedTabs>

      {isLoading || isPlaceholderData || !me ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <ErrorCard title="Couldn't load leads" description="Check your connection and refresh the page." />
      ) : !rows || rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={qDebounced.trim() ? Search : Magnet}
            title={qDebounced.trim() ? `No leads match “${qDebounced.trim()}”`
              : noLeadsEver ? "No leads yet" : `Nothing under ${TABS.find((t) => t.key === tab)?.label}`}
            description={noLeadsEver
              ? "Connect a lead source above. The first form someone sends shows up here."
              : "Leads move between these tabs as you work them."}
          />
        </Card>
      ) : (
        <>
          {/* The headers are hidden on a phone (card layout) — the Sort select stands in for them. */}
          <SortSelect columns={LEAD_SORT_COLUMNS} sort={sort} onChange={setSort} className="sm:hidden" testId="select-sort-leads" />
          <div className={crmTable.wrapper}>
            {/* Fixed layout from sm up: the columns share the width and long values truncate, so the table never
                grows past the page (a long email or message used to push Received off the right edge). */}
            <table className={`${crmTable.table} sm:table-fixed`}>
              <colgroup className="hidden sm:table-column-group">
                <col className="w-[20%]" /><col className="w-[21%]" /><col className="w-[24%]" /><col className="w-[19%]" /><col className="w-[11%]" /><col className="w-10" />
              </colgroup>
              <thead className={`${crmTable.thead} ${crmTableCards.thead}`}>
                <tr>
                  <SortableTh sortKey="name" label="Lead" sort={sort} onSort={onSort} />
                  <SortableTh sortKey="contact" label="Contact" sort={sort} onSort={onSort} />
                  <SortableTh sortKey="service" label="Asked for" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                  <SortableTh sortKey="source" label="From" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                  <SortableTh sortKey="receivedAt" label="Received" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={`${crmTable.tr} ${crmTableCards.tr} cursor-pointer max-sm:relative max-sm:pr-12`}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,[role=menu]")) return; setOpenId(l.id); }}
                    data-testid={`lead-${l.id}`}>
                    <td className={crmTableCards.td}>
                      {/* On a phone the row is a card, where only a hard cap keeps a long value from widening the table. */}
                      <div className="flex min-w-0 items-center gap-3 max-sm:max-w-[16rem]">
                        <InitialAvatar name={leadName(l)} />
                        <div className="min-w-0">
                          <button type="button" className="block truncate text-left font-medium text-primary hover:underline"
                            onClick={() => setOpenId(l.id)} data-testid={`button-open-lead-${l.id}`}>{leadName(l)}</button>
                          {l.customer ? (
                            <Link href={`/crm/clients/${l.customer.id}`} className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:underline"
                              data-testid={`link-lead-client-${l.id}`}>
                              <User className="h-3 w-3 shrink-0" /> Client: {l.customer.displayName}
                            </Link>
                          ) : place(l) ? (
                            <div className="truncate text-xs text-muted-foreground sm:hidden">{place(l)}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className={crmTableCards.td}>
                      <div className="min-w-0 space-y-0.5 text-sm max-sm:max-w-[16rem]">
                        {l.email && <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:underline" title={l.email}><Mail className="h-3 w-3 shrink-0" /><span className="min-w-0 truncate">{l.email}</span></a>}
                        {l.phone && <a href={`tel:${l.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:underline"><Phone className="h-3 w-3 shrink-0" /><span className="min-w-0 truncate">{l.phone}</span></a>}
                        {!l.email && !l.phone && <span className="text-muted-foreground">No way to reach them</span>}
                      </div>
                    </td>
                    <td className={`${crmTable.td} hidden sm:table-cell`}>
                      <div className="min-w-0 text-sm">
                        {l.service && <div className="truncate font-medium">{l.service}</div>}
                        {l.message && <div className="line-clamp-2 break-words text-muted-foreground">{l.message}</div>}
                        {!l.service && !l.message && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className={`${crmTable.td} hidden sm:table-cell`}>
                      {/* The channel first (Google Ads, Facebook, Website, Phone call), then which site or line it came through. */}
                      <div className="min-w-0 text-sm" data-testid={`lead-channel-${l.id}`}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <ChannelMark k={l.channel.key} />
                          <span className="shrink-0 whitespace-nowrap font-medium">{l.channel.label}</span>
                          {l.channel.detail && <span className="min-w-0 truncate text-muted-foreground" title={l.channel.detail}>· {l.channel.detail}</span>}
                        </div>
                        {l.sourceLabel && <div className="truncate text-xs text-muted-foreground" title={l.sourceLabel}>{l.sourceLabel}</div>}
                      </div>
                    </td>
                    <td className={`${crmTable.td} hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell`}>
                      {(() => { const p = whenParts(l.receivedAt); return p ? <><div>{p[0]}</div><div className="text-xs">{p[1]}</div></> : null; })()}
                    </td>
                    <td className="max-sm:absolute max-sm:right-1 max-sm:top-1.5 sm:px-2 sm:py-3 sm:align-middle">
                      <RowMenu lead={l} onOpen={() => setOpenId(l.id)} onConvert={() => setConverting(l)}
                        onStatus={(status) => setStatus.mutate({ id: l.id, status })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {latest && rows.length < latest.total && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>Showing {rows.length.toLocaleString()} of {latest.total.toLocaleString()} leads.</span>
              {hasNextPage && (
                <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="button-load-more-leads">
                  {isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Load more
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {openId && (
        <LeadDetails id={openId} cached={rows?.find((r) => r.id === openId)} onClose={() => setOpenId(null)}
          onConvert={(l) => { setOpenId(null); setConverting(l); }}
          onStatus={(id, status) => setStatus.mutate({ id, status })} />
      )}
      {converting && (
        <ConvertDialog lead={converting} canJobs={canJobs} onClose={() => setConverting(null)} onDone={invalidate} />
      )}
    </CrmPage>
  );
}

function RowMenu({ lead, onOpen, onConvert, onStatus }: {
  lead: Lead; onOpen: () => void; onConvert: () => void; onStatus: (s: LeadStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${leadName(lead)}`}
          data-testid={`button-lead-actions-${lead.id}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onOpen}><Eye className="mr-2 h-4 w-4" /> Open details</DropdownMenuItem>
        {lead.status !== "contacted" && lead.status !== "converted" && (
          <DropdownMenuItem onSelect={() => onStatus("contacted")} data-testid={`menu-lead-contacted-${lead.id}`}>
            <PhoneOutgoing className="mr-2 h-4 w-4" /> Mark contacted
          </DropdownMenuItem>
        )}
        {lead.status !== "converted" && (
          <DropdownMenuItem onSelect={onConvert} data-testid={`menu-lead-convert-${lead.id}`}>
            <UserPlus className="mr-2 h-4 w-4" /> {lead.customer ? "Mark converted" : "Convert to client"}
          </DropdownMenuItem>
        )}
        {lead.customer && (
          <DropdownMenuItem asChild>
            <Link href={`/crm/clients/${lead.customer.id}`}><User className="mr-2 h-4 w-4" /> Open {lead.customer.displayName}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {lead.status !== "archived" && (
          <DropdownMenuItem onSelect={() => onStatus("archived")} data-testid={`menu-lead-archive-${lead.id}`}>
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
        )}
        {lead.status === "spam" || lead.status === "archived" ? (
          <DropdownMenuItem onSelect={() => onStatus("new")}><Circle className="mr-2 h-4 w-4" /> Move back to New</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onStatus("spam")}>Not a real lead (spam)</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadDetails({ id, cached, onClose, onConvert, onStatus }: {
  id: string; cached?: Lead; onClose: () => void; onConvert: (l: Lead) => void; onStatus: (id: string, s: LeadStatus) => void;
}) {
  const { data, isError } = useQuery<Lead>({ queryKey: ["/api/crm/leads", id], enabled: !cached });
  const lead = cached ?? data;
  const extra = lead?.fields ? Object.entries(lead.fields) : [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="dialog-lead-details">
        {!lead ? (
          isError ? <p className="text-sm text-muted-foreground">This lead is not there any more.</p>
            : <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{leadName(lead)}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-1.5">
                <ChannelMark k={lead.channel.key} />
                <span>{lead.channel.label}{lead.channel.detail ? ` · ${lead.channel.detail}` : ""} · {lead.sourceName}{lead.sourceLabel ? ` · ${lead.sourceLabel}` : ""} · {when(lead.receivedAt)}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <StatusPill tone={STATUS_TONE[lead.status]}>{TABS.find((t) => t.key === lead.status)?.label}</StatusPill>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                {lead.email && <><dt className="text-muted-foreground">Email</dt><dd className="break-all"><a className="hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></dd></>}
                {lead.phone && <><dt className="text-muted-foreground">Phone</dt><dd><a className="hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a></dd></>}
                {place(lead) && <><dt className="text-muted-foreground">Address</dt><dd>{place(lead)}</dd></>}
                {lead.service && <><dt className="text-muted-foreground">Asked for</dt><dd>{lead.service}</dd></>}
                {lead.pageUrl && <><dt className="text-muted-foreground">Page</dt><dd className="break-all"><a className="hover:underline" href={lead.pageUrl} target="_blank" rel="noreferrer noopener">{lead.pageUrl}</a></dd></>}
                {lead.customer && <><dt className="text-muted-foreground">Client</dt><dd><Link className="text-primary hover:underline" href={`/crm/clients/${lead.customer.id}`}>{lead.customer.displayName}</Link></dd></>}
              </dl>
              {lead.message && <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3">{lead.message}</p>}
              {extra.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <ChevronDown className="h-3.5 w-3.5" /> Everything the form sent ({extra.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <dl className="mt-2 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
                      {extra.map(([k, v]) => <Fragment key={k}><dt className="break-all text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></Fragment>)}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              {lead.status !== "contacted" && lead.status !== "converted" && (
                <Button variant="outline" onClick={() => { onStatus(lead.id, "contacted"); onClose(); }}>Mark contacted</Button>
              )}
              {lead.status !== "converted" && (
                <Button onClick={() => onConvert(lead)} data-testid="button-lead-convert">
                  <UserPlus className="mr-2 h-4 w-4" /> {lead.customer ? "Mark converted" : "Convert to client"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ lead, canJobs, onClose, onDone }: { lead: Lead; canJobs: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [useExisting, setUseExisting] = useState(!!lead.customer);
  const [form, setForm] = useState({
    name: lead.name ?? "", addressLine1: lead.addressLine1 ?? "", city: lead.city ?? "", state: lead.state ?? "", postalCode: lead.postalCode ?? "",
  });
  const [addToPipeline, setAddToPipeline] = useState(false);
  const convert = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { addToPipeline: canJobs && addToPipeline };
      if (useExisting && lead.customer) body.customerId = lead.customer.id;
      else {
        if (!form.addressLine1.trim()) throw new Error("Enter the client's address.");
        for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim();
      }
      return (await apiRequest("POST", `/api/crm/leads/${lead.id}/convert`, body)).json();
    },
    onSuccess: (r: any) => {
      onDone();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      if (r.projectId) queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      toast({ title: r.createdClient ? "Client added" : "Lead converted", description: r.projectId ? "It's on the pipeline in the Lead column." : `${r.customer.displayName} is in Clients.` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not convert the lead", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const field = (k: keyof typeof form, label: string, opts: { max: number; placeholder?: string; required?: boolean }) => (
    <div>
      <Label htmlFor={`cv-${k}`}>{label}{opts.required ? " *" : ""}</Label>
      <Input id={`cv-${k}`} value={form[k]} maxLength={opts.max} placeholder={opts.placeholder}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`input-convert-${k}`} />
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-convert-lead">
        <DialogHeader>
          <DialogTitle>Convert to client</DialogTitle>
          <DialogDescription>Every client needs an address. Their portal is made with them.</DialogDescription>
        </DialogHeader>
        {lead.customer && (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox checked={useExisting} onCheckedChange={(v) => setUseExisting(v === true)} data-testid="checkbox-convert-existing" />
            <span>This is <strong>{lead.customer.displayName}</strong>, already one of your clients. Link the lead to them instead of adding someone new.</span>
          </label>
        )}
        {!useExisting && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("name", "Client name", { max: 200, required: true })}</div>
            <div className="sm:col-span-2">{field("addressLine1", "Service address", { max: 200, required: true, placeholder: "1450 Oak St" })}</div>
            {field("city", "City", { max: 120, placeholder: "Columbus" })}
            <div className="grid grid-cols-2 gap-2">
              {field("state", "State", { max: 40, placeholder: "OH" })}
              {field("postalCode", "ZIP", { max: 20, placeholder: "43215" })}
            </div>
          </div>
        )}
        {canJobs && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={addToPipeline} onCheckedChange={(v) => setAddToPipeline(v === true)} data-testid="checkbox-convert-pipeline" />
            Also put it on the pipeline in the Lead column
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => convert.mutate()} disabled={convert.isPending} data-testid="button-convert-save">
            {convert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {useExisting ? "Link and convert" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceStatus({ connected, lastAt, idle }: { connected: boolean; lastAt?: string | null; idle: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-source-status">
      {connected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5" />}
      {lastAt ? `Last lead ${when(lastAt)}` : connected ? "Connected, no leads yet" : idle}
    </span>
  );
}

function ConnectPanel({ connect, open, onOpenChange, onCopy, canSettings }: {
  connect?: Connect; open: boolean; onOpenChange: (v: boolean) => void; onCopy: (t: string) => void; canSettings: boolean;
}) {
  const embed = useMemo(() => connect?.websiteForm.formUrl
    ? `<iframe src="${connect.websiteForm.formUrl}" style="width:100%;max-width:560px;height:640px;border:0;" title="Request an estimate"></iframe>`
    : null, [connect?.websiteForm.formUrl]);
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="overflow-hidden" data-testid="card-connect-sources">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40" data-testid="button-toggle-connect">
          <span>
            <span className="block font-medium">Connect your lead sources</span>
            <span className="block text-sm text-muted-foreground">Send every form and call to this page.</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {!connect ? (
            <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="divide-y border-t">
              <section className="space-y-3 p-4" data-testid="section-form-sync">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-medium"><FileCode2 className="h-4 w-4" /> Sync the forms on your own website</h3>
                  <SourceStatus connected={connect.formSync.count > 0} lastAt={connect.formSync.lastLeadAt} idle="Not set up yet" />
                </div>
                {connect.formSync.snippet ? (
                  <>
                    <div className="flex gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs" data-testid="text-form-sync-snippet">{connect.formSync.snippet}</code>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(connect.formSync.snippet!)} data-testid="button-copy-form-sync">
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                      </Button>
                    </div>
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                      <li>Paste it on the page that has your form, right before <code>&lt;/body&gt;</code>. On a site builder, use its "custom code" or "footer code" box.</li>
                      <li>Send a test from your form, the way a customer would.</li>
                      <li>The test shows up here under New. Your form keeps working as before.</li>
                    </ol>
                    <p className="text-xs text-muted-foreground">
                      Passwords, card numbers and captcha fields are never sent. To leave one form out, add <code>data-ch-skip</code> to it.
                      If your developer sends forms some other way, they can call <code>ConstructHUBForms.send(&#123; name, email, phone, message &#125;)</code>.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Ask the account owner for the website script. Copying it needs the Manage integrations permission.</p>
                )}
              </section>

              <section className="space-y-3 p-4" data-testid="section-hosted-form">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-medium"><Globe className="h-4 w-4" /> The ConstructHUB form</h3>
                  <SourceStatus connected={!!connect.websiteForm.connected} lastAt={connect.websiteForm.lastLeadAt} idle="Not set up yet" />
                </div>
                <p className="text-sm text-muted-foreground">No form on your site yet? Share this one, or put it on your site.</p>
                {connect.websiteForm.formUrl && embed ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input readOnly value={connect.websiteForm.formUrl} onFocus={(e) => e.target.select()} aria-label="Form link" data-testid="input-hosted-form-url" />
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(connect.websiteForm.formUrl!)}><Copy className="mr-1.5 h-3.5 w-3.5" /> Link</Button>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(embed)} data-testid="button-copy-hosted-embed"><Copy className="mr-1.5 h-3.5 w-3.5" /> Embed</Button>
                    </div>
                    {canSettings && (
                      <Link href="/crm/integrations" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        Change or rotate the link in Integrations <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                ) : null}
              </section>

              <section className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid="section-call-assistant">
                <div>
                  <h3 className="flex items-center gap-2 font-medium"><PhoneCall className="h-4 w-4" /> Call Assistant</h3>
                  <p className="text-sm text-muted-foreground">Calls it answers become leads here on their own.</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <SourceStatus connected={!!connect.callAssistant.connected} lastAt={connect.callAssistant.lastLeadAt} idle="No phone line yet" />
                  <a href={marketingUrl("/call-assistant")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Open Call Assistant <ExternalLink className="h-3 w-3" /></a>
                </div>
              </section>

              <section className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid="section-hover">
                <div>
                  <h3 className="flex items-center gap-2 font-medium"><Ruler className="h-4 w-4" /> HOVER</h3>
                  <p className="text-sm text-muted-foreground">Measurement jobs land on the client they belong to.</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <SourceStatus connected={connect.hover.connected} lastAt={null} idle="Not connected" />
                  {canSettings && <Link href="/crm/integrations" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Integrations <ExternalLink className="h-3 w-3" /></Link>}
                </div>
              </section>
            </div>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

