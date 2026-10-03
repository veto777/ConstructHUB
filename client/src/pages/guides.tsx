import { SiteConnectionGuide } from "./site-connection-guide";
import { AppPage, PageHeader, Section } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Redirect } from "wouter";
const guides = [
  {
    title: "Connect Blotato",
    href: "/social-media",
    steps: [
      "Visit Blotato and create your own account. Blotato is a separate subscription you buy from Blotato; creating an API key activates its paid subscription.",
      "Connect your social accounts inside Blotato. For Facebook, grant access to the Pages you manage.",
      "In Blotato Settings, open API and create/copy an API key. Never send the key to anyone else.",
      "Open Social Media, search for a business / Google profile, and select it. Choose Agency shared key or This business only, paste the Blotato API key, and choose Connect Blotato. A business without its own key falls back to the agency key.",
      "Open Map accounts and pages to this business. Search accounts, discover pages or boards, choose the verified destinations, and Save business mapping. These become composer defaults and bulk destinations. Disconnect stops local queued posts and auto mode; manage already-submitted posts and billing in Blotato.",
    ],
  },
  {
    title: "Manual posting",
    href: "/social-media",
    steps: [
      "Open Social Media → Compose. Select accounts/pages and enter Post text.",
      "Use each platform’s text tweak and character counter. Add public media URLs, attach a synced business photo, or Upload through Blotato.",
      "For YouTube, supply a title, video and privacy choice. TikTok defaults to private; choose public explicitly and set any business/paid partnership disclosures.",
      "Choose Post now, or enter Schedule time in your browser’s local timezone and choose Schedule post. Save draft keeps the post for approval.",
      "Open Calendar & queue. Each destination has its own status. Approve & queue a draft, or cancel before submission. Follow View published post or Open Blotato status.",
      "If status is uncertain, check the submission in Blotato before creating another post. A queued or accepted submission is not a confirmed publication.",
    ],
  },
  {
    title: "Auto mode",
    href: "/social-media",
    steps: [
      "Add your business details in Locations. Sync that location’s Google business photos and reviews if you want those content sources.",
      "In Social Media → Compose, select the accounts/pages to use. Open Auto mode and choose Use accounts selected in Compose.",
      "Choose cadence, content mix, timezone, blackout hours, business instructions, writing examples, and daily AI budget. Add factual offers under Content sources. Use Sync recent GBP updates to import live standard updates from linked Google locations; refresh is queued in the background and only imports the selected business. Check the refresh status; generation uses recent stored sources.",
      "Start with Approval queue, enable auto mode and Save auto settings. Generate draft from saved settings queues a preview without publishing; results appear in the calendar after the worker runs.",
      "Review AI-generated drafts in Calendar & queue; edit the text and choose Approve & queue.",
      "Only choose Fully automatic if you authorize generated posts to publish without review. Disabling auto mode returns pending automatic posts to drafts. Missing source material is reported instead of invented. Remove expired offers promptly.",
    ],
  },
  {
    title: "Agency social workflows",
    href: "/social-media",
    steps: [
      "The business selector searches saved Locations and remembers the selected business in the URL. Switching businesses resets the composer and settings editor.",
      "Open Bulk actions, select businesses across search pages, and write one update using {business}, {city}, and {phone}. Create bulk drafts for review or explicitly Queue bulk posts. Missing facts or invalid destinations produce per-business failures in Bulk results.",
      "Expand Per-business cadence to set each selected business’s frequency. Approval drafts is the default; choosing automatic publishing explicitly authorizes all selected businesses. You can also disable auto modes, refresh GBP sources, or generate drafts in bulk.",
      "Open All-clients calendar to search business names/post text and filter dates, status, and platform. Select drafts for bulk approval or cancel unsent posts. A single bulk action handles up to 100 posts.",
      "Mapping edits pause auto mode. After changing a key, review and save each affected business mapping before enabling auto mode again. Legacy global automation is paused; unassigned history remains in the all-clients calendar.",
    ],
  },
  {
    title: "Profile Guard",
    href: "/locations",
    steps: [
      "Open Locations, open a linked business location, then Profile Guard. Choose Watched fields and Preview current Google values. Inspect the proposed snapshot before approving it.",
      "Choose Off, Notify or Lockdown. Use Verify identity with the requested credentials, then Approve snapshot and save settings. For an existing snapshot, use Save guard settings. Lockdown restores detected changes; it cannot block edits at Google.",
      "Use Check now to inspect changes. Approve accepts a detected value into your snapshot; Reject attempts to restore the approved value at Google. Check pending changes and failure messages afterward.",
      "Report opens evidence, not a submitted complaint. Choose Copy report and Open Google's official form, complete the form at Google, then I submitted the form — mark reported. The receipt is local to ConstructHUB.",
    ],
  },
  {
    title: "AI review replies",
    href: "/google-reviews",
    steps: [
      "Open Google Reviews → Google Profile Reviews and sync your linked business's reviews. In AI reply settings and drafts queue, select a linked location.",
      "Choose Off, Draft for approval or Auto-publish. Set tone, sign-off, character limit and star-rating rules, then Save AI reply settings. Auto-publish authorizes publication; one- and two-star reviews remain drafts unless you explicitly permit their auto-publication.",
      "Future-only applies to reviews created after enabling AI. For existing unanswered reviews, select that scope, save settings, choose Preview existing reviews, inspect the actions, then Confirm backfill. Each preview covers up to 50 reviews and expires after ten minutes.",
      "Review and edit generated drafts in the queue before publishing. Check facts, tone and private information. A draft is not a posted reply; inspect the final status and any error before trying again.",
    ],
  },
  {
    title: "Posts & Photos scheduling and AI captions",
    href: "/gbp-content",
    steps: [
      "Open Google Business → Posts & Photos and select a linked location. Select library photos or Upload photos (up to 100, 15 MB each). Filename and EXIF changes make library copies; Google strips EXIF and geotags do not promise ranking benefits.",
      "Under AI drafts and style, enter Instructions and Example descriptions, then Generate caption drafts or Generate post draft. Review and edit the result. Learn from past updates creates guidance that must be reviewed and saved with Save style guidance before use.",
      "Under Compose Google update — draft, choose Post type and supply required event or offer fields. Event and offer times use the Google location's local time. Add post to draft batch collects distinct updates; unsaved drafts are lost on reload.",
      "Under Schedule and approval, set First publish (blank = now), Items per period and Cadence. For Custom times supply one timestamp with timezone per item. Business hours only uses the timezone, weekdays and hours you enter, not inferred Google hours.",
      "Choose Approve & queue photos or Approve & queue post to authorize publishing. Cadence spaces that approved set; it does not generate an ongoing series. A disabled publishing worker leaves items queued.",
      "Inspect Calendar, queue & history and Refresh Google status. Cancel queued work to replace it. Resolve failures before Retry; for uncertain results, check Google first because retrying can duplicate a successful publication.",
    ],
  },
  {
    title: "Security",
    href: "/settings?tab=security",
    steps: [
      "Open Settings → Security & activity. Under Two-Factor Authentication, choose Enable 2FA, scan the QR code in your authenticator, enter its code and choose Verify & Enable. Save the recovery codes privately, then I saved my codes. Each recovery code works once.",
      "Remember a device only on a private device you control. In Remembered devices, choose Revoke device for old devices. Revocation requires 2FA at the next sign-in; it does not terminate an existing session.",
      "Complete identity verification when prompted before sensitive changes. Recovery codes restore sign-in but do not replace the configured verification method for protected settings.",
      "Open Settings → Notifications to save delivery preferences. Security email is always on. The header bell shows recent notices and lets you mark them read.",
      "Review Account activity using Activity type and Since. For an unfamiliar Google connection, follow the security notice, explicitly disconnect the account and follow the password-reset guidance. Opening a notice alone does not disconnect anything.",
    ],
  },
  {
    title: "Site Scan",
    href: "/site-scan",
    steps: [
      "Open Site Scan. Choose a Linked GBP location or No GBP comparison, then check Website URL. GBP comparisons use the last synced profile; scan findings do not change your website or Google listing.",
      "Set Page cap and PageSpeed pages (mobile + desktop), then Start scan. Follow progress and coverage notices. Missing measurements remain unavailable; scores are diagnostic heuristics, not ranking guarantees.",
      "Inspect findings and affected URLs. Generate AI fix plan creates drafts only; review their accuracy before using Copy draft or applying changes yourself.",
      "On a completed report, use Export PDF or Create share link. Anyone with the link can read the report, including drafts and GBP facts. Creating another link replaces the old one; Revoke share link stops future access. Share links expire after 30 days.",
      "Use Enable monthly rescan for the chosen URL and Disable monthly rescan to stop it. History compares completed scans. Scheduled scans share your daily budgets, and larger scans can take several minutes.",
      "The public Free 60-second website scan at /free-site-scan shows a limited summary. Open the verification email to unlock the full quick-scan report of up to 11 pages; the seven-day email link does not unlock a full account scan. Sixty seconds is an estimate.",
    ],
  },
];
/** The walkthroughs, shown as the Guides tab of Social Media. */
export function GuidesContent() {
  return (
    <section aria-label="Guides walkthroughs">
      <AppPage width="narrow" className="!px-0 !pt-0">
        <PageHeader title="Guides" description="Choose a tool and follow the steps at your own pace."
          actions={<Button asChild><a href="#guide-0">Get started</a></Button>} />
        <Section title="Find a guide">
          <nav aria-label="Guide topics" className="grid gap-1 sm:grid-cols-2">
            <a href="#guide-connection" className="flex min-h-10 items-center rounded-lg px-2 text-sm hover:bg-muted">Connect your website</a>
            {guides.map((g, i) => <a key={g.title} href={`#guide-${i}`} className="flex min-h-10 items-center rounded-lg px-2 text-sm hover:bg-muted">{g.title}</a>)}
          </nav>
        </Section>
        <div id="guide-connection" className="scroll-mt-6"><SiteConnectionGuide /></div>
        {guides.map((g, i) => (
          <Section key={g.title} id={`guide-${i}`} title={g.title} className="scroll-mt-6"
            actions={<Button asChild variant="outline" size="sm"><a href={g.href}>Open {g.title === "Security" ? "Security & activity" : g.title === "Profile Guard" ? "Locations" : g.title === "AI review replies" ? "Google Reviews" : g.title.startsWith("Posts & Photos") ? "Posts & Photos" : g.title === "Site Scan" ? "Site Scan" : "Social Media"}</a></Button>}>
            <ol className="list-decimal space-y-5 pl-5 text-sm leading-7 marker:text-muted-foreground">
              {g.steps.map((step) => <li key={step} className="pl-1">{step}</li>)}
            </ol>
          </Section>
        ))}
      </AppPage>
    </section>
  );
}

/** Old /guides links land on the Social Media Guides tab. */
export default function GuidesPage() {
  return <Redirect to="/social-media?tab=guides" replace />;
}
