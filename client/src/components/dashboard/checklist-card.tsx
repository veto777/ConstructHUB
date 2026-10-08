import { useState } from "react";
import { ArrowRight, ChevronDown, Circle, CircleCheck } from "lucide-react";
import type { DashboardChecklistItem } from "@shared/dashboard";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { DashLink, FOCUS_RING } from "./dash-link";
import { SocialLinks } from "@/components/social-links";

const COLLAPSED_KEY = "constructhub:dashboard:checklist-collapsed";
const readCollapsed = () => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } };
const writeCollapsed = (v: boolean) => { try { window.localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch { /* private mode */ } };

/** Getting started: hidden once every step that applies is done; collapsible per browser. */
export function ChecklistCard({ items }: { items: DashboardChecklistItem[] }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const done = items.filter((i) => i.done).length;
  // "Start here": the first open step is the page's one solid call to action.
  const nextKey = items.find((i) => !i.done)?.key;
  if (!items.length || done === items.length) return null;
  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const listId = "dashboard-checklist-steps";

  return (
    <Card className="p-4 sm:p-5" data-testid="card-dashboard-checklist" role="region" aria-labelledby="dashboard-checklist-title">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id="dashboard-checklist-title" className="g-header__title">Getting started</h2>
            <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-checklist-count">{done} of {items.length} done</span>
          </div>
          <Progress value={(done / items.length) * 100} className="mt-2 h-1.5 max-w-md" aria-label={`Getting started: ${done} of ${items.length} steps done`} />
        </div>
        <GooglePill
          variant="quiet"
          size="sm"
          className="shrink-0"
          onClick={toggle}
          label={<span className="inline-flex items-center gap-1">{collapsed ? "Show steps" : "Hide"}<ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} aria-hidden="true" /></span>}
          testId="button-checklist-toggle"
        />
      </div>
      {!collapsed && (
        <GoogleList as="ul" id={listId} className="mt-2">
          {items.map((item) => {
            const next = item.key === nextKey;
            return (
              <GoogleListRow
                key={item.key}
                as="li"
                size="md"
                testId={`checklist-${item.key}`}
                data-done={item.done ? "true" : "false"}
                data-next={next ? "true" : undefined}
                leading={item.done
                  ? <CircleCheck className="g-open" />
                  : <Circle className="text-muted-foreground/60" />}
                title={(
                  <DashLink
                    href={item.href}
                    surface={item.surface}
                    className={`${item.done ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""} ${FOCUS_RING}`}
                    data-testid={`link-checklist-${item.key}`}
                  >
                    {item.label}
                    <span className="sr-only">{item.done ? " (done)" : next ? " (next step)" : " (to do)"}</span>
                  </DashLink>
                )}
                badges={next && <span className="g-chip g-chip--sm g-accent normal-case" data-testid="badge-checklist-next">Next step</span>}
                /* A finished step is one line: the open ones are what matter. */
                meta={!item.done ? item.description : undefined}
                /* The page's one solid button: the next step. */
                actions={next && (
                  <DashLink href={item.href} surface={item.surface} className="g-pill g-pill--solid g-pill--sm" aria-label={`Start: ${item.label}`}>
                    <span>Start</span> <ArrowRight aria-hidden="true" />
                  </DashLink>
                )}
              />
            );
          })}
        </GoogleList>
      )}
      {/* New accounts land here: where the tips and walkthrough videos are posted. */}
      {!collapsed && <SocialLinks tone="app" label="Follow us for tips" className="mt-3 border-t border-border/40 pt-3 sm:justify-start" testId="social-checklist" />}
    </Card>
  );
}
