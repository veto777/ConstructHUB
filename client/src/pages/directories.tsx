/**
 * /directories — Directory Sync. One business profile per location, a card per directory page about the business
 * with its check status, a stat row counting them, the activity log and the directory catalogue. Google Business look
 * (GoogleSurface + g-* classes, like the SEO Suite dashboard); a clearly badged sample while a location has no
 * directory profiles yet.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { AppPage } from "@/components/app-ui";
import { useUrlParam } from "@/hooks/use-url-param";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  GoogleSurface,
  GoogleSectionHeader,
  GoogleList,
  GoogleListRow,
  GooglePill,
  GoogleStat,
  GoogleStatGrid,
} from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { SamplePreview } from "@/components/sample-preview";
import { PresetFilter } from "@/components/domains/preset-filter";
import {
  Catalogue,
  LoadError,
  dateLabel,
  getJson,
  label,
  refreshDirectories,
} from "@/components/directories/common";
import { ProfileForm } from "@/components/directories/profile-form";
import {
  DIRECTORY_STATUSES,
  type Directory,
  type BusinessProfile,
  type DirectoryEvent,
  type DirectoryProfileRow,
  type DirectorySummary,
} from "@shared/directories";

// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass = "h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";
type Location = {
  id: number;
  businessName: string;
  city: string | null;
  gbpLocationName: string | null;
};
/** The status presets (shared/directories DIRECTORY_STATUSES, in their plain words). */
const STATUS_PRESETS: readonly [string, string][] = DIRECTORY_STATUSES.map((v) => [v, label(v)] as [string, string]);
const isPresetStatus = (v: string) => (DIRECTORY_STATUSES as readonly string[]).includes(v);
const statusClass = (status: string) =>
  status === "live" ? "g-chip g-chip--sm g-open" : status === "mismatch" || status === "failed" ? "g-chip g-chip--sm g-closed" : "g-chip g-chip--sm";
const host = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; } };

