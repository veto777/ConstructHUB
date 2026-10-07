import { Link } from "wouter";
import { Bell, KanbanSquare, TriangleAlert } from "lucide-react";
import type { DashboardRecentItem } from "@shared/dashboard";
import { Card } from "@/components/ui/card";
import { GoogleList, GoogleListRow, GoogleSectionHeader } from "@/components/google";
import { inNativeApp } from "@/lib/app-shell";
import { DashLink, FOCUS_RING } from "./dash-link";
import { relativeTime } from "./format";

/** Notifications and CRM team activity, newest first (≤ 12), as Google-style rows. */
export function RecentActivity({ items }: { items: DashboardRecentItem[] }) {
  return (
    <Card className="p-4 sm:p-5" role="region" aria-labelledby="dashboard-recent-title">
      <GoogleSectionHeader
        flush
        title={<span id="dashboard-recent-title">Recent activity</span>}
        actions={(
          <Link
            href="/settings?tab=notifications"
            className={`g-link inline-flex min-h-10 sm:min-h-8 items-center rounded-md text-sm font-medium ${FOCUS_RING}`}
            data-testid="link-dashboard-recent-all"
          >
            View all
          </Link>
        )}
      />
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="text-dashboard-recent-empty">
          Nothing yet. Activity from your tools shows up here.
        </p>
      ) : (
        <GoogleList as="ul" testId="list-dashboard-recent">
          {items.slice(0, 12).map((item) => {
            // The iPhone apps sell nothing (App Store 3.1.3(f)): activity that links to the
            // hidden Billing / Limits / API sections is plain text there — the words stay.
            const hidden = inNativeApp() && /\/settings\?tab=(billing|limits|api-)/.test(item.href ?? "");
            const Icon = item.severity !== "info" ? TriangleAlert : item.source === "crm" ? KanbanSquare : Bell;
            const iconTone =
              item.severity === "critical" ? "text-red-600 dark:text-red-400"
                : item.severity === "warning" ? "text-amber-600 dark:text-amber-400"
                  : "";
            const title = item.href && !hidden
              ? <DashLink href={item.href} surface={item.surface} className={FOCUS_RING}>{item.title}</DashLink>
              : item.title;
            return (
              <GoogleListRow
                key={item.id}
                as="li"
                size="md"
                testId={`recent-${item.id}`}
                leading={<Icon className={iconTone} />}
                title={<span className={item.unread ? "font-medium" : undefined}>{title}</span>}
                badges={item.unread && (
                  <span className="inline-block h-2 w-2 rounded-full bg-primary align-middle" data-testid={`unread-${item.id}`}>
                    <span className="sr-only">Unread</span>
                  </span>
                )}
                meta={[
                  item.body,
                  item.severity === "critical" ? "Urgent" : item.severity === "warning" ? "Needs a look" : null,
                  item.source === "crm" ? "CRM" : null,
                  <time key="at" dateTime={item.at}>{relativeTime(item.at)}</time>,
                ]}
              />
            );
          })}
        </GoogleList>
      )}
    </Card>
  );
}
