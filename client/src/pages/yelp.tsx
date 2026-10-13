/**
 * /yelp — Yelp reputation. Connect your Yelp business, see its rating and recent reviews at a glance, and jump to Yelp
 * to respond. Yelp's API is read-only (no response endpoint), so replying opens the review on Yelp.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { AppPage, PageHeader } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Star, Plus, RefreshCw, ExternalLink, Trash2, Search, Loader2, MapPin, MessageSquareReply, Building2, X } from "lucide-react";

const YELP_RED = "#d32323";

type Review = { id: string; rating: number; text: string; timeCreated: string | null; url: string | null; user: { name: string; imageUrl: string | null } };
type Business = { id: number; yelpId: string; name: string; url: string | null; imageUrl: string | null; location: string | null; phone: string | null; rating: number | null; reviewCount: number; reviews: Review[]; reviewTotal: number; syncedAt: string | null };
type SearchHit = { yelpId: string; name: string; url: string | null; imageUrl: string | null; rating: number | null; reviewCount: number; location: string | null; connected: boolean };

function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value === null ? "No rating" : `${v} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star style={{ width: size, height: size }} className="absolute inset-0 text-muted-foreground/30" />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star style={{ width: size, height: size }} className="fill-amber-400 text-amber-400" />
              </span>
            )}
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

function ReviewCard({ r }: { r: Review }) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={`yelp-review-${r.id}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          {r.user.imageUrl && <AvatarImage src={r.user.imageUrl} alt="" />}
          <AvatarFallback className="text-xs">{r.user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{r.user.name}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{relTime(r.timeCreated)}</span>
          </div>
          <div className="mt-0.5"><Stars value={r.rating} size={14} /></div>
          <p className="mt-2 text-sm text-foreground/90">{r.text}{r.text.length >= 160 ? "…" : ""}</p>
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: YELP_RED }} data-testid={`yelp-respond-${r.id}`}>
              <MessageSquareReply className="h-3.5 w-3.5" /> Respond on Yelp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function BusinessCard({ b }: { b: Business }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/yelp/businesses/${b.id}/refresh`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }),
    onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/yelp/businesses/${b.id}`)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }); toast({ title: "Removed", description: `${b.name} disconnected.` }); },
    onError: (e) => toast({ title: "Couldn't remove", description: apiErrorMessage(e), variant: "destructive" }),
  });
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
          </div>
        </div>
        <div className="flex items-center gap-5 sm:ml-auto">
          <div className="text-center">
            <div className="text-3xl font-bold leading-none tabular-nums">{b.rating?.toFixed(1) ?? "—"}</div>
            <div className="mt-1"><Stars value={b.rating} /></div>
            <div className="mt-1 text-xs text-muted-foreground">{b.reviewCount.toLocaleString()} review{b.reviewCount === 1 ? "" : "s"}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-5 py-2.5">
        {b.url && (
          <a href={b.url} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5" data-testid={`yelp-view-${b.id}`}><ExternalLink className="h-3.5 w-3.5" /> View on Yelp</Button>
          </a>
        )}
        <Button variant="ghost" size="sm" className="gap-1.5" disabled={refresh.isPending} onClick={() => refresh.mutate()} data-testid={`yelp-refresh-${b.id}`}>
          <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground">{b.syncedAt ? `Updated ${relTime(b.syncedAt)}` : "Not synced yet"}</span>
        <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate()} data-testid={`yelp-remove-${b.id}`}>
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </div>
      {b.reviews.length > 0 ? (
        <div className="grid gap-3 p-5 md:grid-cols-3">{b.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}</div>
      ) : (
        <p className="px-5 pb-5 pt-1 text-sm text-muted-foreground">No reviews yet. New Yelp reviews will appear here.</p>
      )}
    </Card>
  );
}

function ConnectPanel({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [location, setLocation] = useState("");
  const [submitted, setSubmitted] = useState<{ term: string; location: string } | null>(null);
  const results = useQuery<{ results: SearchHit[] }>({
    queryKey: ["/api/yelp/search", submitted?.term, submitted?.location],
    queryFn: async () => (await apiRequest("GET", `/api/yelp/search?term=${encodeURIComponent(submitted!.term)}&location=${encodeURIComponent(submitted!.location)}`)).json(),
    enabled: !!submitted, retry: false,
  });
  const connect = useMutation({
    mutationFn: async (yelpId: string) => (await apiRequest("POST", "/api/yelp/connect", { yelpId })).json() as Promise<Business>,
    onSuccess: (b) => { qc.invalidateQueries({ queryKey: ["/api/yelp/businesses"] }); toast({ title: "Connected", description: `${b.name} added.` }); onDone(); },
    onError: (e) => toast({ title: "Couldn't connect", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const ready = term.trim().length >= 2 && location.trim().length >= 2;
  return (
    <Card className="p-5" data-testid="yelp-connect">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Connect a Yelp business</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Find your business on Yelp by name and city — we'll track its rating and reviews here.</p>
        </div>
        {onCancel && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} data-testid="yelp-connect-cancel"><X className="h-4 w-4" /></Button>}
      </div>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (ready) setSubmitted({ term: term.trim(), location: location.trim() }); }}>
        <Input placeholder="Business name (e.g. RoofElite)" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="yelp-search-term" />
        <Input placeholder="City, address or ZIP" className="sm:max-w-[16rem]" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="yelp-search-location" />
        <Button type="submit" className="gap-1.5 shrink-0 text-white" style={{ background: YELP_RED }} disabled={!ready || results.isFetching} data-testid="yelp-search-go">
          {results.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </form>
      {results.isError && <p className="mt-3 text-sm text-destructive">{apiErrorMessage(results.error)}</p>}
      {results.data && (
        <div className="mt-4 space-y-2">
          {results.data.results.length === 0 && <p className="text-sm text-muted-foreground">No matches. Try the business name exactly as it appears on Yelp, plus its city.</p>}
          {results.data.results.map((hit) => (
            <div key={hit.yelpId} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`yelp-hit-${hit.yelpId}`}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                {hit.imageUrl ? <img src={hit.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <Building2 className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{hit.name}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <Stars value={hit.rating} size={12} /> {hit.rating?.toFixed(1) ?? "—"} · {hit.reviewCount} reviews{hit.location ? ` · ${hit.location}` : ""}
                </p>
              </div>
              {hit.connected
                ? <span className="shrink-0 text-xs text-muted-foreground">Connected</span>
                : <Button size="sm" className="shrink-0 gap-1 text-white" style={{ background: YELP_RED }} disabled={connect.isPending} onClick={() => connect.mutate(hit.yelpId)} data-testid={`yelp-connect-${hit.yelpId}`}>
                    {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect
                  </Button>}
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
  const businesses = useQuery<{ businesses: Business[] }>({
    queryKey: ["/api/yelp/businesses"], enabled: status.data?.available === true,
    queryFn: async () => (await apiRequest("GET", "/api/yelp/businesses")).json(),
  });
  const list = businesses.data?.businesses ?? [];
  return (
    <AppPage testId="page-yelp">
      <PageHeader
        title="Yelp"
        icon={Star}
        description="Your Yelp rating and latest reviews, with one-click replies on Yelp."
        actions={status.data?.available && list.length > 0 && !adding
          ? <Button className="gap-1.5 text-white" style={{ background: YELP_RED }} onClick={() => setAdding(true)} data-testid="yelp-add"><Plus className="h-4 w-4" /> Add business</Button>
          : undefined}
      />
      {status.data && !status.data.available && (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="yelp-unavailable">Yelp isn't switched on for this workspace yet.</Card>
      )}
      {status.data?.available && (
        <div className="space-y-4">
          {(list.length === 0 || adding) && <ConnectPanel onDone={() => setAdding(false)} onCancel={adding ? () => setAdding(false) : undefined} />}
          {businesses.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
          {list.map((b) => <BusinessCard key={b.id} b={b} />)}
          {!businesses.isLoading && list.length === 0 && !adding && (
            <p className="px-1 text-sm text-muted-foreground">Connect your Yelp business above to start tracking its reputation.</p>
          )}
        </div>
      )}
    </AppPage>
  );
}
