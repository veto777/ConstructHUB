/**
 * Gabe's token meter (cost guard, owner 2026-10-08). Counts only — the prompt and completion
 * token numbers the provider reports in `usage` — summed per UTC day. The cap
 * (HUB_AI_DAILY_TOKEN_CAP, unset = off) is a ceiling on surprise spend, not an accounting
 * system: once today's total reaches it, chat answers R_OFFLINE and presets serve what is
 * cached or the template until the next UTC day (routes.ts). The provider's own dashboard is
 * the bill.
 *
 * Durable and atomic (Codex audits 2026-10-09): the day's counts live in one row of
 * `hub_usage_days` (store.ts pgUsage; a restart or a second process reads the same row), and a
 * call RESERVES its tokens before it is dispatched — an upper-bound estimate (estimateTokens: a
 * token a byte plus framing per message, and the whole answer allowance) — in one conditional upsert that is
 * refused unless the day's total PLUS this reservation fits under the cap, the first reservation of
 * the day included. So the counter never passes the cap at admission, however many calls arrive
 * together. When the provider's counts arrive the reservation is settled to them, up or down: real
 * spend above the reservation is counted and the next admission sees it; a call whose counts never
 * arrive (timeout, a response without usage) keeps its reservation, which only ever over-counts.
 */

export type TokenUsage = { prompt: number; completion: number };
export type TokenDay = { day: string; calls: number; prompt: number; completion: number; total: number };
/** What one call holds on the day's counter until it is settled. */
export type TokenReservation = { day: string; prompt: number; completion: number };

/** HUB_AI_DAILY_TOKEN_CAP as a positive whole number, else null (no cap). */
export const dailyTokenCap = (env: NodeJS.ProcessEnv = process.env): number | null => {
  const n = Number(env.HUB_AI_DAILY_TOKEN_CAP);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** "YYYY-MM-DD" (UTC) of an instant. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A count as the meter keeps it: a whole number, never negative (odd input counts as 0). */
const whole = (n: number): number => Math.max(0, Math.floor(n) || 0);

/**
 * Where the day's counts live. `reserve` is the one atomic step: add the call's estimate and
 * count the call, unless the day's total plus the estimate would pass `cap` (null = no cap) —
 * then nothing is added and null comes back.
 */
export type UsageStore = {
  reserve(day: string, prompt: number, completion: number, cap: number | null): Promise<TokenDay | null>;
  /** Replace a reservation's counts with what the provider reported. */
  settle(day: string, reserved: TokenUsage, actual: TokenUsage): Promise<void>;
  today(day: string): Promise<TokenDay>;
};

/** The in-process store: the test double, and the default when no database store is handed in. */
export class MemoryUsageStore implements UsageStore {
  private days = new Map<string, { calls: number; prompt: number; completion: number }>();
  private row(day: string) {
    let r = this.days.get(day);
    if (!r) { r = { calls: 0, prompt: 0, completion: 0 }; this.days.set(day, r); }
    return r;
  }
  async reserve(day: string, prompt: number, completion: number, cap: number | null): Promise<TokenDay | null> {
    const r = this.row(day);
    const p = whole(prompt), c = whole(completion);
    if (cap !== null && r.prompt + r.completion + p + c > cap) return null;
    r.calls++; r.prompt += p; r.completion += c;
    return this.today(day);
  }
  async settle(day: string, reserved: TokenUsage, actual: TokenUsage): Promise<void> {
    const r = this.row(day);
    r.prompt = Math.max(0, r.prompt - whole(reserved.prompt) + whole(actual.prompt));
    r.completion = Math.max(0, r.completion - whole(reserved.completion) + whole(actual.completion));
  }
  async today(day: string): Promise<TokenDay> {
    const r = this.row(day);
    return { day, calls: r.calls, prompt: r.prompt, completion: r.completion, total: r.prompt + r.completion };
  }
}

/**
 * THE BOUND (Codex audits #3–#4, 2026-10-09): no tokenizer package is installed (no gpt-tokenizer,
 * tiktoken or js-tiktoken in node_modules — the Hub adds no dependency for a cost guard), so the
 * reservation is a bound rather than a count: ONE TOKEN PER BYTE of UTF-8 text, plus 8 framing
 * tokens per message, plus the whole answer allowance. Why one token a byte is the practical upper
 * bound for the OpenAI tokenizers (cl100k_base, o200k_base): they are byte-level BPE — every token
 * stands for a non-empty byte sequence, so a text of N bytes can never cost more than N tokens
 * (the degenerate case is one single-byte token per byte, which is what alternating letters and
 * digits, or bytes outside every merge, fall to). Bytes, not JS characters, so a surrogate-pair
 * emoji counts its four bytes. Framing: the chat format adds a handful of tokens around each message
 * (role, separators); 8 a message is above what either format uses. A settlement above the
 * reservation is still counted (settle), so the cap sees the real spend either way.
 */
const BYTES_PER_TOKEN = 1;
/** Framing tokens per message (role markers, separators; the chat formats add about 3–4). */
const FRAMING_TOKENS_PER_MESSAGE = 8;

/** The tokens one message is reserved at: a token per byte of its text, plus the message's framing. */
function boundTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content, "utf8") / BYTES_PER_TOKEN) + FRAMING_TOKENS_PER_MESSAGE;
}

/**
 * The estimate a call reserves, an upper bound: every message's bytes at boundTokens (a token a
 * byte, 8 framing each), and the whole answer allowance (max_tokens) as the completion.
 */
export function estimateTokens(body: { messages: readonly { content: string }[]; max_tokens: number }): TokenUsage {
  const prompt = body.messages.reduce((n, m) => n + boundTokens(m.content), 0);
  return { prompt, completion: whole(body.max_tokens) };
}

export class TokenMeter {
  constructor(private readonly store: UsageStore = new MemoryUsageStore(), private readonly now: () => number = Date.now) {}

  /**
   * Reserve one call's estimate on today's counter, before the call is made. Null when it would
   * take the day past the cap: the call must not happen.
   */
  async reserve(estimate: TokenUsage, cap: number | null): Promise<TokenReservation | null> {
    const day = dayOf(this.now());
    const prompt = whole(estimate.prompt), completion = whole(estimate.completion);
    const after = await this.store.reserve(day, prompt, completion, cap);
    return after ? { day, prompt, completion } : null;
  }

  /**
   * Replace a reservation with the provider's counts — also when they exceed it (the counter then shows
   * the real spend and the next admission is measured against it). Without counts the reservation stands.
   */
  async settle(reservation: TokenReservation, usage?: TokenUsage): Promise<void> {
    if (!usage) return;
    await this.store.settle(reservation.day, reservation, { prompt: whole(usage.prompt), completion: whole(usage.completion) });
  }

  today(): Promise<TokenDay> {
    return this.store.today(dayOf(this.now()));
  }

  /** True when a cap is set and today's total has reached it. */
  async capped(cap: number | null): Promise<boolean> {
    if (cap === null) return false;
    return (await this.today()).total >= cap;
  }
}
