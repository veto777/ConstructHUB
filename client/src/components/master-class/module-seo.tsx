/**
 * Module 4 — SEO & Directory Domination: the local-SEO, citation, content, link-building and advertising lessons
 * of the Master Class (/master-class?tab=seo). Opened by the SEO & Directory Domination module, the bundle or an
 * included course (server/state-guides.ts). The paid Google Ads playbook (/google-ads-guide, 12 sections, server-
 * gated) and the free LSA guide are linked from the ads lesson rather than copied here.
 *
 * The services inquiry form at the end posts to /api/seo-inquiry like the sales dialog does.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Ban, BarChart3, BookOpen, CheckCircle2, ClipboardList, ExternalLink, Eye, FileSearch, FileText, Lightbulb, Link2, ListChecks, Loader2, MapPin, Megaphone, PenTool, Send, Share2, ShieldAlert, Target, TrendingUp } from "lucide-react";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { PROGRESS_NOTE, progressLabel, useChecklist } from "@/components/guides/progress";
import { planNamesWhere } from "@shared/plan-copy";
import type { ModuleHomeProps } from "./module-home";
import { AppLink, InApp, ModuleHome } from "./module-home";
import { Lesson, type LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:seo";
/** The plans whose modules include Cloudflare + Search Console (shared/plans.ts) — read, never typed. */
const CONNECTIONS_PLAN = planNamesWhere((p) => p.modules.cloudflareSearchConsole);
/** Same shape the server's email check accepts (name@domain.tld). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SEO_LESSONS: LessonMeta[] = [
  { id: "search-console", title: "Google Search Console (GSC)", icon: FileSearch },
  { id: "tracking", title: "Tracking & Analytics", icon: BarChart3 },
  { id: "content", title: "Content Strategy That Actually Ranks", icon: PenTool },
  { id: "backlinks", title: "Backlinks & Link Building", icon: Link2 },
  { id: "citations", title: "Citations and directories", icon: ListChecks },
  { id: "social", title: "Social Media & Reputation Building", icon: Share2 },
  { id: "ads", title: "Google Ads & Local Service Ads (LSA)", icon: Megaphone },
  { id: "maintenance", title: "The monthly SEO maintenance checklist", icon: ClipboardList },
];

const DIRECTORIES = [
  ["Google Business Profile", "The one that matters most; everything else should match it."],
  ["Apple Business Connect", "What Apple Maps and Siri show."],
  ["Bing Places", "Bing, and the assistants and browsers that use it."],
  ["Better Business Bureau", "Checked by homeowners who vet contractors (see Vetting, tip 14)."],
  ["Yelp, Angi, Houzz, Nextdoor", "The consumer directories homeowners actually open."],
  ["Trade associations and the local chamber", "Slow to get, trusted, rarely spammed."],
] as const;

const MAINTENANCE = [
  ["coverage", "Open Search Console: fix every new indexing error and confirm the sitemap is still accepted."],
  ["rankings", "Check where you rank for your main service in each city you serve."],
  ["content", "Publish at least one new page or article that answers a real customer question."],
  ["photos", "Add new project photos to the website and the Google profile."],
  ["reviews", "Every review answered; new review requests sent for the month's completed jobs."],
  ["nap", "Name, address, phone and hours identical on the site, the profile and the directories."],
  ["speed", "Run PageSpeed on the home page and the busiest service page; fix what regressed."],
  ["links", "Scan new backlinks for spam and note the good ones you earned."],
  ["clicks", "Review the IP exclusion list from your ad clicks and the month's cost per lead."],
  ["analytics", "Read the month's traffic sources and form fills; decide one thing to change."],
] as const;

export function SeoModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.seo === true;
  const { toast } = useToast();
  const maintenance = useChecklist("mc:seo:maintenance");
  const [seoName, setSeoName] = useState("");
  const [seoEmail, setSeoEmail] = useState("");
  const [seoPhone, setSeoPhone] = useState("");
  const [seoWebsite, setSeoWebsite] = useState("");
  const [seoServices, setSeoServices] = useState<string[]>([]);
  const [seoMessage, setSeoMessage] = useState("");

  const seoInquiryMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; phone: string; website: string; services: string[]; message: string }) => {
      const res = await apiRequest("POST", "/api/seo-inquiry", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inquiry sent", description: "We'll be in touch within 1 business day." });
      setSeoName(""); setSeoEmail(""); setSeoPhone(""); setSeoWebsite(""); setSeoServices([]); setSeoMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // A real <form>: the browser checks type="email" first, then this catches
  // what it lets through (e.g. "name@host" with no domain ending).
  const submitSeoInquiry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(seoEmail.trim())) {
      toast({ title: "Check your email", description: "Enter a valid email address", variant: "destructive" });
      return;
    }
    seoInquiryMutation.mutate({ name: seoName, email: seoEmail, phone: seoPhone, website: seoWebsite, services: seoServices, message: seoMessage });
  };

  const toggleSeoService = (service: string) => {
    setSeoServices(prev => prev.includes(service) ? prev.filter(s => s !== service) : [...prev, service]);
  };

  return (
    <ModuleHome {...p} title="SEO & Directory Domination" icon={TrendingUp} unlocked={unlocked} lessons={SEO_LESSONS} storageKey={KEY}
      what="The SEO and advertising lessons" moduleTitle="SEO & Directory Domination" badge={<UnlockBadge access={p.access} category="seo" />}
      description="Get found everywhere your customers search: Search Console, tracking, content, links, citations, social, paid ads and the monthly routine that keeps it all working." testId="module-seo">

    <Lesson id="search-console" title="Google Search Console (GSC)" icon={FileSearch} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Google Search Console is where you index your pages so Google actually knows they exist. This is where you submit sitemaps, request indexing for new pages, and monitor for crawl errors. If there are errors, fix them immediately — errors hurt your rankings.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-medium mb-1">GSC Verification Methods</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" /> Website HTML tag or file upload</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" /> Server access (root level)</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" /> Email access to that domain account</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" /> Cloudflare DNS</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" /> DNS TXT record</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-medium mb-1">What to Monitor</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-muted-foreground shrink-0" /> Index coverage & errors</li>
            <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-muted-foreground shrink-0" /> Sitemap submission status</li>
            <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-muted-foreground shrink-0" /> Manual actions or penalties</li>
            <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-muted-foreground shrink-0" /> Core Web Vitals</li>
            <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-muted-foreground shrink-0" /> Page experience signals</li>
          </ul>
        </div>
      </div>

      <Section flush>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-muted-foreground text-muted-foreground mb-2">Critical Warning: Protect Your GSC Access</p>
              <p className="text-xs text-muted-foreground mb-2">
                Never give Google Search Console access to someone you don't fully trust. There is a feature called <strong>Disavow</strong> that allows someone to reject all of your site's backlinks. A disgruntled employee, fired contractor, or untrustworthy agency can pull your backlink profile from tools like Ahrefs or Semrush, then disavow every single backlink your site has built. This will destroy your rankings entirely — and it is extremely difficult to recover from.
              </p>
              <p className="text-xs text-muted-foreground">
                Always be careful who you trust with this level of access. If you fire someone or end a contractor relationship on bad terms, revoke their GSC access immediately. This is one of the most dangerous attack vectors in SEO and can ruin you or your clients.
              </p>
            </div>
          </div>
        </CardContent>
      </Section>
      <InApp>Connecting Search Console inside ConstructHUB (<AppLink href="/search-console">Search Console</AppLink>, part of the {CONNECTIONS_PLAN} plan) pulls the property's search data into the platform; the <AppLink href="/guides#guide-connection">site connection guide</AppLink> walks through the client-side steps.</InApp>
    </Lesson>

    <Lesson id="tracking" title="Tracking & Analytics" icon={BarChart3} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Install tracking tools on your website so you can see exactly where your traffic is coming from, what visitors are doing, and which pages perform best. This data is essential for making informed decisions about your marketing.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Google Analytics</p>
            <p className="text-xs text-muted-foreground">Track visitor behavior, traffic sources, conversions, and user demographics. Essential for understanding how people find and use your site.</p>
          </div>
        </div>
        <a href="https://www.tracemyip.org/" target="_blank" rel="noopener noreferrer"
          className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-testid="link-tracemyip">
          <Eye className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">IP Tracker Tools</p>
            <p className="text-xs text-muted-foreground">Tools like TraceMyIP.org let you track individual visitor behavior, see exactly where traffic is coming from, and monitor user activity on your site in real-time.</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        </a>
      </div>
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Tools like <strong>Ahrefs</strong> and <strong>Semrush</strong> are highly recommended for tracking your organic keywords, monitoring your backlink profile, analyzing competitors, and finding ranking opportunities. These are industry-standard tools used by serious SEO professionals.
        </p>
      </div>
      <InApp>Your own visitor log is <AppLink href="/ip-tracker">IP Tracker</AppLink>: the install snippet records each visit by IP so you can see where traffic comes from and feed Click Guard's exclusions.</InApp>
    </Lesson>

    <Lesson id="content" title="Content Strategy That Actually Ranks" icon={PenTool} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Content is what Google reads to understand what your business does and where you do it. Without content, you're invisible. But the wrong content strategy will waste months of effort. Here's what actually works for contractors.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-muted-foreground" /> Service Pages</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> One dedicated page per service (roofing, siding, windows, etc.)</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Include process details, materials used, and expected timelines</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Add before/after photos with proper alt text</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Include FAQ sections targeting "how much does X cost" queries</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Location Pages</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Create unique pages for every city and neighborhood you serve</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Reference local landmarks, neighborhoods, and community details</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Include photos from actual projects in that area</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Never copy-paste the same content across location pages</li>
          </ul>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5 text-muted-foreground" /> Blog & Guide Content</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Write guides answering real customer questions: "How long does a roof last?"</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Comparison posts: "Standing seam vs architectural shingles"</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Case studies from real projects with cost breakdowns</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Post consistently — at least 2-4 articles per month</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground text-muted-foreground"><Ban className="h-3.5 w-3.5" /> Content Mistakes That Kill Rankings</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Using AI to generate all your content — Google detects it</li>
            <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Copy-pasting competitor content or spinning articles</li>
            <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Publishing thin pages with less than 300 words</li>
            <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Keyword stuffing — repeating the same phrase 20 times</li>
          </ul>
        </div>
      </div>
      <InApp>Run <AppLink href="/site-scan">Site Scan</AppLink> after a content push: its findings list the affected pages so the thin or broken ones are found before Google finds them.</InApp>
    </Lesson>

    <Lesson id="backlinks" title="Backlinks & Link Building" icon={Link2} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Link building is one of the most important factors for SEO page rank. Backlinks tell Google that other sites trust your content. But not all backlinks are equal — quality matters far more than quantity.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border bg-muted border-border">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground text-muted-foreground">Good Backlinks</p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>DR/DA of 30 or higher</li>
            <li>Relevant industry sites</li>
            <li>Guest posts on real blogs</li>
            <li>Local business directories</li>
            <li>Press releases (PBNs)</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <div className="flex items-center gap-2 mb-2">
            <Ban className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground text-muted-foreground">Bad Backlinks</p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>Fiverr spam packages</li>
            <li>Links from low DR/DA sites</li>
            <li>Irrelevant foreign sites</li>
            <li>Link farms and PBN spam</li>
            <li>Same anchor text repeatedly</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted border-border">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground text-muted-foreground">Best Practices</p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>Aim for 75% quality / 25% other</li>
            <li>Vary your anchor text</li>
            <li>Build links gradually</li>
            <li>Mix dofollow & nofollow</li>
            <li>Monitor with Ahrefs/Semrush</li>
          </ul>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Guest Posts:</strong> Writing guest posts on relevant industry blogs is a great way to build quality backlinks. But avoid using the same keywords across all your guest posts — Google will notice the pattern and it can look manipulative.</p>
          <p><strong>PBNs / Press Releases:</strong> Press release networks and news announcements can generate powerful, high-authority backlinks. These can be very effective but also expensive. Think of them as a big news push for launches, milestones, or major projects.</p>
        </div>
      </div>

      <Section flush>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Ban className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-muted-foreground text-muted-foreground mb-1">Avoid Buying Backlinks on Fiverr</p>
              <p className="text-xs text-muted-foreground">
                Cheap backlink packages on platforms like Fiverr are almost always spam. These sellers blast your URL across low-quality sites, link farms, and irrelevant directories. Google's algorithm detects this and your site will get de-ranked. If your backlink profile is mostly spam, you will lose your rankings — and recovering from a penalty is extremely difficult.
              </p>
            </div>
          </div>
        </CardContent>
      </Section>
      <InApp>The <AppLink href="/seo">SEO Suite</AppLink> shows a site's authority, backlinks and rankings over time, so a spam package or a lost link shows up in the numbers.</InApp>
    </Lesson>

    <Lesson id="citations" title="Citations and directories" icon={ListChecks} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        A citation is any listing of your business name, address and phone number on another site. Google reads them to confirm that a real business exists where your profile says it does, so what matters is not how many you have but that every one of them says exactly the same thing. One old phone number on a directory you forgot about is a signal against you.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DIRECTORIES.map(([name, why]) => (
          <div key={name} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">{why}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p><strong>Write the canonical version once</strong> — legal name, address format, the one tracking-free phone number, the exact website URL — and paste it everywhere. Never let a directory "improve" it.</p>
          <p><strong>Hunt duplicates.</strong> Search your phone number and your old address in quotes; claim or remove every listing you did not create. Do the same after a move or a rename.</p>
          <p><strong>Skip the bulk packages.</strong> "500 citations for $50" are the directory version of Fiverr backlinks: inconsistent, unmaintained and impossible to clean up later.</p>
        </div>
      </div>
      <InApp>Your locations' names, addresses, phones and hours live in <AppLink href="/locations">Locations</AppLink> — that is the version every directory should match.</InApp>
    </Lesson>

    <Lesson id="social" title="Social Media & Reputation Building" icon={Share2} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Social media won't directly rank your website, but it builds brand recognition, drives referral traffic, and signals to Google that your business is active and legitimate. For contractors, the key platforms are Facebook, Instagram, YouTube, and NextDoor.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { platform: "Facebook", tip: "Post project updates, before/after photos, and customer testimonials. Join local community groups and participate without being salesy. Run targeted ads to homeowners within your service radius." },
          { platform: "Instagram", tip: "Visual platform perfect for construction. Post project progress photos, time-lapse videos, and finished work. Use local hashtags and location tags. Stories and Reels get more reach than static posts." },
          { platform: "YouTube", tip: "Create walkthrough videos of completed projects, how-to guides, and behind-the-scenes content. YouTube is the #2 search engine — your videos can rank for contractor-related queries." },
          { platform: "NextDoor", tip: "Claim your business page. Neighbors recommend contractors here constantly. Respond to recommendation requests in your area. This is hyperlocal and high-intent traffic." },
        ].map((item, i) => (
          <div key={i} className="p-3 rounded-lg border bg-muted/30">
            <p className="text-xs font-semibold mb-1">{item.platform}</p>
            <p className="text-xs text-muted-foreground">{item.tip}</p>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <strong>Pro Tip:</strong> Don't spread yourself thin across every platform. Pick 2 and do them well. Facebook + Google Business Profile posting is the minimum. Add Instagram or YouTube if you have the bandwidth.
        </p>
      </div>
      <InApp><AppLink href="/social-media">Social Media</AppLink> composes once and schedules to every connected account, and can draft posts from your Google updates and photos for your approval.</InApp>
    </Lesson>

    <Lesson id="ads" title="Google Ads & Local Service Ads (LSA)" icon={Megaphone} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paid advertising gets you immediate visibility while your SEO builds over time. For contractors, Google Ads and Local Service Ads are the two most effective paid channels. Here's how they differ and when to use each.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-muted-foreground" /> Google Search Ads</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Target specific keywords: "roof repair near me," "siding contractor [city]"</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Set geographic targeting to your exact service radius</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Use negative keywords to filter out DIY and job-seeker clicks</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Start with $500-$1,500/month and scale based on ROI</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5 text-muted-foreground" /> Local Service Ads (Google Guaranteed)</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Pay per lead, not per click — only charged for actual phone calls/messages</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Google Guaranteed badge builds instant trust with consumers</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Shows above regular ads — top of search results</li>
            <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Requires background check and license/insurance verification</li>
          </ul>
        </div>
      </div>
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <strong>Budget Strategy:</strong> Run LSA as your primary paid channel (it's cheaper per lead for most trades). Layer in Google Search Ads for keywords that LSA doesn't cover. Track every lead source so you know your actual cost per customer acquisition — not just cost per click.
        </p>
      </div>
      <InApp>The full campaign playbook is the <AppLink href="/google-ads-guide">Google Ads guide</AppLink> (12 sections, open with any module); the <AppLink href="/lsa-guide">LSA guide</AppLink> is free. <AppLink href="/google-ads">Click Guard</AppLink> records the clicks on your site and builds the IP exclusion list the playbook relies on.</InApp>
    </Lesson>

    <Lesson id="maintenance" title="The monthly SEO maintenance checklist" icon={ClipboardList} storageKey={KEY} contentClassName="space-y-3"
      description={<>{progressLabel(MAINTENANCE.filter(([id]) => maintenance.isDone(id)).length, MAINTENANCE.length)} this month · {PROGRESS_NOTE}</>}>
      <p className="text-sm text-muted-foreground">
        Rankings are not won once. The companies that stay on page one do a short routine every month, and the ones that drop off stopped doing it. Work through the list, then reset it when the new month starts.
      </p>
      <ul className="space-y-1.5" data-testid="list-seo-maintenance">
        {MAINTENANCE.map(([id, text]) => {
          const done = maintenance.isDone(id);
          const boxId = `seo-maint-${id}`;
          return (
            <li key={id}>
              <label htmlFor={boxId} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md border bg-background/60 px-3 py-2 text-sm hover:bg-muted/50">
                <Checkbox id={boxId} checked={done} onCheckedChange={(v) => maintenance.toggle(id, v === true)} className="mt-0.5" data-testid={`checkbox-seo-maint-${id}`} />
                <span className={done ? "text-muted-foreground line-through" : ""}>{text}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {maintenance.count > 0 && (
        <Button variant="ghost" size="sm" onClick={maintenance.reset} data-testid="button-seo-maint-reset">Start a new month</Button>
      )}
      <InApp>Most of the list has a page here: <AppLink href="/ranking-grid">GMB Ranking Grid</AppLink> for rankings, <AppLink href="/google-reviews">Google Reviews</AppLink> for requests and replies, <AppLink href="/site-scan">Site Scan</AppLink> for the site, <AppLink href="/google-ads">Click Guard</AppLink> for ad clicks and the IP list.</InApp>
    </Lesson>

    <Section flush className="border-border   ">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-5 w-5 text-muted-foreground" />
          Need Help With Any of These Services?
        </CardTitle>
        <CardDescription>
          Whether you need help with link building, SEO audits, page speed optimization, Google Search Console setup, or content creation — we offer all of these services. Fill out the form below and we'll get back to you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submitSeoInquiry} data-testid="form-seo-inquiry">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="seo-name">Full Name</Label>
            <Input id="seo-name" placeholder="Your name" value={seoName} onChange={(e) => setSeoName(e.target.value)} data-testid="input-seo-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-email">Email</Label>
            <Input id="seo-email" type="email" required placeholder="you@company.com" value={seoEmail} onChange={(e) => setSeoEmail(e.target.value)} data-testid="input-seo-email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-phone">Phone</Label>
            <Input id="seo-phone" type="tel" placeholder="(555) 123-4567" value={seoPhone} onChange={(e) => setSeoPhone(e.target.value)} data-testid="input-seo-phone" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-website">Website URL</Label>
            <Input id="seo-website" placeholder="https://yoursite.com" value={seoWebsite} onChange={(e) => setSeoWebsite(e.target.value)} data-testid="input-seo-website" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Services Interested In</Label>
          <div className="flex flex-wrap gap-2">
            {[
              "Link Building", "Guest Posts", "Press Releases / PBNs", "SEO Audit",
              "Page Speed Optimization", "Google Search Console Setup", "Google Analytics Setup",
              "Content Writing", "Website Design", "Local SEO", "Backlink Cleanup"
            ].map(service => (
              <Badge
                key={service}
                variant={seoServices.includes(service) ? "default" : "outline"}
                className={`cursor-pointer transition-colors ${seoServices.includes(service) ? "bg-muted" : "hover:bg-muted"}`}
                onClick={() => toggleSeoService(service)}
                data-testid={`badge-service-${service.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {service}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo-message">Tell Us About Your Project</Label>
          <Textarea
            id="seo-message"
            placeholder="Describe what you need help with, your current situation, goals, and any specific concerns..."
            value={seoMessage}
            onChange={(e) => setSeoMessage(e.target.value)}
            rows={4}
            data-testid="textarea-seo-message"
          />
        </div>

        <Button
          type="submit"
          className="w-full sm:w-auto"
          data-testid="button-submit-seo-inquiry"
          disabled={seoInquiryMutation.isPending || !seoName.trim() || !seoEmail.trim()}
        >
          {seoInquiryMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Submit inquiry
        </Button>
        </form>
      </CardContent>
    </Section>
    </ModuleHome>
  );
}
