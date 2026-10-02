/**
 * Browser errors → the issue desk. client/src/lib/report-client-errors.ts
 * posts window.onerror / unhandledrejection here (fetch keepalive, same origin).
 *
 *   POST /api/ops/client-error  { kind, message, stack?, source?, line?, col?, path? }
 *     → 202 { recorded: true } | 202 { recorded: false, reason } | 429 | 403 | 400
 *
 * Anonymous on purpose (a signed-out visitor's broken page matters too), so:
 *   - the body is capped (CLIENT_ERROR_BODY_LIMIT, parsed before the app's
 *     big JSON parser in server/index.ts) and every field is cut to size;
 *   - per-IP and global rate limits (in memory: one process serves the app);
 *   - a cross-site request (Sec-Fetch-Site other than same-origin/none) is refused;
 *   - no PII: no user id, no query strings, token-like path segments replaced,
 *     the message and stack scrubbed (emails/phones masked), the user agent
 *     reduced to browser + OS;
 *   - noise is dropped: browser extensions, ResizeObserver loop warnings,
 *     opaque cross-origin "Script error.", network blips and known injected-script errors.
 */
import type { Express, Request, Response } from "express";
import { recordIssue, normalizeForKey, normalizePath, type IssueInput } from "./issues";
import { scrubText } from "./scrub";

export const CLIENT_ERROR_PATH = "/api/ops/client-error";
export const CLIENT_ERROR_BODY_LIMIT = "8kb";

const EXTENSION_RE = /\b(?:chrome|moz|safari|safari-web|ms-browser|edge)-extension:\/\/|webkit-masked-url:|\bextension:\/\//i;
const NOISE_MESSAGES: RegExp[] = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Non-Error promise rejection captured/i,
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed|The network connection was lost\.?)$/i,
  /^(AbortError: )?The (operation|user) (was|aborted)/i,
  /\b(__gCrWeb|__firefox__|instantSearchSDKJSBridgeClearHighlight|ZiteReader|jigsaw is not defined|ComboSearch is not defined|atomicFindClose|conduitPage|_avast_submit|ucapi|vid_mate_check)\b/,
  /^cancelled$|^canceled$/i,
];

/** Why a report is dropped, or null to keep it. */
export function clientErrorNoise(body: { message?: unknown; stack?: unknown; source?: unknown }): string | null {
  const message = String(body.message ?? "").trim();
  const stack = String(body.stack ?? "");
  const source = String(body.source ?? "");
  if (!message && !stack) return "empty";
  if (EXTENSION_RE.test(source) || EXTENSION_RE.test(stack)) return "extension";
  if (NOISE_MESSAGES.some((re) => re.test(message))) return "noise";
  return null;
}

/** "Chrome 129 · Android · mobile" — enough to reproduce, nothing that identifies a person. */
export function summarizeUserAgent(ua: unknown): string {
  const s = String(ua ?? "");
  if (!s) return "unknown";
  const browser =
    /Edg\/(\d+)/.exec(s) ? `Edge ${/Edg\/(\d+)/.exec(s)![1]}` :
    /OPR\/(\d+)/.exec(s) ? `Opera ${/OPR\/(\d+)/.exec(s)![1]}` :
    /SamsungBrowser\/(\d+)/.exec(s) ? `Samsung Internet ${/SamsungBrowser\/(\d+)/.exec(s)![1]}` :
    /Firefox\/(\d+)/.exec(s) ? `Firefox ${/Firefox\/(\d+)/.exec(s)![1]}` :
    /CriOS\/(\d+)/.exec(s) ? `Chrome iOS ${/CriOS\/(\d+)/.exec(s)![1]}` :
    /Chrome\/(\d+)/.exec(s) ? `Chrome ${/Chrome\/(\d+)/.exec(s)![1]}` :
    /Version\/(\d+).*Safari/.exec(s) ? `Safari ${/Version\/(\d+).*Safari/.exec(s)![1]}` : "other";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iPod/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "other";
  return `${browser} · ${os}${/Mobi/.test(s) ? " · mobile" : ""}`;
}

