import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DAY_LABELS, ESCALATION_KIND_LABELS, newEscalationRule, toE164 } from "@/lib/voice-studio";
import { DAY_KEYS, ESCALATION_KINDS, type EscalationRule, type VoiceProfile } from "@shared/voice-profile";
import { NumberField, RowCard, SectionCard, SelectField, StringListEditor, SwitchRow, TextAreaField, TextField, type SectionProps } from "./fields";

/** FAQ — question/answer pairs the assistant answers verbatim. OWNER: studio-frontend lane. */
export function FaqSection({ value, onChange, disabled }: SectionProps<VoiceProfile["faq"]>) {
  return (
    <SectionCard title="FAQ" blurb="Questions callers actually ask, with the answer you want given. The assistant uses these before anything else." testid="section-faq">
      <div className="space-y-3">
        {value.map((f, i) => (
          <RowCard key={i} disabled={disabled} testid={`row-faq-${i}`} onRemove={() => onChange(value.filter((_, j) => j !== i))}>
            <div className="space-y-1.5">
              <Label htmlFor={`faq-q-${i}`}>Question</Label>
              <Input id={`faq-q-${i}`} value={f.question} disabled={disabled} placeholder="Do you work on manufactured homes?" data-testid={`input-faq-question-${i}`}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`faq-a-${i}`}>Answer</Label>
              <Textarea id={`faq-a-${i}`} value={f.answer} rows={2} disabled={disabled} placeholder="Yes — siding and roofing on manufactured homes, as long as it's on a permanent foundation." data-testid={`textarea-faq-answer-${i}`}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
            </div>
          </RowCard>
        ))}
        {value.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-faq-empty">No FAQ yet. Three to ten good ones cover most calls.</p>}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" data-testid="button-add-faq" disabled={value.length >= 60} onClick={() => onChange([...value, { question: "", answer: "" }])}>
            <Plus className="h-4 w-4 mr-1" /> Add question
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

type Escalations = VoiceProfile["escalations"];

/** Escalation rule builder: situation kinds → sms/email + recipient + template + reminder cadence. */
export function EscalationsSection({ value, onChange, disabled }: SectionProps<Escalations>) {
  const set = <K extends keyof Escalations>(k: K, v: Escalations[K]) => onChange({ ...value, [k]: v });
  const rules = value.rules;
  const setRule = (i: number, patch: Partial<EscalationRule>) => set("rules", rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SectionCard title="Escalations" blurb="Who gets paged when a call needs a person — an emergency, an existing customer, someone who insists on talking to a human — and how the assistant keeps nudging until they answer." testid="section-escalations">
      <div className="space-y-3">
        {rules.map((r, i) => (
          <RowCard key={r.id} disabled={disabled} testid={`row-escalation-${i}`} onRemove={() => set("rules", rules.filter((_, j) => j !== i))} removeLabel="Remove rule">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[10px]">{r.id}</Badge>
              <SwitchInline id={`esc-enabled-${i}`} label="Enabled" checked={r.enabled} disabled={disabled} testid={`switch-escalation-enabled-${i}`} onChange={(v) => setRule(i, { enabled: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>When the caller…</Label>
              <div className="flex flex-wrap gap-1.5" data-testid={`kinds-escalation-${i}`}>
                {ESCALATION_KINDS.map((k) => {
                  const on = r.kinds.includes(k);
                  return (
                    <label key={k} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer", on && "bg-primary/10 border-primary/40")}>
                      <Checkbox checked={on} disabled={disabled} data-testid={`checkbox-escalation-${i}-${k}`}
                        onCheckedChange={(v) => setRule(i, { kinds: v === true ? [...r.kinds, k] : r.kinds.filter((x) => x !== k) })} />
                      {ESCALATION_KIND_LABELS[k]}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`esc-name-${i}`}>Page</Label>
                <Input id={`esc-name-${i}`} value={r.recipientName} disabled={disabled} placeholder="Mike" data-testid={`input-escalation-name-${i}`} onChange={(e) => setRule(i, { recipientName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`esc-channel-${i}`}>By</Label>
                <Select value={r.channel} disabled={disabled} onValueChange={(v) => setRule(i, { channel: v as "sms" | "email", recipient: "" })}>
                  <SelectTrigger id={`esc-channel-${i}`} data-testid={`select-escalation-channel-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sms">Text message</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`esc-to-${i}`}>{r.channel === "sms" ? "Mobile number" : "Email address"}</Label>
                <Input id={`esc-to-${i}`} value={r.recipient} disabled={disabled} inputMode={r.channel === "sms" ? "tel" : "email"} data-testid={`input-escalation-recipient-${i}`}
                  placeholder={r.channel === "sms" ? "+13605551234" : "mike@example.com"}
                  onChange={(e) => setRule(i, { recipient: e.target.value })}
                  onBlur={(e) => { if (r.channel === "sms") setRule(i, { recipient: toE164(e.target.value) }); }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`esc-template-${i}`}>Message (optional)</Label>
              <Textarea id={`esc-template-${i}`} value={r.template} rows={2} disabled={disabled} data-testid={`textarea-escalation-template-${i}`}
                placeholder="{{company}}: {{callerName}} needs a person. Callback {{callback}}, {{address}}. {{summary}} Reply OK to confirm."
                onChange={(e) => setRule(i, { template: e.target.value })} />
              <p className="text-xs text-muted-foreground">Blank = the standard text: company · situation · caller · callback · address · the gist · "Reply OK to confirm". Placeholders: {"{{callerName}} {{callback}} {{address}} {{summary}} {{assistant}} {{company}}"}.</p>
            </div>
            <div className="rounded-md bg-muted/40 p-3 space-y-3">
              <SwitchInline id={`esc-rem-${i}`} label="Remind until they reply" checked={r.reminders.enabled} disabled={disabled} testid={`switch-escalation-reminders-${i}`}
                onChange={(v) => setRule(i, { reminders: { ...r.reminders, enabled: v } })} />
              {r.reminders.enabled && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <NumberField id={`esc-every-${i}`} label="Every" value={r.reminders.everyMinutes} min={15} max={1440} step={15} suffix="min" disabled={disabled} testid={`input-escalation-every-${i}`}
                    onChange={(n) => setRule(i, { reminders: { ...r.reminders, everyMinutes: n } })} />
                  <NumberField id={`esc-from-${i}`} label="From" value={r.reminders.fromHour} min={0} max={23} suffix="h" disabled={disabled} testid={`input-escalation-from-${i}`}
                    onChange={(n) => setRule(i, { reminders: { ...r.reminders, fromHour: n } })} />
                  <NumberField id={`esc-to-${i}`} label="Until" value={r.reminders.toHour} min={1} max={24} suffix="h" disabled={disabled} testid={`input-escalation-to-${i}`}
                    onChange={(n) => setRule(i, { reminders: { ...r.reminders, toHour: n } })} />
                  <NumberField id={`esc-days-${i}`} label="For up to" value={r.reminders.maxDays} min={1} max={30} suffix="days" disabled={disabled} testid={`input-escalation-days-${i}`}
                    onChange={(n) => setRule(i, { reminders: { ...r.reminders, maxDays: n } })} />
                  <div className="sm:col-span-4">
                    <SwitchInline id={`esc-followup-${i}`} label='Next-day follow-up after a reply ("was this taken care of? Reply DONE")' checked={r.reminders.followUpNextDay} disabled={disabled}
                      testid={`switch-escalation-followup-${i}`} onChange={(v) => setRule(i, { reminders: { ...r.reminders, followUpNextDay: v } })} />
                  </div>
                </div>
              )}
            </div>
          </RowCard>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-escalations-empty">No rules yet. Without one, every situation goes to the org's own notification channels (below).</p>}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" data-testid="button-add-escalation" disabled={rules.length >= 30} onClick={() => set("rules", [...rules, newEscalationRule(rules)])}>
            <Plus className="h-4 w-4 mr-1" /> Add rule
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="caller-line" label="What the caller hears after an alert" value={value.callerLine} onChange={(v) => set("callerLine", v)} disabled={disabled} testid="input-caller-line" maxLength={200} />
        <SwitchRow id="fallback-owner" label="No matching rule → notify the owners" checked={value.fallbackToOwner} onChange={(v) => set("fallbackToOwner", v)} disabled={disabled} testid="switch-fallback-owner"
          hint="Uses the CRM's own channels (bell, email, text). Emergencies and 'I want a person' always reach the owners too." />
      </div>
      <p className="text-xs text-muted-foreground">The assistant never gives out anyone's number, and does not file a new lead for an escalated call unless the caller also asked for an estimate.</p>
    </SectionCard>
  );
}

function SwitchInline({ id, label, checked, onChange, disabled, testid }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testid: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <Checkbox id={id} checked={checked} disabled={disabled} data-testid={testid} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

type LeadDelivery = VoiceProfile["leadDelivery"];

/** Lead delivery — where a finished call goes. */
export function LeadDeliverySection({ value, onChange, disabled }: SectionProps<LeadDelivery>) {
  const set = <K extends keyof LeadDelivery>(k: K, v: LeadDelivery[K]) => onChange({ ...value, [k]: v });
  return (
    <SectionCard title="Lead delivery" blurb="Every non-spam call that collected a lead lands in your CRM. Choose who else hears about it." testid="section-lead-delivery">
      <div className="space-y-3">
        <SwitchRow id="crm-enabled" label="File the lead in the CRM" checked={value.crm.enabled} disabled={disabled} testid="switch-crm-enabled"
          onChange={(v) => set("crm", { ...value.crm, enabled: v })} hint="Matches an existing client by phone, otherwise creates one, with the transcript and recording attached." />
        {value.crm.enabled && (
          <div className="grid gap-3 sm:grid-cols-2 pl-0 sm:pl-4">
            <SwitchRow id="crm-project" label="Also start a pipeline project" checked={value.crm.createProject} disabled={disabled} testid="switch-crm-create-project"
              onChange={(v) => set("crm", { ...value.crm, createProject: v })} hint='Stage "lead", named after the need and city.' />
            <StringListEditor id="crm-tags" label="Tags on the client" values={value.crm.tags} disabled={disabled} testid="list-crm-tags" max={10}
              onChange={(v) => set("crm", { ...value.crm, tags: v })} placeholder="call-assistant" />
          </div>
        )}
        <SwitchRow id="email-enabled" label="Email the lead" checked={value.email.enabled} disabled={disabled} testid="switch-email-enabled"
          onChange={(v) => set("email", { ...value.email, enabled: v })} hint='Goes to whoever has "Website lead received" on in Settings → Notifications, plus the extra addresses below.' />
        {value.email.enabled && (
          <div className="pl-0 sm:pl-4">
            <StringListEditor id="email-extra" label="Extra email recipients" values={value.email.extraRecipients} disabled={disabled} testid="list-email-recipients" max={10}
              onChange={(v) => set("email", { ...value.email, extraRecipients: v })} placeholder="sales@example.com" normalize={(s) => s.trim().toLowerCase()} />
          </div>
        )}
        <SwitchRow id="sms-enabled" label="Text the lead" checked={value.sms.enabled} disabled={disabled} testid="switch-sms-enabled"
          onChange={(v) => set("sms", { ...value.sms, enabled: v })} hint="Sent from your CRM texting number; metered like every other text." />
        {value.sms.enabled && (
          <div className="pl-0 sm:pl-4">
            <StringListEditor id="sms-recipients" label="Text these numbers" values={value.sms.recipients} disabled={disabled} testid="list-sms-recipients" max={10}
              onChange={(v) => set("sms", { ...value.sms, recipients: v })} placeholder="+13605551234" normalize={toE164} />
          </div>
        )}
        <SwitchRow id="notify-every" label="Send a summary for every call" checked={value.notifyOnEveryCall} onChange={(v) => set("notifyOnEveryCall", v)} disabled={disabled} testid="switch-notify-every-call"
          hint="Including calls that produced no lead (questions, declines). Spam and short hang-ups never notify." />
      </div>
    </SectionCard>
  );
}

type Appointments = VoiceProfile["appointments"];

/** Appointments — OFF by default; the schema is here, the booking tools are a later lane. */
export function AppointmentsSection({ value, onChange, disabled }: SectionProps<Appointments>) {
  const set = <K extends keyof Appointments>(k: K, v: Appointments[K]) => onChange({ ...value, [k]: v });
  const crews = value.crews;
  return (
    <SectionCard title="Appointments" blurb="Optional. When on, the assistant may offer estimate times from the availability below. Most contractors keep this off and let the estimator call back." testid="section-appointments">
      <SwitchRow id="appointments-enabled" label="Let the assistant book estimates" checked={value.enabled} onChange={(v) => set("enabled", v)} disabled={disabled} testid="switch-appointments-enabled"
        hint="Booking tools are not live yet; turning this on records your availability so it is ready when they are." />
      {value.enabled && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <NumberField id="slot-minutes" label="Visit length" value={value.slotMinutes} min={15} max={480} step={15} suffix="min" disabled={disabled} testid="input-slot-minutes" onChange={(n) => set("slotMinutes", n)} />
            <NumberField id="buffer-minutes" label="Buffer between" value={value.bufferMinutes} min={0} max={240} step={15} suffix="min" disabled={disabled} testid="input-buffer-minutes" onChange={(n) => set("bufferMinutes", n)} />
            <NumberField id="lead-hours" label="Earliest offer" value={value.leadTimeHours} min={0} max={336} suffix="h from now" disabled={disabled} testid="input-lead-time-hours" onChange={(n) => set("leadTimeHours", n)} />
            <SwitchRow id="confirm-sms" label="Confirm by text" checked={value.confirmBySms} onChange={(v) => set("confirmBySms", v)} disabled={disabled} testid="switch-confirm-sms" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Crews / estimators</Label>
              {!disabled && (
                <Button type="button" variant="outline" size="sm" data-testid="button-add-crew" onClick={() => set("crews", [...crews, { name: "", windows: [] }])}><Plus className="h-4 w-4 mr-1" /> Add crew</Button>
              )}
            </div>
            {crews.map((c, i) => (
              <RowCard key={i} disabled={disabled} testid={`row-crew-${i}`} onRemove={() => set("crews", crews.filter((_, j) => j !== i))}>
                <Input value={c.name} disabled={disabled} placeholder="Crew A — Mike" data-testid={`input-crew-name-${i}`}
                  onChange={(e) => set("crews", crews.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <div className="space-y-2">
                  {c.windows.map((w, k) => (
                    <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                      <Select value={w.day} disabled={disabled} onValueChange={(day) => set("crews", crews.map((x, j) => (j === i ? { ...x, windows: x.windows.map((y, l) => (l === k ? { ...y, day: day as typeof y.day } : y)) } : x)))}>
                        <SelectTrigger className="w-36" data-testid={`select-crew-${i}-window-${k}-day`}><SelectValue /></SelectTrigger>
                        <SelectContent>{DAY_KEYS.map((d) => <SelectItem key={d} value={d}>{DAY_LABELS[d]}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="time" value={w.from} disabled={disabled} className="w-[7.5rem]" data-testid={`input-crew-${i}-window-${k}-from`}
                        onChange={(e) => set("crews", crews.map((x, j) => (j === i ? { ...x, windows: x.windows.map((y, l) => (l === k ? { ...y, from: e.target.value } : y)) } : x)))} />
                      <span className="text-muted-foreground">to</span>
                      <Input type="time" value={w.to} disabled={disabled} className="w-[7.5rem]" data-testid={`input-crew-${i}-window-${k}-to`}
                        onChange={(e) => set("crews", crews.map((x, j) => (j === i ? { ...x, windows: x.windows.map((y, l) => (l === k ? { ...y, to: e.target.value } : y)) } : x)))} />
                      {!disabled && <Button type="button" variant="ghost" size="sm" data-testid={`button-crew-${i}-window-${k}-remove`} onClick={() => set("crews", crews.map((x, j) => (j === i ? { ...x, windows: x.windows.filter((_, l) => l !== k) } : x)))}>Remove</Button>}
                    </div>
                  ))}
                  {!disabled && (
                    <Button type="button" variant="ghost" size="sm" data-testid={`button-crew-${i}-add-window`}
                      onClick={() => set("crews", crews.map((x, j) => (j === i ? { ...x, windows: [...x.windows, { day: "mon", from: "09:00", to: "12:00" }] } : x)))}>
                      <Plus className="h-4 w-4 mr-1" /> Add window
                    </Button>
                  )}
                </div>
              </RowCard>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

type Advanced = VoiceProfile["advanced"];

/** Advanced — extra instructions, style/temperature, turn and silence limits, spam sensitivity, vocabulary. */
export function AdvancedSection({ value, onChange, disabled }: SectionProps<Advanced>) {
  const set = <K extends keyof Advanced>(k: K, v: Advanced[K]) => onChange({ ...value, [k]: v });
  return (
    <SectionCard title="Advanced" blurb="Knobs most people never touch. The defaults are the ones that passed real calls." testid="section-advanced">
      <TextAreaField id="extra-instructions" label="Additional instructions" value={value.extraInstructions} onChange={(v) => set("extraInstructions", v)} disabled={disabled} testid="textarea-extra-instructions" rows={6} maxLength={4000}
        placeholder="If a caller mentions the Jensen job, say Mike will call them personally." hint="Appended to the prompt word for word, after every built-in rule. Keep it to things the sections above cannot say." />
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField id="temperature" label="Creativity" value={value.temperature} min={0} max={1} step={0.05} disabled={disabled} testid="input-temperature" onChange={(n) => set("temperature", n)} hint="0 = by the book, 1 = loose. 0.3 is the tested default." />
        <NumberField id="max-turns" label="Max turns per call" value={value.maxTurns} min={4} max={80} disabled={disabled} testid="input-max-turns" onChange={(n) => set("maxTurns", n)} />
        <NumberField id="max-call-seconds" label="Max call length" value={value.maxCallSeconds} min={60} max={3600} step={30} suffix="s" disabled={disabled} testid="input-max-call-seconds" onChange={(n) => set("maxCallSeconds", n)} />
        <NumberField id="silence-seconds" label="Silence before 'still there?'" value={value.silencePromptSeconds} min={5} max={60} suffix="s" disabled={disabled} testid="input-silence-seconds" onChange={(n) => set("silencePromptSeconds", n)} />
        <NumberField id="silence-prompts" label="Silence prompts before goodbye" value={value.silencePromptsBeforeHangup} min={1} max={5} disabled={disabled} testid="input-silence-prompts" onChange={(n) => set("silencePromptsBeforeHangup", n)} />
        <NumberField id="greeting-delay" label="Greeting delay" value={value.greetingDelaySeconds} min={0} max={10} step={0.5} suffix="s" disabled={disabled} testid="input-greeting-delay" onChange={(n) => set("greetingDelaySeconds", n)}
          hint="Lets a forwarded call bridge (and a CallRail whisper finish) before the assistant speaks." />
      </div>
      <SelectField id="spam-sensitivity" label="Spam sensitivity" value={value.spamSensitivity} onChange={(v) => set("spamSensitivity", v)} disabled={disabled} testid="select-spam-sensitivity"
        options={[{ value: "low", label: "Low — only the obvious pitches" }, { value: "normal", label: "Normal" }, { value: "high", label: "High — flags sooner" }]}
        hint="Two near-certain spam calls from one number block it before the next call is answered." />
      <StringListEditor id="vocabulary" label="Words the listener should know" values={value.vocabulary} onChange={(v) => set("vocabulary", v)} disabled={disabled} testid="list-vocabulary" max={60}
        placeholder="James Hardie, Ferndale, Snohomish" hint="Brand names and local place names the speech recognizer might otherwise mishear." />
    </SectionCard>
  );
}
