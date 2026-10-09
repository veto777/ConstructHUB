/**
 * Hub logging policy (guardrails §8). Only counts are kept:
 * hub_stats(day, tier, outcome, reason, count). Never logged or stored:
 * message text, reply text, hashes of either, conversationId, user id, email,
 * IP, pageKey with a user id, or the canary. Console output is one line,
 * "hub: <outcome> <reason> <ms>"; errors log only name/status/code.
 */

export type HubTier = "browse" | "builder";
export type HubOutcome =
  | "preset_hit" | "preset_template" | "chat_ok" | "prefilter" | "output_block"
  | "timeout" | "busy" | "limit" | "tampered" | "offline";

export interface StatsSink {
  record(tier: HubTier, outcome: HubOutcome, reason: string): void;
}

export const latencyBucket = (ms: number) => (ms < 5_000 ? "<5s" : ms < 15_000 ? "<15s" : ms < 30_000 ? "<30s" : ">=30s");

/** Reasons are P-codes, O-codes, limit names or latency buckets: short fixed tokens only. */
export const safeReason = (reason: string) => (/^[\w<>=.-]{1,24}$/.test(reason) ? reason : "-");

/** "usage": one line per model call with the token counts the provider reported ("in6512-out143"), never text. */
export function logLine(outcome: HubOutcome | "error" | "warm" | "usage", reason: string, ms: number): void {
  console.log(`hub: ${outcome} ${safeReason(reason)} ${Math.round(ms)}`);
}

/** An SDK or DB error, reduced to fields that carry no request or response content. */
export function logError(where: string, err: unknown): void {
  const e = err as { name?: unknown; status?: unknown; code?: unknown } | null;
  const field = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 40).replace(/\s+/g, "_") : "-");
  console.log(`hub: error ${safeReason(where)} ${field(e?.name)} ${field(e?.status)} ${field(e?.code)}`);
}
