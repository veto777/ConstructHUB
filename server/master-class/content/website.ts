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
        { type: "p", text: "Your homepage matters, but your location pages and slug pages (service pages, city pages) are just as important — sometimes more. These are the pages that actually rank for local and service-specific searches. Every city and service you cover should have its own dedicated landing page with unique content." },
        { type: "tip", text: "Each landing page must have unique content. Do not duplicate content across pages or copy from competitors. Use AI tools minimally — if you lean on AI too heavily, your content will read the same as everyone else's. Google grades your content on uniqueness. If it detects duplicate or thin content, your pages will not rank and can actually hurt your entire site." },
        { type: "in-app", text: "Each city page should match a location in [Locations](/locations) and the Google profile that links to it; the [GMB Ranking Grid](/ranking-grid) shows which towns the pages still have to win." },
      ],
    },
    {
      id: "page-speed",
      title: "Page Speed & Performance",
      blocks: [
        { type: "p", text: "Page speed is a direct ranking factor. Google rolled out a Core Web Vitals update and sites that load slowly will lose position. This is not optional — it directly affects where you show up in search results." },
        { type: "cards", items: [
          { title: "Google PageSpeed Insights", text: "Check your speed score, SEO issues, and Core Web Vitals. This is the tool Google uses to grade your site.", href: "https://pagespeed.web.dev/" },
          { title: "NitroPack", text: "A performance optimization tool that handles caching, image compression, and code minification automatically to boost page speed scores." },
        ] },
        { type: "in-app", text: "[Site Scan](/site-scan) runs PageSpeed on the pages you choose, mobile and desktop, and keeps the history so you can see a regression." },
      ],
    },
    {
      id: "mobile",
      title: "Mobile-First Design & User Experience",
      blocks: [
        { type: "p", text: "Over 70% of contractor website traffic comes from mobile devices. Google uses mobile-first indexing, meaning it ranks your site based on the mobile version. If your site doesn't work well on phones, you're losing both rankings and customers." },
        { type: "panels", items: [
          { title: "Mobile Must-Haves", items: [
            "Click-to-call button visible on every page",
            "Fast load time — under 3 seconds on mobile networks",
            "Large tap targets — buttons at least 48px tall",
            "Readable text without zooming — 16px minimum font size",
            "Sticky header or floating CTA button for easy contact",
          ] },
          { title: "Conversion Optimization", tone: "plain", items: [
            "Contact form above the fold on every service page",
            "Social proof near CTAs — review count, star rating, years in business",
            "Simple forms — name, phone, zip code, service needed (4 fields max)",
            "Urgency elements — \"Free estimates this week\" or \"Limited availability\"",
            "Trust badges — BBB, manufacturer certifications, insurance logos",
          ] },
        ] },
        { type: "in-app", text: "[Site Scan](/site-scan) runs PageSpeed's mobile check on the pages you choose; the mobile score is the one Google ranks by." },
      ],
    },
    {
      id: "portfolio",
      title: "Portfolio showcases that close jobs",
      blocks: [
        { type: "p", text: "Homeowners hire what they can see. A projects page with a dozen real jobs, photographed properly, closes more estimates than any paragraph about quality. It is also the page most often faked by new companies (see Vetting, tips 15 and 17), so yours has to be unmistakably yours." },
        { type: "panels", items: [
          { title: "What to show", items: [
            "Before and after of the same angle, taken in daylight after the clean-up",
            "The city and the service in every caption — that is what the page ranks for",
            "A line on what the job involved, the materials and how long it took",
            "Your crew and your trucks in some of the photos: proof the work is yours",
          ] },
          { title: "Rules that keep it honest and fast", items: [
            "Only your own projects — never stock photos or a supplier's gallery presented as your work",
            "Ask the homeowner before you publish photos of their house",
            "Compress every image before upload; a gallery of full-size phone photos is the slowest page on most contractor sites",
            "Add new work every quarter and retire the weakest — a dated portfolio reads as a closed business",
          ] },
        ] },
        { type: "in-app", text: "Keep the photos you reuse on the site and on your Google profile in the [Media Library](/media-library), and publish the best ones to the profile from [Posts & Photos](/gbp-content)." },
      ],
    },
    {
      id: "schema",
      title: "Schema Markup & Structured Data",
      blocks: [
        { type: "p", text: "Schema markup is code you add to your website that tells Google exactly what your business is, what services you offer, and where you're located. It's how you get rich results in search — star ratings, service lists, business hours, and more showing up directly in Google." },
        { type: "cards", cols: 3, items: [
          { title: "LocalBusiness Schema", text: "Business name, address, phone, hours, service area, and geo coordinates. This is the foundation — every contractor site needs it." },
          { title: "Service Schema", text: "Define each service with descriptions, price ranges, and service areas. Helps Google match your pages to specific service queries." },
          { title: "Review & FAQ Schema", text: "Embed review data and FAQ answers directly in search results. This takes up more space in Google and increases click-through rates." },
        ] },
        { type: "tip", text: "Use Google's **Rich Results Test** tool to validate your schema markup. If your schema has errors, Google will ignore it entirely. Most WordPress SEO plugins like Yoast or RankMath can generate basic schema automatically, but you'll want to customize it for contractor-specific services." },
      ],
    },
    {
      id: "cms-hosting",
      title: "CMS, hosting and owning your site",
      blocks: [
        { type: "p", text: "The platform matters less than who holds the keys. Contractors lose their sites to a web designer who disappears, a hosting bill nobody paid or a domain registered in an agency's name far more often than to a bad CMS. Pick a mainstream platform you or your staff can edit, then make sure every account is yours." },
        { type: "panels", items: [
          { title: "Choosing a platform", items: [
            "WordPress gives the most control and the most to maintain; hosted builders (Squarespace, Wix, Webflow) trade control for upkeep done for you",
            "Whatever you pick, you must be able to add a service page or a project yourself in an afternoon",
            "Managed hosting with automatic backups, HTTPS and updates beats the cheapest shared plan",
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
        { type: "p", text: "Most contractors completely ignore email marketing, which means it's a huge opportunity. Not every lead is ready to buy today — a follow-up system keeps you top of mind when they're ready. This is especially powerful for seasonal services." },
        { type: "cards", cols: 3, items: [
          { title: "Lead Follow-Up Sequence", text: "Set up automated emails after someone fills out your contact form. Day 1: confirmation. Day 3: case study. Day 7: special offer. Day 14: check-in." },
          { title: "Seasonal Campaigns", text: "Send seasonal reminders: spring gutter cleaning, fall roof inspections, winter prep, etc. These are high-conversion emails because they're timely and relevant." },
          { title: "Past Customer Nurture", text: "Stay in touch with completed customers. They're your best source of referrals and repeat business. Quarterly newsletters with maintenance tips work great." },
        ] },
        { type: "in-app", text: "Review requests and reminders after a job go out from [Google Reviews](/google-reviews); the longer follow-up and seasonal emails are your email tool's job." },
      ],
    },
  ],
};
