import { Link } from "wouter";
import { Bell, KanbanSquare, TriangleAlert } from "lucide-react";
import type { DashboardRecentItem } from "@shared/dashboard";
import { Card } from "@/components/ui/card";
import { inNativeApp } from "@/lib/app-shell";
import { DashLink, FOCUS_RING } from "./dash-link";
import { relativeTime } from "./format";

function ItemBody({ item }: { item: DashboardRecentItem }) {
  const Icon = item.severity !== "info" ? TriangleAlert : item.source === "crm" ? KanbanSquare : Bell;
  const iconTone =
    item.severity === "critical" ? "text-red-600 dark:text-red-400"
      : item.severity === "warning" ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <>
      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
        <Icon className={`h-4 w-4 ${iconTone}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={`min-w-0 flex-1 text-sm ${item.unread ? "font-semibold" : "font-medium"}`}>{item.title}</span>
          {item.unread && (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" data-testid={`unread-${item.id}`}>
              <span className="sr-only">Unread</span>
            </span>
          )}
        </span>
        {item.body && <span className="mt-0.5 block text-xs text-muted-foreground">{item.body}</span>}
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {item.severity === "critical" ? "Urgent · " : item.severity === "warning" ? "Needs a look · " : ""}
          {item.source === "crm" ? "CRM · " : ""}
          <time dateTime={item.at}>{relativeTime(item.at)}</time>
        </span>
      </span>
    </>
  );
}

/** Notifications and CRM team activity, newest first (≤ 12). */
export function RecentActivity({ items }: { items: DashboardRecentItem[] }) {
  return (
    <Card className="p-4 sm:p-5" role="region" aria-labelledby="dashboard-recent-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-recent-title" className="text-base font-semibold">Recent activity</h2>
        <Link
          href="/settings?tab=notifications"
          className={`inline-flex min-h-10 sm:min-h-8 items-center rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 ${FOCUS_RING}`}
          data-testid="link-dashboard-recent-all"
        >
          View all
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="text-dashboard-recent-empty">
          Nothing yet. Activity from your tools shows up here.
        </p>
      ) : (
        <ul className="mt-2 divide-y" data-testid="list-dashboard-recent">
          {items.slice(0, 12).map((item) => {
            // The iPhone apps sell nothing (App Store 3.1.3(f)): activity that links to the
            // hidden Billing / Limits / API sections is plain text there — the words stay.
            const hidden = inNativeApp() && /\/settings\?tab=(billing|limits|api-)/.test(item.href ?? "");
            return (
              <li key={item.id} data-testid={`recent-${item.id}`}>
                {item.href && !hidden ? (
                  <DashLink href={item.href} surface={item.surface} className={`-mx-2 flex items-start gap-3 rounded-md px-2 py-3 hover:bg-accent ${FOCUS_RING}`}>
                    <ItemBody item={item} />
                  </DashLink>
                ) : (
                  <div className="flex items-start gap-3 py-3"><ItemBody item={item} /></div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
