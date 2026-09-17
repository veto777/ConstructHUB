import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard } from "@/components/crm-ui";
import {
  Loader2, Sun, ArrowRight, CheckCircle2, Flame, Clock, Eye,
  FileText, Receipt, Hammer, FileDiff, ClipboardCheck, TrendingDown,
} from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? null : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const KIND_ICON: Record<string, any> = {
  estimate: FileText, invoice: Receipt, project: Hammer,
  change_order: FileDiff, punch: ClipboardCheck, budget: TrendingDown,
};

const URGENCY = {
  now:   { label: "Now",      dot: "bg-rose-500",  ring: "border-rose-500/60",  text: "text-rose-600 dark:text-rose-400" },
  soon:  { label: "This week", dot: "bg-amber-500", ring: "border-amber-500/50", text: "text-amber-700 dark:text-amber-500" },
  watch: { label: "Keep an eye", dot: "bg-slate-400", ring: "",                 text: "text-muted-foreground" },
} as const;

/**
 * The work queue.
 *
 * Every other screen shows state — lists of things. This answers the question
 * a contractor actually opens the app with: what needs me right now, and why?
 * The reasons are computed server-side (/api/crm/today) so they're facts, not
 * UI guesses, and they read the same on the phone in a truck as on a desktop.
 */
export default function CrmTodayPage() {
  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/crm/today"],
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return <CrmPage><div className="flex justify-center p-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CrmPage>;
  }
  if (isError || !data) {
    return <CrmPage><ErrorCard title="Couldn't load your queue"
      description="Check your connection and refresh the page." /></CrmPage>;
  }

  const items: any[] = data.items ?? [];
  const { now = 0, soon = 0, watch = 0 } = data.counts ?? {};
  const atRisk = money(data.atRiskCents);

  const groups: Array<["now" | "soon" | "watch", any[]]> = [
    ["now", items.filter((i) => i.urgency === "now")],
    ["soon", items.filter((i) => i.urgency === "soon")],
    ["watch", items.filter((i) => i.urgency === "watch")],
  ];

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Sun}
        title="Today"
        subtitle={
          items.length === 0
            ? "Nothing needs you right now."
            : `${now} need${now === 1 ? "s" : ""} you now · ${soon} this week · ${watch} to watch`
        }
      />

      {atRisk && items.length > 0 && (
        <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Money waiting on a decision or a payment</div>
            <div className="text-2xl font-bold tabular-nums">{atRisk}</div>
          </div>
          <p className="text-xs text-muted-foreground max-w-xs">
            Unanswered estimates plus unpaid invoices. This is the number that moves when you work
            this list.
          </p>
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={CheckCircle2}
            title="You're clear"
            description="No stalled estimates, unscheduled work, overdue invoices or unsigned change orders."
            action={<Link href="/crm/pipeline"><Button variant="outline">Open the pipeline <ArrowRight className="h-4 w-4 ml-1" /></Button></Link>}
          />
        </div>
      )}

      {groups.map(([key, list]) => {
        if (!list.length) return null;
        const u = URGENCY[key];
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${u.dot}`} />
              <h2 className={`text-xs font-semibold uppercase tracking-widest ${u.text}`}>{u.label}</h2>
              <span className="text-xs text-muted-foreground">({list.length})</span>
            </div>

            <div className="space-y-2">
              {list.map((it) => {
                const Icon = KIND_ICON[it.kind] ?? Clock;
                const amt = money(it.amountCents);
                return (
                  <Link key={it.id} href={it.href}>
                    <div className={`rounded-lg border bg-card p-3 sm:p-4 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-primary/40 ${u.ring}`}
                      data-testid={`today-${it.id}`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted ${u.text}`}>
                          <Icon className="h-4 w-4" strokeWidth={1.9} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="font-medium leading-snug">{it.title}</span>
                            {amt && <span className="text-sm font-semibold tabular-nums shrink-0">{amt}</span>}
                          </div>
                          {/* The reason is the product. "Follow up" is useless;
                              "opened it 4 days ago, came back 3 times, still no
                              answer" tells you exactly what to say on the call. */}
                          <p className="text-sm text-muted-foreground mt-0.5">{it.reason}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {it.action}
                            </Badge>
                            {it.ageDays !== null && it.ageDays !== undefined && (
                              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                {key === "now" ? <Flame className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                {it.ageDays}d
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {data.truncated > 0 && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-4 space-y-2" data-testid="today-rollup">
          <div className="text-sm font-medium">
            + {data.truncated} more not shown
          </div>
          <p className="text-xs text-muted-foreground">
            The list is capped at the 40 most valuable and oldest items so it stays workable.
            Everything else, grouped:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {(data.rollup ?? []).map((r: any) => (
              <Badge key={`${r.kind}-${r.urgency}`} variant="outline" className="text-[11px] font-normal">
                {r.count} {r.kind.replace("_", " ")}{r.count === 1 ? "" : "s"}
                {r.totalCents ? ` · ${money(r.totalCents)}` : ""}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-2">
          <Eye className="h-3 w-3" />
          Refreshes every couple of minutes. Nothing here is a reminder you set — it's all derived
          from what your clients have and haven't done.
        </p>
      )}
    </CrmPage>
  );
}
