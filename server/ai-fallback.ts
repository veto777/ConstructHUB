/**
 * TruthCoder first, OpenAI's cheapest model second (owner, 2026-10-10: "all other things
 * that require ai usage we should rely on truthcoder first and then if truthcoder doesnt
 * respond in a reasonable time frame then we use the cheapest model openai has to offer").
 *
 * Every AI request still goes to the app's provider first (AI_INTEGRATIONS_OPENAI_BASE_URL,
 * TruthCoder). When it fails, or has not answered within the wait below, the SAME request also
 * goes to OpenAI's API on gpt-5.4-nano; the first answer wins (a slow TruthCoder keeps running,
 * so a failing OpenAI never costs an answer TruthCoder would have given). Nothing changes until
 * an OpenAI key is set.
 *
 *   AI_FALLBACK_OPENAI_API_KEY   the OpenAI key (falls back to HUB_OPENAI_API_KEY, Gabe's key)
 *   AI_FALLBACK=off              turn the fallback off
 *   AI_FALLBACK_MODEL            gpt-5.4-nano (default) or gpt-5.4-mini; anything else → nano
 *   AI_FALLBACK_AFTER_MS         how long TruthCoder gets on text (default 30000)
 *   AI_FALLBACK_VISION_AFTER_MS  …on requests with photos (default 90000; its vision model is slow)
 *   AI_FALLBACK_COOLDOWN_MS      after TruthCoder errored AND OpenAI answered, go straight to
 *                                OpenAI for this long (default 60000), so nobody waits on a dead
 *                                server request after request
 *
 * When the fallback fails too, the caller sees TruthCoder's error exactly as before (its
 * status mapping and messages are unchanged), and the cooldown does not start — so an OpenAI
 * account without credit never takes TruthCoder out of the loop.
 *
 * GPT-5 Chat Completions rejects some TruthCoder-era keys (see server/hub/ai.ts providerBody):
 * max_tokens → max_completion_tokens, temperature/top_p/stop dropped, reasoning_effort "none".
 */
import OpenAI from "openai";

export const OPENAI_FALLBACK_BASE_URL = "https://api.openai.com/v1";
export const FALLBACK_DEFAULT_MODEL = "gpt-5.4-nano";
export const FALLBACK_APPROVED_MODELS = ["gpt-5.4-nano", "gpt-5.4-mini"] as const;

export type FallbackSettings = { key: string; model: string; afterMs: number; visionAfterMs: number; cooldownMs: number };

const posInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** The fallback's settings, or null when it is off (no key, or AI_FALLBACK=off). */
export function fallbackSettings(env: NodeJS.ProcessEnv = process.env): FallbackSettings | null {
  if ((env.AI_FALLBACK ?? "").trim().toLowerCase() === "off") return null;
  const key = (env.AI_FALLBACK_OPENAI_API_KEY || env.HUB_OPENAI_API_KEY || "").trim();
  if (!key) return null;
  const wanted = (env.AI_FALLBACK_MODEL ?? "").trim();
  return {
    key,
    model: (FALLBACK_APPROVED_MODELS as readonly string[]).includes(wanted) ? wanted : FALLBACK_DEFAULT_MODEL,
    afterMs: posInt(env.AI_FALLBACK_AFTER_MS, 30_000),
    visionAfterMs: posInt(env.AI_FALLBACK_VISION_AFTER_MS, 90_000),
    cooldownMs: posInt(env.AI_FALLBACK_COOLDOWN_MS, 60_000),
  };
}

/** Does any message carry a photo (an image_url part)? */
export function hasImages(messages: unknown): boolean {
  return Array.isArray(messages) && messages.some((m: any) =>
    Array.isArray(m?.content) && m.content.some((p: any) => p?.type === "image_url"));
}

/** The request as OpenAI's GPT-5 Chat Completions accepts it. */
export function openAiFallbackBody(params: Record<string, any>, model: string): Record<string, unknown> {
  const max = params.max_completion_tokens ?? params.max_tokens;
  const body: Record<string, unknown> = { model, messages: params.messages, reasoning_effort: "none", stream: false };
  if (Number.isInteger(max) && max > 0) body.max_completion_tokens = max;
  if (params.response_format) body.response_format = params.response_format;
  return body;
}

// ── the breaker: TruthCoder skipped for a while after it failed and OpenAI answered ─────────
let primaryDownUntil = 0;
export function resetFallbackState() { primaryDownUntil = 0; }
export const primarySkipped = (now = Date.now()) => now < primaryDownUntil;

/** A provider error as a short tag (never the body, which may echo the key). */
const tag = (e: any) => [e?.constructor?.name || e?.name || "Error", e?.status ?? ""].filter(Boolean).join(" ");


