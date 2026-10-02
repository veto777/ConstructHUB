/**
 * Hub's own model client and the provider pin (guardrails §1, §4).
 *
 * - Its own OpenAI-compatible client (maxRetries 0, hard timeout), so Hub's
 *   settings never change the other assistants.
 * - Provider pin: in production the base URL's host must be in HUB_AI_HOSTS
 *   (default 127.0.0.1:8250, the TruthCoder web UI on the same box) and the
 *   model must be in HUB_EXPECTED_MODEL (comma-separated; default
 *   truthcode-api,truthcode:38 — the live key's API model name and the preset
 *   it is scoped to). On a mismatch chat is off (R_OFFLINE) and presets serve
 *   templates, so "100% through TruthCoder" holds even if .env drifts.
 */
import OpenAI from "openai";
import { aiModel, aiTimeoutMs } from "../ai-config";
import type { buildRequest } from "./prompt";

export type HubRequest = ReturnType<typeof buildRequest>;
export type HubCompletion = { content: string | null; finishReason: string | null; toolCalls?: unknown; functionCall?: unknown };
export interface HubAi {
  complete(body: HubRequest, signal: AbortSignal): Promise<HubCompletion>;
}

/** min(HUB_AI_TIMEOUT_MS || 45s, AI_TIMEOUT_MS). */
export function hubTimeoutMs(): number {
  const own = Number(process.env.HUB_AI_TIMEOUT_MS);
  return Math.min(Number.isFinite(own) && own > 0 ? own : 45_000, aiTimeoutMs());
}

let warned = false;
export function providerOk(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  const hosts = (env.HUB_AI_HOSTS || "127.0.0.1:8250").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  let host = "";
  try { host = new URL(env.AI_INTEGRATIONS_OPENAI_BASE_URL || "").host.toLowerCase(); } catch { /* not a URL: mismatch */ }
  const model = (env.AI_MODEL || aiModel()).trim().toLowerCase();
  const models = (env.HUB_EXPECTED_MODEL || "truthcode-api,truthcode:38").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  const ok = hosts.includes(host) && models.includes(model);
  if (!ok && !warned) { warned = true; console.log("hub: provider mismatch"); }
  return ok;
}

export function hubAiClient(): HubAi {
  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: hubTimeoutMs(),
    maxRetries: 0,
  });
  return {
    async complete(body, signal) {
      const res = await client.chat.completions.create(body, { signal, maxRetries: 0 });
      const choice = res.choices?.[0];
      const message = choice?.message as (OpenAI.Chat.ChatCompletionMessage & { function_call?: unknown }) | undefined;
      return {
        content: message?.content ?? null,
        finishReason: choice?.finish_reason ?? null,
        toolCalls: message?.tool_calls,
        functionCall: message?.function_call,
      };
    },
  };
}
