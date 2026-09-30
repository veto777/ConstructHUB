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
  ClientSearchPicker, ListSearchPicker, type PickOption,
} from "@/components/crm-search-picker";
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
  /** A fixed client list (the client page passes just that client). Omit it
   *  to search every client in the org — the API's list is capped at 500. */
  customers?: any[];
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
  const projectOption = (p: any): PickOption =>
    ({ id: p.id, label: p.name, detail: p.number ?? null });
  const [project, setProject] = useState<PickOption | null>(() => {
    if (!initial?.projectId) return null;
    const p = projects.find((x) => x.id === initial.projectId);
    return p ? projectOption(p)
      : { id: initial.projectId, label: initial.projectName ?? "Linked project", detail: initial.projectNumber };
  });
  const [customer, setCustomer] = useState<PickOption | null>(() => {
    if (!initial?.customerId) return null;
    const c = customers?.find((x) => x.id === initial.customerId);
    return { id: initial.customerId, label: c?.displayName ?? initial.customerName ?? "Linked client" };
  });
  // Delete is a hard DELETE — ask once before it happens.
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      projectId: project?.id ?? null,
      customerId: customer?.id ?? null,
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
            <ListSearchPicker value={project} onChange={setProject}
              options={projects.map(projectOption)}
              placeholder="Search projects (optional)" clearLabel="No project"
              emptyText={projects.length ? "No projects match." : "No projects yet."}
              testid="select-appt-project" />
          </div>
          <div>
            <Label>Customer</Label>
            {customers ? (
              <ListSearchPicker value={customer} onChange={setCustomer}
                options={customers.map((c) => ({ id: c.id, label: c.displayName }))}
                placeholder="Search clients (optional)" clearLabel="No customer"
                testid="select-appt-customer" />
            ) : (
              <ClientSearchPicker value={customer} onChange={setCustomer}
                placeholder="Search clients (optional)" clearLabel="No customer"
                testid="select-appt-customer" />
            )}
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
      {initial && confirmDelete ? (
        // While confirming, the footer is ONLY the question — no Save beside it.
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="appt-delete-confirm">
          <span className="text-sm">Delete this visit? This can't be undone.</span>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" data-testid="button-appt-delete-cancel"
              onClick={() => setConfirmDelete(false)} disabled={del.isPending}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" size="sm"
              data-testid="button-appt-delete-confirm"
              onClick={() => del.mutate()} disabled={del.isPending || save.isPending}>
              {del.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete for good
            </Button>
          </div>
        </div>
      ) : (
        <DialogFooter className="gap-2 sm:justify-between">
          {initial ? (
            <Button type="button" variant="destructive" size="sm"
              data-testid="button-appt-delete"
              onClick={() => setConfirmDelete(true)} disabled={del.isPending || save.isPending}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          ) : <span />}
          <Button type="button" data-testid="button-appt-save" onClick={submit}
            disabled={!title.trim() || !date || save.isPending || del.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initial ? "Save changes" : "Schedule it"}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}
