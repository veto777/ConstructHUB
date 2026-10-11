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
        { type: "p", text: "Controlling quality is always harder with subs — it's a constant balance of quality vs. efficiency and less hands-on work. Most subs will NOT clean up jobsites or do the small things to cater to clients (covering furniture, cleaning up after themselves, communicating updates). These details always reflect on YOUR company, not the sub." },
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
      title: "Sales — The Most Important Role",
      blocks: [
        { type: "p", text: "The most important role in any construction business is **SALES**. Without sales, nothing else matters — not your crew, not your tools, not your license. Everything starts with closing jobs." },
        { type: "stats", title: "Close Rate Benchmarks", items: [
          { value: "33%+", label: "Great Sales (1 of 3)" },
          { value: "20%", label: "Average" },
          { value: "<15%", label: "Dangerous" },
        ], note: "Anything below 15% is dangerous because of the cost of leads. At $50-150/lead, a low close rate can be financially devastating for a business." },
        { type: "h", text: "Hiring a Sales Rep" },
        { type: "notes", items: [
          { tone: "check", lead: "Choose a lawful compensation plan.", text: "Do not assume that commissions remove minimum-wage or overtime obligations. The [DOL outside-sales exemption](https://www.dol.gov/agencies/whd/fact-sheets/17f-overtime-outside-sales) depends on job duties and where the work occurs. Before setting pay, [check your state](/master-class?tab=state-guide) and confirm applicable federal and state requirements with payroll or legal counsel. Source reviewed October 11, 2026." },
          { tone: "tip", lead: "Poaching from competitors:", text: "This is what Elon Musk does — he recruits top talent from Microsoft and Google. Hiring a proven sales rep from a competitor saves you training time and they already know the trade. However, this is risky: they could flip on you, and they may have an NDA with their previous employer that could expose you legally. Always ask about prior arrangements before bringing them on." },
        ] },
        { type: "p", text: "**Best places to recruit:** Craigslist and Indeed are the best platforms to find a new sales rep or project manager. Post clear commission structures and expectations upfront." },
        { type: "h", text: "Sales Tactics That Win Jobs" },
        { type: "notes", items: [
          { tone: "plain", lead: "Give accurate availability.", text: "Offer appointment times you can meet, including same-day appointments when available. Set honest expectations about estimate turnaround and project capacity." },
          { tone: "plain", lead: "Stay in constant contact while bidding.", text: "Out of sight, out of mind — and that's deadly during the bidding process. Follow up after the estimate, send a thank-you text or email, check in 2-3 days later. Most contractors give a bid and disappear. The one who stays top of mind wins the job." },
          { tone: "plain", lead: "Differentiate yourself from the competition.", text: "Every homeowner is getting 3-5 bids. If your estimate looks like everyone else's — a number scribbled on a piece of paper — you blend in. Present a professional proposal with your branding, scope of work, timeline, warranty details, and photos of past work. Make it impossible for the client to compare you to the guy in a beat-up truck with a handwritten quote." },
        ] },
        { type: "h", text: "Avoid High-Pressure Sales Tactics" },
        { type: "p", text: "Don't fall into the trap of sleazy one-call-close tactics — \"sign today or lose the price\" pressure selling. High-pressure sales is an art form that takes years to master, and if you don't know what you're doing, it will backfire badly. You'll lose the sale, damage your reputation, and potentially earn a bad review that costs you far more than the job was worth. Homeowners talk to each other, post in neighborhood groups, and share experiences online. One pushy encounter can label your company as \"aggressive\" or \"scammy\" in an entire community. Instead, focus on building trust through professionalism, clear communication, and honest timelines. Let the quality of your proposal and follow-up do the selling — the best closers in construction don't need to pressure anyone because they've already built enough confidence during the estimate." },
      ],
    },
    {
      id: "reputation",
      title: "Reputation & Review Management",
      blocks: [
        { type: "p", text: "Your online reputation is the single most valuable asset in your business — more important than your trucks, your tools, or even your crew. Every decision you make with a client should be filtered through this question: **\"Is this worth risking a bad review?\"**" },
        { type: "stats", title: "The Real Cost of Bad Reviews", items: [
          { value: "10-15%", label: "Business loss per year from a single bad review" },
          { value: "20-50%", label: "Business loss from damaging reviews (scam, abandoned job, etc.)" },
        ], note: "A standard negative review — \"slow communication\" or \"went over budget\" — will cost you roughly 10-15% of your annual revenue. But devastating reviews that use words like **\"walked off the job,\" \"didn't finish the work,\" \"ripped us off,\"** or **\"scammers\"** can destroy 20-50% of your business. These are the reviews that kill companies, because the number one thing a customer looks for in reviews is **trustworthiness**. Quality matters, but trust comes first — if a company looks untrustworthy, they're not getting the job no matter how good their work is." },
        { type: "h", text: "Resolve Disputes on Their Merits" },
        { type: "p", text: "Resolve unfinished work and disputes according to the contract and the customer's concerns. Keep that process separate from review requests. Ask every client for honest feedback, with no reward or preferred rating." },
        { type: "notes", items: [
          { tone: "check", lead: "Fix it first, then ask — with no strings attached.", text: "Resolve the complaint based on the contract and the work. Request honest feedback separately, with no incentive or preferred rating. [Google’s review policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en) prohibits incentivized reviews; the [FTC’s review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) explains the federal restrictions. For a specific dispute, [check your state](/master-class?tab=state-guide) and consult a qualified adviser. Source reviewed October 11, 2026." },
          { tone: "x", lead: "Never get into a pissing contest with a client.", text: "You will always lose. Even if you're right, even if the client is being unreasonable — the public will side with the homeowner every time. A back-and-forth argument in Google Reviews makes you look petty and unprofessional. Responding to negative reviews should be calm, professional, and focused on resolution — never defensive or combative." },
        ] },
        { type: "h", text: "What Clients Actually Look For in Reviews" },
        { type: "ranked", items: [
          { title: "Trustworthiness", text: "Did they do what they said? Did they show up? Did they finish? This is the #1 filter and the reason 'scam' reviews are devastating" },
          { title: "Communication", text: "Did they keep the client in the loop? Were they responsive? Did they return calls and texts promptly?" },
          { title: "Quality of Work", text: "Was the craftsmanship good? Did they pay attention to details? Were there callbacks or warranty issues?" },
          { title: "Timeline & Reliability", text: "Did they start and finish on time? Were there unexplained delays? Did they manage expectations?" },
          { title: "Cleanliness & Respect", text: "Did they protect the property? Clean up daily? Treat the home and family with respect?" },
          { title: "Price Fairness", text: "Was pricing transparent? Were there surprise charges? Interestingly, price is one of the least-mentioned traits in positive reviews" },
        ] },
        { type: "tip", title: "The Math That Should Change How You Handle Every Client", text: "If your business does $500K/year and a single bad review costs you 10-15%, that's $50,000-$75,000 in lost revenue — every year it sits there. A devastating \"scam\" or \"abandoned job\" review at 20-50% impact is $100,000-$250,000 per year. Now compare that to the $500-1,000 of disputed work you're arguing about. The math is not even close. Resolve the dispute fairly, document the agreed outcome, and keep any request for an honest review separate." },
        { type: "h", text: "Handling Difficult Clients" },
        { type: "p", text: "Some clients will never be satisfied — no matter how good your work is, how many extras you throw in, or how many times you come back to fix things. These clients exist in every market, and you need to recognize them early. Their goal may be to get free work, negotiate after the fact, or simply find fault with everything. Some are looking for blood from the start, and you may be their chosen victim before you even pick up a hammer." },
        { type: "notes", items: [
          { tone: "warn", lead: "The goal is always the same: walk away without a lawsuit or a bad review.", text: "You won't win every client relationship, but you can control how it ends. A clean exit — where the client feels heard and you part on neutral terms — is worth more than being \"right.\" Standing your ground with a difficult client is not a winning approach. Pride has no ROI in this business." },
          { tone: "plain", lead: "Never get personal — no politics, religion, personal views, or opinions.", text: "Keep every interaction 100% professional and focused on the work. Even casual small talk can turn dangerous. If a client brings up a topic you disagree with — don't engage, don't push back, don't even hint at your position. They may seem fine in the moment, but disagreements plant seeds of resentment that surface later as \"difficult to work with\" reviews or refusal to pay. You are there to build, not to debate." },
          { tone: "plain", lead: "Always be agreeable — stay neutral, stay relevant, stay professional.", text: "Even when the client is wrong about a construction method, a timeline, or a material choice — correct them with facts, not attitude. \"I totally understand why you'd think that, and here's what we've found works best...\" will always land better than \"That's not how it works.\" Agreeable doesn't mean pushover — it means you control the conversation without creating conflict. The contractors who build the biggest businesses are the ones who know how to manage people, not just projects." },
        ] },
        { type: "panels", items: [
          { title: "Red Flags of a Problem Client", tone: "x", items: [
            "Mentions lawsuits or attorneys early in the process",
            "Has left multiple 1-star reviews for other businesses",
            "Constantly compares your pricing to other bids",
            "Wants to negotiate the price after work has started",
            "Refuses to sign a contract or put anything in writing",
            "Changes scope repeatedly without acknowledging cost changes",
            "Becomes overly friendly too fast — could be setting you up for a favor later",
          ] },
          { title: "How to De-Escalate & Exit Clean", items: [
            "Document everything — texts, emails, photos of completed work",
            "Communicate in writing, not just phone calls or in-person",
            "Offer a resolution before they escalate — be the bigger person",
            "Resolve disputed work on its merits; never exchange work, discounts or refunds for reviews",
            "Never raise your voice, curse, or get emotional on a jobsite",
            "If it's unsalvageable, offer a partial refund to close the chapter",
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
          { tone: "warn", lead: "Avoid hiring too fast.", text: "In the early stages, do NOT hire a ton of help like PMs or secretaries. The majority of the work will fall back on you regardless. Every salary you add is overhead that eats into margins before you have consistent revenue to support it." },
        ] },
        { type: "h", text: "Project Managers (PMs)" },
        { type: "p", text: "Your PM is the most trusted person in the operation. In the beginning, this should be YOU. Don't rush to fill this role until the workload is genuinely too large to keep up with." },
        { type: "stats", items: [
          { value: "$45,000 – $75,000/yr", label: "Typical PM Salary" },
          { value: "Experience & Scope", label: "Depends On" },
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
