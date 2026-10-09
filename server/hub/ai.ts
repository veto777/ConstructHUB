/**
 * Hub's own model client and the provider pin (guardrails §1, §4).
 *
 * - Its own OpenAI-compatible client (maxRetries 0, hard timeout), so Hub's
 *   settings never change the other assistants.
 * - Two providers, chosen by HUB_AI_PROVIDER (env only, no code change):
 *   · "truthcode" (default, today's setup): AI_INTEGRATIONS_OPENAI_BASE_URL + _API_KEY and
 *     AI_MODEL, pinned in production to HUB_AI_HOSTS (default 127.0.0.1:8250, the TruthCoder
 *     web UI on the same box) and HUB_EXPECTED_MODEL (comma-separated; default
 *     truthcode-api,truthcode:38 — the live key's API model name and the preset it is scoped to).
 *   · "openai" (owner's decision 2026-10-08, while TruthCoder's GPU pods are down): OpenAI's
 *     own API at https://api.openai.com/v1 with HUB_OPENAI_API_KEY and HUB_AI_MODEL (default
 *     gpt-5.4-nano, OpenAI's cheapest current model). The key is the switch: without it Gabe is
 *     off site in every environment, exactly as on a provider mismatch — chat answers R_OFFLINE
 *     and presets serve templates — and no call is ever attempted. The pin accepts only
 *     api.openai.com and the approved cheap models (HUB_OPENAI_MODELS, default
 *     gpt-5.4-nano,gpt-5.4-mini) in every environment, so a typo cannot run Gabe on a
 *     $30-per-million model anywhere the key is set.
 *     The TruthCoder variables (AI_INTEGRATIONS_*, HUB_AI_HOSTS, HUB_EXPECTED_MODEL) are not
 *     read in this mode, so flipping HUB_AI_PROVIDER is the whole switch — and the other AI
 *     features keep using AI_INTEGRATIONS_* either way; nothing here changes them.
 * - On a mismatch chat is off (R_OFFLINE) and presets serve templates, so "100% through the
 *   pinned provider" holds even if .env drifts.
 */
import OpenAI from "openai";
import { aiModel, aiTimeoutMs } from "../ai-config";
import type { buildRequest } from "./prompt";

