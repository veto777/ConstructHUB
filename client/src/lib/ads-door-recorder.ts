/** Record every door visit, including rejected/owner visits. Only the server's
 * verified-Google marker disables recording. Full snapshots use normal fetch. */
const DOORS = ["/googleads-features", "/googleads-crm", "/googleads-pricing"];
const MAX_BYTES = 10 * 1024 * 1024;
type DoorEvent = { type: number; timestamp: number; data: unknown };
let started = false;
export async function startAdsDoorRecorder(): Promise<void> {
  const door = window.location.pathname;
  if (started || !DOORS.includes(door) || document.querySelector('meta[name="ads-door-recording"][content="off"]')) return;
  started = true;
  try {
    const { record } = await import("rrweb");
    const sessionId = crypto.randomUUID();
    let queue: DoorEvent[] = [], bytes = 0, sequence = 0, sending = false, snapshot = false, stopped = false;
    let metadata: DoorEvent | undefined;
    let batch: { body: string; count: number } | undefined;
    let stop: (() => void) | undefined;
    const size = (value: string) => new TextEncoder().encode(value).length;
    let timer: ReturnType<typeof setInterval>;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = () => {
      stopped = true; stop?.(); clearInterval(timer); clearTimeout(deadline);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      void flush(false);
    };
    async function flush(leaving = false): Promise<void> {
      if (sending || !queue.length) return;
      if (!batch) {
        const events = queue.slice(0, 10000);
        batch = { body: JSON.stringify({ sessionId, door, events, sequence }), count: events.length };
      }
      const { body, count } = batch;
      // The initial snapshot ALWAYS goes immediately through normal fetch,
      // irrespective of size. Serialize requests so deltas cannot overtake it.
      const keepalive = leaving && sequence > 0 && size(body) < 60 * 1024;
      sending = true;
      let accepted = false;
      try {
        const res = await fetch("/api/ads-lp/rr", {
          method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive,
        });
        if (res.ok) { queue.splice(0, count); sequence++; batch = undefined; accepted = true; }
        else if ([400, 409, 413].includes(res.status)) { queue = []; batch = undefined; finish(); }
      } catch { /* retain the same sequence for the next tick; server deduplicates retries */ }
      finally { sending = false; }
      if (stopped && accepted && queue.length) void flush(false);
    }
    const hidden = () => { if (document.visibilityState === "hidden") void flush(true); };
    const leaving = () => { void flush(true); };
    timer = setInterval(() => void flush(), 5000);
    deadline = setTimeout(finish, 30 * 60 * 1000);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    stop = record({
      maskAllInputs: true,
      emit(event) {
        if (stopped) return;
        // rrweb emits metadata before the full snapshot. The upload protocol
        // starts at type 2, so a session is always independently replayable.
        if (!snapshot && event.type !== 2) {
          if (event.type === 4) metadata = event;
          return;
        }
        const length = size(JSON.stringify(event)) + 1;
        if (bytes + length + 2 > MAX_BYTES) { finish(); return; }
        bytes += length;
        queue.push(event);
        if (!snapshot) {
          snapshot = true;
          // Preserve rrweb's viewport metadata while keeping type 2 first.
          if (metadata) {
            const meta = { ...metadata, timestamp: event.timestamp };
            bytes += size(JSON.stringify(meta)) + 1;
            queue.push(meta);
          }
          void flush();
        }
      },
    });
    if (stopped) stop?.();
  } catch { /* unavailable recorder must not break the landing page */ }
}
