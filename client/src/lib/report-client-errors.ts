/**
 * Browser errors → the issue desk (server/ops/client-errors.ts). Listens to
 * window "error" (what window.onerror sees, without replacing anyone's
 * handler) and "unhandledrejection", and posts a small report: the message,
 * the stack, the script and the page path (no query string, no user data).
 * At most a few distinct reports per page load; a failed post is dropped.
 * The server filters extension noise and scrubs what it keeps.
 *
 * A chunk that cannot be loaded because a deploy replaced it is not reported:
 * the tab reloads once to the new build instead (lib/stale-build.ts). It is
 * reported only when that is not the explanation (same build, or it still
 * fails right after the reload).
 */
import { isChunkLoadMessage, recoverFromStaleBuild } from "./stale-build";

const ENDPOINT = "/api/ops/client-error";
const MAX_REPORTS_PER_PAGE = 5;

let installed = false;
let sent = 0;
const seen = new Set<string>();

type Report = { kind: "error" | "unhandledrejection"; message: string; stack?: string; source?: string; line?: number; col?: number };

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  if (typeof reason === "string") return { message: reason };
  try { return { message: JSON.stringify(reason) ?? String(reason) }; } catch { return { message: String(reason) }; }
}

function send(report: Report, checked = false) {
  if (sent >= MAX_REPORTS_PER_PAGE) return;
  const message = String(report.message ?? "").slice(0, 1000);
  const key = `${report.kind}|${message}`;
  if (!message || seen.has(key)) return;
  if (!checked && isChunkLoadMessage(message)) {
    // Expected after a deploy: reload to the new build, report nothing. Offline is not a fault either.
    void recoverFromStaleBuild().then((outcome) => {
      if (outcome !== "reloading" && outcome !== "offline") send(report, true);
    });
    return;
  }
  seen.add(key);
  sent++;
  const body = JSON.stringify({
    kind: report.kind,
    message,
    stack: report.stack ? String(report.stack).slice(0, 3500) : undefined,
    source: report.source ? String(report.source).slice(0, 300) : undefined,
    line: report.line, col: report.col,
    path: window.location.pathname.slice(0, 300),
  });
  try {
    void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

/** Report an error a component caught itself (lib/lazy-page.tsx). The caller has already ruled out a stale build. */
export function reportClientError(err: unknown): void {
  if (typeof window === "undefined") return;
  const { message, stack } = describe(err);
  send({ kind: "error", message, stack }, true);
}

export function installClientErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    // A failed <img>/<script> load fires a plain Event on the element, not an ErrorEvent: not a code error.
    if (!(ev instanceof ErrorEvent)) return;
    const { message, stack } = ev.error ? describe(ev.error) : { message: ev.message, stack: undefined };
    send({ kind: "error", message: message || ev.message, stack, source: ev.filename, line: ev.lineno, col: ev.colno });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const { message, stack } = describe(ev.reason);
    send({ kind: "unhandledrejection", message, stack });
  });
}
