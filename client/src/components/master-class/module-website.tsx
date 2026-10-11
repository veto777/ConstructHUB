/**
 * Module 3 — Website & Online Presence: the website lessons of the Master Class (/master-class?tab=website).
 * Opened by the Website & Online Presence module, the bundle or an included course (server/state-guides.ts).
 * The lesson order follows the module's own promise (server/data/master-class-modules.json features): the
 * blueprint, service and location pages, speed and mobile, the portfolio, structured data, CMS and hosting,
 * then follow-up email.
 */
import { Camera, CheckCircle2, Code, ExternalLink, Gauge, Globe, Layers, Lightbulb, Mail, Monitor, MousePointer, Smartphone, Zap } from "lucide-react";
import type { ModuleHomeProps } from "./module-home";
import { AppLink, InApp, ModuleHome } from "./module-home";
import { Lesson, type LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:website";

export const WEBSITE_LESSONS: LessonMeta[] = [
  { id: "blueprint", title: "The contractor website blueprint", icon: Layers },
  { id: "location-pages", title: "Location Pages & Slug Pages", icon: Globe },
  { id: "page-speed", title: "Page Speed & Performance", icon: Gauge },
  { id: "mobile", title: "Mobile-First Design & User Experience", icon: Smartphone },
  { id: "portfolio", title: "Portfolio showcases that close jobs", icon: Camera },
  { id: "schema", title: "Schema Markup & Structured Data", icon: Code },
  { id: "cms-hosting", title: "CMS, hosting and owning your site", icon: Monitor },
  { id: "email", title: "Email Marketing & Follow-Up Systems", icon: Mail },
];

const PAGES = [
  ["Home", "Who you are, what you do, where you work, one phone number and one form — above the fold."],
  ["One page per service", "Roofing, siding, windows: each with its process, materials, photos and its own FAQ."],
  ["One page per city", "The towns you actually work in, each with local projects and local wording."],
  ["Projects", "Real jobs with before-and-after photos, the city and the service in every caption."],
  ["Reviews", "Your Google reviews on your own site, pulled live or updated monthly."],
  ["About", "The owner, the crew, the license number, the insurance — the trust page."],
  ["Contact", "Phone, text, form, hours and service area. Every other page links here."],
] as const;

export function WebsiteModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.website === true;
  return (
    <ModuleHome {...p} title="Website & Online Presence" icon={Monitor} unlocked={unlocked} lessons={WEBSITE_LESSONS} storageKey={KEY}
      what="The website lessons" moduleTitle="Website & Online Presence" badge={<UnlockBadge access={p.access} category="website" />}
      description="Build a contractor website that turns visitors into booked jobs: the pages it needs, how they rank, how fast they load and how they convert." testId="module-website">

    <Lesson id="blueprint" title="The contractor website blueprint" icon={Layers} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        A contractor site has one job: make a homeowner who already wants the work pick up the phone. That takes a small set of pages, each doing one thing well, with the same phone number and the same form on every one of them. Build these seven pages before anything else.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PAGES.map(([name, what]) => (
          <div key={name} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">{what}</p>
            </div>
          </div>
        ))}
      </div>
      <InApp>Run the live site through <AppLink href="/site-scan">Site Scan</AppLink> once it is up: it finds the broken pages, slow pages and missing basics, and compares the site with your Google Business Profile.</InApp>
    </Lesson>

    <Lesson id="location-pages" title="Location Pages & Slug Pages" icon={Globe} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Your homepage matters, but your location pages and slug pages (service pages, city pages) are just as important — sometimes more. These are the pages that actually rank for local and service-specific searches. Every city and service you cover should have its own dedicated landing page with unique content.
      </p>
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Each landing page must have unique content. Do not duplicate content across pages or copy from competitors. Use AI tools minimally — if you lean on AI too heavily, your content will read the same as everyone else's. Google grades your content on uniqueness. If it detects duplicate or thin content, your pages will not rank and can actually hurt your entire site.
        </p>
      </div>
      <InApp>Each city page should match a location in <AppLink href="/locations">Locations</AppLink> and the Google profile that links to it; the <AppLink href="/ranking-grid">GMB Ranking Grid</AppLink> shows which towns the pages still have to win.</InApp>
    </Lesson>

    <Lesson id="page-speed" title="Page Speed & Performance" icon={Gauge} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Page speed is a direct ranking factor. Google rolled out a Core Web Vitals update and sites that load slowly will lose position. This is not optional — it directly affects where you show up in search results.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <a href="https://pagespeed.web.dev/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-testid="link-pagespeed">
          <Gauge className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Google PageSpeed Insights</p>
            <p className="text-xs text-muted-foreground">Check your speed score, SEO issues, and Core Web Vitals. This is the tool Google uses to grade your site.</p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        </a>
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          <Zap className="h-5 w-5 text-yellow-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">NitroPack</p>
            <p className="text-xs text-muted-foreground">A performance optimization tool that handles caching, image compression, and code minification automatically to boost page speed scores.</p>
          </div>
        </div>
      </div>
      <InApp><AppLink href="/site-scan">Site Scan</AppLink> runs PageSpeed on the pages you choose, mobile and desktop, and keeps the history so you can see a regression.</InApp>
    </Lesson>

    <Lesson id="mobile" title="Mobile-First Design & User Experience" icon={Smartphone} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Over 70% of contractor website traffic comes from mobile devices. Google uses mobile-first indexing, meaning it ranks your site based on the mobile version. If your site doesn't work well on phones, you're losing both rankings and customers.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2">Mobile Must-Haves</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Click-to-call button visible on every page</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Fast load time — under 3 seconds on mobile networks</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Large tap targets — buttons at least 48px tall</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Readable text without zooming — 16px minimum font size</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Sticky header or floating CTA button for easy contact</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2">Conversion Optimization</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Contact form above the fold on every service page</li>
            <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Social proof near CTAs — review count, star rating, years in business</li>
            <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Simple forms — name, phone, zip code, service needed (4 fields max)</li>
            <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Urgency elements — "Free estimates this week" or "Limited availability"</li>
            <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Trust badges — BBB, manufacturer certifications, insurance logos</li>
          </ul>
        </div>
      </div>
      <InApp><AppLink href="/site-scan">Site Scan</AppLink> runs PageSpeed's mobile check on the pages you choose; the mobile score is the one Google ranks by.</InApp>
    </Lesson>

    <Lesson id="portfolio" title="Portfolio showcases that close jobs" icon={Camera} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Homeowners hire what they can see. A projects page with a dozen real jobs, photographed properly, closes more estimates than any paragraph about quality. It is also the page most often faked by new companies (see Vetting, tips 15 and 17), so yours has to be unmistakably yours.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold">What to show</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Before and after of the same angle, taken in daylight after the clean-up</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> The city and the service in every caption — that is what the page ranks for</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> A line on what the job involved, the materials and how long it took</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Your crew and your trucks in some of the photos: proof the work is yours</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold">Rules that keep it honest and fast</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Only your own projects — never stock photos or a supplier's gallery presented as your work</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Ask the homeowner before you publish photos of their house</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Compress every image before upload; a gallery of full-size phone photos is the slowest page on most contractor sites</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Add new work every quarter and retire the weakest — a dated portfolio reads as a closed business</li>
          </ul>
        </div>
      </div>
      <InApp>Keep the photos you reuse on the site and on your Google profile in the <AppLink href="/media-library">Media Library</AppLink>, and publish the best ones to the profile from <AppLink href="/gbp-content">Posts &amp; Photos</AppLink>.</InApp>
    </Lesson>

    <Lesson id="schema" title="Schema Markup & Structured Data" icon={Code} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Schema markup is code you add to your website that tells Google exactly what your business is, what services you offer, and where you're located. It's how you get rich results in search — star ratings, service lists, business hours, and more showing up directly in Google.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">LocalBusiness Schema</p>
          <p className="text-xs text-muted-foreground">Business name, address, phone, hours, service area, and geo coordinates. This is the foundation — every contractor site needs it.</p>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">Service Schema</p>
          <p className="text-xs text-muted-foreground">Define each service with descriptions, price ranges, and service areas. Helps Google match your pages to specific service queries.</p>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">Review & FAQ Schema</p>
          <p className="text-xs text-muted-foreground">Embed review data and FAQ answers directly in search results. This takes up more space in Google and increases click-through rates.</p>
        </div>
      </div>
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Use Google's <strong>Rich Results Test</strong> tool to validate your schema markup. If your schema has errors, Google will ignore it entirely. Most WordPress SEO plugins like Yoast or RankMath can generate basic schema automatically, but you'll want to customize it for contractor-specific services.
        </p>
      </div>
    </Lesson>

    <Lesson id="cms-hosting" title="CMS, hosting and owning your site" icon={Monitor} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        The platform matters less than who holds the keys. Contractors lose their sites to a web designer who disappears, a hosting bill nobody paid or a domain registered in an agency's name far more often than to a bad CMS. Pick a mainstream platform you or your staff can edit, then make sure every account is yours.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold">Choosing a platform</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> WordPress gives the most control and the most to maintain; hosted builders (Squarespace, Wix, Webflow) trade control for upkeep done for you</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Whatever you pick, you must be able to add a service page or a project yourself in an afternoon</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> Managed hosting with automatic backups, HTTPS and updates beats the cheapest shared plan</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold">Ownership checklist</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> The domain is registered to your company, in an account you control, with auto-renew on</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> You hold admin logins for hosting, the CMS, Search Console and Analytics — the agency gets a user, not the owner seat</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> You can export your pages, photos and leads and leave with them</li>
          </ul>
        </div>
      </div>
      <InApp>The <AppLink href="/guides#guide-connection">site connection guide</AppLink> walks through putting the site behind Cloudflare and connecting Search Console; <AppLink href="/domains">Domains</AppLink> keeps your domains' records and renewals in view.</InApp>
    </Lesson>

    <Lesson id="email" title="Email Marketing & Follow-Up Systems" icon={Mail} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Most contractors completely ignore email marketing, which means it's a huge opportunity. Not every lead is ready to buy today — a follow-up system keeps you top of mind when they're ready. This is especially powerful for seasonal services.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">Lead Follow-Up Sequence</p>
          <p className="text-xs text-muted-foreground">Set up automated emails after someone fills out your contact form. Day 1: confirmation. Day 3: case study. Day 7: special offer. Day 14: check-in.</p>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">Seasonal Campaigns</p>
          <p className="text-xs text-muted-foreground">Send seasonal reminders: spring gutter cleaning, fall roof inspections, winter prep, etc. These are high-conversion emails because they're timely and relevant.</p>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-1 text-muted-foreground text-muted-foreground">Past Customer Nurture</p>
          <p className="text-xs text-muted-foreground">Stay in touch with completed customers. They're your best source of referrals and repeat business. Quarterly newsletters with maintenance tips work great.</p>
        </div>
      </div>
      <InApp>Review requests and reminders after a job go out from <AppLink href="/google-reviews">Google Reviews</AppLink>; the longer follow-up and seasonal emails are your email tool's job.</InApp>
    </Lesson>
    </ModuleHome>
  );
}
