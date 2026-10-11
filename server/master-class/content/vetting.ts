/**
 * Vetting contractors — the bonus lessons (/master-class?tab=vetting): the 19 checks homeowners use before they
 * hire, the honest way to build a credible brand, and the homeowner's checklist. They come with ANY module or the
 * bundle (server/state-guides.ts courseUnlocks → `any`), as the Enroll tab says; server/master-class/routes.ts
 * applies that rule. Lesson ids tip-1 … tip-19 match the public outline (client module-vetting.tsx TOPICS).
 */
import type { LessonBlock, ModuleLessons } from "../content";

const tip = (n: number, title: string, blocks: LessonBlock[]) => ({ id: `tip-${n}`, title, blocks });

export const VETTING: ModuleLessons = {
  lessons: [
    tip(1, "False Claims of Affiliation", [
      { type: "p", text: "Some companies falsely claim to have worked for or been affiliated with established brands to gain credibility they haven't earned. They use misleading language like \"partnered with\" or \"worked alongside\" when no real connection exists." },
      { type: "list", title: "How to Protect Yourself:", items: [
        "Ask for proof of any claimed affiliations — documentation, references",
        "Verify directly with the company they claim to be affiliated with",
        { tone: "warn", text: "Be aware that AI can fabricate photos, documents, and endorsements" },
      ] },
    ]),
    tip(2, "Verify relevant experience", [
      { type: "p", text: "Company age is context, not proof of reliability. Distinguish the company’s completed projects from employees’ prior experience and verify both." },
      { type: "list", title: "Red Flags:", items: [
        { tone: "warn", text: "\"Combined years of experience\" claims (e.g., \"Joe 3yr + Phil 4yr = 7 years!\")" },
        { tone: "warn", text: "Taking credit for a hired employee's prior experience" },
        "Cross-reference their claims with BBB and state licensing records",
      ] },
    ]),
    tip(3, "The Permitting Loophole", [
      { type: "p", text: "Permit and inspection requirements depend on the jurisdiction, project and scope. Before work begins, [check your state](/master-class?tab=state-guide) and confirm the local building department’s requirements. Even where a permit is not required, agree on installation standards and quality checks." },
      { type: "list", title: "Protect Yourself:", items: [
        "Ask for relevant completed or active projects and references you have permission to contact",
        "Demand industry-standard installation practices regardless of permit requirements",
        "Consider hiring a third-party inspector if permits aren't required",
      ] },
    ]),
    tip(4, "Verify manufacturer program membership", [
      { type: "p", text: "Manufacturer programs have different eligibility and renewal rules. Verify current membership and its scope directly with the manufacturer; a badge alone does not establish workmanship quality." },
      { type: "notes", items: [{ tone: "warn", text: "Check the actual project history and current program requirements rather than assuming what a badge guarantees." }] },
    ]),
    tip(5, "Vanishing Estimates", [
      { type: "p", text: "An estimate link may expire or change. Request and retain a dated, downloadable copy so you can compare terms and preserve the agreement." },
      { type: "list", title: "Always:", items: [
        "Request a downloadable PDF or printed copy of every estimate",
        "If a company only provides a disappearing link, walk away",
        "Keep copies of all signed contracts independently",
      ] },
    ]),
    tip(6, "The Illusion of Size", [
      { type: "p", text: "Branding does not establish company size. Ask who performs the work, who supervises it and how the business can be reached. A solo operator can be legitimate." },
      { type: "notes", items: [{ tone: "warn", text: "Verify accountability through the contract, credentials, references and actual responsibilities rather than the apparent size of the company." }] },
    ]),
    tip(7, "Lower Price ≠ Equal Service", [
      { type: "p", text: "Compare the proposed scope, relevant experience, supervision and warranty support. Age, office size and price alone do not establish quality or predict extra costs." },
      { type: "list", title: "Coverage questions for any bid:", tone: "warn", items: [
        "Workers’ compensation requirements and injury liability vary; [check your state](/master-class?tab=state-guide) and verify applicable coverage or exemptions",
        "Insurance may not cover defective work or wrong materials",
        "Bond terms, claim limits and covered costs vary; [check your state](/master-class?tab=state-guide) and review the actual bond rather than assuming it covers a loss",
      ] },
    ]),
    tip(8, "New Companies Badmouthing Veterans", [
      { type: "p", text: "It's a major red flag when a company tears down competitors instead of building its own reputation. Claims like \"I used to work for them and they're terrible\" are often manipulation tactics. Companies that succeed on merit don't need to badmouth others." },
      { type: "notes", items: [{ tone: "tip", text: "Ask for evidence supporting claims about competitors and assess the contractor’s own relevant work." }] },
    ]),
    tip(9, "Licensed ≠ Legitimate", [
      { type: "p", text: "Licensing, registration, experience, exams, bonds and insurance requirements vary by state, locality and trade. Do not rely on generic fee or experience figures: [check your state](/master-class?tab=state-guide), follow the linked agency sources and confirm the requirements for the proposed work." },
      { type: "notes", items: [{ tone: "warn", text: "Where a credential is required, verify its status and scope with the issuing agency. A credential alone does not establish workmanship quality; [check your state](/master-class?tab=state-guide) and check references and relevant projects as well." }] },
    ]),
    tip(10, "Web Presence ≠ Legitimacy", [
      { type: "p", text: "A polished website, advertising or search visibility does not establish contractor reliability. Verify credentials, relevant project history and the claims made on the site." },
      { type: "notes", items: [{ tone: "tip", text: "When vetting a contractor, read their Google reviews critically — repeated phrasing and clustered review dates can be signals worth a closer look, but do not establish authorship or authenticity." }] },
    ]),
    tip(11, "Verify unsolicited contacts", [
      { type: "p", text: "Ask an unsolicited caller how they obtained your details and which business they represent. Independently verify that business before sharing information or agreeing to work." },
    ]),
    tip(12, "Warranty Is Key", [
      { type: "p", text: "Compare written warranty terms and the contractor’s ability to deliver support. Separate manufacturer coverage from the contractor’s workmanship warranty and ask how claims are handled." },
      { type: "notes", items: [{ tone: "tip", text: "A warranty promise should identify the responsible business, scope, exclusions and claims process. Company age alone does not establish whether it can honor that promise." }] },
    ]),
    tip(13, "Physical Office Verification", [
      { type: "p", text: "Ask how and where the business operates and who is accountable for your project. A legitimate service-area business may work from home and hide its address on Google. Verify contact details and credentials; do not demand a storefront or accept a fake address as proof." },
      { type: "list", title: "Check for:", items: [
        "Verifiable contact details and an accurate explanation of the business’s service area or premises",
        "The named person responsible for supervision, customer questions and warranty support, including an owner-operator",
        "Verify any claimed customer-facing office with permission; a home-based service-area business need not have a public storefront",
      ] },
    ]),
    tip(14, "BBB & Online Credibility", [
      { type: "p", text: "Use available BBB information as one part of your research. A missing A+ rating or lack of accreditation does not by itself establish unresolved complaints or poor workmanship. Check the underlying record, relevant credentials and references." },
      { type: "notes", items: [{ tone: "plain", lead: "BBB information to review:", text: "Review available business details, complaint history and responses, rating explanations and accreditation status. Confirm identity and credentials independently." }] },
    ]),
    tip(15, "Fabricated Accomplishments", [
      { type: "p", text: "Ask contractors to explain their role in each project they present, including subcontracted work. Verify claimed affiliations and do not assume subcontracting itself makes a project claim false." },
      { type: "list", title: "Common Fabrication Tactics:", items: [
        { tone: "warn", text: "Displaying project photos from other companies as their own work" },
        { tone: "warn", text: "Claiming \"trained by\" or \"formerly with\" established companies without proof" },
        { tone: "warn", text: "Misrepresenting the company’s role in subcontracted projects" },
        "Ask for references or project visits only with the customer’s permission",
      ] },
    ]),
    tip(16, "Referrals & Fake Reviews", [
      { type: "p", text: "Ask for relevant customer references with permission to contact them. Similar wording, clustered dates or reviews on multiple sites can prompt questions, but do not prove a review is fake. Verify claims without assuming a fixed proportion of reviews is fraudulent." },
      { type: "tags", label: "Cross-reference reviews on:", items: ["Google", "Yelp", "BBB", "Houzz", "Angi", "GuildQuality", "Networx"] },
    ]),
    tip(17, "Fabrication of Credibility", [
      { type: "p", text: "Companies create dozens of online profiles across Houzz, Thumbtack, YouTube, Facebook, and more. They duplicate competitor content, steal branding colors and logos, and display vendor logos they have no real partnership with. They acquire credentials to emulate successful local companies." },
      { type: "list", title: "Signs of Fabricated Credibility:", items: [
        { tone: "warn", text: "Website design, colors, or layout that closely mimics a well-known local competitor" },
        { tone: "warn", text: "Displaying manufacturer logos without being an actual certified installer" },
        { tone: "warn", text: "Online claims that cannot be reconciled with verified credentials or project history" },
        "Verify certifications directly with the manufacturer's installer lookup tool",
      ] },
    ]),
    tip(18, "Real Financing vs. 3rd Party Referrals", [
      { type: "p", text: "Ask who the lender is and request the financing terms in writing. A referral to a third-party lender is different from credit offered directly by the contractor. Requirements depend on the arrangement and jurisdiction; [check your state](/master-class?tab=state-guide) and consult the relevant regulator before offering financing." },
      { type: "notes", items: [{ tone: "warn", text: "Company age alone does not identify the lender or establish whether financing is legitimate. Verify the provider and compare the written terms." }] },
    ]),
    tip(19, "Too-Good-to-Be-True Prices", [
      { type: "p", text: "A low bid may reflect a different scope, overhead or approach. Compare materials, supervision, exclusions, credentials and warranty terms; neither a low nor a high price proves quality." },
      { type: "notes", items: [{ tone: "tip", text: "Ask how the proposed price covers the agreed work and examine omissions before choosing a contractor." }] },
    ]),
    {
      id: "brand",
      title: "Building a Legit Brand — The Right Way",
      blocks: [
        { type: "p", text: "Build a credible brand through accurate claims, documented work and accountable service. These practices support trust without guaranteeing business success." },
        { type: "list", cols: 2, tone: "plain", items: [
          "Build real experience over time — there are no shortcuts to expertise. Do the work, document every project, and let your portfolio speak for itself.",
          "Request honest reviews from real customers; never buy or fabricate them",
          "Keep independent copies of estimates, contracts, change orders and communications. Retention and disclosure requirements vary: [check your state](/master-class?tab=state-guide) and ask your adviser what records to retain and for how long.",
          "Confirm applicable insurance and workers’ compensation requirements and exemptions: [check your state](/master-class?tab=state-guide), then verify coverage with the insurer",
          "Describe your operating model and provide reliable contact details; a home-based service-area business does not need a public storefront",
          "Offer written warranty terms you can support, including scope, exclusions and a clear claims process",
          "Compete on merit — never tear down others to build yourself up. The best companies focus on their own strengths rather than attacking competitors.",
          "Be transparent about your company's actual age and experience. Honesty about where you are in your journey builds more trust than inflated claims.",
        ] },
        { type: "tip", title: "The Bottom Line", text: "Build a verifiable record of work, communicate responsibilities and make only claims you can support. No branding checklist guarantees long-term success." },
      ],
    },
    {
      id: "checklist",
      title: "Homeowner's Quick Vetting Checklist",
      blocks: [
        { type: "p", text: "Use these questions before signing a contract. Check which requirements apply to the work and investigate gaps rather than treating the checklist as a pass/fail score." },
        { type: "checklist", storageKey: "mc:vetting:checklist", resetLabel: "Reset", items: [
          "Verify any required contractor license and its scope with the issuing agency",
          "Confirm active general liability insurance (get certificate)",
          "Confirm applicable workers’ compensation coverage or an agency-verified exemption",
          "Check BBB rating, accreditation status, and complaint history",
          "Ask for relevant project references or visits with the customer’s permission",
          "Confirm real contact details and how the business operates; a service-area business may have no public office",
          "Get a downloadable PDF estimate (not a disappearing link)",
          "Ask how long the company has been in business under this name",
          "Cross-reference Google reviews on Yelp, BBB, and Houzz",
          "Verify manufacturer certifications directly with the manufacturer",
          "Read the written warranty scope, exclusions and claims process",
          "Confirm they pull permits when required by your jurisdiction",
          "Ask who will perform the work, including any subcontractors, and who is responsible for supervision",
          "Check if financing is in-house or a third-party referral",
        ].map((text, i) => ({ id: [0, 4, 10].includes(i) ? `r5-item-${i + 1}` : `item-${i + 1}`, text })) },
      ],
    },
  ],
};
