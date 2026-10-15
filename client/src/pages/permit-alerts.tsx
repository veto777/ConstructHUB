import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Bell, Check, Pencil, History, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AppPage, Notice } from "@/components/app-ui";
import { GoogleSurface, GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid, relativeTime } from "@/components/google";
import { PlanRequired, planRequiredFrom, pollUnlessPlanRequired } from "@/components/plan-required";
import { WATCH_KINDS, WATCH_KIND_LABELS, MAX_RADIUS_MILES, type PermitWatchDto, type WatchKind } from "@shared/permit-alerts";

type Jurisdiction = { id: number; name: string; jurisdiction: string; jurisdictionType: string; platform: string | null; alertsSupported: boolean };
type Hit = { id: number; reason: string | null; matchedAt: string; notifiedAt: string | null; channelResults: Record<string, { ok: boolean; detail?: string | null }> | null; permit: Record<string, any> };

const selectClass = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";
const when = (iso: string | null | undefined) => (iso ? relativeTime(new Date(iso)) : "never");

export default function PermitAlertsPage() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<PermitWatchDto | null>(null);
  const [deleting, setDeleting] = useState<PermitWatchDto | null>(null);
  const [error, setError] = useState<Error | null>(null), [busy, setBusy] = useState(false), [showForm, setShowForm] = useState(false);
  const [openHits, setOpenHits] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(window.location.search).get("watch"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const { data, error: listError, isLoading, refetch } = useQuery<{ watches: PermitWatchDto[]; geocoder: boolean; platforms: string[] }>({
    queryKey: ["/api/permits/watches"],
    refetchInterval: pollUnlessPlanRequired(30_000),
  });
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/permits/watches") });
  const act = async (method: string, path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { await apiRequest(method, path, body); await refresh(); toast({ title: path.endsWith("/check") ? "Check requested" : method === "DELETE" ? "Watch deleted" : "Watch saved", description: path.endsWith("/check") ? "The portal will be checked on the next scheduler tick, within five minutes." : undefined }); return true; }
    catch (e) { setError(e instanceof Error ? e : new Error("That didn't work")); return false; }
    finally { setBusy(false); }
  };

  const header = (
    <GoogleSectionHeader
      as="h1"
      title="Permit alerts"
      description="Get told when a new permit is filed at an address, on a parcel, by a contractor, or for your trades in an area; each watched portal is checked every hour."
      flush
      actions={<GooglePill icon={Plus} label="New watch" variant="solid" onClick={() => { setEditing(null); setShowForm(true); }} disabled={busy || isLoading || !!listError} testId="button-new-watch" />}
    />
  );
  const gateError = planRequiredFrom(error) ? error : listError;
  const planGate = planRequiredFrom(gateError);
  if (planGate) {
    return (
      <GoogleSurface page>
        <AppPage testId="page-permit-alerts">
          {header}
          <PlanRequired module="permitAlerts" error={gateError} className="max-w-3xl" />
        </AppPage>
      </GoogleSurface>
    );
  }
  const watches = data?.watches ?? [];
  const unsupported = watches.flatMap((w) => w.jurisdictions.filter((j) => !j.alertsSupported));
  // The number strip, from the watch rows themselves.
  const jurisdictionsOnWatches = watches.reduce((n, w) => n + w.jurisdictions.length, 0);
  const totals = {
    active: watches.filter((w) => w.active).length,
    supported: jurisdictionsOnWatches - unsupported.length,
    matched: watches.reduce((n, w) => n + w.hitCount, 0),
  };

  return (
    <GoogleSurface page>
      <AppPage testId="page-permit-alerts">
        {header}
        {error && <Notice tone="danger" testId="notice-permit-alerts-error">{apiErrorMessage(error)}</Notice>}
        {listError && !planGate && <Notice tone="danger">{apiErrorMessage(listError, "Could not load your watches")} <Button onClick={() => void refetch()}>Retry</Button></Notice>}
        <Notice tone="info" testId="notice-permit-alerts-coverage">
          Alerts need a portal that can list permits by date. Each jurisdiction on a watch says whether its portal supports that today; one that doesn't is kept on the watch and starts working the day its portal is supported.
          {data && !data.geocoder ? " Distance matching is off on this server, so an area watch covers its whole jurisdictions." : ""}
        </Notice>
        <Dialog open={showForm} onOpenChange={open => { if (!busy) setShowForm(open); }}>
          {/* `g-surface`: the dialog portals to <body>, outside the platform surface, so the form's pills
              (trade and jurisdiction chips) need the surface tokens re-declared here to render. */}
          <DialogContent className="g-surface max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogTitle className="sr-only">{editing ? "Edit watch" : "New watch"}</DialogTitle>
            <DialogDescription className="sr-only">Choose permit criteria, jurisdictions and delivery channels.</DialogDescription>
          {error && <Notice tone="danger">{apiErrorMessage(error)}</Notice>}
          {showForm && <WatchForm
            key={editing?.id ?? "new"}
            initial={editing}
            busy={busy}
            geocoder={data?.geocoder ?? false}
            onCancel={() => setShowForm(false)}
            onSave={async (body) => { if (await act(editing ? "PATCH" : "POST", editing ? `/api/permits/watches/${editing.id}` : "/api/permits/watches", body)) setShowForm(false); }}
          />}
          </DialogContent>
        </Dialog>
        {watches.length > 0 && (
          <GoogleStatGrid cols={3}>
            <GoogleStat label="Watches" value={watches.length.toLocaleString()} hint={`${totals.active} active`} testId="stat-alerts-watches" />
            <GoogleStat label="Jurisdictions checked hourly" value={`${totals.supported} of ${jurisdictionsOnWatches}`} hint={unsupported.length ? `${unsupported.length} not supported by its portal yet` : "Every jurisdiction on your watches is supported"} testId="stat-alerts-jurisdictions" />
            <GoogleStat label="Permits matched" value={totals.matched.toLocaleString()} hint="Across all watches, since each was made" testId="stat-alerts-matched" />
          </GoogleStatGrid>
        )}
        <section>
          <GoogleSectionHeader title="Your watches" count={listError || isLoading ? undefined : watches.length} description={unsupported.length ? `${unsupported.length} jurisdiction${unsupported.length === 1 ? "" : "s"} on your watches can't be polled yet.` : undefined} />
          {isLoading ? <Skeleton className="h-32 w-full" /> : listError ? null : !watches.length ? (
            /* No watch yet: what a row and its matches will show, and where they come from. No sample permits (CLAUDE.md). */
            <div className="g-callout" data-testid="text-no-watches">
              <h3 className="inline-flex items-center gap-2"><Bell className="h-4 w-4" aria-hidden="true" /> No watches yet</h3>
              <p>Each watch will be listed here with what it watches, the cities or counties it checks and how many of them are supported, how you are notified, when it was last checked, its last match and how many permits have matched. Matches opens the permits it found: each one's permit number, type, status, address, contractor, date and a link to the portal's record.</p>
              <p className="mt-2">Matches come from the permits each watched portal lists by date, read every hour from the portals whose platform can list permits by date; the directory marks those jurisdictions “Alerts supported”. Nothing is shown that a portal did not list.</p>
              <div className="mt-3"><GooglePill icon={Plus} variant="solid" label="New watch" onClick={() => { setEditing(null); setShowForm(true); }} disabled={busy} testId="button-empty-new-watch" /></div>
            </div>
          ) : (
            <GoogleList testId="list-permit-watches">
              {watches.map((w) => (
                <WatchRow
                  key={w.id}
                  watch={w}
                  busy={busy}
                  hitsOpen={openHits === w.id}
                  onToggleHits={() => setOpenHits(openHits === w.id ? null : w.id)}
                  onEdit={() => { setEditing(w); setShowForm(true); }}
                  onPause={() => act("PATCH", `/api/permits/watches/${w.id}`, { active: !w.active })}
                  onCheck={() => act("POST", `/api/permits/watches/${w.id}/check`)}
                  onDelete={() => setDeleting(w)}
                />
              ))}
            </GoogleList>
          )}
        </section>
        <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the watch and its match history.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={async () => { if (deleting && await act("DELETE", `/api/permits/watches/${deleting.id}`)) setDeleting(null); }}>Delete watch</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </AppPage>
    </GoogleSurface>
  );
}

