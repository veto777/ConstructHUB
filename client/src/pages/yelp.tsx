/**
 * /yelp — Yelp reputation. Connect your Yelp business; see its rating, latest reviews, 30-day trend and nearby
 * competitors; draft a reply with AI and post it on Yelp. Yelp's API is read-only (no response endpoint), so replies
 * are drafted here and posted on Yelp via a deep link.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { AppPage, PageHeader } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Star, Plus, RefreshCw, ExternalLink, Trash2, Search, Loader2, MapPin, MessageSquareReply, Building2, X, Sparkles, Copy, TrendingUp, TrendingDown, Users, ChevronDown, Check } from "lucide-react";

const YELP_RED = "#d32323";

type Review = { id: string; rating: number; text: string; timeCreated: string | null; url: string | null; user: { name: string; imageUrl: string | null } };
type Trend = { reviewsGained30d: number; ratingDelta30d: number | null; days: number } | null;
type Business = { id: number; yelpId: string; name: string; url: string | null; imageUrl: string | null; location: string | null; phone: string | null; rating: number | null; reviewCount: number; reviews: Review[]; reviewTotal: number; categories: string[]; photos: string[]; price: string | null; isOpenNow: boolean | null; syncedAt: string | null; trend: Trend };
type SearchHit = { yelpId: string; name: string; url: string | null; imageUrl: string | null; rating: number | null; reviewCount: number; location: string | null; categories: string[]; connected: boolean };
type Competitor = { yelpId: string; name: string; url: string | null; rating: number | null; reviewCount: number; location: string | null; distanceMi: number | null; ahead: boolean };

function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value === null ? "No rating" : `${v} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star style={{ width: size, height: size }} className="absolute inset-0 text-muted-foreground/30" />
            {fill > 0 && <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}><Star style={{ width: size, height: size }} className="fill-amber-400 text-amber-400" /></span>}
          </span>
        );
      })}
    </span>
  );
}
const relTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

function ReviewCard({ businessId, r }: { businessId: number; r: Review }) {
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
    <div className="rounded-xl border bg-card p-4" data-testid={`yelp-review-${r.id}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">{r.user.imageUrl && <AvatarImage src={r.user.imageUrl} alt="" />}<AvatarFallback className="text-xs">{r.user.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{r.user.name}</p><span className="shrink-0 text-xs text-muted-foreground">{relTime(r.timeCreated)}</span></div>
          <div className="mt-0.5"><Stars value={r.rating} size={14} /></div>
          <p className="mt-2 text-sm text-foreground/90">{r.text}{r.text.length >= 160 ? "…" : ""}</p>
          {draft ? (
            <div className="mt-3 rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="h-3.5 w-3.5" /> AI-drafted reply</p>
              <p className="text-sm">{draft}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={copy} data-testid={`yelp-copy-${r.id}`}>{copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}</Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5" disabled={gen.isPending} onClick={() => gen.mutate()}><RefreshCw className={`h-3.5 w-3.5 ${gen.isPending ? "animate-spin" : ""}`} /> Redraft</Button>
                {r.url && <a href={r.url} target="_blank" rel="noreferrer"><Button size="sm" className="h-7 gap-1.5 text-white" style={{ background: YELP_RED }}><MessageSquareReply className="h-3.5 w-3.5" /> Respond on Yelp</Button></a>}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60" disabled={gen.isPending} onClick={() => gen.mutate()} data-testid={`yelp-draft-${r.id}`}>
                {gen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft reply with AI
              </button>
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: YELP_RED }}><MessageSquareReply className="h-3.5 w-3.5" /> Respond on Yelp</a>}
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
    <div className="border-t">
      <button className="flex w-full items-center gap-2 px-5 py-3 text-sm font-medium hover:bg-muted/40" onClick={() => setOpen((o) => !o)} data-testid={`yelp-competitors-toggle-${businessId}`}>
        <Users className="h-4 w-4 text-muted-foreground" /> Competitors on Yelp
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5">
          {q.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
          {q.isError && <p className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
          {q.data && q.data.competitors.length === 0 && <p className="text-sm text-muted-foreground">No nearby competitors found in this category.</p>}
          {q.data && q.data.competitors.length > 0 && (
            <div className="divide-y rounded-lg border">
              {q.data.competitors.map((c) => (
                <div key={c.yelpId} className="flex items-center gap-3 p-3" data-testid={`yelp-competitor-${c.yelpId}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}{c.ahead && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700">Ahead of you</Badge>}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Stars value={c.rating} size={12} />{c.rating?.toFixed(1) ?? "—"} · {c.reviewCount} reviews{c.distanceMi != null ? ` · ${c.distanceMi.toFixed(1)} mi` : ""}</p>
                  </div>
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm" className="gap-1"><ExternalLink className="h-3.5 w-3.5" /></Button></a>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BusinessCard({ b }: { b: Business }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = useMutation({ mutationFn: async () => (await apiRequest("POST", `/api/yelp/businesses/${b.id}/refresh`)).json(), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }), onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }) });
  const remove = useMutation({ mutationFn: async () => (await apiRequest("DELETE", `/api/yelp/businesses/${b.id}`)).json(), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }); toast({ title: "Removed", description: `${b.name} disconnected.` }); }, onError: (e) => toast({ title: "Couldn't remove", description: apiErrorMessage(e), variant: "destructive" }) });
  const t = b.trend;
  return (
    <Card className="overflow-hidden" data-testid={`yelp-business-${b.id}`}>
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white" style={{ background: YELP_RED }}>
            {b.imageUrl ? <img src={b.imageUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" /> : <Building2 className="h-7 w-7" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{b.name}</p>
            {b.location && <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" />{b.location}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {b.isOpenNow !== null && <Badge variant="outline" className={b.isOpenNow ? "border-green-300 text-green-700" : "border-muted text-muted-foreground"}>{b.isOpenNow ? "Open now" : "Closed"}</Badge>}
              {b.price && <Badge variant="outline">{b.price}</Badge>}
              {b.categories.slice(0, 3).map((c) => <Badge key={c} variant="secondary" className="font-normal">{c}</Badge>)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 sm:ml-auto">
          <div className="text-center">
            <div className="text-3xl font-bold leading-none tabular-nums">{b.rating?.toFixed(1) ?? "—"}</div>
            <div className="mt-1"><Stars value={b.rating} /></div>
            <div className="mt-1 text-xs text-muted-foreground">{b.reviewCount.toLocaleString()} review{b.reviewCount === 1 ? "" : "s"}</div>
            {t && (t.reviewsGained30d !== 0 || (t.ratingDelta30d ?? 0) !== 0) && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                {t.reviewsGained30d >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />}
                {t.reviewsGained30d > 0 ? `+${t.reviewsGained30d} in ${t.days}d` : t.reviewsGained30d < 0 ? `${t.reviewsGained30d} in ${t.days}d` : "steady"}
                {t.ratingDelta30d ? <span className="text-muted-foreground">· {t.ratingDelta30d > 0 ? "↑" : "↓"}{Math.abs(t.ratingDelta30d)}</span> : null}
              </div>
            )}
          </div>
        </div>
      </div>
      {b.photos.length > 0 && (
        <div className="flex gap-2 px-5 pb-1">{b.photos.map((p, i) => <img key={i} src={p} alt="" className="h-16 w-24 rounded-lg object-cover" loading="lazy" />)}</div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-5 py-2.5">
        {b.url && <a href={b.url} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" className="gap-1.5" data-testid={`yelp-view-${b.id}`}><ExternalLink className="h-3.5 w-3.5" /> View on Yelp</Button></a>}
        <Button variant="ghost" size="sm" className="gap-1.5" disabled={refresh.isPending} onClick={() => refresh.mutate()} data-testid={`yelp-refresh-${b.id}`}><RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh</Button>
        <span className="text-xs text-muted-foreground">{b.syncedAt ? `Updated ${relTime(b.syncedAt)}` : "Not synced yet"}</span>
        <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate()} data-testid={`yelp-remove-${b.id}`}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
      </div>
      {b.reviews.length > 0 ? (
        <div className="grid gap-3 p-5 md:grid-cols-3">{b.reviews.map((r) => <ReviewCard key={r.id} businessId={b.id} r={r} />)}</div>
      ) : (
        <p className="px-5 pb-5 pt-1 text-sm text-muted-foreground">No reviews yet. New Yelp reviews will appear here.</p>
      )}
      <CompetitorsPanel businessId={b.id} />
    </Card>
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
    <Card className="p-5" data-testid="yelp-connect">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold">Connect a Yelp business</p><p className="mt-0.5 text-xs text-muted-foreground">Find your business on Yelp by name and city — we'll track its rating and reviews here.</p></div>
        {onCancel && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} data-testid="yelp-connect-cancel"><X className="h-4 w-4" /></Button>}
      </div>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (ready) setSubmitted({ term: term.trim(), location: location.trim() }); }}>
        <Input placeholder="Business name (e.g. Alpine Exteriors)" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="yelp-search-term" />
        <Input placeholder="City, address or ZIP" className="sm:max-w-[16rem]" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="yelp-search-location" />
        <Button type="submit" className="gap-1.5 shrink-0 text-white" style={{ background: YELP_RED }} disabled={!ready || results.isFetching} data-testid="yelp-search-go">{results.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</Button>
      </form>
      {results.isError && <p className="mt-3 text-sm text-destructive">{apiErrorMessage(results.error)}</p>}
      {results.data && (
        <div className="mt-4 space-y-2">
          {results.data.results.length === 0 && <p className="text-sm text-muted-foreground">No matches. Try the business name exactly as it appears on Yelp, plus its city.</p>}
          {results.data.results.map((hit) => (
            <div key={hit.yelpId} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`yelp-hit-${hit.yelpId}`}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">{hit.imageUrl ? <img src={hit.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <Building2 className="h-5 w-5 text-muted-foreground" />}</div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{hit.name}</p><p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Stars value={hit.rating} size={12} /> {hit.rating?.toFixed(1) ?? "—"} · {hit.reviewCount} reviews{hit.location ? ` · ${hit.location}` : ""}</p></div>
              {hit.connected ? <span className="shrink-0 text-xs text-muted-foreground">Connected</span> : <Button size="sm" className="shrink-0 gap-1 text-white" style={{ background: YELP_RED }} disabled={connect.isPending} onClick={() => connect.mutate(hit.yelpId)} data-testid={`yelp-connect-${hit.yelpId}`}>{connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect</Button>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function YelpPage() {
  const [adding, setAdding] = useState(false);
  const status = useQuery<{ available: boolean }>({ queryKey: ["/api/yelp/status"], queryFn: async () => (await apiRequest("GET", "/api/yelp/status")).json() });
  const businesses = useQuery<{ businesses: Business[] }>({ queryKey: ["/api/yelp/businesses"], enabled: status.data?.available === true, queryFn: async () => (await apiRequest("GET", "/api/yelp/businesses")).json() });
  const list = businesses.data?.businesses ?? [];
  return (
    <AppPage testId="page-yelp">
      <PageHeader title="Yelp" icon={Star} description="Your Yelp rating, latest reviews and trend — draft replies with AI and post them on Yelp."
        actions={status.data?.available && list.length > 0 && !adding ? <Button className="gap-1.5 text-white" style={{ background: YELP_RED }} onClick={() => setAdding(true)} data-testid="yelp-add"><Plus className="h-4 w-4" /> Add business</Button> : undefined} />
      {status.data && !status.data.available && <Card className="p-6 text-sm text-muted-foreground" data-testid="yelp-unavailable">Yelp isn't switched on for this workspace yet.</Card>}
      {status.data?.available && (
        <div className="space-y-4">
          {(list.length === 0 || adding) && <ConnectPanel onDone={() => setAdding(false)} onCancel={adding ? () => setAdding(false) : undefined} />}
          {businesses.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
          {list.map((b) => <BusinessCard key={b.id} b={b} />)}
          {!businesses.isLoading && list.length === 0 && !adding && <p className="px-1 text-sm text-muted-foreground">Connect your Yelp business above to start tracking its reputation.</p>}
        </div>
      )}
    </AppPage>
  );
}
