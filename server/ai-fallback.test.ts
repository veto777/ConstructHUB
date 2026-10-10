/** TruthCoder first, OpenAI's cheapest model second (server/ai-fallback.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackSettings, hasImages, openAiFallbackBody, primarySkipped, resetFallbackState, runWithFallback } from "./ai-fallback";

const ENV = { AI_FALLBACK_OPENAI_API_KEY: "sk-test", AI_FALLBACK_AFTER_MS: "50", AI_FALLBACK_COOLDOWN_MS: "1000" } as NodeJS.ProcessEnv;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
  const t = setTimeout(() => resolve("truthcode"), ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
});

beforeEach(() => { resetFallbackState(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("settings", () => {
  it("is off without a key or with AI_FALLBACK=off, and only allows the cheap models", () => {
    expect(fallbackSettings({} as any)).toBeNull();
    expect(fallbackSettings({ ...ENV, AI_FALLBACK: "off" })).toBeNull();
    expect(fallbackSettings({ HUB_OPENAI_API_KEY: "sk-hub" } as any)?.key).toBe("sk-hub");
    expect(fallbackSettings(ENV)?.model).toBe("gpt-5.4-nano");
    expect(fallbackSettings({ ...ENV, AI_FALLBACK_MODEL: "gpt-5.4-mini" })?.model).toBe("gpt-5.4-mini");
    expect(fallbackSettings({ ...ENV, AI_FALLBACK_MODEL: "gpt-5.4-pro" })?.model).toBe("gpt-5.4-nano");
    const d = fallbackSettings({ AI_FALLBACK_OPENAI_API_KEY: "k" } as any)!;
    expect([d.afterMs, d.visionAfterMs, d.cooldownMs]).toEqual([30_000, 90_000, 60_000]);
  });
  it("translates the request for GPT-5 and spots photos", () => {
    expect(openAiFallbackBody({ model: "truthcode-api", temperature: 0.3, top_p: 1, stop: ["x"], max_tokens: 500, messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } }, "gpt-5.4-nano"))
      .toEqual({ model: "gpt-5.4-nano", messages: [{ role: "user", content: "hi" }], reasoning_effort: "none", stream: false, max_completion_tokens: 500, response_format: { type: "json_object" } });
    expect(hasImages([{ role: "user", content: [{ type: "text", text: "a" }, { type: "image_url", image_url: { url: "x" } }] }])).toBe(true);
    expect(hasImages([{ role: "user", content: "a" }])).toBe(false);
  });
});

describe("runWithFallback", () => {
  it("without a key, only TruthCoder runs", async () => {
    const fb = vi.fn();
    await expect(runWithFallback(() => Promise.reject(new Error("down")), fb, { env: {} as any })).rejects.toThrow("down");
    expect(fb).not.toHaveBeenCalled();
  });
  it("TruthCoder answering in time wins; OpenAI is never called", async () => {
    const fb = vi.fn();
    expect(await runWithFallback((s) => sleep(5, s), fb, { env: ENV })).toBe("truthcode");
    expect(fb).not.toHaveBeenCalled();
  });
  it("a slow TruthCoder is cancelled at the wait and OpenAI answers", async () => {
    let aborted = false;
    const out = await runWithFallback((s) => { s.addEventListener("abort", () => { aborted = true; }); return sleep(5_000, s); },
      async (_s, cfg) => `openai:${cfg.model}`, { env: ENV });
    expect(out).toBe("openai:gpt-5.4-nano");
    expect(aborted).toBe(true);
  });
  it("a TruthCoder error goes to OpenAI at once, then TruthCoder is skipped during the cooldown", async () => {
    const primary = vi.fn(() => Promise.reject(Object.assign(new Error("502"), { status: 502 })));
    const t0 = Date.now();
    expect(await runWithFallback(primary, async () => "openai", { env: ENV })).toBe("openai");
    expect(Date.now() - t0).toBeLessThan(40);
    expect(primarySkipped()).toBe(true);
    expect(await runWithFallback(primary, async () => "openai again", { env: ENV })).toBe("openai again");
    expect(primary).toHaveBeenCalledTimes(1);
  });
  it("when OpenAI fails too (no credit), the caller gets TruthCoder's error and no cooldown starts", async () => {
    const tcErr = Object.assign(new Error("truthcode 503"), { status: 503 });
    await expect(runWithFallback(() => Promise.reject(tcErr), () => Promise.reject(Object.assign(new Error("insufficient_quota"), { status: 429 })), { env: ENV })).rejects.toBe(tcErr);
    expect(primarySkipped()).toBe(false);
  });
  it("in the cooldown, a failing OpenAI hands back to TruthCoder", async () => {
    await runWithFallback(() => Promise.reject(new Error("down")), async () => "openai", { env: ENV });
    expect(await runWithFallback(async () => "truthcode back", () => Promise.reject(new Error("no credit")), { env: ENV })).toBe("truthcode back");
    expect(primarySkipped()).toBe(false);
  });
  it("the caller's own cancel is not a TruthCoder failure", async () => {
    const ac = new AbortController();
    const fb = vi.fn();
    const p = runWithFallback((s) => sleep(5_000, s), fb, { env: ENV, signal: ac.signal, waitMs: 1_000 });
    ac.abort();
    await expect(p).rejects.toThrow("aborted");
    expect(fb).not.toHaveBeenCalled();
  });
  it("photos give TruthCoder the longer vision wait", async () => {
    const fb = vi.fn(async () => "openai");
    expect(await runWithFallback((s) => sleep(120, s), fb, { env: { ...ENV, AI_FALLBACK_VISION_AFTER_MS: "1000" }, vision: true })).toBe("truthcode");
    expect(fb).not.toHaveBeenCalled();
  });
});
