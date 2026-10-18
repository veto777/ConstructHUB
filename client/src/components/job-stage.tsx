/**
 * The job stage (shared/job-stage.ts): the big Bid → Bid Submitted → Approved → Job Scheduled → In progress →
 * Closed out tracker on the CRM client page, and the small colored pill used next to clients in Google Reviews.
 *
 * Under the tracker: the submitted bid + signed contract, the "call to schedule the start date" reminder after
 * approval, the scheduled visit with a link to that day on the calendar, and — from Job Scheduled on — the punch
 * list & final walkthrough, one section per scope (every walkthrough complete closes the job out). Closing out
 * (by hand or by the last walkthrough) sprays confetti for the PM unless Settings → Celebrations is off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Camera, CalendarDays, Check, CheckCircle2, ClipboardCheck, FileCheck, Loader2, MessageSquare, Paperclip, PhoneCall, Plus, RotateCcw, Trash2, X,
} from "lucide-react";
import { photoStage, uploadFile } from "@/components/client-uploads";
import { ConfettiCelebration } from "@/components/confetti";
import { confirmAction } from "@/components/confirm-dialog";
import { PhotoViewer } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  STAGE_PROJECT_STATUS, currentProject, jobStageLabel, jobStageOf, stageIndex, stageOfProjectStatus, type JobStage,
} from "@shared/job-stage";
import { DEFAULT_JOB_FLOW, anchorStatusBefore, currentPhaseKey, phaseIndex, phaseLabel, type FlowPhase, type JobFlow } from "@shared/job-flow";
import { newPunchId, openWalkthroughs, parsePunchPhotoName, type PunchScope } from "@shared/punch-list";

/** The pill's colours (Google Reviews lists): grey while bidding, blue once it is out, green from approval on. */
const TONE: Record<JobStage, { solid: string; soft: string; text: string }> = {
  bid: { solid: "bg-slate-500", soft: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-200" },
  bid_submitted: { solid: "bg-sky-600", soft: "bg-sky-50 dark:bg-sky-950/50", text: "text-sky-700 dark:text-sky-300" },
  approved: { solid: "bg-emerald-600", soft: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300" },
  job_scheduled: { solid: "bg-emerald-600", soft: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300" },
  in_progress: { solid: "bg-emerald-600", soft: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300" },
  closed_out: { solid: "bg-sky-600", soft: "bg-sky-50 dark:bg-sky-950/50", text: "text-sky-700 dark:text-sky-300" },
};

/**
 * The account's phases (Settings → Job flow; the six built-in ones by default): the one the job is ON is solid
 * green, every phase it has moved past is blue with a check, the NEXT one is lit with a blue outline (the call to
 * action), the rest grey dashed. Two by two on a phone; the row wraps when there are more than six.
 */
export function JobStageTracker({ current, flow = DEFAULT_JOB_FLOW, testId = "job-stage-tracker", onPick, busy }: {
  /** The current phase's key (a built-in stage or a custom phase). */
  current: string | null; flow?: JobFlow; testId?: string;
  /** Makes each phase a button that moves the job there. */
  onPick?: (p: FlowPhase) => void; busy?: boolean;
}) {
  const at = phaseIndex(flow, current);
  const wraps = flow.phases.length > 6;
  return (
    <div data-testid={testId} aria-label={`Job stage: ${phaseLabel(flow, current) ?? "no job yet"}`}>
      <ol className={`grid grid-cols-2 gap-2 ${wraps ? "sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "sm:flex sm:items-center sm:gap-0"}`}>
        {flow.phases.map((s, i) => {
          const done = i < at, current = i === at, next = i === at + 1;
          const box = current ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
            : done ? "border-transparent bg-sky-50 dark:bg-sky-950/40"
            : next ? "border-sky-500 bg-background text-sky-700 dark:text-sky-300"
            : "border-dashed border-border bg-background text-muted-foreground";
          return (
            <li key={s.key} className="flex flex-1 items-center" data-testid={`${testId}-${s.key}`} aria-current={current ? "step" : undefined}
              data-state={current ? "current" : done ? "done" : next ? "next" : "later"}>
              {/* The phase the job is ON is green; every phase it has moved past is blue with a check (owner). */}
              <button type="button" disabled={!onPick || busy || current} onClick={() => onPick?.(s)}
                title={onPick && !current ? `Move the job to ${s.label}` : undefined}
                className={`flex flex-1 items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors disabled:cursor-default ${onPick && !current ? "hover:border-foreground/40" : ""} ${box}`}
                data-testid={`button-${testId}-${s.key}`}>
                {/* Every finished step gets the same blue check (owner): the grey of a Bid-only tone never reads as done. */}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-sky-600 text-white" : current ? "bg-emerald-600 text-white" : next ? "border-2 border-sky-500 text-sky-700 dark:text-sky-300" : "bg-muted-foreground/30 text-white"}`}>
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className={`text-sm ${wraps ? "" : "whitespace-nowrap"} ${current ? "font-bold" : done ? "font-semibold text-foreground" : next ? "font-semibold" : "font-medium"}`}>{s.label}</span>
              </button>
              {!wraps && i < flow.phases.length - 1 && <span className={`hidden h-0.5 w-3 shrink-0 sm:block ${i < at ? "bg-foreground/40" : "bg-border"}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type SubmittedEstimate = {
  id?: string; number?: string | null; title?: string | null; status?: string | null; source?: "hcp" | "constructhub";
  totalCents?: number; approvedTotalCents?: number | null; sentAt?: string | null; approvedAt?: string | null; signatureName?: string | null;
};
export type StageAppointment = { id: string; title?: string | null; startsAt: string; endsAt?: string | null; status?: string | null; projectId?: string | null; customerId?: string | null };

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "2026-10-21" in the browser's zone — the day the calendar opens on (/crm/schedule?date=). */
const isoDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** The bid that went to the client (the approved one, else the latest sent), and its signed contract on file. */
function pickSubmitted(estimates: SubmittedEstimate[]): SubmittedEstimate | null {
  const main = estimates.filter((e) => e.id && !/change order/i.test(e.title ?? ""));
  const pool = main.length ? main : estimates.filter((e) => e.id);
  const t = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  const approved = pool.filter((e) => e.status === "approved").sort((a, b) => t(b.approvedAt) - t(a.approvedAt))[0];
  if (approved) return approved;
  return pool.filter((e) => e.status === "sent" || e.status === "viewed").sort((a, b) => t(b.sentAt) - t(a.sentAt))[0] ?? null;
}

/** The visit that scheduled the job: the project's own (soonest upcoming, else the latest), else an unlinked one of the client's. */
export function pickAppointment(appointments: StageAppointment[], projectId: string | null | undefined): StageAppointment | null {
  const live = appointments.filter((a) => a.status !== "canceled");
  const pool = (projectId && live.some((a) => a.projectId === projectId)) ? live.filter((a) => a.projectId === projectId) : live.filter((a) => !a.projectId);
  const now = Date.now();
  const t = (a: StageAppointment) => new Date(a.startsAt).getTime();
  const upcoming = pool.filter((a) => t(a) >= now).sort((a, b) => t(a) - t(b));
  return upcoming[0] ?? pool.sort((a, b) => t(b) - t(a))[0] ?? null;
}

/**
 * Under the tracker: the submitted bid (number, title, amount, when it went out, where it was written — HouseCall Pro
 * or here) and the signed contract: the file on its estimate (view), or Attach / Replace once the job is approved.
 */
function SubmittedBid({ estimates, stage, canSeePrices, canAttach }: {
  estimates: SubmittedEstimate[]; stage: JobStage | null; canSeePrices: boolean; canAttach: boolean;
}) {
  const { toast } = useToast();
  const e = pickSubmitted(estimates);
  const fileRef = useRef<HTMLInputElement>(null);
  const qk = [`/api/crm/attachments?kind=contract&refId=${e?.id ?? ""}`];
  const { data: contracts } = useQuery<any[]>({ queryKey: qk, enabled: !!e?.id });
  const contract = (contracts ?? [])[0] ?? null;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const r = await uploadFile("/api/crm/attachments", file, { kind: "contract", refId: e!.id! });
      // Replace: the previous signed copy goes once the new one is stored.
      if (contract) await fetch(`/api/crm/attachments/${contract.id}`, { method: "DELETE", credentials: "same-origin" });
      return r;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk }); toast({ title: contract ? "Signed contract replaced" : "Signed contract attached" }); },
    onError: (err) => toast({ title: "Could not attach the contract", description: apiErrorMessage(err), variant: "destructive" }),
  });
  if (!e) return null;
  const approved = stageIndex(stage) >= stageIndex("approved");
  const amount = canSeePrices ? (e.approvedTotalCents ?? e.totalCents) : undefined;
  return (
    <div className="mt-3 grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2" data-testid="submitted-bid">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{e.status === "approved" ? "Approved bid" : "Submitted bid"}</p>
        <Link href={`/crm/estimates/${e.id}`} className="font-semibold text-primary hover:underline" data-testid="link-submitted-bid">
          #{e.number} · {e.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {[amount != null ? money(amount) : null,
            e.status === "approved" ? `approved ${day(e.approvedAt)}${e.signatureName ? ` by ${e.signatureName}` : ""}` : e.sentAt ? `sent ${day(e.sentAt)}` : null,
            e.source === "hcp" ? "from HouseCall Pro" : "written here"].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signed contract</p>
        {contract ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={contract.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-testid="link-signed-contract">
              <FileCheck className="h-4 w-4" aria-hidden="true" />View
            </a>
            <span className="truncate text-xs text-muted-foreground" title={contract.fileName}>{contract.fileName}</span>
            {canAttach && <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => fileRef.current?.click()} disabled={upload.isPending} data-testid="button-replace-contract">Replace</button>}
          </p>
        ) : approved ? (
          canAttach ? (
            <Button size="sm" variant="outline" className="h-8" onClick={() => fileRef.current?.click()} disabled={upload.isPending} data-testid="button-attach-contract">
              {upload.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}Attach signed contract
            </Button>
          ) : <p className="text-xs text-muted-foreground">None on file.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Attach it here once the bid is approved.</p>
        )}
        <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" data-testid="input-signed-contract"
          onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) upload.mutate(f); }} />
      </div>
    </div>
  );
}

/** The stage as a small pill (Google Reviews lists). Nothing when there is no job. */
export function JobStagePill({ stage, testId }: { stage: JobStage | null | undefined; testId?: string }) {
  if (!stage) return null;
  const tone = TONE[stage];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone.soft} ${tone.text}`} data-testid={testId}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.solid}`} aria-hidden="true" />{jobStageLabel(stage)}
    </span>
  );
}

// ── Punch list & final walkthrough ──────────────────────────────────────────

type PunchPayload = { scopes: PunchScope[]; closedOut?: boolean; projectStatus?: string };

/**
 * One section per scope of the approved work (derived from the approved estimates, add or remove by hand): the
 * punch-list notes (add, check off), the scope's photos (tagged "punchlist--<scope>--" so the photo library and the
 * client portal show them) and "Walkthrough complete" (who/when). Every change saves straight away; when the last
 * walkthrough is completed the server closes the job out and `onClosedOut` fires the celebration.
 */
function PunchListBlock({ projectId, customerId, canEdit, onClosedOut, onScopes }: {
  projectId: string; customerId: string; canEdit: boolean; onClosedOut: () => void; onScopes: (s: PunchScope[]) => void;
}) {
  const { toast } = useToast();
  const qk = [`/api/crm/projects/${projectId}/punch`];
  const { data, isLoading } = useQuery<PunchPayload>({ queryKey: qk });
  const [scopes, setScopes] = useState<PunchScope[]>([]);
  useEffect(() => { if (data?.scopes) { setScopes(data.scopes); onScopes(data.scopes); } }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  const [newScope, setNewScope] = useState("");
  const [addingScope, setAddingScope] = useState(false);
  const photosQk = [`/api/crm/attachments?kind=photo&refId=${customerId}`];
  const { data: photos } = useQuery<any[]>({ queryKey: photosQk });
  const [viewing, setViewing] = useState<{ scope: string; index: number } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const save = useMutation({
    mutationFn: async (next: PunchScope[]) => (await apiRequest("PUT", `/api/crm/projects/${projectId}/punch`, {
      scopes: next.map((s) => ({ scope: s.scope, label: s.label, items: s.items, walkthroughDone: !!s.walkthroughDoneAt })),
    })).json() as Promise<PunchPayload>,
    onSuccess: (r) => {
      queryClient.setQueryData(qk, r);
      setScopes(r.scopes);
      onScopes(r.scopes);
      if (r.closedOut) {
        queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customerId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
        queryClient.invalidateQueries({ queryKey: ["/api/reviews/pipeline"] });
        onClosedOut();
      }
    },
    onError: (e) => { toast({ title: "Couldn't save the punch list", description: apiErrorMessage(e), variant: "destructive" }); queryClient.invalidateQueries({ queryKey: qk }); },
  });
  const commit = (next: PunchScope[]) => { setScopes(next); save.mutate(next); };
  const update = (scope: string, fn: (s: PunchScope) => PunchScope) => commit(scopes.map((s) => (s.scope === scope ? fn(s) : s)));

  const addItem = (scope: string) => {
    const text = (newItem[scope] ?? "").trim();
    if (!text) return;
    update(scope, (s) => ({ ...s, items: [...s.items, { id: newPunchId(), text, doneAt: null }] }));
    setNewItem((m) => ({ ...m, [scope]: "" }));
  };
  const completeWalkthrough = (scope: string) => {
    const last = scopes.filter((s) => s.scope !== scope).every((s) => s.walkthroughDoneAt);
    const go = () => update(scope, (s) => ({ ...s, walkthroughDoneAt: new Date().toISOString() }));
    if (!last) return go();
    confirmAction({
      id: "final-walkthrough", title: "Complete the final walkthrough?", destructive: false,
      description: "Every scope will be signed off, so the job closes out and the client joins the Google Reviews \"Ready to ask\" list.",
      confirmLabel: "Complete & close out", onConfirm: go,
    });
  };
  const removeScope = (s: PunchScope) => {
    if (scopes.length <= 1) return toast({ title: "Keep at least one scope", description: "A walkthrough needs one section." });
    const go = () => commit(scopes.filter((x) => x.scope !== s.scope));
    if (!s.items.length && !s.walkthroughDoneAt) return go();
    confirmAction({ id: "remove-punch-scope", title: `Remove the ${s.label} section?`, description: "Its punch-list notes go with it. Photos stay in the library.", confirmLabel: "Remove section", onConfirm: go });
  };
  const addScope = () => {
    const label = newScope.trim();
    if (!label) return;
    if (scopes.some((s) => s.label.toLowerCase() === label.toLowerCase())) return toast({ title: `${label} is already a section` });
    commit([...scopes, { scope: "", label, items: [], walkthroughDoneAt: null }]);
    setNewScope(""); setAddingScope(false);
  };
  const uploadPhotos = async (scope: string, files: FileList) => {
    setUploading(scope);
    let ok = 0; const reasons = new Set<string>();
    for (const f of Array.from(files).slice(0, 20)) {
      try { await uploadFile("/api/crm/attachments", f, { kind: "photo", refId: customerId, stage: "punchlist", scope }); ok++; }
      catch (e: any) { reasons.add(`${f.name}: ${String(e?.message || "upload failed")}`); }
    }
    setUploading(null);
    queryClient.invalidateQueries({ queryKey: photosQk });
    toast(reasons.size ? { title: `${ok} uploaded, ${reasons.size} failed`, description: Array.from(reasons).slice(0, 3).join(" · "), variant: "destructive" }
      : { title: `${ok} punch-list photo${ok === 1 ? "" : "s"} added`, description: "The client can see them in their portal too." });
  };
  const photosOf = (scope: string) => (photos ?? []).filter((p: any) => parsePunchPhotoName(String(p.fileName ?? ""))?.scope === scope);
  const src = (p: any) => (String(p.mime).startsWith("image/") && !/hei[cf]/.test(p.mime) ? `${p.url}?inline=1` : null);

  const progress = openWalkthroughs(scopes);
  return (
    <div className="mt-3 rounded-lg border p-3" data-testid="punch-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Punch list & final walkthrough</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scopes.length && !progress.open ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`} data-testid="punch-progress">
          {isLoading ? "Loading…" : `${progress.total - progress.open} of ${progress.total} walkthrough${progress.total === 1 ? "" : "s"} complete`}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">One section per scope of the approved work. Notes and photos here show in the client's portal; completing every walkthrough closes the job out.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {scopes.map((s) => {
          const done = !!s.walkthroughDoneAt;
          const mine = photosOf(s.scope);
          return (
            <div key={s.scope || s.label} className={`rounded-lg border p-3 ${done ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "bg-background"}`} data-testid={`punch-scope-${s.scope}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{s.label}</p>
                {canEdit && !done && (
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeScope(s)} aria-label={`Remove ${s.label}`} title="Remove this section" data-testid={`button-remove-scope-${s.scope}`}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-1" data-testid={`punch-items-${s.scope}`}>
                {s.items.map((it) => (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={!!it.doneAt} disabled={!canEdit || done} aria-label={`Done: ${it.text}`} data-testid={`checkbox-punch-${it.id}`}
                      onChange={(e) => update(s.scope, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, doneAt: e.target.checked ? new Date().toISOString() : null } : y)) }))} />
                    <span className={`flex-1 ${it.doneAt ? "text-muted-foreground line-through" : ""}`}>{it.text}</span>
                    {canEdit && !done && (
                      <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove: ${it.text}`} data-testid={`button-remove-punch-${it.id}`}
                        onClick={() => update(s.scope, (x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
                {!s.items.length && <li className="text-xs text-muted-foreground">No punch-list items yet.</li>}
              </ul>
              {canEdit && !done && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addItem(s.scope); }}>
                  <Input value={newItem[s.scope] ?? ""} onChange={(e) => setNewItem((m) => ({ ...m, [s.scope]: e.target.value }))} placeholder="Add a punch-list item…" className="h-8 text-sm" maxLength={500} aria-label={`New ${s.label} item`} data-testid={`input-punch-item-${s.scope}`} />
                  <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0" disabled={!(newItem[s.scope] ?? "").trim()} data-testid={`button-add-punch-item-${s.scope}`}><Plus className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only sm:not-sr-only sm:ml-1">Add</span></Button>
                </form>
              )}
              {(mine.length > 0 || canEdit) && (
                <div className="mt-2">
                  {mine.length > 0 && (
                    <div className="mb-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5" data-testid={`punch-photos-${s.scope}`}>
                      {mine.map((p: any, i: number) => (
                        <button type="button" key={p.id} onClick={() => setViewing({ scope: s.scope, index: i })} aria-label={`Open ${parsePunchPhotoName(p.fileName)?.displayName ?? p.fileName}`}
                          className="block w-full overflow-hidden rounded-md border bg-muted/30 transition-colors hover:border-primary/40">
                          {src(p) ? <img src={src(p)!} alt="" className="h-14 w-full object-cover" /> : <div className="flex h-14 items-center justify-center text-xs text-muted-foreground">photo</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <>
                      <input ref={(el) => { fileRefs.current[s.scope] = el; }} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" multiple className="hidden" data-testid={`input-punch-photos-${s.scope}`}
                        onChange={(e) => { if (e.target.files?.length) uploadPhotos(s.scope, e.target.files); e.target.value = ""; }} />
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => fileRefs.current[s.scope]?.click()} disabled={uploading === s.scope} data-testid={`button-punch-photos-${s.scope}`}>
                        {uploading === s.scope ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Add photos
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="mt-2 border-t pt-2">
                {done ? (
                  <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" data-testid={`walkthrough-done-${s.scope}`}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Walkthrough complete · {day(s.walkthroughDoneAt)}{s.walkthroughDoneBy ? ` by ${s.walkthroughDoneBy}` : ""}
                    {canEdit && <button type="button" className="ml-auto inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground" onClick={() => update(s.scope, (x) => ({ ...x, walkthroughDoneAt: null, walkthroughDoneBy: null }))} data-testid={`button-walkthrough-undo-${s.scope}`}><RotateCcw className="h-3 w-3" aria-hidden="true" />Undo</button>}
                  </p>
                ) : canEdit ? (
                  <Button type="button" size="sm" className="h-8 w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => completeWalkthrough(s.scope)} disabled={save.isPending} data-testid={`button-walkthrough-complete-${s.scope}`}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Walkthrough complete
                  </Button>
                ) : <p className="text-xs text-muted-foreground">Walkthrough pending.</p>}
              </div>
            </div>
          );
        })}
      </div>
      {canEdit && (
        addingScope ? (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addScope(); }}>
            <Input autoFocus value={newScope} onChange={(e) => setNewScope(e.target.value)} placeholder="Scope name, e.g. Gutters" className="h-8 text-sm" maxLength={60} aria-label="New scope" data-testid="input-new-scope" />
            <Button type="submit" size="sm" className="h-8" disabled={!newScope.trim()} data-testid="button-add-scope">Add scope</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setAddingScope(false); setNewScope(""); }}>Cancel</Button>
          </form>
        ) : (
          <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setAddingScope(true)} data-testid="button-new-scope">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />Add a scope
          </button>
        )
      )}
      {viewing && (() => {
        const list = photosOf(viewing.scope);
        return list.length ? (
          <PhotoViewer index={Math.min(viewing.index, list.length - 1)} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)}
            photos={list.map((p: any) => ({ id: p.id, name: parsePunchPhotoName(p.fileName)?.displayName ?? p.fileName, downloadUrl: p.downloadUrl, label: "Punch list", src: src(p) }))} />
        ) : null;
      })()}
    </div>
  );
}

/**
 * The client page's tracker as a toggle: a click moves the client's current project (newest non-cancelled) to that
 * stage through the regular project routes (permissions, activity log and pipeline all apply); with no project yet,
 * one is created from the won estimate. Job Scheduled without a visit on the calendar opens the schedule dialog
 * instead. Closed out asks first (naming any walkthroughs still open) and offers the closing text, sent like any
 * CRM text (texting setup, STOP opt-outs, the monthly allowance and the client timeline all apply).
 */
export function JobStageControl({
  customer, estimates, projects, appointments = [], companyName, canEdit, measured = false, canSeePrices = false, canAttach = false,
  celebrations = true, flow = DEFAULT_JOB_FLOW, onSchedule,
}: {
  customer: { id: string; displayName: string; firstName?: string | null; phone?: string | null };
  estimates: SubmittedEstimate[];
  projects: { id: string; status?: string | null; name?: string | null; createdAt?: string | null; stageKey?: string | null }[];
  /** The account's phases (Settings → Job flow). */
  flow?: JobFlow;
  /** This client's calendar visits — the scheduled start and the Job Scheduled gate. */
  appointments?: StageAppointment[];
  companyName: string;
  canEdit: boolean;
  /** The client has a HOVER measurement: Bid at the very least. */
  measured?: boolean;
  canSeePrices?: boolean;
  /** May upload / replace the signed contract (manageCustomers). */
  canAttach?: boolean;
  /** Confetti on close-out (Settings → Celebrations). */
  celebrations?: boolean;
  /** Opens the client page's Schedule-appointment dialog, prefilled for this project. */
  onSchedule?: (projectId: string | null) => void;
}) {
  const { toast } = useToast();
  const stage = jobStageOf({ estimates, projects, measured });
  const project = currentProject(projects);
  const current = currentPhaseKey(flow, stage, project?.stageKey);
  const appt = pickAppointment(appointments, project?.id);
  const first = customer.firstName?.trim() || customer.displayName.split(/\s+/)[0];
  const jobName = project?.name?.trim() || estimates.find((e) => e.status === "approved")?.title?.trim() || "project";
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState("");
  const [sendText, setSendText] = useState(true);
  const [party, setParty] = useState(false);
  const [scopes, setScopes] = useState<PunchScope[]>([]);
  const celebrate = useCallback(() => { if (celebrations) setParty(true); }, [celebrations]);
  const endParty = useCallback(() => setParty(false), []);

  const move = useMutation({
    mutationFn: async ({ to, message }: { to: FlowPhase; message?: string }) => {
      const newName = jobName === "project" ? `${customer.displayName} job` : jobName;
      if (!to.builtin) {
        // A custom phase: stored beside the status, which stays as it is (the built-in anchors keep their meaning).
        if (project) await apiRequest("PATCH", `/api/crm/projects/${project.id}`, { stageKey: to.key });
        else await apiRequest("POST", "/api/crm/projects", { customerId: customer.id, name: newName, status: anchorStatusBefore(flow, to.key), stageKey: to.key });
        return { to, texted: null as string | null };
      }
      const status = STAGE_PROJECT_STATUS[to.builtin];
      // Never knock an invoiced/paid job back to "complete": it is already Closed out.
      if (project && stageOfProjectStatus(project.status) !== to.builtin) {
        await apiRequest("PATCH", `/api/crm/projects/${project.id}`, { status });
      } else if (project && project.stageKey) {
        // Same status, but the job sat at a custom phase: back to the built-in one.
        await apiRequest("PATCH", `/api/crm/projects/${project.id}`, { stageKey: null });
      } else if (!project) {
        await apiRequest("POST", "/api/crm/projects", { customerId: customer.id, name: newName, status });
      }
      let texted: string | null = null;
      if (message) {
        try {
          await apiRequest("POST", "/api/crm/messages", { customerId: customer.id, channel: "text", body: message });
          texted = "sent";
        } catch (e) { texted = apiErrorMessage(e); }
      }
      return { to, texted };
    },
    onSuccess: ({ to, texted }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customer.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/attention"] });
      setClosing(false);
      if (to.builtin === "closed_out") celebrate();
      toast({
        title: `Job moved to ${to.label}`,
        description: texted === "sent" ? `Closing text sent to ${customer.displayName}.` : texted ? `The text was not sent: ${texted}` : undefined,
        variant: texted && texted !== "sent" ? "destructive" : undefined,
      });
    },
    onError: (e) => toast({ title: "Couldn't move the job", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const pick = (to: FlowPhase) => {
    if (to.builtin === "closed_out") {
      setText(`Hi ${first}, your ${jobName} is officially closed out. Thank you for choosing us — we really appreciated working with you!`);
      setSendText(!!customer.phone);
      setClosing(true);
      return;
    }
    // Job Scheduled means a visit on the calendar: without one, book it (the server moves the stage on its own).
    if (to.builtin === "job_scheduled" && !appt && onSchedule) {
      onSchedule(project?.id ?? null);
      return;
    }
    move.mutate({ to });
  };
  const closedOutPhase = flow.phases.find((p) => p.builtin === "closed_out")!;

  const walk = openWalkthroughs(scopes);
  const showPunch = !!project && stageIndex(stage) >= stageIndex("job_scheduled");
  const scheduledOn = appt && stageIndex(stage) >= stageIndex("approved") && stageIndex(stage) < stageIndex("closed_out");
  const needsCall = stage === "approved" && !appt;

  return (
    <>
      <JobStageTracker current={current} flow={flow} onPick={canEdit ? pick : undefined} busy={move.isPending} />
      {canEdit && <p className="mt-2 text-xs text-muted-foreground">Tap a phase to move the job — it also moves on its own when a bid is sent or approved, a visit goes on the calendar or an invoice goes out. {closedOutPhase.label} puts the client on the Google Reviews list.{flow.phases.length > 6 ? " Add or change phases in Settings → Job flow." : ""}</p>}

      {needsCall && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="stage-reminder-schedule">
          <PhoneCall className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b>Approved</b> — call {first} to schedule the start date{customer.phone ? <> · <a href={`tel:${customer.phone}`} className="font-medium text-primary hover:underline">{customer.phone}</a></> : null}
          </span>
          {canEdit && onSchedule && (
            <Button size="sm" className="h-8" onClick={() => onSchedule(project?.id ?? null)} data-testid="button-stage-schedule-now">
              <CalendarDays className="mr-1.5 h-4 w-4" aria-hidden="true" />Schedule now
            </Button>
          )}
        </div>
      )}
      {scheduledOn && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm" data-testid="stage-scheduled">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b>{new Date(appt.startsAt).getTime() >= Date.now() ? "Scheduled" : "Was scheduled"}</b> · {dayTime(appt.startsAt)}{appt.title ? ` — ${appt.title}` : ""}
          </span>
          <Link href={`/crm/schedule?date=${isoDay(appt.startsAt)}`} className="font-medium text-primary hover:underline" data-testid="link-stage-calendar">View on the calendar</Link>
        </div>
      )}

      <SubmittedBid estimates={estimates} stage={stage} canSeePrices={canSeePrices} canAttach={canAttach} />
      {showPunch && <PunchListBlock projectId={project.id} customerId={customer.id} canEdit={canEdit} onClosedOut={celebrate} onScopes={setScopes} />}

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent data-testid="dialog-close-out">
          <DialogHeader>
            <DialogTitle>Close out {customer.displayName}'s job?</DialogTitle>
            <DialogDescription>
              {walk.open > 0 ? <><b>{walk.open} of {walk.total} walkthrough{walk.total === 1 ? "" : "s"} not done</b> — close out anyway? </> : null}
              The job moves to <b>{closedOutPhase.label}</b> and the client joins the Google Reviews "Ready to ask" list.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={sendText} disabled={!customer.phone} onChange={(e) => setSendText(e.target.checked)} data-testid="checkbox-close-out-text" />
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {customer.phone ? `Text the client (${customer.phone})` : "No phone number on file — no text will be sent"}
          </label>
          {sendText && (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={600} aria-label="Closing text" data-testid="input-close-out-text" />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(false)}>Cancel</Button>
            <Button onClick={() => move.mutate({ to: closedOutPhase, message: sendText && text.trim() ? text.trim() : undefined })}
              disabled={move.isPending} data-testid="button-close-out-confirm">
              {move.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sendText ? "Close out & send text" : walk.open > 0 ? "Close out anyway" : "Close out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {party && <ConfettiCelebration subtitle={`${customer.displayName}'s ${jobName} — nice work.`} onDone={endParty} />}
    </>
  );
}
