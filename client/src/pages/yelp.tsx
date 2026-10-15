/**
 * /yelp — Yelp reputation. Connect your Yelp business; see its rating, latest reviews, 30-day trend and nearby
 * competitors; draft a reply with AI and post it on Yelp. Yelp's API is read-only (no response endpoint), so replies
 * are drafted here and posted on Yelp via a deep link. Google Business look (GoogleSurface + g-* classes, like the
 * SEO Suite dashboard); a clearly badged sample while no business is connected or Yelp is off on the server.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { AppPage, Notice } from "@/components/app-ui";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { GoogleSurface, GoogleSectionHeader, GoogleLocalCard, GoogleAvatar, GoogleStars, GooglePill, GoogleStat, GoogleStatGrid, relativeTime } from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { SamplePreview } from "@/components/sample-preview";
import { Plus, RefreshCw, ExternalLink, Trash2, Search, Loader2, MessageSquareReply, X, Sparkles, Copy, Users, ChevronDown, Check } from "lucide-react";

type Review = { id: string; rating: number; text: string; timeCreated: string | null; url: string | null; user: { name: string; imageUrl: string | null } };
type Trend = { reviewsGained30d: number; ratingDelta30d: number | null; days: number } | null;
type Business = { id: number; yelpId: string; name: string; url: string | null; imageUrl: string | null; location: string | null; phone: string | null; rating: number | null; reviewCount: number; reviews: Review[]; reviewTotal: number; categories: string[]; photos: string[]; price: string | null; isOpenNow: boolean | null; syncedAt: string | null; trend: Trend };
type SearchHit = { yelpId: string; name: string; url: string | null; imageUrl: string | null; rating: number | null; reviewCount: number; location: string | null; categories: string[]; connected: boolean };
type Competitor = { yelpId: string; name: string; url: string | null; rating: number | null; reviewCount: number; location: string | null; distanceMi: number | null; ahead: boolean };

const trendText = (t: Trend) => !t ? null : t.reviewsGained30d > 0 ? `+${t.reviewsGained30d} review${t.reviewsGained30d === 1 ? "" : "s"} in ${t.days} days` : t.reviewsGained30d < 0 ? `${t.reviewsGained30d} reviews in ${t.days} days` : `No new reviews in ${t.days} days`;

function ReviewCard({ businessId, r, sample }: { businessId: number; r: Review; sample?: boolean }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const gen = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/yelp/businesses/${businessId}/reviews/${encodeURIComponent(r.id)}/draft`)).json() as Promise<{ reply: string }>,
    onSuccess: (d) => setDraft(d.reply),
    onError: (e) => toast({ title: "Couldn't draft a reply", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const copy = async () => { try { await navigator.clipboard.writeText(draft!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast({ title: "Copy failed", description: "Select the text and copy manually.", variant: "destructive" }); } };
  return (
    <div className="rounded-xl border p-3" data-testid={`yelp-review-${r.id}`}>
      <div className="flex items-start gap-2.5">
        <GoogleAvatar src={r.user.imageUrl} initial={r.user.name.slice(0, 1).toUpperCase()} small />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium g-text">{r.user.name}</p><span className="shrink-0 text-xs g-text-2">{r.timeCreated ? relativeTime(r.timeCreated) : ""}</span></div>
          <GoogleStars rating={r.rating} />
          <p className="mt-1.5 text-sm g-text">{r.text}{r.text.length >= 160 ? "…" : ""}</p>
          {draft ? (
            <div className="mt-3 rounded-lg border p-3" style={{ background: "var(--g-surface-2)" }}>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium g-text-2"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI-drafted reply — check it before posting</p>
              <p className="text-sm g-text">{draft}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <GooglePill size="sm" icon={copied ? Check : Copy} onClick={copy} label={copied ? "Copied" : "Copy"} testId={`yelp-copy-${r.id}`} />
                <GooglePill size="sm" variant="quiet" icon={RefreshCw} disabled={gen.isPending} onClick={() => gen.mutate()} label="Redraft" />
                {r.url && <GooglePill size="sm" variant="solid" icon={MessageSquareReply} href={r.url} external label="Respond on Yelp" />}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <GooglePill size="sm" icon={gen.isPending ? Loader2 : Sparkles} disabled={gen.isPending || sample} onClick={() => gen.mutate()} label={gen.isPending ? "Drafting…" : "Draft reply with AI"} testId={`yelp-draft-${r.id}`} />
              {r.url && <GooglePill size="sm" variant="quiet" icon={MessageSquareReply} href={r.url} external label="Respond on Yelp" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompetitorsPanel({ businessId }: { businessId: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery<{ competitors: Competitor[] }>({
    queryKey: ["/api/yelp/competitors", businessId], enabled: open, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/yelp/businesses/${businessId}/competitors`)).json(),
  });
  return (
    <div className="mt-3 g-divider pt-2">
      <button type="button" className="flex w-full items-center gap-2 py-2 text-sm font-medium g-text" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={`yelp-competitors-toggle-${businessId}`}>
        <Users className="h-4 w-4 g-text-2" aria-hidden="true" /> Competitors on Yelp
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="pb-2">
          {q.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
          {q.isError && <p className="text-sm g-closed">{apiErrorMessage(q.error)}</p>}
          {q.data && q.data.competitors.length === 0 && <p className="text-sm g-text-2">No nearby competitors found in this category.</p>}
          {q.data && q.data.competitors.length > 0 && (
            <div className="divide-y rounded-lg border">
              {q.data.competitors.map((c) => (
                <div key={c.yelpId} className="flex items-center gap-3 p-3" data-testid={`yelp-competitor-${c.yelpId}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium g-text">{c.name}{c.ahead && <span className="g-chip g-chip--sm ml-2 g-closed">Ahead of you</span>}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs g-text-2"><GoogleStars rating={c.rating} count={c.reviewCount} />{c.distanceMi != null ? ` · ${c.distanceMi.toFixed(1)} mi` : ""}</p>
                  </div>
                  {c.url && <GooglePill size="sm" variant="quiet" icon={ExternalLink} href={c.url} external label="Yelp" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One connected business as a Google local-pack card: rating row, open status, address, photos, pills, then its reviews. */
