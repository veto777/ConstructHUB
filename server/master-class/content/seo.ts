/**
 * Module 4 — SEO & Directory Domination: the local-SEO, citation, content, link-building and advertising lessons
 * (/master-class?tab=seo). Served only to an account that holds the module, the bundle or an included course
 * (server/master-class/routes.ts). The paid Google Ads playbook (/google-ads-guide, 12 sections, server-gated) and
 * the free LSA guide are linked from the ads lesson rather than copied here. The plan that includes Cloudflare +
 * Search Console is named by the client from shared/plans.ts ({connectionsPlan} below), never typed here.
 */
import type { ModuleLessons } from "../content";

export const SEO: ModuleLessons = {
  lessons: [
    {
      id: "search-console",
      title: "Google Search Console (GSC)",
      blocks: [
        { type: "p", text: "Use Google Search Console to submit sitemaps, request indexing and inspect crawl or indexing issues. Google decides whether to index a page; a request does not guarantee inclusion or a ranking. Review the reported issue before choosing a fix. See the [URL Inspection guidance](https://support.google.com/webmasters/answer/9012289)." },
        { type: "panels", items: [
          { title: "GSC Verification Methods", items: [
            "Domain property: DNS TXT record at your domain provider",
            "URL-prefix property: HTML file upload, HTML tag, Google Analytics or Google Tag Manager; DNS verification is also available",
          ] },
          { title: "Property scope and prerequisites", items: [
            "A Domain property covers all subdomains and both HTTP and HTTPS. A URL-prefix property covers only URLs beginning with the specified protocol, host and optional path",
            "DNS requires permission to edit domain records, whether at Cloudflare or another DNS provider",
            "HTML file verification needs permission to publish the verification file; HTML tag verification needs access to edit the homepage head",
            "Google Analytics requires the supported tracking code and edit permission; Google Tag Manager requires the container snippet and Publish or Admin permission",
            "A Google account is needed to use Search Console. Domain email access and root server access are not verification methods",
            "Follow the methods offered for your property in [Google’s verification instructions](https://support.google.com/webmasters/answer/9008080)",
          ] },
          { title: "What to Monitor", tone: "plain", items: [
            "Index coverage & errors",
            "Sitemap submission status",
            "Manual actions or penalties",
            "Core Web Vitals",
            "Page experience signals",
          ] },
        ] },
        { type: "callout", tone: "warn", title: "Critical Warning: Protect Your GSC Access", text: [
          "Give Search Console access only to people who need it. Misuse of owner permissions, including inappropriate disavow submissions, can harm search performance. Disavow is an advanced tool; review [Google’s disavow guidance](https://support.google.com/webmasters/answer/2648487) before using it.",
          "Review permissions when a working relationship ends. Remove access that is no longer needed and check ownership verification tokens as well as the user list.",
        ] },
        { type: "in-app", text: "Connecting Search Console inside ConstructHUB ([Search Console](/search-console), part of the {connectionsPlan} plan) pulls the property's search data into the platform; the [site connection guide](/guides#guide-connection) walks through the client-side steps." },
      ],
    },
    {
      id: "tracking",
      title: "Tracking & Analytics",
      blocks: [
        { type: "p", text: "Use analytics to understand measured traffic sources, visits and conversions. Consent choices, blockers and attribution limits mean the data is incomplete; do not treat it as a record of every visitor." },
        { type: "cards", items: [
          { title: "Google Analytics", text: "Track visitor behavior, traffic sources, conversions, and user demographics. Essential for understanding how people find and use your site." },
          { title: "IP Tracker Tools", text: "IP-based tools can help inspect visits and approximate network location; an IP address does not reliably identify a person or their exact location.", href: "https://www.tracemyip.org/" },
        ] },
        { type: "tip", text: "Compare analytics and SEO tools against the questions you need to answer, their data coverage and your budget. Third-party authority scores are estimates, not Google ranking scores." },
        { type: "in-app", text: "Your own visitor log is [IP Tracker](/ip-tracker): the install snippet records each visit by IP so you can see where traffic comes from and feed Click Guard's exclusions." },
      ],
    },
    {
      id: "content",
      title: "Content Strategy That Actually Ranks",
      blocks: [
        { type: "p", text: "Write useful content that explains your services and the places you actually serve. Prioritize accurate answers to customer questions and evidence from real projects; no publishing formula guarantees rankings." },
        { type: "panels", items: [
          { title: "Service Pages", items: [
            "One dedicated page per service (roofing, siding, windows, etc.)",
            "Include process details, materials used, and expected timelines",
            "Add before/after photos with proper alt text",
            "Include FAQ sections targeting \"how much does X cost\" queries",
          ] },
          { title: "Location Pages", items: [
            "Create location pages only where you can offer useful, distinct information about work in that area",
            "Reference local landmarks, neighborhoods, and community details",
            "Include photos from actual projects in that area",
            "Never copy-paste the same content across location pages",
          ] },
        ] },
        { type: "panels", items: [
          { title: "Blog & Guide Content", items: [
            "Write guides answering real customer questions: \"How long does a roof last?\"",
            "Comparison posts: \"Standing seam vs architectural shingles\"",
            "Case studies from real projects with cost breakdowns",
            "Choose a publishing schedule you can sustain without sacrificing accuracy or usefulness",
          ] },
          { title: "Content practices to avoid", tone: "warn", items: [
            "Publishing inaccurate or unhelpful content without review, whether human-written or AI-generated",
            "Copy-pasting competitor content or spinning articles",
            "Publishing pages that do not answer the visitor’s question; there is no universal minimum word count",
            "Repeating keywords unnaturally rather than writing for readers",
          ] },
        ] },
        { type: "in-app", text: "Run [Site Scan](/site-scan) after a content update to review the pages flagged for attention." },
      ],
    },
    {
      id: "backlinks",
      title: "Backlinks & Link Building",
      blocks: [
        { type: "p", text: "Relevant, independently earned links can help people discover your business. Judge a potential link by editorial context and usefulness, not a promised ranking boost." },
        { type: "panels", cols: 3, items: [
          { title: "Good Backlinks", tone: "plain", items: ["Relevant editorial coverage", "Relevant industry sites", "Guest posts on real blogs", "Local business directories", "Earned coverage of genuine news"] },
          { title: "Bad Backlinks", tone: "plain", items: ["Fiverr spam packages", "Paid links intended to manipulate rankings", "Irrelevant sites created to sell links", "Link farms and PBN spam", "Same anchor text repeatedly"] },
          { title: "Best Practices", tone: "plain", items: ["Prioritize relevant, independently earned links", "Vary your anchor text", "Build links gradually", "Qualify paid or sponsored links appropriately", "Monitor with Ahrefs/Semrush"] },
        ] },
        { type: "tip", text: [
          "**Guest Posts:** Contribute useful material to relevant publications. Do not use guest posts to manufacture keyword-rich links at scale.",
          "**Press releases:** Announce genuine news for readers and journalists. A press release is not a private blog network (PBN), and distribution does not guarantee editorial links. Follow [Google’s link-spam policy](https://developers.google.com/search/docs/essentials/spam-policies), including its rules for paid links.",
        ] },
        { type: "callout", tone: "ban", title: "Avoid Buying Backlinks on Fiverr", text: "Avoid packages designed to manipulate rankings through paid links, link farms or automated spam. Such links may be ignored or lead to action under Google’s spam policies; neither the impact nor recovery is predictable." },
        { type: "in-app", text: "Use the [SEO Suite](/seo) to inspect available authority, backlink and ranking data. Third-party coverage may be incomplete or delayed." },
      ],
    },
    {
      id: "citations",
      title: "Citations and directories",
      blocks: [
        { type: "p", text: "A citation lists business details on another site. Keep your real-world name and contact information accurate so customers can reach you. Follow each directory’s address rules, especially for home-based service-area businesses; a formatting difference is not proof of a ranking penalty." },
        { type: "cards", items: [
          { title: "Google Business Profile", text: "The one that matters most; everything else should match it." },
          { title: "Apple Business Connect", text: "What Apple Maps and Siri show." },
          { title: "Bing Places", text: "Bing, and the assistants and browsers that use it." },
          { title: "Better Business Bureau", text: "Checked by homeowners who vet contractors (see Vetting, tip 14)." },
          { title: "Yelp, Angi, Houzz, Nextdoor", text: "The consumer directories homeowners actually open." },
          { title: "Trade associations and the local chamber", text: "Slow to get, trusted, rarely spammed." },
        ] },
        { type: "tip", text: [
          "**Write the canonical details once** — real-world business name, accurate contact details and website URL. Follow each directory’s address rules; do not publish a private service-area address or invent an office for consistency.",
          "**Check duplicates.** Search your current and former contact details, verify ownership and use each directory’s correction process for inaccurate or duplicate listings.",
          "**Skip unverified bulk packages.** Review directory relevance, accuracy and your ability to maintain or remove listings.",
        ] },
        { type: "in-app", text: "Keep your accurate business details in [Locations](/locations), and follow each directory’s rules about which address details may be published." },
      ],
    },
    {
      id: "social",
      title: "Social Media & Reputation Building",
      blocks: [
        { type: "p", text: "Social media can build recognition and bring referral traffic. Choose channels your customers use and measure the results; activity is not a guaranteed Google ranking signal." },
        { type: "cards", items: [
          { title: "Facebook", text: "Post project updates, before/after photos, and customer testimonials. Join local community groups and participate without being salesy. Run targeted ads to homeowners within your service radius." },
          { title: "Instagram", text: "Share project photos, time-lapse videos and finished work with permission. Test formats and compare engagement rather than assuming one format always reaches more people." },
          { title: "YouTube", text: "Create useful project walkthroughs, how-to guides and behind-the-scenes videos. Search visibility depends on the content and query." },
          { title: "NextDoor", text: "Maintain an accurate business page and respond helpfully to relevant local requests. Measure the quality of referrals rather than assuming all traffic is ready to buy." },
        ] },
        { type: "tip", text: "**Choose a manageable scope:** Start with channels your customers use and expand only when you can maintain useful, accurate updates." },
        { type: "in-app", text: "[Social Media](/social-media) composes once and schedules to every connected account, and can draft posts from your Google updates and photos for your approval." },
      ],
    },
    {
      id: "ads",
      title: "Google Ads & Local Service Ads (LSA)",
      blocks: [
        { type: "p", text: "Paid advertising can bring visibility while you develop organic traffic. Compare Google Search Ads and Local Services Ads using your eligibility, goals and measured acquisition costs." },
        { type: "panels", items: [
          { title: "Google Search Ads", items: [
            "Target specific keywords: \"roof repair near me,\" \"siding contractor [city]\"",
            "Set geographic targeting to your exact service radius",
            "Use negative keywords to filter out DIY and job-seeker clicks",
            "Set a test budget you can afford and adjust using measured acquisition costs",
          ] },
          { title: "Local Services Ads", items: [
            "Lead-based billing applies under Google’s current billing and credit rules; review which leads are charged",
            "Check current badge and screening requirements for your category and region",
            "Placement depends on eligibility, the auction and the search",
            "Screening requirements vary by business category and location",
          ] },
        ] },
        { type: "tip", text: "**Budget strategy:** Compare actual lead quality and cost per acquired customer across channels. Do not assume LSA is cheaper. Review [Google’s Local Services guidance](https://support.google.com/localservices/answer/6224841) before setting up a campaign." },
        { type: "in-app", text: "The full campaign playbook is the [Google Ads guide](/google-ads-guide) (12 sections, open with any module); the [LSA guide](/lsa-guide) is free. [Click Guard](/google-ads) records the clicks on your site and builds the IP exclusion list the playbook relies on." },
      ],
    },
    {
      id: "maintenance",
      title: "The monthly SEO maintenance checklist",
      blocks: [
        { type: "p", text: "Use a monthly routine to spot problems and measure changes. This checklist supports maintenance; it does not guarantee page-one placement." },
        { type: "checklist", storageKey: "mc:seo:maintenance", unit: "this month", resetLabel: "Start a new month", items: [
          { id: "coverage-r5", text: "Open Search Console: investigate new indexing issues and check sitemap status; some exclusions are intentional" },
          { id: "rankings", text: "Check where you rank for your main service in each city you serve." },
          { id: "content", text: "Publish at least one new page or article that answers a real customer question." },
          { id: "photos", text: "Add new project photos to the website and the Google profile." },
          { id: "reviews", text: "Every review answered; new review requests sent for the month's completed jobs." },
          { id: "nap-r5", text: "Keep contact details accurate across listings while respecting each directory’s address-visibility rules" },
          { id: "speed", text: "Run PageSpeed on the home page and the busiest service page; fix what regressed." },
          { id: "links", text: "Scan new backlinks for spam and note the good ones you earned." },
          { id: "clicks", text: "Review the IP exclusion list from your ad clicks and the month's cost per lead." },
          { id: "analytics", text: "Read the month's traffic sources and form fills; decide one thing to change." },
        ] },
        { type: "in-app", text: "Most of the list has a page here: [GMB Ranking Grid](/ranking-grid) for rankings, [Google Reviews](/google-reviews) for requests and replies, [Site Scan](/site-scan) for the site, [Click Guard](/google-ads) for ad clicks and the IP list." },
      ],
    },
  ],
};
