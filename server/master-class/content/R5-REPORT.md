Round 5 — course accuracy and recovery

Read both Master Class sections and both Lane E rows in /out/score5-tools-codex.md and /out/score5-tools-kimi.md (the audit files are mounted under /out here). Reviewed every executable content file: seo.ts, website.ts, vetting.ts, licensing.ts and gmb.ts. Historical R4-REPORT.md is an audit record, not served course content.

Changes remain uncommitted. No push, merge, deployment, production access, database connection or port 5433 use. No application dependency added. Git is unavailable and the .git file points to an absent main-repository git directory, so git status/origin verification could not be performed in this container.

Verification: Node 20.19.6 (/node/bin/node; the requested ~/.nvm path is absent). npm run check passed. DATABASE_URL= npx vitest run --configLoader runner server/master-class/content-safety.test.ts server/master-class/progress.test.ts server/master-class/recovery.test.ts server/master-class/master-class.test.ts server/state-guides.test.ts passed all 55 tests in 5 files. The runner config loader avoids writing to the mounted node_modules. Logs: /tmp/r5-check.log and /tmp/r5-vitest.log.

Live filming verification remains blocked: neither ~/ConstructHUB-featshots/.env nor the constructhub_dev_fs connection is present in this container. No .env was created; none remains. The Express/Sam Rivera/Summit Roofing Co. screen was not verified. Browser evidence below is explicitly an isolated test fixture using actual course components and corrected lesson content, not live lane evidence.

| Item | Implementation | Verification |
|---|---|---|
| 1. Search Console | [server/master-class/content/seo.ts:16](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:16) and [server/master-class/content/seo.ts:18](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:18): submission/request versus Google’s indexing decision; Domain versus URL-prefix scope; supported methods separated from prerequisites. | Content regression test; Google verification and URL Inspection docs reviewed; phone-search-console.png inspected. |
| 2. Speed | [server/master-class/content/website.ts:41](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:41): performance is one ranking consideration, without guaranteed position loss. | Content regression test; Google page-experience docs reviewed; phone-page-speed.png inspected. |
| 3. Backlinks | [server/master-class/content/seo.ts:100](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:100): removed PBN recommendation, authority-score threshold, ratio and guaranteed penalties; distinguished real news from link schemes. | Content regression test and Google spam-policy review. |
| 4. Vetting | [server/master-class/content/vetting.ts:80](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:80) and [server/master-class/content/vetting.ts:88](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:88): no storefront/staff-size requirement, no categorical A+ or accreditation judgment. Brand and final checklist agree. | Content regression test; phone-tip-13.png and phone-tip-14.png inspected. |
| 5. Numeric claims and complete sweep | [server/master-class/content/licensing.ts:40](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:40), [server/master-class/content/licensing.ts:66](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:66) and all five content files: removed unsupported figures and softened unsupported causal/absolute claims. Every changed passage appears below. | Content-safety tests; server delivery/source guards; manual full-file review. Changed checklist tasks receive fresh IDs so old ticks do not complete revised instructions. |
| 6. Account recovery | [client/src/components/guides/progress.ts:44](/home/veto/ConstructHUB-fix-r5-course/client/src/components/guides/progress.ts:44) exposes retry/fetching state; [client/src/components/master-class/progress-note.tsx:5](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/progress-note.tsx:5) renders Check account beside the paused notice in outlines, inline checklists and state-step progress. | Recovery Vitest tests; browser repeated failure then successful retry retains learner A’s ticks; learner B/sign-out isolation; paused progress has no zero count/bar; phone-account-paused.png shows keyboard focus. |
| 7. Lesson recovery and phone stats | [client/src/components/master-class/lesson-body.tsx:297](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/lesson-body.tsx:297) and [client/src/components/master-class/lesson-body.tsx:332](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/lesson-body.tsx:332): transient failures preserve lessons under a warning and retry; 401/403 hide and clear cached protected text. [client/src/components/master-class/lesson-body.tsx:230](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/lesson-body.tsx:230): stats stack on phones, with text-xs labels. | Recovery Vitest tests; browser transient failure/retry, denial followed by another network failure and remount, initial failure/retry; 390px geometry assertions; phone-stale-lessons.png and phone-sales-stats.png inspected. |

Public outlines were also aligned: [client/src/components/master-class/state-guide.tsx:115](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/state-guide.tsx:115) changes “Sales — The Most Important Role” → “Sales and sustainable operations”; [client/src/components/master-class/module-vetting.tsx:23](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/module-vetting.tsx:23) changes “Experience Can't Be Faked” → “Verify relevant experience”; [client/src/components/master-class/module-vetting.tsx:25](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/module-vetting.tsx:25) changes “Manufacturer Programs (Diluted)” → “Verify manufacturer membership”; [client/src/components/master-class/module-vetting.tsx:32](/home/veto/ConstructHUB-fix-r5-course/client/src/components/master-class/module-vetting.tsx:32) changes “Unsolicited Calls = Lead Gen” → “Verify unsolicited contacts”. Server/client outline consistency tests pass.

Browser script: [server/master-class/browser-tests/run.mjs:1](/home/veto/ConstructHUB-fix-r5-course/server/master-class/browser-tests/run.mjs:1); fixture: [server/master-class/browser-tests/fixture.tsx:1](/home/veto/ConstructHUB-fix-r5-course/server/master-class/browser-tests/fixture.tsx:1). It ran on 127.0.0.1:8155 and closed browser and Vite server in finally. Chromium and extracted OS libraries/fonts were installed only in the user cache and /tmp; no package manifest or lockfile was changed. Existing Browserslist/PostCSS warnings were logged; no browser page errors occurred. Additional passing cases: persistence across reload, account switching, signed-out separation, blocked storage getter, failed storage writes, remount/reset, content-version migration, cold/deferred anchors and visible keyboard focus.

Screenshots opened and visually inspected:

- [desktop-blocked.png](/tmp/r5-course-screens/desktop-blocked.png)
- [phone-account-paused.png](/tmp/r5-course-screens/phone-account-paused.png)
- [phone-blocked.png](/tmp/r5-course-screens/phone-blocked.png)
- [phone-branding.png](/tmp/r5-course-screens/phone-branding.png)
- [phone-keyboard.png](/tmp/r5-course-screens/phone-keyboard.png)
- [phone-page-speed.png](/tmp/r5-course-screens/phone-page-speed.png)
- [phone-sales-stats.png](/tmp/r5-course-screens/phone-sales-stats.png)
- [phone-search-console.png](/tmp/r5-course-screens/phone-search-console.png)
- [phone-stale-lessons.png](/tmp/r5-course-screens/phone-stale-lessons.png)
- [phone-tip-13.png](/tmp/r5-course-screens/phone-tip-13.png)
- [phone-tip-14.png](/tmp/r5-course-screens/phone-tip-14.png)

Primary sources checked for the changed instructions:

