import type { DashboardUsage } from "@shared/dashboard";
import { Progress } from "@/components/ui/progress";
import { DashLink, FOCUS_RING } from "./dash-link";
import { formatCount, meterTone, toneBar, toneText, usageSurface } from "./format";

/** One compact meter per usage row: warn at 80 %, "bad" when full, -1 is Unlimited. */
export function UsageStrip({ usage }: { usage: DashboardUsage[] }) {
  if (!usage.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8" aria-label="Plan usage">
      {usage.map((u) => {
        const unlimited = u.limit < 0;
        // A full standing count (seats, locations) is "all in use", not an overrun: amber, never red.
        const raw = unlimited ? "default" : meterTone(u.used, u.limit);
        const tone = u.period === "count" && raw === "bad" ? "warn" : raw;
        const pct = unlimited ? 0 : Math.min(100, (u.used / Math.max(1, u.limit)) * 100);
        const amount = unlimited ? `${formatCount(u.used)} · Unlimited` : `${formatCount(u.used)} / ${formatCount(u.limit)}`;
        // A standing count can sit above the plan's limit (sites added before a downgrade): say so, never "All in use".
        const countState = u.used > u.limit ? "Over your plan's limit" : "All in use";
        const state = raw === "bad" ? (u.period === "count" ? countState : "Limit reached") : raw === "warn" ? "Almost at the limit" : null;
        return (
          <li key={u.key} className="min-w-0" data-testid={`usage-${u.key}`} data-tone={tone}>
            <DashLink
              href={u.href}
              surface={usageSurface(u)}
              className={`group block rounded-md py-1 ${FOCUS_RING}`}
              data-testid={`link-usage-${u.key}`}
            >
              <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2 2xl:flex-col 2xl:items-start 2xl:gap-0.5">
                <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">{u.label}</span>
                <span className={`shrink-0 text-xs font-semibold tabular-nums ${toneText(tone)}`}>{amount}</span>
              </span>
              <Progress
                value={unlimited ? 100 : pct}
                className={`mt-1.5 h-1.5 ${unlimited ? "[&>div]:bg-muted-foreground/25" : toneBar(tone)}`}
                aria-label={`${u.label}: ${amount}${u.period === "monthly" ? " this month" : ""}${state ? `, ${state.toLowerCase()}` : ""}`}
              />
              {state && <span className={`mt-1 block text-[11px] font-medium ${toneText(tone)}`}>{state}</span>}
            </DashLink>
          </li>
        );
      })}
    </ul>
  );
}
