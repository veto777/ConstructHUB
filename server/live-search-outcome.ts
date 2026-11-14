// Pure helpers for how a live permit search reports each portal (unit-tested in
// live-search-outcome.test.ts; server/scraper.ts imports them).

// A short, user-facing reason for a failed portal scrape. Browser/launch
// internals (executable paths, call logs) stay in the server log.
export function scrapeFailureReason(message: string | null | undefined): string {
  const first = String(message ?? "").replace(/^Error:\s*/i, "").split("\n")[0].trim();
  if (!first) return "the portal search did not finish";
  if (/browserType\.launch|Executable doesn't exist|Failed to launch/i.test(first)) return "the live-search browser could not start on the server";
  if (/Timeout \d+ms exceeded|timed out/i.test(first)) return "the portal did not respond in time";
  if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(first)) return "the portal could not be reached";
  return first.length > 140 ? `${first.slice(0, 137)}...` : first;
}

// How a live search reports one portal once its adapter has returned. Every
// adapter catches its own failure and returns what it had (usually []), so
// only a scrape job that reached "completed" counts as searched; anything else
// (the adapter recorded an error, or never reported an outcome) is an error,
// with any rows it did collect before failing still counted.
export function liveSearchOutcome(
  resultCount: number,
  progress: { status: string; message: string } | undefined,
): { status: "completed" | "error"; message: string } {
  if (progress?.status === "completed") return { status: "completed", message: `Found ${resultCount} results` };
  const reason = scrapeFailureReason(progress?.status === "error" ? progress.message : null);
  return {
    status: "error",
    message: resultCount > 0 ? `Stopped after ${resultCount} results: ${reason}` : `Not searched: ${reason}`,
  };
}

/**
 * A first-come, first-served set of slots. Live permit searches share one (server/scraper.ts): each search still
 * runs up to four portals at once, but all searches together never hold more than `max` browser contexts, so a burst
 * of searches waits its turn instead of opening hundreds of contexts in the one shared browser (audit 08 #3).
 * Nothing is refused: `run` waits for a free slot, runs the work and frees the slot whatever the outcome.
 */
export function createSlotQueue(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      // A freed slot is handed straight to the next waiter (active stays counted), so the order is kept.
      if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await work();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
    get active() { return active; },
    get waiting() { return waiting.length; },
  };
}
