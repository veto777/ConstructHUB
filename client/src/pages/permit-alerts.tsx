import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, History, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AppPage, Notice } from "@/components/app-ui";
import { GoogleSurface, GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, relativeTime } from "@/components/google";
import { PlanRequired, planRequiredFrom, pollUnlessPlanRequired } from "@/components/plan-required";
import { WATCH_KINDS, WATCH_KIND_LABELS, MAX_RADIUS_MILES, type PermitWatchDto, type WatchKind } from "@shared/permit-alerts";

type Jurisdiction = { id: number; name: string; jurisdiction: string; jurisdictionType: string; platform: string | null; alertsSupported: boolean };
type Hit = { id: number; reason: string | null; matchedAt: string; notifiedAt: string | null; channelResults: Record<string, { ok: boolean; detail?: string | null }> | null; permit: Record<string, any> };

const selectClass = "h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";
const when = (iso: string | null | undefined) => (iso ? relativeTime(new Date(iso)) : "never");

export default function PermitAlertsPage() {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [showForm, setShowForm] = useState(false);
  const [openHits, setOpenHits] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(window.location.search).get("watch"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const { data, error: listError, isLoading } = useQuery<{ watches: PermitWatchDto[]; geocoder: boolean; platforms: string[] }>({
    queryKey: ["/api/permits/watches"],
    refetchInterval: pollUnlessPlanRequired(30_000),
  });
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/permits/watches") });
  const act = async (method: string, path: string, body?: unknown) => {
    setBusy(true); setError("");
    try { await apiRequest(method, path, body); await refresh(); return true; }
    catch (e) { setError(apiErrorMessage(e, "That didn't work")); return false; }
    finally { setBusy(false); }
  };

  const header = (
    <GoogleSectionHeader
      as="h1"
      title="Permit alerts"
      description="Watch an address, a contractor, or the trades you care about in an area. We check each jurisdiction's permit portal every hour and send you what's new."
      flush
      actions={<GooglePill icon={Plus} label="New watch" variant="solid" onClick={() => setShowForm(true)} testId="button-new-watch" />}
    />
  );
  const planGate = planRequiredFrom(listError);
  if (planGate) {
    return (
      <GoogleSurface page>
        <AppPage testId="page-permit-alerts">
          {header}
          <PlanRequired module="permitAlerts" error={listError} className="max-w-3xl" />
        </AppPage>
      </GoogleSurface>
    );
  }
  const watches = data?.watches ?? [];
  const unsupported = watches.flatMap((w) => w.jurisdictions.filter((j) => !j.alertsSupported));

  return (
    <GoogleSurface page>
      <AppPage testId="page-permit-alerts">
        {header}
        {error && <Notice tone="danger" testId="notice-permit-alerts-error">{error}</Notice>}
        {listError && !planGate && <Notice tone="danger">{apiErrorMessage(listError, "Could not load your watches")}</Notice>}
        <Notice tone="info" testId="notice-permit-alerts-coverage">
          Alerts need a portal that can list permits by date. Each jurisdiction on a watch says whether its portal supports that today; one that doesn't is kept on the watch and starts working the day its portal is supported.
          {data && !data.geocoder ? " Distance matching is off on this server, so an area watch covers its whole jurisdictions." : ""}
        </Notice>
        {showForm && (
          <WatchForm
            busy={busy}
            geocoder={data?.geocoder ?? false}
            onCancel={() => setShowForm(false)}
            onSave={async (body) => { if (await act("POST", "/api/permits/watches", body)) setShowForm(false); }}
          />
        )}
        <section>
          <GoogleSectionHeader title="Your watches" count={watches.length} description={unsupported.length ? `${unsupported.length} jurisdiction${unsupported.length === 1 ? "" : "s"} on your watches can't be polled yet.` : undefined} />
          {isLoading ? <p className="text-sm g-text-2">Loading…</p> : !watches.length ? (
            <p className="text-sm g-text-2" data-testid="text-no-watches">No watches yet. Add one to start getting alerts.</p>
          ) : (
            <GoogleList testId="list-permit-watches">
              {watches.map((w) => (
                <WatchRow
                  key={w.id}
                  watch={w}
                  busy={busy}
                  hitsOpen={openHits === w.id}
                  onToggleHits={() => setOpenHits(openHits === w.id ? null : w.id)}
                  onPause={() => act("PATCH", `/api/permits/watches/${w.id}`, { active: !w.active })}
                  onCheck={() => act("POST", `/api/permits/watches/${w.id}/check`)}
                  onDelete={() => { if (window.confirm(`Delete the watch "${w.name}"?`)) void act("DELETE", `/api/permits/watches/${w.id}`); }}
                />
              ))}
            </GoogleList>
          )}
        </section>
      </AppPage>
    </GoogleSurface>
  );
}

function WatchRow({ watch: w, busy, hitsOpen, onToggleHits, onPause, onCheck, onDelete }: {
  watch: PermitWatchDto; busy: boolean; hitsOpen: boolean; onToggleHits: () => void; onPause: () => void; onCheck: () => void; onDelete: () => void;
}) {
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
        <GooglePill icon={History} label={hitsOpen ? "Hide matches" : "Matches"} onClick={onToggleHits} selected={hitsOpen} testId={`button-watch-hits-${w.id}`} />
        <GooglePill icon={RefreshCw} label="Check now" onClick={onCheck} disabled={busy || !w.active} testId={`button-watch-check-${w.id}`} />
        <GooglePill icon={w.active ? Pause : Play} label={w.active ? "Pause" : "Resume"} onClick={onPause} disabled={busy} testId={`button-watch-pause-${w.id}`} />
        <GooglePill icon={Trash2} label="Delete" variant="quiet" onClick={onDelete} disabled={busy} testId={`button-watch-delete-${w.id}`} />
      </>}
    >
      {hitsOpen && <HitList watchId={w.id} />}
    </GoogleListRow>
  );
}

