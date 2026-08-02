import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, Loader2, Clock, MapPin } from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, statusTone,
} from "@/components/crm-ui";
import { cn } from "@/lib/utils";

interface Appointment {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  arrivalWindowMinutes: number | null;
  notes: string | null;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  customerName: string | null;
  crew: string[];
}

const RANGES = [7, 14, 30] as const;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function dayLabel(iso: string): string {
  const d = dayStart(new Date(iso));
  const diff = Math.round((d.getTime() - dayStart(new Date()).getTime()) / 86400000);
  const pretty = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (diff === 0) return `Today · ${pretty}`;
  if (diff === 1) return `Tomorrow · ${pretty}`;
  return pretty;
}

function timeLabel(a: Appointment): string {
  if (a.allDay) return "All day";
  const start = new Date(a.startsAt);
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!a.endsAt) return fmt(start);
  return `${fmt(start)} – ${fmt(new Date(a.endsAt))}`;
}

/** Every visit across the org's projects, grouped by day. Read-only. */
export default function CrmSchedulePage() {
  const [days, setDays] = useState<number>(14);
  const { data, isLoading, isError } = useQuery<{ days: number; appointments: Appointment[] }>({
    queryKey: ["/api/crm/schedule", `?days=${days}`],
    queryFn: async () => {
      const r = await fetch(`/api/crm/schedule?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  // Group appointments into day buckets, preserving the server's time order.
  const groups: { key: string; label: string; items: Appointment[] }[] = [];
  for (const a of data?.appointments ?? []) {
    const key = dayStart(new Date(a.startsAt)).toISOString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a);
    else groups.push({ key, label: dayLabel(a.startsAt), items: [a] });
  }

  return (
    <CrmPage>
      <CrmPageHeader
        icon={CalendarDays}
        title="Schedule"
        infoKey="schedule"
        subtitle="Every visit across your projects, day by day."
        actions={
          <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-1" data-testid="schedule-range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                data-testid={`button-days-${r}`}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  days === r ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError || !data ? (
        <ErrorCard title="Couldn't load the schedule" description="Check your connection and refresh the page." />
      ) : groups.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={CalendarDays}
            title={`Nothing scheduled in the next ${days} days`}
            description="Visits booked on your projects will show up here, grouped by day."
          />
        </div>
      ) : (
        <div className="space-y-5" data-testid="schedule-list">
          {groups.map((g) => (
            <section key={g.key} data-testid={`schedule-day-${g.key.slice(0, 10)}`}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1 pb-2">
                {g.label}
              </h2>
              <div className="space-y-2">
                {g.items.map((a) => {
                  const body = (
                    <div className={cn(
                      "rounded-xl border bg-card p-3.5 sm:p-4 transition-colors",
                      a.projectId && "hover:border-primary/40 hover:shadow-sm cursor-pointer",
                    )}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm leading-snug">{a.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {timeLabel(a)}
                            </span>
                            {(a.projectName || a.customerName) && (
                              <span className="inline-flex items-center gap-1 truncate">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {a.projectName ?? a.customerName}
                                  {a.projectNumber ? ` · ${a.projectNumber}` : ""}
                                </span>
                              </span>
                            )}
                          </div>
                          {a.crew.length > 0 && (
                            <div className="mt-1.5 text-xs text-muted-foreground">
                              Crew: {a.crew.join(", ")}
                            </div>
                          )}
                        </div>
                        <StatusPill tone={statusTone(a.status)} className="shrink-0">
                          {a.status.replace(/_/g, " ")}
                        </StatusPill>
                      </div>
                    </div>
                  );
                  return a.projectId ? (
                    <Link key={a.id} href={`/crm/projects/${a.projectId}`} data-testid={`appt-${a.id}`}>{body}</Link>
                  ) : (
                    <div key={a.id} data-testid={`appt-${a.id}`}>{body}</div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </CrmPage>
  );
}
