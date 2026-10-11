R4 course repair report — October 11, 2026

Read both audits from /out/score4-tools-codex.md (Master Class, Guides and Lane C) and /out/score4-tools-kimi.md (Master Class, Guides and Lane H). Changes are left uncommitted. No push, merge, deploy, production access, database writes or port 5433 use. No application dependencies added.

Verification: npm run check passed using Node 20.19.6. DATABASE_URL= npx vitest run --configLoader runner server/master-class/master-class.test.ts server/master-class/progress.test.ts server/master-class/content-safety.test.ts server/state-guides.test.ts passed 43 tests. The runner option is needed here because node_modules is a read-only mount and Vite’s default config loader tries to write node_modules/.vite-temp.

Browser verification: [server/master-class/browser-tests/run.mjs:1](/home/veto/ConstructHUB-fix-r4-course/server/master-class/browser-tests/run.mjs:1) starts an isolated Vite component fixture on 127.0.0.1:8144 and closes the server/browser in finally. It passed persistence, account switching, signed-out separation, account errors without zero progress, lesson failure/retry, storage write failures, remount, reset, 390px width, truthful branding, inline checklists, cold anchors, visible keyboard focus, blocked storage getters, content-version changes and delayed anchor rendering. Actual course components and current lesson content are used; test authentication/query responses are explicit fixtures. Screenshots were opened and visually inspected: desktop-blocked.png, phone-blocked.png, phone-branding.png and phone-keyboard.png under /tmp/r4-course-screens.

The required live Express/Sam Rivera/Summit Roofing Co. verification remains blocked: ~/ConstructHUB-featshots/.env and the lane DB connection are absent from this container. No .env was created. These component screenshots do not establish live lane/database behavior. The .git file also points to an absent git directory, and git is not installed here, so a git status/diff check was unavailable. The files changed are confined to owned content/components, the new progress-store beside progress.ts, and education tests/report.

Implementation items:

- [client/src/components/guides/progress-store.ts:9](/home/veto/ConstructHUB-fix-r4-course/client/src/components/guides/progress-store.ts:9): Shared memory keeps ticks/unticks/reset working if the storage getter, reads or writes fail. Failed writes never cause a reread of stale persisted data. Store subscription keeps lesson and outline views synchronized. Verified by progress.test.ts and browser tests.
- [client/src/components/guides/progress.ts:23](/home/veto/ConstructHUB-fix-r4-course/client/src/components/guides/progress.ts:23): Binds progress to /api/auth/me user.id; switches snapshots immediately when the account changes. Signed-out progress is visit-only, never persisted or assigned to a later account. Failed/loading account queries pause controls and show an explanation in Master Class instead of zero completion. Verified by account-switch and error browser cases and store isolation tests.
- [client/src/components/guides/progress-store.ts:2](/home/veto/ConstructHUB-fix-r4-course/client/src/components/guides/progress-store.ts:2): Versioned account/checklist keys. Existing unscoped browser ticks are intentionally not imported because their owner is unknown. An explicitly listed previous version can retain only current stable IDs; removed tasks disappear, new tasks start incomplete, and reset does not resurrect older-version ticks. Versions without an approved migration start fresh. Authors must change IDs for substantively changed tasks and pass a current itemIds inventory plus previousVersions when approving a migration. Verified with successful storage, blocked storage, failed first migration write, account isolation, reset/reload and a rendered v1 → v2 test.
- [client/src/components/master-class/lesson-body.tsx:126](/home/veto/ConstructHUB-fix-r4-course/client/src/components/master-class/lesson-body.tsx:126): Inline checklists count only currently present item IDs and show the live storage/account note. Buttons remain keyboard-accessible and links have explicit focus rings. Verified by the actual vetting checklist in Playwright, phone width assertion, and the keyboard screenshot.
- [client/src/components/master-class/lesson.tsx:54](/home/veto/ConstructHUB-fix-r4-course/client/src/components/master-class/lesson.tsx:54): Outline count and bar reflect current lesson IDs and live persistence status; unknown account state does not render a 0% bar. Shared lesson/outline ticks, reset and remount were exercised in Playwright.
- [client/src/components/master-class/state-guide.tsx:174](/home/veto/ConstructHUB-fix-r4-course/client/src/components/master-class/state-guide.tsx:174): State-step completion follows instruction identity (category, title, description, URL, tips and requirement flag), not ordinal position. Reordering preserves ticks; edited/replaced instructions require completion again. Only successful detail queries can update the module completion. Verified by stateStepId regression tests and the existing state-guide suite.
- [client/src/components/master-class/lesson.tsx:100](/home/veto/ConstructHUB-fix-r4-course/client/src/components/master-class/lesson.tsx:100): Retries a missing anchor for up to three animation frames and cancels pending work on unmount/hash change. Verified with cold-load reviews and a fixture target mounted two frames late.

