import { ArrowUpRight, KanbanSquare, TriangleAlert } from "lucide-react";
import type { DashboardTile } from "@shared/dashboard";
import { CRM_NAME } from "@/lib/site";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashLink } from "./dash-link";
import { LockedPrompt } from "./locked-prompt";
import { MetricHero } from "./dashboard-tile";

/** The CRM tile, wide: the money numbers first (docs/dashboard/SPEC.md §4.3). */
export function CrmSnapshotCard({ tile }: { tile: DashboardTile }) {
  const isEmpty = tile.status === "empty" || (tile.status === "ok" && tile.metrics.length === 0);
  // An account without a CRM yet goes through the /crm-app gateway, which sets it up.
  const cta = isEmpty
    ? { label: "Set up the CRM", href: "/crm-app", surface: "app" as const }
    : { label: "Open the CRM", href: tile.cta?.href ?? tile.href, surface: tile.cta?.surface ?? tile.surface };

  return (
    <Card className="p-4 sm:p-5" data-testid="card-dashboard-crm" data-status={tile.status} aria-labelledby="dashboard-crm-title" role="region">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
            <KanbanSquare className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 id="dashboard-crm-title" className="text-base font-semibold leading-tight">{CRM_NAME}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isEmpty ? "Your CRM is included with your plan." : tile.description}
            </p>
          </div>
        </div>
        {tile.status !== "locked" && (
          <Button asChild size="sm" variant={isEmpty ? "default" : "outline"} className="min-h-10 sm:min-h-8 w-full sm:w-auto">
            <DashLink href={cta.href} surface={cta.surface} data-testid="link-dashboard-crm">
              {cta.label} <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </DashLink>
          </Button>
        )}
      </div>

      {tile.status === "ok" && tile.metrics.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 2xl:grid-cols-6">
          {tile.metrics.slice(0, 6).map((m) => <MetricHero key={m.key} tileKey="crm" metric={m} size="md" />)}
        </dl>
      )}
      {tile.status === "error" && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span>{tile.message ?? "The CRM didn't answer in time. Open it for live numbers."}</span>
        </p>
      )}
      {tile.status === "locked" && (
        <div className="mt-4">
          <LockedPrompt tileKey="crm" requiredPlan={tile.requiredPlan} module={tile.module} href={tile.cta?.href} surface={tile.cta?.surface} compact />
        </div>
      )}
    </Card>
  );
}
