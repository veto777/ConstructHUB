import { useEffect, useState } from "react";
import { useQuery, useMutation, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EMAIL_RE, customerErrorMessage, duplicateMatches, type DuplicateMatch } from "@/lib/crm-customer-errors";
import { Users, Plus, Search, Loader2, Mail, Phone, MapPin, ChevronRight, Download, Upload } from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard, InitialAvatar, crmTable, crmTableCards } from "@/components/crm-ui";

interface Client {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  tags: string[] | null;
  portalLastSeenAt: string | null;
  createdAt: string | null;
  bidStatus?: "won" | "undecided" | "declined" | "none";
}

const BID_TABS = [
  { key: "all", label: "All" },
  { key: "won", label: "Job Won" },
  { key: "undecided", label: "Undecided" },
  { key: "declined", label: "Declined" },
] as const;

const BID_PILL: Record<string, { label: string; cls: string }> = {
  won: { label: "Job Won", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  undecided: { label: "Undecided", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};

type BidTab = (typeof BID_TABS)[number]["key"];

/** One page of GET /api/crm/customers?paged=1[&bidStatus=…] — bidCounts cover
 *  the whole book under the same search; total counts the clients that match
 *  the search AND the tab, not just the rows returned. */
interface ClientPage {
  rows: Client[];
  total: number;
  bidCounts: Record<"won" | "undecided" | "declined" | "none", number>;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 100;

/** The tab + search live in the URL (?tab=won&q=kane) so a reload or Back keeps them. */
function readListParams(): { tab: BidTab; q: string } {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const t = p.get("tab");
  return {
    tab: BID_TABS.some((b) => b.key === t) ? (t as BidTab) : "all",
    q: p.get("q") ?? "",
  };
}

const EMPTY = {
  displayName: "", firstName: "", lastName: "", companyName: "",
  email: "", phone: "", addressLine1: "", city: "", state: "", postalCode: "", notes: "",
};

export default function CrmClientsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [initial] = useState(readListParams);
  const [q, setQ] = useState(initial.q);
  // Debounce so each keystroke doesn't fire its own server request.
  const [qDebounced, setQDebounced] = useState(initial.q);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [tab, setTab] = useState<BidTab>(initial.tab);
  // Mirror tab + search into the URL without adding history entries.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (qDebounced.trim()) params.set("q", qDebounced); else params.delete("q");
    if (tab !== "all") params.set("tab", tab); else params.delete("tab");
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [qDebounced, tab]);
  const clearSearch = () => { setQ(""); setQDebounced(""); };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  // A 409 names the existing client(s) sharing that email/phone — shown
  // inline with a link to each and a deliberate "Create anyway".
  const [dupes, setDupes] = useState<DuplicateMatch[] | null>(null);

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;
  const canExport = me?.permissions?.exportData === true;

  // Paged: the legacy bare array stops at the newest 500, so a bigger book
  // silently lost clients and the tab counts undercounted. The server's
  // bidCounts describe the whole book; rows arrive 100 at a time. A tab is a
  // server-side filter (?bidStatus=), so "Job Won" pages through every won
  // client, not just the won ones among the pages already loaded.
  const {
    data, isLoading, isError, isPlaceholderData, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/crm/customers", "paged", qDebounced, tab],
    // While another tab (or search) loads, the tab counts stay on screen from
    // the previous answer; the rows area shows the spinner, never the old rows.
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ClientPage> => {
      const params = new URLSearchParams({ paged: "1", limit: String(PAGE_SIZE), offset: String(pageParam) });
      if (qDebounced) params.set("q", qDebounced);
      if (tab !== "all") params.set("bidStatus", tab);
      const r = await fetch(`/api/crm/customers?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    getNextPageParam: (last: ClientPage) => {
      const next = last.offset + last.rows.length;
      return last.rows.length > 0 && next < last.total ? next : undefined;
    },
  });
  // A client created between two page loads shifts the offsets by one, so a
  // row can arrive twice — keep the first copy.
  const clients: Client[] | undefined = data
    ? Array.from(new Map(data.pages.flatMap((p) => p.rows).map((c) => [c.id, c] as const)).values())
    : undefined;
  const latest = data?.pages[data.pages.length - 1];
  // Every client under the search, whatever the tab (the four buckets add up
  // to the whole book).
  const bookTotal = latest?.bidCounts
    ? latest.bidCounts.won + latest.bidCounts.undecided + latest.bidCounts.declined + latest.bidCounts.none
    : 0;
  const tabTotal = (t: BidTab) => (t === "all" ? bookTotal : latest?.bidCounts?.[t] ?? 0);

  const create = useMutation({
    // force=true is the user's explicit "Create anyway" after a duplicate warning.
    mutationFn: async (force: boolean) => {
      const body: any = { ...form };
      for (const k of Object.keys(body)) {
        if (typeof body[k] === "string") body[k] = body[k].trim();
      }
      // Fall back to a sensible display name rather than rejecting the form.
      if (!body.displayName) {
        body.displayName = [body.firstName, body.lastName].filter(Boolean).join(" ").trim() || body.companyName;
      }
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
      if (!body.displayName) throw new Error("A client name is required.");
      if (body.email && !EMAIL_RE.test(body.email)) throw new Error("Enter a valid email address.");
      return (await apiRequest("POST", `/api/crm/customers${force ? "?force=1" : ""}`, body)).json();
    },
    onSuccess: () => {
      setOpen(false);
      setForm({ ...EMPTY });
      setDupes(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client created", description: "Their portal was created automatically." });
    },
    onError: (e: any) => {
      const matches = duplicateMatches(e);
      if (matches) { setDupes(matches); return; }
      toast({ title: "Could not create client", description: customerErrorMessage(e), variant: "destructive" });
    },
  });

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Users}
        title="Clients"
        infoKey="clients"
        subtitle="Every client gets their own portal the moment you create them."
        actions={canManage || canExport ? (
          <>
          {/* The server gates the CSV on exportData and logs every export. */}
          {canExport && (
            <Button variant="outline" asChild>
              <a href="/api/crm/customers/export.csv" download data-testid="link-export-clients">
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </a>
            </Button>
          )}
          {canManage && (
            <Link href="/crm/migrate">
              <Button variant="outline" data-testid="link-import-clients">
                <Upload className="h-4 w-4 mr-2" /> Import
              </Button>
            </Link>
          )}
          {canManage && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDupes(null); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-client"><Plus className="h-4 w-4 mr-2" /> New client</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="c-name">Client name *</Label>
                  <Input id="c-name" data-testid="input-client-name" value={form.displayName}
                    placeholder="Joe & Mary Kane" maxLength={200}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-company">Company (optional)</Label>
                  <Input id="c-company" value={form.companyName} maxLength={200}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-email">Email</Label>
                  <Input id="c-email" type="email" data-testid="input-client-email" value={form.email}
                    onChange={(e) => { setForm({ ...form, email: e.target.value }); setDupes(null); }} />
                </div>
                <div>
                  <Label htmlFor="c-phone">Phone</Label>
                  <Input id="c-phone" type="tel" value={form.phone} maxLength={40}
                    onChange={(e) => { setForm({ ...form, phone: e.target.value }); setDupes(null); }} />
                </div>
                <div>
                  <Label htmlFor="c-addr">Service address</Label>
                  <Input id="c-addr" value={form.addressLine1} maxLength={200}
                    onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-city">City</Label>
                  <Input id="c-city" value={form.city} maxLength={120}
                    onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="c-state">State</Label>
                    <Input id="c-state" value={form.state} maxLength={40}
                      onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="c-zip">ZIP</Label>
                    <Input id="c-zip" value={form.postalCode} maxLength={20}
                      onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-notes">Notes</Label>
                  <Textarea id="c-notes" rows={3} value={form.notes}
                    placeholder="Where's the leak? What did they ask for?"
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Shows as intake notes on the client's page. Only your team sees it.
                  </p>
                </div>
              </div>
              {dupes && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
                  role="alert" data-testid="notice-duplicate-client">
                  <p className="font-medium">A client with that email or phone already exists</p>
                  <ul className="mt-1.5 space-y-1">
                    {dupes.map((m) => (
                      <li key={m.id} className="min-w-0 truncate">
                        <Link href={`/crm/clients/${m.id}`} onClick={() => setOpen(false)}
                          className="font-medium text-primary hover:underline" data-testid={`link-duplicate-${m.id}`}>
                          {m.displayName}
                        </Link>
                        {(m.email || m.phone) && (
                          <span className="text-muted-foreground"> · {[m.email, m.phone].filter(Boolean).join(" · ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">
                    Open the existing client, or create a separate one anyway — for example a spouse who shares the phone.
                  </p>
                </div>
              )}
              <DialogFooter>
                {dupes ? (
                  <Button variant="outline" onClick={() => create.mutate(true)} disabled={create.isPending}
                    data-testid="button-create-anyway">
                    {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create anyway
                  </Button>
                ) : (
                  <Button onClick={() => create.mutate(false)} disabled={create.isPending} data-testid="button-save-client">
                    {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create client
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
          </>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9 bg-card" placeholder="Search name, email, phone or address"
            value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-clients" />
        </div>
        {/* Bid outcome tabs — where does every client stand on their bid? */}
        <div className="inline-flex rounded-lg border bg-card p-0.5" data-testid="tabs-bid-status">
          {BID_TABS.map((t) => {
            // Whole-book counts from the server, not just the loaded rows.
            const n = tabTotal(t.key);
            return (
              <button key={t.key}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setTab(t.key)}
                data-testid={`tab-bid-${t.key}`}>
                {t.label} <span className="opacity-70 tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading || isPlaceholderData ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <ErrorCard title="Couldn't load clients" description="Check your connection and refresh the page." />
      ) : !bookTotal && qDebounced.trim() ? (
        <Card>
          <EmptyState
            icon={Search}
            title={`No clients match “${qDebounced.trim()}”`}
            description="Search looks at the client name, email, phone and street address."
            action={
              <Button variant="outline" onClick={clearSearch} data-testid="button-clear-search">
                Clear search
              </Button>
            }
          />
        </Card>
      ) : !bookTotal || !clients ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No clients yet"
            description={canManage
              ? "Create your first client — their portal is generated automatically."
              : "Nobody has added a client yet."}
            action={canManage ? (
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> New client
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        (() => {
          // The server already filtered to this tab; total is how many
          // clients match it, so more pages → say so and offer the next.
          const shown = clients;
          const tabN = latest?.total ?? shown.length;
          const moreExist = shown.length < tabN;
          const tabLabel = tab === "all" ? "" : ` ${BID_TABS.find((b) => b.key === tab)?.label ?? ""}`;
          return (
        <>
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={`${crmTable.thead} ${crmTableCards.thead}`}>
              <tr>
                <th className={crmTable.th}>Client</th>
                <th className={crmTable.th}>Contact</th>
                <th className={`${crmTable.th} hidden sm:table-cell`}>Address</th>
                <th className={`${crmTable.th} hidden sm:table-cell`}>Bid</th>
                <th className={`${crmTable.th} hidden sm:table-cell`}>Added</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="text-bid-tab-empty">
                  {qDebounced.trim()
                    ? `No clients in this bucket match “${qDebounced.trim()}”.`
                    : "No clients in this bucket yet."}
                </td></tr>
              )}
              {shown.map((c) => (
                <tr key={c.id} className={`${crmTable.tr} ${crmTableCards.tr} cursor-pointer`}
                  // The name/chevron links navigate on their own — letting the
                  // click bubble here pushed the same URL a second time.
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    navigate(`/crm/clients/${c.id}`);
                  }}
                  data-testid={`client-${c.id}`}>
                  <td className={crmTableCards.td}>
                    <div className="flex items-center gap-3 min-w-0 max-w-[16rem] sm:max-w-[14rem]">
                      <InitialAvatar name={c.displayName} />
                      <div className="min-w-0">
                        <Link href={`/crm/clients/${c.id}`}>
                          <span className="font-medium truncate text-primary hover:underline cursor-pointer block">{c.displayName}</span>
                        </Link>
                        {c.companyName && c.companyName !== c.displayName && (
                          <div className="text-xs text-muted-foreground truncate">{c.companyName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={crmTableCards.td}>
                    {/* Capped widths (here, Client and Address) so one long
                        email or street can't push Bid/Added off-screen. */}
                    <div className="space-y-0.5 text-sm min-w-0 max-w-[16rem] sm:max-w-[12rem]">
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-muted-foreground" title={c.email}>
                          <Mail className="h-3 w-3 shrink-0" /><span className="truncate min-w-0">{c.email}</span>
                        </div>
                      )}
                      {c.phone && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />{c.phone}
                        </div>
                      )}
                      {!c.email && !c.phone && <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className={`${crmTable.td} hidden sm:table-cell`}>
                    {(c.addressLine1 || c.city) ? (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground max-w-[12rem]"
                        title={[c.addressLine1, c.city, c.state].filter(Boolean).join(", ")}>
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate min-w-0">{[c.addressLine1, c.city, c.state].filter(Boolean).join(", ")}</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`${crmTable.td} hidden sm:table-cell`}>
                    {c.bidStatus && BID_PILL[c.bidStatus] ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BID_PILL[c.bidStatus].cls}`}
                        data-testid={`pill-bid-${c.id}`}>
                        {BID_PILL[c.bidStatus].label}
                      </span>
                    ) : <span className="text-muted-foreground text-sm">—</span>}
                  </td>
                  <td className={`${crmTable.td} hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap`}>
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="hidden sm:table-cell sm:px-4 sm:py-3 sm:pr-3 align-middle">
                    <Link href={`/crm/clients/${c.id}`} aria-label={`Open ${c.displayName}`}>
                      <ChevronRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {moreExist && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
            data-testid="clients-pager">
            <span data-testid="text-clients-showing">
              Showing {shown.length.toLocaleString()} of {tabN.toLocaleString()}{tabLabel} clients — search to find others.
            </span>
            {hasNextPage && (
              <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
                data-testid="button-load-more-clients">
                {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Load more
              </Button>
            )}
          </div>
        )}
        </>
          );
        })()
      )}
    </CrmPage>
  );
}
