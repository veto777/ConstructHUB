/**
 * The signed-in home: a dashboard of every tool the account has, from one
 * GET /api/dashboard aggregate (docs/dashboard/SPEC.md, shared/dashboard.ts).
 * The marketing landing is a different page (landing.tsx); this one lives in
 * the app shell, in the app's own look.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, RefreshCw } from "lucide-react";
import {
  DASHBOARD_CLIENT_STALE_MS, DASHBOARD_TILES, dashboardAttention,
  type DashboardChecklistItem, type DashboardPayload, type DashboardTile, type DashboardTileDef,
} from "@shared/dashboard";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardHeader, UsageCard } from "@/components/dashboard/dashboard-header";
import { NeedsToday } from "@/components/dashboard/needs-today";
import { ChecklistCard } from "@/components/dashboard/checklist-card";
import { CrmSnapshotCard } from "@/components/dashboard/crm-snapshot-card";
import { TileGrid } from "@/components/dashboard/tile-grid";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { GabeNudge } from "@/components/dashboard/gabe-nudge";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";

const QUERY_KEY = ["/api/dashboard"] as const;

const FLAGS: Record<NonNullable<DashboardTileDef["flag"]>, boolean> = {
  SHOW_GOOGLE_REVIEWS,
  SHOW_COMPETITOR_INTEL,
};
const FLAG_BY_TILE = new Map(DASHBOARD_TILES.map((d) => [d.key, d.flag] as const));

/** Tiles behind a client feature flag are always sent; drop them while the flag is off. */
const visibleTiles = (tiles: DashboardTile[]) =>
  tiles.filter((t) => { const flag = FLAG_BY_TILE.get(t.key); return !flag || FLAGS[flag]; });
const visibleChecklist = (items: DashboardChecklistItem[]) =>
  items.filter((i) => i.key !== "requestReviews" || SHOW_GOOGLE_REVIEWS);

export default function HomePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery<DashboardPayload>({
    queryKey: QUERY_KEY,
    staleTime: DASHBOARD_CLIENT_STALE_MS,
    refetchOnWindowFocus: true,
  });
  const [refreshing, setRefreshing] = useState(false);

  // Refresh skips the server's 60 s cache and writes the answer into the same query.
  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard?fresh=1", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      queryClient.setQueryData(QUERY_KEY, (await res.json()) as DashboardPayload);
    } catch {
      toast({ title: "Couldn't refresh", description: "The numbers shown are from the last load. Try again in a moment.", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  let body;
  if (isLoading) {
    body = <DashboardSkeleton />;
  } else if (!data) {
    body = (
      <Card className="mx-auto max-w-xl p-6 text-center" role="alert" data-testid="card-dashboard-error">
        <TriangleAlert className="mx-auto h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Your dashboard didn't load</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isError ? "We couldn't reach the server." : "Nothing came back."} Your tools are still in the menu on the left.
        </p>
        <Button className="mt-4 min-h-10" onClick={() => refetch()} disabled={isRefetching} data-testid="button-dashboard-retry">
          <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  } else {
    const tiles = visibleTiles(data.tiles);
    const checklist = visibleChecklist(data.checklist);
    const byKey = (key: string) => tiles.find((t) => t.key === key);
    const crm = byKey("crm");
    // Action first: what needs you, then the CRM's money and day, then setup, meters and every tool.
    body = (
      <div className="space-y-6">
        <DashboardHeader
          account={data.account}
          generatedAt={data.generatedAt}
          fixture={data.fixture}
          refreshing={refreshing}
          onRefresh={refresh}
        />
        <NeedsToday items={dashboardAttention(tiles, data.account)} />
        {crm && <CrmSnapshotCard tile={crm} leads={byKey("crmLeads")} schedule={byKey("crmSchedule")} />}
        <ChecklistCard items={checklist} />
        <UsageCard account={data.account} />
        <div className="pt-2"><TileGrid tiles={tiles} /></div>
        <div className="grid gap-4 pt-2 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2"><RecentActivity items={data.recent} /></div>
          <div className="min-w-0"><GabeNudge checklist={checklist} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 font-sans sm:px-6" data-testid="page-dashboard">
      {body}
    </div>
  );
}
