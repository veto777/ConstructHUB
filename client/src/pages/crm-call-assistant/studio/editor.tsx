import { Section } from "@/components/app-ui";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, Eye, History, Loader2, Pause, Play, Rocket, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { STUDIO_SECTIONS, issuesFor, profileDiffSummary, profileIssueText, studioIssues, type StudioSectionId, type VoiceProfileResponse, type VoiceVersionRow } from "@/lib/voice-studio";
import type { CompiledProfile, VoiceProfile } from "@shared/voice-profile";
import { StudioSection } from "./sections";
import { fetchVersion, invalidateProfile, pauseAssistant, publishDraft, restoreVersion, resumeAssistant, saveDraft, VERSIONS_KEY, PREVIEW_KEY } from "./api";

type View = StudioSectionId | "preview" | "versions";
const NAV_EXTRA: Array<{ id: View; label: string; blurb: string }> = [
  { id: "preview", label: "Prompt preview", blurb: "What the assistant is told." },
  { id: "versions", label: "Version history", blurb: "Every publish, restorable." },
];

/**
 * The advanced editor: left nav per section, the section's form, a sticky
 * action bar (dirty state, Save draft, Publish with a diff summary, Pause /
 * Resume), the compiled-prompt preview and the version history.
 * OWNER: studio-frontend lane.
 */
