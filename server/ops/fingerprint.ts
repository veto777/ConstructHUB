/**
 * What makes two occurrences "the same issue" (docs/ops/ISSUE-DESK.md →
 * Fingerprints). The fingerprint is sha256(source + key); the key is built
 * ONLY from things that survive a rebuild and a redeploy:
 *
 *   a thrown failure   what + error name + normalized message (+ orgId /
 *   (recordFailure)    locationId when the caller passed them)
 *   an HTTP 5xx        method + route pattern + status + error name + message
 *   a process failure  kind + error name + message
 *   a browser error    kind + normalized message + script name without its
 *                      build hash; every "could not load a bundle" is one issue
 *
 * Never a stack frame: the server ships as one minified bundle, so a frame
 * reads `at wlt (dist/index.cjs:2938:27264)` and both the function name and
 * the position change with every build — with frames in the key, each deploy
 * turned every recurring failure into a brand-new issue. Messages are
 * normalized (ids, numbers, hashes, file paths and their line numbers, hashed
 * asset names become placeholders).
 *
 * Every key here is computed from the SCRUBBED detail that is stored in
 * ops_issues.detail, so `stableKeyForRow` can recompute the key of a stored
 * row exactly — that is what the one-time merge (merge.ts) relies on.
 */
import { createHash } from "node:crypto";

export function issueFingerprint(source: string, key: string): string {
  return createHash("sha256").update(`${source}\u0000${key}`).digest("hex").slice(0, 32);
}

/** A message made stable across occurrences and builds: ids, numbers, addresses, paths and hashed names become placeholders. */
export function normalizeForKey(text: unknown, max = 200): string {
  return String(text ?? "")
    // a URL keeps its path only (the same failure on another host is the same failure)
    .replace(/\b(?:https?|wss?|file):\/\/[^\s/'")\]]*/gi, "")
    // a content-hashed bundle: /assets/schedule-BxK3_9aZ.js → /assets/schedule.js
    .replace(/(\/assets\/[A-Za-z0-9_.@-]*?)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]{2,5})\b/g, "$1$2")
    // a source or bundle path with its position: /srv/app/dist/index.cjs:2938:27264 → index.cjs
    .replace(/(?:[\w.@~-]*\/)+([\w.@-]+\.(?:[cm]?[jt]sx?|json))(?::\d+){0,2}/g, "$1")
    .replace(/\b([\w.@-]+\.(?:[cm]?[jt]sx?)):\d+(?::\d+)?/g, "$1")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    // what scrub.ts leaves behind for an email or a phone number
    .replace(/\S?\*{3}@[A-Za-z0-9.-]+/g, "<email>")
    .replace(/\[phone[^\]]*\]/g, "<phone>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A URL path with its variable segments replaced (/api/crm/estimates/:id), no query string. */
export function normalizePath(path: unknown): string {
  const p = String(path ?? "").split(/[?#]/)[0];
  return p.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ":n";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
    if (/@/.test(seg)) return ":email";
    if (/^[0-9a-f]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg)) return ":token";
    return seg.length > 60 ? ":long" : seg;
  }).join("/").slice(0, 200) || "/";
}

const safeJson = (v: unknown) => { try { return JSON.stringify(v) ?? String(v); } catch { return "[object]"; } };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The identity of an error from its stored facts (scrub.ts errorFacts): name + normalized message. No frames. */
export function errorIdentity(facts: unknown): string {
  if (isRecord(facts) && typeof facts.name === "string" && "message" in facts) {
    return `${facts.name}|${normalizeForKey(facts.message)}`;
  }
  const thrown = isRecord(facts) && "thrown" in facts ? facts.thrown : facts;
  return `thrown|${normalizeForKey(typeof thrown === "string" ? thrown : safeJson(thrown))}`;
}

/** Context that tells two failures of the same job apart for good reason: whose data it was. */
export const STABLE_CONTEXT_KEYS = ["orgId", "locationId"] as const;

function contextPart(detail: Record<string, unknown>): string {
  return STABLE_CONTEXT_KEYS
    .map((k) => {
      // Stored JSON turns a bigint id into a string; "42" and 42 are the same org.
      const v = detail[k];
      return typeof v === "string" || typeof v === "number" ? `|${k}=${String(v).slice(0, 80)}` : "";
    })
    .join("");
}

/** recordFailure: detail = { what, …context, error }. */
export function failureKey(detail: Record<string, unknown>): string {
  return `${normalizeForKey(detail.what)}|${errorIdentity(detail.error)}${contextPart(detail)}`;
}

/** An unhandled 5xx (detail has the error) or a 500 the route answered itself (it has none). */
export function serverErrorKey(detail: Record<string, unknown>): string {
  const head = `${String(detail.method ?? "")} ${String(detail.route ?? "")}|${String(detail.status ?? "")}`;
  return detail.error === undefined || detail.error === null ? `${head}|handled` : `${head}|${errorIdentity(detail.error)}`;
}

/** uncaughtException / unhandledRejection. */
export function processFailureKey(detail: Record<string, unknown>): string {
  return `${String(detail.kind ?? "")}|${errorIdentity(detail.error)}`;
}

/** What browsers say when a (lazy) bundle cannot be loaded — the same list as client/src/lib/stale-build.ts. */
export const CHUNK_LOAD_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError|Unable to preload CSS|Failed to load module script/i;
export const CHUNK_LOAD_KEY = "chunk-load";

/** A bundle URL without the origin, the query and the build hash: "/assets/index.js". */
export function stableFile(url: unknown): string {
  return String(url ?? "").replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]{2,5})$/, "$1");
}

/** A browser report: detail = { kind, message, file, … }. A bundle that would not load is one issue, whatever page it hit. */
export function clientErrorKey(detail: Record<string, unknown>): string {
  const message = String(detail.message ?? "");
  if (CHUNK_LOAD_RE.test(message)) return CHUNK_LOAD_KEY;
  return `${String(detail.kind ?? "error")}|${normalizeForKey(message)}|${stableFile(detail.file)}`;
}

/**
 * The key a stored row would get today, from its scrubbed detail — or null
 * for a row whose key is not derived from its detail (callers that pass their
 * own fixed key: health probes, one-way-audio, …); those were always stable.
 */
export function stableKeyForRow(source: string, detail: unknown): string | null {
  if (!isRecord(detail)) return null;
  if (source === "client") {
    return typeof detail.message === "string" && (detail.kind === "error" || detail.kind === "unhandledrejection") ? clientErrorKey(detail) : null;
  }
  if (typeof detail.what === "string" && isRecord(detail.error)) return failureKey(detail);
  if (source === "server") {
    if (typeof detail.method === "string" && typeof detail.route === "string" && typeof detail.status === "number") return serverErrorKey(detail);
    if ((detail.kind === "uncaughtException" || detail.kind === "unhandledRejection") && isRecord(detail.error)) return processFailureKey(detail);
  }
  return null;
}
