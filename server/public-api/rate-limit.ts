/**
 * Request rate limits, fixed one-minute windows held in process memory (the
 * app runs as one process; a restart simply opens a new window):
 *
 *   per key      the plan's apiRatePerMinute (60)  — X-RateLimit-Limit / -Remaining
 *   per account  ACCOUNT_RATE_PER_MINUTE (300) across ALL of the account's
 *                keys, so minting keys cannot multiply the rate
 *
 * Over either limit: 429 rate_limited + Retry-After (`scope` says which).
 */
import type { RequestHandler } from "express";
import { apiError } from "./errors";

export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_PER_MINUTE = 60;
/** Requests per minute one account may make in total, whatever the number of keys. */
export const ACCOUNT_RATE_PER_MINUTE = 300;
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

/** Give back a slot taken this window (the account check failed after the key's slot was taken). */
function releaseRateSlot(id: string, now = Date.now()) {
  const b = buckets.get(id);
  if (b && now - b.windowStart < RATE_WINDOW_MS && b.count > 0) b.count -= 1;
}

function prune(now: number) {
  for (const [id, b] of buckets) if (now - b.windowStart >= RATE_WINDOW_MS) buckets.delete(id);
}

/** Tests only: forget every window. */
export function resetRateLimits(): void {
  buckets.clear();
}

export const keyBucket = (keyId: string) => `key:${keyId}`;
export const accountBucket = (userId: number) => `user:${userId}`;

/** Expects req.publicApi (set by authenticate). */
export const rateLimitByKey: RequestHandler = (req, res, next) => {
  const ctx = req.publicApi;
  if (!ctx) return apiError(res, 401, "unauthorized", "Authenticate with an API key first.");
  const limit = Math.max(1, Math.floor(ctx.plan.ratePerMinute || DEFAULT_RATE_PER_MINUTE));
  const slot = takeRateSlot(keyBucket(ctx.key.id), limit);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(slot.remaining));
  if (!slot.allowed) {
    res.setHeader("Retry-After", String(slot.retryAfterSeconds));
    return apiError(res, 429, "rate_limited", `This key may make ${limit} requests per minute. Try again in ${slot.retryAfterSeconds}s.`, {
      scope: "key", limit, retryAfterSeconds: slot.retryAfterSeconds,
    });
  }
  const account = takeRateSlot(accountBucket(ctx.userId), ACCOUNT_RATE_PER_MINUTE);
  if (!account.allowed) {
    releaseRateSlot(keyBucket(ctx.key.id));
    res.setHeader("X-RateLimit-Remaining", String(slot.remaining + 1));
    res.setHeader("Retry-After", String(account.retryAfterSeconds));
    return apiError(res, 429, "rate_limited", `This account may make ${ACCOUNT_RATE_PER_MINUTE} requests per minute across all of its keys. Try again in ${account.retryAfterSeconds}s.`, {
      scope: "account", limit: ACCOUNT_RATE_PER_MINUTE, retryAfterSeconds: account.retryAfterSeconds,
    });
  }
  next();
};
