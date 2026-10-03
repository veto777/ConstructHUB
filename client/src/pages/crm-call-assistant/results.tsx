import { Section } from "@/components/app-ui";
/**
 * Results — what the assistant did with the calls (owner, 2026-10-02: "this data should be logged in the
 * constructhub page … The clients want to see this data when using this service. This is very helpful to see what
 * the results are"). Shown on the Overview and above the Calls tab. Reads GET /api/crm/voice/calls/summary
 * (server/voice/calls.ts), counted from the call log, so calls pushed in from another receptionist count too.
 * Each tile opens the matching calls.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, BellRing, ClipboardCheck, Info, Mic, PhoneMissed, ShieldBan, Timer, XCircle } from "lucide-react";
import { CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ResultsRange = "7d" | "30d" | "month" | "all";
export type ResultsPick = "lead_submitted" | "alerted" | "info" | "declined" | "hangup" | "spam";

type Summary = {
  range: ResultsRange;
  total: number;
  minutes: number;
  recordings: number;
  firstCallAt: string | null;
  outcomes: Record<string, number>;
  lines: { label: string; calls: number; leads: number }[];
};

const RANGE_LABELS: Record<ResultsRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", month: "This month", all: "All time" };

/** The tiles, in the order an owner reads them: what made money first, spam last. */
const TILES: { key: ResultsPick; label: string; hint: string; outcomes: string[]; icon: typeof BellRing; tone: string }[] = [
  { key: "lead_submitted", label: "Estimate requests", hint: "Forms filed for your team", outcomes: ["lead_submitted", "booked"], icon: ClipboardCheck, tone: "text-foreground" },
  { key: "alerted", label: "Sent to a person", hint: "Urgent or follow-up, someone was alerted", outcomes: ["alerted"], icon: BellRing, tone: "text-amber-600 dark:text-amber-400" },
  { key: "info", label: "Questions answered", hint: "Callers who only needed information", outcomes: ["info"], icon: Info, tone: "text-sky-600 dark:text-sky-400" },
  { key: "declined", label: "Declined", hint: "Work you don't do, or outside your area", outcomes: ["declined", "out_of_area"], icon: XCircle, tone: "text-muted-foreground" },
  { key: "hangup", label: "Hung up", hint: "Ended before saying what they needed", outcomes: ["hangup", "voicemail"], icon: PhoneMissed, tone: "text-muted-foreground" },
  { key: "spam", label: "Spam blocked", hint: "You never had to pick up", outcomes: ["spam", "blocked"], icon: ShieldBan, tone: "text-violet-600 dark:text-violet-400" },
];

const sum = (o: Record<string, number>, keys: string[]) => keys.reduce((n, k) => n + (o[k] ?? 0), 0);

export function CallResults({ onPick, className }: { onPick: (pick: ResultsPick) => void; className?: string }) {
  const [range, setRange] = useState<ResultsRange>("30d");
  const q = useQuery<Summary>({ queryKey: [`/api/crm/voice/calls/summary?range=${range}`] });
  // A reply without the summary's shape counts as an error, never a crash.
  const d = q.data && typeof q.data.total === "number" && q.data.outcomes && Array.isArray(q.data.lines) ? q.data : undefined;
  const spam = d ? sum(d.outcomes, ["spam", "blocked"]) : 0;
  const real = d ? d.total - spam : 0;
  const leads = d ? sum(d.outcomes, ["lead_submitted", "booked"]) : 0;
  const leadRate = real > 0 ? Math.round((leads / real) * 100) : null;
  const maxLine = d?.lines.reduce((m, l) => Math.max(m, l.calls), 0) ?? 0;

  return (
    <Section flush className={className} testId="card-call-results">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4" aria-hidden="true" /> Results</h2>
            <p className="text-sm text-muted-foreground">What your assistant did with every call.</p>
          </div>
          <div className="w-40">
            <Select value={range} onValueChange={(v) => setRange(v as ResultsRange)}>
              <SelectTrigger aria-label="Period" data-testid="select-results-range"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABELS) as ResultsRange[]).map((r) => <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {q.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TILES.map((t) => <Skeleton key={t.key} className="h-20" />)}</div>
        ) : q.isError || !d ? (
          <p className="text-sm text-muted-foreground" role="alert" data-testid="text-results-error">Couldn't load the results. <button type="button" className="underline" onClick={() => q.refetch()}>Try again</button></p>
        ) : d.total === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-results-empty">
            No calls {range === "all" ? "yet" : `in the ${RANGE_LABELS[range].toLowerCase()}`}. Results appear here as soon as your assistant answers its first call.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm" data-testid="row-results-headline">
              <p><span className="text-2xl font-semibold tabular-nums" data-testid="text-results-total">{d.total.toLocaleString("en-US")}</span> calls answered</p>
              <p><span className="text-2xl font-semibold tabular-nums" data-testid="text-results-real">{real.toLocaleString("en-US")}</span> real callers</p>
              {leadRate !== null && (
                <p><span className="text-2xl font-semibold tabular-nums text-foreground" data-testid="text-results-lead-rate">{leadRate}%</span> became estimate requests</p>
              )}
            </div>

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="list-results-outcomes">
              {TILES.map((t) => {
                const n = sum(d.outcomes, t.outcomes);
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => onPick(t.key)}
                      className="h-full w-full rounded-lg p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`tile-results-${t.key}`}
                    >
                      <span className="block text-xs font-medium text-muted-foreground">{t.label}</span>
                      <span className="mt-1 block text-2xl font-semibold tabular-nums" data-testid={`text-results-${t.key}`}>{n.toLocaleString("en-US")}</span>
                      <span className="block text-xs text-muted-foreground">{t.hint}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="grid gap-4 md:grid-cols-2">
              <section aria-labelledby="results-lines-title" className="space-y-2">
                <h3 id="results-lines-title" className="text-sm font-medium">Calls by line</h3>
                <ul className="space-y-1.5" data-testid="list-results-lines">
                  {d.lines.map((l) => (
                    <li key={l.label} className="text-sm" data-testid="row-results-line">
                      <div className="flex justify-between gap-2"><span className="truncate">{l.label}</span><span className="tabular-nums text-muted-foreground">{l.calls} calls · {l.leads} estimate {l.leads === 1 ? "request" : "requests"}</span></div>
                      <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-foreground/30" style={{ width: `${maxLine ? Math.max(4, Math.round((l.calls / maxLine) * 100)) : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Time and recordings" className="flex flex-wrap content-start gap-6 text-sm">
                <p className="flex items-center gap-2"><Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span><span className="font-semibold tabular-nums" data-testid="text-results-minutes">{d.minutes.toLocaleString("en-US")}</span> minutes on the phone for you</span></p>
                <p className="flex items-center gap-2"><Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span><span className="font-semibold tabular-nums" data-testid="text-results-recordings">{d.recordings.toLocaleString("en-US")}</span> of {d.total.toLocaleString("en-US")} calls recorded</span></p>
              </section>
            </div>
          </>
        )}
      </CardContent>
    </Section>
  );
}