/** A bundle URL without the origin and the build hash: "/assets/index.js". */
function stableFile(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/-[A-Za-z0-9_-]{8}(\.m?js)$/, "$1");
}

/** The top stack frames, origin stripped, each line scrubbed. */
function clientFrames(stack: string, max = 8): string[] {
  return stack.split("\n").map((l) => l.trim()).filter((l) => /^at |@|:\d+:\d+/.test(l))
    .slice(0, max).map((l) => scrubText(l.replace(/https?:\/\/[^/\s)]+/gi, ""), 300));
}

type Limiter = { allow: (key: string, now: number) => boolean };
function windowLimiter(max: number, windowMs: number): Limiter {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return {
    allow(key, now) {
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + windowMs }); return true; }
      if (cur.n >= max) return false;
      cur.n++;
      return true;
    },
  };
}

export type ClientErrorOptions = {
  record?: (input: IssueInput) => Promise<void>;
  /** Reports per IP per window (default 10 per 5 minutes). */
  perIp?: number;
  ipWindowMs?: number;
  /** All reports together per hour (default 300). */
  globalPerHour?: number;
  now?: () => number;
};

export function clientErrorHandler(opts: ClientErrorOptions = {}) {
  const record = opts.record ?? recordIssue;
  const ipLimit = windowLimiter(opts.perIp ?? 10, opts.ipWindowMs ?? 5 * 60_000);
  const globalLimit = windowLimiter(opts.globalPerHour ?? 300, 3_600_000);
  const clock = opts.now ?? Date.now;

  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const site = req.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return res.status(403).json({ recorded: false, reason: "cross_site" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ recorded: false, reason: "invalid" });
    const now = clock();
    if (!ipLimit.allow(String(req.ip || req.socket.remoteAddress || "unknown"), now)) {
      res.setHeader("Retry-After", "300");
      return res.status(429).json({ recorded: false, reason: "rate_limited" });
    }
    const noise = clientErrorNoise(body);
    if (noise) return res.status(202).json({ recorded: false, reason: noise });
    if (!globalLimit.allow("all", now)) return res.status(429).json({ recorded: false, reason: "rate_limited" });

    const kind = body.kind === "unhandledrejection" ? "unhandledrejection" : "error";
    const message = scrubText(String(body.message ?? "").slice(0, 1000), 500);
    const stack = String(body.stack ?? "").slice(0, 4000);
    const source = typeof body.source === "string" ? body.source.slice(0, 500) : "";
    const frames = clientFrames(stack);
    const page = normalizePath(typeof body.path === "string" ? body.path.slice(0, 500) : "");
    const topFile = stableFile(source || (/(https?:\/\/[^\s)]+?):\d+:\d+/.exec(stack)?.[1] ?? ""));
    const chunk = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);

    // Awaited (it never rejects, and is one upsert at most): the browser's keepalive post doesn't wait on anyone.
    await record({
      source: "client",
      severity: chunk ? "warning" : "error",
      // A stale-bundle chunk failure after a deploy is one issue, whatever page it hit.
      key: chunk ? "chunk-load" : `${kind}|${normalizeForKey(message)}|${topFile}`,
      title: chunk ? "Browser could not load a page bundle (stale tab after a deploy?)" : `Browser ${kind === "error" ? "error" : "unhandled rejection"}: ${message.split("\n")[0].slice(0, 140)}`,
      detail: {
        kind, message, page, file: topFile || null,
        line: Number.isFinite(Number(body.line)) ? Number(body.line) : null,
        col: Number.isFinite(Number(body.col)) ? Number(body.col) : null,
        stack: frames, browser: summarizeUserAgent(req.get("user-agent")),
        signedIn: !!(req as any).user,
      },
    });
    return res.status(202).json({ recorded: true });
  };
}

export function registerClientErrorRoute(app: Express, opts: ClientErrorOptions = {}): void {
  app.post(CLIENT_ERROR_PATH, clientErrorHandler(opts));
}
