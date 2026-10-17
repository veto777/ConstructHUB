/**
 * Google Reviews → Review requests, "Ready to ask": every CRM client with a won
 * job who hasn't been asked for a review yet (server/crm/review-pipeline.ts).
 * "Prepare request" opens the composer with the client, the job and their
 * project photos already filled in; sending it takes the client off this list.
 * Accounts that are not on a CRM team see nothing here.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, StatusPill } from "@/components/app-ui";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmPhotoClient } from "@/lib/crm-photos";

export type PipelineItem = {
  customer: CrmPhotoClient;
  jobs: { estimateId: string; number: string | null; title: string; wonAt: string | null; totalCents: number }[];
  wonAt: string | null;
  projectStatus: string | null;
  jobFinished: boolean;
  finishedPhotoCount: number;
  description: string;
  needsEmail: boolean;
  unsubscribed: boolean;
  dismissedAt: string | null;
};
type Pipeline = { ready: PipelineItem[]; dismissed: PipelineItem[]; askedCount: number };

export const PIPELINE_KEY = ["/api/reviews/pipeline"];
const PAGE = 8;

const STAGE: Record<string, string> = {
  scheduled: "Scheduled", in_progress: "In progress", waiting_on_trades: "In progress",
  punch_list: "Punch list", complete: "Finished", invoiced: "Finished", paid: "Finished",
};
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

export function ReviewPipeline({ onPrepare }: { onPrepare: (item: PipelineItem) => void }) {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const { data, isLoading, error } = useQuery<Pipeline, Error>({
    queryKey: PIPELINE_KEY,
    queryFn: async () => {
      const r = await fetch("/api/reviews/pipeline", { credentials: "include" });
      if (r.status === 404 || r.status === 402 || r.status === 403) return { ready: [], dismissed: [], askedCount: 0 };
      if (!r.ok) throw new Error("Couldn't load your won jobs — refresh to try again.");
      return r.json();
    },
    retry: false,
  });
  const dismiss = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => apiRequest(on ? "POST" : "DELETE", `/api/reviews/pipeline/${id}/dismiss`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PIPELINE_KEY }),
    onError: (e) => toast({ title: "Couldn't update the list", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading) return null;
  if (error) return <p className="text-sm text-destructive" role="alert" data-testid="text-pipeline-error">{error.message}</p>;
  if (!data || (!data.ready.length && !data.dismissed.length)) return null;

  const rows = showAll ? data.ready : data.ready.slice(0, PAGE);
  return (
    <Section
      title={<span>Ready to ask <span className="font-normal text-muted-foreground">· {data.ready.length}</span></span>}
      description="Every CRM client with a won job who hasn't been asked for a review yet. Finished jobs first."
      flush testId="section-review-pipeline">
      {data.ready.length ? (
        <ul className="divide-y" data-testid="list-review-pipeline">
          {rows.map((it) => <Row key={it.customer.id} it={it} onPrepare={onPrepare}
            busy={dismiss.isPending && dismiss.variables?.id === it.customer.id}
            onDismiss={() => dismiss.mutate({ id: it.customer.id, on: true })} />)}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">Every won job has been asked. New wins show up here automatically.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
        <span>{data.askedCount} won-job client{data.askedCount === 1 ? "" : "s"} already asked</span>
        <span className="flex gap-3">
          {data.ready.length > PAGE && (
            <button type="button" className="font-medium text-foreground hover:underline" onClick={() => setShowAll(!showAll)} data-testid="button-pipeline-show-all">
              {showAll ? "Show fewer" : `Show all ${data.ready.length}`}
            </button>
          )}
          {data.dismissed.length > 0 && (
            <button type="button" className="hover:underline" onClick={() => setShowDismissed(!showDismissed)} data-testid="button-pipeline-dismissed">
              {showDismissed ? "Hide" : "Show"} {data.dismissed.length} set aside
            </button>
          )}
        </span>
      </div>
      {showDismissed && data.dismissed.length > 0 && (
        <ul className="divide-y border-t bg-muted/30" data-testid="list-review-pipeline-dismissed">
          {data.dismissed.map((it) => (
            <li key={it.customer.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
              <span className="min-w-0 truncate text-sm">{it.customer.name}<span className="text-muted-foreground"> · {it.description || "Won job"}</span></span>
              <Button size="sm" variant="ghost" onClick={() => dismiss.mutate({ id: it.customer.id, on: false })}
                data-testid={`button-pipeline-restore-${it.customer.id}`}>Put back</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Row({ it, onPrepare, onDismiss, busy }: { it: PipelineItem; onPrepare: (it: PipelineItem) => void; onDismiss: () => void; busy: boolean }) {
  const total = it.jobs.reduce((s, j) => s + j.totalCents, 0);
  const stage = it.projectStatus ? STAGE[it.projectStatus] ?? null : null;
  const blocked = it.unsubscribed;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6" data-testid={`row-pipeline-${it.customer.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{it.customer.name}</span>
          {stage && <StatusPill tone={it.jobFinished ? "success" : "neutral"}>{stage}</StatusPill>}
          {it.needsEmail && <StatusPill tone="warning">No email on file</StatusPill>}
          {it.unsubscribed && <StatusPill tone="neutral">Unsubscribed</StatusPill>}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {[it.description || "Won job", total ? money(total) : null, it.wonAt ? `won ${day(it.wonAt)}` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Camera className="h-3 w-3" aria-hidden="true" />
          {it.customer.photoCount ? `${it.customer.photoCount} job photo${it.customer.photoCount === 1 ? "" : "s"}${it.finishedPhotoCount ? ` · ${it.finishedPhotoCount} finished` : ""}` : "No job photos yet"}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy} data-testid={`button-pipeline-dismiss-${it.customer.id}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Not now"}
        </Button>
        <Button size="sm" onClick={() => onPrepare(it)} disabled={blocked} data-testid={`button-pipeline-prepare-${it.customer.id}`}>
          <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Prepare request
        </Button>
      </div>
    </li>
  );
}
