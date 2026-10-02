import { ArrowRight, ArrowUpRight, KanbanSquare, TriangleAlert } from "lucide-react";
import type { DashboardTile } from "@shared/dashboard";
import { CRM_NAME } from "@/lib/site";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashLink, FOCUS_RING } from "./dash-link";
import { LockedPrompt } from "./locked-prompt";
import { MetricHero } from "./dashboard-tile";

/** A metric of the leads or schedule tile, shown on the card's second row. */
type WorkMetric = { tile: DashboardTile; key: string };

/**
 * What the second row shows, in order: follow-ups, new leads, leads without an
 * estimate, today's visits. A visit count already on the first row (a crew
 * seat's "Today's visits") is not repeated.
 */
function workRow(crm: DashboardTile, leads?: DashboardTile, schedule?: DashboardTile): WorkMetric[] {
  const out: WorkMetric[] = [];
  const add = (tile: DashboardTile | undefined, key: string) => {
    if (tile?.status === "ok" && tile.metrics.some((m) => m.key === key)) out.push({ tile, key });
  };
  add(leads, "followUpsDue");
  add(leads, "newLeads7d");
  add(leads, "needEstimate");
  if (!crm.metrics.some((m) => m.key === "todayVisits")) add(schedule, "today");
  add(schedule, "week");
  return out;
}

/**
 * The CRM tile, wide: the money numbers first, then the day's work (leads,
 * follow-ups, visits) from the leads and schedule tiles, which have no grid
 * tile of their own (docs/dashboard/SPEC.md §4.3).
 */
export function CrmSnapshotCard({ tile, leads, schedule }: { tile: DashboardTile; leads?: DashboardTile; schedule?: DashboardTile }) {
  const isEmpty = tile.status === "empty" || (tile.status === "ok" && tile.metrics.length === 0);
  // An account without a CRM yet goes through the /crm-app gateway, which sets it up.
  const work = workRow(tile, leads, schedule);
  const failed = [leads, schedule].filter((t) => t?.status === "error").map((t) => (t!.key === "crmLeads" ? "Leads and follow-ups" : "The schedule"));
  const workNote = failed.length ? `${failed.join(" and ")} didn't load. Open the CRM for live numbers.` : null;
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
          <Button asChild size="sm" variant="outline" className="min-h-10 sm:min-h-8 w-full sm:w-auto">
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
      {tile.status === "ok" && work.length > 0 && (
        <div className="mt-5 border-t pt-4" data-testid="row-dashboard-crm-work">
          <h3 className="sr-only">Today's work</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 2xl:grid-cols-6">
            {work.map(({ tile: t, key }) => {
              const m = t.metrics.find((x) => x.key === key)!;
              return (
                <DashLink
                  key={`${t.key}-${key}`}
                  href={t.href}
                  surface={t.surface}
                  className={`-m-1.5 block rounded-md p-1.5 transition-colors hover:bg-accent ${FOCUS_RING}`}
                  data-testid={`link-crm-work-${t.key}-${key}`}
                >
                  <dl><MetricHero tileKey={t.key} metric={m} size="sm" /></dl>
                </DashLink>
              );
            })}
          </div>
        </div>
      )}
      {tile.status === "ok" && workNote && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-dashboard-crm-work-error">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <span>{workNote}</span>
        </p>
      )}
      {tile.status === "ok" && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {[schedule, leads].filter((t): t is DashboardTile => !!t && t.status !== "locked").map((t) => (
            <DashLink
              key={t.key}
              href={t.href}
              surface={t.surface}
              className={`inline-flex min-h-10 sm:min-h-8 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 ${FOCUS_RING}`}
              data-testid={`link-tile-${t.key}`}
            >
              {t.key === "crmSchedule" ? "Schedule" : "Pipeline"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </DashLink>
          ))}
        </div>
      )}
      {tile.status === "error" && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
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
