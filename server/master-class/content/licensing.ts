/**
 * Module 1 — Business Formation & Licensing: the lessons on running the company (/master-class?tab=state-guide,
 * below the chosen state's guide). Served only to an account that holds the module, the bundle or an included
 * course (server/master-class/routes.ts); the state guides themselves are /api/state-guides/:code
 * (server/state-guides.ts) under the same rule.
 */
import type { ModuleLessons } from "../content";

export const LICENSING: ModuleLessons = {
  lessons: [
    {
      id: "subcontractors",
      title: "Working with Subcontractors (1099)",
      blocks: [
        { type: "p", text: "Decide whether to use subcontractors or employees based on the work, supervision, capacity and applicable rules. A 1099 form or contract label does not by itself establish independent-contractor status." },
        { type: "notes", items: [
          { tone: "warn", lead: "Insurance & Workers Comp:", text: "Insurance and workers’ compensation obligations, exemptions and responsibility for injuries depend on the jurisdiction and working arrangement. Before work starts, [check your state](/master-class?tab=state-guide), confirm coverage with the insurer and discuss gaps with your adviser." },
          { tone: "plain", lead: "Subcontractor Agreement:", text: "Use a written agreement covering scope, payment, safety and each party’s responsibilities. A contract does not automatically transfer liability or determine employment status; [check your state](/master-class?tab=state-guide) and have local counsel review it." },
          { tone: "plain", lead: "Worker classification:", text: "Scheduling is one part of the facts, not a universal yes/no test. For federal employment taxes, the [IRS examines behavioral control, financial control and the relationship](https://www.irs.gov/taxtopics/tc762). Other laws may use different tests: [check your state](/master-class?tab=state-guide) and confirm your actual working arrangement with a qualified adviser. Source reviewed October 11, 2026." },
        ] },
        { type: "h", text: "Quality vs. Efficiency Trade-off" },
        { type: "p", text: "Set quality, cleanup and communication expectations with each subcontractor. Supervision needs depend on the crew and project; document responsibilities and check the work." },
        { type: "h", text: "Be clear about who performs the work" },
        { type: "p", text: "Explain which work your employees perform and which work subcontractors perform. Tell clients who supervises the job and who handles questions, defects and warranty requests." },
        { type: "list", cols: 2, items: [
          "Identify the subcontractor and their role before they arrive",
          "Use uniforms or jobsite signs only with permission and without implying a false employment relationship",
          "Name the person responsible for supervision and customer communication",
          "Document scope, quality standards, cleanup and warranty responsibilities",
        ] },
        { type: "h", text: "Non-Competes vs NDAs" },
        { type: "p", text: "Non-competes, non-solicitation terms and confidentiality agreements have different purposes and limits. An NDA is not blanket permission to restrict client contact or protected disclosures. Enforceability depends on jurisdiction, wording and circumstances: [check your state](/master-class?tab=state-guide) and obtain local legal advice before using a restriction. The [FTC’s noncompete rule page](https://www.ftc.gov/legal-library/browse/rules/noncompete-rule) reports that its federal rule is not in effect or enforceable; this does not settle state law. Source reviewed October 11, 2026." },
      ],
    },
    {
      id: "sales",
      title: "Sales and sustainable operations",
      blocks: [
        { type: "p", text: "Sales supports a sustainable construction business alongside safe work, quality, staffing and cash-flow management. Track results using consistent definitions." },
        { type: "stats", title: "Measure your sales performance", items: [
          { value: "Close rate", label: "Jobs won divided by qualified opportunities" },
          { value: "Acquisition cost", label: "Acquisition spend divided by customers won" },
          { value: "Job margin", label: "Revenue less the costs of delivering the work" },
        ], note: "Use the same period and definitions for each comparison. Results vary by trade, lead source, job size and market; this is not an industry benchmark." },
        { type: "h", text: "Hiring a Sales Rep" },
        { type: "notes", items: [
          { tone: "check", lead: "Choose a lawful compensation plan.", text: "Do not assume that commissions remove minimum-wage or overtime obligations. The [DOL outside-sales exemption](https://www.dol.gov/agencies/whd/fact-sheets/17f-overtime-outside-sales) depends on job duties and where the work occurs. Before setting pay, [check your state](/master-class?tab=state-guide) and confirm applicable federal and state requirements with payroll or legal counsel. Source reviewed October 11, 2026." },
          { tone: "tip", lead: "Poaching from competitors:", text: "Relevant experience can reduce training needs, but assess the candidate’s actual skills and references. Ask about existing obligations and obtain advice before requesting information from a former employer." },
        ] },
        { type: "p", text: "**Recruiting:** Compare job boards, trade networks and referrals. State the compensation structure, duties and expectations clearly." },
        { type: "h", text: "Sales Tactics That Win Jobs" },
        { type: "notes", items: [
          { tone: "plain", lead: "Give accurate availability.", text: "Offer appointment times you can meet, including same-day appointments when available. Set honest expectations about estimate turnaround and project capacity." },
          { tone: "plain", lead: "Agree on follow-up while bidding.", text: "Agree on a follow-up schedule after the estimate and honor the customer’s contact preferences. Clear communication can help without guaranteeing a sale." },
          { tone: "plain", lead: "Differentiate yourself from the competition.", text: "Customers may compare several bids. Provide a professional proposal with scope, timeline, warranty terms and relevant project photos so they can compare the work accurately." },
        ] },
        { type: "h", text: "Avoid High-Pressure Sales Tactics" },
        { type: "p", text: "Avoid pressure to sign immediately or claims about deadlines you cannot substantiate. Explain the proposal, allow questions and give accurate timelines." },
      ],
    },
    {
      id: "reputation",
      title: "Reputation & Review Management",
      blocks: [
        { type: "p", text: "Your reputation matters alongside workmanship, safety and service. Listen to complaints, document the facts and address the underlying work rather than making decisions solely to avoid a review." },
        { type: "p", text: "Negative reviews can affect customer confidence, but no fixed revenue-loss percentage applies to a review. Track inquiries, customer feedback and outcomes without attributing every change to one review." },
        { type: "h", text: "Resolve Disputes on Their Merits" },
        { type: "p", text: "Resolve unfinished work and disputes according to the contract and the customer's concerns. Keep that process separate from review requests. Ask every client for honest feedback, with no reward or preferred rating." },
        { type: "notes", items: [
          { tone: "check", lead: "Fix it first, then ask — with no strings attached.", text: "Resolve the complaint based on the contract and the work. Request honest feedback separately, with no incentive or preferred rating. [Google’s review policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en) prohibits incentivized reviews; the [FTC’s review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) explains the federal restrictions. For a specific dispute, [check your state](/master-class?tab=state-guide) and consult a qualified adviser. Source reviewed October 11, 2026." },
          { tone: "x", lead: "Keep public replies calm and factual.", text: "Avoid public arguments or private customer details. Acknowledge the concern and offer an appropriate way to discuss resolution." },
        ] },
        { type: "h", text: "Questions customers may ask when reading reviews" },
        { type: "cards", items: [
          { title: "Trustworthiness", text: "Did they do what they said, show up and finish the agreed work?" },
          { title: "Communication", text: "Did they keep the client in the loop? Were they responsive? Did they return calls and texts promptly?" },
          { title: "Quality of Work", text: "Was the craftsmanship good? Did they pay attention to details? Were there callbacks or warranty issues?" },
          { title: "Timeline & Reliability", text: "Did they start and finish on time? Were there unexplained delays? Did they manage expectations?" },
          { title: "Cleanliness & Respect", text: "Did they protect the property? Clean up daily? Treat the home and family with respect?" },
          { title: "Price Fairness", text: "Was pricing transparent, and were changes explained and agreed?" },
        ] },
        { type: "tip", title: "Resolve the work, not a hypothetical revenue loss", text: "Evaluate disputed work using the contract, documented facts and a fair resolution process. Do not assume a review causes a fixed loss. Keep requests for honest feedback separate from remedies." },
        { type: "h", text: "Handling Difficult Clients" },
        { type: "p", text: "Some disputes remain unresolved despite repeated discussion. Clarify scope, document concerns and seek appropriate advice without assuming the customer’s motives." },
        { type: "notes", items: [
          { tone: "warn", lead: "Aim for a fair, documented resolution.", text: "Listen to the concern, explain the documented facts and agree on next steps where possible. Obtain advice when contract obligations or safety are disputed." },
          { tone: "plain", lead: "Never get personal — no politics, religion, personal views, or opinions.", text: "Keep discussions professional and focused on the work. Respect boundaries and return unrelated disagreements to the project’s agreed scope." },
          { tone: "plain", lead: "Stay respectful, relevant and professional.", text: "Explain technical disagreements with evidence and clear options. Respectful communication does not require accepting unsafe work or unsupported claims." },
        ] },
        { type: "panels", items: [
          { title: "Issues to clarify before continuing", tone: "x", items: [
            "A legal dispute that requires advice before work proceeds",
            "Unresolved expectations about how defects or complaints will be handled",
            "Differences between bids that need a scope comparison",
            "Wants to negotiate the price after work has started",
            "Refuses to sign a contract or put anything in writing",
            "Changes scope repeatedly without acknowledging cost changes",
            "Requests for extras without a written scope or payment agreement",
          ] },
          { title: "How to De-Escalate & Exit Clean", items: [
            "Document everything — texts, emails, photos of completed work",
            "Communicate in writing, not just phone calls or in-person",
            "Offer a resolution before they escalate — be the bigger person",
            "Resolve disputed work on its merits; never exchange work, discounts or refunds for reviews",
            "Never raise your voice, curse, or get emotional on a jobsite",
            "Discuss any proposed termination or refund against the contract and applicable requirements",
            "Consult your attorney before walking off any job mid-contract",
          ] },
        ] },
        { type: "in-app", text: "Review requests, reminders and replies — including AI drafts for your approval — run from [Google Reviews](/google-reviews); the Google Business module covers the profile side." },
      ],
    },
    {
      id: "hiring",
      title: "Hiring & Staffing Strategy",
      blocks: [
        { type: "notes", items: [
          { tone: "warn", lead: "Avoid hiring too fast.", text: "Plan hiring around workload, capacity and cash flow. Include compensation, training and supervision in the cost of a new role." },
        ] },
        { type: "h", text: "Project Managers (PMs)" },
        { type: "p", text: "Assign project management to someone with the capacity and relevant skills. An owner may fill this role initially; reassess when workload exceeds safe, effective supervision." },
        { type: "notes", items: [
          { tone: "plain", text: "Research local compensation for the actual role, taking experience and scope of responsibility into account." },
        ] },
        { type: "p", text: "Incentivize PMs with performance bonuses, paid time off, and potentially a company vehicle. But don't buy assets you can't afford — if you're not closing enough work to support it, a company truck becomes a liability, not a perk." },
      ],
    },
    {
      id: "branding",
      title: "Branding & Professional Image",
      blocks: [
        { type: "p", text: "Build trust with accurate information about your team, credentials, capacity and process. A solo owner-operator can be professional without pretending to be a larger company." },
        { type: "list", cols: 2, tone: "plain", items: [
          "Show real vehicles, equipment and completed projects that your business is authorized to represent",
          "Use clean workwear and authorized branding that accurately identifies the team",
          "Explain who handles scheduling, supervision, questions and follow-up, even when one person fills several roles",
          "If you are the owner-operator, say so and explain your responsibilities on the project",
        ] },
        { type: "tip", title: "Show real accountability", text: "Introduce yourself and your actual role. Explain your written scope, communication schedule, quality checks and warranty process. Describe subcontractors and current capacity accurately; do not invent staff, departments or titles to imply a larger organization." },
      ],
    },
  ],
  footer: [
    { type: "tip", title: "The Bottom Line on Business Structure", text: "Plan staffing around real workload and cash flow, document responsibilities, and describe your business honestly. Before deciding worker classification, compensation or contract restrictions, [check your state](/master-class?tab=state-guide) and consult qualified advisers for your situation." },
  ],
};
