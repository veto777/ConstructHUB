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
        { type: "p", text: "For most contractors the Google Business Profile is the first thing a homeowner sees and the only \"website\" many of them ever open. It is free, it ranks in the map pack above every paid ad, and it is governed by Google's Business Profile guidelines: one profile per real business location, in the real business name, with a verified owner. Get those three right before anything else." },
        { type: "panels", items: [
          { title: "Setting it up", items: [
            "Search for your business first: claim the existing listing rather than creating a second one",
            "Use the exact legal or trading name on your license and your trucks — no added keywords or cities",
            "Service-area business (you go to the customer): hide the address and set the service area instead",
            "Pick the primary category that names your trade; add secondary categories only for work you actually do",
            "List your services under each category and write the description in plain words about the work and the area",
          ] },
          { title: "Verification", items: [
            "Google decides which methods it offers a given profile: video, phone, email, postcard or a live call",
            "Video verification is now the common path: be ready to film your signage, vehicles, tools and a proof of address",
            "Verify from a device signed in to the account that will keep owning the profile — an employee's personal Gmail is how businesses lose profiles",
            "Add a second owner (you, if an agency set it up) before you do anything else",
          ] },
        ] },
        { type: "tip", text: "**Who owns the profile?** Check Users in the profile today. If a former marketing company or employee is the primary owner, transfer it now while they still answer the phone. Recovering a profile from someone who has left takes weeks and is not always possible." },
        { type: "in-app", text: "Add each profile as a location in [Locations](/locations) and connect your Google account there; the rest of the course's Google tools work from those locations." },
      ],
    },
    {
      id: "info",
      title: "Business information that matches everywhere",
      blocks: [
        { type: "p", text: "Google cross-checks the name, address, phone number and hours on your profile against your website and every directory that lists you. Where they disagree, trust drops and so does the ranking; where they agree, nobody thinks about it. Decide the canonical version once and defend it." },
        { type: "panels", items: [
          { title: "Keep identical everywhere", items: [
            "Business name, exactly as filed and as on the license",
            "Address format (Suite vs Ste, St vs Street) — pick one spelling",
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
        { type: "p", text: "Photos are the part of the profile homeowners actually look at, and the part most contractors neglect after the first week. A profile with recent, real photos of jobs, crews and trucks reads as an active, local company; one with a logo and three stock images reads as a lead-gen front. Treat the photo section like a weekly habit, not a launch task." },
        { type: "panels", items: [
          { title: "What to post", items: [
            "Finished jobs in daylight, with before-and-after pairs where you have them",
            "Your crew at work in branded shirts, your wrapped trucks, your shop or office",
            "The materials and brands you install, on the job rather than from the catalog",
            "The owner and the people who answer the phone — the faces a customer will meet",
          ] },
          { title: "Habits", items: [
            "A few new photos every week beats fifty on launch day",
            "Take them with the location on and upload soon after the job; stale batches look staged",
            "Write the photo's caption or post text with the service and the city when the feature allows it",
            "Delete blurry, duplicate or off-brand photos; quality is what a browsing homeowner judges",
          ] },
        ] },
        { type: "tip", text: "**No promises about ranking.** Photos help you get chosen once you are seen; they are not a ranking trick, and no filename or geotag changes where the profile shows up." },
        { type: "in-app", text: "Queue photo batches on a schedule from [Posts & Photos](/gbp-content); keep the originals in the [Media Library](/media-library)." },
      ],
    },
    {
      id: "reviews",
      title: "Reviews: asking the right way, answering every one",
      blocks: [
        { type: "p", text: "Reviews decide the map pack more than any other thing you control, and they are the first thing a homeowner reads about you. The companies with hundreds of reviews did not get them by luck: they ask every single customer, the same way, within days of finishing, and they answer every review that comes in." },
        { type: "panels", items: [
          { title: "Asking", items: [
            "Ask every completed job, by text or email, with your direct review link — the day the job is done",
            "Ask in person first: 'If you're happy, a Google review helps us more than anything' — then send the link",
            "One polite reminder a week later; then stop",
            "Ask for honest feedback. Never ask only happy customers, never screen first, never offer anything for a review",
          ] },
          { title: "Answering", items: [
            "Reply to every review within a few days, in the owner's voice, with the customer's name and the job",
            "A 5-star reply is short and specific; a bad review gets a calm, factual reply and an offer to fix it offline",
            "Never argue, never post private details, never reply angry — the reply is read by the next 100 homeowners, not by the reviewer",
            "Fix the problem first, then ask for an honest update — never a change of rating in exchange for anything",
          ] },
        ] },
        { type: "tip", text: "**Incentives and gating break the rules.** Google's review policy removes incentivised reviews and can suspend the profile, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews or suppressing negative ones. Same rule as the Reputation lesson in Module 1: resolve the dispute on its merits, keep the review request separate." },
        { type: "in-app", text: "[Google Reviews](/google-reviews) sends the review requests and reminders from your templates, pulls the reviews in, and drafts replies for your approval with AI reply settings." },
      ],
    },
    {
      id: "defense",
      title: "Fake reviews and competitor attacks",
      blocks: [
        { type: "p", text: "A profile that ranks gets attacked: fake 1-star reviews from a competitor's circle, suggested edits that change your phone number or mark you closed, duplicate listings in your name, and spam profiles stuffed with keywords sitting above you. None of it is rare. Know what each one looks like and what Google actually offers to fix it." },
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
        { type: "tip", text: "**Never retaliate.** Posting fake reviews on the attacker's profile, or asking friends to, is the one move that gets *your* profile suspended. Report, reply once, document, move on." },
        { type: "in-app", text: "Profile Guard (in [Locations](/locations), per location) keeps an approved snapshot of your profile, watches for changes and can restore them, and its Report step assembles the evidence for Google's official form — you submit it yourself." },
      ],
    },
    {
      id: "posts",
      title: "Posting cadence and a content calendar",
      blocks: [
        { type: "p", text: "Profile posts are short updates that show on your listing for a while and then roll off. They do not rank you, but they tell the homeowner comparing three profiles which company is alive this month — and they give you a reason to put new photos up. Decide a cadence you can keep for a year, then keep it." },
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
        { type: "p", text: "A suspended profile disappears from Maps and Search overnight, and with it most of your calls. Suspensions are usually triggered by an edit Google's systems read as a guideline violation, and the fix is a reinstatement request with documents — not a new profile. Knowing the triggers avoids most of them." },
        { type: "panels", items: [
          { title: "Common triggers", tone: "warn", items: [
            "Changing the name, address or category in a burst, or adding keywords to the name",
            "A virtual office, mailbox or home address with the address shown for a service-area business",
            "More than one profile for the same business, or a new profile after a suspension",
            "Hours, phone or website edits that no longer match your site and directories",
            "Being reported by a competitor while any of the above is true",
          ] },
          { title: "Getting reinstated", items: [
            "Do not create a new profile; it will be suspended too and makes the appeal harder",
            "Fix what triggered it first (name, address visibility, duplicates) so the profile is compliant when reviewed",
            "Appeal through Google's reinstatement form once, with your business license, a utility bill or lease at the address and photos of permanent signage and vehicles",
            "One appeal at a time, answered factually; repeated or angry appeals slow it down",
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
            "Reviews first: the gap between you and the leader is usually counted in reviews",
            "Then the primary category and the services list",
            "Then the city pages on your website that the profile links to",
            "Not the name, not the address — those changes are the suspension triggers above",
          ] },
        ] },
        { type: "in-app", text: "The [GMB Ranking Grid](/ranking-grid) scans a grid across your service area and shows your map rank at each point, so a change is measured instead of guessed." },
      ],
    },
  ],
};
