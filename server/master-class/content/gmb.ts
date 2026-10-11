/**
 * Module 2 — GMB Setup & Optimization: the Google Business Profile lessons (/master-class?tab=gmb). Served only
 * to an account that holds the module, the bundle or an included course (server/master-class/routes.ts). The
 * lessons follow the module's promise in server/data/master-class-modules.json: setup and verification, review
 * management, fake-review defence, photos, posting cadence, suspension prevention and recovery. Each ends with
 * where that work is done in ConstructHUB. The advice is general practice and Google's published Business Profile
 * and review policies; no figure is quoted that we cannot stand behind.
 */
import type { ModuleLessons } from "../content";

export const GMB: ModuleLessons = {
  lessons: [
    {
      id: "setup",
      title: "Claim, verify and set up the profile",
      blocks: [
        { type: "p", text: "A Google Business Profile helps customers find a business on Maps and Search, but placement is not guaranteed. Follow [Google’s representation guidelines](https://support.google.com/business/answer/3038177?hl=en): use your real-world business name, eligible locations and an account you control. Get those three right before anything else." },
        { type: "panels", items: [
          { title: "Setting it up", items: [
            "Search for your business first: claim the existing listing rather than creating a second one",
            "Use the name customers know from your real-world signage, website and stationery; do not add keywords or cities just to rank",
            "If you travel to customers and do not serve them at your address, hide that address and enter your actual service area",
            "Do not use fake addresses, PO boxes or rented virtual-office addresses as operating locations; check Google’s eligibility rules before listing any office",
            "Pick the primary category that names your trade; add secondary categories only for work you actually do",
            "List your services under each category and write the description in plain words about the work and the area",
          ] },
          { title: "Verification", items: [
            "Google decides which methods it offers a given profile: video, phone, email, postcard or a live call",
            "If video verification is offered, follow Google’s prompts for evidence of the business, its location and your authority to manage it",
            "Verify from a device signed in to the account that will keep owning the profile — an employee's personal Gmail is how businesses lose profiles",
            "Add a second owner (you, if an agency set it up) before you do anything else",
          ] },
        ] },
        { type: "tip", text: "**Who owns the profile?** Review owner access and arrange any needed transfer while the current owner is available. Recovery time and outcome vary." },
        { type: "in-app", text: "Add each profile as a location in [Locations](/locations) and connect your Google account there; the rest of the course's Google tools work from those locations." },
      ],
    },
    {
      id: "info",
      title: "Business information that matches everywhere",
      blocks: [
        { type: "p", text: "Keep the real-world business name and contact details accurate on your profile, website and directories. Inconsistencies can confuse customers; they do not establish a fixed ranking penalty. Respect address-visibility rules for service-area businesses." },
        { type: "panels", items: [
          { title: "Keep accurate and consistent", items: [
            "Real-world business name, consistent with how customers know you",
            "Where an address may be published, use an accurate format; keep a private service-area address hidden where required",
            "One primary phone number that you own, not a tracking number you may drop",
            "Website: the home page, or the city page for a multi-location profile",
            "Hours, including holiday hours set ahead of time",
          ] },
          { title: "Fill in what competitors skip", items: [
            "Opening date, so Google can show how long you have been in business",
            "Attributes that apply: veteran-owned, women-owned, on-site estimates, and the accessibility ones",
            "Appointment or quote link to your contact page",
            "Questions & answers: ask and answer the questions customers call about (licensing, financing, service area)",
          ] },
        ] },
        { type: "tip", text: "**Edits do not need your approval.** Anyone can suggest a change to your hours, phone or category, and Google applies some of them. Check the profile monthly and watch it for changes — the next lessons cover both." },
        { type: "in-app", text: "[Locations](/locations) keeps the canonical details for every business; [Listing editor](/listing-editor) is where the Google profile's details are edited." },
      ],
    },
    {
      id: "photos",
      title: "A photo strategy that shows the work",
      blocks: [
        { type: "p", text: "Recent, accurate photos can help customers assess your work and team. A sparse photo section does not by itself establish that a business is a lead generator." },
        { type: "panels", items: [
          { title: "What to post", items: [
            "Finished jobs in daylight, with before-and-after pairs where you have them",
            "Your crew at work in branded shirts, your wrapped trucks, your shop or office",
            "The materials and brands you install, on the job rather than from the catalog",
            "The owner and the people who answer the phone — the faces a customer will meet",
          ] },
          { title: "Habits", items: [
            "Choose a manageable schedule for adding useful project photos",
            "Upload with customer permission and avoid sharing private location details",
            "Write the photo's caption or post text with the service and the city when the feature allows it",
            "Delete blurry, duplicate or off-brand photos; quality is what a browsing homeowner judges",
          ] },
        ] },
        { type: "tip", text: "**No promises about ranking.** Use photos to inform customers. Do not treat filenames, upload frequency or geotags as a guaranteed way to improve placement." },
        { type: "in-app", text: "Queue photo batches on a schedule from [Posts & Photos](/gbp-content); keep the originals in the [Media Library](/media-library)." },
      ],
    },
    {
      id: "reviews",
      title: "Reviews: asking the right way, answering every one",
      blocks: [
        { type: "p", text: "Reviews can help customers evaluate a business and contribute to local prominence. Google describes [local ranking in terms of relevance, distance and prominence](https://support.google.com/business/answer/7091); review volume alone does not determine placement. Request honest feedback consistently." },
        { type: "panels", items: [
          { title: "Asking", items: [
            "Ask every completed job, by text or email, with your direct review link — the day the job is done",
            "Ask in person first: 'Please share an honest Google review of your experience' — then send the same link to every customer",
            "One polite reminder a week later; then stop",
            "Ask for honest feedback. Never ask only happy customers, never screen first, never offer anything for a review",
          ] },
          { title: "Answering", items: [
            "Reply to every review within a few days, in the owner's voice, with the customer's name and the job",
            "A 5-star reply is short and specific; a bad review gets a calm, factual reply and an offer to fix it offline",
            "Keep replies calm and protect private details; prospective customers may read the exchange",
            "Fix the problem first, then ask for an honest update — never a change of rating in exchange for anything",
          ] },
        ] },
        { type: "tip", text: "**Keep review requests honest.** Google prohibits incentivized reviews and selectively soliciting positive reviews. The [FTC review-rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) explains restrictions on buying reviews conditioned on sentiment and certain review-suppression practices. These are distinct rules; [check your state](/master-class?tab=state-guide) for local consumer-protection guidance and seek advice for specific disputes. Source reviewed October 11, 2026." },
        { type: "in-app", text: "[Google Reviews](/google-reviews) sends the review requests and reminders from your templates, pulls the reviews in, and drafts replies for your approval with AI reply settings." },
      ],
    },
    {
      id: "defense",
      title: "Fake reviews and competitor attacks",
      blocks: [
        { type: "p", text: "Profiles can receive suspicious reviews or inaccurate edits. Investigate the evidence rather than assuming a competitor is responsible; report suspected policy violations through Google’s tools." },
        { type: "panels", items: [
          { title: "Signs of an attack", tone: "warn", items: [
            "A burst of 1-star reviews with no job details, from accounts with one review each",
            "Reviews naming a job, date or person you never had",
            "Your hours, phone, website or category changing without you",
            "A second listing with your name or a near-copy of it, or a competitor listed at your address",
          ] },
          { title: "What to do", items: [
            "Report the review from the profile, then open a case in Google's review-management tool for business owners and keep the case number",
            "Reply publicly, briefly and calmly: 'We have no record of this job and have reported the review' — nothing more",
            "Reject wrong suggested edits and restore the right values; report duplicate and spam listings with Google's redressal form",
            "Document everything with dates and screenshots; if the attacker is identifiable, that record is what a lawyer needs",
          ] },
        ] },
        { type: "tip", text: "**Never retaliate.** Do not post fake reviews or ask friends to do so. Report suspected violations, respond factually and retain relevant evidence." },
        { type: "in-app", text: "Profile Guard (in [Locations](/locations), per location) keeps an approved snapshot of your profile, watches for changes and can restore them, and its Report step assembles the evidence for Google's official form — you submit it yourself." },
      ],
    },
    {
      id: "posts",
      title: "Posting cadence and a content calendar",
      blocks: [
        { type: "p", text: "Use profile posts to share useful, current updates. Choose a sustainable schedule and review what customers can see; posting does not guarantee better rankings." },
        { type: "panels", items: [
          { title: "A calendar that holds up", items: [
            "One update a week: a finished job, a seasonal reminder, a team note or an offer",
            "Seasonal posts a month ahead (gutter season, storm season, year-end financing)",
            "Offers with real end dates, honored as written",
            "Events for anything public: home shows, open houses, community work",
          ] },
          { title: "Writing them", items: [
            "Lead with the job and the town; one photo; one plain call to action",
            "Same facts as the website — no prices or claims you would not put on a quote",
            "Reuse the post on Facebook and Instagram, not the other way round",
            "Check the post went live; Google rejects some for words it reads as medical, financial or alcohol-related",
          ] },
        ] },
        { type: "in-app", text: "Draft a month of posts, approve them and let [Posts & Photos](/gbp-content) publish on the cadence you set; [Social Media](/social-media) sends the same updates to your other accounts." },
      ],
    },
    {
      id: "suspension",
      title: "Suspension prevention and recovery",
      blocks: [
        { type: "p", text: "A suspension can affect profile visibility and customer contact. Review the reason and current Google guidance, correct eligibility problems and use the available appeal process. Timing and outcomes vary." },
        { type: "panels", items: [
          { title: "Eligibility and accuracy issues to check", tone: "warn", items: [
            "An inaccurate business name, location or category, including keywords added only for ranking",
            "An ineligible virtual office or mailbox, or displaying an address where customers are not served",
            "More than one profile for the same business, or a new profile after a suspension",
            "Incorrect hours, phone or website details",
            "Evidence that the listing does not meet Google’s representation rules",
          ] },
          { title: "Getting reinstated", items: [
            "Do not create a replacement profile to bypass a suspension; use the appeal process for the existing profile",
            "Fix what triggered it first (name, address visibility, duplicates) so the profile is compliant when reviewed",
            "Follow the current appeal instructions and provide relevant evidence of your legitimate operation; do not invent a storefront or signage",
            "Keep the appeal factual and follow the instructions for its current status",
          ] },
        ] },
        { type: "in-app", text: "If your profile is suspended and you want help with the appeal, [Reinstatement](/reinstatement) is where you ask us to review and take on the case." },
      ],
    },
    {
      id: "measure",
      title: "Measuring where you rank",
      blocks: [
        { type: "p", text: "Map rankings are local: the three businesses shown depend on where the searcher is standing. Checking from your own office tells you how you rank at your office. To know where you win and where you are invisible, check the same search from points across your service area and watch how that map changes month to month." },
        { type: "panels", items: [
          { title: "What to watch", items: [
            "Your main service plus the city, from a grid of points across the area you sell in",
            "Calls, direction requests and website clicks in the profile's own Performance report",
            "Which competitor holds the spots you don't, and what their profile has that yours lacks",
            "Movement after a change — a new category, a photo push, a review month",
          ] },
          { title: "What to change when it's flat", items: [
            "Check relevance, distance and prominence before attributing a ranking gap to reviews",
            "Then the primary category and the services list",
            "Then the city pages on your website that the profile links to",
            "Correct inaccurate business details, but never change the name or address solely to chase rankings",
          ] },
        ] },
        { type: "in-app", text: "The [GMB Ranking Grid](/ranking-grid) scans a grid across your service area and shows your map rank at each point, so a change is measured instead of guessed." },
      ],
    },
  ],
};
