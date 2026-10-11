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

describe("round-five course accuracy", () => {
  it("separates supported verification methods, scope and prerequisites", () => {
    const lesson = LESSON_MODULES.seo.lessons.find((l) => l.id === "search-console")!;
    const panels = lesson.blocks.find((b) => b.type === "panels");
    expect(panels?.type).toBe("panels");
    if (panels?.type !== "panels") return;
    expect(panels.items[0].items).toEqual([
      "Domain property: DNS TXT record at your domain provider",
      "URL-prefix property: HTML file upload, HTML tag, Google Analytics or Google Tag Manager; DNS verification is also available",
    ]);
    const text = lessonText("seo", "search-console");
    for (const phrase of ["all subdomains", "HTTP and HTTPS", "protocol, host and optional path", "prerequisites", "edit permission", "Publish or Admin permission", "9008080", "Google decides whether to index", "does not guarantee inclusion", "9012289"]) expect(text).toContain(phrase);
  });

  it("describes speed as one consideration and avoids guaranteed rankings", () => {
    const text = lessonText("website", "page-speed");
    expect(text).toContain("one of many ranking considerations");
    expect(text).toContain("https://developers.google.com/search/docs/appearance/page-experience");
    for (const phrase of ["will lose position", "mobile score is the one Google ranks by", "Google detects it", "pages will not rank", "destroy your rankings entirely"]) expect(all).not.toContain(phrase);
  });

  it("does not recommend PBNs or unsupported backlink quotas", () => {
    const text = lessonText("seo", "backlinks");
    expect(text).not.toContain("Press releases (PBNs)");
    expect(text).not.toContain("75%");
    expect(text).not.toContain("DR/DA of 30");
    expect(text).toContain("not a private blog network");
    expect(text).toContain("spam-policies");
  });

  it("accepts service-area operators throughout vetting and avoids categorical BBB claims", () => {
    for (const id of ["tip-13", "brand", "checklist"]) expect(lessonText("vetting", id)).toMatch(/service-area business/);
    expect(lessonText("vetting", "tip-13")).toContain("do not demand a storefront");
    expect(lessonText("vetting", "tip-14")).toContain("does not by itself establish");
    for (const phrase of ["Real office or showroom", "Establish a real physical presence", "either very new or have unresolved complaints"]) expect(all).not.toContain(phrase);
  });

  it("removes unsourced revenue, cost, salary, certification and traffic statistics", () => {
    for (const phrase of ["33%+", "<15%", "$50-150/lead", "10-15%", "20-50%", "$500K", "$45,000", "80-90%", "36 full", "150 sq ft", "Over 70%", "15+ platforms"]) expect(all).not.toContain(phrase);
    expect(lessonText("licensing", "sales")).toContain("not an industry benchmark");
    expect(lessonText("licensing", "reputation")).toContain("no fixed revenue-loss percentage");
  });
});

it("presents hiring research as notes and keeps the permit checklist on topic", () => {
  const hiring = LESSON_MODULES.licensing.lessons.find(l => l.id === "hiring")!;
  expect(hiring.blocks.some(b => b.type === "stats")).toBe(false);
  expect(lessonText("licensing", "hiring")).toContain("Research local compensation");
  const permits = LESSON_MODULES.vetting.lessons.find(l => l.id === "tip-3")!.blocks.find(b => b.type === "list");
  expect(permits?.type === "list" && permits.items[0]).toContain("permits and inspections");
  expect(lessonText("vetting", "tip-14")).not.toContain("Review available business details");
});
