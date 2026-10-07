import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, AlarmClock, Check, CircleCheck, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { DashboardAttentionItem } from "@shared/dashboard";
import { dashboardItemSnoozeOnly, snoozeUntil, type DashboardClearedItem } from "@shared/dashboard-prefs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { GoogleList, GoogleListRow } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import { DashLink, FOCUS_RING } from "./dash-link";
import { formatCount, formatMetricValue, toneText } from "./format";
import { useDismissItems, useRestoreItems } from "./use-dashboard-prefs";

/** "13", "12 of 10", "Growth": the item's number as the tiles print it. */
function amount(item: DashboardAttentionItem): string {
  const v = formatMetricValue(item);
  return item.limit !== undefined && item.limit >= 0 ? `${v} of ${formatCount(item.limit)}` : v;
}

const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** What keeps a cleared item away, in words. */
function clearedNote(item: DashboardClearedItem): string {
  return item.until
    ? `Snoozed until ${whenFmt.format(new Date(item.until))}`
    : "Done · comes back if the number changes";
}

const ICON_BTN = "h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8";

/**
 * The few numbers that want action, at the top of the page: what the tiles
 * already marked warn/bad, meters over their limit, unread alerts (the server
 * computes the list: shared/dashboard.ts dashboardAttention).
 *
 * Each item can be marked Done (hidden until its number changes) or snoozed
 * (until tomorrow / for a week); "Clear all" does the lot. "Payment past due"
 * can only be snoozed: its number never changes while the account is past
 * due, so a Done would hide it for good. Cleared items are
 * kept on the account (server-side) and listed under "Show cleared (N)",
 * where each can be restored.
 */
