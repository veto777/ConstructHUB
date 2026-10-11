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
    tip(2, "Experience Can't Be Faked", [
      { type: "p", text: "How long a company has been in business is one of the strongest indicators of reliability. Watch out for the \"combined experience\" trick — adding up individual employee years to inflate the company's track record." },
      { type: "list", title: "Red Flags:", items: [
        { tone: "warn", text: "\"Combined years of experience\" claims (e.g., \"Joe 3yr + Phil 4yr = 7 years!\")" },
        { tone: "warn", text: "Taking credit for a hired employee's prior experience" },
        "Cross-reference their claims with BBB and state licensing records",
      ] },
    ]),
    tip(3, "The Permitting Loophole", [
      { type: "p", text: "Permit and inspection requirements depend on the jurisdiction, project and scope. Before work begins, [check your state](/master-class?tab=state-guide) and confirm the local building department’s requirements. Even where a permit is not required, agree on installation standards and quality checks." },
      { type: "list", title: "Protect Yourself:", items: [
        "Ask for active jobs in the area — established companies always have them",
        "Demand industry-standard installation practices regardless of permit requirements",
        "Consider hiring a third-party inspector if permits aren't required",
      ] },
    ]),
    tip(4, "Manufacturer Programs (Diluted Standards)", [
      { type: "p", text: "Programs like James Hardie Elite used to require 36 full re-siding projects per year. Now it's just 10, and partial jobs as small as 150 sq ft qualify. Verification has been minimized. Don't rely on these badges alone." },
      { type: "notes", items: [{ tone: "warn", text: "Manufacturer certifications that once meant something may now be easily obtained. Always verify a company's actual project history — not just their badges." }] },
    ]),
    tip(5, "Vanishing Estimates", [
      { type: "p", text: "Some contractors send estimates via links that later disappear. If they can delete an estimate, they can alter a contract. This is a massive red flag for accountability." },
      { type: "list", title: "Always:", items: [
        "Request a downloadable PDF or printed copy of every estimate",
        "If a company only provides a disappearing link, walk away",
        "Keep copies of all signed contracts independently",
      ] },
    ]),
    tip(6, "The Illusion of Size", [
      { type: "p", text: "Some companies use branded trucks, slick websites, and multiple Google listings to look like large operations. In reality, they may be a single-person company using virtual addresses and PO boxes. They hide behind titles like \"project manager\" or \"estimator\" when they're the sole operator." },
      { type: "notes", items: [{ tone: "warn", text: "If something goes wrong, these companies often vanish with your money or fail to fix their mistakes, leaving you with zero accountability." }] },
    ]),
    tip(7, "Lower Price ≠ Equal Service", [
      { type: "p", text: "Comparing a 20-year company with staff and offices to a 1-year company working from a pickup truck is not \"apples to apples.\" Established companies anticipate structural issues. New companies discover them mid-project — costing you more." },
      { type: "list", title: "Real Risks of Cheap Bids:", tone: "warn", items: [
        "Workers’ compensation requirements and injury liability vary; [check your state](/master-class?tab=state-guide) and verify applicable coverage or exemptions",
        "Insurance may not cover defective work or wrong materials",
        "Bond terms, claim limits and covered costs vary; [check your state](/master-class?tab=state-guide) and review the actual bond rather than assuming it covers a loss",
      ] },
    ]),
    tip(8, "New Companies Badmouthing Veterans", [
      { type: "p", text: "It's a major red flag when a company tears down competitors instead of building its own reputation. Claims like \"I used to work for them and they're terrible\" are often manipulation tactics. Companies that succeed on merit don't need to badmouth others." },
      { type: "notes", items: [{ tone: "tip", text: "A company that actively works to tear down others rather than build up their own reputation likely doesn't have the skills or track record to succeed on merit alone." }] },
    ]),
    tip(9, "Licensed ≠ Legitimate", [
      { type: "p", text: "Licensing, registration, experience, exams, bonds and insurance requirements vary by state, locality and trade. Do not rely on generic fee or experience figures: [check your state](/master-class?tab=state-guide), follow the linked agency sources and confirm the requirements for the proposed work." },
      { type: "notes", items: [{ tone: "warn", text: "Where a credential is required, verify its status and scope with the issuing agency. A credential alone does not establish workmanship quality; [check your state](/master-class?tab=state-guide) and check references and relevant projects as well." }] },
    ]),
    tip(10, "Web Presence ≠ Legitimacy", [
      { type: "p", text: "High Google rankings can be bought through marketing firms. A polished website with customer reviews, ads, and \"10 years in business\" claims means nothing without verification. Many companies pay to manipulate their online positions." },
      { type: "notes", items: [{ tone: "tip", text: "When vetting a contractor, read their Google reviews critically — repeated phrasing and clustered review dates can be signals worth a closer look, but do not establish authorship or authenticity." }] },
    ]),
    tip(11, "Unsolicited Calls = Lead Gen", [
      { type: "p", text: "If a company calls you out of the blue, your information was likely sold through a lead generation form. These companies buy leads in bulk and often lack the experience to deliver quality work. Only engage with companies you've researched yourself." },
    ]),
    tip(12, "Warranty Is Key", [
      { type: "p", text: "Compare written warranty terms and the contractor’s ability to deliver support. Separate manufacturer coverage from the contractor’s workmanship warranty and ask how claims are handled." },
      { type: "notes", items: [{ tone: "tip", text: "A warranty promise should identify the responsible business, scope, exclusions and claims process. Company age alone does not establish whether it can honor that promise." }] },
    ]),
    tip(13, "Physical Office Verification", [
      { type: "p", text: "Ask how and where the business operates and who is accountable for your project. A legitimate service-area business may work from home and hide its address on Google. Verify contact details and credentials; do not demand a storefront or accept a fake address as proof." },
      { type: "list", title: "Check for:", items: [
        "Real office or showroom (not a PO box, Suite #, or storage unit)",
        "Actual staff — customer service, project managers",
        "Drive by the address if you're unsure",
      ] },
    ]),
    tip(14, "BBB & Online Credibility", [
      { type: "p", text: "Check the Better Business Bureau (BBB). It reveals the owner's name, complaints history, and accreditation status. If a company doesn't have an A+ and isn't accredited, they're either very new or have unresolved complaints." },
      { type: "notes", items: [{ tone: "plain", lead: "BBB checks reveal:", text: "Owner identity and age, years in business, complaint history, accreditation status, and whether complaints were resolved or ignored." }] },
    ]),
    tip(15, "Fabricated Accomplishments", [
      { type: "p", text: "Some companies subcontract work and present it as their own. They leverage established brand names by falsely claiming affiliation or insider knowledge. When encountering such claims, question the integrity of the source." },
      { type: "list", title: "Common Fabrication Tactics:", items: [
        { tone: "warn", text: "Displaying project photos from other companies as their own work" },
        { tone: "warn", text: "Claiming \"trained by\" or \"formerly with\" established companies without proof" },
        { tone: "warn", text: "Listing subcontracted projects as direct company accomplishments" },
        "Ask for job site addresses you can drive by and verify in person",
      ] },
    ]),
    tip(16, "Referrals & Fake Reviews", [
      { type: "p", text: "Don't just trust online reviews — ask for 5-10 verified addresses as references. Many new companies have 80-90% of reviews from family or friends. Watch for reviews duplicated across 3-4 platforms (real customers rarely post on multiple sites). Check suspicious usernames." },
      { type: "tags", label: "Cross-reference reviews on:", items: ["Google", "Yelp", "BBB", "Houzz", "Angi", "GuildQuality", "Networx"] },
    ]),
    tip(17, "Fabrication of Credibility", [
      { type: "p", text: "Companies create dozens of online profiles across Houzz, Thumbtack, YouTube, Facebook, and more. They duplicate competitor content, steal branding colors and logos, and display vendor logos they have no real partnership with. They acquire credentials to emulate successful local companies." },
      { type: "list", title: "Signs of Fabricated Credibility:", items: [
        { tone: "warn", text: "Website design, colors, or layout that closely mimics a well-known local competitor" },
        { tone: "warn", text: "Displaying manufacturer logos without being an actual certified installer" },
        { tone: "warn", text: "Having profiles on 15+ platforms but only 6 months in business" },
        "Verify certifications directly with the manufacturer's installer lookup tool",
      ] },
    ]),
    tip(18, "Real Financing vs. 3rd Party Referrals", [
      { type: "p", text: "Ask who the lender is and request the financing terms in writing. A referral to a third-party lender is different from credit offered directly by the contractor. Requirements depend on the arrangement and jurisdiction; [check your state](/master-class?tab=state-guide) and consult the relevant regulator before offering financing." },
      { type: "notes", items: [{ tone: "warn", text: "Company age alone does not identify the lender or establish whether financing is legitimate. Verify the provider and compare the written terms." }] },
    ]),
    tip(19, "Too-Good-to-Be-True Prices", [
      { type: "p", text: "Low bids mean the company is cutting costs — unskilled labor, no insurance, no overhead. When you pay a higher price, you're investing in experience and a company that has already overcome the hurdles of running a business. Lack of experience often results in redoing the job entirely." },
      { type: "notes", items: [{ tone: "tip", text: "Find the middle ground. The cheapest option often leads to the most expensive outcome — incorrect products, project delays, and lawsuits with insurance that doesn't cover the work." }] },
    ]),
    {
      id: "brand",
      title: "Building a Legit Brand — The Right Way",
      blocks: [
        { type: "p", text: "For contractors building their own business: don't try to fake it till you make it. It usually never ends well. The construction industry rewards authenticity and punishes shortcuts. Here's the honest path to a credible brand that lasts:" },
        { type: "list", cols: 2, tone: "plain", items: [
          "Build real experience over time — there are no shortcuts to expertise. Do the work, document every project, and let your portfolio speak for itself.",
          "Earn reviews organically from real customers — never buy or fabricate them. One honest 4-star review is worth more than ten fake 5-star reviews.",
          "Keep independent copies of estimates, contracts, change orders and communications. Retention and disclosure requirements vary: [check your state](/master-class?tab=state-guide) and ask your adviser what records to retain and for how long.",
          "Confirm applicable insurance and workers’ compensation requirements and exemptions: [check your state](/master-class?tab=state-guide), then verify coverage with the insurer",
          "Establish a real physical presence — office, showroom, or shop. A real address shows permanence and gives customers confidence you'll be around to honor warranties.",
          "Offer written warranty terms you can support, including scope, exclusions and a clear claims process",
          "Compete on merit — never tear down others to build yourself up. The best companies focus on their own strengths rather than attacking competitors.",
          "Be transparent about your company's actual age and experience. Honesty about where you are in your journey builds more trust than inflated claims.",
        ] },
        { type: "tip", title: "The Bottom Line", text: "Every established company in your market started exactly where you are. The difference between the ones that made it and the ones that didn't is simple: the successful ones built their reputation on real work, real customers, and real results. They didn't cut corners on insurance, they didn't fake reviews, and they didn't pretend to be bigger than they were. They earned every star, every referral, and every repeat customer. That's the path — and it works." },
      ],
    },
    {
      id: "checklist",
      title: "Homeowner's Quick Vetting Checklist",
      blocks: [
        { type: "p", text: "Use it before signing any contract; if a company can't satisfy most of these, keep looking." },
        { type: "checklist", storageKey: "mc:vetting:checklist", resetLabel: "Reset", items: [
          "Verify contractor license with your state's licensing board",
          "Confirm active general liability insurance (get certificate)",
          "Confirm applicable workers’ compensation coverage or an agency-verified exemption",
          "Check BBB rating, accreditation status, and complaint history",
          "Ask for 5-10 recent project addresses you can drive by",
          "Confirm real contact details and how the business operates; a service-area business may have no public office",
          "Get a downloadable PDF estimate (not a disappearing link)",
          "Ask how long the company has been in business under this name",
          "Cross-reference Google reviews on Yelp, BBB, and Houzz",
          "Verify manufacturer certifications directly with the manufacturer",
          "Ask about their warranty terms relative to years in business",
          "Confirm they pull permits when required by your jurisdiction",
          "Ask who will perform the work, including any subcontractors, and who is responsible for supervision",
          "Check if financing is in-house or a third-party referral",
        ].map((text, i) => ({ id: `item-${i + 1}`, text })) },
      ],
    },
  ],
};