/**
 * Run `primary`; when it fails, or has not answered within `waitMs`, also run `fallback`.
 * A slow TruthCoder is NOT cancelled at the deadline: both run, the first answer wins and the
 * other is cancelled. So when OpenAI fails (no credit, outage), TruthCoder still has its full
 * time, exactly as before the fallback existed. Each side gets its own AbortSignal; both fire
 * when the caller's `signal` does, and the caller's own cancel is never a TruthCoder failure.
 */
export function runWithFallback<T>(
  primary: (signal: AbortSignal) => Promise<T>,
  fallback: (signal: AbortSignal, cfg: FallbackSettings) => Promise<T>,
  opts: { waitMs?: number; vision?: boolean; signal?: AbortSignal; fallbackTimeoutMs?: number; label?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<T> {
  const cfg = fallbackSettings(opts.env);
  const outer = opts.signal;
  if (!cfg) return primary(outer ?? new AbortController().signal);
  const label = opts.label || "ai";
  const primaryCtl = new AbortController(), fallbackCtl = new AbortController();
  const primarySignal = outer ? AbortSignal.any([outer, primaryCtl.signal]) : primaryCtl.signal;
  const fallbackSignal = () => AbortSignal.any([fallbackCtl.signal, AbortSignal.timeout(opts.fallbackTimeoutMs ?? 60_000), ...(outer ? [outer] : [])]);

  if (primarySkipped()) {
    // TruthCoder failed moments ago and OpenAI answered: OpenAI first, TruthCoder if OpenAI fails.
    return fallback(fallbackSignal(), cfg).catch((e) => {
      if (outer?.aborted) throw e;
      console.warn(`[ai-fallback] ${label}: openai ${cfg.model} failed during the cooldown (${tag(e)}); trying truthcode`);
      primaryDownUntil = 0;
      return primary(primarySignal);
    });
  }

  const waitMs = opts.waitMs ?? (opts.vision ? cfg.visionAfterMs : cfg.afterMs);
  const started = Date.now();
  return new Promise<T>((resolve, reject) => {
    let done = false, fallbackStarted = false, fallbackFailed = false, primaryFailed = false;
    let primaryError: unknown;
    const settle = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); fn(); };
    const failBoth = () => settle(() => reject(primaryError));
    const startFallback = (why: string) => {
      if (fallbackStarted || done) return;
      fallbackStarted = true;
      fallback(fallbackSignal(), cfg).then((out) => {
        if (done) return;
        primaryCtl.abort();
        primaryDownUntil = primaryFailed ? Date.now() + cfg.cooldownMs : 0;
        console.warn(`[ai-fallback] ${label}: truthcode ${why}; openai ${cfg.model} answered after ${Date.now() - started} ms`);
        settle(() => resolve(out));
      }, (e) => {
        fallbackFailed = true;
        if (done) return;
        console.warn(`[ai-fallback] ${label}: truthcode ${why}; openai ${cfg.model} failed (${tag(e)})${primaryFailed ? "" : ", still waiting for truthcode"}`);
        if (primaryFailed) failBoth();
      });
    };
    const timer = setTimeout(() => startFallback(`gave no answer in ${waitMs} ms`), waitMs);
    primary(primarySignal).then((out) => {
      if (done) return;
      fallbackCtl.abort();
      settle(() => resolve(out));
    }, (e) => {
      if (done) return;
      if (outer?.aborted) { fallbackCtl.abort(); return settle(() => reject(e)); }
      primaryFailed = true;
      primaryError = e;
      if (fallbackFailed) return failBoth();
      startFallback(`failed (${tag(e)})`);
    });
  });
}

export interface FallbackChatClient {
  chat: { completions: { create(params: any, options?: any): any } };
}

let openai: { key: string; client: OpenAI } | null = null;
function openAiClient(key: string): OpenAI {
  if (openai?.key !== key) openai = { key, client: new OpenAI({ apiKey: key, baseURL: OPENAI_FALLBACK_BASE_URL, maxRetries: 0, timeout: 120_000 }) };
  return openai.client;
}

/**
 * Give an OpenAI-compatible client the fallback: its chat.completions.create goes to the
 * client's own provider first and to OpenAI's cheapest model when that fails or is too slow.
 * Returns the same object (its type unchanged), so callers need no other change.
 */
export function withOpenAiFallback<C extends FallbackChatClient>(client: C, opts: { waitMs?: number; fallbackTimeoutMs?: number; label?: string } = {}): C {
  const completions = client.chat.completions;
  const create = completions.create.bind(completions);
  completions.create = ((params: any, options: any = {}) => runWithFallback(
    (signal) => create(params, { ...options, signal }),
    (signal, cfg) => openAiClient(cfg.key).chat.completions.create(openAiFallbackBody(params, cfg.model) as any, { signal, maxRetries: 0 }),
    { waitMs: opts.waitMs, vision: hasImages(params?.messages), signal: options?.signal, fallbackTimeoutMs: opts.fallbackTimeoutMs, label: opts.label ?? String(params?.model ?? "ai") },
  )) as any;
  return client;
}