- [Search Console verification](https://support.google.com/webmasters/answer/9008080)
- [URL Inspection and indexing requests](https://support.google.com/webmasters/answer/9012289)
- [Page experience](https://developers.google.com/search/docs/appearance/page-experience)
- [Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Local ranking](https://support.google.com/business/answer/7091)
- [Local Services Ads](https://support.google.com/localservices/answer/6224841)
- [Disavow guidance](https://support.google.com/webmasters/answer/2648487)

Every content passage changed — before → after (173 entries; multi-line replacements group the old block and its replacement). These are literal change records, including checklist-ID and block-schema changes. Original warnings or unsupported claims appear only as quoted audit history here.

1. [server/master-class/content/seo.ts:16](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:16)

Before:

> Google Search Console is where you index your pages so Google actually knows they exist. This is where you submit sitemaps, request indexing for new pages, and monitor for crawl errors. If there are errors, fix them immediately — errors hurt your rankings.

→ After:

> Use Google Search Console to submit sitemaps, request indexing and inspect crawl or indexing issues. Google decides whether to index a page; a request does not guarantee inclusion or a ranking. Review the reported issue before choosing a fix. See the [URL Inspection guidance](https://support.google.com/webmasters/answer/9012289).

2. [server/master-class/content/seo.ts:18](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:18)

Before:

> { title: "GSC Verification Methods", items: [
>             "Website HTML tag or file upload",
>             "Server access (root level)",
>             "Email access to that domain account",
>             "Cloudflare DNS",
>             "DNS TXT record",
>           ] },

→ After:

> { title: "GSC Verification Methods", items: [
>             "Domain property: DNS TXT record at your domain provider",
>             "URL-prefix property: HTML file upload, HTML tag, Google Analytics or Google Tag Manager; DNS verification is also available",
>           ] },
>           { title: "Property scope and prerequisites", items: [
>             "A Domain property covers all subdomains and both HTTP and HTTPS. A URL-prefix property covers only URLs beginning with the specified protocol, host and optional path",
>             "DNS requires permission to edit domain records, whether at Cloudflare or another DNS provider",
>             "HTML file verification needs permission to publish the verification file; HTML tag verification needs access to edit the homepage head",
>             "Google Analytics requires the supported tracking code and edit permission; Google Tag Manager requires the container snippet and Publish or Admin permission",
>             "A Google account is needed to use Search Console. Domain email access and root server access are not verification methods",
>             "Follow the methods offered for your property in [Google’s verification instructions](https://support.google.com/webmasters/answer/9008080)",
>           ] },

3. [server/master-class/content/seo.ts:39](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:39)

Before:

> Never give Google Search Console access to someone you don't fully trust. There is a feature called **Disavow** that allows someone to reject all of your site's backlinks. A disgruntled employee, fired contractor, or untrustworthy agency can pull your backlink profile from tools like Ahrefs or Semrush, then disavow every single backlink your site has built. This will destroy your rankings entirely — and it is extremely difficult to recover from.

→ After:

> Give Search Console access only to people who need it. Misuse of owner permissions, including inappropriate disavow submissions, can harm search performance. Disavow is an advanced tool; review [Google’s disavow guidance](https://support.google.com/webmasters/answer/2648487) before using it.

4. [server/master-class/content/seo.ts:40](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:40)

Before:

> Always be careful who you trust with this level of access. If you fire someone or end a contractor relationship on bad terms, revoke their GSC access immediately. This is one of the most dangerous attack vectors in SEO and can ruin you or your clients.

→ After:

> Review permissions when a working relationship ends. Remove access that is no longer needed and check ownership verification tokens as well as the user list.

5. [server/master-class/content/seo.ts:49](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:49)

Before:

> Install tracking tools on your website so you can see exactly where your traffic is coming from, what visitors are doing, and which pages perform best. This data is essential for making informed decisions about your marketing.

→ After:

> Use analytics to understand measured traffic sources, visits and conversions. Consent choices, blockers and attribution limits mean the data is incomplete; do not treat it as a record of every visitor.

6. [server/master-class/content/seo.ts:52](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:52)

Before:

> Tools like TraceMyIP.org let you track individual visitor behavior, see exactly where traffic is coming from, and monitor user activity on your site in real-time.

→ After:

> IP-based tools can help inspect visits and approximate network location; an IP address does not reliably identify a person or their exact location.

7. [server/master-class/content/seo.ts:62](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:62)

Before:

> Content is what Google reads to understand what your business does and where you do it. Without content, you're invisible. But the wrong content strategy will waste months of effort. Here's what actually works for contractors.

→ After:

> Write useful content that explains your services and the places you actually serve. Prioritize accurate answers to customer questions and evidence from real projects; no publishing formula guarantees rankings.

8. [server/master-class/content/seo.ts:71](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:71)

Before:

> Create unique pages for every city and neighborhood you serve

→ After:

> Create location pages only where you can offer useful, distinct information about work in that area

9. [server/master-class/content/seo.ts:82](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:82)

Before:

> Post consistently — at least 2-4 articles per month

→ After:

> Choose a publishing schedule you can sustain without sacrificing accuracy or usefulness

10. [server/master-class/content/seo.ts:84](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:84)

Before:

> Content Mistakes That Kill Rankings

→ After:

> Content practices to avoid

11. [server/master-class/content/seo.ts:85](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:85)

Before:

> Using AI to generate all your content — Google detects it

→ After:

> Publishing inaccurate or unhelpful content without review, whether human-written or AI-generated

12. [server/master-class/content/seo.ts:87](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:87)

Before:

> Publishing thin pages with less than 300 words

→ After:

> Publishing pages that do not answer the visitor’s question; there is no universal minimum word count

13. [server/master-class/content/seo.ts:88](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:88)

Before:

> Keyword stuffing — repeating the same phrase 20 times

→ After:

> Repeating keywords unnaturally rather than writing for readers

14. [server/master-class/content/seo.ts:91](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:91)

Before:

> Run [Site Scan](/site-scan) after a content push: its findings list the affected pages so the thin or broken ones are found before Google finds them.

→ After:

> Run [Site Scan](/site-scan) after a content update to review the pages flagged for attention.

15. [server/master-class/content/seo.ts:98](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:98)

Before:

> Link building is one of the most important factors for SEO page rank. Backlinks tell Google that other sites trust your content. But not all backlinks are equal — quality matters far more than quantity.

→ After:

> Relevant, independently earned links can help people discover your business. Judge a potential link by editorial context and usefulness, not a promised ranking boost.

16. [server/master-class/content/seo.ts:100](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:100)

Before:

> DR/DA of 30 or higher

→ After:

> Relevant editorial coverage

17. [server/master-class/content/seo.ts:100](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:100)

Before:

> Press releases (PBNs)

→ After:

> Earned coverage of genuine news

18. [server/master-class/content/seo.ts:101](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:101)

Before:

> Links from low DR/DA sites

→ After:

> Paid links intended to manipulate rankings

19. [server/master-class/content/seo.ts:101](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:101)

Before:

> Irrelevant foreign sites

→ After:

> Irrelevant sites created to sell links

20. [server/master-class/content/seo.ts:102](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:102)

Before:

> Aim for 75% quality / 25% other

→ After:

> Prioritize relevant, independently earned links

21. [server/master-class/content/seo.ts:105](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:105)

Before:

> **Guest Posts:** Writing guest posts on relevant industry blogs is a great way to build quality backlinks. But avoid using the same keywords across all your guest posts — Google will notice the pattern and it can look manipulative.

→ After:

> **Guest Posts:** Contribute useful material to relevant publications. Do not use guest posts to manufacture keyword-rich links at scale.

22. [server/master-class/content/seo.ts:106](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:106)

Before:

> **PBNs / Press Releases:** Press release networks and news announcements can generate powerful, high-authority backlinks. These can be very effective but also expensive. Think of them as a big news push for launches, milestones, or major projects.

→ After:

> **Press releases:** Announce genuine news for readers and journalists. A press release is not a private blog network (PBN), and distribution does not guarantee editorial links. Follow [Google’s link-spam policy](https://developers.google.com/search/docs/essentials/spam-policies), including its rules for paid links.

23. [server/master-class/content/seo.ts:108](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:108)

Before:

> Cheap backlink packages on platforms like Fiverr are almost always spam. These sellers blast your URL across low-quality sites, link farms, and irrelevant directories. Google's algorithm detects this and your site will get de-ranked. If your backlink profile is mostly spam, you will lose your rankings — and recovering from a penalty is extremely difficult.

→ After:

> Avoid packages designed to manipulate rankings through paid links, link farms or automated spam. Such links may be ignored or lead to action under Google’s spam policies; neither the impact nor recovery is predictable.

24. [server/master-class/content/seo.ts:116](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:116)

Before:

> A citation is any listing of your business name, address and phone number on another site. Google reads them to confirm that a real business exists where your profile says it does, so what matters is not how many you have but that every one of them says exactly the same thing. One old phone number on a directory you forgot about is a signal against you.

→ After:

> A citation lists business details on another site. Keep your real-world name and contact information accurate so customers can reach you. Follow each directory’s address rules, especially for home-based service-area businesses; a formatting difference is not proof of a ranking penalty.

25. [server/master-class/content/seo.ts:128](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:128)

Before:

> **Skip the bulk packages.** "500 citations for $50" are the directory version of Fiverr backlinks: inconsistent, unmaintained and impossible to clean up later.

→ After:

> **Skip unverified bulk packages.** Review directory relevance, accuracy and your ability to maintain or remove listings.

26. [server/master-class/content/seo.ts:137](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:137)

Before:

> Social media won't directly rank your website, but it builds brand recognition, drives referral traffic, and signals to Google that your business is active and legitimate. For contractors, the key platforms are Facebook, Instagram, YouTube, and NextDoor.

→ After:

> Social media can build recognition and bring referral traffic. Choose channels your customers use and measure the results; activity is not a guaranteed Google ranking signal.

27. [server/master-class/content/seo.ts:140](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:140)

Before:

> Visual platform perfect for construction. Post project progress photos, time-lapse videos, and finished work. Use local hashtags and location tags. Stories and Reels get more reach than static posts.

→ After:

> Share project photos, time-lapse videos and finished work with permission. Test formats and compare engagement rather than assuming one format always reaches more people.

28. [server/master-class/content/seo.ts:141](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:141)

Before:

> Create walkthrough videos of completed projects, how-to guides, and behind-the-scenes content. YouTube is the #2 search engine — your videos can rank for contractor-related queries.

→ After:

> Create useful project walkthroughs, how-to guides and behind-the-scenes videos. Search visibility depends on the content and query.

29. [server/master-class/content/seo.ts:152](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:152)

Before:

> Paid advertising gets you immediate visibility while your SEO builds over time. For contractors, Google Ads and Local Service Ads are the two most effective paid channels. Here's how they differ and when to use each.

→ After:

> Paid advertising can bring visibility while you develop organic traffic. Compare Google Search Ads and Local Services Ads using your eligibility, goals and measured acquisition costs.

30. [server/master-class/content/seo.ts:158](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:158)

Before:

> Start with $500-$1,500/month and scale based on ROI

→ After:

> Set a test budget you can afford and adjust using measured acquisition costs

31. [server/master-class/content/seo.ts:152](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:152)

Before:

> Local Service Ads (Google Guaranteed)

→ After:

> Local Services Ads

32. [server/master-class/content/seo.ts:161](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:161)

Before:

> Pay per lead, not per click — only charged for actual phone calls/messages

→ After:

> Lead-based billing applies under Google’s current billing and credit rules; review which leads are charged

33. [server/master-class/content/seo.ts:162](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:162)

Before:

> Google Guaranteed badge builds instant trust with consumers

→ After:

> Check current badge and screening requirements for your category and region

34. [server/master-class/content/seo.ts:163](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:163)

Before:

> Shows above regular ads — top of search results

→ After:

> Placement depends on eligibility, the auction and the search

35. [server/master-class/content/seo.ts:164](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:164)

Before:

> Requires background check and license/insurance verification

→ After:

> Screening requirements vary by business category and location

36. [server/master-class/content/seo.ts:167](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:167)

Before:

> **Budget Strategy:** Run LSA as your primary paid channel (it's cheaper per lead for most trades). Layer in Google Search Ads for keywords that LSA doesn't cover. Track every lead source so you know your actual cost per customer acquisition — not just cost per click.

→ After:

> **Budget strategy:** Compare actual lead quality and cost per acquired customer across channels. Do not assume LSA is cheaper. Review [Google’s Local Services guidance](https://support.google.com/localservices/answer/6224841) before setting up a campaign.

37. [server/master-class/content/seo.ts:175](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:175)

Before:

> Rankings are not won once. The companies that stay on page one do a short routine every month, and the ones that drop off stopped doing it. Work through the list, then reset it when the new month starts.

→ After:

> Use a monthly routine to spot problems and measure changes. This checklist supports maintenance; it does not guarantee page-one placement.

38. [server/master-class/content/seo.ts:177](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:177)

Before:

> Open Search Console: fix every new indexing error and confirm the sitemap is still accepted.

→ After:

> Open Search Console: investigate new indexing issues and check sitemap status; some exclusions are intentional

39. [server/master-class/content/seo.ts:182](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:182)

Before:

> Name, address, phone and hours identical on the site, the profile and the directories.

→ After:

> Keep contact details accurate across listings while respecting each directory’s address-visibility rules

40. [server/master-class/content/website.ts:32](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:32)

Before:

> Your homepage matters, but your location pages and slug pages (service pages, city pages) are just as important — sometimes more. These are the pages that actually rank for local and service-specific searches. Every city and service you cover should have its own dedicated landing page with unique content.

→ After:

> Service and location pages can answer specific customer questions. Create them where you have distinct, useful information and real work or service coverage to describe; avoid near-duplicate pages for every keyword or town.

41. [server/master-class/content/website.ts:33](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:33)

Before:

> Each landing page must have unique content. Do not duplicate content across pages or copy from competitors. Use AI tools minimally — if you lean on AI too heavily, your content will read the same as everyone else's. Google grades your content on uniqueness. If it detects duplicate or thin content, your pages will not rank and can actually hurt your entire site.

→ After:

> Give each landing page a useful purpose and verify its claims, including any AI-assisted text. Avoid copied or scaled content created mainly to manipulate search rankings. See [Google’s spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

42. [server/master-class/content/website.ts:34](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:34)

Before:

> Each city page should match a location in [Locations](/locations) and the Google profile that links to it; the [GMB Ranking Grid](/ranking-grid) shows which towns the pages still have to win.

→ After:

> A city page can describe an area you serve without implying a staffed office or separate Google profile there. [GMB Ranking Grid](/ranking-grid) helps measure visibility across your service area.

43. [server/master-class/content/website.ts:41](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:41)

Before:

> Page speed is a direct ranking factor. Google rolled out a Core Web Vitals update and sites that load slowly will lose position. This is not optional — it directly affects where you show up in search results.

→ After:

> Speed and Core Web Vitals contribute to page experience, one of many ranking considerations. Strong scores do not guarantee higher rankings, and relevant content may rank despite weaker page experience. See [Google’s page-experience guidance](https://developers.google.com/search/docs/appearance/page-experience).

44. [server/master-class/content/website.ts:43](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:43)

Before:

> Check your speed score, SEO issues, and Core Web Vitals. This is the tool Google uses to grade your site.

→ After:

> Inspect performance diagnostics and available Core Web Vitals field data. The PageSpeed score is not a Google ranking score.

45. [server/master-class/content/website.ts:53](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:53)

Before:

> Over 70% of contractor website traffic comes from mobile devices. Google uses mobile-first indexing, meaning it ranks your site based on the mobile version. If your site doesn't work well on phones, you're losing both rankings and customers.

→ After:

> Check your own analytics to understand mobile traffic. Make the phone experience usable: customers should be able to read the scope, inspect projects and contact you without struggling with the layout.

46. [server/master-class/content/website.ts:57](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:57)

Before:

> Fast load time — under 3 seconds on mobile networks

→ After:

> Test loading and responsiveness on real phones and slower connections

47. [server/master-class/content/website.ts:58](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:58)

Before:

> Large tap targets — buttons at least 48px tall

→ After:

> Use comfortably sized, spaced tap targets and test them on a phone

48. [server/master-class/content/website.ts:59](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:59)

Before:

> Readable text without zooming — 16px minimum font size

→ After:

> Use readable text that remains usable when zoomed

49. [server/master-class/content/website.ts:65](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:65)

Before:

> Simple forms — name, phone, zip code, service needed (4 fields max)

→ After:

> Ask only for the information needed to respond to the inquiry

50. [server/master-class/content/website.ts:70](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:70)

Before:

> [Site Scan](/site-scan) runs PageSpeed's mobile check on the pages you choose; the mobile score is the one Google ranks by.

→ After:

> [Site Scan](/site-scan) runs mobile performance checks; use the findings to improve usability, not as a prediction of ranking.

51. [server/master-class/content/website.ts:77](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:77)

Before:

> Homeowners hire what they can see. A projects page with a dozen real jobs, photographed properly, closes more estimates than any paragraph about quality. It is also the page most often faked by new companies (see Vetting, tips 15 and 17), so yours has to be unmistakably yours.

→ After:

> Show real projects with clear captions and permission from the homeowner. A portfolio helps customers assess relevant work; it does not guarantee more accepted estimates.

52. [server/master-class/content/website.ts:81](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:81)

Before:

> The city and the service in every caption — that is what the page ranks for

→ After:

> Describe the actual city and service in captions without promising rankings

53. [server/master-class/content/website.ts:83](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:83)

Before:

> Your crew and your trucks in some of the photos: proof the work is yours

→ After:

> Show your crew and equipment accurately; photos alone do not verify who performed a project

54. [server/master-class/content/website.ts:88](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:88)

Before:

> Compress every image before upload; a gallery of full-size phone photos is the slowest page on most contractor sites

→ After:

> Compress images and test gallery performance on mobile

55. [server/master-class/content/website.ts:89](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:89)

Before:

> Add new work every quarter and retire the weakest — a dated portfolio reads as a closed business

→ After:

> Keep the portfolio current so customers can assess recent work

56. [server/master-class/content/website.ts:99](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:99)

Before:

> Schema markup is code you add to your website that tells Google exactly what your business is, what services you offer, and where you're located. It's how you get rich results in search — star ratings, service lists, business hours, and more showing up directly in Google.

→ After:

> Structured data describes page content in a machine-readable form. Supported markup may make a page eligible for certain search features, but display is not guaranteed. Follow [Google’s structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).

57. [server/master-class/content/website.ts:101](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:101)

Before:

> Business name, address, phone, hours, service area, and geo coordinates. This is the foundation — every contractor site needs it.

→ After:

> Describe real business details that match visible page content and the applicable structured-data requirements.

58. [server/master-class/content/website.ts:102](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:102)

Before:

> Define each service with descriptions, price ranges, and service areas. Helps Google match your pages to specific service queries.

→ After:

> Describe services accurately; a schema type alone does not establish eligibility for a Google rich result.

59. [server/master-class/content/website.ts:103](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:103)

Before:

> Embed review data and FAQ answers directly in search results. This takes up more space in Google and increases click-through rates.

→ After:

> Check eligibility before adding review or FAQ markup. Do not promise contractor review stars or FAQ rich results from markup alone.

60. [server/master-class/content/website.ts:105](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:105)

Before:

> Use Google's **Rich Results Test** tool to validate your schema markup. If your schema has errors, Google will ignore it entirely. Most WordPress SEO plugins like Yoast or RankMath can generate basic schema automatically, but you'll want to customize it for contractor-specific services.

→ After:

> Use Google’s Rich Results Test to inspect supported markup and resolve reported issues. Passing validation does not guarantee a rich result.

61. [server/master-class/content/website.ts:112](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:112)

Before:

> The platform matters less than who holds the keys. Contractors lose their sites to a web designer who disappears, a hosting bill nobody paid or a domain registered in an agency's name far more often than to a bad CMS. Pick a mainstream platform you or your staff can edit, then make sure every account is yours.

→ After:

> Choose a platform your team can maintain and make sure your business controls the domain, hosting and site accounts. Document access, renewals, backups and an exit plan.

62. [server/master-class/content/website.ts:132](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:132)

Before:

> Most contractors completely ignore email marketing, which means it's a huge opportunity. Not every lead is ready to buy today — a follow-up system keeps you top of mind when they're ready. This is especially powerful for seasonal services.

→ After:

> Follow-up email can help interested customers stay informed. Agree on appropriate contact preferences and test the usefulness of your messages.

63. [server/master-class/content/website.ts:134](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:134)

Before:

> Set up automated emails after someone fills out your contact form. Day 1: confirmation. Day 3: case study. Day 7: special offer. Day 14: check-in.

→ After:

> Example sequence to adapt to customer preferences: confirmation, relevant case study, then a polite check-in.

64. [server/master-class/content/website.ts:135](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:135)

Before:

> Send seasonal reminders: spring gutter cleaning, fall roof inspections, winter prep, etc. These are high-conversion emails because they're timely and relevant.

→ After:

> Send relevant seasonal reminders and measure responses before expanding the campaign.

65. [server/master-class/content/licensing.ts:22](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:22)

Before:

> Controlling quality is always harder with subs — it's a constant balance of quality vs. efficiency and less hands-on work. Most subs will NOT clean up jobsites or do the small things to cater to clients (covering furniture, cleaning up after themselves, communicating updates). These details always reflect on YOUR company, not the sub.

→ After:

> Set quality, cleanup and communication expectations with each subcontractor. Supervision needs depend on the crew and project; document responsibilities and check the work.

66. [server/master-class/content/licensing.ts:39](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:39)

Before:

> The most important role in any construction business is **SALES**. Without sales, nothing else matters — not your crew, not your tools, not your license. Everything starts with closing jobs.

→ After:

> Sales supports a sustainable construction business alongside safe work, quality, staffing and cash-flow management. Track results using consistent definitions.

67. [server/master-class/content/licensing.ts:40](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:40)

Before:

> { type: "stats", title: "Close Rate Benchmarks", items: [
>           { value: "33%+", label: "Great Sales (1 of 3)" },
>           { value: "20%", label: "Average" },
>           { value: "<15%", label: "Dangerous" },
>         ], note: "Anything below 15% is dangerous because of the cost of leads. At $50-150/lead, a low close rate can be financially devastating for a business." },

→ After:

> { type: "stats", title: "Measure your sales performance", items: [
>           { value: "Close rate", label: "Jobs won divided by qualified opportunities" },
>           { value: "Acquisition cost", label: "Acquisition spend divided by customers won" },
>           { value: "Job margin", label: "Revenue less the costs of delivering the work" },
>         ], note: "Use the same period and definitions for each comparison. Results vary by trade, lead source, job size and market; this is not an industry benchmark." },

68. [server/master-class/content/licensing.ts:48](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:48)

Before:

> This is what Elon Musk does — he recruits top talent from Microsoft and Google. Hiring a proven sales rep from a competitor saves you training time and they already know the trade. However, this is risky: they could flip on you, and they may have an NDA with their previous employer that could expose you legally. Always ask about prior arrangements before bringing them on.

→ After:

> Relevant experience can reduce training needs, but assess the candidate’s actual skills and references. Ask about existing obligations and obtain advice before requesting information from a former employer.

69. [server/master-class/content/licensing.ts:50](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:50)

Before:

> **Best places to recruit:** Craigslist and Indeed are the best platforms to find a new sales rep or project manager. Post clear commission structures and expectations upfront.

→ After:

> **Recruiting:** Compare job boards, trade networks and referrals. State the compensation structure, duties and expectations clearly.

70. [server/master-class/content/licensing.ts:54](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:54)

Before:

> Out of sight, out of mind — and that's deadly during the bidding process. Follow up after the estimate, send a thank-you text or email, check in 2-3 days later. Most contractors give a bid and disappear. The one who stays top of mind wins the job.

→ After:

> Agree on a follow-up schedule after the estimate and honor the customer’s contact preferences. Clear communication can help without guaranteeing a sale.

71. [server/master-class/content/licensing.ts:55](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:55)

Before:

> Every homeowner is getting 3-5 bids. If your estimate looks like everyone else's — a number scribbled on a piece of paper — you blend in. Present a professional proposal with your branding, scope of work, timeline, warranty details, and photos of past work. Make it impossible for the client to compare you to the guy in a beat-up truck with a handwritten quote.

→ After:

> Customers may compare several bids. Provide a professional proposal with scope, timeline, warranty terms and relevant project photos so they can compare the work accurately.

72. [server/master-class/content/licensing.ts:58](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:58)

Before:

> Don't fall into the trap of sleazy one-call-close tactics — "sign today or lose the price" pressure selling. High-pressure sales is an art form that takes years to master, and if you don't know what you're doing, it will backfire badly. You'll lose the sale, damage your reputation, and potentially earn a bad review that costs you far more than the job was worth. Homeowners talk to each other, post in neighborhood groups, and share experiences online. One pushy encounter can label your company as "aggressive" or "scammy" in an entire community. Instead, focus on building trust through professionalism, clear communication, and honest timelines. Let the quality of your proposal and follow-up do the selling — the best closers in construction don't need to pressure anyone because they've already built enough confidence during the estimate.

→ After:

> Avoid pressure to sign immediately or claims about deadlines you cannot substantiate. Explain the proposal, allow questions and give accurate timelines.

73. [server/master-class/content/licensing.ts:65](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:65)

Before:

> Your online reputation is the single most valuable asset in your business — more important than your trucks, your tools, or even your crew. Every decision you make with a client should be filtered through this question: **"Is this worth risking a bad review?"**

→ After:

> Your reputation matters alongside workmanship, safety and service. Listen to complaints, document the facts and address the underlying work rather than making decisions solely to avoid a review.

74. [server/master-class/content/licensing.ts:66](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:66)

Before:

> { type: "stats", title: "The Real Cost of Bad Reviews", items: [
>           { value: "10-15%", label: "Business loss per year from a single bad review" },
>           { value: "20-50%", label: "Business loss from damaging reviews (scam, abandoned job, etc.)" },
>         ], note: "A standard negative review — \"slow communication\" or \"went over budget\" — will cost you roughly 10-15% of your annual revenue. But devastating reviews that use words like **\"walked off the job,\" \"didn't finish the work,\" \"ripped us off,\"** or **\"scammers\"** can destroy 20-50% of your business. These are the reviews that kill companies, because the number one thing a customer looks for in reviews is **trustworthiness**. Quality matters, but trust comes first — if a company looks untrustworthy, they're not getting the job no matter how good their work is." },

→ After:

> { type: "p", text: "Negative reviews can affect customer confidence, but no fixed revenue-loss percentage applies to a review. Track inquiries, customer feedback and outcomes without attributing every change to one review." },

75. [server/master-class/content/licensing.ts:71](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:71)

Before:

> Never get into a pissing contest with a client.

→ After:

> Keep public replies calm and factual.

76. [server/master-class/content/licensing.ts:71](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:71)

Before:

> You will always lose. Even if you're right, even if the client is being unreasonable — the public will side with the homeowner every time. A back-and-forth argument in Google Reviews makes you look petty and unprofessional. Responding to negative reviews should be calm, professional, and focused on resolution — never defensive or combative.

→ After:

> Avoid public arguments or private customer details. Acknowledge the concern and offer an appropriate way to discuss resolution.

77. [server/master-class/content/licensing.ts:73](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:73)

Before:

> What Clients Actually Look For in Reviews

→ After:

> Questions customers may ask when reading reviews

78. [server/master-class/content/licensing.ts:75](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:75)

Before:

> Did they do what they said? Did they show up? Did they finish? This is the #1 filter and the reason 'scam' reviews are devastating

→ After:

> Did they do what they said, show up and finish the agreed work?

79. [server/master-class/content/licensing.ts:80](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:80)

Before:

> Was pricing transparent? Were there surprise charges? Interestingly, price is one of the least-mentioned traits in positive reviews

→ After:

> Was pricing transparent, and were changes explained and agreed?

80. [server/master-class/content/licensing.ts:82](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:82)

Before:

> The Math That Should Change How You Handle Every Client

→ After:

> Resolve the work, not a hypothetical revenue loss

81. [server/master-class/content/licensing.ts:82](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:82)

Before:

> If your business does $500K/year and a single bad review costs you 10-15%, that's $50,000-$75,000 in lost revenue — every year it sits there. A devastating "scam" or "abandoned job" review at 20-50% impact is $100,000-$250,000 per year. Now compare that to the $500-1,000 of disputed work you're arguing about. The math is not even close. Resolve the dispute fairly, document the agreed outcome, and keep any request for an honest review separate.

→ After:

> Evaluate disputed work using the contract, documented facts and a fair resolution process. Do not assume a review causes a fixed loss. Keep requests for honest feedback separate from remedies.

82. [server/master-class/content/licensing.ts:84](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:84)

Before:

> Some clients will never be satisfied — no matter how good your work is, how many extras you throw in, or how many times you come back to fix things. These clients exist in every market, and you need to recognize them early. Their goal may be to get free work, negotiate after the fact, or simply find fault with everything. Some are looking for blood from the start, and you may be their chosen victim before you even pick up a hammer.

→ After:

> Some disputes remain unresolved despite repeated discussion. Clarify scope, document concerns and seek appropriate advice without assuming the customer’s motives.

83. [server/master-class/content/licensing.ts:86](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:86)

Before:

> The goal is always the same: walk away without a lawsuit or a bad review.

→ After:

> Aim for a fair, documented resolution.

84. [server/master-class/content/licensing.ts:86](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:86)

Before:

> You won't win every client relationship, but you can control how it ends. A clean exit — where the client feels heard and you part on neutral terms — is worth more than being "right." Standing your ground with a difficult client is not a winning approach. Pride has no ROI in this business.

→ After:

> Listen to the concern, explain the documented facts and agree on next steps where possible. Obtain advice when contract obligations or safety are disputed.

85. [server/master-class/content/licensing.ts:87](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:87)

Before:

> Keep every interaction 100% professional and focused on the work. Even casual small talk can turn dangerous. If a client brings up a topic you disagree with — don't engage, don't push back, don't even hint at your position. They may seem fine in the moment, but disagreements plant seeds of resentment that surface later as "difficult to work with" reviews or refusal to pay. You are there to build, not to debate.

→ After:

> Keep discussions professional and focused on the work. Respect boundaries and return unrelated disagreements to the project’s agreed scope.

86. [server/master-class/content/licensing.ts:88](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:88)

Before:

> Always be agreeable — stay neutral, stay relevant, stay professional.

→ After:

> Stay respectful, relevant and professional.

87. [server/master-class/content/licensing.ts:88](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:88)

Before:

> Even when the client is wrong about a construction method, a timeline, or a material choice — correct them with facts, not attitude. "I totally understand why you'd think that, and here's what we've found works best..." will always land better than "That's not how it works." Agreeable doesn't mean pushover — it means you control the conversation without creating conflict. The contractors who build the biggest businesses are the ones who know how to manage people, not just projects.

→ After:

> Explain technical disagreements with evidence and clear options. Respectful communication does not require accepting unsafe work or unsupported claims.

88. [server/master-class/content/licensing.ts:91](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:91)

Before:

> Red Flags of a Problem Client

→ After:

> Issues to clarify before continuing

89. [server/master-class/content/licensing.ts:92](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:92)

Before:

> Mentions lawsuits or attorneys early in the process

→ After:

> A legal dispute that requires advice before work proceeds

90. [server/master-class/content/licensing.ts:93](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:93)

Before:

> Has left multiple 1-star reviews for other businesses

→ After:

> Unresolved expectations about how defects or complaints will be handled

91. [server/master-class/content/licensing.ts:94](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:94)

Before:

> Constantly compares your pricing to other bids

→ After:

> Differences between bids that need a scope comparison

92. [server/master-class/content/licensing.ts:98](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:98)

Before:

> Becomes overly friendly too fast — could be setting you up for a favor later

→ After:

> Requests for extras without a written scope or payment agreement

93. [server/master-class/content/licensing.ts:106](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:106)

Before:

> If it's unsalvageable, offer a partial refund to close the chapter

→ After:

> Discuss any proposed termination or refund against the contract and applicable requirements

94. [server/master-class/content/licensing.ts:118](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:118)

Before:

> In the early stages, do NOT hire a ton of help like PMs or secretaries. The majority of the work will fall back on you regardless. Every salary you add is overhead that eats into margins before you have consistent revenue to support it.

→ After:

> Plan hiring around workload, capacity and cash flow. Include compensation, training and supervision in the cost of a new role.

95. [server/master-class/content/licensing.ts:121](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:121)

Before:

> Your PM is the most trusted person in the operation. In the beginning, this should be YOU. Don't rush to fill this role until the workload is genuinely too large to keep up with.

→ After:

> Assign project management to someone with the capacity and relevant skills. An owner may fill this role initially; reassess when workload exceeds safe, effective supervision.

96. [server/master-class/content/licensing.ts:123](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:123)

Before:

> $45,000 – $75,000/yr

→ After:

> Research locally

97. [server/master-class/content/licensing.ts:123](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:123)

Before:

> Typical PM Salary

→ After:

> Compensation for the actual role

98. [server/master-class/content/vetting.ts:21](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:21)

Before:

> Experience Can't Be Faked

→ After:

> Verify relevant experience

99. [server/master-class/content/vetting.ts:22](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:22)

Before:

> How long a company has been in business is one of the strongest indicators of reliability. Watch out for the "combined experience" trick — adding up individual employee years to inflate the company's track record.

→ After:

> Company age is context, not proof of reliability. Distinguish the company’s completed projects from employees’ prior experience and verify both.

100. [server/master-class/content/vetting.ts:32](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:32)

Before:

> Ask for active jobs in the area — established companies always have them

→ After:

> Ask for relevant completed or active projects and references you have permission to contact

101. [server/master-class/content/vetting.ts:37](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:37)

Before:

> Manufacturer Programs (Diluted Standards)

→ After:

> Verify manufacturer program membership

102. [server/master-class/content/vetting.ts:38](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:38)

Before:

> Programs like James Hardie Elite used to require 36 full re-siding projects per year. Now it's just 10, and partial jobs as small as 150 sq ft qualify. Verification has been minimized. Don't rely on these badges alone.

→ After:

> Manufacturer programs have different eligibility and renewal rules. Verify current membership and its scope directly with the manufacturer; a badge alone does not establish workmanship quality.

103. [server/master-class/content/vetting.ts:39](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:39)

Before:

> Manufacturer certifications that once meant something may now be easily obtained. Always verify a company's actual project history — not just their badges.

→ After:

> Check the actual project history and current program requirements rather than assuming what a badge guarantees.

104. [server/master-class/content/vetting.ts:42](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:42)

Before:

> Some contractors send estimates via links that later disappear. If they can delete an estimate, they can alter a contract. This is a massive red flag for accountability.

→ After:

> An estimate link may expire or change. Request and retain a dated, downloadable copy so you can compare terms and preserve the agreement.

105. [server/master-class/content/vetting.ts:50](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:50)

Before:

> Some companies use branded trucks, slick websites, and multiple Google listings to look like large operations. In reality, they may be a single-person company using virtual addresses and PO boxes. They hide behind titles like "project manager" or "estimator" when they're the sole operator.

→ After:

> Branding does not establish company size. Ask who performs the work, who supervises it and how the business can be reached. A solo operator can be legitimate.

106. [server/master-class/content/vetting.ts:51](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:51)

Before:

> If something goes wrong, these companies often vanish with your money or fail to fix their mistakes, leaving you with zero accountability.

→ After:

> Verify accountability through the contract, credentials, references and actual responsibilities rather than the apparent size of the company.

107. [server/master-class/content/vetting.ts:54](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:54)

Before:

> Comparing a 20-year company with staff and offices to a 1-year company working from a pickup truck is not "apples to apples." Established companies anticipate structural issues. New companies discover them mid-project — costing you more.

→ After:

> Compare the proposed scope, relevant experience, supervision and warranty support. Age, office size and price alone do not establish quality or predict extra costs.

108. [server/master-class/content/vetting.ts:55](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:55)

Before:

> Real Risks of Cheap Bids:

→ After:

> Coverage questions for any bid:

109. [server/master-class/content/vetting.ts:63](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:63)

Before:

> A company that actively works to tear down others rather than build up their own reputation likely doesn't have the skills or track record to succeed on merit alone.

→ After:

> Ask for evidence supporting claims about competitors and assess the contractor’s own relevant work.

110. [server/master-class/content/vetting.ts:70](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:70)

Before:

> High Google rankings can be bought through marketing firms. A polished website with customer reviews, ads, and "10 years in business" claims means nothing without verification. Many companies pay to manipulate their online positions.

→ After:

> A polished website, advertising or search visibility does not establish contractor reliability. Verify credentials, relevant project history and the claims made on the site.

111. [server/master-class/content/vetting.ts:73](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:73)

Before:

> Unsolicited Calls = Lead Gen

→ After:

> Verify unsolicited contacts

112. [server/master-class/content/vetting.ts:74](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:74)

Before:

> If a company calls you out of the blue, your information was likely sold through a lead generation form. These companies buy leads in bulk and often lack the experience to deliver quality work. Only engage with companies you've researched yourself.

→ After:

> Ask an unsolicited caller how they obtained your details and which business they represent. Independently verify that business before sharing information or agreeing to work.

113. [server/master-class/content/vetting.ts:83](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:83)

Before:

> Real office or showroom (not a PO box, Suite #, or storage unit)

→ After:

> Verifiable contact details and an accurate explanation of the business’s service area or premises

114. [server/master-class/content/vetting.ts:84](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:84)

Before:

> Actual staff — customer service, project managers

→ After:

> The named person responsible for supervision, customer questions and warranty support, including an owner-operator

115. [server/master-class/content/vetting.ts:85](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:85)

Before:

> Drive by the address if you're unsure

→ After:

> Verify any claimed customer-facing office with permission; a home-based service-area business need not have a public storefront

116. [server/master-class/content/vetting.ts:89](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:89)

Before:

> Check the Better Business Bureau (BBB). It reveals the owner's name, complaints history, and accreditation status. If a company doesn't have an A+ and isn't accredited, they're either very new or have unresolved complaints.

→ After:

> Use available BBB information as one part of your research. A missing A+ rating or lack of accreditation does not by itself establish unresolved complaints or poor workmanship. Check the underlying record, relevant credentials and references.

117. [server/master-class/content/vetting.ts:90](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:90)

Before:

> BBB checks reveal:

→ After:

> BBB information to review:

118. [server/master-class/content/vetting.ts:90](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:90)

Before:

> Owner identity and age, years in business, complaint history, accreditation status, and whether complaints were resolved or ignored.

→ After:

> Review available business details, complaint history and responses, rating explanations and accreditation status. Confirm identity and credentials independently.

119. [server/master-class/content/vetting.ts:93](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:93)

Before:

> Some companies subcontract work and present it as their own. They leverage established brand names by falsely claiming affiliation or insider knowledge. When encountering such claims, question the integrity of the source.

→ After:

> Ask contractors to explain their role in each project they present, including subcontracted work. Verify claimed affiliations and do not assume subcontracting itself makes a project claim false.

120. [server/master-class/content/vetting.ts:97](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:97)

Before:

> Listing subcontracted projects as direct company accomplishments

→ After:

> Misrepresenting the company’s role in subcontracted projects

121. [server/master-class/content/vetting.ts:98](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:98)

Before:

> Ask for job site addresses you can drive by and verify in person

→ After:

> Ask for references or project visits only with the customer’s permission

122. [server/master-class/content/vetting.ts:102](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:102)

Before:

> Don't just trust online reviews — ask for 5-10 verified addresses as references. Many new companies have 80-90% of reviews from family or friends. Watch for reviews duplicated across 3-4 platforms (real customers rarely post on multiple sites). Check suspicious usernames.

→ After:

> Ask for relevant customer references with permission to contact them. Similar wording, clustered dates or reviews on multiple sites can prompt questions, but do not prove a review is fake. Verify claims without assuming a fixed proportion of reviews is fraudulent.

123. [server/master-class/content/vetting.ts:110](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:110)

Before:

> Having profiles on 15+ platforms but only 6 months in business

→ After:

> Online claims that cannot be reconciled with verified credentials or project history

124. [server/master-class/content/vetting.ts:119](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:119)

Before:

> Low bids mean the company is cutting costs — unskilled labor, no insurance, no overhead. When you pay a higher price, you're investing in experience and a company that has already overcome the hurdles of running a business. Lack of experience often results in redoing the job entirely.

→ After:

> A low bid may reflect a different scope, overhead or approach. Compare materials, supervision, exclusions, credentials and warranty terms; neither a low nor a high price proves quality.

125. [server/master-class/content/vetting.ts:120](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:120)

Before:

> Find the middle ground. The cheapest option often leads to the most expensive outcome — incorrect products, project delays, and lawsuits with insurance that doesn't cover the work.

→ After:

> Ask how the proposed price covers the agreed work and examine omissions before choosing a contractor.

126. [server/master-class/content/vetting.ts:126](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:126)

Before:

> For contractors building their own business: don't try to fake it till you make it. It usually never ends well. The construction industry rewards authenticity and punishes shortcuts. Here's the honest path to a credible brand that lasts:

→ After:

> Build a credible brand through accurate claims, documented work and accountable service. These practices support trust without guaranteeing business success.

127. [server/master-class/content/vetting.ts:129](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:129)

Before:

> Earn reviews organically from real customers — never buy or fabricate them. One honest 4-star review is worth more than ten fake 5-star reviews.

→ After:

> Request honest reviews from real customers; never buy or fabricate them

128. [server/master-class/content/vetting.ts:132](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:132)

Before:

> Establish a real physical presence — office, showroom, or shop. A real address shows permanence and gives customers confidence you'll be around to honor warranties.

→ After:

> Describe your operating model and provide reliable contact details; a home-based service-area business does not need a public storefront

129. [server/master-class/content/vetting.ts:137](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:137)

Before:

> Every established company in your market started exactly where you are. The difference between the ones that made it and the ones that didn't is simple: the successful ones built their reputation on real work, real customers, and real results. They didn't cut corners on insurance, they didn't fake reviews, and they didn't pretend to be bigger than they were. They earned every star, every referral, and every repeat customer. That's the path — and it works.

→ After:

> Build a verifiable record of work, communicate responsibilities and make only claims you can support. No branding checklist guarantees long-term success.

130. [server/master-class/content/vetting.ts:144](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:144)

Before:

> Use it before signing any contract; if a company can't satisfy most of these, keep looking.

→ After:

> Use these questions before signing a contract. Check which requirements apply to the work and investigate gaps rather than treating the checklist as a pass/fail score.

131. [server/master-class/content/vetting.ts:146](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:146)

Before:

> Verify contractor license with your state's licensing board

→ After:

> Verify any required contractor license and its scope with the issuing agency

132. [server/master-class/content/vetting.ts:150](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:150)

Before:

> Ask for 5-10 recent project addresses you can drive by

→ After:

> Ask for relevant project references or visits with the customer’s permission

133. [server/master-class/content/vetting.ts:156](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:156)

Before:

> Ask about their warranty terms relative to years in business

→ After:

> Read the written warranty scope, exclusions and claims process

134. [server/master-class/content/vetting.ts:160](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/vetting.ts:160)

Before:

> id: `item-${i + 1}`

→ After:

> id: [0, 4, 10].includes(i) ? `r5-item-${i + 1}` : `item-${i + 1}`

135. [server/master-class/content/gmb.ts:29](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:29)

Before:

> Video verification is now the common path: be ready to film your signage, vehicles, tools and a proof of address

→ After:

> If video verification is offered, follow Google’s prompts for evidence of the business, its location and your authority to manage it

136. [server/master-class/content/gmb.ts:34](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:34)

Before:

> **Who owns the profile?** Check Users in the profile today. If a former marketing company or employee is the primary owner, transfer it now while they still answer the phone. Recovering a profile from someone who has left takes weeks and is not always possible.

→ After:

> **Who owns the profile?** Review owner access and arrange any needed transfer while the current owner is available. Recovery time and outcome vary.

137. [server/master-class/content/gmb.ts:42](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:42)

Before:

> Google cross-checks the name, address, phone number and hours on your profile against your website and every directory that lists you. Where they disagree, trust drops and so does the ranking; where they agree, nobody thinks about it. Decide the canonical version once and defend it.

→ After:

> Keep the real-world business name and contact details accurate on your profile, website and directories. Inconsistencies can confuse customers; they do not establish a fixed ranking penalty. Respect address-visibility rules for service-area businesses.

138. [server/master-class/content/gmb.ts:44](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:44)

Before:

> Keep identical everywhere

→ After:

> Keep accurate and consistent

139. [server/master-class/content/gmb.ts:46](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:46)

Before:

> Address format (Suite vs Ste, St vs Street) — pick one spelling

→ After:

> Where an address may be published, use an accurate format; keep a private service-area address hidden where required

140. [server/master-class/content/gmb.ts:66](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:66)

Before:

> Photos are the part of the profile homeowners actually look at, and the part most contractors neglect after the first week. A profile with recent, real photos of jobs, crews and trucks reads as an active, local company; one with a logo and three stock images reads as a lead-gen front. Treat the photo section like a weekly habit, not a launch task.

→ After:

> Recent, accurate photos can help customers assess your work and team. A sparse photo section does not by itself establish that a business is a lead generator.

141. [server/master-class/content/gmb.ts:75](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:75)

Before:

> A few new photos every week beats fifty on launch day

→ After:

> Choose a manageable schedule for adding useful project photos

142. [server/master-class/content/gmb.ts:76](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:76)

Before:

> Take them with the location on and upload soon after the job; stale batches look staged

→ After:

> Upload with customer permission and avoid sharing private location details

143. [server/master-class/content/gmb.ts:81](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:81)

Before:

> **No promises about ranking.** Photos help you get chosen once you are seen; they are not a ranking trick, and no filename or geotag changes where the profile shows up.

→ After:

> **No promises about ranking.** Use photos to inform customers. Do not treat filenames, upload frequency or geotags as a guaranteed way to improve placement.

144. [server/master-class/content/gmb.ts:89](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:89)

Before:

> Reviews decide the map pack more than any other thing you control, and they are the first thing a homeowner reads about you. The companies with hundreds of reviews did not get them by luck: they ask every single customer, the same way, within days of finishing, and they answer every review that comes in.

→ After:

> Reviews can help customers evaluate a business and contribute to local prominence. Google describes [local ranking in terms of relevance, distance and prominence](https://support.google.com/business/answer/7091); review volume alone does not determine placement. Request honest feedback consistently.

145. [server/master-class/content/gmb.ts:100](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:100)

Before:

> Never argue, never post private details, never reply angry — the reply is read by the next 100 homeowners, not by the reviewer

→ After:

> Keep replies calm and protect private details; prospective customers may read the exchange

146. [server/master-class/content/gmb.ts:112](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:112)

Before:

> A profile that ranks gets attacked: fake 1-star reviews from a competitor's circle, suggested edits that change your phone number or mark you closed, duplicate listings in your name, and spam profiles stuffed with keywords sitting above you. None of it is rare. Know what each one looks like and what Google actually offers to fix it.

→ After:

> Profiles can receive suspicious reviews or inaccurate edits. Investigate the evidence rather than assuming a competitor is responsible; report suspected policy violations through Google’s tools.

147. [server/master-class/content/gmb.ts:127](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:127)

Before:

> **Never retaliate.** Posting fake reviews on the attacker's profile, or asking friends to, is the one move that gets *your* profile suspended. Report, reply once, document, move on.

→ After:

> **Never retaliate.** Do not post fake reviews or ask friends to do so. Report suspected violations, respond factually and retain relevant evidence.

148. [server/master-class/content/gmb.ts:135](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:135)

Before:

> Profile posts are short updates that show on your listing for a while and then roll off. They do not rank you, but they tell the homeowner comparing three profiles which company is alive this month — and they give you a reason to put new photos up. Decide a cadence you can keep for a year, then keep it.

→ After:

> Use profile posts to share useful, current updates. Choose a sustainable schedule and review what customers can see; posting does not guarantee better rankings.

149. [server/master-class/content/gmb.ts:157](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:157)

Before:

> A suspended profile disappears from Maps and Search overnight, and with it most of your calls. Suspensions are usually triggered by an edit Google's systems read as a guideline violation, and the fix is a reinstatement request with documents — not a new profile. Knowing the triggers avoids most of them.

→ After:

> A suspension can affect profile visibility and customer contact. Review the reason and current Google guidance, correct eligibility problems and use the available appeal process. Timing and outcomes vary.

150. [server/master-class/content/gmb.ts:159](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:159)

Before:

> Common triggers

→ After:

> Eligibility and accuracy issues to check

151. [server/master-class/content/gmb.ts:160](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:160)

Before:

> Changing the name, address or category in a burst, or adding keywords to the name

→ After:

> An inaccurate business name, location or category, including keywords added only for ranking

152. [server/master-class/content/gmb.ts:163](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:163)

Before:

> Hours, phone or website edits that no longer match your site and directories

→ After:

> Incorrect hours, phone or website details

153. [server/master-class/content/gmb.ts:164](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:164)

Before:

> Being reported by a competitor while any of the above is true

→ After:

> Evidence that the listing does not meet Google’s representation rules

154. [server/master-class/content/gmb.ts:167](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:167)

Before:

> Do not create a new profile; it will be suspended too and makes the appeal harder

→ After:

> Do not create a replacement profile to bypass a suspension; use the appeal process for the existing profile

155. [server/master-class/content/gmb.ts:169](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:169)

Before:

> Appeal through Google's reinstatement form once, with your business license, a utility bill or lease at the address and photos of permanent signage and vehicles

→ After:

> Follow the current appeal instructions and provide relevant evidence of your legitimate operation; do not invent a storefront or signage

156. [server/master-class/content/gmb.ts:170](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:170)

Before:

> One appeal at a time, answered factually; repeated or angry appeals slow it down

→ After:

> Keep the appeal factual and follow the instructions for its current status

157. [server/master-class/content/gmb.ts:189](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:189)

Before:

> Reviews first: the gap between you and the leader is usually counted in reviews

→ After:

> Check relevance, distance and prominence before attributing a ranking gap to reviews

158. [server/master-class/content/gmb.ts:192](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/gmb.ts:192)

Before:

> Not the name, not the address — those changes are the suspension triggers above

→ After:

> Correct inaccurate business details, but never change the name or address solely to chase rankings

159. [server/master-class/content/seo.ts:54](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:54)

Before:

> Tools like **Ahrefs** and **Semrush** are highly recommended for tracking your organic keywords, monitoring your backlink profile, analyzing competitors, and finding ranking opportunities. These are industry-standard tools used by serious SEO professionals.

→ After:

> Compare analytics and SEO tools against the questions you need to answer, their data coverage and your budget. Third-party authority scores are estimates, not Google ranking scores.

160. [server/master-class/content/seo.ts:102](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:102)

Before:

> Mix dofollow & nofollow

→ After:

> Qualify paid or sponsored links appropriately

161. [server/master-class/content/seo.ts:109](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:109)

Before:

> The [SEO Suite](/seo) shows a site's authority, backlinks and rankings over time, so a spam package or a lost link shows up in the numbers.

→ After:

> Use the [SEO Suite](/seo) to inspect available authority, backlink and ranking data. Third-party coverage may be incomplete or delayed.

162. [server/master-class/content/seo.ts:127](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:127)

Before:

> **Hunt duplicates.** Search your phone number and your old address in quotes; claim or remove every listing you did not create. Do the same after a move or a rename.

→ After:

> **Check duplicates.** Search your current and former contact details, verify ownership and use each directory’s correction process for inaccurate or duplicate listings.

163. [server/master-class/content/seo.ts:130](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:130)

Before:

> Your locations' names, addresses, phones and hours live in [Locations](/locations) — that is the version every directory should match.

→ After:

> Keep your accurate business details in [Locations](/locations), and follow each directory’s rules about which address details may be published.

164. [server/master-class/content/seo.ts:142](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:142)

Before:

> Claim your business page. Neighbors recommend contractors here constantly. Respond to recommendation requests in your area. This is hyperlocal and high-intent traffic.

→ After:

> Maintain an accurate business page and respond helpfully to relevant local requests. Measure the quality of referrals rather than assuming all traffic is ready to buy.

165. [server/master-class/content/seo.ts:144](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:144)

Before:

> **Pro Tip:** Don't spread yourself thin across every platform. Pick 2 and do them well. Facebook + Google Business Profile posting is the minimum. Add Instagram or YouTube if you have the bandwidth.

→ After:

> **Choose a manageable scope:** Start with channels your customers use and expand only when you can maintain useful, accurate updates.

166. [server/master-class/content/seo.ts:177](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:177)

Before:

> { id: "coverage",

→ After:

> { id: "coverage-r5",

167. [server/master-class/content/seo.ts:182](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/seo.ts:182)

Before:

> { id: "nap",

→ After:

> { id: "nap-r5",

168. [server/master-class/content/website.ts:115](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:115)

Before:

> WordPress gives the most control and the most to maintain; hosted builders (Squarespace, Wix, Webflow) trade control for upkeep done for you

→ After:

> Compare editing, backup, export and maintenance capabilities before choosing a self-managed CMS or hosted builder

169. [server/master-class/content/website.ts:117](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:117)

Before:

> Managed hosting with automatic backups, HTTPS and updates beats the cheapest shared plan

→ After:

> Compare hosting options for backups, HTTPS, updates, support and the needs of your site

170. [server/master-class/content/website.ts:136](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/website.ts:136)

Before:

> Stay in touch with completed customers. They're your best source of referrals and repeat business. Quarterly newsletters with maintenance tips work great.

→ After:

> With appropriate contact preferences, send past customers useful maintenance information and measure whether it helps them.

171. [server/master-class/content/licensing.ts:37](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:37)

Before:

> Sales — The Most Important Role

→ After:

> Sales and sustainable operations

172. [server/master-class/content/licensing.ts:54](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:54)

Before:

> Stay in constant contact while bidding.

→ After:

> Agree on follow-up while bidding.

173. [server/master-class/content/licensing.ts:74](/home/veto/ConstructHUB-fix-r5-course/server/master-class/content/licensing.ts:74)

Before:

> { type: "ranked", items:

→ After:

> { type: "cards", items:

