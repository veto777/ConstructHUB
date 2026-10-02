import { useState, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DAY_LABELS } from "@/lib/voice-studio";
import { DAY_KEYS, type VoiceProfile } from "@shared/voice-profile";

/**
 * The Studio's form primitives: every control carries a label, optional
 * microcopy ("hint") and a data-testid, and every one is disable-able so a
 * member without manageSettings sees the profile read-only.
 * OWNER: studio-frontend lane.
 */

export type SectionProps<T> = { value: T; onChange: (next: T) => void; disabled?: boolean };

export function Field({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({ id, label, hint, value, onChange, placeholder, disabled, testid, type = "text", maxLength, className, inputMode }: {
  id: string; label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string;
  disabled?: boolean; testid: string; type?: string; maxLength?: number; className?: string; inputMode?: "text" | "tel" | "email" | "url" | "numeric";
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        disabled={disabled} maxLength={maxLength} inputMode={inputMode} data-testid={testid} />
    </Field>
  );
}

export function TextAreaField({ id, label, hint, value, onChange, placeholder, disabled, testid, rows = 3, maxLength, className }: {
  id: string; label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string;
  disabled?: boolean; testid: string; rows?: number; maxLength?: number; className?: string;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        disabled={disabled} maxLength={maxLength} data-testid={testid} />
      {maxLength && <div className="text-right text-[11px] text-muted-foreground tabular-nums">{value.length}/{maxLength}</div>}
    </Field>
  );
}

export function NumberField({ id, label, hint, value, onChange, min, max, step = 1, disabled, testid, className, suffix }: {
  id: string; label: ReactNode; hint?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  disabled?: boolean; testid: string; className?: string; suffix?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" inputMode="decimal" value={raw ?? String(value)} min={min} max={max} step={step} disabled={disabled} data-testid={testid}
          onChange={(e) => {
            setRaw(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => setRaw(null)}
          className="max-w-[9rem]" />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </Field>
  );
}

export function SwitchRow({ id, label, hint, checked, onChange, disabled, testid }: {
  id: string; label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testid: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} data-testid={testid} />
    </div>
  );
}

export function SelectField<T extends string>({ id, label, hint, value, onChange, options, disabled, testid, placeholder, className }: {
  id: string; label: ReactNode; hint?: ReactNode; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean; testid: string; placeholder?: string; className?: string;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} data-testid={testid}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value} data-testid={`${testid}-option-${o.value}`}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Chips + an input: Enter or the + button adds; the × on a chip removes. */
export function StringListEditor({ id, label, hint, values, onChange, placeholder, disabled, testid, max = 50, normalize }: {
  id: string; label: ReactNode; hint?: ReactNode; values: string[]; onChange: (v: string[]) => void; placeholder?: string;
  disabled?: boolean; testid: string; max?: number; normalize?: (s: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = (normalize ?? ((s: string) => s.trim()))(draft);
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid={`${testid}-chips`}>
          {values.map((v, i) => (
            <Badge key={`${v}-${i}`} variant="secondary" className="gap-1 pr-1 font-normal" data-testid={`${testid}-chip-${i}`}>
              <span className="max-w-[16rem] truncate">{v}</span>
              {!disabled && (
                <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-background"
                  aria-label={`Remove ${v}`} data-testid={`${testid}-remove-${i}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input id={id} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} data-testid={`${testid}-input`}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" size="icon" onClick={add} aria-label="Add" data-testid={`${testid}-add`} disabled={!draft.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Field>
  );
}

export function HoursEditor({ value, onChange, disabled }: SectionProps<VoiceProfile["company"]["hours"]>) {
  return (
    <div className="space-y-2" data-testid="editor-hours">
      {DAY_KEYS.map((day) => {
        const d = value[day];
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <Switch id={`hours-${day}`} checked={d.open} disabled={disabled} data-testid={`switch-hours-${day}`}
              onCheckedChange={(open) => onChange({ ...value, [day]: { ...d, open } })} />
            <Label htmlFor={`hours-${day}`} className="w-24 text-sm">{DAY_LABELS[day]}</Label>
            {d.open ? (
              <div className="flex items-center gap-2 text-sm">
                <Input type="time" value={d.from} disabled={disabled} className="w-[7.5rem]" data-testid={`input-hours-${day}-from`}
                  onChange={(e) => onChange({ ...value, [day]: { ...d, from: e.target.value } })} />
                <span className="text-muted-foreground">to</span>
                <Input type="time" value={d.to} disabled={disabled} className="w-[7.5rem]" data-testid={`input-hours-${day}-to`}
                  onChange={(e) => onChange({ ...value, [day]: { ...d, to: e.target.value } })} />
              </div>
            ) : <span className="text-sm text-muted-foreground">Closed</span>}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">The assistant answers 24/7 either way; hours tell it when "someone will call you back" means today or tomorrow.</p>
    </div>
  );
}

export function SectionCard({ title, blurb, children, testid }: { title: string; blurb?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="space-y-4" data-testid={testid}>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {blurb && <p className="text-sm text-muted-foreground">{blurb}</p>}
      </div>
      {children}
    </section>
  );
}

export function RowCard({ children, onRemove, disabled, testid, removeLabel = "Remove" }: { children: ReactNode; onRemove?: () => void; disabled?: boolean; testid?: string; removeLabel?: string }) {
  return (
    <div className="relative rounded-lg border p-3 pr-10 space-y-3" data-testid={testid}>
      {children}
      {onRemove && !disabled && (
        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 h-8 w-8" onClick={onRemove} aria-label={removeLabel} data-testid={testid ? `${testid}-remove` : undefined}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
