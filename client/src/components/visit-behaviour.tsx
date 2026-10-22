/**
 * What a client read and clicked on their estimate — the contractor's view
 * of shared/engagement-events.ts. BehaviourChips is the one-line summary
 * (terms / pamphlets / 3D / discounts / device); VisitTimeline is a visit's
 * minute-by-minute list.
 */
import { Check, X, Smartphone, Monitor, Tablet } from "lucide-react";
import { formatSecs, type VisitDetail, type VisitSummary } from "@shared/engagement-events";
import { cn } from "@/lib/utils";

function Chip({ ok, label, testid }: { ok: boolean; label: string; testid: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
      data-testid={testid}>
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

export function BehaviourChips({ summary, className }: { summary: VisitSummary; className?: string }) {
  const dev = summary.device ?? "";
  const DevIcon = /iPad|tablet/i.test(dev) ? Tablet : /iPhone|phone/i.test(dev) ? Smartphone : Monitor;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="behaviour-chips">
      <Chip ok={summary.readTerms}
        label={summary.readTerms && summary.termsSecs > 0 ? `Read terms (${formatSecs(summary.termsSecs)})` : "Read terms"}
        testid="chip-terms" />
      <Chip ok={summary.pamphlets} label="Pamphlets" testid="chip-pamphlets" />
      <Chip ok={summary.model3d} label="3D model" testid="chip-3d" />
      <Chip ok={summary.discountsViewed} label="Discounts" testid="chip-discounts" />
      {summary.scrollPct != null && (
        <span className="text-[11px] text-muted-foreground" data-testid="chip-scroll">Scrolled {summary.scrollPct}%</span>
      )}
      {summary.device && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="chip-device">
          <DevIcon className="h-3 w-3" /> {summary.device}
        </span>
      )}
    </div>
  );
}

const offset = (secs: number) => {
  const m = Math.floor(secs / 60);
  return `${m}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
};

export function VisitTimeline({ visit }: { visit: VisitDetail }) {
  return (
    <div className="space-y-2" data-testid="visit-timeline">
      <BehaviourChips summary={visit.summary} />
      {visit.lines.length ? (
        <ol className="space-y-1 border-l pl-3">
          {visit.lines.map((l, i) => (
            <li key={i} className="flex gap-3 text-xs">
              <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{offset(l.offsetSecs)}</span>
              <span className={l.name === "approve_abandoned" ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{l.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No clicks or reading recorded for this visit (visits before this tracking started only have the time spent).
        </p>
      )}
    </div>
  );
}
