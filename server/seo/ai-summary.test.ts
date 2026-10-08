import { describe, expect, it } from "vitest";
import { summariseAi, type AiCheckLite } from "./ai-summary";

const now = new Date("2026-10-08T12:00:00Z");
const a = (prompt: string, engine: string, at: string, o: Partial<AiCheckLite> = {}): AiCheckLite => ({ prompt, engine, at: `${at}T10:00:00.000Z`, mentioned: false, cited: false, listedAt: null, businesses: [], sources: [], ...o });
describe("AI visibility added up", () => {
  it("now = the newest answer to each question from each assistant; a question asked often does not weigh more", () => {
    const s = summariseAi([
      a("best roofer in Bellingham", "chatgpt", "2026-10-01", { mentioned: true, listedAt: 1, businesses: ["Alpine Exteriors", "Topside Roofing LLC", "Skyline"], sources: [{ domain: "www.yelp.com", ours: false }, { domain: "alpine.example", ours: true }], cited: true }),
      a("best roofer in Bellingham", "chatgpt", "2026-09-01", { mentioned: false, businesses: ["Topside Roofing"] }),   // older answer to the same question: not "now"
      a("Best roofer in  Bellingham", "gemini", "2026-10-01", { mentioned: false, businesses: ["Topside Roofing", "Skyline", "Topside Roofing, LLC"], sources: [{ domain: "yelp.com", ours: false }, { domain: "blog.topside.example", ours: false }] }),
      a("siding contractor near me", "chatgpt", "2026-10-02", { mentioned: true, listedAt: 2, businesses: ["Skyline", "Alpine Exteriors"], sources: [{ domain: "yelp.com", ours: false }] }),
      a("old question", "chatgpt", "2026-03-01", { mentioned: true }),   // too old to say anything about now
      // The customer's own business under a spelling the answer's list reading did not match: still not an "other business".
      a("siding contractor near me", "gemini", "2026-10-02", { mentioned: true, listedAt: null, businesses: ["Alpine Exteriors (Bellingham)", "alpine.example — siding"] }),
    ], { rivals: ["topside.example"], now, businessName: "Alpine Exteriors", domain: "www.alpine.example" });
    expect(s.now).toEqual({ answers: 4, mentioned: 3, cited: 1, questions: 2, first: 1 });
    expect(s.byEngine).toEqual([{ engine: "chatgpt", answers: 2, mentioned: 2, cited: 1 }, { engine: "gemini", answers: 2, mentioned: 1, cited: 0 }]);
    // Other businesses: this business itself is left out; one name written three ways is one business, counted once per answer.
    expect(s.businesses).toEqual([{ name: "Skyline", answers: 3, questions: 2 }, { name: "Topside Roofing", answers: 2, questions: 1 }]);
    expect(s.sources).toEqual([
      { domain: "yelp.com", answers: 3, questions: 2, ours: false, rival: false, directory: "Yelp" },
      { domain: "alpine.example", answers: 1, questions: 1, ours: true, rival: false },
      { domain: "blog.topside.example", answers: 1, questions: 1, ours: false, rival: true },
    ]);
  });
  it("a month is the newest answer to each question from each assistant within it; only months with answers", () => {
    const s = summariseAi([
      a("q1", "chatgpt", "2026-08-03", { mentioned: false }), a("q1", "chatgpt", "2026-08-20", { mentioned: true }),
      a("q1", "chatgpt", "2026-10-01", { mentioned: true, cited: true }), a("q2", "gemini", "2026-10-01"),
      a("q1", "chatgpt", "2025-09-30", { mentioned: true }),   // more than twelve months back
    ], { now });
    expect(s.byMonth).toEqual([{ month: "2026-08", answers: 1, mentioned: 1, cited: 0, questions: 1 }, { month: "2026-10", answers: 2, mentioned: 1, cited: 1, questions: 2 }]);
  });
  it("nothing saved is nothing claimed; odd saved shapes are ignored", () => {
    expect(summariseAi([], { now })).toEqual({ nowDays: 120, now: { answers: 0, mentioned: 0, cited: 0, questions: 0, first: 0 }, byEngine: [], byMonth: [], trend: { months: [], answers: [], questions: [], you: [], names: [] }, compare: null, businesses: [], sources: [] });
    const s = summariseAi([a("q", "chatgpt", "2026-10-01", { businesses: "not a list" as any, sources: [{ nothing: 1 }, null, { domain: 5 }] as any })], { now });
    expect([s.businesses, s.sources]).toEqual([[], []]);
  });
  it("names over time, and two months compared only over the questions both asked the same assistant", () => {
    const rows = [
      // August: q1 on ChatGPT and Gemini, plus a question never asked again.
      a("q1", "chatgpt", "2026-08-05", { businesses: ["Topside Roofing", "Skyline"], sources: [{ domain: "yelp.com", ours: false }] }),
      a("q1", "gemini", "2026-08-05", { businesses: ["Topside Roofing"] }),
      a("only in august", "chatgpt", "2026-08-06", { businesses: ["Skyline", "Bay Gutters"] }),
      // September: q1 on ChatGPT only.
      a("q1", "chatgpt", "2026-09-05", { mentioned: true, businesses: ["Skyline"] }),
      // October: q1 on both, plus a new question.
      a("q1", "chatgpt", "2026-10-02", { mentioned: true, listedAt: 1, cited: true, businesses: ["Alpine Exteriors", "Skyline", "Peak Siding"], sources: [{ domain: "alpine.example", ours: true }, { domain: "homeadvisor.com", ours: false }] }),
      a("q1", "gemini", "2026-10-02", { businesses: ["Topside Roofing", "Peak Siding"], sources: [{ domain: "yelp.com", ours: false }] }),
      a("new in october", "perplexity", "2026-10-03", { businesses: ["Bay Gutters"] }),
    ];
    const s = summariseAi(rows, { now, businessName: "Alpine Exteriors", rivals: ["homeadvisor.com"] });
    expect(s.trend.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect([s.trend.answers, s.trend.questions, s.trend.you]).toEqual([[3, 1, 3], [2, 1, 2], [0, 1, 1]]);
    expect(s.trend.names).toEqual([
      { name: "Skyline", counts: [2, 1, 1] }, { name: "Topside Roofing", counts: [2, 0, 1] }, { name: "Bay Gutters", counts: [1, 0, 1] }, { name: "Peak Siding", counts: [0, 0, 2] },
    ]);
    // Default: October against September (the latest month sharing a pair) — only q1 on ChatGPT is in both.
    expect(s.compare).toMatchObject({ from: "2026-09", to: "2026-10", options: ["2026-09", "2026-08"], pairs: 1, questions: 1, you: { before: 1, after: 1 }, cited: { before: 0, after: 1 } });
    expect(s.compare!.names).toEqual([{ name: "Peak Siding", before: 0, after: 1 }, { name: "Skyline", before: 1, after: 1 }]);
    // Against August: q1 on both assistants; the question asked only in August and the one new in October do not count.
    const v = summariseAi(rows, { now, businessName: "Alpine Exteriors", rivals: ["homeadvisor.com"], vs: "2026-08" }).compare!;
    expect([v.from, v.pairs, v.questions, v.you, v.cited]).toEqual(["2026-08", 2, 1, { before: 0, after: 1 }, { before: 0, after: 1 }]);
    expect(v.names).toEqual([{ name: "Peak Siding", before: 0, after: 2 }, { name: "Topside Roofing", before: 2, after: 1 }, { name: "Skyline", before: 1, after: 1 }]);
    expect(v.sources).toEqual([{ domain: "homeadvisor.com", before: 0, after: 1, rival: true }, { domain: "yelp.com", before: 1, after: 1, rival: false }]);
    // A month that shares nothing, or one not on record, falls back to the default; a single month has nothing to compare.
    expect(summariseAi(rows, { now, vs: "2026-01" }).compare!.from).toBe("2026-09");
    expect(summariseAi([rows[0]], { now }).compare).toBeNull();
  });
});
