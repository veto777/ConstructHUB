import { describe, expect, it } from "vitest";
import { LESSON_MODULES } from "./lessons";
import { blockTexts } from "./content";

const lessonText = (module: keyof typeof LESSON_MODULES, id: string) => LESSON_MODULES[module].lessons.find((l) => l.id === id)!.blocks.flatMap(blockTexts).join("\n");
const all = Object.values(LESSON_MODULES).flatMap((m) => [...m.lessons.flatMap((l) => l.blocks), ...(m.footer ?? [])]).flatMap(blockTexts).join("\n");
const stateLink = "[check your state](/master-class?tab=state-guide)";

describe("Master Class trustworthy instruction", () => {
  it("does not teach concealment, invented size, or incentivized reviews", () => {
    for (const claim of ["Creating the illusion of size is critical", "never tell the client you're the owner", "Tell them you're the PM or the sales rep", "Make sure subs keep this anonymous", "trade it for a written positive review", "Never say you're available same day", "Amazon does this with their delivery drivers"]) {
      expect(all).not.toContain(claim);
    }
    expect(lessonText("licensing", "branding")).toContain("If you are the owner-operator, say so");
    expect(lessonText("licensing", "subcontractors")).toContain("Identify the subcontractor and their role");
    expect(lessonText("licensing", "reputation")).toContain("never exchange work, discounts or refunds for reviews");
  });

  it("replaces universal employment claims with jurisdiction-qualified, dated official sources", () => {
    for (const claim of ["Every sub MUST", "hard legal requirement for 1099", "Non-compete agreements have been largely abolished", "You can no longer force", "hire sales commission-only", "Do NOT put a sales rep on salary", "No experience required. No testing."]) expect(all).not.toContain(claim);
    const subs = lessonText("licensing", "subcontractors");
    expect(subs).toContain("https://www.irs.gov/taxtopics/tc762");
    expect(subs).toContain("https://www.ftc.gov/legal-library/browse/rules/noncompete-rule");
    expect(subs).toContain("An NDA is not blanket permission");
    for (const text of [subs, lessonText("licensing", "sales")]) {
      expect(text).toContain(stateLink);
      expect(text).toContain("Source reviewed October 11, 2026");
    }
    expect(lessonText("licensing", "sales")).toContain("https://www.dol.gov/agencies/whd/fact-sheets/17f-overtime-outside-sales");
    for (const id of ["tip-3", "tip-7", "tip-9", "tip-18"]) expect(lessonText("vetting", id)).toContain(stateLink);
  });

  it("explicitly disallows false Google identities/addresses and selective review requests", () => {
    const setup = lessonText("gmb", "setup");
    expect(setup).toContain("https://support.google.com/business/answer/3038177?hl=en");
    expect(setup).toContain("do not add keywords or cities just to rank");
    expect(setup).toContain("Do not use fake addresses, PO boxes or rented virtual-office addresses");
    expect(setup).toContain("hide that address");
    const reviews = lessonText("gmb", "reviews");
    expect(reviews).not.toContain("If you're happy");
    expect(reviews).toContain("send the same link to every customer");
    expect(reviews).toContain("https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers");
  });
});
