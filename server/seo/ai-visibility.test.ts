import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aiDeps, askAi, askEstimateUsd, askInput, fetchAiAnswer, fetchAiMentions, groupAiChecks, namedBusinesses, plainText, readAnswer, suggestPrompts } from "./ai-visibility";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ai-fixture.json", import.meta.url), "utf8"));
const original = { ...aiDeps };
afterEach(() => { Object.assign(aiDeps, original); });
const answerFrom = (path: string) => (path.includes("chat_gpt") ? fixture.chat_gpt : path.includes("gemini") ? fixture.gemini : path.includes("perplexity") ? fixture.perplexity : fixture.mentions);
const site = { domain: "alpineexteriorswa.com", businessName: "Alpine Exteriors" };

describe("reading an answer", () => {
  it("plainText keeps the words and drops the markdown", () => {
    expect(plainText("**[Topside Roofing](https://x.com/?utm=1)**  \n_161 E Horton Rd_ [1] ![img](http://i/x.png)")).toBe("Topside Roofing\n161 E Horton Rd");
  });
  it("finds the businesses named and skips lines of details", () => {
    expect(namedBusinesses("**[Topside Roofing & Siding](https://t.com)**\n**Open now · Roofing contractor · 4.6 (116 reviews)**\n**Alpine Exteriors | Siding, Roofing & Windows:**\n**Key Benefits**\n**SIDINV787PJ**\n**Topside Roofing & Siding**"))
      .toEqual(["Topside Roofing & Siding", "Alpine Exteriors | Siding, Roofing & Windows"]);
  });
  it("named, used as a source, and where in the list", () => {
    const r = readAnswer("**Big Roofer**\nGood.\n\n**[Alpine Exteriors | Siding, Roofing & Windows](http://alpineexteriorswa.com/?utm_source=openai)**\nAlso good.", [{ title: "Alpine Exteriors", url: "http://alpineexteriorswa.com/?utm_source=openai" }, { title: "Yelp", url: "https://www.yelp.com/x" }], site);
    expect(r).toMatchObject({ mentioned: true, cited: true, listedAt: 2, businesses: ["Big Roofer", "Alpine Exteriors | Siding, Roofing & Windows"] });
    expect(r.sources).toEqual([{ domain: "alpineexteriorswa.com", title: "Alpine Exteriors", url: "http://alpineexteriorswa.com/", ours: true }, { domain: "yelp.com", title: "Yelp", url: "https://www.yelp.com/x", ours: false }]);
  });
  it("not named: a business that merely shares a word does not count", () => {
    const r = readAnswer("**Alpine Roofing Supply**\nA supplier.\n**Other Co**", [{ title: "yelp.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA" }], site);
    expect(r).toMatchObject({ mentioned: false, cited: false, listedAt: null });
    // Gemini's redirect address is not kept; the site it names is
    expect(r.sources).toEqual([{ domain: "yelp.com", title: null, url: null, ours: false }]);
  });
  it("a one-word name, or our address inside a longer one, is not a mention", () => {
    expect(readAnswer("We value quality work above all.", [], { domain: "quality.example", businessName: "Quality LLC" }).mentioned).toBe(false);
    expect(readAnswer("**Quality LLC**\nA contractor.", [], { domain: "quality.example", businessName: "Quality LLC" }).mentioned).toBe(true);
    expect(readAnswer("Try notalpineexteriorswa.com or alpineexteriorswa.com.au", [], { domain: "alpineexteriorswa.com" }).mentioned).toBe(false);
    expect(readAnswer("Visit https://www.alpineexteriorswa.com/quote today.", [], { domain: "alpineexteriorswa.com" }).mentioned).toBe(true);
  });
  it("named in the running text counts, and so does the web address; unsafe links are dropped", () => {
    expect(readAnswer("People often recommend Alpine Exteriors for siding.", [], site).mentioned).toBe(true);
    expect(readAnswer("See alpineexteriorswa.com for a quote.", [], { domain: "alpineexteriorswa.com" }).mentioned).toBe(true);
    expect(readAnswer("x", [{ title: "t", url: "javascript:alert(1)" }], site).sources).toEqual([]);
    // a title that looks like our site does not make an unsafe or missing address a citation of us
    expect(readAnswer("x", [{ title: "alpineexteriorswa.com", url: "javascript:alert(1)" }, { title: "alpineexteriorswa.com" }], site).cited).toBe(false);
    // ...but Gemini's redirect address with the site in the title is one
    expect(readAnswer("x", [{ title: "alpineexteriorswa.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA" }], site).cited).toBe(true);
    expect(readAnswer("x", [{ title: "alpineexteriorswa.com", url: "https://evil-vertexaisearch.cloud.google.com.example/x" }], site).cited).toBe(false);
  });
});

