/**
 * Schedule Bid (owner, 2026-10-21) — the dialog behind the Job stage tracker's first phase, the Create menu and the
 * calendar. Pick who the bid is for (a client, an open lead, or a new one — the lead that did not exist yet), when,
 * and who is going; POST /api/crm/bids puts it on the calendar (server/crm/bid-schedule.ts), emails the client a
 * confirmation and texts the booking member 30 minutes before (Settings → Notifications → Bid reminder).
 *
 * A lead is converted to a client first (POST /api/crm/leads/:id/convert, the Leads page's own path). A new one is a
 * client plus a project in the Lead column (the Create menu's Lead idiom) and a row on the Leads page.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { CalendarClock, Loader2, Mail, MessageSquare, UserPlus, Users, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { ClientFields, DupeError, EMPTY_CLIENT, clientBody, createErrorMessage } from "@/components/crm-create-menu";

export type BidClient = { id: string; displayName: string; email?: string | null; phone?: string | null; addressLine1?: string | null };
type LeadLite = { id: string; name: string | null; email: string | null; phone: string | null; addressLine1: string | null; city: string | null; state: string | null; sourceName?: string; customerId?: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** The given day at 9:00 (the calendar passes the day it shows) — tomorrow 9:00 when that is already past. */
function defaultStart(day?: Date | null): Date {
  const d = day ? new Date(day) : new Date(Date.now() + 86400000);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() <= Date.now()) { const t = new Date(Date.now() + 86400000); t.setHours(9, 0, 0, 0); return t; }
  return d;
}
const DURATIONS = [30, 60, 90, 120, 180];
const durationLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m === 60 ? "" : "s"}`);

type Mode = "client" | "lead" | "new";

export function ScheduleBidDialog({ open, onOpenChange, client, day, onScheduled, onNavigate, landOnClient = true }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  /** Book for this client (the client page): the picker is skipped. */
  client?: BidClient | null;
  /** The calendar day to start on. */
  day?: Date | null;
  onScheduled?: (r: { appointment: any; customerId: string }) => void;
  /** A host sheet to close when the dialog lands you on another page. */
  onNavigate?: () => void;
  /** Open the client's page after booking (the Create menu); the calendar stays put. */
  landOnClient?: boolean;
}) {
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"], enabled: open });
  const { data: membersData } = useQuery<any>({ queryKey: ["/api/crm/members"], enabled: open });
  const members: any[] = (membersData?.members ?? []).filter((m: any) => m.status === "active" || !m.status);

  const [mode, setMode] = useState<Mode>("client");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<BidClient | null>(client ?? null);
  const [pickedLead, setPickedLead] = useState<LeadLite | null>(null);
  const [leadAddress, setLeadAddress] = useState("");
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [dupe, setDupe] = useState<any>(null);
  const [start, setStart] = useState(toLocalInput(defaultStart(day)));
  const [minutes, setMinutes] = useState(60);
  const [notes, setNotes] = useState("");
  const [crew, setCrew] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(true);

  // Every open starts fresh (and on the day the calendar handed over).
  useEffect(() => {
    if (!open) return;
    setMode("client"); setQ(""); setPicked(client ?? null); setPickedLead(null); setLeadAddress("");
    setForm({ ...EMPTY_CLIENT }); setDupe(null); setStart(toLocalInput(defaultStart(day))); setMinutes(60); setNotes(""); setConfirm(true);
    setCrew([]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const myId: string | undefined = me?.member?.id;
  useEffect(() => { if (open && myId && !crew.length) setCrew([myId]); }, [open, myId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: clients } = useQuery<BidClient[]>({
    queryKey: ["/api/crm/customers", q ? `?q=${encodeURIComponent(q)}` : ""],
    queryFn: async () => {
      const r = await fetch(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open && !client && mode === "client",
  });
  const { data: leads } = useQuery<{ rows: LeadLite[] }>({
    queryKey: ["/api/crm/leads", "schedule-bid", q],
    queryFn: async () => {
      const r = await fetch(`/api/crm/leads?status=new&state=all&limit=25${q ? `&q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open && !client && mode === "lead",
  });

  const startDate = start ? new Date(start) : null;
  const validStart = !!startDate && !isNaN(startDate.getTime());
  const contactEmail = picked?.email ?? (mode === "lead" ? pickedLead?.email : mode === "new" ? form.email.trim() : null) ?? null;

  const schedule = useMutation({
    mutationFn: async () => {
      if (!validStart) throw new Error("Pick when the bid starts.");
      let customerId = picked?.id ?? null;
      let newLead = false;
      if (!customerId && mode === "lead") {
        if (!pickedLead) throw new Error("Pick a lead.");
        const conv = await (await apiRequest("POST", `/api/crm/leads/${pickedLead.id}/convert`,
          pickedLead.addressLine1 ? {} : { addressLine1: leadAddress.trim() || undefined })).json();
        customerId = conv.customer.id;
      }
      if (!customerId && mode === "new") {
        const body = clientBody(form, "Enter the client's name.");
        const customer = await (await apiRequest("POST", "/api/crm/customers", body)).json();
        customerId = customer.id;
        newLead = true;
        // A new lead is a project in the Lead column too (the Create menu's Lead), so it is on the pipeline.
        await apiRequest("POST", "/api/crm/projects", {
          customerId, name: `${body.displayName.slice(0, 193)} — lead`, status: "lead", addressLine1: body.addressLine1,
        }).catch(() => undefined);
      }
      if (!customerId) throw new Error("Pick who the bid is for.");
      const r = await (await apiRequest("POST", "/api/crm/bids", {
        customerId, startsAt: startDate!.toISOString(),
        endsAt: new Date(startDate!.getTime() + minutes * 60_000).toISOString(),
        notes: notes.trim() || null, dispatchedMemberIds: crew, sendConfirmation: confirm, newLead,
      })).json();
      return { ...r, customerId };
    },
    onSuccess: (r: any) => {
      for (const k of ["/api/crm/appointments", "/api/crm/schedule", "/api/crm/customers", "/api/crm/leads", "/api/crm/projects", `/api/crm/customers/${r.customerId}`]) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
      const bits = [
        r.confirmation?.sent ? "Confirmation emailed to the client." : r.confirmation?.reason && r.confirmation.reason !== "not requested" ? `No confirmation email: ${r.confirmation.reason}.` : null,
        r.reminder?.enabled ? (r.reminder.texting ? `You'll get a text ${r.reminder.minutes} minutes before.` : "Texting isn't set up, so no reminder text.") : null,
      ].filter(Boolean).join(" ");
      toast({ title: "Bid scheduled", description: bits || "It's on the calendar." });
      onOpenChange(false);
      onScheduled?.({ appointment: r.appointment, customerId: r.customerId });
      // From the Create menu or the calendar, land on the client the bid is for (unless we're already there).
      if (landOnClient && !client && !location.startsWith(`/crm/clients/${r.customerId}`)) { navigate(`/crm/clients/${r.customerId}`); onNavigate?.(); }
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").startsWith("409") && mode === "new") { setDupe(e); return; }
      toast({ title: "Couldn't schedule the bid", description: mode === "new" ? createErrorMessage(e) : apiErrorMessage(e), variant: "destructive" });
    },
  });

  const whoReady = !!picked || (mode === "lead" && !!pickedLead && (!!pickedLead.addressLine1 || !!leadAddress.trim())) || (mode === "new" && !!form.displayName.trim() && !!form.addressLine1.trim());
  const tabs: { key: Mode; label: string; icon: any }[] = useMemo(() => [
    { key: "client", label: "Client", icon: Users },
    { key: "lead", label: "Lead", icon: Inbox },
    { key: "new", label: "New", icon: UserPlus },
  ], []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="dialog-schedule-bid">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" aria-hidden="true" />Schedule bid{client ? ` — ${client.displayName}` : ""}</DialogTitle>
          <DialogDescription>Goes on your calendar. The client gets a confirmation email, and you get a text 30 minutes before.</DialogDescription>
        </DialogHeader>

        {!client && (
          <div className="space-y-2">
            <Label>Who is the bid for?</Label>
            {picked ? (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2" data-testid="schedule-bid-picked">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{picked.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{[picked.email, picked.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)} data-testid="button-schedule-bid-change">Change</Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist">
                  {tabs.map((t) => (
                    <button key={t.key} type="button" role="tab" aria-selected={mode === t.key} onClick={() => { setMode(t.key); setPickedLead(null); }}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium ${mode === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid={`tab-schedule-bid-${t.key}`}>
                      <t.icon className="h-4 w-4" aria-hidden="true" />{t.label}
                    </button>
                  ))}
                </div>
                {mode !== "new" && (
                  <Input placeholder={mode === "client" ? "Search clients by name, email, phone or address" : "Search open leads"} value={q}
                    onChange={(e) => setQ(e.target.value)} data-testid="input-schedule-bid-search" />
                )}
                {mode === "client" && (
                  <div className="max-h-48 divide-y overflow-y-auto rounded-lg border" data-testid="schedule-bid-client-list">
                    {(clients ?? []).slice(0, 25).map((c) => (
                      <button key={c.id} type="button" onClick={() => setPicked(c)} data-testid={`schedule-bid-client-${c.id}`}
                        className="block w-full px-3 py-2 text-left transition-colors hover:bg-accent">
                        <span className="block truncate text-sm font-medium">{c.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[c.addressLine1, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                      </button>
                    ))}
                    {clients && !clients.length && (
                      <div className="px-3 py-4 text-sm text-muted-foreground">No clients match. <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setMode("new"); setForm({ ...EMPTY_CLIENT, displayName: q }); }}>Add them as a new lead</button></div>
                    )}
                  </div>
                )}
                {mode === "lead" && (
                  pickedLead ? (
                    <div className="space-y-2 rounded-lg border px-3 py-2" data-testid="schedule-bid-picked-lead">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{pickedLead.name || pickedLead.email || pickedLead.phone}</div>
                          <div className="truncate text-xs text-muted-foreground">{[pickedLead.addressLine1, pickedLead.phone, pickedLead.email].filter(Boolean).join(" · ")}</div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setPickedLead(null)}>Change</Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Scheduling makes this lead a client.</p>
                      {!pickedLead.addressLine1 && (
                        <div>
                          <Label htmlFor="schedule-bid-lead-addr">Address *</Label>
                          <Input id="schedule-bid-lead-addr" value={leadAddress} onChange={(e) => setLeadAddress(e.target.value)} maxLength={200} data-testid="input-schedule-bid-lead-address" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="max-h-48 divide-y overflow-y-auto rounded-lg border" data-testid="schedule-bid-lead-list">
                      {(leads?.rows ?? []).map((l) => (
                        <button key={l.id} type="button" data-testid={`schedule-bid-lead-${l.id}`}
                          onClick={() => {
                            // A lead already matched to a client books on that client.
                            if (l.customerId) setPicked({ id: l.customerId, displayName: l.name || "Client", email: l.email, phone: l.phone, addressLine1: l.addressLine1 });
                            else setPickedLead(l);
                          }}
                          className="block w-full px-3 py-2 text-left transition-colors hover:bg-accent">
                          <span className="block truncate text-sm font-medium">{l.name || l.email || l.phone || "Lead"}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[l.sourceName, l.addressLine1, l.phone].filter(Boolean).join(" · ")}</span>
                        </button>
                      ))}
                      {leads && !leads.rows.length && (
                        <div className="px-3 py-4 text-sm text-muted-foreground">No open leads match. <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMode("new")}>Add a new lead</button></div>
                      )}
                    </div>
                  )
                )}
                {mode === "new" && (
                  <>
                    <ClientFields form={form} setForm={setForm} idPrefix="bid-lead" />
                    <p className="text-xs text-muted-foreground">Adds the client, puts them in the Lead column of the pipeline and on the Leads page.</p>
                    {dupe && <DupeError error={dupe} onOpen={() => { onOpenChange(false); onNavigate?.(); }} />}
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <Label htmlFor="schedule-bid-start">When</Label>
            <Input id="schedule-bid-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-schedule-bid-start" />
          </div>
          <div>
            <Label htmlFor="schedule-bid-length">Length</Label>
            <select id="schedule-bid-length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} data-testid="select-schedule-bid-length"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
              {DURATIONS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
          </div>
        </div>
        {validStart && startDate!.getTime() < Date.now() && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-schedule-bid-past">That time has already passed.</p>
        )}

        {members.length > 1 && (
          <div>
            <Label>Who's going</Label>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="schedule-bid-crew">
              {members.map((m: any) => {
                const on = crew.includes(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} data-testid={`schedule-bid-crew-${m.id}`}
                    onClick={() => setCrew(on ? crew.filter((x) => x !== m.id) : [...crew, m.id])}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}>
                    {m.displayName || m.email}{m.id === myId ? " (you)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="schedule-bid-notes">Notes (optional)</Label>
          <Textarea id="schedule-bid-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, what they want bid, bring samples…" data-testid="input-schedule-bid-notes" />
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={confirm && !!contactEmail} disabled={!contactEmail} onChange={(e) => setConfirm(e.target.checked)} data-testid="checkbox-schedule-bid-confirm" />
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {contactEmail ? <>Email the client a confirmation <span className="text-muted-foreground">({contactEmail})</span></> : "No email on file, so no confirmation can be sent"}
          </label>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Text reminder 30 minutes before. <Link href="/crm/settings#notifications" className="font-medium text-primary hover:underline" onClick={() => { onOpenChange(false); onNavigate?.(); }}>Change in Settings</Link>
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => schedule.mutate()} disabled={!whoReady || !validStart || schedule.isPending} data-testid="button-schedule-bid-save">
            {schedule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Schedule bid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
