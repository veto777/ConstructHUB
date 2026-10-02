import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GRID_COLS } from "./tile-grid";

function TileSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="mt-5 h-3 w-24" />
      <Skeleton className="mt-2 h-8 w-20" />
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </Card>
  );
}

/** Header, one card and eight tiles: the page's shape while /api/dashboard loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" data-testid="skeleton-dashboard" aria-busy="true" aria-label="Loading your dashboard">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-1.5 w-full" /></div>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <div className={GRID_COLS}>
          {Array.from({ length: 8 }, (_, i) => <TileSkeleton key={i} />)}
        </div>
      </div>
    </div>
  );
}
