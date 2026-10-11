/**
 * Module 3 — Website & Online Presence: the website lessons (/master-class?tab=website). Served only to an account
 * that holds the module, the bundle or an included course (server/master-class/routes.ts). The lesson order follows
 * the module's own promise (server/data/master-class-modules.json features): the blueprint, service and location
 * pages, speed and mobile, the portfolio, structured data, CMS and hosting, then follow-up email.
 */
import type { ModuleLessons } from "../content";

export const WEBSITE: ModuleLessons = {
  lessons: [
    {
      id: "blueprint",
      title: "The contractor website blueprint",
      blocks: [
        { type: "p", text: "A contractor site has one job: make a homeowner who already wants the work pick up the phone. That takes a small set of pages, each doing one thing well, with the same phone number and the same form on every one of them. Build these seven pages before anything else." },
        { type: "cards", items: [
          { title: "Home", text: "Who you are, what you do, where you work, one phone number and one form — above the fold." },
          { title: "One page per service", text: "Roofing, siding, windows: each with its process, materials, photos and its own FAQ." },
          { title: "One page per city", text: "The towns you actually work in, each with local projects and local wording." },
          { title: "Projects", text: "Real jobs with before-and-after photos, the city and the service in every caption." },
          { title: "Reviews", text: "Your Google reviews on your own site, pulled live or updated monthly." },
          { title: "About", text: "The owner, the crew, the license number, the insurance — the trust page." },
          { title: "Contact", text: "Phone, text, form, hours and service area. Every other page links here." },
        ] },
        { type: "in-app", text: "Run the live site through [Site Scan](/site-scan) once it is up: it finds the broken pages, slow pages and missing basics, and compares the site with your Google Business Profile." },
      ],
    },
    {
      id: "location-pages",
      title: "Location Pages & Slug Pages",
      blocks: [
        { type: "p", text: "Service and location pages can answer specific customer questions. Create them where you have distinct, useful information and real work or service coverage to describe; avoid near-duplicate pages for every keyword or town." },
        { type: "tip", text: "Give each landing page a useful purpose and verify its claims, including any AI-assisted text. Avoid copied or scaled content created mainly to manipulate search rankings. See [Google’s spam policies](https://developers.google.com/search/docs/essentials/spam-policies)." },
        { type: "in-app", text: "A city page can describe an area you serve without implying a staffed office or separate Google profile there. [GMB Ranking Grid](/ranking-grid) helps measure visibility across your service area." },
      ],
    },
    {
      id: "page-speed",
      title: "Page Speed & Performance",
      blocks: [
        { type: "p", text: "Speed and Core Web Vitals contribute to page experience, one of many ranking considerations. Strong scores do not guarantee higher rankings, and relevant content may rank despite weaker page experience. See [Google’s page-experience guidance](https://developers.google.com/search/docs/appearance/page-experience)." },
        { type: "cards", items: [
          { title: "Google PageSpeed Insights", text: "Inspect performance diagnostics and available Core Web Vitals field data. The PageSpeed score is not a Google ranking score.", href: "https://pagespeed.web.dev/" },
          { title: "NitroPack", text: "A performance optimization tool that handles caching, image compression, and code minification automatically to boost page speed scores." },
        ] },
        { type: "in-app", text: "[Site Scan](/site-scan) runs PageSpeed on the pages you choose, mobile and desktop, and keeps the history so you can see a regression." },
      ],
    },
    {
      id: "mobile",
      title: "Mobile-First Design & User Experience",
      blocks: [
        { type: "p", text: "Check your own analytics to understand mobile traffic. Make the phone experience usable: customers should be able to read the scope, inspect projects and contact you without struggling with the layout." },
        { type: "panels", items: [
          { title: "Mobile Must-Haves", items: [
            "Click-to-call button visible on every page",
            "Test loading and responsiveness on real phones and slower connections",
            "Use comfortably sized, spaced tap targets and test them on a phone",
            "Use readable text that remains usable when zoomed",
            "Sticky header or floating CTA button for easy contact",
          ] },
          { title: "Conversion Optimization", tone: "plain", items: [
            "Contact form above the fold on every service page",
            "Social proof near CTAs — review count, star rating, years in business",
            "Ask only for the information needed to respond to the inquiry",
            "Use availability or offer deadlines only when they are real and can be honored",
            "Display credentials and organization logos only when current, accurate and authorized",
          ] },
        ] },
        { type: "in-app", text: "[Site Scan](/site-scan) runs mobile performance checks; use the findings to improve usability, not as a prediction of ranking." },
      ],
    },
    {
      id: "portfolio",
      title: "Portfolio showcases that close jobs",
      blocks: [
        { type: "p", text: "Show real projects with clear captions and permission from the homeowner. A portfolio helps customers assess relevant work; it does not guarantee more accepted estimates." },
        { type: "panels", items: [
          { title: "What to show", items: [
            "Before and after of the same angle, taken in daylight after the clean-up",
            "Describe the actual city and service in captions without promising rankings",
            "A line on what the job involved, the materials and how long it took",
            "Show your crew and equipment accurately; photos alone do not verify who performed a project",
          ] },
          { title: "Rules that keep it honest and fast", items: [
            "Only your own projects — never stock photos or a supplier's gallery presented as your work",
            "Ask the homeowner before you publish photos of their house",
            "Compress images and test gallery performance on mobile",
            "Keep the portfolio current so customers can assess recent work",
          ] },
        ] },
        { type: "in-app", text: "Keep the photos you reuse on the site and on your Google profile in the [Media Library](/media-library), and publish the best ones to the profile from [Posts & Photos](/gbp-content)." },
      ],
    },
    {
      id: "schema",
      title: "Schema Markup & Structured Data",
      blocks: [
        { type: "p", text: "Structured data describes page content in a machine-readable form. Supported markup may make a page eligible for certain search features, but display is not guaranteed. Follow [Google’s structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)." },
        { type: "cards", cols: 3, items: [
          { title: "LocalBusiness Schema", text: "Describe real business details that match visible page content and the applicable structured-data requirements." },
          { title: "Service Schema", text: "Describe services accurately; a schema type alone does not establish eligibility for a Google rich result." },
          { title: "Review & FAQ Schema", text: "Check eligibility before adding review or FAQ markup. Do not promise contractor review stars or FAQ rich results from markup alone." },
        ] },
        { type: "tip", text: "Use Google’s Rich Results Test to inspect supported markup and resolve reported issues. Passing validation does not guarantee a rich result." },
      ],
    },
    {
      id: "cms-hosting",
      title: "CMS, hosting and owning your site",
      blocks: [
        { type: "p", text: "Choose a platform your team can maintain and make sure your business controls the domain, hosting and site accounts. Document access, renewals, backups and an exit plan." },
        { type: "panels", items: [
          { title: "Choosing a platform", items: [
            "Compare editing, backup, export and maintenance capabilities before choosing a self-managed CMS or hosted builder",
            "Whatever you pick, you must be able to add a service page or a project yourself in an afternoon",
            "Compare hosting options for backups, HTTPS, updates, support and the needs of your site",
          ] },
          { title: "Ownership checklist", items: [
            "The domain is registered to your company, in an account you control, with auto-renew on",
            "You hold admin logins for hosting, the CMS, Search Console and Analytics — the agency gets a user, not the owner seat",
            "You can export your pages, photos and leads and leave with them",
          ] },
        ] },
        { type: "in-app", text: "The [site connection guide](/guides#guide-connection) walks through putting the site behind Cloudflare and connecting Search Console; [Domains](/domains) keeps your domains' records and renewals in view." },
      ],
    },
    {
      id: "email",
      title: "Email Marketing & Follow-Up Systems",
      blocks: [
        { type: "p", text: "Follow-up email can help interested customers stay informed. Agree on appropriate contact preferences and test the usefulness of your messages." },
        { type: "cards", cols: 3, items: [
          { title: "Lead Follow-Up Sequence", text: "Example sequence to adapt to customer preferences: confirmation, relevant case study, then a polite check-in." },
          { title: "Seasonal Campaigns", text: "Send relevant seasonal reminders and measure responses before expanding the campaign." },
          { title: "Past Customer Nurture", text: "With appropriate contact preferences, send past customers useful maintenance information and measure whether it helps them." },
        ] },
        { type: "in-app", text: "Review requests and reminders after a job go out from [Google Reviews](/google-reviews); the longer follow-up and seasonal emails are your email tool's job." },
      ],
    },
  ],
};
