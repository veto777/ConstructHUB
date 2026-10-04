import { Section } from "@/components/app-ui";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { WIZARD_STEPS, issuesFor, profileIssueText, studioIssues, type StudioSectionId, type WizardStepId } from "@/lib/voice-studio";
import { VOICE_PERSONAS } from "@shared/voice-personas";
import { recordingNoticeStates, type VoiceProfile } from "@shared/voice-profile";
import { StudioSection } from "./sections";
import { invalidateProfile, publishDraft, saveDraft } from "./api";

/**
 * First-run setup wizard: company → services & don'ts → service area →
 * credibility → offers → policies → persona → intake → delivery &
 * escalations → review & publish. Every "Next" saves the draft, so a
 * contractor can leave and come back. OWNER: studio-frontend lane.
 */
export function SetupWizard({ initial, onDone, onSkip }: { initial: VoiceProfile; onDone: () => void; onSkip?: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<VoiceProfile>(initial);
  const [stepIdx, setStepIdx] = useState(0);
  /** Steps whose last draft save failed: the wizard stays put and the chip turns red until a save succeeds. */
  const [saveFailed, setSaveFailed] = useState<ReadonlySet<WizardStepId>>(new Set());
  const step = WIZARD_STEPS[stepIdx];
  const issues = useMemo(() => studioIssues(draft), [draft]);
  const stepIssues = issuesFor(issues, step.sections as readonly StudioSectionId[]);

  const save = useMutation({
    mutationFn: () => saveDraft(draft),
    // Every Next writes the draft — refresh the cache too, or "Skip to the
    // editor" opens on the stale pre-wizard copy and the next Save silently
    // overwrites what the wizard just stored (queries never refetch on their
    // own: staleTime Infinity in lib/queryClient.ts).
    onSuccess: () => invalidateProfile(),
    onError: (e) => toast({ title: "Couldn't save the draft", description: profileIssueText(e), variant: "destructive" }),
  });
  const publish = useMutation({
    mutationFn: async () => { await saveDraft(draft); return publishDraft("Initial setup", true); },
    onSuccess: (r) => { invalidateProfile(); toast({ title: `Published version ${r.version}`, description: "Your assistant is live on every number you forward to it." }); onDone(); },
    onError: (e) => toast({ title: "Couldn't publish", description: profileIssueText(e), variant: "destructive" }),
  });

  const go = async (next: number) => {
    if (next > stepIdx && stepIssues.length > 0) {
      toast({ title: "A few things to fix first", description: stepIssues[0].message, variant: "destructive" });
      return;
    }
    if (next > stepIdx) {
      // "Every Next saves the draft" — so a failed save must not move on with a checkmark.
      try {
        await save.mutateAsync();
        setSaveFailed((prev) => { const n = new Set(prev); n.delete(step.id); return n; });
      } catch {
        setSaveFailed((prev) => new Set(prev).add(step.id));
        return;
      }
    }
    setStepIdx(Math.max(0, Math.min(WIZARD_STEPS.length - 1, next)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="pt-4 space-y-4" data-testid="studio-wizard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Set up your assistant</h2>
          <p className="text-sm text-muted-foreground">Set up once, then update any detail later.</p>
        </div>
        {onSkip && <Button variant="ghost" size="sm" onClick={onSkip} data-testid="button-wizard-skip">Skip to the editor</Button>}
      </div>

      <ol className="flex gap-1.5 overflow-x-auto pb-2" aria-label="Setup steps" data-testid="wizard-steps">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < stepIdx;
          const bad = saveFailed.has(s.id) || (issuesFor(issues, s.sections as readonly StudioSectionId[]).length > 0 && i < stepIdx);
          return (
            <li key={s.id} className="shrink-0">
              <button type="button" data-testid={`wizard-step-${s.id}`} aria-current={i === stepIdx ? "step" : undefined}
                onClick={() => (i <= stepIdx ? setStepIdx(i) : void go(i))}
                data-save-failed={saveFailed.has(s.id) ? "true" : undefined}
                className={cn("flex items-center gap-1.5 min-h-10 rounded-lg border px-3 py-2 text-xs",
                  i === stepIdx ? "border-foreground bg-muted text-foreground" : done ? "bg-muted" : "text-muted-foreground",
                  saveFailed.has(s.id) && "border-destructive")}>
                {bad ? <CircleAlert className="h-3 w-3 text-destructive" /> : done ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <Section flush>
        <CardContent className="p-4 sm:p-6 space-y-6">
          {step.id === "review" ? (
            <ReviewStep draft={draft} issues={issues} noticeForced={recordingNoticeStates(draft).length > 0} onJump={(id) => setStepIdx(WIZARD_STEPS.findIndex((s) => (s.sections as readonly string[]).includes(id)))} />
          ) : (
            step.sections.map((id) => <StudioSection key={id} id={id} draft={draft} onChange={setDraft} />)
          )}
          {stepIssues.length > 0 && step.id !== "review" && (
            <ul className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1" data-testid="wizard-step-issues">
              {stepIssues.map((i, k) => <li key={k} className="flex gap-2"><CircleAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> {i.message}</li>)}
            </ul>
          )}
        </CardContent>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2 [&>div]:flex-1 sm:[&>div]:flex-none [&>div>button]:w-full">
        <Button variant="outline" onClick={() => void go(stepIdx - 1)} disabled={stepIdx === 0} data-testid="button-wizard-back"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <div className="flex items-center gap-2">
          {save.isPending && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
          {step.id === "review" ? (
            <Button onClick={() => publish.mutate()} disabled={issues.length > 0 || publish.isPending} data-testid="button-wizard-publish">
              {publish.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Rocket className="h-4 w-4 mr-1" />} Publish and go live
            </Button>
          ) : (
            <Button onClick={() => void go(stepIdx + 1)} disabled={save.isPending} data-testid="button-wizard-next">Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ draft, issues, noticeForced, onJump }: { draft: VoiceProfile; issues: ReturnType<typeof studioIssues>; noticeForced: boolean; onJump: (section: StudioSectionId) => void }) {
  const persona = VOICE_PERSONAS[draft.persona.presetId];
  const rows: Array<{ section: StudioSectionId; label: string; value: string }> = [
    { section: "company", label: "Company", value: `${draft.company.name || "—"}${draft.company.trade ? ` · ${draft.company.trade}` : ""}` },
    { section: "services", label: "Services", value: draft.company.services.map((s) => s.name).filter(Boolean).join(", ") || "none" },
    { section: "services", label: "Don'ts", value: draft.company.declines.map((d) => d.what).filter(Boolean).join(", ") || "none listed" },
    { section: "serviceArea", label: "Service area", value: `${draft.serviceArea.counties.length} counties${draft.serviceArea.spokenAreas.length ? ` · ${draft.serviceArea.spokenAreas.join(", ")}` : ""}` },
    { section: "credibility", label: "Credibility", value: [draft.credibility.yearsInBusiness ? `${draft.credibility.yearsInBusiness} years` : null, draft.credibility.insured ? "insured" : null, draft.credibility.bonded ? "bonded" : null, draft.credibility.reviews || null, ...draft.credibility.licenses].filter(Boolean).join(" · ") || "nothing yet" },
    { section: "offers", label: "Offers", value: [draft.offers.financing.available ? "financing" : null, draft.offers.freeEstimate ? "free estimates" : null, draft.offers.promotions.length ? `${draft.offers.promotions.length} promotion(s)` : null].filter(Boolean).join(" · ") || "none" },
    { section: "policies", label: "Policies", value: `prices: ${draft.policies.pricing} · ${draft.policies.repairs.replace(/_/g, " ")} · emergencies ${draft.policies.emergencies.handle ? "on" : "off"}` },
    { section: "persona", label: "Persona", value: `${draft.persona.assistantName || persona.name} (${persona.name}, ${persona.gender}) · recording notice ${noticeForced ? "on (required in your state)" : draft.persona.recordingNotice ? "on" : "off"}` },
    { section: "intake", label: "Questions", value: `${draft.intake.questions.length}: ${draft.intake.questions.map((q) => q.key).join(" → ")}` },
    { section: "escalations", label: "Escalations", value: draft.escalations.rules.length ? draft.escalations.rules.map((r) => `${r.recipientName || r.id} (${r.channel})`).join(", ") : "owners only (CRM channels)" },
    { section: "leadDelivery", label: "Lead delivery", value: [draft.leadDelivery.crm.enabled ? "CRM" : null, draft.leadDelivery.email.enabled ? "email" : null, draft.leadDelivery.sms.enabled ? "text" : null].filter(Boolean).join(" + ") || "nowhere (!)" },
  ];
  return (
    <div className="space-y-4" data-testid="wizard-review">
      <div>
        <h3 className="text-base font-semibold">Review</h3>
        <p className="text-sm text-muted-foreground">Here is what your assistant will know. Click a row to change it.</p>
      </div>
      {issues.length > 0 && (
        <ul className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1" data-testid="wizard-review-issues">
          {issues.map((i, k) => (
            <li key={k}><button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onJump(i.section)}>{i.message}</button></li>
          ))}
        </ul>
      )}
      <ul className="divide-y rounded-lg border" aria-label="Your assistant">
        {rows.map((r, i) => (
          <li key={i}>
            <button type="button" onClick={() => onJump(r.section)} className="w-full grid gap-1 sm:grid-cols-[10rem_1fr] px-3 py-2 text-left text-sm hover:bg-muted/50" data-testid={`review-row-${r.section}-${i}`}>
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground break-words">{r.value}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="text-sm flex items-center gap-2"><Badge variant="secondary">Next</Badge> Publish, then try it in the Simulator before you forward a real line.</div>
    </div>
  );
}
