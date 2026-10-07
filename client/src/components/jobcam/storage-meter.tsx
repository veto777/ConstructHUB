/**
 * JobCam storage meter: "4.2 of 5 GB" with a bar; a quiet note from 80%; at
 * the limit, "Storage full", the next size and "Request more storage".
 *
 * Larger sizes have no price yet (shared/jobcam-storage.ts), so there is
 * nothing to buy here and no dollar amount: the button records a request that
 * ConstructHUB answers by hand.
 */
import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HardDrive, Loader2 } from "lucide-react";
import { GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { jobcamError, jobcamFetch, JOBCAM_USAGE_KEY, type JobcamUsageInfo } from "@/lib/jobcam-api";
import { onUploadRefused } from "@/lib/jobcam-queue";
import { formatJobcamGb, formatJobcamTier, formatJobcamUsage, jobcamStorageState } from "@shared/jobcam-storage";
import { cn } from "@/lib/utils";

export function useJobcamStorage(enabled = true) {
  const q = useQuery<JobcamUsageInfo>({ queryKey: [JOBCAM_USAGE_KEY], enabled, retry: false, staleTime: 30_000 });
  // The queue hearing "storage full" from the server is the freshest news there is.
  useEffect(() => onUploadRefused(() => { void queryClient.invalidateQueries({ queryKey: [JOBCAM_USAGE_KEY] }); }), []);
  return q;
}

/** "Storage full" + next size + the request button — used in the meter and wherever the camera would be. */
export function StorageFullNotice({ usage, dark = false, className }: { usage: JobcamUsageInfo; dark?: boolean; className?: string }) {
  const { toast } = useToast();
  const request = useMutation({
    mutationFn: () => jobcamFetch<{ ok: true; existed: boolean }>("/api/crm/jobcam/storage-request", { method: "POST", json: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [JOBCAM_USAGE_KEY] });
      toast({ title: "Request sent", description: "ConstructHUB will be in touch about more JobCam storage." });
    },
    onError: (e) => toast({ title: "Couldn't send the request", description: jobcamError(e), variant: "destructive" }),
  });
  const over = usage.bytes > usage.limitBytes;
  return (
    <div className={cn("space-y-2", className)} data-testid="jobcam-storage-full">
      <p className={cn("text-sm font-semibold", dark ? "text-amber-300" : "text-destructive")} role="alert">Storage full</p>
      <p className={cn("text-xs", dark ? "text-white/70" : "text-muted-foreground")}>
        {over
          ? `You're using ${formatJobcamGb(usage.bytes)} GB and this workspace has ${formatJobcamTier(usage.tierGb)}. Nothing is deleted, but new photos and videos wait until you're under the limit or get more storage.`
          : `New photos and videos can't be uploaded until you delete some or get more storage. Shots you take stay on this device.`}
        {usage.nextTierGb ? <> <span className={cn("font-medium", dark ? "text-white" : "text-foreground")} data-testid="jobcam-storage-next">Next size: {formatJobcamTier(usage.nextTierGb)}.</span></> : " You're on the largest size."}
      </p>
      {usage.storageRequest ? (
        <p className={cn("text-xs font-medium", dark ? "text-white" : "text-foreground")} data-testid="jobcam-storage-requested">
          More storage requested {new Date(usage.storageRequest.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — we'll be in touch.
        </p>
      ) : (
        <GooglePill size="sm" variant="solid" icon={request.isPending ? Loader2 : HardDrive} label="Request more storage" disabled={request.isPending}
          onClick={() => request.mutate()} testId="jobcam-storage-request" />
      )}
    </div>
  );
}

export function StorageMeter({ className }: { className?: string }) {
  const { data: usage } = useJobcamStorage();
  if (!usage || !usage.limitBytes) return null;
  const state = jobcamStorageState(usage.bytes, usage.tierGb, usage.pendingBytes);
  const full = usage.full;
  const pct = Math.round(state.ratio * 100);
  const leftBytes = Math.max(0, usage.limitBytes - usage.bytes);
  return (
    <div className={cn("rounded-xl border border-border bg-card px-3 py-2.5 space-y-2", className)} data-testid="jobcam-storage-meter">
      <div className="flex items-center gap-2 text-sm">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Storage</span>
        <span className={cn("ml-auto tabular-nums", full ? "text-destructive font-medium" : "text-muted-foreground")} data-testid="jobcam-storage-label">
          {formatJobcamUsage(usage.bytes, usage.tierGb)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="JobCam storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn("h-full rounded-full", full ? "bg-destructive" : state.warn ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.max(pct, usage.bytes > 0 ? 2 : 0)}%` }} />
      </div>
      {full ? <StorageFullNotice usage={usage} />
        : state.warn ? (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="jobcam-storage-warn">
            Almost full — {formatJobcamGb(leftBytes)} GB left.{usage.nextTierGb ? ` Next size: ${formatJobcamTier(usage.nextTierGb)}.` : ""}
          </p>
        ) : null}
    </div>
  );
}