function HitList({ watchId }: { watchId: number }) {
  const { data, isLoading } = useQuery<{ hits: Hit[] }>({ queryKey: [`/api/permits/watches/${watchId}/hits`] });
  if (isLoading) return <p className="pt-3 text-sm g-text-2">Loading matches…</p>;
  const hits = data?.hits ?? [];
  if (!hits.length) return <p className="pt-3 text-sm g-text-2" data-testid={`text-no-hits-${watchId}`}>No permits have matched this watch yet.</p>;
  return (
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
  );
}

function WatchForm({ busy, geocoder, onCancel, onSave }: { busy: boolean; geocoder: boolean; onCancel: () => void; onSave: (body: unknown) => Promise<void> }) {
  const [kind, setKind] = useState<WatchKind>("trade_area");
  const [name, setName] = useState(""), [address, setAddress] = useState(""), [parcel, setParcel] = useState("");
  const [contractorName, setContractorName] = useState(""), [contractorLicense, setContractorLicense] = useState("");
  const [radius, setRadius] = useState(""), [trades, setTrades] = useState<string[]>([]), [keywords, setKeywords] = useState("");
  const [email, setEmail] = useState(true), [sms, setSms] = useState(false), [smsTo, setSmsTo] = useState(""), [telegram, setTelegram] = useState(false);
  const [q, setQ] = useState(""), [state, setState] = useState(""), [picked, setPicked] = useState<Jurisdiction[]>([]);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);
  const { data: tradeList } = useQuery<{ trades: { key: string; label: string }[] }>({ queryKey: ["/api/permits/trades"], staleTime: Infinity });
  const { data: found } = useQuery<{ jurisdictions: Jurisdiction[] }>({
    queryKey: [`/api/permits/watches/jurisdictions?${new URLSearchParams({ q: debouncedQ, stateCode: state.toUpperCase() })}`],
    enabled: debouncedQ.length >= 2 || state.length === 2,
  });
  const pickedIds = useMemo(() => new Set(picked.map((j) => j.id)), [picked]);
  const toggleTrade = (key: string) => setTrades((t) => (t.includes(key) ? t.filter((k) => k !== key) : [...t, key]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const params: Record<string, unknown> = {};
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
      <GoogleSectionHeader as="h2" title="New watch" flush />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">What to watch</span>
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as WatchKind)} data-testid="select-watch-kind">
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
        {found?.jurisdictions && (
          <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2" data-testid="list-jurisdiction-results">
            {found.jurisdictions.filter((j) => !pickedIds.has(j.id)).map((j) => (
              <li key={j.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-muted" onClick={() => setPicked([...picked, j])} data-testid={`pick-${j.id}`}>
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
          <Label className="flex items-center gap-2"><Checkbox checked={sms} onCheckedChange={(v) => setSms(v === true)} data-testid="check-channel-sms" /> Text (uses your CRM texting allowance)</Label>
          <Label className="flex items-center gap-2"><Checkbox checked={telegram} onCheckedChange={(v) => setTelegram(v === true)} data-testid="check-channel-telegram" /> Telegram (linked on LSA Leads)</Label>
        </div>
        {sms && <Input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="Phone to text (blank = your CRM profile's)" className="sm:w-80" data-testid="input-channel-sms-to" />}
      </div>

      <div className="flex flex-wrap gap-2">
        <GooglePill icon={Bell} label="Save watch" variant="solid" type="submit" disabled={busy || !picked.length} testId="button-save-watch" />
        <GooglePill icon={X} label="Cancel" onClick={onCancel} disabled={busy} testId="button-cancel-watch" />
      </div>
    </form>
  );
}
