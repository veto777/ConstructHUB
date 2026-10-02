import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import { StatusPill } from "@/components/crm-ui";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mic, User, FolderKanban } from "lucide-react";
import { outcomeTone, outcomeLabel, fmtPhone, fmtDuration, fmtWhen, type VoiceCallDetail, type VoiceEscalation } from "./calls-shared";

/** The default intake order first (need → address → … → best time), then any custom keys A–Z. */
const SLOT_ORDER = ["need", "address", "city", "first_name", "name", "phone", "email", "best_time"];
function orderedSlots(slots: Record<string, string>): [string, string][] {
  const rank = (k: string) => { const i = SLOT_ORDER.indexOf(k); return i === -1 ? SLOT_ORDER.length : i; };
  return Object.entries(slots).filter(([, v]) => String(v ?? "").trim() !== "")
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

const personaName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * One call: summary, what was collected, the transcript, the recording and
 * the lead it became. OWNER: calls+crm lane (LANES.md).
 */
export function CallDetailSheet({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const open = !!callId;
  const q = useQuery<VoiceCallDetail>({ queryKey: ["/api/crm/voice/calls", callId], enabled: open });
  const call = q.data;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-call-detail">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2" data-testid="text-call-detail-title">
            {call ? (call.callerName || fmtPhone(call.fromNumber)) : "Call"}
            {call?.outcome && <StatusPill tone={outcomeTone(call.outcome)} data-testid="pill-call-detail-outcome">{outcomeLabel(call.outcome)}</StatusPill>}
          </SheetTitle>
          <SheetDescription>
            {call ? `${fmtWhen(call.startedAt)} · ${fmtDuration(call.durationSeconds)} · from ${fmtPhone(call.fromNumber)}${call.number?.label ? ` to ${call.number.label}` : ""}${call.persona ? ` · answered by ${personaName(call.persona)}` : ""}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {q.isError && (
          <div className="mt-4 rounded-md border border-destructive/40 p-3 text-sm" role="alert" data-testid="error-call-detail">
            <div className="font-medium">Couldn't load this call</div>
            <div className="text-muted-foreground">{apiErrorMessage(q.error)}</div>
          </div>
        )}

        {call && (
          <div className="mt-4 space-y-5 text-sm">
            {(call.hasRecording || call.recordingUrl) && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 font-medium"><Mic className="h-4 w-4" aria-hidden="true" /> Recording</h3>
                <audio controls preload="none" className="w-full" src={call.recordingUrl ?? `/api/crm/voice/calls/${call.id}/recording`} data-testid="audio-call-recording" />
              </section>
            )}

            {(call.customer || call.project) && (
              <section className="flex flex-wrap gap-2">
                {call.customer && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/crm/clients/${call.customer.id}`} data-testid="link-call-customer"><User className="mr-1.5 h-4 w-4" aria-hidden="true" />{call.customer.displayName}</Link>
                  </Button>
                )}
                {call.project && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/crm/projects/${call.project.id}`} data-testid="link-call-project"><FolderKanban className="mr-1.5 h-4 w-4" aria-hidden="true" />{call.project.name}</Link>
                  </Button>
                )}
              </section>
            )}

            {call.summary && (
              <section>
                <h3 className="mb-1 font-medium">Summary</h3>
                <p className="whitespace-pre-wrap text-muted-foreground" data-testid="text-call-summary">{call.summary}</p>
              </section>
            )}

            {(call.outcome === "spam" || call.outcome === "blocked") && (
              <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="font-medium">{call.outcome === "blocked" ? "Rejected before answering — this number is blocked." : "Flagged as spam — nobody was notified and no lead was filed."}</div>
                {call.spamReason && <div className="text-muted-foreground">{call.spamReason}{call.spamConfidence != null ? ` (${Math.round(call.spamConfidence * 100)}% sure)` : ""}</div>}
              </section>
            )}

            {call.slots && Object.keys(call.slots).length > 0 && (
              <section>
                <h3 className="mb-2 font-medium">What was collected</h3>
                <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1" data-testid="list-call-slots">
                  {orderedSlots(call.slots).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                      <dd className="break-words">{k === "phone" ? fmtPhone(v) : v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {call.escalations.length > 0 && (
              <section>
                <h3 className="mb-2 font-medium">Escalations</h3>
                <ul className="space-y-2" data-testid="list-call-escalations">
                  {call.escalations.map((e) => <EscalationRow key={e.id} e={e} callId={call.id} />)}
                </ul>
              </section>
            )}

            <Separator />
            <section>
              <h3 className="mb-2 font-medium">Transcript</h3>
              {call.transcript.length === 0 ? (
                <p className="text-muted-foreground">No transcript — the call ended before anyone spoke.</p>
              ) : (
                <ol className="space-y-2" data-testid="list-call-transcript">
                  {call.transcript.map((t, i) => (
                    <li key={i} className={`flex gap-2 ${t.role === "system" ? "text-xs text-muted-foreground italic" : ""}`}>
                      <span className={`w-16 shrink-0 text-xs font-medium uppercase tracking-wide ${t.role === "assistant" ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                        {t.role === "assistant" ? (call.persona ? personaName(call.persona) : "assistant") : t.role}
                      </span>
                      <span className="whitespace-pre-wrap">{t.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <p className="text-xs text-muted-foreground">Call {call.callSid}{call.model ? ` · ${call.model}` : ""}{call.profileVersion ? ` · profile v${call.profileVersion}` : ""}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * One escalation with its reminder state. Any member may mark it handled (the
 * teammate who was paged is usually not the one with manageSettings).
 */
export function EscalationRow({ e, callId, onOpenCall }: { e: VoiceEscalation; callId?: string; onOpenCall?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const close = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/crm/voice/escalations/${e.id}/close`, {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/crm/voice/escalations") });
      if (callId) qc.invalidateQueries({ queryKey: ["/api/crm/voice/calls", callId] });
      toast({ title: "Escalation closed" });
    },
    onError: (err) => toast({ title: "Couldn't close it", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const tone: "neutral" | "warning" | "success" = e.state === "closed" ? "neutral" : e.state === "waiting" ? "warning" : "success";
  const stateLabels: Record<VoiceEscalation["state"], string> = {
    waiting: `waiting on ${e.recipientName || e.recipient}`,
    confirmed: "confirmed",
    followed_up: "follow-up sent",
    closed: `closed${e.closeReason ? ` — ${e.closeReason}` : ""}`,
  };
  const stateLabel = stateLabels[e.state] ?? e.state;
  return (
    <li className="rounded-md border p-3" data-testid={`row-escalation-${e.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{e.kindLabel}</Badge>
        <span className="font-medium">{e.recipientName || e.recipient}</span>
        <span className="text-xs text-muted-foreground">via {e.channel}{e.sentCount ? ` · sent ${e.sentCount}×` : " · not sent"}</span>
        <StatusPill tone={tone} className="ml-auto max-w-full whitespace-normal" data-testid={`pill-escalation-state-${e.id}`}>{stateLabel}</StatusPill>
      </div>
      {e.replyText && <div className="mt-1 text-xs text-muted-foreground">Reply: “{e.replyText}”</div>}
      {e.lastError && <div className="mt-1 text-xs text-red-600 dark:text-red-400">Last send failed: {e.lastError}</div>}
      {(e.state !== "closed" || onOpenCall) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.state !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => close.mutate()} disabled={close.isPending} data-testid={`button-escalation-close-${e.id}`}>Mark handled</Button>
          )}
          {onOpenCall && (
            <Button size="sm" variant="ghost" onClick={onOpenCall} data-testid={`button-escalation-call-${e.id}`}>Open the call</Button>
          )}
        </div>
      )}
    </li>
  );
}