Content verification: every replacement below was compared with the original file, and the final source contains the stated replacement. [server/master-class/content-safety.test.ts:1](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content-safety.test.ts:1) prevents reintroduction of the cited deception and employment absolutes; the existing registry tests verify route links, module outlines and protected lesson delivery. Government/policy sources were checked on October 11, 2026; the new legal explanations include state-guide links and contextual qualifications. This is a source review, not an assertion of legal-professional approval.

Sources used:

- [Google business representation guidelines](https://support.google.com/business/answer/3038177?hl=en).
- [Google review/content policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en).
- [IRS worker classification](https://www.irs.gov/taxtopics/tc762).
- [DOL outside-sales exemption](https://www.dol.gov/agencies/whd/fact-sheets/17f-overtime-outside-sales).
- [FTC noncompete rule status](https://www.ftc.gov/legal-library/browse/rules/noncompete-rule).
- [FTC review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).

Every changed passage (50 entries; grouped bullets are reported together), before → after:

1. [server/master-class/content/gmb.ts:17](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:17)

   **Before:** For most contractors the Google Business Profile is the first thing a homeowner sees and the only "website" many of them ever open. It is free, it ranks in the map pack above every paid ad, and it is governed by Google's Business Profile guidelines: one profile per real business location, in the real business name, with a verified owner. Get those three right before anything else.

   **→ After:** A Google Business Profile helps customers find a business on Maps and Search, but placement is not guaranteed. Follow [Google’s representation guidelines](https://support.google.com/business/answer/3038177?hl=en): use your real-world business name, eligible locations and an account you control. Get those three right before anything else.

2. [server/master-class/content/gmb.ts:21](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:21)

   **Before:** Use the exact legal or trading name on your license and your trucks — no added keywords or cities

   **→ After:** Use the name customers know from your real-world signage, website and stationery; do not add keywords or cities just to rank

3. [server/master-class/content/gmb.ts:22](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:22)

   **Before:** Service-area business (you go to the customer): hide the address and set the service area instead

   **→ After:** If you travel to customers and do not serve them at your address, hide that address and enter your actual service area

4. [server/master-class/content/gmb.ts:23](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:23)

   **Before:** No explicit exclusion of fake or rented virtual-office addresses in the setup checklist.

   **→ After:** Do not use fake addresses, PO boxes or rented virtual-office addresses as operating locations; check Google’s eligibility rules before listing any office

5. [server/master-class/content/gmb.ts:45](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:45)

   **Before:** Business name, exactly as filed and as on the license

   **→ After:** Real-world business name, consistent with how customers know you

6. [server/master-class/content/gmb.ts:93](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:93)

   **Before:** Ask in person first: 'If you're happy, a Google review helps us more than anything' — then send the link

   **→ After:** Ask in person first: 'Please share an honest Google review of your experience' — then send the same link to every customer

7. [server/master-class/content/gmb.ts:104](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:104)

   **Before:** **Incentives and gating break the rules.** Google's review policy removes incentivised reviews and can suspend the profile, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews or suppressing negative ones. Same rule as the Reputation lesson in Module 1: resolve the dispute on its merits, keep the review request separate.

   **→ After:** **Keep review requests honest.** Google prohibits incentivized reviews and selectively soliciting positive reviews. The [FTC review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) explains restrictions on buying reviews conditioned on sentiment and certain review-suppression practices. These are distinct rules; [check your state](/master-class?tab=state-guide) for local consumer-protection guidance and seek advice for specific disputes. Source reviewed October 11, 2026.

8. [server/master-class/content/gmb.ts:161](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/gmb.ts:161)

   **Before:** A virtual office, mailbox or home address with the address shown for a service-area business

   **→ After:** An ineligible virtual office or mailbox, or displaying an address where customers are not served

9. [server/master-class/content/licensing.ts:15](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:15)

   **Before:** Using subs will always be easier than building a W-2 crew, but there are critical legal and operational realities you need to understand.

   **→ After:** Decide whether to use subcontractors or employees based on the work, supervision, capacity and applicable rules. A 1099 form or contract label does not by itself establish independent-contractor status.

10. [server/master-class/content/licensing.ts:17](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:17)

   **Before:** Every sub MUST carry their own insurance and workers comp. If they don't and one of their employees gets hurt on your jobsite, the liability falls back on YOU. Always verify their certificates of insurance (COIs) and make sure they're current.

   **→ After:** Insurance and workers’ compensation obligations, exemptions and responsibility for injuries depend on the jurisdiction and working arrangement. Before work starts, [check your state](/master-class?tab=state-guide), confirm coverage with the insurer and discuss gaps with your adviser.

11. [server/master-class/content/licensing.ts:18](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:18)

   **Before:** Create a contract stating they are responsible for their own employees, taxes, fees, and liability. This is your legal protection. Without it, you're exposed.

   **→ After:** Use a written agreement covering scope, payment, safety and each party’s responsibilities. A contract does not automatically transfer liability or determine employment status; [check your state](/master-class?tab=state-guide) and have local counsel review it.

12. [server/master-class/content/licensing.ts:19](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:19)

   **Before:** 1099 Rule — No Schedule Dictation:

   **→ After:** Worker classification:

13. [server/master-class/content/licensing.ts:19](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:19)

   **Before:** You cannot dictate a sub's schedule. This is a hard legal requirement for 1099 classification. If you control when and how they work, the IRS can reclassify them as W-2 employees, exposing you to back taxes, penalties, and fines.

   **→ After:** Scheduling is one part of the facts, not a universal yes/no test. For federal employment taxes, the [IRS examines behavioral control, financial control and the relationship](https://www.irs.gov/taxtopics/tc762). Other laws may use different tests: [check your state](/master-class?tab=state-guide) and confirm your actual working arrangement with a qualified adviser. Source reviewed October 11, 2026.

14. [server/master-class/content/licensing.ts:23](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:23)

   **Before:** Keeping Subs Anonymous to Clients

   **→ After:** Be clear about who performs the work

15. [server/master-class/content/licensing.ts:24](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:24)

   **Before:** Most clients don't like knowing a company uses subs — they hired YOU, not a mystery crew. Make sure subs keep this anonymous:

   **→ After:** Explain which work your employees perform and which work subcontractors perform. Tell clients who supervises the job and who handles questions, defects and warranty requests.

16. [server/master-class/content/licensing.ts:26](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:26)

   **Before:** Subs should NOT wear their own logos or company decals on the jobsite / Provide branded shirts and vehicle magnets with YOUR company logo / Amazon does this with their delivery drivers — branded vans, branded uniforms / Uber, Lyft, and FedEx all operate with 1099 contractors using company branding / FedEx drivers use company trucks despite being classified as 1099 / There are gray areas in this space — but consistent branding is key to client trust

   **→ After:** Identify the subcontractor and their role before they arrive / Use uniforms or jobsite signs only with permission and without implying a false employment relationship / Name the person responsible for supervision and customer communication / Document scope, quality standards, cleanup and warranty responsibilities

17. [server/master-class/content/licensing.ts:32](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:32)

   **Before:** Non-compete agreements have been largely abolished due to freedom of rights rulings. You can no longer force a sub to sign one. However, you CAN have them sign an **NDA (Non-Disclosure Agreement)** which limits who they can talk to — restricting them from sharing your client lists, pricing structures, operational processes, or contacting your clients directly. This is your best legal protection for keeping your business intelligence private.

   **→ After:** Non-competes, non-solicitation terms and confidentiality agreements have different purposes and limits. An NDA is not blanket permission to restrict client contact or protected disclosures. Enforceability depends on jurisdiction, wording and circumstances: [check your state](/master-class?tab=state-guide) and obtain local legal advice before using a restriction. The [FTC’s noncompete rule page](https://www.ftc.gov/legal-library/browse/rules/noncompete-rule) reports that its federal rule is not in effect or enforceable; this does not settle state law. Source reviewed October 11, 2026.

18. [server/master-class/content/licensing.ts:47](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:47)

   **Before:** Commission only — 8-10% of revenue minus sales tax.

   **→ After:** Choose a lawful compensation plan.

19. [server/master-class/content/licensing.ts:47](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:47)

   **Before:** Do NOT put a sales rep on salary. This is a huge long-term exposure. Commission-only reps perform better because if they don't sell, they don't eat.

   **→ After:** Do not assume that commissions remove minimum-wage or overtime obligations. The [DOL outside-sales exemption](https://www.dol.gov/agencies/whd/fact-sheets/17f-overtime-outside-sales) depends on job duties and where the work occurs. Before setting pay, [check your state](/master-class?tab=state-guide) and confirm applicable federal and state requirements with payroll or legal counsel. Source reviewed October 11, 2026.

20. [server/master-class/content/licensing.ts:53](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:53)

   **Before:** Never say you're available same day — even if you are.

   **→ After:** Give accurate availability.

21. [server/master-class/content/licensing.ts:53](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:53)

   **Before:** Schedule estimates 1-2 days ahead. If you show up immediately, the client assumes you're not busy, which signals you don't have much work. A slight wait creates perceived demand and makes them value your time more.

   **→ After:** Offer appointment times you can meet, including same-day appointments when available. Set honest expectations about estimate turnaround and project capacity.

22. [server/master-class/content/licensing.ts:73](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:73)

   **Before:** If a client has a remaining $500-1,000 complaint, resolve it because it's the right call, not as payment for a review. Afterward, ask for an honest review exactly as you would any client. Never make the fix, a discount, or any reward conditional on a review or its star rating — Google removes incentivized reviews, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews. A client whose problem you solved often writes the best review you'll get anyway.

   **→ After:** Resolve the complaint based on the contract and the work. Request honest feedback separately, with no incentive or preferred rating. [Google’s review policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en) prohibits incentivized reviews; the [FTC’s review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) explains the federal restrictions. For a specific dispute, [check your state](/master-class?tab=state-guide) and consult a qualified adviser. Source reviewed October 11, 2026.

23. [server/master-class/content/licensing.ts:107](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:107)

   **Before:** If they want free work, trade it for a written positive review

   **→ After:** Resolve disputed work on its merits; never exchange work, discounts or refunds for reviews

24. [server/master-class/content/licensing.ts:136](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:136)

   **Before:** Creating the illusion of size is critical for customer trust. Clients want to know they're hiring a real company that isn't going anywhere — not a one-person operation that might disappear.

   **→ After:** Build trust with accurate information about your team, credentials, capacity and process. A solo owner-operator can be professional without pretending to be a larger company.

25. [server/master-class/content/licensing.ts:138](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:138)

   **Before:** Have at least a few company vehicles with a full wrap — this signals permanence and professionalism

   **→ After:** Show real vehicles, equipment and completed projects that your business is authorized to represent

26. [server/master-class/content/licensing.ts:139](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:139)

   **Before:** All reps should wear branded uniforms — never trashy clothes, even if you're doing physical work

   **→ After:** Use clean workwear and authorized branding that accurately identifies the team

27. [server/master-class/content/licensing.ts:140](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:140)

   **Before:** Clients want to know they'll be taken care of by a company with staff, even if you're running lean

   **→ After:** Explain who handles scheduling, supervision, questions and follow-up, even when one person fills several roles

28. [server/master-class/content/licensing.ts:141](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:141)

   **Before:** If you're owner-operator, never tell the client you're the owner — say you're a PM or sales rep

   **→ After:** If you are the owner-operator, say so and explain your responsibilities on the project

29. [server/master-class/content/licensing.ts:143](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:143)

   **Before:** Why Separation Between You and the Brand Matters

   **→ After:** Show real accountability

30. [server/master-class/content/licensing.ts:143](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:143)

   **Before:** If a client knows you're the owner doing the install, they take you less seriously. There should be a clear separation between you and the brand. Tell them you're the PM or the sales rep — it creates a perception of structure, hierarchy, and accountability that makes clients feel safer about their investment. They want to see a company with departments, not a solo operator with a pickup truck.

   **→ After:** Introduce yourself and your actual role. Explain your written scope, communication schedule, quality checks and warranty process. Describe subcontractors and current capacity accurately; do not invent staff, departments or titles to imply a larger organization.

31. [server/master-class/content/licensing.ts:148](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/licensing.ts:148)

   **Before:** How your company is structured can make you or break you, especially in the early stages. Keep overhead low, use subs strategically with proper contracts, hire sales commission-only, don't rush into salaried positions, and always project a professional image. The companies that survive year one are the ones that sell well and spend smart — not the ones that hire fastest.

   **→ After:** Plan staffing around real workload and cash flow, document responsibilities, and describe your business honestly. Before deciding worker classification, compensation or contract restrictions, [check your state](/master-class?tab=state-guide) and consult qualified advisers for your situation.

32. [server/master-class/content/seo.ts:121](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/seo.ts:121)

   **Before:** **Write the canonical version once** — legal name, address format, the one tracking-free phone number, the exact website URL — and paste it everywhere. Never let a directory "improve" it.

   **→ After:** **Write the canonical details once** — real-world business name, accurate contact details and website URL. Follow each directory’s address rules; do not publish a private service-area address or invent an office for consistency.

33. [server/master-class/content/vetting.ts:30](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:30)

   **Before:** Many counties have no permitting requirements for certain work (siding, windows, doors). This creates a massive loophole allowing unqualified contractors to operate without oversight. No inspection means no accountability.

   **→ After:** Permit and inspection requirements depend on the jurisdiction, project and scope. Before work begins, [check your state](/master-class?tab=state-guide) and confirm the local building department’s requirements. Even where a permit is not required, agree on installation standards and quality checks.

34. [server/master-class/content/vetting.ts:56](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:56)

   **Before:** No workers' comp — if an employee is injured on your property, YOU could be sued

   **→ After:** Workers’ compensation requirements and injury liability vary; [check your state](/master-class?tab=state-guide) and verify applicable coverage or exemptions

35. [server/master-class/content/vetting.ts:58](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:58)

   **Before:** A $6K contractor bond won't cover your legal fees

   **→ After:** Bond terms, claim limits and covered costs vary; [check your state](/master-class?tab=state-guide) and review the actual bond rather than assuming it covers a loss

36. [server/master-class/content/vetting.ts:66](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:66)

   **Before:** In many states (like Washington), getting a contractor's license just means paying $65, getting a $300/year bond, and $100/month insurance. No experience required. No testing. States like California require 4 years experience + exams. Know your state's requirements.

   **→ After:** Licensing, registration, experience, exams, bonds and insurance requirements vary by state, locality and trade. Do not rely on generic fee or experience figures: [check your state](/master-class?tab=state-guide), follow the linked agency sources and confirm the requirements for the proposed work.

37. [server/master-class/content/vetting.ts:67](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:67)

   **Before:** A license is just a minimum legal requirement — not proof of skill, experience, or quality workmanship. Use the State Guide tab to check your state's licensing requirements.

   **→ After:** Where a credential is required, verify its status and scope with the issuing agency. A credential alone does not establish workmanship quality; [check your state](/master-class?tab=state-guide) and check references and relevant projects as well.

38. [server/master-class/content/vetting.ts:77](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:77)

   **Before:** Companies offering 1-2 year warranties don't want to be held accountable. But beware the opposite too — a company in business for 2 years offering a 10-year warranty is a red flag. Always ask how long they've been operating before trusting a warranty promise.

   **→ After:** Compare written warranty terms and the contractor’s ability to deliver support. Separate manufacturer coverage from the contractor’s workmanship warranty and ask how claims are handled.

39. [server/master-class/content/vetting.ts:78](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:78)

   **Before:** The warranty is the best indicator of a company's commitment to their work and customers. A company can't honor a 15-year warranty if they've only existed for 3.

   **→ After:** A warranty promise should identify the responsible business, scope, exclusions and claims process. Company age alone does not establish whether it can honor that promise.

40. [server/master-class/content/vetting.ts:81](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:81)

   **Before:** Schedule a meeting at their office. A legitimate company will have a physical space, showroom, or office. Ask how many employees they have. Verify the address on Google Maps — many scam companies use PO boxes, storage units, or random warehouses as false addresses.

   **→ After:** Ask how and where the business operates and who is accountable for your project. A legitimate service-area business may work from home and hide its address on Google. Verify contact details and credentials; do not demand a storefront or accept a fake address as proof.

41. [server/master-class/content/vetting.ts:115](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:115)

   **Before:** Legitimate in-house financing requires years of established operations, solid financial stability, and significant revenue (millions). Many new companies claim to offer financing but actually just partner with obscure third-party vendors for referral commissions.

   **→ After:** Ask who the lender is and request the financing terms in writing. A referral to a third-party lender is different from credit offered directly by the contractor. Requirements depend on the arrangement and jurisdiction; [check your state](/master-class?tab=state-guide) and consult the relevant regulator before offering financing.

42. [server/master-class/content/vetting.ts:116](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:116)

   **Before:** If a company offers financing but has been in business less than 5 years, chances are it's a third-party referral program — not real in-house financing.

   **→ After:** Company age alone does not identify the lender or establish whether financing is legitimate. Verify the provider and compare the written terms.

43. [server/master-class/content/vetting.ts:130](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:130)

   **Before:** Keep permanent records of all estimates, contracts, change orders, and communications. This protects you legally and builds a professional reputation.

   **→ After:** Keep independent copies of estimates, contracts, change orders and communications. Retention and disclosure requirements vary: [check your state](/master-class?tab=state-guide) and ask your adviser what records to retain and for how long.

44. [server/master-class/content/vetting.ts:131](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:131)

   **Before:** Carry proper insurance and workers' comp — it protects everyone. Cutting corners on coverage puts your customers, your employees, and your personal assets at risk.

   **→ After:** Confirm applicable insurance and workers’ compensation requirements and exemptions: [check your state](/master-class?tab=state-guide), then verify coverage with the insurer

45. [server/master-class/content/vetting.ts:133](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:133)

   **Before:** Stand behind your warranty with real history to back it up. Only promise warranty periods that your company has actually been in business long enough to fulfill.

   **→ After:** Offer written warranty terms you can support, including scope, exclusions and a clear claims process

46. [server/master-class/content/vetting.ts:148](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:148)

   **Before:** Confirm workers compensation coverage (get certificate)

   **→ After:** Confirm applicable workers’ compensation coverage or an agency-verified exemption

47. [server/master-class/content/vetting.ts:151](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:151)

   **Before:** Request a physical office visit or showroom tour

   **→ After:** Confirm real contact details and how the business operates; a service-area business may have no public office

48. [server/master-class/content/vetting.ts:158](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/vetting.ts:158)

   **Before:** Ask for proof of employees (not just subcontractors)

   **→ After:** Ask who will perform the work, including any subcontractors, and who is responsible for supervision

49. [server/master-class/content/website.ts:66](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/website.ts:66)

   **Before:** Urgency elements — "Free estimates this week" or "Limited availability"

   **→ After:** Use availability or offer deadlines only when they are real and can be honored

50. [server/master-class/content/website.ts:67](/home/veto/ConstructHUB-fix-r4-course/server/master-class/content/website.ts:67)

   **Before:** Trust badges — BBB, manufacturer certifications, insurance logos

   **→ After:** Display credentials and organization logos only when current, accurate and authorized

