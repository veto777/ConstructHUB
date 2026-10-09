/**
 * The request log line (server/index.ts), and which API responses it may echo.
 *
 * 2026-10-09 (reliability review M7/C1): the log used to write every JSON response body — CRM customer lists with
 * names, addresses, emails and phone numbers; SEO reports; backlink lists — into the systemd journal, about 21 MB of
 * the 26.6 MB a day the unit wrote, and the disk the production database lives on filled. The line is now
 *
 *   GET /api/crm/customers 200 in 12ms id=3f9a1c2b
 *
 * method, path (no query string), status, duration and a request id — never a body, never a query string, never an
 * email address or phone number. A response of 500 or more may add one short error message (the body's `message`
 * when it is a string), truncated and scrubbed of addresses and numbers, so the journal still says WHAT failed.
 *
 * Development may opt in to body echoes with LOG_RESPONSE_BODIES=1 (truncated to BODY_ECHO_MAX characters, and still
 * subject to the exclusions below). Default: off, in every environment — the safe setting needs no configuration.
 *
 * Express matches routes case-insensitively ("/api/Hub/chat" reaches the Hub router), so every exclusion here
 * compares a lower-cased path.
 */
import { randomBytes } from "node:crypto";

/** Response bodies that are never captured (Hub replies: guardrails §2/§8; site-scan tokens; domain and mail settings). */
const NEVER_CAPTURED = ["/api/agency", "/api/sitescan", "/api/admin/sitescan", "/api/domains", "/api/mail-alerts", "/api/hub"];
/** Bodies with secrets (QR seeds, recovery codes, signed upload URLs, provider credentials, API keys, account data, transcripts, issue reports). */
const NEVER_LOGGED = [
  "/api/auth/", "/api/gbp/connect", "/api/social", "/api/ads", "/api/cloudflare", "/api/gsc",
  "/api/v1", "/api/account/api-keys", "/api/crm/voice", "/api/voice-internal",
  "/api/admin/issues", "/api/ops-internal", "/api/ops/",
];

/** Site-scan paths carry 64-hex report tokens in the URL; the log shows ":token" instead. */
export function isSiteScanPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.startsWith("/api/agency") || p.startsWith("/api/sitescan") || p.startsWith("/api/admin/sitescan");
}

/** True only when the JSON body of a response to `path` may be written to the request log (and only when echoes are on). */
export function responseBodyLoggable(path: string): boolean {
  const p = path.toLowerCase();
  return !NEVER_CAPTURED.some((prefix) => p.startsWith(prefix)) && !NEVER_LOGGED.some((prefix) => p.startsWith(prefix));
}

/** Longest body echo in development with LOG_RESPONSE_BODIES=1. */
export const BODY_ECHO_MAX = 2_000;
/** Longest error message a 5xx line carries. */
export const ERROR_MESSAGE_MAX = 200;

/** Are response bodies echoed? Never in production; elsewhere only with LOG_RESPONSE_BODIES=1. */
export function bodyEchoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.LOG_RESPONSE_BODIES === "1";
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** 7+ digits with the usual separators: phone numbers, card and account numbers. */
const LONG_NUMBER_RE = /[+(]?\d[\d\s().-]{5,}\d/g;

/** One line of text with addresses and long numbers removed, cut to `max` characters. */
export function scrubForLog(text: string, max = ERROR_MESSAGE_MAX): string {
  const clean = text.replace(/\s+/g, " ").replace(EMAIL_RE, "[email]").replace(LONG_NUMBER_RE, "[number]").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The path as the log shows it: the pathname only (never the query string), site-scan tokens masked. */
export function loggedPath(path: string): string {
  const bare = path.split("?")[0];
  return isSiteScanPath(bare) ? bare.replace(/[a-f0-9]{64}/gi, ":token") : bare;
}

/** The request id the log line carries: the edge's (Cloudflare's cf-ray) or the caller's, else a fresh one. */
export function requestIdFor(headers: Record<string, string | string[] | undefined>): string {
  const given = headers["cf-ray"] ?? headers["x-request-id"];
  const first = Array.isArray(given) ? given[0] : given;
  if (typeof first === "string" && /^[A-Za-z0-9._-]{4,64}$/.test(first)) return first;
  return randomBytes(4).toString("hex");
}

export type RequestLogInput = {
  method: string;
  /** The request path (query string allowed; it is dropped). */
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  /** The JSON body res.json was given, when the route answered with one. */
  body?: unknown;
  env?: NodeJS.ProcessEnv;
};

/**
 * The log line for one request. No body reaches it unless `bodyEchoEnabled` (development opt-in) AND the path is
 * loggable; a 5xx adds the body's string `message`, scrubbed and cut short.
 */
export function formatRequestLogLine(input: RequestLogInput): string {
  const path = loggedPath(input.path);
  let line = `${input.method} ${path} ${input.status} in ${input.durationMs}ms id=${input.requestId}`;
  const body = input.body;
  if (input.status >= 500 && body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    const msg = scrubForLog((body as { message: string }).message);
    if (msg) line += ` :: ${msg}`;
    return line;
  }
  if (body !== undefined && bodyEchoEnabled(input.env) && responseBodyLoggable(path)) {
    let json: string;
    try { json = JSON.stringify(body) ?? String(body); } catch { json = "[unserializable]"; }
    line += ` :: ${json.length > BODY_ECHO_MAX ? `${json.slice(0, BODY_ECHO_MAX)}…(${json.length} chars)` : json}`;
  }
  return line;
}
