/**
 * /jc/:token — the client-facing share page: the contractor's name and logo,
 * the project, then the gallery or live timeline. Password gate when the link
 * has one; honest "turned off" / "expired" states; swipe lightbox; downloads
 * when the link allows details.
 */
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Camera, Eye, EyeOff, Loader2, Lock, Phone, Globe, Mail } from "lucide-react";
import { GooglePill } from "@/components/google";
import { ErrorCard } from "@/components/crm-ui";
import { MediaGrid } from "@/components/jobcam/media-grid";
import { Lightbox } from "@/components/jobcam/lightbox";
import { jobcamError, jobcamFetch, type JobcamMediaItem } from "@/lib/jobcam-api";

type Meta = {
  kind: "gallery" | "timeline"; title: string | null; state: "ok" | "revoked" | "expired"; locked: boolean; showDetails: boolean; expiresAt: string | null;
  org: { name: string; logoUrl: string | null; phone: string | null; email: string | null; website: string | null } | null;
  project: { id: string; name: string; number: string | null; address: string | null } | null;
};

export default function JobcamSharePage() {
  const [, params] = useRoute("/jc/:token");
  const token = params?.token ?? "";
  const metaKey = [`/api/jc/${token}`];
  const { data: meta, isLoading, error, refetch } = useQuery<Meta>({ queryKey: metaKey, enabled: !!token, retry: false });
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const ready = !!meta && meta.state === "ok" && !meta.locked;
  useEffect(() => { document.title = meta?.title ? `${meta.title} · ${meta.org?.name ?? "JobCam"}` : "Shared photos"; }, [meta?.title, meta?.org?.name]);

  const feed = useInfiniteQuery<{ media: JobcamMediaItem[]; nextCursor: string | null }>({
    queryKey: [`/api/jc/${token}/media`],
    queryFn: ({ pageParam }) => jobcamFetch(`/api/jc/${token}/media?limit=60${pageParam ? `&before=${encodeURIComponent(pageParam as string)}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: ready,
    refetchInterval: meta?.kind === "timeline" ? 60_000 : false,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.media) ?? [], [feed.data]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true); setUnlockError(null);
    try {
      await jobcamFetch(`/api/jc/${token}/unlock`, { method: "POST", json: { password } });
      await refetch();
    } catch (err) {
      setUnlockError(jobcamError(err, "That password isn't right."));
    } finally { setUnlocking(false); }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !meta) {
    return <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4"><ErrorCard title="This link isn't valid" description={jobcamError(error, "This link is no longer valid.")} /></div>;
  }

  return (
    <div className="g-surface min-h-screen bg-[var(--g-surface-2)]" data-testid="jobcam-share-page">
      <header className="bg-[var(--g-surface)] border-b border-[var(--g-divider)]">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center gap-3">
          {meta.org?.logoUrl ? <img src={meta.org.logoUrl} alt="" className="h-10 w-10 rounded-md object-contain bg-white border border-[var(--g-divider)]" /> : <span className="h-10 w-10 rounded-md bg-[var(--g-accent-soft)] text-[var(--g-accent-ink)] inline-flex items-center justify-center"><Camera className="h-5 w-5" /></span>}
          <div className="min-w-0">
            <div className="text-[16px] font-medium truncate" data-testid="jobcam-share-org">{meta.org?.name ?? "Shared photos"}</div>
            <div className="text-[13px] text-[var(--g-text-2)] truncate">{meta.title ?? meta.project?.name}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        {meta.project && (
          <div className="text-[14px] text-[var(--g-text-2)]" data-testid="jobcam-share-project">
            <span className="text-[var(--g-text)] font-medium">{meta.project.name}</span>{meta.project.address ? ` · ${meta.project.address}` : ""}
            {meta.kind === "timeline" && <span className="ml-2 g-chip g-chip--sm">Live — updates as new photos come in</span>}
          </div>
        )}
        {meta.state !== "ok" ? (
          <ErrorCard title={meta.state === "revoked" ? "This link was turned off" : "This link has expired"} description={`Ask ${meta.org?.name ?? "the contractor"} for a new one.`} />
        ) : meta.locked ? (
          <form onSubmit={unlock} className="max-w-sm rounded-xl border border-[var(--g-divider)] bg-[var(--g-surface)] p-4 space-y-3" data-testid="jobcam-share-unlock">
            <div className="flex items-center gap-2 text-[16px] font-medium"><Lock className="h-5 w-5 text-[var(--g-accent)]" /> This link needs a password</div>
            <p className="text-[13px] text-[var(--g-text-2)]">{meta.org?.name ?? "The contractor"} shared it with you separately.</p>
            <span className="relative block">
              <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="g-input pr-10" placeholder="Password" autoFocus data-testid="jobcam-share-password-input" />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--g-text-2)]" aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </span>
            {unlockError && <p className="text-[13px] text-[var(--g-red)]" role="alert">{unlockError}</p>}
            <GooglePill variant="solid" label={unlocking ? "Checking…" : "Open"} type="submit" disabled={unlocking || !password} testId="jobcam-share-unlock-submit" />
          </form>
        ) : feed.isLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !items.length ? (
          <p className="text-[14px] text-[var(--g-text-2)]">Nothing here yet{meta.kind === "timeline" ? " — check back as the crew shoots." : "."}</p>
        ) : (
          <>
            <MediaGrid items={items} view={meta.kind === "timeline" ? "timeline" : "grid"} onOpen={setOpen} />
            {feed.hasNextPage && <div className="flex justify-center"><GooglePill label={feed.isFetchingNextPage ? "Loading…" : "Show more"} onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} testId="jobcam-share-more" /></div>}
          </>
        )}
        {meta.org && (
          <footer className="pt-6 text-[13px] text-[var(--g-text-2)] flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--g-divider)]">
            <span className="text-[var(--g-text)]">{meta.org.name}</span>
            {meta.org.phone && <a href={`tel:${meta.org.phone}`} className="g-link inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {meta.org.phone}</a>}
            {meta.org.email && <a href={`mailto:${meta.org.email}`} className="g-link inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {meta.org.email}</a>}
            {meta.org.website && /^https?:\/\//i.test(meta.org.website) && <a href={meta.org.website} target="_blank" rel="noopener noreferrer" className="g-link inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> {meta.org.website.replace(/^https?:\/\//, "")}</a>}
          </footer>
        )}
      </main>
      {open !== null && items[open] && (
        <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} readOnly showDetails={meta.showDetails} />
      )}
    </div>
  );
}
