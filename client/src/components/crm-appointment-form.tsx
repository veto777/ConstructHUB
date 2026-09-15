import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";

/**
 * The appointment create / edit / delete dialog body, shared by the calendar
 * page and the client page's Schedule section so a visit can be changed from
 * wherever you're looking at it. Mount inside a <DialogContent>.
 */

export interface Appointment {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  arrivalWindowMinutes: number | null;
  notes: string | null;
  crewNotes: string | null;
  projectId: string | null;
  customerId: string | null;
  dispatchedMemberIds: string[] | null;
  /** Member who booked the visit (null on rows older than 2026-09-15). */
  createdByMemberId?: string | null;
  projectName: string | null;
  projectNumber: string | null;
  customerName: string | null;
  crew: string[];
}

export const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ── Appointment create/edit dialog ──────────────────────────────────────────

export function AppointmentForm({
  initial, defaultDate, members, projects, customers, onClose, onCreated,
}: {
  initial: Appointment | null;
  defaultDate: Date | null;
  members: any[];
  projects: any[];
  customers: any[];
  onClose: () => void;
  /** Fired after a successful CREATE with the new row, so the calendar can
   *  make sure the visit is actually on screen. */
  onCreated?: (a: Appointment) => void;
}) {
  const { toast } = useToast();
  const start = initial ? new Date(initial.startsAt) : (defaultDate ?? new Date());
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(isoDay(start));
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startTime, setStartTime] = useState(initial && !initial.allDay ? hhmm(new Date(initial.startsAt)) : "09:00");
  const [endTime, setEndTime] = useState(
    initial?.endsAt && !initial.allDay ? hhmm(new Date(initial.endsAt)) : "10:00",
  );
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [crew, setCrew] = useState<string[]>(initial?.dispatchedMemberIds ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/appointments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/schedule"] });
  };

  const save = useMutation({
    mutationFn: async (body: any) =>
      initial
        ? (await apiRequest("PATCH", `/api/crm/appointments/${initial.id}`, body)).json()
        : (await apiRequest("POST", "/api/crm/appointments", body)).json(),
    onSuccess: (data) => {
      invalidate();
      const conflicts = data?.conflicts?.length ?? 0;
      toast({
        title: initial ? "Appointment updated" : "Appointment scheduled",
        description: conflicts
          ? `Heads up: ${conflicts} crew conflict${conflicts === 1 ? "" : "s"} with another visit.`
          : undefined,
        variant: conflicts ? "destructive" : "default",
      });
      if (!initial && data?.appointment) onCreated?.(data.appointment);
      onClose();
    },
    onError: (e: any) => toast({
      title: "Could not save the appointment",
      description: apiErrorMessage(e),
      variant: "destructive",
    }),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/crm/appointments/${initial!.id}`)).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Appointment removed" });
      onClose();
    },
    onError: (e: any) => toast({
      title: "Could not remove the appointment",
      description: apiErrorMessage(e),
      variant: "destructive",
    }),
  });

  const submit = () => {
    if (!title.trim() || !date) return;
    const startsAt = allDay
      ? dayStart(new Date(`${date}T00:00`))
      : new Date(`${date}T${startTime || "09:00"}`);
    const endsAt = allDay ? null : new Date(`${date}T${endTime || "10:00"}`);
    save.mutate({
      title: title.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt && !isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
      allDay,
      notes: notes.trim() || null,
      projectId: projectId || null,
      customerId: customerId || null,
      dispatchedMemberIds: crew,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initial ? "Edit appointment" : "New appointment"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="appt-title">Title</Label>
          <Input id="appt-title" data-testid="input-appt-title" value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder="Roof inspection" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <Label htmlFor="appt-date">Date</Label>
            <Input id="appt-date" data-testid="input-appt-date" type="date" value={date}
              onChange={(e) => setDate(e.target.value)} />
          </div>
          {!allDay && (
            <>
              <div>
                <Label htmlFor="appt-start">Start</Label>
                <Input id="appt-start" data-testid="input-appt-start" type="time" value={startTime}
                  onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="appt-end">End</Label>
                <Input id="appt-end" data-testid="input-appt-end" type="time" value={endTime}
                  onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox data-testid="checkbox-appt-all-day" checked={allDay}
            onCheckedChange={(v) => setAllDay(v === true)} />
          All day
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Project</Label>
            <Select value={projectId || "none"} onValueChange={(v) => setProjectId(v === "none" ? "" : v)}>
              <SelectTrigger data-testid="select-appt-project"><SelectValue placeholder="No project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Customer</Label>
            <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
              <SelectTrigger data-testid="select-appt-customer"><SelectValue placeholder="No customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No customer</SelectItem>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {members.length > 0 && (
          <div>
            <Label>Crew</Label>
            <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="appt-crew-list">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5">
                  <Checkbox
                    data-testid={`checkbox-crew-${m.id}`}
                    checked={crew.includes(m.id)}
                    onCheckedChange={(v) =>
                      setCrew((cur) => (v === true ? [...cur, m.id] : cur.filter((id) => id !== m.id)))}
                  />
                  <span className="truncate">{m.displayName || m.email}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <Label htmlFor="appt-notes">Notes</Label>
          <Textarea id="appt-notes" data-testid="textarea-appt-notes" value={notes}
            onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Gate code, ladder needed…" />
        </div>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {initial ? (
          <Button type="button" variant="destructive" size="sm"
            data-testid="button-appt-delete"
            onClick={() => del.mutate()} disabled={del.isPending || save.isPending}>
            {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Delete
          </Button>
        ) : <span />}
        <Button type="button" data-testid="button-appt-save" onClick={submit}
          disabled={!title.trim() || !date || save.isPending || del.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {initial ? "Save changes" : "Schedule it"}
        </Button>
      </DialogFooter>
    </>
  );
}
