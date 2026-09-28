import { describe, it, expect } from "vitest";
import { analyzeReviews, analyzeBsScore, presentListing } from "./competitor-analysis";
describe("review sample heuristics", () => {
  it("does not infer velocity from lifetime counts and the oldest sampled date", () => {
    const reviews = [{ text: "Great job", rating: 5, relative_time_description: "a month ago" }];
    for (const count of [1, 5000]) {
      const result = analyzeReviews(reviews, { user_ratings_total: count }, "roofing");
      expect(result.totalAnalyzed).toBe(1);
      expect(result.reviewVelocityFlag).toBe(false);
      expect(result.reviewVelocityNote).toContain("unavailable");
    }
  });
  it("does not score missing provider profile links as hired reviewers", () => {
    const result = analyzeReviews(Array(5).fill({ text: "Repaired my roof", rating: 4 }), {}, "roofing");
    const score = analyzeBsScore({ name: "Fixture", formatted_address: "Fixture street" }, result);
    expect(score.score).toBe(0);
    expect(score.reasons.join(" ")).not.toMatch(/hired|fake|AI-generated/);
  });
  it("replaces legacy accusations and false velocity claims at read time", () => {
    const result = presentListing({ businessName: "Fixture", address: "Fixture street", bsScore: 99,
      bsReasons: ["likely hired reviewers"], reviewAnalysis: { totalAnalyzed: 5, reviewVelocityFlag: true, reviewVelocityNote: "fake" } });
    expect(result.reviewAnalysis.reviewVelocityFlag).toBe(false);
    expect(result.bsReasons.join(" ")).not.toMatch(/hired|fake/);
  });
});
