import type { Response } from "express";

/**
 * The one error envelope of the public API: { error: { code, message, … } }.
 * `code` is stable and machine-readable; `message` is for humans.
 *
 * The vocabulary is ONE set across every resource (read and write) and the
 * OpenAPI document (components.schemas.Error):
 */
export const API_ERROR_CODES = [
  "unauthorized",        // 401 no / malformed key, or a key presented outside /api/v1
  "invalid_api_key",     // 401 unknown, revoked or expired key
  "insufficient_scope",  // 403 the key lacks read / write
  "validation_error",    // 400 bad path, query or body (issues[])
  "not_found",           // 404 no such endpoint, or not the caller's row
  "rate_limited",        // 429 per-key / per-account requests per minute (Retry-After)
  "quota_exceeded",      // 429 monthly units or a feature allowance used up (Retry-After)
  "plan_required",       // 402 the plan does not include this (requiredPlan)
  "internal_error",      // 500 our fault
] as const;

/** Situation-specific codes a few operations add on top of the base set (documented in openapi.json). */
export const API_EXTRA_ERROR_CODES = [
  "conflict",                  // 409 idempotency key reused with different content, resource not linked / busy
  "scan_not_completed",        // 409 a Site Scan report requested before the crawl finished
  "google_reconnect_required", // 409 Google must be reconnected in the app (never 401: the key itself is fine)
  "google_permission",         // 403 Google denied the operation
  "google_api_disabled",       // 403 the Google API is disabled for the account
  "google_quota",              // 429 Google's own quota (Retry-After)
  "google_unavailable",        // 503 Google did not confirm the operation
  "upstream_unavailable",      // 503 a provider (Blotato, Google) failed; retry later
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number] | (typeof API_EXTRA_ERROR_CODES)[number];

export function apiError(res: Response, status: number, code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error: { code, message, ...extra } });
}

/** The base code for an HTTP status when a thrown error carries none of its own. */
export function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 402) return "plan_required";
  if (status === 403) return "insufficient_scope";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal_error";
  return "validation_error";
}
