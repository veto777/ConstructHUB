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
        { type: "p", text: "Using subs will always be easier than building a W-2 crew, but there are critical legal and operational realities you need to understand." },
        { type: "notes", items: [
          { tone: "warn", lead: "Insurance & Workers Comp:", text: "Every sub MUST carry their own insurance and workers comp. If they don't and one of their employees gets hurt on your jobsite, the liability falls back on YOU. Always verify their certificates of insurance (COIs) and make sure they're current." },
          { tone: "plain", lead: "Subcontractor Agreement:", text: "Create a contract stating they are responsible for their own employees, taxes, fees, and liability. This is your legal protection. Without it, you're exposed." },
          { tone: "plain", lead: "1099 Rule — No Schedule Dictation:", text: "You cannot dictate a sub's schedule. This is a hard legal requirement for 1099 classification. If you control when and how they work, the IRS can reclassify them as W-2 employees, exposing you to back taxes, penalties, and fines." },
        ] },
        { type: "h", text: "Quality vs. Efficiency Trade-off" },
        { type: "p", text: "Controlling quality is always harder with subs — it's a constant balance of quality vs. efficiency and less hands-on work. Most subs will NOT clean up jobsites or do the small things to cater to clients (covering furniture, cleaning up after themselves, communicating updates). These details always reflect on YOUR company, not the sub." },
        { type: "h", text: "Keeping Subs Anonymous to Clients" },
        { type: "p", text: "Most clients don't like knowing a company uses subs — they hired YOU, not a mystery crew. Make sure subs keep this anonymous:" },
        { type: "list", cols: 2, items: [
          "Subs should NOT wear their own logos or company decals on the jobsite",
          "Provide branded shirts and vehicle magnets with YOUR company logo",
          "Amazon does this with their delivery drivers — branded vans, branded uniforms",
          "Uber, Lyft, and FedEx all operate with 1099 contractors using company branding",
          "FedEx drivers use company trucks despite being classified as 1099",
          "There are gray areas in this space — but consistent branding is key to client trust",
        ] },
        { type: "h", text: "Non-Competes vs NDAs" },
        { type: "p", text: "Non-compete agreements have been largely abolished due to freedom of rights rulings. You can no longer force a sub to sign one. However, you CAN have them sign an **NDA (Non-Disclosure Agreement)** which limits who they can talk to — restricting them from sharing your client lists, pricing structures, operational processes, or contacting your clients directly. This is your best legal protection for keeping your business intelligence private." },
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
          { tone: "check", lead: "Commission only — 8-10% of revenue minus sales tax.", text: "Do NOT put a sales rep on salary. This is a huge long-term exposure. Commission-only reps perform better because if they don't sell, they don't eat." },
          { tone: "tip", lead: "Poaching from competitors:", text: "This is what Elon Musk does — he recruits top talent from Microsoft and Google. Hiring a proven sales rep from a competitor saves you training time and they already know the trade. However, this is risky: they could flip on you, and they may have an NDA with their previous employer that could expose you legally. Always ask about prior arrangements before bringing them on." },
        ] },
        { type: "p", text: "**Best places to recruit:** Craigslist and Indeed are the best platforms to find a new sales rep or project manager. Post clear commission structures and expectations upfront." },
        { type: "h", text: "Sales Tactics That Win Jobs" },
        { type: "notes", items: [
          { tone: "plain", lead: "Never say you're available same day — even if you are.", text: "Schedule estimates 1-2 days ahead. If you show up immediately, the client assumes you're not busy, which signals you don't have much work. A slight wait creates perceived demand and makes them value your time more." },
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
          { tone: "check", lead: "Fix it first, then ask — with no strings attached.", text: "If a client has a remaining $500-1,000 complaint, resolve it because it's the right call, not as payment for a review. Afterward, ask for an honest review exactly as you would any client. Never make the fix, a discount, or any reward conditional on a review or its star rating — Google removes incentivized reviews, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews. A client whose problem you solved often writes the best review you'll get anyway." },
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
            "If they want free work, trade it for a written positive review",
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
        { type: "p", text: "Creating the illusion of size is critical for customer trust. Clients want to know they're hiring a real company that isn't going anywhere — not a one-person operation that might disappear." },
        { type: "list", cols: 2, tone: "plain", items: [
          "Have at least a few company vehicles with a full wrap — this signals permanence and professionalism",
          "All reps should wear branded uniforms — never trashy clothes, even if you're doing physical work",
          "Clients want to know they'll be taken care of by a company with staff, even if you're running lean",
          "If you're owner-operator, never tell the client you're the owner — say you're a PM or sales rep",
        ] },
        { type: "tip", title: "Why Separation Between You and the Brand Matters", text: "If a client knows you're the owner doing the install, they take you less seriously. There should be a clear separation between you and the brand. Tell them you're the PM or the sales rep — it creates a perception of structure, hierarchy, and accountability that makes clients feel safer about their investment. They want to see a company with departments, not a solo operator with a pickup truck." },
      ],
    },
  ],
  footer: [
    { type: "tip", title: "The Bottom Line on Business Structure", text: "How your company is structured can make you or break you, especially in the early stages. Keep overhead low, use subs strategically with proper contracts, hire sales commission-only, don't rush into salaried positions, and always project a professional image. The companies that survive year one are the ones that sell well and spend smart — not the ones that hire fastest." },
  ],
};