export function NeedsToday({ items, cleared }: { items: DashboardAttentionItem[]; cleared: DashboardClearedItem[] }) {
  const dismiss = useDismissItems();
  const restore = useRestoreItems();
  const { toast } = useToast();
  const [showCleared, setShowCleared] = useState(false);
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  /** After a clear, where keyboard focus goes once the list re-renders. */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    // After the snooze menu (gone with its item) has handed focus back: a tick later.
    window.setTimeout(() => {
      const el = key ? linkRefs.current.get(key) : null;
      (el ?? headingRef.current ?? statusRef.current)?.focus();
    }, 30);
  }, [items]);

  // Nothing left to show: close the cleared list with it.
  useEffect(() => { if (!cleared.length) setShowCleared(false); }, [cleared.length]);

  const clear = (list: DashboardAttentionItem[], until: Date | null) => {
    if (!list.length) return;
    const gone = new Set(list.map((i) => i.key));
    const left = items.filter((i) => !gone.has(i.key));
    // Focus the item that takes the first cleared one's place, else the card heading.
    const at = items.findIndex((i) => gone.has(i.key));
    focusNext.current = left[Math.min(at, left.length - 1)]?.key ?? "";
    dismiss.mutate({ items: list, until });
    const what = list.length === 1 ? `“${list[0].label}”` : `${list.length} items`;
    const verb = until ? `Snoozed ${what} until ${whenFmt.format(until)}` : `Cleared ${what}`;
    setAnnounce(`${verb}. ${left.length ? `${left.length} left.` : "Nothing else needs you today."}`);
    toast({
      title: verb,
      description: until ? "It comes back then, or sooner if the number changes." : "It comes back if the number changes.",
      action: (
        <ToastAction
          altText="Undo"
          onClick={() => restore.mutate({ items: list.map((i) => ({ ...i, signature: "", until: null })) })}
          data-testid="button-needs-undo"
        >
          Undo
        </ToastAction>
      ),
    });
  };

  const restoreItems = (list: DashboardClearedItem[] | null) => {
    restore.mutate({ items: list });
    const n = list ? list.length : cleared.length;
    setAnnounce(`Restored ${n === 1 ? "1 item" : `${n} items`} to Needs you today.`);
  };

  /** What "Clear all" marks Done: everything but the snooze-only items. */
  const doneable = items.filter((i) => !dashboardItemSnoozeOnly(i.key));

  const live = <span className="sr-only" role="status" aria-live="polite" data-testid="text-needs-live">{announce}</span>;

  const clearedToggle = cleared.length > 0 && (
    <Button
      variant="link"
      size="sm"
      className="h-auto min-h-10 px-0 text-sm sm:min-h-8"
      aria-expanded={showCleared}
      aria-controls="dashboard-needs-cleared"
      onClick={() => setShowCleared((v) => !v)}
      data-testid="button-needs-show-cleared"
    >
      {showCleared ? "Hide cleared" : `Show cleared (${cleared.length})`}
    </Button>
  );

  const clearedList = showCleared && cleared.length > 0 && (
    <div id="dashboard-needs-cleared" className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3" data-testid="list-needs-cleared">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Cleared</h3>
        <Button variant="ghost" size="sm" className="min-h-10 sm:min-h-8" onClick={() => restoreItems(null)} data-testid="button-needs-restore-all">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Restore all
        </Button>
      </div>
      <ul className="space-y-1.5">
        {cleared.map((item) => (
          <li key={item.key} className="flex items-center gap-3 rounded-md bg-card px-3 py-2" data-testid={`cleared-${item.key}`} data-snoozed={item.until ? "true" : "false"}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">
                <span className="font-medium tabular-nums">{amount(item)}</span> {item.label}
                <span className="text-muted-foreground"> · {item.source}</span>
              </span>
              <span className="block text-xs text-muted-foreground">{clearedNote(item)}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 shrink-0 sm:min-h-8"
              onClick={() => restoreItems([item])}
              aria-label={`Restore ${item.label} (${item.source})`}
              data-testid={`button-needs-restore-${item.key}`}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );

  if (!items.length) {
    return (
      <Card className="px-4 py-3 text-sm sm:px-5" role="region" aria-label="Needs you today" data-testid="card-dashboard-needs" data-count="0" data-cleared={cleared.length}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <span ref={statusRef} tabIndex={-1} className="outline-none">
            <span className="font-medium">Nothing needs you today.</span> <span className="text-muted-foreground">Your numbers are below.</span>
          </span>
          {clearedToggle && <span className="ml-auto">{clearedToggle}</span>}
        </div>
        {clearedList}
        {live}
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5" role="region" aria-labelledby="dashboard-needs-title" data-testid="card-dashboard-needs" data-count={items.length} data-cleared={cleared.length}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 id="dashboard-needs-title" ref={headingRef} tabIndex={-1} className="g-header__title outline-none">Needs you today</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3">
          {clearedToggle}
          {doneable.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 sm:min-h-8"
              onClick={() => clear(doneable, null)}
              data-testid="button-needs-clear-all"
            >
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Clear all
            </Button>
          )}
        </div>
      </div>
      <GoogleList as="ul" className="mt-1">
        {items.map((item) => {
          const name = `${item.label} (${item.source})`;
          return (
            <GoogleListRow
              key={item.key}
              as="li"
              size="md"
              testId={`needs-${item.key}`}
              data-tone={item.tone}
              leading={<TriangleAlert className={toneText(item.tone)} />}
              title={(
                <DashLink
                  ref={(el: HTMLAnchorElement | null) => { if (el) linkRefs.current.set(item.key, el); else linkRefs.current.delete(item.key); }}
                  href={item.href}
                  surface={item.surface}
                  className={FOCUS_RING}
                  data-testid={`link-needs-${item.key}`}
                >
                  <span className={`tabular-nums ${toneText(item.tone)}`}>{amount(item)}</span> {item.label}
                </DashLink>
              )}
              meta={[item.source, item.hint]}
              trailing={<>
                {/* Clearing a task is one tap (owner, 2026-10-02: "lets make a way to clear these tasks"); snoozing sits in ⋯. */}
                {!dashboardItemSnoozeOnly(item.key) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={ICON_BTN}
                    title="Done"
                    aria-label={`Done: ${name}`}
                    onClick={() => clear([item], null)}
                    data-testid={`button-needs-done-${item.key}`}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={ICON_BTN}
                      title="Snooze"
                      aria-label={`Snooze: ${name}`}
                      data-testid={`button-needs-snooze-${item.key}`}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="[&_[role=menuitem]]:min-h-10">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Snooze “{item.label}”</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => clear([item], snoozeUntil("tomorrow"))} data-testid={`menu-needs-snooze-tomorrow-${item.key}`}>
                      Until tomorrow
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => clear([item], snoozeUntil("week"))} data-testid={`menu-needs-snooze-week-${item.key}`}>
                      For a week
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>}
            />
          );
        })}
      </GoogleList>
      {clearedList}
      {live}
    </Card>
  );
}
