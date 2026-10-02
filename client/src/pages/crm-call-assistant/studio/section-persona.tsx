import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Play, Square, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { VOICE_PERSONA_LIST, type VoicePersona, type VoicePersonaId } from "@shared/voice-personas";
import type { VoiceProfile } from "@shared/voice-profile";
import { SectionCard, SwitchRow, TextAreaField, TextField, type SectionProps } from "./fields";

type Persona = VoiceProfile["persona"];

/**
 * Persona — preset cards (name, gender, voice id, play sample), the
 * assistant's name, greeting, "are you a bot?" answer, recording notice and
 * style knobs. Samples come from GET /api/crm/voice/personas (sampleUrl is
 * null until the engine lane renders client/public/persona-samples/<id>.mp3).
 * OWNER: studio-frontend lane.
 */
export function PersonaSection({ value, onChange, disabled, companyName }: SectionProps<Persona> & { companyName?: string }) {
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => onChange({ ...value, [k]: v });
  const personas = useQuery<{ personas: VoicePersona[] }>({ queryKey: ["/api/crm/voice/personas"] });
  const list = personas.data?.personas ?? VOICE_PERSONA_LIST;
  const [playing, setPlaying] = useState<VoicePersonaId | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const play = (p: VoicePersona) => {
    if (playing === p.id) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause();
    if (!p.sampleUrl) return;
    const a = new Audio(p.sampleUrl);
    audio.current = a;
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    setPlaying(p.id);
    void a.play().catch(() => setPlaying(null));
  };

  const assistantName = value.assistantName || list.find((p) => p.id === value.presetId)?.name || "";
  const greetingPlaceholder = `Thank you for calling ${companyName || "us"}, this is ${assistantName || "your assistant"}. ${value.recordingNotice ? "Calls may be recorded. " : ""}What can we help you with today?`;

  return (
    <SectionCard title="Persona" blurb="Pick a voice, give it a name, write the first thing a caller hears." testid="section-persona">
      <div className="space-y-1.5">
        <Label>Voice</Label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Voice" data-testid="persona-cards">
          {list.map((p) => {
            const selected = value.presetId === p.id;
            return (
              <div key={p.id} role="radio" aria-checked={selected} tabIndex={disabled ? -1 : 0}
                data-testid={`card-persona-${p.id}`}
                className={cn("rounded-lg border p-3 text-left transition-colors", selected ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:bg-muted/40", disabled ? "opacity-70" : "cursor-pointer")}
                onClick={() => !disabled && set("presetId", p.id)}
                onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); set("presetId", p.id); } }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{p.gender}</Badge>
                      {selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.blurb}</p>
                  </div>
                  <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" data-testid={`button-persona-play-${p.id}`}
                    aria-label={playing === p.id ? `Stop ${p.name}'s sample` : `Play ${p.name}'s sample`}
                    disabled={!p.sampleUrl} title={p.sampleUrl ? undefined : "Sample not rendered yet"}
                    onClick={(e) => { e.stopPropagation(); play(p); }}>
                    {playing === p.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground italic flex items-start gap-1"><Volume2 className="h-3 w-3 mt-0.5 shrink-0" /> "{p.sampleLine}"</p>
                {!p.sampleUrl && <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`text-persona-no-sample-${p.id}`}>Sample audio not rendered yet.</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="assistant-name" label="Assistant's name" value={value.assistantName} onChange={(v) => set("assistantName", v)} disabled={disabled} testid="input-assistant-name"
          placeholder={list.find((p) => p.id === value.presetId)?.name ?? "Janice"} hint="Leave blank to use the voice's own name." maxLength={200} />
        <TextField id="bot-answer" label='When asked "are you a bot?"' value={value.botAnswer} onChange={(v) => set("botAnswer", v)} disabled={disabled} testid="input-bot-answer" maxLength={200}
          hint="Always honest. The assistant never claims to be a person." />
      </div>
      <TextAreaField id="greeting" label="Greeting" value={value.greeting} onChange={(v) => set("greeting", v)} disabled={disabled} testid="textarea-greeting" rows={2} maxLength={200}
        placeholder={greetingPlaceholder} hint="Blank = the default above, built from your company name and the assistant's name." />
      <SwitchRow id="recording-notice" label='Say "calls may be recorded"' checked={value.recordingNotice} onChange={(v) => set("recordingNotice", v)} disabled={disabled} testid="switch-recording-notice"
        hint={value.recordingNotice ? "Keep this on in two-party-consent states (Washington, Florida, California and others)." : "Off: calls are still recorded for your log. In a two-party-consent state that may be unlawful — turn it back on unless you have checked."} />
      <div className="grid gap-4 sm:grid-cols-3">
        {([["warmth", "Warmth", "Reserved", "Warm"], ["brevity", "Brevity", "Chatty", "Brief"], ["formality", "Formality", "Casual", "Formal"]] as const).map(([k, label, lo, hi]) => (
          <div key={k} className="space-y-2">
            <div className="flex items-center justify-between"><Label>{label}</Label><span className="text-xs text-muted-foreground tabular-nums">{value.style[k]}/5</span></div>
            <Slider min={1} max={5} step={1} value={[value.style[k]]} disabled={disabled} data-testid={`slider-style-${k}`}
              onValueChange={([n]) => set("style", { ...value.style, [k]: n })} aria-label={label} />
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>{lo}</span><span>{hi}</span></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Languages: English. Spanish is on the roadmap; the field is kept so profiles will not need to change.</p>
    </SectionCard>
  );
}
