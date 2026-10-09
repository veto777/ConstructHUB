/**
 * Hub provider modes (owner 2026-10-08: Gabe on OpenAI's cheapest model while TruthCoder is
 * down, switched by env only): the pin in both modes, the body each provider receives, the
 * token counts read from a response, and the daily token meter and cap (usage.ts).
 * No network: the client itself is not constructed here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMessages, buildRequest, MODEL_STOP } from "./prompt";
import {
  completionOf, HUB_OPENAI_DEFAULT_MODEL, hubModel, hubProvider, hubProviderInfo, logProvider, OPENAI_HOST, OPENAI_REQUEST_KEYS, providerBody, providerOk,
} from "./ai";
import { dailyTokenCap, estimateTokens, MemoryUsageStore, TokenMeter } from "./usage";

const TRUTH = { NODE_ENV: "production", AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:8250/api", AI_INTEGRATIONS_OPENAI_API_KEY: "fixture-truth-key", AI_MODEL: "truthcode-api" };
const OPENAI = { NODE_ENV: "production", HUB_AI_PROVIDER: "openai", HUB_OPENAI_API_KEY: "sk-fixture-openai-key" };

afterEach(() => vi.restoreAllMocks());

describe("provider choice (HUB_AI_PROVIDER)", () => {
  it("TruthCoder unless HUB_AI_PROVIDER is exactly openai (any case, trimmed)", () => {
    expect(hubProvider({})).toBe("truthcode");
    expect(hubProvider({ HUB_AI_PROVIDER: "truthcode" })).toBe("truthcode");
    expect(hubProvider({ HUB_AI_PROVIDER: "openai" })).toBe("openai");
    expect(hubProvider({ HUB_AI_PROVIDER: " OpenAI " })).toBe("openai");
    expect(hubProvider({ HUB_AI_PROVIDER: "anthropic" })).toBe("truthcode");
  });

  it("the model: AI_MODEL on TruthCoder, HUB_AI_MODEL (default gpt-5.4-nano) on OpenAI", () => {
    expect(hubModel(TRUTH)).toBe("truthcode-api");
    expect(HUB_OPENAI_DEFAULT_MODEL).toBe("gpt-5.4-nano");
    expect(hubModel(OPENAI)).toBe("gpt-5.4-nano");
    expect(hubModel({ ...OPENAI, HUB_AI_MODEL: " gpt-5.4-mini " })).toBe("gpt-5.4-mini");
    // HUB_AI_MODEL means nothing on TruthCoder; AI_MODEL means nothing on OpenAI.
    expect(hubModel({ ...TRUTH, HUB_AI_MODEL: "gpt-5.4-mini" })).toBe("truthcode-api");
    expect(hubModel({ ...OPENAI, AI_MODEL: "truthcode-api" })).toBe("gpt-5.4-nano");
  });
});

describe("the provider pin in both modes (providerOk)", () => {
  it("TruthCoder mode is unchanged: host + model pinned in production, open in development", () => {
    expect(providerOk(TRUTH)).toBe(true);
    expect(providerOk({ ...TRUTH, AI_MODEL: "truthcode:38" })).toBe(true);
    expect(providerOk({ ...TRUTH, AI_INTEGRATIONS_OPENAI_BASE_URL: "https://api.openai.com/v1" })).toBe(false);
    expect(providerOk({ ...TRUTH, AI_MODEL: "gpt-5.4-nano" })).toBe(false);
    expect(providerOk({ ...TRUTH, NODE_ENV: "development", AI_MODEL: "anything" })).toBe(true);
  });

  it("OpenAI mode: api.openai.com + an approved model, and the key is the switch", () => {
    expect(providerOk(OPENAI)).toBe(true);
    expect(providerOk({ ...OPENAI, HUB_AI_MODEL: "gpt-5.4-mini" })).toBe(true);
    // No key yet (the owner adds it): off site in every environment, never a failing call.
    expect(providerOk({ ...OPENAI, HUB_OPENAI_API_KEY: "" })).toBe(false);
    expect(providerOk({ ...OPENAI, HUB_OPENAI_API_KEY: "   " })).toBe(false);
    expect(providerOk({ NODE_ENV: "development", HUB_AI_PROVIDER: "openai" })).toBe(false);
    expect(providerOk({ NODE_ENV: "development", HUB_AI_PROVIDER: "openai", HUB_OPENAI_API_KEY: "sk-fixture" })).toBe(true);
  });

  it("OpenAI mode pins the model in EVERY environment (the key is a paid key wherever it is set); TruthCoder stays open in development", () => {
    for (const NODE_ENV of ["development", "test", "staging", undefined]) {
      const dev = { NODE_ENV, HUB_AI_PROVIDER: "openai", HUB_OPENAI_API_KEY: "sk-fixture" } as NodeJS.ProcessEnv;
      expect(providerOk({ ...dev, HUB_AI_MODEL: "gpt-5.4-pro" }), String(NODE_ENV)).toBe(false);
      expect(providerOk({ ...dev, HUB_AI_MODEL: "gpt-4o" }), String(NODE_ENV)).toBe(false);
      expect(providerOk({ ...dev, HUB_AI_MODEL: "gpt-5.4-mini" }), String(NODE_ENV)).toBe(true);
      expect(providerOk({ ...dev, HUB_AI_MODEL: "gpt-5-nano", HUB_OPENAI_MODELS: "gpt-5-nano" }), String(NODE_ENV)).toBe(true);
    }
    expect(providerOk({ ...TRUTH, NODE_ENV: "development", AI_MODEL: "anything", AI_INTEGRATIONS_OPENAI_BASE_URL: "http://localhost:11434/v1" })).toBe(true);
  });

  it("OpenAI mode: a model outside the approved list is a mismatch unless HUB_OPENAI_MODELS names it", () => {
    expect(providerOk({ ...OPENAI, HUB_AI_MODEL: "gpt-5.4-pro" })).toBe(false);
    expect(providerOk({ ...OPENAI, HUB_AI_MODEL: "gpt-4o-mini" })).toBe(false);
    expect(providerOk({ ...OPENAI, HUB_AI_MODEL: "gpt-5-nano", HUB_OPENAI_MODELS: "gpt-5-nano, gpt-5.4-nano" })).toBe(true);
    expect(providerOk({ ...OPENAI, HUB_AI_MODEL: "gpt-5.4-nano", HUB_OPENAI_MODELS: "gpt-5-nano" })).toBe(false);
  });

  it("OpenAI mode ignores the TruthCoder variables, so flipping HUB_AI_PROVIDER is the whole switch", () => {
    const liveTruth = { AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:8250/api", AI_MODEL: "truthcode-api", HUB_AI_HOSTS: "127.0.0.1:8250", HUB_EXPECTED_MODEL: "truthcode-api,truthcode:38" };
    expect(providerOk({ ...OPENAI, ...liveTruth })).toBe(true);
    expect(hubProviderInfo({ ...OPENAI, ...liveTruth })).toMatchObject({ provider: "openai", model: "gpt-5.4-nano", host: OPENAI_HOST, keySet: true });
    // And the key for one mode never counts for the other.
    expect(providerOk({ ...OPENAI, HUB_OPENAI_API_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "fixture-truth-key" })).toBe(false);
  });

  it("what the admin sees and the boot line name the model, never the key", () => {
    const info = hubProviderInfo(OPENAI);
    expect(info).toEqual({ provider: "openai", model: "gpt-5.4-nano", host: "api.openai.com", keySet: true });
    expect(JSON.stringify(info)).not.toContain("fixture");
    expect(hubProviderInfo({ ...OPENAI, HUB_OPENAI_API_KEY: "" })).toMatchObject({ keySet: false });
    expect(hubProviderInfo(TRUTH)).toEqual({ provider: "truthcode", model: "truthcode-api", host: "127.0.0.1:8250", keySet: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logProvider(OPENAI);
    logProvider({ ...OPENAI, HUB_OPENAI_API_KEY: "" });
    logProvider(TRUTH);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "hub: provider openai model gpt-5.4-nano host api.openai.com key set",
      "hub: provider openai model gpt-5.4-nano host api.openai.com key missing",
      "hub: provider truthcode model truthcode-api host 127.0.0.1:8250 key set",
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("fixture");
  });
});

describe("the request each provider receives (providerBody)", () => {
  const body = buildRequest("truthcode:38", buildMessages([{ role: "user", content: "How do I set up Click Guard?" }]));

  it("TruthCoder gets buildRequest's exact object: temperature, top_p, max_tokens 400, stop", () => {
    const sent = providerBody("truthcode", body);
    expect(sent).toBe(body);
    expect(Object.keys(sent).sort()).toEqual(["max_tokens", "messages", "model", "stop", "stream", "temperature", "top_p"]);
    expect(sent).toMatchObject({ temperature: 0.2, top_p: 0.9, max_tokens: 400, stop: MODEL_STOP, stream: false });
  });

  it("OpenAI gets max_completion_tokens 400 + reasoning_effort none, and none of the keys GPT-5 rejects", () => {
    const sent = providerBody("openai", buildRequest("gpt-5.4-nano", body.messages));
    expect(Object.keys(sent).sort()).toEqual([...OPENAI_REQUEST_KEYS].sort());
    expect(sent).toMatchObject({ model: "gpt-5.4-nano", max_completion_tokens: 400, reasoning_effort: "none", stream: false });
    expect(sent.messages).toBe(body.messages);
    for (const dropped of ["max_tokens", "temperature", "top_p", "stop"]) expect(sent).not.toHaveProperty(dropped);
    for (const forbidden of ["tools", "tool_choice", "functions", "function_call", "response_format", "logprobs", "user", "metadata"]) expect(sent).not.toHaveProperty(forbidden);
  });
});

describe("what Hub keeps of a response (completionOf)", () => {
  it("text, finish reason, tool calls and the token counts", () => {
    const out = completionOf({
      choices: [{ message: { content: "**Pro** adds Click Guard.", tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 6512, completion_tokens: 143 },
    });
    expect(out).toEqual({ content: "**Pro** adds Click Guard.", finishReason: "stop", toolCalls: undefined, functionCall: undefined, usage: { prompt: 6512, completion: 143 } });
    expect(completionOf({ choices: [{ message: { content: "x", tool_calls: [{ id: "call_1" }] }, finish_reason: "tool_calls" }] }))
      .toMatchObject({ finishReason: "tool_calls", toolCalls: [{ id: "call_1" }], usage: undefined });
  });

  it("no usage, a partial usage or an empty choice list never throws", () => {
    expect(completionOf({ choices: [] })).toEqual({ content: null, finishReason: null, toolCalls: undefined, functionCall: undefined, usage: undefined });
    expect(completionOf({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: { prompt_tokens: 10 } })).toMatchObject({ usage: undefined });
    expect(completionOf({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: null })).toMatchObject({ usage: undefined });
  });
});

describe("the daily token meter and cap (usage.ts)", () => {
  it("HUB_AI_DAILY_TOKEN_CAP: a positive whole number, else off", () => {
    expect(dailyTokenCap({})).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "" })).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "0" })).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "-5" })).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "lots" })).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "1.5" })).toBeNull();
    expect(dailyTokenCap({ HUB_AI_DAILY_TOKEN_CAP: "3500000" })).toBe(3_500_000);
  });

  it("reserves a call's estimate before dispatch, settles it to the provider's counts, keeps it without them; a new UTC day starts at zero", async () => {
    const clock = { t: Date.UTC(2026, 9, 8, 23, 50, 0) };
    const meter = new TokenMeter(new MemoryUsageStore(), () => clock.t);
    expect(await meter.today()).toEqual({ day: "2026-10-08", calls: 0, prompt: 0, completion: 0, total: 0 });
    const r1 = (await meter.reserve({ prompt: 7000, completion: 400 }, null))!;
    expect(r1).toEqual({ day: "2026-10-08", prompt: 7000, completion: 400 });
    expect(await meter.today()).toMatchObject({ calls: 1, prompt: 7000, completion: 400, total: 7400 });
    await meter.settle(r1, { prompt: 6512, completion: 143 });
    expect(await meter.today()).toMatchObject({ calls: 1, prompt: 6512, completion: 143, total: 6655 });
    // No counts from the provider (a timeout, a response without usage): the reservation stands.
    const r2 = (await meter.reserve({ prompt: 6400, completion: 400 }, null))!;
    await meter.settle(r2, undefined);
    expect(await meter.today()).toEqual({ day: "2026-10-08", calls: 2, prompt: 12912, completion: 543, total: 13455 });
    clock.t += 15 * 60_000;
    expect(await meter.today()).toEqual({ day: "2026-10-09", calls: 0, prompt: 0, completion: 0, total: 0 });
  });

  it("the cap: a reservation is refused when it would take the day past the cap — the first of the day included — so the counter never passes the cap; clear again the next day", async () => {
    const clock = { t: Date.UTC(2026, 9, 8, 12, 0, 0) };
    const meter = new TokenMeter(new MemoryUsageStore(), () => clock.t);
    expect(await meter.capped(null)).toBe(false);
    // The first reservation is checked like any other: 1,200 never fits under 1,000 (a cap of 1 admits nothing).
    expect(await meter.reserve({ prompt: 1200, completion: 0 }, 1000)).toBeNull();
    expect(await meter.reserve({ prompt: 1, completion: 0 }, 1)).toBeTruthy();
    expect(await meter.reserve({ prompt: 1, completion: 0 }, 1)).toBeNull();
    clock.t += 24 * 3_600_000;
    expect(await meter.today()).toMatchObject({ calls: 0, total: 0 });
    const r1 = (await meter.reserve({ prompt: 900, completion: 99 }, 1000))!;
    expect(r1).toBeTruthy();
    expect(await meter.capped(1000)).toBe(false);
    // 999 + 2 > 1,000: refused. 999 + 1 = 1,000: the last token fits, and the day is then at the cap.
    expect(await meter.reserve({ prompt: 2, completion: 0 }, 1000)).toBeNull();
    expect(await meter.reserve({ prompt: 1, completion: 0 }, 1000)).toBeTruthy();
    expect((await meter.today()).total).toBe(1000);
    expect(await meter.capped(1000)).toBe(true);
    expect(await meter.reserve({ prompt: 1, completion: 0 }, 1000)).toBeNull();
    expect(await meter.capped(null)).toBe(false);
    // Settling to smaller real counts opens the day again — up to the cap, never past it.
    await meter.settle(r1, { prompt: 10, completion: 10 });
    expect(await meter.capped(1000)).toBe(false); // 21
    expect(await meter.reserve({ prompt: 979, completion: 0 }, 1000)).toBeTruthy();
    expect(await meter.reserve({ prompt: 1, completion: 0 }, 1000)).toBeNull();
    expect((await meter.today()).total).toBe(1000);
    clock.t += 24 * 3_600_000;
    expect(await meter.capped(1000)).toBe(false);
    expect(await meter.reserve({ prompt: 1, completion: 1 }, 1000)).toBeTruthy();
  });

  it("the estimate is a bound, not a count (no tokenizer package is installed): one token per UTF-8 byte, 8 framing per message, the whole answer allowance — at or above independently known tokenizations", () => {
    expect(estimateTokens({ messages: [{ content: "abcdef" }, { content: "x" }], max_tokens: 400 })).toEqual({ prompt: 6 + 8 + 1 + 8, completion: 400 });
    expect(estimateTokens({ messages: [], max_tokens: 400 })).toEqual({ prompt: 0, completion: 400 });
    const reserved = (content: string) => estimateTokens({ messages: [{ content }], max_tokens: 0 }).prompt - 8;
    // Known tokenizations, chosen apart from the formula. cl100k_base / o200k_base are byte-level BPE: every
    // token stands for a non-empty byte sequence, so N bytes cost at most N tokens (tiktoken's documented worst
    // case: one single-byte token per byte). Exact counts (tiktoken, cl100k_base):
    //   "hello world"            → 2 tokens  (11 bytes)
    //   "The quick brown fox"    → 4 tokens  (19 bytes)
    //   "a1b2c3d4e5f6g7h8"       → at most 16 tokens (16 bytes; alternating letter/digit falls to single-byte pieces)
    //   "😀" (U+1F600)            → at most 4 tokens (4 bytes; cl100k has it as 1)
    //   "日本語"                   → at most 9 tokens (9 bytes; cl100k gives 3)
    const known: [string, number][] = [
      ["hello world", 2], ["The quick brown fox", 4], ["a1b2c3d4e5f6g7h8", 16], ["😀", 4], ["日本語", 9],
    ];
    for (const [text, tokens] of known) expect(reserved(text), text).toBeGreaterThanOrEqual(tokens);
    // Token-dense inputs at length: alternating letter/digit (every byte its own token at worst), CJK, emoji —
    // the reservation is the byte count, which the byte-level property makes the ceiling.
    const alternating = Array.from({ length: 2000 }, (_, i) => (i % 2 ? String(i % 10) : "abcdefghijklmnopqrstuvwxyz"[i % 26])).join("");
    const cjk = "日本語の文字列を含む建設会社の問い合わせ".repeat(20);
    const emoji = Array.from({ length: 500 }, (_, i) => ["😀", "🏗️", "📞", "🔥", "🚀"][i % 5]).join("");
    for (const text of [alternating, cjk, emoji]) expect(reserved(text)).toBe(Buffer.byteLength(text, "utf8"));
    // Bytes, not JS characters: a surrogate-pair emoji reserves four tokens, never one.
    expect(reserved("😀")).toBe(4);
    expect(reserved("é")).toBe(2);
    expect(reserved("日")).toBe(3);
    // Framing scales with the message count.
    expect(estimateTokens({ messages: [{ content: "" }, { content: "" }, { content: "" }], max_tokens: 0 }).prompt).toBe(24);
  });

  it("the provider's counts above the reservation are counted too, so the next admission sees the real spend", async () => {
    const meter = new TokenMeter(new MemoryUsageStore(), () => Date.UTC(2026, 9, 8));
    const r = (await meter.reserve({ prompt: 100, completion: 0 }, 1000))!;
    await meter.settle(r, { prompt: 850, completion: 100 });
    expect(await meter.today()).toMatchObject({ calls: 1, prompt: 850, completion: 100, total: 950 });
    expect(await meter.reserve({ prompt: 51, completion: 0 }, 1000)).toBeNull();
    expect(await meter.reserve({ prompt: 50, completion: 0 }, 1000)).toBeTruthy();
  });

  it("odd counts (negative, fractional, NaN) never reduce or break the total", async () => {
    const meter = new TokenMeter(new MemoryUsageStore(), () => Date.UTC(2026, 9, 8));
    const r = (await meter.reserve({ prompt: -5, completion: 2.9 }, null))!;
    expect(await meter.today()).toMatchObject({ calls: 1, prompt: 0, completion: 2, total: 2 });
    await meter.settle(r, { prompt: Number.NaN, completion: 1 });
    expect(await meter.today()).toMatchObject({ calls: 1, prompt: 0, completion: 1, total: 1 });
    await meter.settle((await meter.reserve({ prompt: 3, completion: 3 }, null))!, { prompt: -9, completion: -9 });
    expect(await meter.today()).toMatchObject({ calls: 2, prompt: 0, completion: 1, total: 1 });
  });
});
