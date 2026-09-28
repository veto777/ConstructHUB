import { describe, expect, it } from "vitest";
import { reviewDraftPrompt } from "./review-draft";

describe("honest review drafting", () => {
  it.each([1, 5, 8, 9, 10])("preserves customer sentiment at rating %i", rating => {
    const prompt = reviewDraftPrompt("Test Company", rating, "The crew arrived late and left debris.");
    expect(prompt).toContain(`${rating}/10`);
    expect(prompt).toContain("The crew arrived late and left debris.");
    expect(prompt).toContain("including criticism or a mixed experience");
    expect(prompt).toContain("Do not invent");
    expect(prompt).not.toMatch(/5-star worthy|enthusiastic|End with a recommendation/);
  });
});