function BusinessCard({ b, sample }: { b: Business; sample?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = useMutation({ mutationFn: async () => (await apiRequest("POST", `/api/yelp/businesses/${b.id}/refresh`)).json(), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }), onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }) });
  const remove = useMutation({ mutationFn: async () => (await apiRequest("DELETE", `/api/yelp/businesses/${b.id}`)).json(), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }); toast({ title: "Removed", description: `${b.name} disconnected.` }); }, onError: (e) => toast({ title: "Couldn't remove", description: apiErrorMessage(e), variant: "destructive" }) });
  const trend = trendText(b.trend);
  return (
    <GoogleLocalCard
      testId={`yelp-business-${b.id}`}
      name={b.name}
      href={b.url ?? undefined}
      rating={b.rating}
      reviewCount={b.reviewCount}
      priceRange={b.price}
      category={b.categories.slice(0, 3).join(" · ") || null}
      open={b.isOpenNow}
      address={b.location}
      photos={b.photos.slice(0, 2).map((src) => ({ src }))}
      meta={<>{b.syncedAt ? `Updated ${relativeTime(b.syncedAt)}` : "Not synced yet"}{trend ? ` · ${trend}` : ""}{b.trend?.ratingDelta30d ? ` · rating ${b.trend.ratingDelta30d > 0 ? "up" : "down"} ${Math.abs(b.trend.ratingDelta30d)}` : ""}</>}
      actions={
        <>
          {b.url && <GooglePill size="sm" icon={ExternalLink} href={b.url} external label="View on Yelp" testId={`yelp-view-${b.id}`} />}
          <GooglePill size="sm" variant="quiet" icon={RefreshCw} disabled={refresh.isPending || sample} onClick={() => refresh.mutate()} label={refresh.isPending ? "Refreshing…" : "Refresh"} testId={`yelp-refresh-${b.id}`} />
          <GooglePill size="sm" variant="quiet" icon={Trash2} disabled={remove.isPending || sample} onClick={() => remove.mutate()} label="Remove" testId={`yelp-remove-${b.id}`} />
        </>
      }
    >
      <div className="mt-3">
        <GoogleSectionHeader as="h3" title="Latest reviews" titleAfter={<HelpButton k="yelp.reviews-and-replies" />} count={b.reviewTotal || b.reviews.length || null} description="The newest reviews Yelp returns. Draft a reply here, then post it on Yelp." />
        {b.reviews.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{b.reviews.map((r) => <ReviewCard key={r.id} businessId={b.id} r={r} sample={sample} />)}</div>
        ) : (
          <p className="text-sm g-text-2">No reviews yet. New Yelp reviews will appear here.</p>
        )}
      </div>
      {!sample && <CompetitorsPanel businessId={b.id} />}
    </GoogleLocalCard>
  );
}