export function StudioEditor({ data, canManage, onRunWizard }: { data: VoiceProfileResponse; canManage: boolean; onRunWizard: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<VoiceProfile>(data.profile);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(data.profile));
  const [view, setView] = useState<View>("company");
  const [publishOpen, setPublishOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== savedJson;
  const issues = useMemo(() => studioIssues(draft), [draft]);
  const disabled = !canManage;

  // A restore (or another tab's save) refreshes the server copy; take it when the local draft is clean.
  useEffect(() => {
    const incoming = JSON.stringify(data.profile);
    if (incoming !== savedJson && !dirty) { setDraft(data.profile); setSavedJson(incoming); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.profile]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => saveDraft(draft),
    onSuccess: (r) => { setSavedJson(JSON.stringify(r.profile ?? draft)); if (r.profile) setDraft(r.profile); invalidateProfile(); toast({ title: "Draft saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: profileIssueText(e), variant: "destructive" }),
  });
  const pause = useMutation({
    mutationFn: () => (data.status === "paused" ? resumeAssistant() : pauseAssistant()),
    onSuccess: (r) => { invalidateProfile(); toast({ title: r.status === "paused" ? "Assistant paused" : "Assistant live", description: r.status === "paused" ? "Callers hear a short message and the call ends. Resume any time." : "Answering calls again." }); },
    onError: (e) => toast({ title: "Couldn't change status", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const nav = (
    <nav aria-label="Studio sections" className="space-y-0.5" data-testid="studio-nav">
      {[...STUDIO_SECTIONS, ...NAV_EXTRA].map((s) => {
        const bad = s.id !== "preview" && s.id !== "versions" && issuesFor(issues, [s.id as StudioSectionId]).length > 0;
        return (
          <button key={s.id} type="button" onClick={() => setView(s.id as View)} aria-current={view === s.id ? "page" : undefined} data-testid={`studio-nav-${s.id}`}
            className={cn("w-full rounded-md px-3 py-2 text-left text-sm flex items-center justify-between gap-2", view === s.id ? "bg-muted text-foreground font-medium" : "hover:bg-muted")}>
            <span>
              <span className="block">{s.label}</span>
              <span className="sr-only">{s.blurb}</span>
            </span>
            {bad && <CircleAlert className="h-4 w-4 text-destructive shrink-0" aria-label="Needs attention" />}
            {s.id === "preview" && <Eye className="h-4 w-4 text-muted-foreground shrink-0" />}
            {s.id === "versions" && <History className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="pt-4 space-y-4" data-testid="studio-editor">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b sm:static sm:mx-0 sm:px-0 sm:border-0 sm:bg-transparent">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="badge-studio-status">{data.status}</Badge>
          {data.publishedVersion != null && <Badge variant="outline" data-testid="badge-studio-version">v{data.publishedVersion}</Badge>}
          <span className="text-xs text-muted-foreground" data-testid="text-studio-dirty">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          {issues.length > 0 && <span className="text-xs text-destructive flex items-center gap-1" data-testid="text-studio-issues"><CircleAlert className="h-3 w-3" /> {issues.length} to fix before publishing</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!disabled && (
              <>
                <Button variant="ghost" size="sm" onClick={onRunWizard} data-testid="button-studio-wizard"><Wand2 className="h-4 w-4 mr-1" /> Setup wizard</Button>
                {data.publishedVersion != null && (
                  <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={pause.isPending} data-testid="button-studio-pause">
                    {data.status === "paused" ? <><Play className="h-4 w-4 mr-1" /> Resume</> : <><Pause className="h-4 w-4 mr-1" /> Pause</>}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-studio-save">
                  {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save draft
                </Button>
                <Button size="sm" onClick={() => setPublishOpen(true)} disabled={issues.length > 0 || save.isPending} data-testid="button-studio-publish"><Rocket className="h-4 w-4 mr-1" /> Publish</Button>
              </>
            )}
          </div>
        </div>
        {disabled && <p className="text-xs text-muted-foreground mt-1" data-testid="text-studio-readonly">Read-only: only members who manage settings can edit the assistant.</p>}
      </div>

      <div className="sm:hidden">
        <Label htmlFor="studio-section-select" className="sr-only">Section</Label>
        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger id="studio-section-select" data-testid="select-studio-section"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[...STUDIO_SECTIONS, ...NAV_EXTRA].map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="hidden sm:block"><Section flush><CardContent className="p-2">{nav}</CardContent></Section></aside>
        <Section flush>
          <CardContent className="p-4 sm:p-6">
            {view === "preview" ? (
              <PromptPreview dirty={dirty} />
            ) : view === "versions" ? (
              <VersionHistory data={data} canManage={canManage} dirty={dirty}
                onRestored={(p) => { setDraft(p); setSavedJson(JSON.stringify(p)); }} />
            ) : (
              <StudioSection id={view} draft={draft} onChange={setDraft} disabled={disabled} />
            )}
          </CardContent>
        </Section>
      </div>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} draft={draft} data={data} dirty={dirty}
        onPublished={(version) => { setSavedJson(JSON.stringify(draft)); invalidateProfile(); toast({ title: `Published version ${version}`, description: "Live on every number forwarded to the assistant." }); }} />
    </div>
  );
}

/** GET /profile/preview compiles the SAVED draft; unsaved edits are not in it. */
function PromptPreview({ dirty }: { dirty: boolean }) {
  const preview = useQuery<{ compiled: CompiledProfile }>({ queryKey: PREVIEW_KEY });
  const c = preview.data?.compiled;
  return (
    <div className="space-y-4" data-testid="studio-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Prompt preview</h3>
          <p className="text-sm text-muted-foreground">Review the instructions your saved draft gives the assistant.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => preview.refetch()} disabled={preview.isFetching} data-testid="button-preview-refresh">
          {preview.isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Refresh
        </Button>
      </div>
      {dirty && <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2" data-testid="text-preview-dirty">You have unsaved changes — save the draft to see them here.</p>}
      {preview.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Compiling…</div>
      ) : preview.isError ? (
        <p className="text-sm text-destructive" data-testid="text-preview-error">Couldn't compile: {apiErrorMessage(preview.error)}</p>
      ) : c ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <Stat label="Persona" value={`${c.persona.name} · ${c.persona.voice}`} testid="preview-persona" />
            <Stat label="Intake" value={`${c.intake.length} questions`} testid="preview-intake" />
            <Stat label="Spam flags at" value={`${Math.round(c.spam.flagAt * 100)}% · strike ${Math.round(c.spam.strikeAt * 100)}%`} testid="preview-spam" />
            <Stat label="Silence" value={`${c.timings.silencePromptSeconds}s × ${c.timings.silencePromptsBeforeHangup}`} testid="preview-silence" />
            <Stat label="Limits" value={`${c.timings.maxTurns} turns · ${c.timings.maxCallSeconds}s`} testid="preview-limits" />
            <Stat label="Compiled" value={`${c.compiledAt ? new Date(c.compiledAt).toLocaleString() : "—"} · ${c.hash?.slice(0, 8) ?? ""}`} testid="preview-compiled" />
          </div>
          <div className="space-y-1.5">
            <Label>Greeting</Label>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="preview-greeting">{c.greeting}</p>
          </div>
          <div className="space-y-1.5">
            <Label>System prompt</Label>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed font-mono" data-testid="preview-system-prompt">{c.systemPrompt}</pre>
          </div>
          <div className="space-y-1.5">
            <Label>Intake script</Label>
            <ol className="list-decimal pl-5 text-sm space-y-0.5" data-testid="preview-intake-list">
              {c.intake.map((q) => <li key={q.key}><span className="font-mono text-xs text-muted-foreground">{q.key}</span> — {q.prompt}{q.required ? "" : " (optional)"}</li>)}
            </ol>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded-md border px-3 py-2" data-testid={testid}>
      <div className="text-[11px]  text-muted-foreground">{label}</div>
      <div className="font-medium truncate" title={value}>{value}</div>
    </div>
  );
}

function VersionHistory({ data, canManage, dirty, onRestored }: { data: VoiceProfileResponse; canManage: boolean; dirty: boolean; onRestored: (profile: VoiceProfile) => void }) {
  const { toast } = useToast();
  const versions = useQuery<{ versions: VoiceVersionRow[] }>({ queryKey: VERSIONS_KEY });
  const [selected, setSelected] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const detail = useQuery({ queryKey: ["voice-version", selected], queryFn: () => fetchVersion(selected!), enabled: selected != null });
  const restore = useMutation({
    mutationFn: (v: number) => restoreVersion(v),
    onSuccess: (r, v) => { if (r?.profile) onRestored(r.profile); invalidateProfile(); toast({ title: `Version ${v} restored into the draft`, description: "Publish to make it live." }); },
    onError: (e) => toast({ title: "Couldn't restore", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const list = versions.data?.versions ?? [];
  return (
    <div className="space-y-4" data-testid="studio-versions">
      <div>
        <h3 className="text-base font-semibold">Version history</h3>
        <p className="text-sm text-muted-foreground">Every publish is kept. Restoring copies a version into the draft; it goes live only when you publish again.</p>
      </div>
      {versions.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : versions.isError ? (
        <p className="text-sm text-destructive" data-testid="text-versions-error">Couldn't load versions: {apiErrorMessage(versions.error)}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-versions-empty">Nothing published yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="list-versions">
          {list.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid={`row-version-${v.version}`}>
              <Badge variant={v.version === data.publishedVersion ? "default" : "outline"}>v{v.version}</Badge>
              <span className="flex-1 min-w-0 truncate">{v.note || "No note"}</span>
              <span className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}{v.author ? ` · ${v.author}` : ""}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(selected === v.version ? null : v.version)} data-testid={`button-version-view-${v.version}`}>{selected === v.version ? "Hide" : "View"}</Button>
              {canManage && <Button variant="outline" size="sm" onClick={() => setConfirm(v.version)} disabled={restore.isPending} data-testid={`button-version-restore-${v.version}`}>Restore</Button>}
            </li>
          ))}
        </ul>
      )}
      {selected != null && (
        <div className="space-y-2" data-testid="version-detail">
          {detail.isLoading ? <p className="text-sm text-muted-foreground">Loading version {selected}…</p>
            : detail.isError ? <p className="text-sm text-destructive">Couldn't load version {selected}: {apiErrorMessage(detail.error)}</p>
            : detail.data ? (
              <>
                <Label>Version {selected} — system prompt</Label>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs font-mono" data-testid="version-detail-prompt">{detail.data.compiled?.systemPrompt ?? "(not compiled)"}</pre>
              </>
            ) : null}
        </div>
      )}
      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid="dialog-version-restore">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {confirm} into the draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {dirty ? "Your unsaved edits in this editor will be replaced. " : ""}The live assistant does not change until you publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-version-restore-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm != null) restore.mutate(confirm); setConfirm(null); }} data-testid="button-version-restore-confirm">Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PublishDialog({ open, onOpenChange, draft, data, dirty, onPublished }: {
  open: boolean; onOpenChange: (o: boolean) => void; draft: VoiceProfile; data: VoiceProfileResponse; dirty: boolean; onPublished: (version: number) => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const published = useQuery({
    queryKey: ["voice-version", data.publishedVersion],
    queryFn: () => fetchVersion(data.publishedVersion!),
    enabled: open && data.publishedVersion != null,
  });
  const diff = useMemo(
    () => (data.publishedVersion == null ? profileDiffSummary(null, draft) : published.data ? profileDiffSummary(published.data.profile, draft) : null),
    [data.publishedVersion, published.data, draft],
  );
  const publish = useMutation({
    mutationFn: async () => { if (dirty) await saveDraft(draft); return publishDraft(note.trim()); },
    onSuccess: (r) => { onOpenChange(false); setNote(""); onPublished(r.version); },
    onError: (e) => toast({ title: "Couldn't publish", description: profileIssueText(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-publish">
        <DialogHeader>
          <DialogTitle>Publish version {(data.publishedVersion ?? 0) + 1}</DialogTitle>
          <DialogDescription>{dirty ? "The draft is saved first, then compiled and made live." : "The saved draft is compiled and made live."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>What changes</Label>
            {diff == null ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Comparing with version {data.publishedVersion}…</p>
            ) : diff.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-publish-no-changes">Nothing differs from version {data.publishedVersion}. Publishing again recompiles with the current compiler.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm space-y-0.5 max-h-48 overflow-auto" data-testid="list-publish-diff">
                {diff.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="publish-note">Note (optional)</Label>
            <Input id="publish-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Added the spring promo" maxLength={200} data-testid="input-publish-note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-publish-cancel">Cancel</Button>
          <Button onClick={() => publish.mutate()} disabled={publish.isPending} data-testid="button-publish-confirm">
            {publish.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Rocket className="h-4 w-4 mr-1" />} Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
