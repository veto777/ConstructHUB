import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Circle, CircleCheck } from "lucide-react";
import type { DashboardChecklistItem } from "@shared/dashboard";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DashLink, FOCUS_RING } from "./dash-link";

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
            <h2 id="dashboard-checklist-title" className="text-base font-semibold">Getting started</h2>
            <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-checklist-count">{done} of {items.length} done</span>
          </div>
          <Progress value={(done / items.length) * 100} className="mt-2 h-1.5 max-w-md" aria-label={`Getting started: ${done} of ${items.length} steps done`} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-10 sm:min-h-8 shrink-0"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-testid="button-checklist-toggle"
        >
          {collapsed ? "Show steps" : "Hide"}
          <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} aria-hidden="true" />
        </Button>
      </div>
      {!collapsed && (
        <ul id={listId} className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const next = item.key === nextKey;
            return (
            <li key={item.key} data-testid={`checklist-${item.key}`} data-done={item.done ? "true" : "false"} data-next={next ? "true" : undefined}>
              <DashLink
                href={item.href}
                surface={item.surface}
                className={`group flex h-full items-start gap-3 rounded-lg border p-3 transition-colors ${next ? "border-primary/60 bg-primary/5 hover:bg-primary/10" : "hover:bg-accent"} ${FOCUS_RING}`}
                data-testid={`link-checklist-${item.key}`}
              >
                {item.done ? (
                  <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  {next && <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-primary" data-testid="badge-checklist-next">Next step</span>}
                  <span className={`block text-sm font-medium ${item.done ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}>
                    {item.label}
                    <span className="sr-only">{item.done ? " (done)" : next ? " (next step)" : " (to do)"}</span>
                  </span>
                  {/* A finished step is one line: the open ones are what matter. */}
                  {!item.done && <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>}
                  {/* Looks like the page's primary button; the whole row is the link. */}
                  {next && (
                    <span className={`${buttonVariants({ size: "sm" })} mt-3 min-h-9 pointer-events-none`} aria-hidden="true">
                      Start <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
                {!item.done && !next && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
              </DashLink>
            </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
