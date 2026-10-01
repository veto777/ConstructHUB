/**
 * Per-key request rate limit: a fixed one-minute window held in process
 * memory (the app runs as one process; a restart simply opens a new window).
 * Headers on every authenticated response: X-RateLimit-Limit and
 * X-RateLimit-Remaining; over the limit: 429 rate_limited + Retry-After.
 */
import type { RequestHandler } from "express";
import { apiError } from "./errors";

export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_PER_MINUTE = 60;
const MAX_BUCKETS = 10_000;

type Bucket = { windowStart: number; count: number };
const buckets = new Map<string, Bucket>();

export function takeRateSlot(id: string, limit: number, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  let b = buckets.get(id);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    if (!b && buckets.size >= MAX_BUCKETS) prune(now);
    b = { windowStart: now, count: 0 };
    buckets.set(id, b);
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((b.windowStart + RATE_WINDOW_MS - now) / 1000));
  if (b.count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };
  b.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - b.count), retryAfterSeconds };
}

function prune(now: number) {
  for (const [id, b] of buckets) if (now - b.windowStart >= RATE_WINDOW_MS) buckets.delete(id);
}

/** Tests only: forget every window. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Expects req.publicApi (set by authenticate). */
export const rateLimitByKey: RequestHandler = (req, res, next) => {
  const ctx = req.publicApi;
  if (!ctx) return apiError(res, 401, "unauthorized", "Authenticate with an API key first.");
  const limit = Math.max(1, Math.floor(ctx.plan.ratePerMinute || DEFAULT_RATE_PER_MINUTE));
  const slot = takeRateSlot(ctx.key.id, limit);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(slot.remaining));
  if (!slot.allowed) {
    res.setHeader("Retry-After", String(slot.retryAfterSeconds));
    return apiError(res, 429, "rate_limited", `This key may make ${limit} requests per minute. Try again in ${slot.retryAfterSeconds}s.`, {
      limit, retryAfterSeconds: slot.retryAfterSeconds,
    });
  }
  next();
};
