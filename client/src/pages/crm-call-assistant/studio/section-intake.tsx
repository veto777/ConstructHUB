import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { INTAKE_VALIDATION_LABELS, defaultIntakeQuestions, moveItem, newIntakeQuestion } from "@/lib/voice-studio";
import { INTAKE_VALIDATIONS, type IntakeQuestion, type VoiceProfile } from "@shared/voice-profile";
import { SectionCard, SelectField, StringListEditor, SwitchRow, TextField, type SectionProps } from "./fields";

type Intake = VoiceProfile["intake"];

/**
 * Intake script — the ordered questions the assistant asks. Drag the handle
 * (or use the arrows) to reorder; each question has a slot key, prompt,
 * required flag, validation and the owner's special flags (confirm = read back
 * once, never read aloud = the caller-id number). OWNER: studio-frontend lane.
 */
export function IntakeSection({ value, onChange, disabled }: SectionProps<Intake>) {
  const set = <K extends keyof Intake>(k: K, v: Intake[K]) => onChange({ ...value, [k]: v });
  const qs = value.questions;
  const setQ = (i: number, patch: Partial<IntakeQuestion>) => set("questions", qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  // Which rows show their options, aligned with `qs`: the flags move with their question on reorder/remove,
  // so an open panel never ends up showing a different question's key.
  const [open, setOpen] = useState<boolean[]>([]);
  const [newPrompt, setNewPrompt] = useState("");
  const flags = qs.map((_, i) => open[i] === true);
  const move = (from: number, to: number) => { set("questions", moveItem(qs, from, to)); setOpen(moveItem(flags, from, to)); };
  const remove = (i: number) => { set("questions", qs.filter((_, j) => j !== i)); setOpen(flags.filter((_, j) => j !== i)); };

  const addQuestion = () => {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    set("questions", [...qs, newIntakeQuestion(prompt, qs)]);
    setNewPrompt("");
    setOpen([...flags, true]);
  };

  return (
    <SectionCard title="Intake questions" blurb="Asked in this order, one at a time, in the assistant's own words. The caller-id number is confirmed, never read back digit by digit." testid="section-intake">
      <ol className="space-y-2" data-testid="list-intake-questions">
        {qs.map((q, i) => {
          const expanded = flags[i];
          return (
            <li key={`${q.key}-${i}`} draggable={!disabled} data-testid={`row-intake-${i}`}
              className={cn("rounded-lg border bg-card", dragFrom === i && "opacity-50")}
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) { move(dragFrom, i); setDragFrom(null); } }}
              onDragEnd={() => setDragFrom(null)}>
              {/* phones: the question gets its own full-width line; the handle, number and buttons go on the next */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2">
                <span className={cn("text-muted-foreground", disabled ? "opacity-40" : "cursor-grab")} aria-hidden="true"><GripVertical className="h-4 w-4" /></span>
                <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <Input value={q.prompt} disabled={disabled} className="order-first basis-full sm:order-none sm:basis-auto flex-1 min-w-0" aria-label={`Question ${i + 1}`} data-testid={`input-intake-prompt-${i}`}
                  onChange={(e) => setQ(i, { prompt: e.target.value })} />
                <Badge variant={q.required ? "default" : "outline"} className="text-[10px] sm:hidden">{q.required ? "required" : "optional"}</Badge>
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  <Label htmlFor={`intake-required-${i}`} className="text-xs text-muted-foreground">Required</Label>
                  <Switch id={`intake-required-${i}`} checked={q.required} disabled={disabled} data-testid={`switch-intake-required-${i}`} onCheckedChange={(v) => setQ(i, { required: v })} />
                </div>
                {!disabled && (
                  <div className="flex items-center shrink-0 ml-auto sm:ml-0">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Move up" disabled={i === 0} data-testid={`button-intake-up-${i}`}
                      onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Move down" disabled={i === qs.length - 1} data-testid={`button-intake-down-${i}`}
                      onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove question" data-testid={`button-intake-remove-${i}`}
                      onClick={() => remove(i)}><X className="h-4 w-4" /></Button>
                  </div>
                )}
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-expanded={expanded} aria-label={expanded ? "Hide options" : "Show options"}
                  data-testid={`button-intake-options-${i}`} onClick={() => setOpen(flags.map((f, j) => (j === i ? !expanded : f)))}>
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              {expanded && (
                <div className="border-t p-3 grid gap-3 sm:grid-cols-2" data-testid={`panel-intake-options-${i}`}>
                  <TextField id={`intake-key-${i}`} label="Slot key" value={q.key} disabled={disabled} testid={`input-intake-key-${i}`} maxLength={40}
                    onChange={(v) => setQ(i, { key: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    hint="Where the answer lands in the lead (lowercase, digits, _). Keep the defaults; custom keys show up as extra fields." />
                  <SelectField id={`intake-validation-${i}`} label="Answer looks like" value={q.validation} disabled={disabled} testid={`select-intake-validation-${i}`}
                    onChange={(v) => setQ(i, { validation: v })}
                    options={INTAKE_VALIDATIONS.map((v) => ({ value: v, label: INTAKE_VALIDATION_LABELS[v] }))} />
                  {q.validation === "choice" && (
                    <StringListEditor id={`intake-choices-${i}`} label="Choices" values={q.choices} disabled={disabled} testid={`list-intake-choices-${i}`} max={20}
                      onChange={(v) => setQ(i, { choices: v })} placeholder="Morning" />
                  )}
                  <SelectField id={`intake-prefill-${i}`} label="Already known from" value={q.prefillFrom || "none"} disabled={disabled} testid={`select-intake-prefill-${i}`}
                    onChange={(v) => setQ(i, { prefillFrom: v === "none" ? "" : (v as IntakeQuestion["prefillFrom"]) })}
                    options={[{ value: "none", label: "Nothing — always ask" }, { value: "caller_id", label: "Caller ID — just confirm" }, { value: "crm", label: "The CRM, if the caller is a client" }]} />
                  <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
                    <SwitchRow id={`intake-required-sm-${i}`} label="Required" checked={q.required} disabled={disabled} testid={`switch-intake-required-sm-${i}`} onChange={(v) => setQ(i, { required: v })} hint="The assistant asks again if the caller skips it." />
                    <SwitchRow id={`intake-confirm-${i}`} label="Read back once" checked={q.confirm} disabled={disabled} testid={`switch-intake-confirm-${i}`} onChange={(v) => setQ(i, { confirm: v })} hint="Emails: spell it back a single time." />
                    <SwitchRow id={`intake-never-read-${i}`} label="Never read aloud" checked={q.neverReadAloud} disabled={disabled} testid={`switch-intake-never-read-${i}`} onChange={(v) => setQ(i, { neverReadAloud: v })} hint="Phone numbers: confirm, don't recite digits." />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {qs.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-intake-empty">No questions. Add one, or restore the default script.</p>}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-1 min-w-[16rem] gap-2">
            <Input value={newPrompt} placeholder="Ask a custom question, e.g. 'Roughly how old is the roof?'" data-testid="input-intake-new"
              onChange={(e) => setNewPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQuestion(); } }} />
            <Button type="button" variant="outline" onClick={addQuestion} disabled={!newPrompt.trim() || qs.length >= 20} data-testid="button-intake-add"><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
          <Button type="button" variant="ghost" data-testid="button-intake-reset" onClick={() => { set("questions", defaultIntakeQuestions()); setOpen([]); }}><RotateCcw className="h-4 w-4 mr-1" /> Default script</Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="submit-line" label="After the last answer" value={value.submitLine} onChange={(v) => set("submitLine", v)} disabled={disabled} testid="input-submit-line" maxLength={200}
          hint="Said once the lead is filed." />
        <SwitchRow id="submit-on-goodbye" label="Goodbye = submit immediately" checked={value.submitOnGoodbye} onChange={(v) => set("submitOnGoodbye", v)} disabled={disabled} testid="switch-submit-on-goodbye"
          hint="The moment a caller says goodbye, file what was collected — no more questions." />
      </div>
    </SectionCard>
  );
}
