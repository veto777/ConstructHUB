import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Loader2, MessageSquareText, PhoneOff, RotateCcw, Send, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/crm-ui";
import { apiRequest } from "@/lib/queryClient";
import { planRequiredFrom } from "@/components/plan-required";
import { cn } from "@/lib/utils";
import {
  DECISION_ACTION_LABELS, ESCALATION_KIND_LABELS, isFirstRun, mergeSimulatorEvents, parseApiError, simulatorErrorText, toE164,
  type SimulatorEvent, type SimulatorSession, type SimulatorTurn, type VoiceProfileResponse,
} from "@/lib/voice-studio";
import { PROFILE_KEY } from "./studio/api";
import { CallAssistantPlanRequired } from "./index";

type Message = { role: "caller" | "assistant" | "system"; text: string; decision?: SimulatorTurn };

/**
 * Simulator tab — a text chat against the compiled profile through the app
 * (POST /api/crm/voice/simulator/*). The same brain a caller gets; every
 * turn's decision (action, slots, alert, spam) is shown beside the reply.
 * Engine down → the app answers 503 voice_engine_unavailable and we say so;
 * there is never a fake reply. OWNER: studio-frontend lane.
 */
export function SimulatorPanel() {
  const profile = useQuery<VoiceProfileResponse>({ queryKey: PROFILE_KEY });
  const [source, setSource] = useState<"draft" | "published">("published");
  const [callerNumber, setCallerNumber] = useState("");
  const [session, setSession] = useState<SimulatorSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<SimulatorEvent[]>([]);
  const [ended, setEnded] = useState<{ outcome?: string | null; summary?: string } | null>(null);
  const [text, setText] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement | null>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);
  useEffect(() => {
    if (profile.data && profile.data.publishedVersion == null) setSource("draft");
  }, [profile.data]);

  const explain = (e: unknown) => {
    // A session the server no longer knows (expired) or already ended can't take more turns.
    const code = parseApiError(e).body?.code;
    if (code === "unknown_session" || code === "session_ended") setEnded((x) => x ?? { outcome: parseApiError(e).body?.outcome ?? null });
    return simulatorErrorText(e);
  };

  const start = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { useDraft: source === "draft" };
      if (callerNumber.trim()) body.callerNumber = toE164(callerNumber);
      return (await apiRequest("POST", "/api/crm/voice/simulator/session", body)).json() as Promise<SimulatorSession>;
    },
    onSuccess: (s) => {
      setSession(s); setMessages([{ role: "assistant", text: s.greeting }]); setSlots({}); setEvents([]); setEnded(null); setLastError(null);
    },
    onError: (e) => setLastError(explain(e)),
  });
  const turn = useMutation({
    mutationFn: async (t: string) => (await apiRequest("POST", "/api/crm/voice/simulator/turn", { sessionId: session!.sessionId, text: t })).json() as Promise<SimulatorTurn>,
    onMutate: (t) => { setMessages((m) => [...m, { role: "caller", text: t }]); setText(""); setLastError(null); },
    onSuccess: (d) => {
      setMessages((m) => [...m, { role: "assistant", text: d.say || (d.action === "end_call" ? "(hangs up)" : ""), decision: d }]);
      if (d.slots) setSlots((s) => ({ ...s, ...d.slots }));
      setEvents((ev) => mergeSimulatorEvents(ev, d.events));
      if (d.ended ?? d.action === "end_call") setEnded({ outcome: d.outcome ?? null });
    },
    onError: (e) => setLastError(explain(e)),
  });
  const end = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/crm/voice/simulator/session/${session!.sessionId}`)).json() as Promise<{ ended: boolean; summary?: string }>,
    onSuccess: (r) => { setEnded((e) => ({ outcome: e?.outcome ?? "hangup", summary: r.summary })); setMessages((m) => [...m, { role: "system", text: r.summary ? `Call ended. ${r.summary}` : "Call ended." }]); },
    onError: (e) => setLastError(explain(e)),
  });
  const reset = () => { setSession(null); setMessages([]); setSlots({}); setEvents([]); setEnded(null); setLastError(null); };

  const canStart = !!profile.data && !(source === "published" && profile.data.publishedVersion == null);
  const gate = (profile.isError && planRequiredFrom(profile.error)) ? profile.error : (start.isError && planRequiredFrom(start.error)) ? start.error : null;
  if (gate) return <div data-testid="panel-call-assistant-simulator" className="pt-4"><CallAssistantPlanRequired error={gate} /></div>;
  const lastDecision = [...messages].reverse().find((m) => m.decision)?.decision;

  return (
    <div data-testid="panel-call-assistant-simulator" className="pt-4 space-y-4">
      {!session ? (
        <Card>
          <CardContent className="p-4 sm:p-6 space-y-4">
            <EmptyState icon={MessageSquareText} title="Call your assistant by typing" compact
              description="The same brain a caller gets, with every decision shown. Try the awkward ones: 'are you a bot?', a repair you don't do, an address outside your area, a sales pitch." />
            {profile.data && isFirstRun(profile.data) && <p className="text-sm text-center text-muted-foreground" data-testid="text-simulator-no-profile">Finish the setup in Agent Studio first — the Simulator runs whatever the draft says.</p>}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end max-w-2xl mx-auto">
              <div className="space-y-1.5">
                <Label htmlFor="sim-source">Run against</Label>
                <Select value={source} onValueChange={(v) => setSource(v as "draft" | "published")}>
                  <SelectTrigger id="sim-source" data-testid="select-simulator-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published" disabled={profile.data?.publishedVersion == null}>Published{profile.data?.publishedVersion != null ? ` (v${profile.data.publishedVersion})` : " (nothing yet)"}</SelectItem>
                    <SelectItem value="draft">Draft (unpublished edits)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sim-caller">Caller number (optional)</Label>
                <Input id="sim-caller" value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)} placeholder="+13605551234" inputMode="tel" data-testid="input-simulator-caller" />
              </div>
              <Button onClick={() => start.mutate()} disabled={!canStart || start.isPending} data-testid="button-simulator-start">
                {start.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Start call
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">A known caller number lets the assistant greet an existing client by name, as it would on a real call.</p>
            {lastError && <p className="text-sm text-destructive text-center" data-testid="text-simulator-error">{lastError}</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(16rem,0.6fr)]">
          <Card className="flex flex-col">
            <CardContent className="p-0 flex flex-col h-[60vh] min-h-[24rem]">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                <Badge variant="outline" data-testid="badge-simulator-source">{source === "draft" ? "Draft" : `Published v${session.compiledVersion ?? profile.data?.publishedVersion ?? ""}`}</Badge>
                <span>Session {session.sessionId.slice(0, 8)}</span>
                <div className="ml-auto flex gap-1">
                  {!ended && <Button variant="outline" size="sm" onClick={() => end.mutate()} disabled={end.isPending} data-testid="button-simulator-end"><PhoneOff className="h-3.5 w-3.5 mr-1" /> Hang up</Button>}
                  <Button variant="ghost" size="sm" onClick={reset} data-testid="button-simulator-reset"><RotateCcw className="h-3.5 w-3.5 mr-1" /> New call</Button>
                </div>
              </div>
              <div ref={log} className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="simulator-log" aria-live="polite">
                {messages.map((m, i) => (
                  <div key={i} className={cn("flex gap-2", m.role === "caller" ? "justify-end" : "justify-start")} data-testid={`simulator-message-${i}`} data-role={m.role}>
                    {m.role === "assistant" && <Bot className="h-5 w-5 text-primary shrink-0 mt-1" aria-hidden="true" />}
                    <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      m.role === "caller" ? "bg-primary text-primary-foreground" : m.role === "system" ? "bg-muted text-muted-foreground italic" : "bg-muted")}>
                      <p>{m.text}</p>
                      {m.decision && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Badge variant={m.decision.action === "continue" ? "outline" : "secondary"} className="text-[10px]" data-testid={`simulator-action-${i}`}>{DECISION_ACTION_LABELS[m.decision.action] ?? m.decision.action}</Badge>
                          {m.decision.alert && <Badge variant="destructive" className="text-[10px]">Alert: {ESCALATION_KIND_LABELS[m.decision.alert.kind] ?? m.decision.alert.kind}</Badge>}
                          {m.decision.spam && <Badge variant="destructive" className="text-[10px]">Spam {Math.round(m.decision.spam.confidence * 100)}%</Badge>}
                          {m.decision.fallback && <Badge variant="outline" className="text-[10px] border-amber-500/60" title="The model's answer was unusable, so the assistant asked the caller to repeat." data-testid={`simulator-fallback-${i}`}>Fallback line</Badge>}
                        </div>
                      )}
                    </div>
                    {m.role === "caller" && <User className="h-5 w-5 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />}
                  </div>
                ))}
                {turn.isPending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</div>}
                {lastError && <p className="text-sm text-destructive" data-testid="text-simulator-error">{lastError}</p>}
                {ended && <p className="text-xs text-muted-foreground" data-testid="text-simulator-ended">Call ended{ended.outcome ? ` — outcome: ${ended.outcome}` : ""}.</p>}
              </div>
              <form className="flex gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && !ended && !turn.isPending) turn.mutate(t); }}>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={ended ? "The call has ended — start a new one" : "Say something as the caller…"} disabled={!!ended || turn.isPending} data-testid="input-simulator-text" autoFocus />
                <Button type="submit" disabled={!text.trim() || !!ended || turn.isPending} aria-label="Send" data-testid="button-simulator-send"><Send className="h-4 w-4" /></Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-4 text-sm" data-testid="simulator-decision-panel">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last decision</div>
                <div className="font-medium" data-testid="simulator-last-action">{lastDecision ? DECISION_ACTION_LABELS[lastDecision.action] ?? lastDecision.action : "—"}</div>
                {lastDecision?.alert && <p className="text-xs text-muted-foreground mt-1">{lastDecision.alert.summary}</p>}
                {lastDecision?.spam && <p className="text-xs text-muted-foreground mt-1">{lastDecision.spam.reason}</p>}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Slots collected</div>
                {Object.keys(slots).length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : (
                  <dl className="mt-1 divide-y rounded-md border" data-testid="simulator-slots">
                    {Object.entries(slots).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[7rem_1fr] gap-2 px-2 py-1" data-testid={`simulator-slot-${k}`}>
                        <dt className="font-mono text-xs text-muted-foreground truncate">{k}</dt>
                        <dd className="break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Events</div>
                {events.length === 0 ? <p className="text-muted-foreground">None.</p> : (
                  <ul className="mt-1 space-y-0.5 text-xs" data-testid="simulator-events">
                    {events.map((e, i) => <li key={i}><Badge variant="outline" className="text-[10px] mr-1">{e.type}</Badge>{typeof e.detail === "string" ? e.detail : e.detail ? JSON.stringify(e.detail) : ""}</li>)}
                  </ul>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Nothing here reaches your CRM or pages anyone — the Simulator is a sandbox.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
