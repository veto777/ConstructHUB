import { describe, expect, it } from "vitest";
import { heuristicSentiment, playbookFor, positionWeight, reputationScore, scoreGrade } from "@shared/reputation";
import { annualCents } from "./prices";
import { parseSerp } from "./scan";
import { brokerRequestText, itemKey } from "./routes";

describe("reputation score", () => {
  it("weighs negatives by position", () => {
    expect(positionWeight(1)).toBe(25);
    expect(positionWeight(7)).toBe(6);
    expect(positionWeight(15)).toBe(2);
    expect(positionWeight(30)).toBe(0);
  });
  it("starts at 100, takes off negatives and bad predictions, adds owned page-1 results", () => {
    const neg = (position: number) => ({ position, sentiment: "negative" as const, control: "third_party" as const });
    const own = (position: number) => ({ position, sentiment: "neutral" as const, control: "owned" as const });
    expect(reputationScore([], [])).toBe(100);
    expect(reputationScore([neg(1), neg(4)], [])).toBe(65);
    expect(reputationScore([neg(1), own(2), own(3)], [{ sentiment: "negative" }])).toBe(100 - 25 - 5 + 4);
    expect(reputationScore([neg(1), neg(2), neg(3), neg(4), neg(5), neg(6)], Array(9).fill({ sentiment: "negative" }))).toBe(0);
  });
  it("grades", () => {
    expect([95, 85, 70, 55, 20].map(scoreGrade)).toEqual(["A", "B", "C", "D", "F"]);
  });
  it("annual prepay takes 10% off twelve months", () => {
    expect(annualCents(150_000)).toBe(1_620_000);
  });
});

describe("classification fallback and playbooks", () => {
  it("marks complaint sites and negative terms", () => {
    expect(heuristicSentiment("Acme Roofing", "www.ripoffreport.com").sentiment).toBe("negative");
    expect(heuristicSentiment("Jane Smith arrested in Tampa", "news.com").reason).toMatch(/arrest/);
    expect(heuristicSentiment("Jane Smith — Realtor", "zillow.com").sentiment).toBe("neutral");
  });
  it("picks the playbook by domain or kind", () => {
    expect(playbookFor("m.youtube.com", "video")).toBe("youtube-privacy");
    expect(playbookFor("www.glassdoor.com", "result")).toBe("glassdoor");
    expect(playbookFor(null, "autocomplete")).toBe("google-autocomplete");
    expect(playbookFor("example.com", "result")).toBeNull();
  });
});

describe("SERP parsing and item keys", () => {
  it("reads organic, video, image and news blocks in page order", () => {
    const raw = parseSerp([
      { type: "organic", rank_absolute: 1, url: "https://www.example.com/a", domain: "www.example.com", title: "A", description: "about A" },
      { type: "video", rank_absolute: 2, items: [{ url: "https://www.youtube.com/watch?v=1", title: "V" }] },
      { type: "images", rank_absolute: 3, items: [{ url: "https://pics.example.org/p", alt: "photo" }] },
      { type: "top_stories", rank_absolute: 4, items: [{ url: "https://news.example.net/s", domain: "news.example.net", title: "S", source: "Paper" }] },
      { type: "people_also_ask", rank_absolute: 5 },
    ]);
    expect(raw.map((r) => [r.kind, r.position])).toEqual([["result", 1], ["video", 2], ["image", 3], ["news", 4]]);
    expect(raw[1].domain).toBe("youtube.com");
  });
  it("keys a URL without www or trailing slash, and a prediction by its text", () => {
    expect(itemKey({ kind: "result", url: "https://www.Example.com/a/", title: "" })).toBe("url:example.com/a");
    expect(itemKey({ kind: "autocomplete", url: null, title: "Jane Smith Scam" })).toBe("ac:jane smith scam");
  });
  it("builds a broker opt-out email with placeholders for what we don't know", () => {
    const t = brokerRequestText({ key: "x", name: "PeopleX", domain: "peoplex.com", category: "people_search", priority: 1, optOutUrl: null, optOutEmail: "privacy@peoplex.com", method: "email", requires: [], notes: null, sources: [] }, "Jane Smith", null);
    expect(t).toContain("To: privacy@peoplex.com");
    expect(t).toContain("[paste the listing URL]");
  });
});
