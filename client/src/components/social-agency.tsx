import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Toolbar } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import { destinationSchema, platforms, type Destination } from "@shared/social";

// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass = "h-10 w-full rounded-full border border-input bg-background px-4 text-sm";

export const refreshSocial = () => queryClient.invalidateQueries({ queryKey: ["/api/social"] });

export function Pager({ offset, setOffset, more, label }: { offset: number; setOffset: (n: number) => void; more: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm g-text-2">
      <GooglePill size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))} label={`Previous ${label}`} />
      <span className="tabular-nums">Page {offset / 25 + 1}</span>
      <GooglePill size="sm" disabled={!more} onClick={() => setOffset(offset + 25)} label={`Next ${label}`} />
    </div>
  );
}

export function BusinessSelector({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [linked, setLinked] = useState("all");
  const [selected, setSelected] = useState<Record<number, { name: string; cadence: number; period: string }>>({});
  const [bulk, setBulk] = useState(false), [text, setText] = useState(""), [bulkMedia, setBulkMedia] = useState(""), [schedule, setSchedule] = useState(""), [mode, setMode] = useState("approval"), [jobOffset, setJobOffset] = useState(0), [jobSearch, setJobSearch] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { toast } = useToast();
  const { data, error } = useQuery<any>({ queryKey: ["/api/social", "businesses", search, offset, linked], queryFn: async () => (await apiRequest("GET", `/api/social/businesses?${new URLSearchParams({ search, offset: String(offset), linked })}`)).json() });
  const { data: jobs } = useQuery<any>({ queryKey: ["/api/social", "bulk", jobOffset, jobSearch], enabled: bulk, refetchInterval: 15000, queryFn: async () => (await apiRequest("GET", `/api/social/bulk?offset=${jobOffset}&search=${encodeURIComponent(jobSearch)}`)).json() });
  const mutation = useMutation({ mutationFn: async (body: any) => (await apiRequest("POST", "/api/social/bulk", body)).json(), onSuccess: () => { refreshSocial(); setRequestId(crypto.randomUUID()); toast({ title: "Bulk work queued", description: "Review each business result below." }); }, onError: (e: Error) => toast({ title: "Bulk action failed", description: e.message, variant: "destructive" }) });
  const ids = Object.keys(selected).map(Number);
  function enqueue(kind: string, draft = true, enabled = true) {
    mutation.mutate({ requestId, businessIds: ids, kind, ...(kind === "post" ? { text, draft, mediaUrls: bulkMedia.split("\n").map(v => v.trim()).filter(Boolean), ...(schedule ? { scheduledTime: new Date(schedule).toISOString() } : {}) } : {}), ...(kind === "settings" ? { enabled, mode, cadences: ids.map(businessId => ({ businessId, cadence: selected[businessId].cadence, period: selected[businessId].period })) } : {}) });
  }
  return (
    <section>
      <GoogleSectionHeader
        title="Business"
        description={`${data?.total ?? 0} businesses. Choose one to manage its accounts, posts and auto mode.`}
        actions={<>
          <GooglePill size="sm" onClick={() => onChange("all")} label="All-clients calendar" />
          <GooglePill size="sm" selected={bulk} ariaPressed={bulk} onClick={() => setBulk(!bulk)} testId="button-bulk-actions" label={`Bulk actions (${ids.length})`} />
        </>}
      />
      <div className="space-y-4">
        <Toolbar
          search={{ value: search, onChange: (v) => { setSearch(v); setOffset(0); }, placeholder: "Search businesses" }}
          filters={
            <select aria-label="Google linkage filter" className={selectClass} value={linked} onChange={e => { setLinked(e.target.value); setOffset(0); }}>
              <option value="all">All businesses</option>
              <option value="linked">Google linked</option>
              <option value="unlinked">Not linked</option>
            </select>
          }
        />
        {error && <p role="alert" className="text-sm text-destructive">Could not load businesses.</p>}
        {(data?.items || []).length > 0 && (
          <GoogleList testId="list-social-businesses">
            {(data?.items || []).map((b: any) => (
              <GoogleListRow
                key={b.id}
                size="md"
                className={value === String(b.id) ? "bg-[color:var(--g-hover)] -mx-4 px-4 sm:-mx-0 sm:px-0" : undefined}
                title={<span className="inline-flex items-center gap-3">
                  {bulk && <input type="checkbox" aria-label={`Select ${b.business_name} for bulk`} checked={!!selected[b.id]} onChange={e => setSelected(old => { const next = { ...old }; if (e.target.checked) next[b.id] = { name: b.business_name, cadence: 1, period: "week" }; else delete next[b.id]; return next; })} />}
                  <button type="button" onClick={() => onChange(String(b.id))} aria-current={value === String(b.id) ? "true" : undefined}>{b.business_name}</button>
                </span>}
                meta={[b.city, b.gbp_location_name ? <span key="g" className="g-open">Google linked</span> : null]}
              />
            ))}
          </GoogleList>
        )}
        <Pager offset={offset} setOffset={setOffset} more={offset + 25 < (data?.total || 0)} label="businesses" />
        {bulk && <div className="space-y-3 g-divider pt-4">
          <h3 className="g-card__title g-card__title--md">Bulk actions for {ids.length} selected businesses</h3>
          <div className="flex flex-wrap gap-2">
            <GooglePill size="sm" onClick={() => setSelected(old => ({ ...old, ...Object.fromEntries((data?.items || []).map((b: any) => [b.id, old[b.id] || { name: b.business_name, cadence: 1, period: "week" }])) }))} label="Select this page" />
            <GooglePill size="sm" onClick={() => setSelected({})} label="Clear selection" />
          </div>
          <p className="text-sm text-muted-foreground">Selection is retained across search pages, up to 1,000 businesses. Each business uses its saved destination mapping.</p>
          <Textarea aria-label="Bulk post text" placeholder="Update for {business} in {city}. Call {phone}." value={text} onChange={e => { setText(e.target.value); setRequestId(crypto.randomUUID()); }} />
          <p className="text-xs text-muted-foreground">Variables: {"{business}, {city}, {phone}"}. Missing facts fail that business with a visible error. Attachments are shared across selected businesses; each destination must satisfy its platform requirements.</p>
          <Textarea aria-label="Bulk media URLs" placeholder="Public HTTPS media URLs, one per line (optional)" value={bulkMedia} onChange={e => { setBulkMedia(e.target.value); setRequestId(crypto.randomUUID()); }} />
          <Input aria-label="Bulk schedule time" type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <GooglePill variant="solid" disabled={!ids.length || !text.trim() || mutation.isPending} onClick={() => enqueue("post")} label="Create bulk drafts" />
            <GooglePill disabled={!ids.length || !text.trim() || mutation.isPending} onClick={() => enqueue("post", false)} label="Queue bulk posts" />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium g-accent">Per-business cadence (defaults to once a week)</summary>
            <div className="mt-2 max-h-64 space-y-2 overflow-auto">
              {ids.map(id => (
                <div key={id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{selected[id].name}</span>
                  <Input className="w-20" type="number" min={1} max={7} aria-label={`Cadence for ${selected[id].name}`} value={selected[id].cadence} onChange={e => setSelected({ ...selected, [id]: { ...selected[id], cadence: Number(e.target.value) } })} />
                  <select className={selectClass + " w-auto"} aria-label={`Period for ${selected[id].name}`} value={selected[id].period} onChange={e => setSelected({ ...selected, [id]: { ...selected[id], period: e.target.value } })}>
                    <option value="week">per week</option>
                    <option value="day">per day</option>
                  </select>
                </div>
              ))}
            </div>
          </details>
          <div className="max-w-sm space-y-1.5">
            <label className="text-sm font-medium">Bulk publishing mode</label>
            <select aria-label="Bulk publishing mode" className={selectClass} value={mode} onChange={e => setMode(e.target.value)}>
              <option value="approval">Approval drafts</option>
              <option value="automatic">Automatically publish without review</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {[["settings", "Enable selected auto modes"], ["disable", "Disable selected auto modes"], ["sync", "Refresh selected GBP sources"], ["generate", "Generate selected drafts"]].map(([kind, label]) => <GooglePill key={kind} disabled={!ids.length || mutation.isPending} onClick={() => enqueue(kind === "disable" ? "settings" : kind, true, kind !== "disable")} label={label} />)}
          </div>
          <p className="text-xs text-muted-foreground">Enabling uses each business&rsquo;s existing content mix and AI budget. Automatic publishing is explicit permission for every selected business. Shared owner AI limits still apply.</p>
          <h3 className="g-card__title g-card__title--md">Bulk results</h3>
          <Input aria-label="Search bulk results" type="search" value={jobSearch} onChange={e => { setJobSearch(e.target.value); setJobOffset(0); }} placeholder="Search business or status" />
          {(jobs?.items || []).length > 0 && <GoogleList>{(jobs?.items || []).map((j: any) => <p key={j.id} className="g-card text-sm">{j.business_name} · {j.kind} · {j.state}{j.error ? <span className="g-closed"> — {j.error}</span> : ""}</p>)}</GoogleList>}
          <Pager offset={jobOffset} setOffset={setJobOffset} more={jobs?.hasMore || false} label="results" />
        </div>}
      </div>
    </section>
  );
}

export function MappingEditor({ businessId, defaults }: { businessId: number; defaults: Destination[] }) {
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [draft, setDraft] = useState<Destination[] | null>(null);
  const choices = draft ?? defaults;
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/social", "accounts", businessId, search, offset], queryFn: async () => (await apiRequest("GET", `/api/social/accounts?businessId=${businessId}&search=${encodeURIComponent(search)}&offset=${offset}`)).json() });
  const mutation = useMutation({ mutationFn: async ({ path, body }: { path: string; body?: any }) => (await apiRequest(path === "/mapping" ? "PUT" : "POST", `/api/social${path}?businessId=${businessId}`, body)).json(), onSuccess: () => { refreshSocial(); toast({ title: "Business account configuration saved" }); }, onError: (e: Error) => toast({ title: "Account mapping", description: e.message, variant: "destructive" }) });
  const patch = (id: string, values: Partial<Destination>) => setDraft(choices.map(d => d.accountId === id ? { ...d, ...values } : d));
  return (
    <details className="g-card border-t">
      <summary className="cursor-pointer g-card__title g-card__title--md">Map accounts and pages to this business</summary>
      <div className="space-y-3 pt-3">
        <p className="text-sm text-muted-foreground">Choose up to 20 destinations. These become composer defaults and bulk destinations. Saving a mapping pauses this business&rsquo;s auto mode for review.</p>
        <Input aria-label="Search Blotato accounts" type="search" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} placeholder="Search account or platform" />
        {(data?.items || []).map((a: any) => {
          const d = choices.find(d => d.accountId === a.id);
          return (
            <div key={a.id} className="space-y-2 rounded-lg border p-3">
              <label className="flex gap-2 text-sm">
                <input type="checkbox" disabled={!platforms.includes(a.platform)} checked={!!d} onChange={e => setDraft(e.target.checked ? [...choices, destinationSchema.parse({ accountId: a.id, platform: a.platform })] : choices.filter(d => d.accountId !== a.id))} />
                {a.name} · {a.platform}
              </label>
              {d && ["facebook", "linkedin", "pinterest"].includes(a.platform) && <><GooglePill size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/accounts/${a.id}/pages` })} label={`Discover pages for ${a.name}`} /><TargetPicker businessId={businessId} account={a} destination={d} onChange={value => patch(a.id, a.platform === "pinterest" ? { boardId: value || undefined } : { pageId: value || undefined })} /></>}
              {d && ["youtube", "pinterest"].includes(a.platform) && <Input aria-label={`Default title for ${a.name}`} value={d.title || ""} onChange={e => patch(a.id, { title: e.target.value })} />}
            </div>
          );
        })}
        <Pager offset={offset} setOffset={setOffset} more={data?.hasMore || false} label="accounts" />
        <p className="text-sm text-muted-foreground">{choices.length} destinations selected across pages.</p>
        <GooglePill disabled={mutation.isPending || choices.length > 20} onClick={() => mutation.mutate({ path: "/mapping", body: { destinations: choices } })} label="Save business mapping" />
      </div>
    </details>
  );
}

function TargetPicker({ businessId, account, destination, onChange }: { businessId: number; account: any; destination: Destination; onChange: (id: string) => void }) {
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0);
  const { data } = useQuery<any>({ queryKey: ["/api/social", "targets", businessId, account.id, search, offset], queryFn: async () => (await apiRequest("GET", `/api/social/accounts/${account.id}/targets?businessId=${businessId}&offset=${offset}&search=${encodeURIComponent(search)}`)).json() });
  const selected = destination.pageId || destination.boardId || "";
  return (
    <div className="space-y-2">
      <Input aria-label={`Search pages for ${account.name}`} type="search" placeholder="Search page or board" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} />
      <select className={selectClass} aria-label={`Map page for ${account.name}`} value={selected} onChange={e => onChange(e.target.value)}>
        <option value="">{account.platform === "linkedin" ? "Personal profile" : "Choose page / board"}</option>
        {selected && !(data?.items || []).some((p: any) => p.id === selected) && <option value={selected}>{selected} (saved selection)</option>}
        {(data?.items || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Pager offset={offset} setOffset={setOffset} more={data?.hasMore || false} label="pages" />
    </div>
  );
}
