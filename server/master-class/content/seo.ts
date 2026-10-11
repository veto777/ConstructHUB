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
        { type: "p", text: "Google Search Console is where you index your pages so Google actually knows they exist. This is where you submit sitemaps, request indexing for new pages, and monitor for crawl errors. If there are errors, fix them immediately — errors hurt your rankings." },
        { type: "panels", items: [
          { title: "GSC Verification Methods", items: [
            "Website HTML tag or file upload",
            "Server access (root level)",
            "Email access to that domain account",
            "Cloudflare DNS",
            "DNS TXT record",
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
          "Never give Google Search Console access to someone you don't fully trust. There is a feature called **Disavow** that allows someone to reject all of your site's backlinks. A disgruntled employee, fired contractor, or untrustworthy agency can pull your backlink profile from tools like Ahrefs or Semrush, then disavow every single backlink your site has built. This will destroy your rankings entirely — and it is extremely difficult to recover from.",
          "Always be careful who you trust with this level of access. If you fire someone or end a contractor relationship on bad terms, revoke their GSC access immediately. This is one of the most dangerous attack vectors in SEO and can ruin you or your clients.",
        ] },
        { type: "in-app", text: "Connecting Search Console inside ConstructHUB ([Search Console](/search-console), part of the {connectionsPlan} plan) pulls the property's search data into the platform; the [site connection guide](/guides#guide-connection) walks through the client-side steps." },
      ],
    },
    {
      id: "tracking",
      title: "Tracking & Analytics",
      blocks: [
        { type: "p", text: "Install tracking tools on your website so you can see exactly where your traffic is coming from, what visitors are doing, and which pages perform best. This data is essential for making informed decisions about your marketing." },
        { type: "cards", items: [
          { title: "Google Analytics", text: "Track visitor behavior, traffic sources, conversions, and user demographics. Essential for understanding how people find and use your site." },
          { title: "IP Tracker Tools", text: "Tools like TraceMyIP.org let you track individual visitor behavior, see exactly where traffic is coming from, and monitor user activity on your site in real-time.", href: "https://www.tracemyip.org/" },
        ] },
        { type: "tip", text: "Tools like **Ahrefs** and **Semrush** are highly recommended for tracking your organic keywords, monitoring your backlink profile, analyzing competitors, and finding ranking opportunities. These are industry-standard tools used by serious SEO professionals." },
        { type: "in-app", text: "Your own visitor log is [IP Tracker](/ip-tracker): the install snippet records each visit by IP so you can see where traffic comes from and feed Click Guard's exclusions." },
      ],
    },
    {
      id: "content",
      title: "Content Strategy That Actually Ranks",
      blocks: [
        { type: "p", text: "Content is what Google reads to understand what your business does and where you do it. Without content, you're invisible. But the wrong content strategy will waste months of effort. Here's what actually works for contractors." },
        { type: "panels", items: [
          { title: "Service Pages", items: [
            "One dedicated page per service (roofing, siding, windows, etc.)",
            "Include process details, materials used, and expected timelines",
            "Add before/after photos with proper alt text",
            "Include FAQ sections targeting \"how much does X cost\" queries",
          ] },
          { title: "Location Pages", items: [
            "Create unique pages for every city and neighborhood you serve",
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
            "Post consistently — at least 2-4 articles per month",
          ] },
          { title: "Content Mistakes That Kill Rankings", tone: "warn", items: [
            "Using AI to generate all your content — Google detects it",
            "Copy-pasting competitor content or spinning articles",
            "Publishing thin pages with less than 300 words",
            "Keyword stuffing — repeating the same phrase 20 times",
          ] },
        ] },
        { type: "in-app", text: "Run [Site Scan](/site-scan) after a content push: its findings list the affected pages so the thin or broken ones are found before Google finds them." },
      ],
    },
    {
      id: "backlinks",
      title: "Backlinks & Link Building",
      blocks: [
        { type: "p", text: "Link building is one of the most important factors for SEO page rank. Backlinks tell Google that other sites trust your content. But not all backlinks are equal — quality matters far more than quantity." },
        { type: "panels", cols: 3, items: [
          { title: "Good Backlinks", tone: "plain", items: ["DR/DA of 30 or higher", "Relevant industry sites", "Guest posts on real blogs", "Local business directories", "Press releases (PBNs)"] },
          { title: "Bad Backlinks", tone: "plain", items: ["Fiverr spam packages", "Links from low DR/DA sites", "Irrelevant foreign sites", "Link farms and PBN spam", "Same anchor text repeatedly"] },
          { title: "Best Practices", tone: "plain", items: ["Aim for 75% quality / 25% other", "Vary your anchor text", "Build links gradually", "Mix dofollow & nofollow", "Monitor with Ahrefs/Semrush"] },
        ] },
        { type: "tip", text: [
          "**Guest Posts:** Writing guest posts on relevant industry blogs is a great way to build quality backlinks. But avoid using the same keywords across all your guest posts — Google will notice the pattern and it can look manipulative.",
          "**PBNs / Press Releases:** Press release networks and news announcements can generate powerful, high-authority backlinks. These can be very effective but also expensive. Think of them as a big news push for launches, milestones, or major projects.",
        ] },
        { type: "callout", tone: "ban", title: "Avoid Buying Backlinks on Fiverr", text: "Cheap backlink packages on platforms like Fiverr are almost always spam. These sellers blast your URL across low-quality sites, link farms, and irrelevant directories. Google's algorithm detects this and your site will get de-ranked. If your backlink profile is mostly spam, you will lose your rankings — and recovering from a penalty is extremely difficult." },
        { type: "in-app", text: "The [SEO Suite](/seo) shows a site's authority, backlinks and rankings over time, so a spam package or a lost link shows up in the numbers." },
      ],
    },
    {
      id: "citations",
      title: "Citations and directories",
      blocks: [
        { type: "p", text: "A citation is any listing of your business name, address and phone number on another site. Google reads them to confirm that a real business exists where your profile says it does, so what matters is not how many you have but that every one of them says exactly the same thing. One old phone number on a directory you forgot about is a signal against you." },
        { type: "cards", items: [
          { title: "Google Business Profile", text: "The one that matters most; everything else should match it." },
          { title: "Apple Business Connect", text: "What Apple Maps and Siri show." },
          { title: "Bing Places", text: "Bing, and the assistants and browsers that use it." },
          { title: "Better Business Bureau", text: "Checked by homeowners who vet contractors (see Vetting, tip 14)." },
          { title: "Yelp, Angi, Houzz, Nextdoor", text: "The consumer directories homeowners actually open." },
          { title: "Trade associations and the local chamber", text: "Slow to get, trusted, rarely spammed." },
        ] },
        { type: "tip", text: [
          "**Write the canonical version once** — legal name, address format, the one tracking-free phone number, the exact website URL — and paste it everywhere. Never let a directory \"improve\" it.",
          "**Hunt duplicates.** Search your phone number and your old address in quotes; claim or remove every listing you did not create. Do the same after a move or a rename.",
          "**Skip the bulk packages.** \"500 citations for $50\" are the directory version of Fiverr backlinks: inconsistent, unmaintained and impossible to clean up later.",
        ] },
        { type: "in-app", text: "Your locations' names, addresses, phones and hours live in [Locations](/locations) — that is the version every directory should match." },
      ],
    },
    {
      id: "social",
      title: "Social Media & Reputation Building",
      blocks: [
        { type: "p", text: "Social media won't directly rank your website, but it builds brand recognition, drives referral traffic, and signals to Google that your business is active and legitimate. For contractors, the key platforms are Facebook, Instagram, YouTube, and NextDoor." },
        { type: "cards", items: [
          { title: "Facebook", text: "Post project updates, before/after photos, and customer testimonials. Join local community groups and participate without being salesy. Run targeted ads to homeowners within your service radius." },
          { title: "Instagram", text: "Visual platform perfect for construction. Post project progress photos, time-lapse videos, and finished work. Use local hashtags and location tags. Stories and Reels get more reach than static posts." },
          { title: "YouTube", text: "Create walkthrough videos of completed projects, how-to guides, and behind-the-scenes content. YouTube is the #2 search engine — your videos can rank for contractor-related queries." },
          { title: "NextDoor", text: "Claim your business page. Neighbors recommend contractors here constantly. Respond to recommendation requests in your area. This is hyperlocal and high-intent traffic." },
        ] },
        { type: "tip", text: "**Pro Tip:** Don't spread yourself thin across every platform. Pick 2 and do them well. Facebook + Google Business Profile posting is the minimum. Add Instagram or YouTube if you have the bandwidth." },
        { type: "in-app", text: "[Social Media](/social-media) composes once and schedules to every connected account, and can draft posts from your Google updates and photos for your approval." },
      ],
    },
    {
      id: "ads",
      title: "Google Ads & Local Service Ads (LSA)",
      blocks: [
        { type: "p", text: "Paid advertising gets you immediate visibility while your SEO builds over time. For contractors, Google Ads and Local Service Ads are the two most effective paid channels. Here's how they differ and when to use each." },
        { type: "panels", items: [
          { title: "Google Search Ads", items: [
            "Target specific keywords: \"roof repair near me,\" \"siding contractor [city]\"",
            "Set geographic targeting to your exact service radius",
            "Use negative keywords to filter out DIY and job-seeker clicks",
            "Start with $500-$1,500/month and scale based on ROI",
          ] },
          { title: "Local Service Ads (Google Guaranteed)", items: [
            "Pay per lead, not per click — only charged for actual phone calls/messages",
            "Google Guaranteed badge builds instant trust with consumers",
            "Shows above regular ads — top of search results",
            "Requires background check and license/insurance verification",
          ] },
        ] },
        { type: "tip", text: "**Budget Strategy:** Run LSA as your primary paid channel (it's cheaper per lead for most trades). Layer in Google Search Ads for keywords that LSA doesn't cover. Track every lead source so you know your actual cost per customer acquisition — not just cost per click." },
        { type: "in-app", text: "The full campaign playbook is the [Google Ads guide](/google-ads-guide) (12 sections, open with any module); the [LSA guide](/lsa-guide) is free. [Click Guard](/google-ads) records the clicks on your site and builds the IP exclusion list the playbook relies on." },
      ],
    },
    {
      id: "maintenance",
      title: "The monthly SEO maintenance checklist",
      blocks: [
        { type: "p", text: "Rankings are not won once. The companies that stay on page one do a short routine every month, and the ones that drop off stopped doing it. Work through the list, then reset it when the new month starts." },
        { type: "checklist", storageKey: "mc:seo:maintenance", unit: "this month", resetLabel: "Start a new month", items: [
          { id: "coverage", text: "Open Search Console: fix every new indexing error and confirm the sitemap is still accepted." },
          { id: "rankings", text: "Check where you rank for your main service in each city you serve." },
          { id: "content", text: "Publish at least one new page or article that answers a real customer question." },
          { id: "photos", text: "Add new project photos to the website and the Google profile." },
          { id: "reviews", text: "Every review answered; new review requests sent for the month's completed jobs." },
          { id: "nap", text: "Name, address, phone and hours identical on the site, the profile and the directories." },
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
