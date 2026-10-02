import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import type { DashboardAttentionItem } from "@shared/dashboard";
import { Card } from "@/components/ui/card";
import { DashLink, FOCUS_RING } from "./dash-link";
import { formatCount, formatMetricValue, toneText } from "./format";

/** "13", "12 of 10", "Growth": the item's number as the tiles print it. */
function amount(item: DashboardAttentionItem): string {
  const v = formatMetricValue(item);
  return item.limit !== undefined && item.limit >= 0 ? `${v} of ${formatCount(item.limit)}` : v;
}

/**
 * The few numbers that want action, at the top of the page (dashboardAttention
 * in shared/dashboard.ts): what the tiles already marked warn/bad, meters over
 * their limit, unread alerts. One line when there is nothing to do.
 */
export function NeedsToday({ items }: { items: DashboardAttentionItem[] }) {
  if (!items.length) {
    return (
      <Card className="flex items-center gap-2.5 px-4 py-3 text-sm sm:px-5" role="status" data-testid="card-dashboard-needs" data-count="0">
        <CircleCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <span><span className="font-medium">Nothing needs you today.</span> <span className="text-muted-foreground">Your numbers are below.</span></span>
      </Card>
    );
  }
  return (
    <Card className="p-4 sm:p-5" role="region" aria-labelledby="dashboard-needs-title" data-testid="card-dashboard-needs" data-count={items.length}>
      <div className="flex items-baseline gap-2">
        <h2 id="dashboard-needs-title" className="text-base font-semibold">Needs you today</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((item) => {
          const linkClass = `group flex h-full items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent ${FOCUS_RING}`;
          const body = (
            <>
              <TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${toneText(item.tone)}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{item.source}</span>
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-lg font-semibold tabular-nums leading-tight ${toneText(item.tone)}`}>{amount(item)}</span>
                  <span className="text-sm font-medium">{item.label}</span>
                </span>
                {item.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>}
              </span>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </>
          );
          return (
            <li key={item.key} data-testid={`needs-${item.key}`} data-tone={item.tone}>
              <DashLink href={item.href} surface={item.surface} className={linkClass} data-testid={`link-needs-${item.key}`}>{body}</DashLink>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