function ConnectPanel({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [location, setLocation] = useState("");
  const [submitted, setSubmitted] = useState<{ term: string; location: string } | null>(null);
  const results = useQuery<{ results: SearchHit[] }>({ queryKey: ["/api/yelp/search", submitted?.term, submitted?.location], enabled: !!submitted, retry: false, queryFn: async () => (await apiRequest("GET", `/api/yelp/search?term=${encodeURIComponent(submitted!.term)}&location=${encodeURIComponent(submitted!.location)}`)).json() });
  const connect = useMutation({ mutationFn: async (yelpId: string) => (await apiRequest("POST", "/api/yelp/connect", { yelpId })).json() as Promise<Business>, onSuccess: (b) => { qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }); toast({ title: "Connected", description: `${b.name} added.` }); onDone(); }, onError: (e) => toast({ title: "Couldn't connect", description: apiErrorMessage(e), variant: "destructive" }) });
  const ready = term.trim().length >= 2 && location.trim().length >= 2;
  return (
    <section data-testid="yelp-connect">
      <GoogleSectionHeader title="Connect a Yelp business" description="Find your business on Yelp by name and city — its rating and reviews are tracked here." actions={onCancel && <GooglePill size="sm" variant="quiet" icon={X} onClick={onCancel} label="Cancel" testId="yelp-connect-cancel" />} />
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (ready) setSubmitted({ term: term.trim(), location: location.trim() }); }}>
        <Input aria-label="Business name" placeholder="Business name (e.g. Alpine Exteriors)" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="yelp-search-term" />
        <Input aria-label="City, address or ZIP" placeholder="City, address or ZIP" className="sm:max-w-[16rem]" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="yelp-search-location" />
        <GooglePill type="submit" variant="solid" icon={results.isFetching ? Loader2 : Search} className="shrink-0" disabled={!ready || results.isFetching} label="Search" testId="yelp-search-go" />
      </form>
      {results.isError && <p className="mt-3 text-sm g-closed">{apiErrorMessage(results.error)}</p>}
      {results.data && (
        <div className="mt-4 space-y-2">
          {results.data.results.length === 0 && <p className="text-sm g-text-2">No matches. Try the business name exactly as it appears on Yelp, plus its city.</p>}
          {results.data.results.map((hit) => (
            <div key={hit.yelpId} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`yelp-hit-${hit.yelpId}`}>
              <GoogleAvatar src={hit.imageUrl} initial={hit.name.slice(0, 1).toUpperCase()} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium g-text">{hit.name}</p><p className="flex flex-wrap items-center gap-1.5 text-xs g-text-2"><GoogleStars rating={hit.rating} count={hit.reviewCount} />{hit.location ? ` · ${hit.location}` : ""}</p></div>
              {hit.connected ? <span className="g-chip g-chip--sm g-open">Connected</span> : <GooglePill size="sm" variant="solid" icon={connect.isPending ? Loader2 : Plus} disabled={connect.isPending} onClick={() => connect.mutate(hit.yelpId)} label="Connect" testId={`yelp-connect-${hit.yelpId}`} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** An obviously made-up business for the sample shown while nothing is connected (never stored, never sent). */
const sampleAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const SAMPLE_BUSINESS: Business = {
  id: -1, yelpId: "sample", name: "Sample Roofing Co.", url: null, imageUrl: null, location: "123 Example St, Sampletown", phone: null, rating: 4.6, reviewCount: 128, reviewTotal: 128,
  categories: ["Roofing", "Siding", "Gutter Services"], photos: [], price: null, isOpenNow: true, syncedAt: sampleAgo(0.1),
  trend: { reviewsGained30d: 6, ratingDelta30d: 0.1, days: 30 },
  reviews: [
    { id: "sample-1", rating: 5, text: "Replaced our whole roof in two days and left the yard cleaner than they found it. Crew showed up when they said they would.", timeCreated: sampleAgo(2), url: null, user: { name: "Jamie Example", imageUrl: null } },
    { id: "sample-2", rating: 4, text: "Fair quote, good work on the siding. Took a week longer than planned because of the rain, but they kept us posted.", timeCreated: sampleAgo(9), url: null, user: { name: "Sam Sample", imageUrl: null } },
    { id: "sample-3", rating: 5, text: "Fixed a leak two other companies couldn't find. Would hire again.", timeCreated: sampleAgo(20), url: null, user: { name: "Pat Placeholder", imageUrl: null } },
  ],
};

export default function YelpPage() {
  const [adding, setAdding] = useState(false);
  const status = useQuery<{ available: boolean }>({ queryKey: ["/api/yelp/status"], queryFn: async () => (await apiRequest("GET", "/api/yelp/status")).json() });
  const available = status.data?.available === true;
  const businesses = useQuery<{ businesses: Business[] }>({ queryKey: ["/api/yelp/businesses"], enabled: available, queryFn: async () => (await apiRequest("GET", "/api/yelp/businesses")).json() });
  const list = businesses.data?.businesses ?? [];
  const rated = list.filter((b) => b.rating != null);
  const avgRating = rated.length ? rated.reduce((n, b) => n + (b.rating as number), 0) / rated.length : null;
  const reviews = list.reduce((n, b) => n + b.reviewCount, 0);
  const gained = list.reduce((n, b) => n + (b.trend?.reviewsGained30d ?? 0), 0);
  const showSample = (status.data && !available) || (available && !businesses.isLoading && list.length === 0);
  return (
    <GoogleSurface page>
      <AppPage className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-yelp">
        <GoogleSectionHeader
          as="h1"
          title="Yelp"
          description="Your Yelp rating and newest reviews next to the competitors nearby, with AI-drafted replies you post on Yelp."
          flush
          actions={available && list.length > 0 && !adding ? <GooglePill variant="solid" icon={Plus} onClick={() => setAdding(true)} label="Add business" testId="yelp-add" /> : undefined}
        />
        {status.isError && <Notice tone="danger">{apiErrorMessage(status.error)}</Notice>}
        {status.data && !available && (
          <Notice tone="info" title="Yelp isn’t connected on this server yet" testId="yelp-unavailable">
            An administrator sets <code className="text-xs">YELP_API_KEY</code> (a Yelp Fusion API key) in the server
            environment and restarts the app. Until then this page shows a sample of what you will get.
          </Notice>
        )}
        {available && list.length > 0 && (
          <GoogleStatGrid cols={4}>
            <GoogleStat label="Rating" value={avgRating == null ? "—" : avgRating.toFixed(1)} hint={list.length > 1 ? `Average across ${list.length} businesses` : "Out of 5 on Yelp"} testId="stat-yelp-rating" />
            <GoogleStat label="Reviews" value={reviews.toLocaleString()} hint="All reviews on Yelp" testId="stat-yelp-reviews" />
            <GoogleStat label="New in 30 days" value={gained > 0 ? `+${gained}` : String(gained)} hint="Reviews gained since 30 days ago" testId="stat-yelp-gained" />
            <GoogleStat label="Businesses" value={String(list.length)} hint="Connected here, up to 50" testId="stat-yelp-businesses" />
          </GoogleStatGrid>
        )}
        {showSample && (
          <div className="g-callout" data-testid="yelp-how-it-works">
            <h3>How this works</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Find your business on Yelp by name and city, and connect it.</li>
              <li>Its rating, review count and newest reviews are pulled in and refreshed every 12 hours — you get a notice when a new review lands.</li>
              <li>Draft a reply with AI, check it, copy it and post it on Yelp; open the competitors panel to see who is ahead of you.</li>
            </ol>
          </div>
        )}
        {available && (list.length === 0 || adding) && <ConnectPanel onDone={() => setAdding(false)} onCancel={adding ? () => setAdding(false) : undefined} />}
        {businesses.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
        {list.length > 0 && <div className="space-y-4">{list.map((b) => <BusinessCard key={b.id} b={b} />)}</div>}
        {showSample && (
          <SamplePreview what="what a connected business looks like" testId="sample-yelp">
            <GoogleStatGrid cols={4} className="mb-3">
              <GoogleStat label="Rating" value="4.6" hint="Out of 5 on Yelp" />
              <GoogleStat label="Reviews" value="128" hint="All reviews on Yelp" />
              <GoogleStat label="New in 30 days" value="+6" hint="Reviews gained since 30 days ago" />
              <GoogleStat label="Businesses" value="1" hint="Connected here, up to 50" />
            </GoogleStatGrid>
            <BusinessCard b={SAMPLE_BUSINESS} sample />
          </SamplePreview>
        )}
      </AppPage>
    </GoogleSurface>
  );
}
