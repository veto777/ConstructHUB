import { describe, expect, it } from "vitest";
import { hubAiEnv } from "../../scripts/tutorials/app";

describe("recording slot: opt-in local model server for Gabe", () => {
  it("passes nothing without the opt-in key", () => {
    expect(hubAiEnv({})).toEqual({});
  });
  it("accepts a loopback base and defaults the model", () => {
    expect(hubAiEnv({ TUTORIAL_HUB_AI_KEY: "k", TUTORIAL_HUB_AI_BASE: "http://127.0.0.1:8250/api" })).toEqual({
      AI_INTEGRATIONS_OPENAI_API_KEY: "k", AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:8250/api", AI_MODEL: "truthcode-api",
    });
  });
  it("refuses any host that is not this machine", () => {
    expect(() => hubAiEnv({ TUTORIAL_HUB_AI_KEY: "k", TUTORIAL_HUB_AI_BASE: "https://api.openai.com/v1" })).toThrow(/loopback/);
    expect(() => hubAiEnv({ TUTORIAL_HUB_AI_KEY: "k" })).toThrow(/loopback/);
  });
});