function AddDirectoryProfile({ profileId, directories }: { profileId: number; directories: Directory[] }) {
  const [open, setOpen] = useState(false);
  const [directoryId, setDirectoryId] = useState("");
  const [url, setUrl] = useState("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/directories", { profile_id: profileId, directory_id: Number(directoryId), listing_url: url }),
    onSuccess: async () => {
      await refreshDirectories();
      setOpen(false);
      setUrl("");
      setDirectoryId("");
      toast({ title: "Directory profile URL added", description: "Re-check it to compare your business details." });
    },
  });
  return (
    <>
      <GooglePill variant="solid" icon={Plus} label="Add a directory profile URL" testId="button-add-directory-profile" onClick={() => { mutation.reset(); setOpen(true); }} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="g-surface">
          <DialogHeader>
            <DialogTitle>Add a directory profile URL</DialogTitle>
            <DialogDescription>
              The address of an existing page about your business on the chosen directory. This does not submit a new
              listing — ConstructHUB only checks what the page shows.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
            <label className="block space-y-1.5 text-sm">
              <span className="g-text-2">Directory</span>
              <select aria-label="Directory" required className={`${selectClass} sm:w-full`} value={directoryId} onChange={(event) => setDirectoryId(event.target.value)}>
                <option value="">Choose a directory</option>
                {directories.filter((directory) => directory.active && directory.domain).map((directory) => (
                  <option key={directory.id} value={directory.id}>{directory.name} · {directory.domain}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="g-text-2">Directory profile URL</span>
              <Input required type="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            {mutation.error && <p role="alert" className="text-sm g-closed">{apiErrorMessage(mutation.error)}</p>}
            <GooglePill type="submit" variant="solid" disabled={mutation.isPending || !directoryId || !url} label={mutation.isPending ? "Adding…" : "Add URL"} />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One directory page about the business: its status, when it was checked, what matched, and the two actions. */
function DirectoryProfileCard({ row, onRecheck, checking }: { row: DirectoryProfileRow; onRecheck?: () => void; checking?: boolean }) {
  const fields = row.nap_result ? Object.entries(row.nap_result.fields) : [];
  const differing = fields.filter(([, r]) => r.result !== "match");
  return (
    <GoogleListRow
      size="md"
      testId={`card-directory-profile-${row.id}`}
      title={row.directory_name}
      badges={
        <>
          <span className={statusClass(row.status)}>{label(row.status)}</span>
          {row.billable && <span className="g-chip g-chip--sm g-open">Verified</span>}
        </>
      }
      meta={[host(row.listing_url) ?? "No URL", row.last_checked_at ? `Checked ${dateLabel(row.last_checked_at)}` : "Not checked yet"]}
      actions={
        <>
          {row.listing_url && <GooglePill size="sm" icon={ExternalLink} label="Open directory profile" href={row.listing_url} external />}
          <GooglePill size="sm" variant="quiet" icon={RefreshCw} disabled={checking || !row.listing_url} onClick={onRecheck} label={checking ? "Checking…" : "Re-check"} testId={`button-recheck-${row.id}`} />
        </>
      }
    >
      {row.nap_result ? (
        <div className="mt-2 text-[13px]">
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {fields.map(([field, r]) => (
              <span key={field} className={r.result === "match" ? "g-open" : r.required ? "g-closed" : "g-text-2"}>
                {label(field)}: {r.result === "match" ? "matches" : r.result === "missing" ? "missing" : "differs"}{!r.required && r.result !== "match" ? " (optional)" : ""}
              </span>
            ))}
          </p>
          {differing.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer g-accent">What differs</summary>
              <dl className="mt-1 space-y-1">
                {differing.map(([field, r]) => (
                  <div key={field}>
                    <dt className="font-medium">{label(field)}</dt>
                    <dd className="g-text-2">Expected: {r.expected ?? "Unknown"} · Seen: {r.observed ?? "Not found"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[13px] g-text-2">No confirmed comparison yet{row.evidence?.reason ? ` — ${row.evidence.reason}` : ""}.</p>
      )}
    </GoogleListRow>
  );
}

/** Obviously made-up cards for the sample shown while a location has no directory profiles (never stored, never sent). */
const sampleAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const sampleFields = (address: "match" | "differ" | "missing", phone: "match" | "missing"): DirectoryProfileRow["nap_result"] => ({
  matches: address === "match" && phone === "match",
  fields: {
    name: { result: "match", expected: "Sample Roofing Co.", observed: "Sample Roofing Co.", required: true },
    street_address: { result: address === "differ" ? "differ" : address, expected: "123 Example St", observed: address === "match" ? "123 Example St" : address === "differ" ? "123 Example Street, Suite 4" : null, required: true },
    phone: { result: phone, expected: "(555) 010-0100", observed: phone === "match" ? "(555) 010-0100" : null, required: true },
  },
});
const SAMPLE_ROWS: DirectoryProfileRow[] = [
  { id: -1, profile_id: 0, location_id: 0, user_id: 0, directory_id: 0, directory_name: "Sample Trade Directory", status: "live", listing_url: "https://sample-directory.example/sample-roofing-co", last_checked_at: sampleAgo(5), billable: true, nap_result: sampleFields("match", "match"), evidence: null },
  { id: -2, profile_id: 0, location_id: 0, user_id: 0, directory_id: 0, directory_name: "Example Local Listings", status: "mismatch", listing_url: "https://example-listings.example/biz/sample-roofing", last_checked_at: sampleAgo(30), billable: false, nap_result: sampleFields("differ", "match"), evidence: null },
  { id: -3, profile_id: 0, location_id: 0, user_id: 0, directory_id: 0, directory_name: "Demo Business Index", status: "queued", listing_url: "https://demo-index.example/sample-roofing-co", last_checked_at: null, billable: false, nap_result: null, evidence: { reason: null } },
];

function Activity({ locationId }: { locationId: number }) {
  const [after, setAfter] = useState("0");
  const url = `/api/directories/profiles/${locationId}/events?limit=50&after=${after}`;
  const query = useQuery<DirectoryEvent[]>({ queryKey: [url], queryFn: () => getJson(url) });
  return (
    <>
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status" className="text-sm g-text-2">Loading activity…</p>}
      {query.data && (
        <>
          <ol className="divide-y">
            {query.data.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <p className="font-medium capitalize">
                  {event.type.endsWith("_checked") ? "Directory profile checked" : event.type.endsWith("_added") ? "Directory profile added" : label(event.type)}
                  {event.listing_id ? ` · Directory profile ${event.listing_id}` : ""}
                </p>
                <p className="g-text-2">{dateLabel(event.at)}</p>
                {event.detail?.fields && <p>Fields: {event.detail.fields.map(label).join(", ")}</p>}
                {event.detail?.status && <p>{label(event.detail.status)}</p>}
                {event.detail?.evidence?.reason && <p>{event.detail.evidence.reason}</p>}
              </li>
            ))}
          </ol>
          {!query.data.length && <p className="py-4 text-sm g-text-2">No activity for this location yet.</p>}
          <div className="flex gap-2">
            <GooglePill size="sm" variant="quiet" disabled={after === "0"} onClick={() => setAfter("0")} label="First events" />
            <GooglePill size="sm" variant="quiet" disabled={query.data.length < 50} onClick={() => setAfter(String(query.data.at(-1)!.id))} label="Later events" />
          </div>
        </>
      )}
    </>
  );
}

function LocationDirectories({ location, directories }: { location: Location; directories: Directory[] }) {
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const profileUrl = `/api/directories/profiles/${location.id}`;
  const profile = useQuery<BusinessProfile | null>({ queryKey: [profileUrl], queryFn: () => getJson(profileUrl) });
  const summaryUrl = `/api/directories/summary?location_id=${location.id}`;
  const summary = useQuery<DirectorySummary>({ queryKey: [summaryUrl], queryFn: () => getJson(summaryUrl) });
  // A preset status is sent to the server; a typed word narrows the loaded cards by their status words.
  const params = new URLSearchParams({ limit: "50", offset: String(offset), location_id: String(location.id) });
  if (status && isPresetStatus(status)) params.set("status", status);
  const listUrl = `/api/directories?${params}`;
  const list = useQuery<DirectoryProfileRow[]>({ queryKey: [listUrl], queryFn: () => getJson(listUrl) });
  const recheck = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/directories/${id}/recheck`),
    onSuccess: async () => { await refreshDirectories(); toast({ title: "Check complete" }); },
    onError: (error) => toast({ title: "Could not check directory profile", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const typed = status && !isPresetStatus(status) ? status.toLowerCase() : "";
  const rows = (list.data ?? []).filter((r) => !typed || `${r.status} ${label(r.status)}`.toLowerCase().includes(typed));
  const total = summary.data?.total ?? null;
  const addButton = profile.data ? <AddDirectoryProfile profileId={profile.data.id} directories={directories} /> : null;
  return (
    <>
      {total !== null && total > 0 && (
        <GoogleStatGrid cols={4}>
          <GoogleStat label="Directory profiles" value={total.toLocaleString()} hint={`Pages about ${location.businessName} that we check`} testId="stat-directories-total" />
          <GoogleStat label="Live" value={summary.data!.live.toLocaleString()} hint="Confirmed as your business, details match" testId="stat-directories-live" />
          <GoogleStat label="Details differ" value={summary.data!.mismatch.toLocaleString()} tone={summary.data!.mismatch > 0 ? "bad" : "default"} hint="Name, address or phone is not what you set" testId="stat-directories-mismatch" />
          <GoogleStat label="Verified" value={summary.data!.billable.toLocaleString()} hint="Live with matching name, address and phone" testId="stat-directories-verified" />
        </GoogleStatGrid>
      )}
      {total === 0 && (
        <div className="g-callout" data-testid="directories-how-it-works">
          <h3>How this works</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Save the business profile below — the name, address and phone you want every directory to show.</li>
            <li>Add the address of each page about your business on a directory (Yelp, BBB, Angi and the rest of the catalogue).</li>
            <li>Re-check compares each page with your profile and shows exactly which detail differs, so you can fix it on the directory.</li>
          </ol>
        </div>
      )}
      <section data-testid="section-directory-profiles">
        <GoogleSectionHeader
          title="Directory profiles"
          titleAfter={<HelpButton k="directories.directory-profiles" />}
          count={total ?? undefined}
          description="One card per directory page about your business, each checked against the profile above."
          actions={addButton ?? <span className="text-sm g-text-2">Save a business profile before adding directory profile URLs.</span>}
        />
        <div className="space-y-3">
          <LoadError error={summary.error} retry={() => void summary.refetch()} />
          <LoadError error={list.error} retry={() => void list.refetch()} />
          {total !== null && total > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <PresetFilter
                label="Filter by status"
                allLabel="All statuses"
                presets={STATUS_PRESETS}
                placeholder="A status word"
                selectClass={selectClass}
                testId="filter-directory-status"
                value={status}
                onChange={(v) => { setStatus(v); setOffset(0); }}
              />
              {typed && <span className="text-sm g-text-2">Showing loaded cards whose status contains “{status}”.</span>}
            </div>
          )}
          {list.isLoading && <p role="status" className="text-sm g-text-2">Loading directory profiles…</p>}
          {total === 0 && !list.isLoading ? (
            <SamplePreview what="what each directory card shows once you add a directory profile URL" testId="sample-directories" cta={addButton ?? undefined}>
              <GoogleStatGrid cols={4} className="mb-3">
                <GoogleStat label="Directory profiles" value="3" hint="Pages about Sample Roofing Co. that we check" />
                <GoogleStat label="Live" value="1" hint="Confirmed as your business, details match" />
                <GoogleStat label="Details differ" value="1" tone="bad" hint="Name, address or phone is not what you set" />
                <GoogleStat label="Verified" value="1" hint="Live with matching name, address and phone" />
              </GoogleStatGrid>
              <GoogleList>
                {SAMPLE_ROWS.map((row) => <DirectoryProfileCard key={row.id} row={row} />)}
              </GoogleList>
            </SamplePreview>
          ) : list.data ? (
            rows.length ? (
              <GoogleList testId="list-directory-profiles">
                {rows.map((row) => (
                  <DirectoryProfileCard key={row.id} row={row} checking={recheck.isPending && recheck.variables === row.id} onRecheck={() => recheck.mutate(row.id)} />
                ))}
              </GoogleList>
            ) : (
              <p className="py-4 text-sm g-text-2" data-testid="directories-empty-filtered">No directory profiles match this status.</p>
            )
          ) : null}
          {list.data && (offset > 0 || list.data.length >= 50) && (
            <div className="flex flex-wrap items-center gap-2">
              <GooglePill size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))} label="Previous" />
              <span className="text-sm tabular-nums g-text-2">Page {offset / 50 + 1}</span>
              <GooglePill size="sm" disabled={list.data.length < 50} onClick={() => setOffset(offset + 50)} label="Next" />
            </div>
          )}
        </div>
      </section>
      <details className="group" open={!profile.data} data-testid="details-business-profile">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-[16px] font-medium g-text [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          Business profile
          <span className="g-text-2 text-[13px] font-normal">· {profile.data ? `${profile.data.name || location.businessName} — the details every directory is checked against` : "not saved yet — fill it in first"}</span>
        </summary>
        <section data-testid="section-business-profile" className="pt-2">
          <LoadError error={profile.error} retry={() => void profile.refetch()} />
          {profile.isLoading && <p role="status" className="text-sm g-text-2">Loading business profile…</p>}
          {profile.isSuccess && <ProfileForm profile={profile.data} locationId={location.id} googleLinked={!!location.gbpLocationName} />}
        </section>
      </details>
      <section data-testid="section-directory-activity">
        <GoogleSectionHeader title="Activity" description="Profile updates and directory profile checks, in time order." />
        <Activity locationId={location.id} />
      </section>
    </>
  );
}

export default function DirectoriesPage() {
  const [clientId] = useUrlParam("clientId");
  const locationParams = new URLSearchParams(clientId ? { clientId } : {});
  const locations = useQuery<Location[]>({ queryKey: [`/api/locations?${locationParams}`] });
  const [selected, setSelected] = useUrlParam("location");
  const chosen = locations.data?.find((location) => String(location.id) === selected);
  // One location needs no choosing: it is picked for you (the address is replaced, so Back still leaves the page).
  useEffect(() => {
    if (!selected && locations.data?.length === 1) setSelected(String(locations.data[0].id));
  }, [selected, locations.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const directories = useQuery<Directory[]>({ queryKey: ["/api/directories/directories"], queryFn: () => getJson("/api/directories/directories"), enabled: !!chosen });
  return (
    <GoogleSurface page>
      <AppPage width="wide" className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-directories">
        <GoogleSectionHeader
          as="h1"
          title="Directory Sync"
          description="Keep your business name, address and phone identical on every directory that lists you, and see which ones got it wrong."
          flush
          actions={
            locations.data && locations.data.length > 1 ? (
              <label className="flex items-center gap-2 text-sm g-text-2">
                Location
                <select aria-label="Location" className={selectClass} value={chosen ? String(chosen.id) : ""} onChange={(event) => setSelected(event.target.value || null)} data-testid="select-directories-location">
                  <option value="">Choose a location</option>
                  {locations.data.map((location) => (
                    <option key={location.id} value={location.id}>{location.businessName}{location.city ? ` · ${location.city}` : ""}</option>
                  ))}
                </select>
              </label>
            ) : chosen ? (
              <span className="g-chip g-chip--sm" data-testid="chip-directories-location">{chosen.businessName}{chosen.city ? ` · ${chosen.city}` : ""}</span>
            ) : undefined
          }
        />
        <LoadError error={locations.error} retry={() => void locations.refetch()} />
        {locations.isLoading && <p role="status" className="text-sm g-text-2">Loading locations…</p>}
        {locations.isSuccess && !locations.data.length && (
          <div className="g-callout" data-testid="directories-no-locations">
            <h3>Add a business location first</h3>
            <p>Directory Sync checks directories against a location’s name, address and phone. <Link href="/locations" className="g-accent underline">Add a location</Link> to start.</p>
          </div>
        )}
        {!chosen && (locations.data?.length ?? 0) > 1 && (
          <p className="text-sm g-text-2" data-testid="directories-choose-location">Choose a location above to see its business profile, directory profiles and activity.</p>
        )}
        {chosen && <LocationDirectories key={chosen.id} location={chosen} directories={directories.data ?? []} />}
        <section data-testid="section-directory-catalogue">
          <GoogleSectionHeader title="Directory catalogue" description="Every directory a contractor can be listed on, with filters by category, state and trade." />
          <Catalogue />
        </section>
      </AppPage>
    </GoogleSurface>
  );
}
