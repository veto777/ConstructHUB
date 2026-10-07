import { useSyncExternalStore } from "react";
import { queueSnapshot, subscribeQueue, type QueueView } from "@/lib/jobcam-queue";

let last: QueueView[] = [];
let lastKey = "";
function snapshot(): QueueView[] {
  const items = queueSnapshot();
  const key = items.map((i) => `${i.id}:${i.status}:${i.progress.toFixed(2)}:${i.error ?? ""}:${i.errorCode ?? ""}`).join("|");
  if (key !== lastKey) { lastKey = key; last = items; }
  return last;
}

/** The upload queue as React state: every capture page and feed shows the same tray. */
export function useJobcamQueue(): QueueView[] {
  return useSyncExternalStore(subscribeQueue, snapshot, () => last);
}
