import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/crm-ui";
import { GooglePill } from "@/components/google";
import { MediaGrid } from "./media-grid";
import { Lightbox } from "./lightbox";
import { jobcamFetch, type JobcamMediaItem } from "@/lib/jobcam-api";

/**
 * The client portal's read-only JobCam feed: ONLY the shots a team member
 * switched on for the client (the server filters; nothing here can widen it),
 * by day. Until something is shared the section is absent — no empty card.
 */
export function PortalJobcamFeed() {
  const feed = useInfiniteQuery<{ media: JobcamMediaItem[]; nextCursor: string | null }>({
    queryKey: ["/api/client/jobcam"],
    queryFn: ({ pageParam }) => jobcamFetch(`/api/client/jobcam?limit=60${pageParam ? `&before=${encodeURIComponent(pageParam as string)}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.media) ?? [], [feed.data]);
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;
  return (
    <section className="g-surface space-y-3" data-testid="section-portal-jobcam">
      <SectionTitle icon={Camera} title="From the job site" description="Photos and video your contractor shared from your project, newest first." />
      <Card>
        <CardContent className="p-4">
          <MediaGrid items={items} view="timeline" onOpen={setOpen} />
          {feed.hasNextPage && <div className="flex justify-center pt-3"><GooglePill size="sm" label={feed.isFetchingNextPage ? "Loading…" : "Show more"} onClick={() => void feed.fetchNextPage()} testId="portal-jobcam-more" /></div>}
        </CardContent>
      </Card>
      {open !== null && items[open] && <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} readOnly />}
    </section>
  );
}
