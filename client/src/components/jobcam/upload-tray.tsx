import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { useJobcamQueue } from "./use-queue";
import { clearFinished, removeUpload, retryUpload } from "@/lib/jobcam-queue";
import { formatBytes } from "@/lib/jobcam-api";
import { cn } from "@/lib/utils";

/**
 * The queue, visible wherever uploads happen: progress per item, the server's
 * processing state, retry on failure, a clear-done sweep. Items persist in
 * IndexedDB, so this is also the "N waiting" banner after a lost connection.
 */
export function UploadTray({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const items = useJobcamQueue();
  if (!items.length) return null;
  const waiting = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  const processing = items.filter((i) => i.status === "processing").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const done = items.filter((i) => i.status === "done").length;
  const storageFull = items.some((i) => i.status === "failed" && i.errorCode === "storage_full");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <section data-testid="jobcam-upload-tray"
      className={cn("rounded-xl border text-sm", dark ? "border-white/15 bg-black/60 text-white backdrop-blur" : "border-border bg-card")}>
      <header className="flex items-center gap-2 px-3 py-2">
        <Upload className="h-4 w-4 shrink-0 opacity-70" />
        <span className="font-medium">
          {offline ? `${waiting} waiting for a connection` : waiting ? `${waiting} uploading` : storageFull ? `Storage full — ${failed} not uploaded` : processing ? `${processing} processing` : failed ? `${failed} failed` : `${done} uploaded`}
        </span>
        {done > 0 && (
          <button type="button" onClick={() => void clearFinished()} className="ml-auto text-xs opacity-70 hover:opacity-100" data-testid="jobcam-tray-clear">Clear done</button>
        )}
      </header>
      {storageFull && (
        <p className={cn("px-3 pb-2 text-xs", dark ? "text-amber-300" : "text-destructive")} role="alert" data-testid="jobcam-tray-storage-full">
          These are kept on this device. Free up space or get more storage, then tap retry.
        </p>
      )}
      {!compact && (
        <ul className="max-h-48 overflow-y-auto divide-y divide-border/40 border-t border-border/40">
          {items.slice().reverse().slice(0, 30).map((it) => (
            <li key={it.id} className="flex items-center gap-2 px-3 py-1.5" data-testid={`jobcam-tray-item-${it.id}`}>
              {it.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : it.status === "failed" ? <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                : <Loader2 className={cn("h-4 w-4 shrink-0 animate-spin", it.status === "queued" && "opacity-40")} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="truncate">{it.fileName}</span>
                  <span className="opacity-60 text-xs shrink-0">{formatBytes(it.bytes)}</span>
                </div>
                {it.status === "failed" && it.error && <div className={cn("text-xs text-destructive", it.errorCode ? "whitespace-normal" : "truncate")}>{it.error}</div>}
                {(it.status === "uploading" || it.status === "queued") && (
                  <div className="mt-1 h-1 rounded-full bg-current/15 overflow-hidden"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>
                )}
                {it.status === "processing" && <div className="text-xs opacity-60">Uploaded — making thumbnails…</div>}
              </div>
              {it.status === "failed" && (
                <button type="button" onClick={() => void retryUpload(it.id)} className="p-1 opacity-70 hover:opacity-100" aria-label="Retry" data-testid={`jobcam-tray-retry-${it.id}`}><RotateCcw className="h-4 w-4" /></button>
              )}
              {it.status !== "uploading" && (
                <button type="button" onClick={() => void removeUpload(it.id)} className="p-1 opacity-70 hover:opacity-100" aria-label="Remove" data-testid={`jobcam-tray-remove-${it.id}`}><Trash2 className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
