/**
 * Google Reviews → Review requests, "Ready to ask": every CRM client with a won
 * job who hasn't been asked for a review yet (server/crm/review-pipeline.ts).
 * "Prepare request" opens the composer with the client, the job and their
 * project photos already filled in; sending it takes the client off this list.
 * Accounts that are not on a CRM team see nothing here.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, EyeOff, Loader2, Search, Send } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Section, StatusPill } from "@/components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
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
type Pipeline = { ready: PipelineItem[]; dismissed: PipelineItem[]; hidden: PipelineItem[]; askedCount: number };

export const PIPELINE_KEY = ["/api/reviews/pipeline"];
// Collapsed to a few rows; the dropdown shows 10–100 (remembered per browser).
const COLLAPSED = 5;
const SIZES = [10, 25, 50, 100] as const;
const SIZE_KEY = "review-pipeline-size";
// Filters (pure, on the loaded list): what state the job is in, and the trade read from the job titles.
const STATUS_FILTERS = [
  ["all", "All won jobs"], ["finished", "Finished jobs"], ["underway", "Not finished yet"],
  ["photos", "Has job photos"], ["nophotos", "No job photos"], ["noemail", "Missing email"],
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number][0];
const TRADES = [
  ["siding", "Siding", /siding|hardie|lap|shingle|vinyl|panel/i], ["roofing", "Roofing", /roof|gaf|hdz|metal/i],
  ["windows", "Windows", /window|pgt|silverlite|cws/i], ["doors", "Doors", /door/i], ["paint", "Paint", /paint/i],
] as const;
export function matchesPipeline(it: PipelineItem, f: { q: string; status: StatusFilter; trade: string }): boolean {
  const text = [it.customer.name, it.customer.email, it.customer.address, it.description, ...it.jobs.map((j) => j.title)].filter(Boolean).join(" ").toLowerCase();
  if (f.q && !f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
  const photos = it.customer.photoCount;
  if (f.status === "finished" && !it.jobFinished) return false;
  if (f.status === "underway" && it.jobFinished) return false;
  if (f.status === "photos" && !photos) return false;
  if (f.status === "nophotos" && photos) return false;
  if (f.status === "noemail" && !it.needsEmail) return false;
  const trade = TRADES.find((t) => t[0] === f.trade);
  return !trade || it.jobs.some((j) => trade[2].test(j.title));
}

function savedSize(): number {
  try { const n = Number(localStorage.getItem(SIZE_KEY)); return (SIZES as readonly number[]).includes(n) ? n : COLLAPSED; } catch { return COLLAPSED; }
}

const STAGE: Record<string, string> = {
  scheduled: "Scheduled", in_progress: "In progress", waiting_on_trades: "In progress",
  punch_list: "Punch list", complete: "Finished", invoiced: "Finished", paid: "Finished",
};
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

export function ReviewPipeline({ onPrepare }: { onPrepare: (item: PipelineItem) => void }) {
  const { toast } = useToast();
  const [size, setSizeState] = useState(savedSize);
  const setSize = (n: number) => { setSizeState(n); try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* private window */ } };
  const [showDismissed, setShowDismissed] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [trade, setTrade] = useState("all");
  const { data, isLoading, error } = useQuery<Pipeline, Error>({
    queryKey: PIPELINE_KEY,
    queryFn: async () => {
      const r = await fetch("/api/reviews/pipeline", { credentials: "include" });
      if (r.status === 404 || r.status === 402 || r.status === 403) return { ready: [], dismissed: [], hidden: [], askedCount: 0 };
      if (!r.ok) throw new Error("Couldn't load your won jobs — refresh to try again.");
      return r.json();
    },
    retry: false,
  });
  const [showHidden, setShowHidden] = useState(false);
  const [confirmHide, setConfirmHide] = useState<PipelineItem | null>(null);
  const dismiss = useMutation({
    mutationFn: async ({ id, on, kind = "dismiss" }: { id: string; on: boolean; kind?: "dismiss" | "hide"; name?: string }) =>
      apiRequest(on ? "POST" : "DELETE", `/api/reviews/pipeline/${id}/${kind}`),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
      // A misclick is one tap to undo.
      if (v.on) toast({
        title: v.kind === "hide" ? `${v.name ?? "Client"} hidden` : `${v.name ?? "Client"} set aside`,
        description: v.kind === "hide" ? "No review requests will go to them." : "Find them under \"set aside\" at the bottom of the list.",
        action: (
          <ToastAction altText="Undo" onClick={() => dismiss.mutate({ id: v.id, on: false, kind: v.kind })} data-testid="button-pipeline-undo">Undo</ToastAction>
        ),
      });
    },
    onError: (e) => toast({ title: "Couldn't update the list", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading) return null;
  if (error) return <p className="text-sm text-destructive" role="alert" data-testid="text-pipeline-error">{error.message}</p>;
  if (!data || (!data.ready.length && !data.dismissed.length && !data.hidden.length)) return null;

  const filtering = !!q.trim() || status !== "all" || trade !== "all";
  const matched = filtering ? data.ready.filter((it) => matchesPipeline(it, { q: q.trim(), status, trade })) : data.ready;
  const rows = matched.slice(0, size);
  return (
    <Section
      title={<span>Ready to ask <span className="font-normal text-muted-foreground">· {data.ready.length}</span></span>}
      description="Every CRM client with a won job who hasn't been asked for a review yet. Finished jobs first."
      flush testId="section-review-pipeline">
      {(data.ready.length > COLLAPSED || filtering) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 pb-3 sm:px-6" data-testid="pipeline-filters">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, job or address" aria-label="Search won jobs"
              className="h-8 pl-8 text-sm" data-testid="input-pipeline-search" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-auto gap-1 text-sm" aria-label="Filter by job status" data-testid="select-pipeline-status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_FILTERS.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={trade} onValueChange={setTrade}>
            <SelectTrigger className="h-8 w-auto gap-1 text-sm" aria-label="Filter by trade" data-testid="select-pipeline-trade"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All trades</SelectItem>
              {TRADES.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          {filtering && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setQ(""); setStatus("all"); setTrade("all"); }}
              data-testid="button-pipeline-clear-filters">Clear</Button>
          )}
        </div>
      )}
      {data.ready.length && !matched.length ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-6" data-testid="text-pipeline-no-match">No won jobs match these filters.</p>
      ) : data.ready.length ? (
        <ul className="divide-y" data-testid="list-review-pipeline">
          {rows.map((it) => <Row key={it.customer.id} it={it} onPrepare={onPrepare}
            busy={dismiss.isPending && dismiss.variables?.id === it.customer.id}
            onDismiss={() => dismiss.mutate({ id: it.customer.id, on: true, name: it.customer.name })} onHide={() => setConfirmHide(it)} />)}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">Every won job has been asked. New wins show up here automatically.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
        <span>{data.askedCount} won-job client{data.askedCount === 1 ? "" : "s"} already asked</span>
        <span className="flex items-center gap-3">
          {matched.length > COLLAPSED && (
            <label className="flex items-center gap-1.5">
              <span>Showing {rows.length} of {matched.length} ·</span>
              <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
                <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs" aria-label="How many to show" data-testid="select-pipeline-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={String(COLLAPSED)}>Show {COLLAPSED}</SelectItem>
                  {SIZES.map((n) => <SelectItem key={n} value={String(n)}>Show {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          {data.dismissed.length > 0 && (
            <button type="button" className="hover:underline" onClick={() => setShowDismissed(!showDismissed)} data-testid="button-pipeline-dismissed">
              {showDismissed ? "Close" : "Show"} {data.dismissed.length} set aside
            </button>
          )}
          {data.hidden.length > 0 && (
            <button type="button" className="hover:underline" onClick={() => setShowHidden(!showHidden)} data-testid="button-pipeline-hidden">
              {showHidden ? "Close" : "Show"} {data.hidden.length} hidden
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
      {showHidden && data.hidden.length > 0 && (
        <ul className="divide-y border-t bg-muted/30" data-testid="list-review-pipeline-hidden">
          {data.hidden.map((it) => (
            <li key={it.customer.id} className="flex items-center justify-between gap-3 px-4 py-2 sm:px-6">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{it.customer.name}<span className="text-muted-foreground"> · never asked for a review</span></span>
              </span>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => dismiss.mutate({ id: it.customer.id, on: false, kind: "hide" })}
                data-testid={`button-pipeline-unhide-${it.customer.id}`}>Unhide</Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={!!confirmHide} onOpenChange={(o) => { if (!o) setConfirmHide(null); }}>
        <AlertDialogContent data-testid="dialog-pipeline-hide">
          <AlertDialogHeader>
            <AlertDialogTitle>Hide {confirmHide?.customer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave this list for good and no review request, reminder or scheduled send will go to them, even one typed by hand.
              You can unhide them later from "hidden" at the bottom of this list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-pipeline-hide-confirm" onClick={() => {
              if (confirmHide) dismiss.mutate({ id: confirmHide.customer.id, on: true, kind: "hide", name: confirmHide.customer.name });
              setConfirmHide(null);
            }}>Hide client</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function Row({ it, onPrepare, onDismiss, onHide, busy }: {
  it: PipelineItem; onPrepare: (it: PipelineItem) => void; onDismiss: () => void; onHide: () => void; busy: boolean;
}) {
  const total = it.jobs.reduce((s, j) => s + j.totalCents, 0);
  const stage = it.projectStatus ? STAGE[it.projectStatus] ?? null : null;
  const blocked = it.unsubscribed;
  const photos = it.customer.photoCount;
  return (
    <li className="flex items-center gap-3 px-4 py-2 sm:px-6" data-testid={`row-pipeline-${it.customer.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium md:max-w-[45%] md:shrink-0">{it.customer.name}</span>
          {stage && <StatusPill tone={it.jobFinished ? "success" : "neutral"} className="shrink-0">{stage}</StatusPill>}
          {it.needsEmail && <StatusPill tone="warning" className="shrink-0">No email</StatusPill>}
          {it.unsubscribed && <StatusPill tone="neutral" className="shrink-0">Unsubscribed</StatusPill>}
          <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:inline">{it.description || "Won job"}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          <span className="md:hidden">{it.description || "Won job"} · </span>
          {[total ? money(total) : null, it.wonAt ? `won ${day(it.wonAt)}` : null].filter(Boolean).join(" · ")}
          <span className="inline-flex items-center gap-1 pl-2 align-middle"><Camera className="h-3 w-3" aria-hidden="true" />{photos || "no"} photo{photos === 1 ? "" : "s"}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={onHide} disabled={busy}
          title="Never ask this client for a review" data-testid={`button-pipeline-hide-${it.customer.id}`}>
          <EyeOff className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" /><span className="hidden sm:inline">Hide</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onDismiss} disabled={busy} data-testid={`button-pipeline-dismiss-${it.customer.id}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Not now"}
        </Button>
        <Button size="sm" className="ml-2 h-8 px-3 text-xs sm:ml-4" onClick={() => onPrepare(it)} disabled={blocked} data-testid={`button-pipeline-prepare-${it.customer.id}`}>
          <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">Prepare request</span><span className="sm:hidden">Prepare</span>
        </Button>
      </div>
    </li>
  );
}
