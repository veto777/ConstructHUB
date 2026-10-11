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
      { type: "p", text: "Many counties have no permitting requirements for certain work (siding, windows, doors). This creates a massive loophole allowing unqualified contractors to operate without oversight. No inspection means no accountability." },
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
        "No workers' comp — if an employee is injured on your property, YOU could be sued",
        "Insurance may not cover defective work or wrong materials",
        "A $6K contractor bond won't cover your legal fees",
      ] },
    ]),
    tip(8, "New Companies Badmouthing Veterans", [
      { type: "p", text: "It's a major red flag when a company tears down competitors instead of building its own reputation. Claims like \"I used to work for them and they're terrible\" are often manipulation tactics. Companies that succeed on merit don't need to badmouth others." },
      { type: "notes", items: [{ tone: "tip", text: "A company that actively works to tear down others rather than build up their own reputation likely doesn't have the skills or track record to succeed on merit alone." }] },
    ]),
    tip(9, "Licensed ≠ Legitimate", [
      { type: "p", text: "In many states (like Washington), getting a contractor's license just means paying $65, getting a $300/year bond, and $100/month insurance. No experience required. No testing. States like California require 4 years experience + exams. Know your state's requirements." },
      { type: "notes", items: [{ tone: "warn", text: "A license is just a minimum legal requirement — not proof of skill, experience, or quality workmanship. Use the State Guide tab to check your state's licensing requirements." }] },
    ]),
    tip(10, "Web Presence ≠ Legitimacy", [
      { type: "p", text: "High Google rankings can be bought through marketing firms. A polished website with customer reviews, ads, and \"10 years in business\" claims means nothing without verification. Many companies pay to manipulate their online positions." },
      { type: "notes", items: [{ tone: "tip", text: "When vetting a contractor, read their Google reviews critically — repeated phrasing and clustered review dates can be signals worth a closer look, but do not establish authorship or authenticity." }] },
    ]),
    tip(11, "Unsolicited Calls = Lead Gen", [
      { type: "p", text: "If a company calls you out of the blue, your information was likely sold through a lead generation form. These companies buy leads in bulk and often lack the experience to deliver quality work. Only engage with companies you've researched yourself." },
    ]),
    tip(12, "Warranty Is Key", [
      { type: "p", text: "Companies offering 1-2 year warranties don't want to be held accountable. But beware the opposite too — a company in business for 2 years offering a 10-year warranty is a red flag. Always ask how long they've been operating before trusting a warranty promise." },
      { type: "notes", items: [{ tone: "tip", text: "The warranty is the best indicator of a company's commitment to their work and customers. A company can't honor a 15-year warranty if they've only existed for 3." }] },
    ]),
    tip(13, "Physical Office Verification", [
      { type: "p", text: "Schedule a meeting at their office. A legitimate company will have a physical space, showroom, or office. Ask how many employees they have. Verify the address on Google Maps — many scam companies use PO boxes, storage units, or random warehouses as false addresses." },
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
      { type: "p", text: "Legitimate in-house financing requires years of established operations, solid financial stability, and significant revenue (millions). Many new companies claim to offer financing but actually just partner with obscure third-party vendors for referral commissions." },
      { type: "notes", items: [{ tone: "warn", text: "If a company offers financing but has been in business less than 5 years, chances are it's a third-party referral program — not real in-house financing." }] },
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
          "Keep permanent records of all estimates, contracts, change orders, and communications. This protects you legally and builds a professional reputation.",
          "Carry proper insurance and workers' comp — it protects everyone. Cutting corners on coverage puts your customers, your employees, and your personal assets at risk.",
          "Establish a real physical presence — office, showroom, or shop. A real address shows permanence and gives customers confidence you'll be around to honor warranties.",
          "Stand behind your warranty with real history to back it up. Only promise warranty periods that your company has actually been in business long enough to fulfill.",
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
          "Confirm workers compensation coverage (get certificate)",
          "Check BBB rating, accreditation status, and complaint history",
          "Ask for 5-10 recent project addresses you can drive by",
          "Request a physical office visit or showroom tour",
          "Get a downloadable PDF estimate (not a disappearing link)",
          "Ask how long the company has been in business under this name",
          "Cross-reference Google reviews on Yelp, BBB, and Houzz",
          "Verify manufacturer certifications directly with the manufacturer",
          "Ask about their warranty terms relative to years in business",
          "Confirm they pull permits when required by your jurisdiction",
          "Ask for proof of employees (not just subcontractors)",
          "Check if financing is in-house or a third-party referral",
        ].map((text, i) => ({ id: `item-${i + 1}`, text })) },
      ],
    },
  ],
};
