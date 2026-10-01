import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), options: [] as any[] }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { mocks.options.push(options); }
  chat = { completions: { create: mocks.create } };
} }));
vi.mock("./growth-limits", () => ({
  chatInput: { safeParse: (data: unknown) => ({ success: true, data }) },
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
  siteChatGate: async () => "ok",
}));
import { registerSiteAssistantRoutes } from "./site-assistant";

let handler: Function;
registerSiteAssistantRoutes({ post: (_path: string, ...handlers: Function[]) => { handler = handlers.at(-1)!; } } as any);
const completion = (content: string, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content } }] });
async function ask() {
  const res: any = { statusCode: 200, status(n: number) { this.statusCode = n; return this; }, json(body: unknown) { this.body = body; return this; } };
  await handler({ body: { messages: [{ role: "user", content: "CODEX- What plans do you offer?" }] } }, res);
  return res;
}
beforeEach(() => { mocks.create.mockReset(); });

describe("site assistant output boundary", () => {
  it("removes private reasoning and tool markers before sending a reply", async () => {
    const answer = "Starter costs $29 per month. Pro costs $79 per month.";
    mocks.create.mockResolvedValueOnce(completion(`<think>Need to consult the price book.</think>\n[web_research: prices]\n${answer}`));
    expect((await ask()).body).toEqual({ reply: answer });
  });
  it("retries a tool-only answer once, then reports an honest 503", async () => {
    mocks.create.mockResolvedValue(completion('<tool_call>{"name":"web_research"}</tool_call>'));
    const res = await ask();
    expect(res.statusCode).toBe(503);
    expect(res.body).toHaveProperty("message");
    expect(res.body).not.toHaveProperty("reply");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("retries cut-off text instead of serving an unfinished price answer", async () => {
    mocks.create.mockResolvedValueOnce(completion("Our plans include Starter and", "length"))
      .mockResolvedValueOnce(completion("Starter costs $29 per month. Pro costs $79 per month."));
    expect((await ask()).body.reply).toBe("Starter costs $29 per month. Pro costs $79 per month.");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("uses the shared timeout and never logs an upstream error body", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.create.mockRejectedValue(new Error("CODEX-sensitive-provider-body"));
      expect((await ask()).statusCode).toBe(503);
      expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("CODEX-sensitive-provider-body");
      expect(mocks.options[0].timeout).toBeGreaterThan(0);
      expect(mocks.options[0].maxRetries).toBeLessThanOrEqual(1);
    } finally { log.mockRestore(); }
  });
});