function WatchRow({ watch: w, busy, hitsOpen, onToggleHits, onPause, onCheck, onDelete, onEdit }: {
  watch: PermitWatchDto; busy: boolean; hitsOpen: boolean; onToggleHits: () => void; onPause: () => void; onCheck: () => void; onDelete: () => void; onEdit: () => void;
}) {
  const checkRevision = w.jurisdictions.map(j => `${j.databaseId}:${j.lastSuccessAt}`).join("|");
  // Watch polling can discover new matches while the history remains open.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: [`/api/permits/watches/${w.id}/hits`] });
  }, [w.id, w.updatedAt, w.lastMatchedAt, w.hitCount, checkRevision]);
  const channels = [w.channels.email && "email", w.channels.sms && "text", w.channels.telegram && "Telegram"].filter(Boolean).join(", ");
  const supported = w.jurisdictions.filter((j) => j.alertsSupported);
  const failing = w.jurisdictions.filter((j) => j.failingSince);
  const lastChecked = w.jurisdictions.map((j) => j.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
  return (
    <GoogleListRow
      size="md"
      testId={`card-watch-${w.id}`}
      title={w.name}
      badges={<>
        <span className="g-chip g-chip--sm">{WATCH_KIND_LABELS[w.kind]}</span>
        {!w.active && <span className="g-chip g-chip--sm">Paused</span>}
      </>}
      meta={[
        w.jurisdictions.map((j) => j.jurisdiction || j.name).join(", "),
        `${supported.length} of ${w.jurisdictions.length} jurisdiction${w.jurisdictions.length === 1 ? "" : "s"} supported`,
        `via ${channels || "nothing"}`,
      ]}
      line={<>
        <span data-testid={`text-watch-checked-${w.id}`}>Last checked {when(lastChecked)}</span>
        {" · "}
        <span>Last match {when(w.lastMatchedAt)}</span>
        {" · "}
        <span>{w.hitCount} permit{w.hitCount === 1 ? "" : "s"} matched</span>
        {failing.map((j) => (
          <span key={j.databaseId} className="g-closed" role="alert"> · {j.jurisdiction || j.name}: portal unreachable since {when(j.failingSince)}{j.lastError ? ` (${j.lastError})` : ""}</span>
        ))}
        {w.jurisdictions.filter((j) => !j.alertsSupported).map((j) => (
          <span key={j.databaseId} className="g-text-2"> · {j.jurisdiction || j.name}: alerts not supported yet{j.platform ? ` (${j.platform})` : ""}</span>
        ))}
      </>}
      actions={<>
        <GooglePill icon={Pencil} label="Edit watch" onClick={onEdit} disabled={busy} />
        <GooglePill icon={History} label={hitsOpen ? "Hide matches" : "Matches"} onClick={onToggleHits} selected={hitsOpen} testId={`button-watch-hits-${w.id}`} />
        <GooglePill icon={RefreshCw} label="Check now" onClick={onCheck} disabled={busy || !w.active} testId={`button-watch-check-${w.id}`} />
        <GooglePill icon={w.active ? Pause : Play} label={w.active ? "Pause" : "Resume"} onClick={onPause} disabled={busy} testId={`button-watch-pause-${w.id}`} />
        <GooglePill icon={Trash2} label="Delete" variant="quiet" onClick={onDelete} disabled={busy} testId={`button-watch-delete-${w.id}`} />
      </>}
    >
      {hitsOpen && <HitList watchId={w.id} unavailable={!supported.length || !lastChecked || failing.length === w.jurisdictions.length} />}
    </GoogleListRow>
  );
}