export type HubProvider = "truthcode" | "openai";
export type HubRequest = ReturnType<typeof buildRequest>;
/** Token counts from the provider's `usage` (counts only; nothing else of the response is kept). */
export type HubUsage = { prompt: number; completion: number };
export type HubCompletion = { content: string | null; finishReason: string | null; toolCalls?: unknown; functionCall?: unknown; usage?: HubUsage };
export interface HubAi {
  complete(body: HubRequest, signal: AbortSignal): Promise<HubCompletion>;
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_HOST = "api.openai.com";
/**
 * OpenAI's cheapest current model, the owner's pick (2026-10-08). Verified that day on OpenAI's
 * own model page (developers.openai.com/api/docs/models/gpt-5.4-nano): id `gpt-5.4-nano`,
 * default snapshot `gpt-5.4-nano-2026-03-17`, $0.20 / $1.25 per million input / output tokens
 * ($0.02 cached input), reasoning effort "none" by default. The fallback the owner named,
 * `gpt-5.4-mini` ($0.75 / $4.50), is on the approved list below: HUB_AI_MODEL=gpt-5.4-mini.
 */
export const HUB_OPENAI_DEFAULT_MODEL = "gpt-5.4-nano";
export const HUB_OPENAI_APPROVED_MODELS = ["gpt-5.4-nano", "gpt-5.4-mini"] as const;

/** min(HUB_AI_TIMEOUT_MS || 45s, AI_TIMEOUT_MS). */
export function hubTimeoutMs(): number {
  const own = Number(process.env.HUB_AI_TIMEOUT_MS);
  return Math.min(Number.isFinite(own) && own > 0 ? own : 45_000, aiTimeoutMs());
}

export function hubProvider(env: NodeJS.ProcessEnv = process.env): HubProvider {
  return (env.HUB_AI_PROVIDER ?? "").trim().toLowerCase() === "openai" ? "openai" : "truthcode";
}

/** The model Gabe asks for: HUB_AI_MODEL on OpenAI, AI_MODEL (the app-wide setting) on TruthCoder. */
export function hubModel(env: NodeJS.ProcessEnv = process.env): string {
  if (hubProvider(env) === "openai") return (env.HUB_AI_MODEL || HUB_OPENAI_DEFAULT_MODEL).trim();
  return (env.AI_MODEL || aiModel()).trim();
}

export type HubProviderInfo = {
  provider: HubProvider;
  model: string;
  /** Host of the endpoint Gabe would call ("" when the base URL is not a URL). */
  host: string;
  /** Whether that provider's key is set. The key itself is never read out of here. */
  keySet: boolean;
};

/** What the admin may see about the provider: mode, model, host, whether a key is set. Never the key. */
export function hubProviderInfo(env: NodeJS.ProcessEnv = process.env): HubProviderInfo {
  const provider = hubProvider(env);
  if (provider === "openai") {
    return { provider, model: hubModel(env), host: OPENAI_HOST, keySet: (env.HUB_OPENAI_API_KEY ?? "").trim() !== "" };
  }
  let host = "";
  try { host = new URL(env.AI_INTEGRATIONS_OPENAI_BASE_URL || "").host.toLowerCase(); } catch { /* not a URL: mismatch */ }
  return { provider, model: hubModel(env), host, keySet: (env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "").trim() !== "" };
}

const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

let warned = false;
export function providerOk(env: NodeJS.ProcessEnv = process.env): boolean {
  const info = hubProviderInfo(env);
  if (info.provider === "openai" && !info.keySet) {
    // No key yet (the owner adds it): off site in every environment, never a failing call.
    if (!warned) { warned = true; console.log("hub: provider openai no_key"); }
    return false;
  }
  // TruthCoder's pin is production-only, as it always was (a developer's local model server
  // runs any model). OpenAI's is enforced in EVERY environment: the key is a real, paid key
  // wherever it is set, so a typo in HUB_AI_MODEL on a staging box must not run Gabe on a
  // $30-per-million model either (Codex audit 2026-10-09).
  if (info.provider !== "openai" && env.NODE_ENV !== "production") return true;
  const hosts = info.provider === "openai" ? [OPENAI_HOST] : list(env.HUB_AI_HOSTS || "127.0.0.1:8250");
  const models = info.provider === "openai"
    ? list(env.HUB_OPENAI_MODELS || HUB_OPENAI_APPROVED_MODELS.join(","))
    : list(env.HUB_EXPECTED_MODEL || "truthcode-api,truthcode:38");
  const ok = hosts.includes(info.host) && models.includes(info.model.toLowerCase());
  if (!ok && !warned) { warned = true; console.log("hub: provider mismatch"); }
  return ok;
}

/** One boot line naming the provider and the model — never the key, only whether one is set. */
export function logProvider(env: NodeJS.ProcessEnv = process.env): void {
  const info = hubProviderInfo(env);
  console.log(`hub: provider ${info.provider} model ${info.model} host ${info.host || "-"} key ${info.keySet ? "set" : "missing"}`);
}

/**
 * The body each provider receives. TruthCoder gets buildRequest's exact object (the contract
 * prompt.test.ts and RT73 pin). OpenAI's GPT-5 family on Chat Completions answers HTTP 400 to
 * three of its keys, and a 4xx never opens the breaker, so every question would fail — in
 * openai mode they are translated or left out:
 *   max_tokens        → max_completion_tokens (OpenAI's reference: max_tokens is deprecated and
 *                       not compatible with reasoning models; gpt-5.4 rejects it outright)
 *   temperature/top_p → omitted: the GPT-5 family accepts only the default value (400
 *                       "Unsupported value" otherwise). The output filter and the required-facts
 *                       check are what keep answers on the rails, not sampling.
 *   stop              → omitted: 400 "Unsupported parameter" on gpt-5.1+ / gpt-5.4 Chat
 *                       Completions. The markers it guarded are TruthCoder's chat template, and a
 *                       <visitor> tag in a reply is blocked by the output filter (O13) anyway.
 *   reasoning_effort  → "none": documented on OpenAI's gpt-5.4-nano / -mini pages as supported
 *                       and the default; set explicitly so no reasoning tokens are generated or
 *                       billed and the 400-token cap is all answer.
 */
export const OPENAI_REQUEST_KEYS = ["max_completion_tokens", "messages", "model", "reasoning_effort", "stream"] as const;
export type OpenAiRequest = {
  model: string;
  messages: HubRequest["messages"];
  max_completion_tokens: number;
  reasoning_effort: "none";
  stream: false;
};
export function providerBody(provider: HubProvider, body: HubRequest): HubRequest | OpenAiRequest {
  if (provider !== "openai") return body;
  return { model: body.model, messages: body.messages, max_completion_tokens: body.max_tokens, reasoning_effort: "none", stream: false };
}

/** The shape of a chat response Hub reads; structural, so a test can hand in a plain object. */
export type ChatResponseLike = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown; function_call?: unknown } | null; finish_reason?: string | null }> | null;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
};

/** The parts of a response Hub keeps: text, finish reason, any tool call (blocked later) and token counts. */
export function completionOf(res: ChatResponseLike): HubCompletion {
  const choice = res.choices?.[0];
  const message = choice?.message;
  const prompt = Number(res.usage?.prompt_tokens), completion = Number(res.usage?.completion_tokens);
  return {
    content: message?.content ?? null,
    finishReason: choice?.finish_reason ?? null,
    toolCalls: message?.tool_calls,
    functionCall: message?.function_call,
    usage: res.usage && Number.isFinite(prompt) && Number.isFinite(completion) ? { prompt, completion } : undefined,
  };
}

export function hubAiClient(env: NodeJS.ProcessEnv = process.env): HubAi {
  const provider = hubProvider(env);
  const client = new OpenAI({
    apiKey: provider === "openai" ? env.HUB_OPENAI_API_KEY : env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: provider === "openai" ? OPENAI_BASE_URL : env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: hubTimeoutMs(),
    maxRetries: 0,
  });
  return {
    async complete(body, signal) {
      const params = providerBody(provider, body) as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
      const res = await client.chat.completions.create(params, { signal, maxRetries: 0 });
      return completionOf(res);
    },
  };
}
