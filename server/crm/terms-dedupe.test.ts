import { describe, expect, it } from "vitest";
import { isSameTerms } from "@shared/terms-dedupe";

const sections = Array.from({ length: 10 }, (_, i) => `${i + 1}. Section ${i + 1}: the homeowner and the contractor agree to clause number ${i + 1} in full.`);

describe("isSameTerms", () => {
  it("treats an older copy of the same terms as the same document", () => {
    const older = sections.join("\n");
    const newer = ["LIFETIME WORKMANSHIP WARRANTY: Alpine is the only company that offers it, see section 18 for details.",
      ...sections.slice(0, 7), "8. Section 8 was reworded entirely for the new warranty terms and the inspection rules.", ...sections.slice(8)].join("\n");
    expect(isSameTerms(older, newer)).toBe(true);
  });
  it("keeps genuinely different estimate terms", () => {
    const other = ["Special terms for this job: the HOA must approve the colour before work starts on site.",
      "The homeowner moves the hot tub away from the north wall before the crew arrives on day one.",
      "Permit fees are billed at cost on the final invoice for this estimate and this estimate only."].join("\n");
    expect(isSameTerms(other, sections.join("\n"))).toBe(false);
  });
  it("is false for empty text", () => {
    expect(isSameTerms("", sections.join("\n"))).toBe(false);
  });
});
