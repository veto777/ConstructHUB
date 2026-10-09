/**
 * Hub abuse limits (guardrails §5). Budgets are fixed UTC windows in
 * growth_budgets (via takeBudget, injected so tests need no DB); the
 * concurrency gate and the circuit breaker are in-process.
 *
 * Gate order for POST /api/hub/chat (enforced in routes.ts):
 *   CSRF/Origin → schema → auth/tier → turn signatures → per-minute → refusal
 *   cooldown → pre-filter → breaker → semaphore → daily user/IP/global budgets
 *   (only when a model call will happen; a request turned away as busy costs no
 *   daily slot) → TruthCoder.
 */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const HUB_LIMITS = {
  presetPerIp: { limit: 60, windowMs: 10 * MINUTE },
  presetGeneration: { limit: 3, windowMs: HOUR },
  chatPerMinute: { limit: 4, windowMs: MINUTE },
  refusalsPerDay: { limit: 10, windowMs: DAY },
  userDaily: { limit: 40, windowMs: DAY },
  ipDaily: { limit: 120, windowMs: DAY },
};

/** Spread the monthly Gabe allowance over 20 active days; unlimited has a 200/day
 * fair-use guard. Missing plans retain the default, and IP caps never undercut users. */
export function hubDailyLimits(monthlyGabeQuestions?: number | null) {
  const userDaily = monthlyGabeQuestions === -1 ? 200
    : Math.max(HUB_LIMITS.userDaily.limit, Math.ceil((monthlyGabeQuestions ?? 0) / 20));
  return { userDaily, ipDaily: Math.max(HUB_LIMITS.ipDaily.limit, userDaily) };
}

export const globalDailyCap = () => {
  const n = Number(process.env.HUB_GLOBAL_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 1500;
};
export const maxConcurrency = () => {
  const n = Number(process.env.HUB_MAX_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? n : 3;
};

export const keys = {
  presetIp: (ip: string) => `hub-preset:ip:${ip}`,
  presetGen: (presetId: string, hash: string) => `hub-gen:${presetId}:${hash}`,
  minute: (userId: number) => `hub:u:${userId}:m`,
  refusals: (userId: number) => `hub-refuse:u:${userId}`,
  userDaily: (userId: number) => `hub:u:${userId}:d`,
  ipDaily: (ip: string) => `hub:ip:${ip}:d`,
  globalDaily: () => "hub:global:d",
};

/** Budget store: takeBudget() and a read-only peek (both on growth_budgets in production). */
export type Budget = {
  take(key: string, limit: number, windowMs: number): Promise<boolean>;
  used(key: string, windowMs: number): Promise<number>;
};

/** In-process concurrency gate: at most `max` calls in flight, and one per user. */
export class Semaphore {
  private inFlight = 0;
  private owners = new Set<string>();
  constructor(private readonly max: () => number) {}
  tryAcquire(owner: string): (() => void) | null {
    if (this.owners.has(owner) || this.inFlight >= this.max()) return null;
    this.inFlight++; this.owners.add(owner);
    let released = false;
    return () => {
      if (released) return;
      released = true; this.inFlight--; this.owners.delete(owner);
    };
  }
  get size() { return this.inFlight; }
}

/** Opens after `threshold` consecutive upstream failures (timeouts, 5xx, network) and stays open `openMs`. */
export class Breaker {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly threshold = 3, private readonly openMs = MINUTE, private readonly now: () => number = Date.now) {}
  isOpen(): boolean { return this.now() < this.openUntil; }
  success(): void { this.failures = 0; }
  failure(): void {
    this.failures++;
    if (this.failures >= this.threshold) { this.openUntil = this.now() + this.openMs; this.failures = 0; }
  }
}
