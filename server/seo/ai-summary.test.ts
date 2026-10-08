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
    expect(summariseAi([], { now })).toEqual({ nowDays: 120, now: { answers: 0, mentioned: 0, cited: 0, questions: 0, first: 0 }, byEngine: [], byMonth: [], businesses: [], sources: [] });
    const s = summariseAi([a("q", "chatgpt", "2026-10-01", { businesses: "not a list" as any, sources: [{ nothing: 1 }, null, { domain: 5 }] as any })], { now });
    expect([s.businesses, s.sources]).toEqual([[], []]);
  });
});