export function HitList({ watchId, unavailable = false }: { watchId: number; unavailable?: boolean }) {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery({
    queryKey: [`/api/permits/watches/${watchId}/hits`],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => (await apiRequest("GET", `/api/permits/watches/${watchId}/hits?limit=50${pageParam ? '&before=' + pageParam : ''}`)).json() as Promise<{ hits: Hit[]; nextCursor: number | null; total: number }>,
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  if (isLoading) return <Skeleton className="h-24 w-full mt-3" />;
  if (planRequiredFrom(error)) return <PlanRequired module="permitAlerts" error={error} />;
  const hits = data?.pages.flatMap(page => page.hits) ?? [];
  const failure = error ? <Notice tone="danger">Could not load matches. <Button disabled={isFetching} onClick={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}>Retry</Button></Notice> : null;
  if (error && !hits.length) return failure;
  return (
    <>
    {failure}
    <Button variant="outline" className="mt-3" disabled={isFetching} onClick={() => void refetch()}>Refresh matches</Button>
    {!hits.length ? <p className="pt-3 text-sm g-text-2" data-testid={`text-no-hits-${watchId}`}>{unavailable ? "No matches are stored yet. Portal data is unavailable or has not been checked; this does not mean there are no permits." : "No permits have matched this watch yet."}</p> : !error && <p className="mt-3 text-sm" aria-live="polite">Showing {hits.length} of {data?.pages.at(-1)?.total ?? hits.length} retained matches</p>}
    <ul className="mt-3 space-y-3 border-t pt-3" data-testid={`list-hits-${watchId}`}>
      {hits.map((h) => {
        const p = h.permit;
        const results = Object.entries(h.channelResults ?? {});
        return (
          <li key={h.id} className="text-sm">
            <div className="font-medium">
              {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">{p.permitNumber}</a> : p.permitNumber}
              {p.permitType ? ` · ${p.permitType}` : ""}{p.status ? ` · ${p.status}` : ""}
            </div>
            <div className="g-text-2">
              {[p.address, p.contractorName, p.issuedAt ? `issued ${p.issuedAt}` : p.appliedAt ? `applied ${p.appliedAt}` : null, p.jurisdiction].filter(Boolean).join(" · ")}
            </div>
            {p.description && <div className="g-text-2">{String(p.description).slice(0, 240)}</div>}
            <div className="text-xs g-text-2">
              Matched {when(h.matchedAt)}{h.reason ? ` — ${h.reason}` : ""}
              {results.length ? " · " + results.map(([k, r]) => `${k}: ${r.ok ? "sent" : `not sent${r.detail ? ` (${r.detail})` : ""}`}`).join(", ") : ""}
            </div>
          </li>
        );
      })}
    </ul>
    {hasNextPage && <Button className="mt-3" variant="outline" disabled={isFetching} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? "Loading…" : "Load more matches"}</Button>}
    </>
  );
}

export function WatchForm({ busy, geocoder, onCancel, onSave, initial }: { initial?: PermitWatchDto | null; busy: boolean; geocoder: boolean; onCancel: () => void; onSave: (body: unknown) => Promise<void> }) {
  const [kind, setKind] = useState<WatchKind>(initial?.kind ?? "trade_area");
  const [name, setName] = useState(initial?.name ?? ""), [address, setAddress] = useState(initial?.params.address ?? ""), [parcel, setParcel] = useState(initial?.params.parcel ?? "");
  const [contractorName, setContractorName] = useState(initial?.params.contractorName ?? ""), [contractorLicense, setContractorLicense] = useState(initial?.params.contractorLicense ?? "");
  const [radius, setRadius] = useState(initial?.params.radiusMiles?.toString() ?? ""), [trades, setTrades] = useState<string[]>(initial?.params.trades ?? []), [keywords, setKeywords] = useState(initial?.params.keywords?.join(", ") ?? "");
  const [email, setEmail] = useState(initial?.channels.email ?? true), [sms, setSms] = useState(initial?.channels.sms ?? false), [smsTo, setSmsTo] = useState(initial?.channels.smsTo ?? ""), [telegram, setTelegram] = useState(initial?.channels.telegram ?? false);
  const [q, setQ] = useState(""), [state, setState] = useState(""), [picked, setPicked] = useState<Jurisdiction[]>(initial?.jurisdictions.map(j => ({ ...j, id: j.databaseId, jurisdictionType: "" })) ?? []);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);
  const { data: tradeList, error: tradesError, isLoading: tradesLoading, refetch: retryTrades } = useQuery<{ trades: { key: string; label: string }[] }>({ queryKey: ["/api/permits/trades"], staleTime: Infinity });
  const { data: found, error: foundError, isFetching: finding, refetch: retryFound } = useQuery<{ jurisdictions: Jurisdiction[] }>({
    queryKey: [`/api/permits/watches/jurisdictions?${new URLSearchParams({ q: debouncedQ, stateCode: state.toUpperCase() })}`],
    enabled: debouncedQ.length >= 2 || state.length === 2,
  });
  const pickedIds = useMemo(() => new Set(picked.map((j) => j.id)), [picked]);
  const toggleTrade = (key: string) => setTrades((t) => (t.includes(key) ? t.filter((k) => k !== key) : [...t, key]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const params: Record<string, unknown> = { lat: initial?.params.lat ?? null, lng: initial?.params.lng ?? null };
    if (kind === "address") { params.address = address || null; params.parcel = parcel || null; }
    if (kind === "parcel") params.parcel = parcel || null;
    if (kind === "contractor") { params.contractorName = contractorName || null; params.contractorLicense = contractorLicense || null; }
    if (kind === "trade_area") {
      params.trades = trades;
      params.keywords = keywords.split(",").map((s) => s.trim()).filter((s) => s.length >= 2);
      params.address = address || null;
      params.radiusMiles = radius ? Number(radius) : 0;
    }
    await onSave({ kind, name: name || undefined, params, channels: { email, sms, smsTo: smsTo || null, telegram }, databaseIds: picked.map((j) => j.id) });
  };

  return (
    <form onSubmit={submit} className="g-card space-y-4" data-testid="form-new-watch">
      <GoogleSectionHeader as="h2" title={initial ? "Edit watch" : "New watch"} flush />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">What to watch</span>
          <select className={selectClass} disabled={!!initial} value={kind} onChange={(e) => setKind(e.target.value as WatchKind)} data-testid="select-watch-kind">
            {WATCH_KINDS.map((k) => <option key={k} value={k}>{WATCH_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">Name (optional)</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="We'll name it for you" maxLength={120} data-testid="input-watch-name" />
        </label>
      </div>

      {(kind === "address" || kind === "trade_area") && (
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">{kind === "address" ? "Street address" : "Center address (optional — for a radius)"}</span>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 N Main St, Springfield" maxLength={300} data-testid="input-watch-address" />
        </label>
      )}
      {(kind === "address" || kind === "parcel") && (
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">Parcel number {kind === "address" ? "(optional)" : ""}</span>
          <Input value={parcel} onChange={(e) => setParcel(e.target.value)} maxLength={80} data-testid="input-watch-parcel" />
        </label>
      )}
      {kind === "contractor" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm">
            <span className="g-text-2">Contractor name</span>
            <Input value={contractorName} onChange={(e) => setContractorName(e.target.value)} maxLength={160} data-testid="input-watch-contractor" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="g-text-2">License number (optional)</span>
            <Input value={contractorLicense} onChange={(e) => setContractorLicense(e.target.value)} maxLength={60} data-testid="input-watch-license" />
          </label>
        </div>
      )}
      {kind === "trade_area" && (
        <>
          <div className="space-y-1.5 text-sm">
            <span className="g-text-2">Trades (none = every permit)</span>
            {tradesError && <Notice tone="danger">Could not load trades. <Button type="button" onClick={() => void retryTrades()}>Retry</Button></Notice>}
            {tradesLoading && <Skeleton className="h-10 w-full" />}
            <div className="flex flex-wrap gap-2" data-testid="picker-trades">
              {(tradeList?.trades ?? []).map((t) => (
                <GooglePill key={t.key} icon={trades.includes(t.key) ? Check : Plus} label={t.label} selected={trades.includes(t.key)} onClick={() => toggleTrade(t.key)} size="sm" testId={`trade-${t.key}`} />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="g-text-2">Extra keywords (comma-separated)</span>
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ADU, carport" data-testid="input-watch-keywords" />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="g-text-2">Radius in miles {geocoder ? "(optional)" : "(distance matching is off here)"}</span>
              <Input type="number" min={0} max={MAX_RADIUS_MILES} step="0.5" value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!geocoder} data-testid="input-watch-radius" />
            </label>
          </div>
        </>
      )}

      <div className="space-y-2 text-sm">
        <span className="g-text-2">Jurisdictions to poll</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the directory — city or county" aria-label="Search jurisdictions" data-testid="input-jurisdiction-search" />
          <Input value={state} onChange={(e) => setState(e.target.value.slice(0, 2))} placeholder="State (OR)" aria-label="State code" className="sm:w-28" data-testid="input-jurisdiction-state" />
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="picked-jurisdictions">
            {picked.map((j) => (
              <GooglePill key={j.id} icon={X} label={`${j.jurisdiction}${j.alertsSupported ? "" : " (not supported yet)"}`} selected size="sm" onClick={() => setPicked(picked.filter((p) => p.id !== j.id))} testId={`picked-${j.id}`} />
            ))}
          </div>
        )}
        {foundError && <Notice tone="danger">Could not load jurisdictions. <Button type="button" onClick={() => void retryFound()}>Retry</Button></Notice>}
        {finding && <Skeleton className="h-20 w-full" />}
        {!foundError && !finding && found?.jurisdictions && (
          <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2" data-testid="list-jurisdiction-results">
            {found.jurisdictions.filter((j) => !pickedIds.has(j.id)).map((j) => (
              <li key={j.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setPicked([...picked, j])} data-testid={`pick-${j.id}`}>
                  <span>{j.name} <span className="g-text-2">· {j.jurisdiction}{j.platform ? ` · ${j.platform}` : ""}</span></span>
                  <span className={j.alertsSupported ? "g-open text-xs" : "g-text-2 text-xs"}>{j.alertsSupported ? "Alerts supported" : "Not supported yet"}</span>
                </button>
              </li>
            ))}
            {!found.jurisdictions.length && <li className="px-2 py-1 g-text-2">Nothing in the directory matches.</li>}
          </ul>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <span className="g-text-2">Notify me by</span>
        <div className="flex flex-wrap items-center gap-4">
          <Label className="flex items-center gap-2"><Checkbox checked={email} onCheckedChange={(v) => setEmail(v === true)} data-testid="check-channel-email" /> Email</Label>
          <Label className="flex items-center gap-2"><Checkbox checked={sms} onCheckedChange={(v) => setSms(v === true)} data-testid="check-channel-sms" /> Text</Label>
          <Label className="flex items-center gap-2"><Checkbox checked={telegram} onCheckedChange={(v) => setTelegram(v === true)} data-testid="check-channel-telegram" /> Telegram (linked on LSA Leads)</Label>
        </div>
        <p className="g-text-2">Text alerts use your CRM texting allowance. Delivery requires a configured channel.</p>
        {sms && <Input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="Phone to text (blank = your CRM profile's)" className="sm:w-80" data-testid="input-channel-sms-to" />}
      </div>

      <Notice tone="info">{initial ? "Changes apply to future matches; existing history is kept. " : "Review your watch: "}{WATCH_KIND_LABELS[kind]} · {[address, parcel, contractorName, contractorLicense, kind === "trade_area" && (trades.join(", ") || "all trades"), keywords, radius && `${radius} miles`].filter(Boolean).join(" · ")} · {picked.map(j => j.jurisdiction).join(", ") || "no jurisdictions selected"} · {[email && "email", sms && "text", telegram && "Telegram"].filter(Boolean).join(", ") || "no delivery channels"}.</Notice>
      <div className="flex flex-wrap gap-2">
        {/* shadcn Buttons, not GooglePills: this form lives in a Dialog that portals to <body>, outside the
            `.g-surface` that defines the pill tokens — a solid pill there has no background (invisible Save). */}
        <Button type="submit" disabled={busy || !picked.length || (kind === "trade_area" && (!!tradesError || tradesLoading))} data-testid="button-save-watch"><Bell aria-hidden="true" />Save watch</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy} data-testid="button-cancel-watch"><X aria-hidden="true" />Cancel</Button>
      </div>
    </form>
  );
}
