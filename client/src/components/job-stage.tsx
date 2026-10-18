/**
 * The job stage (shared/job-stage.ts): the big Bid → Approved → In progress → Completed tracker on the CRM client
 * page, and the small colored pill used next to clients in Google Reviews.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, FileCheck, Loader2, MessageSquare, Paperclip } from "lucide-react";
import { uploadFile } from "@/components/client-uploads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { JOB_STAGES, STAGE_PROJECT_STATUS, currentProject, jobStageLabel, jobStageOf, stageOfProjectStatus, type JobStage } from "@shared/job-stage";

const TONE: Record<JobStage, { solid: string; soft: string; text: string }> = {
  bid: { solid: "bg-slate-500", soft: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-200" },
  bid_submitted: { solid: "bg-sky-600", soft: "bg-sky-50 dark:bg-sky-950/50", text: "text-sky-700 dark:text-sky-300" },
  approved: { solid: "bg-blue-600", soft: "bg-blue-50 dark:bg-blue-950/50", text: "text-blue-700 dark:text-blue-300" },
  in_progress: { solid: "bg-amber-500", soft: "bg-amber-50 dark:bg-amber-950/50", text: "text-amber-800 dark:text-amber-300" },
  closed_out: { solid: "bg-emerald-600", soft: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300" },
};

/** The four steps, the current one bold and colored, the earlier ones checked. Two by two on a phone. */
export function JobStageTracker({ stage, testId = "job-stage-tracker", onPick, busy }: {
  stage: JobStage | null; testId?: string;
  /** Makes each step a button that moves the job there. */
  onPick?: (s: JobStage) => void; busy?: boolean;
}) {
  const at = stage ? JOB_STAGES.findIndex((s) => s.key === stage) : -1;
  return (
    <div data-testid={testId} aria-label={`Job stage: ${jobStageLabel(stage) ?? "no job yet"}`}>
      <ol className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-0">
        {JOB_STAGES.map((s, i) => {
          const done = i < at, current = i === at;
          const tone = TONE[s.key];
          return (
            <li key={s.key} className="flex flex-1 items-center" data-testid={`${testId}-${s.key}`} aria-current={current ? "step" : undefined}>
              <button type="button" disabled={!onPick || busy || current} onClick={() => onPick?.(s.key)}
                title={onPick && !current ? `Move the job to ${s.label}` : undefined}
                className={`flex flex-1 items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors disabled:cursor-default ${onPick && !current ? "hover:border-foreground/40" : ""} ${current ? `${tone.soft} border-current ${tone.text}` : done ? "border-transparent bg-muted/60" : "border-dashed border-border bg-background text-muted-foreground"}`}
                data-testid={`button-${testId}-${s.key}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${current || done ? tone.solid : "bg-muted-foreground/30"}`}>
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className={`whitespace-nowrap text-sm ${current ? "font-bold" : done ? "font-semibold text-foreground" : "font-medium"}`}>{s.label}</span>
              </button>
              {i < JOB_STAGES.length - 1 && <span className={`hidden h-0.5 w-4 shrink-0 sm:block ${i < at ? "bg-foreground/40" : "bg-border"}`} aria-hidden="true" />}
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
const APPROVED_OR_LATER = new Set<JobStage>(["approved", "in_progress", "closed_out"]);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

/** The bid that went to the client (the approved one, else the latest sent), and its signed contract on file. */
function pickSubmitted(estimates: SubmittedEstimate[]): SubmittedEstimate | null {
  const main = estimates.filter((e) => e.id && !/change order/i.test(e.title ?? ""));
  const pool = main.length ? main : estimates.filter((e) => e.id);
  const t = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  const approved = pool.filter((e) => e.status === "approved").sort((a, b) => t(b.approvedAt) - t(a.approvedAt))[0];
  if (approved) return approved;
  return pool.filter((e) => e.status === "sent" || e.status === "viewed").sort((a, b) => t(b.sentAt) - t(a.sentAt))[0] ?? null;
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
  const approved = !!stage && APPROVED_OR_LATER.has(stage);
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

/**
 * The client page's tracker as a toggle: a click moves the client's current project (newest non-cancelled) to that
 * stage through the regular project routes (permissions, activity log and pipeline all apply); with no project yet,
 * one is created from the won estimate. Closed out asks first and offers the closing text, sent like any CRM text
 * (texting setup, STOP opt-outs, the monthly allowance and the client timeline all apply).
 */
export function JobStageControl({ customer, estimates, projects, companyName, canEdit, measured = false, canSeePrices = false, canAttach = false }: {
  customer: { id: string; displayName: string; firstName?: string | null; phone?: string | null };
  estimates: SubmittedEstimate[];
  projects: { id: string; status?: string | null; name?: string | null; createdAt?: string | null }[];
  companyName: string;
  canEdit: boolean;
  /** The client has a HOVER measurement: Bid at the very least. */
  measured?: boolean;
  canSeePrices?: boolean;
  /** May upload / replace the signed contract (manageCustomers). */
  canAttach?: boolean;
}) {
  const { toast } = useToast();
  const stage = jobStageOf({ estimates, projects, measured });
  const project = currentProject(projects);
  const first = customer.firstName?.trim() || customer.displayName.split(/\s+/)[0];
  const jobName = project?.name?.trim() || estimates.find((e) => e.status === "approved")?.title?.trim() || "project";
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState("");
  const [sendText, setSendText] = useState(true);

  const move = useMutation({
    mutationFn: async ({ to, message }: { to: JobStage; message?: string }) => {
      const status = STAGE_PROJECT_STATUS[to];
      // Never knock an invoiced/paid job back to "complete": it is already Closed out.
      if (project && stageOfProjectStatus(project.status) !== to) {
        await apiRequest("PATCH", `/api/crm/projects/${project.id}`, { status });
      } else if (!project) {
        await apiRequest("POST", "/api/crm/projects", { customerId: customer.id, name: jobName === "project" ? `${customer.displayName} job` : jobName, status });
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
      setClosing(false);
      toast({
        title: `Job moved to ${jobStageLabel(to)}`,
        description: texted === "sent" ? `Closing text sent to ${customer.displayName}.` : texted ? `The text was not sent: ${texted}` : undefined,
        variant: texted && texted !== "sent" ? "destructive" : undefined,
      });
    },
    onError: (e) => toast({ title: "Couldn't move the job", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const pick = (to: JobStage) => {
    if (to === "closed_out") {
      setText(`Hi ${first}, your ${jobName} is officially closed out. Thank you for choosing us — we really appreciated working with you!`);
      setSendText(!!customer.phone);
      setClosing(true);
      return;
    }
    move.mutate({ to });
  };

  return (
    <>
      <JobStageTracker stage={stage} onPick={canEdit ? pick : undefined} busy={move.isPending} />
      {canEdit && <p className="mt-2 text-xs text-muted-foreground">Tap a stage to move the job. Closed out puts the client on the Google Reviews list.</p>}
      <SubmittedBid estimates={estimates} stage={stage} canSeePrices={canSeePrices} canAttach={canAttach} />
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent data-testid="dialog-close-out">
          <DialogHeader>
            <DialogTitle>Close out {customer.displayName}'s job?</DialogTitle>
            <DialogDescription>The job moves to <b>Closed out</b> and the client joins the Google Reviews "Ready to ask" list.</DialogDescription>
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
            <Button onClick={() => move.mutate({ to: "closed_out", message: sendText && text.trim() ? text.trim() : undefined })}
              disabled={move.isPending} data-testid="button-close-out-confirm">
              {move.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sendText ? "Close out & send text" : "Close out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
