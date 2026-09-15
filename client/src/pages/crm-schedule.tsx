import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CalendarDays, Loader2, Clock, MapPin, Plus, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AppointmentForm, dayStart, isoDay, type Appointment,
} from "@/components/crm-appointment-form";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, statusTone,
} from "@/components/crm-ui";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "agenda";

const RANGES = [7, 14, 30] as const;

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

/** Sunday on/before d. */
function weekStart(d: Date): Date {
  const s = dayStart(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

// ── The page ────────────────────────────────────────────────────────────────

/**
 * The org schedule: a real month/week calendar you can scroll through, add
 * appointments from any day, and click a visit to edit/reschedule/delete it —
 * plus the original day-grouped agenda for the ribbon.
 */
export default function CrmSchedulePage() {
  const { toast } = useToast();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [days, setDays] = useState<number>(14);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  // Whose visits to show: "mine" (default — calendars are per user unless you
  // widen them), "all" (the org board), or one member's id. Remembered per browser.
  const SCOPE_KEY = "crm.schedule.scope";
  const [scope, setScopeState] = useState<string>(() => {
    try { return localStorage.getItem(SCOPE_KEY) || "mine"; } catch { return "mine"; }
  });
  const setScope = (v: string) => {
    setScopeState(v);
    try { localStorage.setItem(SCOPE_KEY, v); } catch { /* private mode etc. */ }
  };

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageJobs === true;
  const myMemberId: string | undefined = me?.member?.id;

  // The visible window the calendar must cover.
  const range = useMemo(() => {
    if (view === "month") {
      const first = weekStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const last = new Date(first);
      last.setDate(last.getDate() + 42);
      return { from: first, to: last };
    }
    const first = weekStart(cursor);
    const last = new Date(first);
    last.setDate(last.getDate() + 7);
    return { from: first, to: last };
  }, [view, cursor]);

  const { data: calData, isLoading: calLoading, isError: calError } = useQuery<{ appointments: Appointment[] }>({
    queryKey: ["/api/crm/appointments", range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const r = await fetch(
        `/api/crm/appointments?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: view !== "agenda",
  });

  const { data: agendaData, isLoading: agendaLoading, isError: agendaError } = useQuery<{ days: number; appointments: Appointment[] }>({
    queryKey: ["/api/crm/schedule", `?days=${days}`],
    queryFn: async () => {
      const r = await fetch(`/api/crm/schedule?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: view === "agenda",
  });

  // Everyone can list members (org-scoped, read-only) — the crew filter needs
  // the names even for roles that can't book.
  const { data: membersData } = useQuery<any>({ queryKey: ["/api/crm/members"] });
  const { data: projectsData } = useQuery<any>({
    queryKey: ["/api/crm/projects"], enabled: canManage,
  });
  const { data: customers } = useQuery<any[]>({
    queryKey: ["/api/crm/customers"], enabled: canManage,
  });

  const members: { id: string; displayName?: string | null; email?: string | null }[] =
    membersData?.members ?? [];

  /**
   * The calendar filter. A visit belongs to a member when they BOOKED it
   * (createdByMemberId) or are on its crew (dispatchedMemberIds). "My calendar"
   * is my visits by that rule; a member id is that person's; "all" is the org
   * board. Visits booked before the creator column existed have no booker and
   * only show under "Everyone's calendar" unless someone is on the crew.
   */
  const belongsTo = (a: Appointment, memberId: string): boolean =>
    a.createdByMemberId === memberId || (a.dispatchedMemberIds ?? []).includes(memberId);
  const matchesScope = (a: Appointment): boolean => {
    if (scope === "all") return true;
    if (scope === "mine") return myMemberId ? belongsTo(a, myMemberId) : false;
    return belongsTo(a, scope);
  };

  // A remembered member filter whose member left the org falls back to "mine".
  useEffect(() => {
    if (scope !== "all" && scope !== "mine" && members.length && !members.some((m) => m.id === scope)) setScope("mine");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length, scope]);

  const appointments = (calData?.appointments ?? []).filter(matchesScope);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = isoDay(new Date(a.startsAt));
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [appointments]);

  const openCreate = (d: Date | null) => {
    if (!canManage) return;
    setEditing(null);
    setDefaultDate(d);
    setDialogOpen(true);
  };
  const openEdit = (a: Appointment) => {
    if (!canManage) return;
    setEditing(a);
    setDefaultDate(null);
    setDialogOpen(true);
  };

  // After a CREATE the new visit must be on screen: bring the calendar to its
  // date (the dialog accepts any date, even one outside the visible window),
  // and when the day is crowded — a month cell shows only 3 chips + "+N more" —
  // jump to the week, exactly what tapping "+N more" does. Without this a
  // just-added visit on a busy day vanishes behind the collapse ("I added it
  // and it just disappeared").
  const onCreated = (a: Appointment) => {
    const d = new Date(a.startsAt);
    const items = [...(byDay.get(isoDay(d)) ?? []).filter((x) => x.id !== a.id), a]
      .sort((x, y) => +new Date(x.startsAt) - +new Date(y.startsAt));
    setCursor(d);
    if (view === "month" && items.findIndex((x) => x.id === a.id) > 2) setView("week");
  };

  const shift = (dir: -1 | 1) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + 7 * dir);
    setCursor(d);
  };

  const title = view === "month"
    ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `Week of ${weekStart(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  // ── Agenda data shaping (unchanged from the original list) ──────────────
  const groups: { key: string; label: string; items: Appointment[] }[] = [];
  for (const a of (agendaData?.appointments ?? []).filter(matchesScope)) {
    const key = dayStart(new Date(a.startsAt)).toISOString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a);
    else groups.push({ key, label: dayLabel(a.startsAt), items: [a] });
  }

  const isLoading = view === "agenda" ? agendaLoading : calLoading;
  const isError = view === "agenda" ? agendaError : calError;

  const eventChip = (a: Appointment, showTime = true) => (
    <button
      key={a.id}
      type="button"
      onClick={(e) => { e.stopPropagation(); openEdit(a); }}
      data-testid={`event-${a.id}`}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium",
        "bg-primary/10 text-primary hover:bg-primary/20 transition-colors",
        a.status === "complete" && "opacity-60 line-through",
        a.status === "canceled" && "opacity-50 line-through",
        !canManage && "cursor-default",
      )}
      title={`${a.title}${a.customerName ? ` — ${a.customerName}` : ""}`}
    >
      {showTime && !a.allDay && `${new Date(a.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} `}
      {a.title}
    </button>
  );

  return (
    <CrmPage wide>
      <CrmPageHeader
        icon={CalendarDays}
        title="Schedule"
        infoKey="schedule"
        subtitle="Scroll the calendar, click a day to book, click a visit to move it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="select-calendar-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="scope-all">Everyone's calendar</SelectItem>
                <SelectItem value="mine" data-testid="scope-mine">My calendar</SelectItem>
                {members
                  .filter((m) => m.id !== myMemberId)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id} data-testid={`scope-member-${m.id}`}>
                      {m.displayName || m.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-1" data-testid="schedule-view-switch">
              {(["month", "week", "agenda"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  data-testid={`button-view-${v}`}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors",
                    view === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            {canManage && (
              <Button size="sm" onClick={() => openCreate(new Date())} data-testid="button-add-appointment">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            )}
          </div>
        }
      />

      {view !== "agenda" && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(-1)} data-testid="button-cal-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor(new Date())} data-testid="button-cal-today">
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(1)} data-testid="button-cal-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-sm font-semibold" data-testid="calendar-title">{title}</h2>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <ErrorCard title="Couldn't load the schedule" description="Check your connection and refresh the page." />
      ) : view === "month" ? (
        <div className="rounded-xl border bg-card overflow-hidden" data-testid="calendar-month">
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(range.from);
              d.setDate(d.getDate() + i);
              const key = isoDay(d);
              const items = byDay.get(key) ?? [];
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = key === isoDay(new Date());
              return (
                <div
                  key={key}
                  data-testid={`cal-day-${key}`}
                  onClick={() => openCreate(d)}
                  className={cn(
                    "min-h-[84px] sm:min-h-[104px] border-b border-r p-1 align-top transition-colors",
                    "[&:nth-child(7n)]:border-r-0",
                    inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground",
                    canManage && "cursor-pointer hover:bg-accent/50",
                  )}
                >
                  <div className={cn(
                    "mb-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-medium",
                    isToday && "bg-primary text-primary-foreground",
                  )}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map((a) => eventChip(a))}
                    {items.length > 3 && (
                      <button
                        type="button"
                        className="block w-full text-left px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                        data-testid={`cal-more-${key}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCursor(d);
                          setView("week");
                        }}
                      >
                        +{items.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="overflow-x-auto rounded-xl border bg-card" data-testid="calendar-week">
          <div className="grid min-w-[720px] grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(range.from);
              d.setDate(d.getDate() + i);
              const key = isoDay(d);
              const items = byDay.get(key) ?? [];
              const isToday = key === isoDay(new Date());
              return (
                <div key={key} className="border-r last:border-r-0" data-testid={`week-day-${key}`}>
                  <div className={cn(
                    "border-b px-2 py-2 text-center",
                    isToday && "bg-primary/5",
                  )}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                    <div className={cn(
                      "mx-auto mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium",
                      isToday && "bg-primary text-primary-foreground",
                    )}>
                      {d.getDate()}
                    </div>
                  </div>
                  <div
                    className={cn("min-h-[240px] space-y-1 p-1.5", canManage && "cursor-pointer hover:bg-accent/40")}
                    onClick={() => openCreate(d)}
                  >
                    {items.map((a) => eventChip(a))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-1 w-fit" data-testid="schedule-range">
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

          {groups.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={CalendarDays}
                title={scope === "all"
                  ? `Nothing scheduled in the next ${days} days`
                  : `No visits for this filter in the next ${days} days`}
                description={canManage
                  ? "Click a day on the calendar (or the Add button) to book your first visit."
                  : "Visits booked on your projects will show up here, grouped by day."}
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
                          "hover:border-primary/40 hover:shadow-sm cursor-pointer",
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
                      // Editors open the dialog; read-only roles keep the old
                      // behaviour (tap through to the project when there is one).
                      if (canManage) {
                        return (
                          <div key={a.id} data-testid={`appt-${a.id}`} onClick={() => openEdit(a)}>{body}</div>
                        );
                      }
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
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-appointment">
          <AppointmentForm
            key={editing?.id ?? `new-${defaultDate ? isoDay(defaultDate) : "today"}`}
            initial={editing}
            defaultDate={defaultDate}
            members={membersData?.members ?? []}
            projects={projectsData?.projects ?? []}
            customers={customers ?? []}
            onClose={() => setDialogOpen(false)}
            onCreated={onCreated}
          />
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