describe("the real answers saved on 2026-10-08", () => {
  it("ChatGPT named Alpine Exteriors and used its site; Gemini and Perplexity did not", async () => {
    aiDeps.request = (async (_m: string, path: string) => answerFrom(path)) as typeof aiDeps.request;
    const out = await askAi("Who are the best siding contractors in Bellingham, WA? Name specific companies.", ["chatgpt", "gemini", "perplexity"], site);
    const by = Object.fromEntries(out.data.answers.map((a) => [a.engine, a]));
    expect(by.chatgpt).toMatchObject({ mentioned: true, cited: true, listedAt: 2 });
    expect(by.chatgpt.businesses[0]).toBe("Topside Roofing & Siding");
    expect(by.chatgpt.searches).toEqual(["best siding contractors in Bellingham WA"]);
    expect(by.gemini).toMatchObject({ mentioned: false, cited: false });
    expect(by.gemini.sources.map((s) => s.domain)).toContain("sidingwindowvault.com");
    expect(by.perplexity).toMatchObject({ mentioned: false, cited: false });
    expect(out.data.failed).toEqual([]);
    expect(out.costUsd).toBeCloseTo(0.027039 + 0.035746 + 0.005912, 6);
    expect(by.chatgpt.answer).not.toContain("**");
  });
  it("one assistant failing leaves the others, and counts what it cost", async () => {
    aiDeps.request = (async (_m: string, path: string) => { if (path.includes("gemini")) throw Object.assign(new Error("timed out"), { code: "timeout", costUsd: 0 }); if (path.includes("perplexity")) throw Object.assign(new Error("failed after charging"), { code: "task_failed", costUsd: 0.004 }); return answerFrom(path); }) as typeof aiDeps.request;
    const charged = await askAi("a question long enough", ["chatgpt", "perplexity"], site);
    // what the failed assistant cost is ours, not the customer's
    expect(charged.costUsd).toBeCloseTo(0.027039 + 0.004, 6);
    expect(charged.customerUsd).toBeCloseTo(0.027039, 6);
    const out = await askAi("a question long enough", ["chatgpt", "gemini"], site);
    expect(out.data.answers.map((a) => a.engine)).toEqual(["chatgpt"]);
    expect(out.data.failed).toEqual(["gemini"]);
    expect(out.costUnknown).toBe(true);
  });
  it("all failing throws with the cost", async () => {
    aiDeps.request = (async () => { throw Object.assign(new Error("boom"), { costUsd: 0.01 }); }) as typeof aiDeps.request;
    const e: any = await askAi("a question long enough", ["chatgpt", "perplexity"], site).catch((x) => x);
    expect(e.message).toBe("boom");
    expect(e.costUsd).toBeCloseTo(0.02, 6);
  });
  it("sends the question with web search on and a cap on the answer", async () => {
    let sent: any = null;
    aiDeps.request = (async (_m: string, path: string, body: any) => { sent = { path, body: body[0] }; return answerFrom(path); }) as typeof aiDeps.request;
    await fetchAiAnswer("perplexity", "who is best", site);
    expect(sent).toEqual({ path: "/ai_optimization/perplexity/llm_responses/live", body: { user_prompt: "who is best", model_name: "sonar", web_search: true, max_output_tokens: 700 } });
  });
  it("AI mentions: the questions an AI answer uses the site for", async () => {
    aiDeps.request = (async (_m: string, path: string) => answerFrom(path)) as typeof aiDeps.request;
    const out = await fetchAiMentions({ domain: "jameshardie.com", platform: "google" });
    expect(out.data.total).toBe(3901);
    expect(out.data.rows[0]).toMatchObject({ question: "fiber concrete siding", searches: 74000 });
    expect(out.data.rows[0].answer).not.toContain("![");
    expect(out.costUsd).toBeCloseTo(0.102, 6);
  });
});

describe("history, prices and suggestions", () => {
  it("groups saved checks by question: the newest per assistant, the rest as history", () => {
    const row = (prompt: string, engine: string, mentioned: boolean, at: string) => ({ prompt, engine, model: "m", mentioned, cited: false, listed_at: null, businesses: [], sources: [], searches: [], answer: "a", created_at: at });
    const g = groupAiChecks([row("Best roofer in Tampa?", "chatgpt", true, "2026-10-08T10:00:00Z"), row("best roofer in  tampa?", "gemini", false, "2026-10-08T10:00:00Z"), row("Best roofer in Tampa?", "chatgpt", false, "2026-09-08T10:00:00Z"), row("Other question", "chatgpt", false, "2026-09-01T10:00:00Z")]);
    expect(g.map((p) => [p.prompt, p.latest.map((l) => l.engine), p.history.length])).toEqual([["Best roofer in Tampa?", ["chatgpt", "gemini"], 1], ["Other question", ["chatgpt"], 0]]);
    expect(g[0].history[0]).toMatchObject({ engine: "chatgpt", mentioned: false });
  });
  it("the reserve covers what each assistant was measured to cost", () => {
    expect(askEstimateUsd(["chatgpt"])).toBeGreaterThan(0.027039);
    expect(askEstimateUsd(["gemini"])).toBeGreaterThan(0.035746);
    expect(askEstimateUsd(["perplexity"])).toBeGreaterThan(0.005912);
    expect(askEstimateUsd(["chatgpt", "gemini", "perplexity"])).toBeCloseTo(0.125, 6);
  });
  it("validates a question", () => {
    expect(askInput.safeParse({ prompt: "Who is the best roofer in Tampa?", engines: ["chatgpt"] }).success).toBe(true);
    expect(askInput.safeParse({ prompt: "short", engines: ["chatgpt"] }).success).toBe(false);
    expect(askInput.safeParse({ prompt: "Who is the best roofer in Tampa?", engines: [] }).success).toBe(false);
    expect(askInput.safeParse({ prompt: "Who is the best roofer in Tampa?", engines: ["bard"] }).success).toBe(false);
  });
  it("suggests questions from tracked keywords and their places", () => {
    expect(suggestPrompts([{ keyword: "siding contractor", location: "Bellingham, Washington" }, { keyword: "roof repair near me", location: "Bellingham, Washington" }, { keyword: "siding contractor", location: "United States" }]))
      .toEqual(["Who are the best siding contractor companies in Bellingham? Name specific businesses.", "Who are the best roof repair companies in Bellingham? Name specific businesses."]);
    expect(suggestPrompts([{ keyword: "siding contractor", location: null }, { keyword: "roofer", location: null }])).toEqual(["Who are the best siding contractor companies near me? Name specific businesses."]);
  });
});
