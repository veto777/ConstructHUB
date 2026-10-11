/**
 * Module 2 — GMB Setup & Optimization: the Google Business Profile lessons of the Master Class
 * (/master-class?tab=gmb). Opened by the GMB Setup & Optimization module, the bundle or an included course
 * (server/state-guides.ts). Until this module home existed the module was sold with no lessons behind it
 * (review, 2026-10-10); the lessons follow its promise in server/data/master-class-modules.json: setup and
 * verification, review management, fake-review defence, photos, posting cadence, suspension prevention and
 * recovery. Each lesson ends with where that work is done in ConstructHUB.
 *
 * The advice is general practice and Google's published Business Profile and review policies; no figure is
 * quoted that we cannot stand behind.
 */
import { AlertTriangle, BadgeCheck, Camera, CheckCircle2, Grid3x3, LifeBuoy, Lightbulb, MapPin, Newspaper, ShieldAlert, Star, Store } from "lucide-react";
import type { ModuleHomeProps } from "./module-home";
import { AppLink, InApp, ModuleHome } from "./module-home";
import { Lesson, type LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:gmb";

export const GMB_LESSONS: LessonMeta[] = [
  { id: "setup", title: "Claim, verify and set up the profile", icon: BadgeCheck },
  { id: "info", title: "Business information that matches everywhere", icon: MapPin },
  { id: "photos", title: "A photo strategy that shows the work", icon: Camera },
  { id: "reviews", title: "Reviews: asking the right way, answering every one", icon: Star },
  { id: "defense", title: "Fake reviews and competitor attacks", icon: ShieldAlert },
  { id: "posts", title: "Posting cadence and a content calendar", icon: Newspaper },
  { id: "suspension", title: "Suspension prevention and recovery", icon: LifeBuoy },
  { id: "measure", title: "Measuring where you rank", icon: Grid3x3 },
];

const Check = () => <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />;
const Warn = () => <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />;

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function Panel({ title, items, warn = false }: { title: string; items: string[]; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((t) => <li key={t} className="flex items-start gap-1.5">{warn ? <Warn /> : <Check />} {t}</li>)}
      </ul>
    </div>
  );
}

export function GmbModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.gmb === true;
  return (
    <ModuleHome {...p} title="GMB Setup & Optimization" icon={Store} unlocked={unlocked} lessons={GMB_LESSONS} storageKey={KEY}
      what="The Google Business Profile lessons" moduleTitle="GMB Setup & Optimization" badge={<UnlockBadge access={p.access} category="gmb" />}
      description="A Google Business Profile that earns the map-pack spot and survives what competitors and Google throw at it: setup, photos, reviews, posts, suspensions and how to measure it." testId="module-gmb">

    <Lesson id="setup" title="Claim, verify and set up the profile" icon={BadgeCheck} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        For most contractors the Google Business Profile is the first thing a homeowner sees and the only "website" many of them ever open. It is free, it ranks in the map pack above every paid ad, and it is governed by Google's Business Profile guidelines: one profile per real business location, in the real business name, with a verified owner. Get those three right before anything else.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Setting it up" items={[
          "Search for your business first: claim the existing listing rather than creating a second one",
          "Use the exact legal or trading name on your license and your trucks — no added keywords or cities",
          "Service-area business (you go to the customer): hide the address and set the service area instead",
          "Pick the primary category that names your trade; add secondary categories only for work you actually do",
          "List your services under each category and write the description in plain words about the work and the area",
        ]} />
        <Panel title="Verification" items={[
          "Google decides which methods it offers a given profile: video, phone, email, postcard or a live call",
          "Video verification is now the common path: be ready to film your signage, vehicles, tools and a proof of address",
          "Verify from a device signed in to the account that will keep owning the profile — an employee's personal Gmail is how businesses lose profiles",
          "Add a second owner (you, if an agency set it up) before you do anything else",
        ]} />
      </div>
      <Tip>
        <p><strong>Who owns the profile?</strong> Check Users in the profile today. If a former marketing company or employee is the primary owner, transfer it now while they still answer the phone. Recovering a profile from someone who has left takes weeks and is not always possible.</p>
      </Tip>
      <InApp>Add each profile as a location in <AppLink href="/locations">Locations</AppLink> and connect your Google account there; the rest of the course's Google tools work from those locations.</InApp>
    </Lesson>

    <Lesson id="info" title="Business information that matches everywhere" icon={MapPin} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Google cross-checks the name, address, phone number and hours on your profile against your website and every directory that lists you. Where they disagree, trust drops and so does the ranking; where they agree, nobody thinks about it. Decide the canonical version once and defend it.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Keep identical everywhere" items={[
          "Business name, exactly as filed and as on the license",
          "Address format (Suite vs Ste, St vs Street) — pick one spelling",
          "One primary phone number that you own, not a tracking number you may drop",
          "Website: the home page, or the city page for a multi-location profile",
          "Hours, including holiday hours set ahead of time",
        ]} />
        <Panel title="Fill in what competitors skip" items={[
          "Opening date, so Google can show how long you have been in business",
          "Attributes that apply: veteran-owned, women-owned, on-site estimates, and the accessibility ones",
          "Appointment or quote link to your contact page",
          "Questions & answers: ask and answer the questions customers call about (licensing, financing, service area)",
        ]} />
      </div>
      <Tip>
        <p><strong>Edits do not need your approval.</strong> Anyone can suggest a change to your hours, phone or category, and Google applies some of them. Check the profile monthly and watch it for changes — the next lessons cover both.</p>
      </Tip>
      <InApp><AppLink href="/locations">Locations</AppLink> keeps the canonical details for every business; <AppLink href="/listing-editor">Listing editor</AppLink> is where the Google profile's details are edited.</InApp>
    </Lesson>

    <Lesson id="photos" title="A photo strategy that shows the work" icon={Camera} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Photos are the part of the profile homeowners actually look at, and the part most contractors neglect after the first week. A profile with recent, real photos of jobs, crews and trucks reads as an active, local company; one with a logo and three stock images reads as a lead-gen front. Treat the photo section like a weekly habit, not a launch task.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="What to post" items={[
          "Finished jobs in daylight, with before-and-after pairs where you have them",
          "Your crew at work in branded shirts, your wrapped trucks, your shop or office",
          "The materials and brands you install, on the job rather than from the catalog",
          "The owner and the people who answer the phone — the faces a customer will meet",
        ]} />
        <Panel title="Habits" items={[
          "A few new photos every week beats fifty on launch day",
          "Take them with the location on and upload soon after the job; stale batches look staged",
          "Write the photo's caption or post text with the service and the city when the feature allows it",
          "Delete blurry, duplicate or off-brand photos; quality is what a browsing homeowner judges",
        ]} warn={false} />
      </div>
      <Tip>
        <p><strong>No promises about ranking.</strong> Photos help you get chosen once you are seen; they are not a ranking trick, and no filename or geotag changes where the profile shows up.</p>
      </Tip>
      <InApp>Queue photo batches on a schedule from <AppLink href="/gbp-content">Posts &amp; Photos</AppLink>; keep the originals in the <AppLink href="/media-library">Media Library</AppLink>.</InApp>
    </Lesson>

    <Lesson id="reviews" title="Reviews: asking the right way, answering every one" icon={Star} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Reviews decide the map pack more than any other thing you control, and they are the first thing a homeowner reads about you. The companies with hundreds of reviews did not get them by luck: they ask every single customer, the same way, within days of finishing, and they answer every review that comes in.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Asking" items={[
          "Ask every completed job, by text or email, with your direct review link — the day the job is done",
          "Ask in person first: 'If you're happy, a Google review helps us more than anything' — then send the link",
          "One polite reminder a week later; then stop",
          "Ask for honest feedback. Never ask only happy customers, never screen first, never offer anything for a review",
        ]} />
        <Panel title="Answering" items={[
          "Reply to every review within a few days, in the owner's voice, with the customer's name and the job",
          "A 5-star reply is short and specific; a bad review gets a calm, factual reply and an offer to fix it offline",
          "Never argue, never post private details, never reply angry — the reply is read by the next 100 homeowners, not by the reviewer",
          "Fix the problem first, then ask for an honest update — never a change of rating in exchange for anything",
        ]} />
      </div>
      <Tip>
        <p><strong>Incentives and gating break the rules.</strong> Google's review policy removes incentivised reviews and can suspend the profile, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews or suppressing negative ones. Same rule as the Reputation lesson in Module 1: resolve the dispute on its merits, keep the review request separate.</p>
      </Tip>
      <InApp><AppLink href="/google-reviews">Google Reviews</AppLink> sends the review requests and reminders from your templates, pulls the reviews in, and drafts replies for your approval with AI reply settings.</InApp>
    </Lesson>

    <Lesson id="defense" title="Fake reviews and competitor attacks" icon={ShieldAlert} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        A profile that ranks gets attacked: fake 1-star reviews from a competitor's circle, suggested edits that change your phone number or mark you closed, duplicate listings in your name, and spam profiles stuffed with keywords sitting above you. None of it is rare. Know what each one looks like and what Google actually offers to fix it.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Signs of an attack" warn items={[
          "A burst of 1-star reviews with no job details, from accounts with one review each",
          "Reviews naming a job, date or person you never had",
          "Your hours, phone, website or category changing without you",
          "A second listing with your name or a near-copy of it, or a competitor listed at your address",
        ]} />
        <Panel title="What to do" items={[
          "Report the review from the profile, then open a case in Google's review-management tool for business owners and keep the case number",
          "Reply publicly, briefly and calmly: 'We have no record of this job and have reported the review' — nothing more",
          "Reject wrong suggested edits and restore the right values; report duplicate and spam listings with Google's redressal form",
          "Document everything with dates and screenshots; if the attacker is identifiable, that record is what a lawyer needs",
        ]} />
      </div>
      <Tip>
        <p><strong>Never retaliate.</strong> Posting fake reviews on the attacker's profile, or asking friends to, is the one move that gets <em>your</em> profile suspended. Report, reply once, document, move on.</p>
      </Tip>
      <InApp>Profile Guard (in <AppLink href="/locations">Locations</AppLink>, per location) keeps an approved snapshot of your profile, watches for changes and can restore them, and its Report step assembles the evidence for Google's official form — you submit it yourself.</InApp>
    </Lesson>

    <Lesson id="posts" title="Posting cadence and a content calendar" icon={Newspaper} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Profile posts are short updates that show on your listing for a while and then roll off. They do not rank you, but they tell the homeowner comparing three profiles which company is alive this month — and they give you a reason to put new photos up. Decide a cadence you can keep for a year, then keep it.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="A calendar that holds up" items={[
          "One update a week: a finished job, a seasonal reminder, a team note or an offer",
          "Seasonal posts a month ahead (gutter season, storm season, year-end financing)",
          "Offers with real end dates, honored as written",
          "Events for anything public: home shows, open houses, community work",
        ]} />
        <Panel title="Writing them" items={[
          "Lead with the job and the town; one photo; one plain call to action",
          "Same facts as the website — no prices or claims you would not put on a quote",
          "Reuse the post on Facebook and Instagram, not the other way round",
          "Check the post went live; Google rejects some for words it reads as medical, financial or alcohol-related",
        ]} />
      </div>
      <InApp>Draft a month of posts, approve them and let <AppLink href="/gbp-content">Posts &amp; Photos</AppLink> publish on the cadence you set; <AppLink href="/social-media">Social Media</AppLink> sends the same updates to your other accounts.</InApp>
    </Lesson>

    <Lesson id="suspension" title="Suspension prevention and recovery" icon={LifeBuoy} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        A suspended profile disappears from Maps and Search overnight, and with it most of your calls. Suspensions are usually triggered by an edit Google's systems read as a guideline violation, and the fix is a reinstatement request with documents — not a new profile. Knowing the triggers avoids most of them.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Common triggers" warn items={[
          "Changing the name, address or category in a burst, or adding keywords to the name",
          "A virtual office, mailbox or home address with the address shown for a service-area business",
          "More than one profile for the same business, or a new profile after a suspension",
          "Hours, phone or website edits that no longer match your site and directories",
          "Being reported by a competitor while any of the above is true",
        ]} />
        <Panel title="Getting reinstated" items={[
          "Do not create a new profile; it will be suspended too and makes the appeal harder",
          "Fix what triggered it first (name, address visibility, duplicates) so the profile is compliant when reviewed",
          "Appeal through Google's reinstatement form once, with your business license, a utility bill or lease at the address and photos of permanent signage and vehicles",
          "One appeal at a time, answered factually; repeated or angry appeals slow it down",
        ]} />
      </div>
      <InApp>If your profile is suspended and you want help with the appeal, <AppLink href="/reinstatement">Reinstatement</AppLink> is where you ask us to review and take on the case.</InApp>
    </Lesson>

    <Lesson id="measure" title="Measuring where you rank" icon={Grid3x3} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Map rankings are local: the three businesses shown depend on where the searcher is standing. Checking from your own office tells you how you rank at your office. To know where you win and where you are invisible, check the same search from points across your service area and watch how that map changes month to month.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="What to watch" items={[
          "Your main service plus the city, from a grid of points across the area you sell in",
          "Calls, direction requests and website clicks in the profile's own Performance report",
          "Which competitor holds the spots you don't, and what their profile has that yours lacks",
          "Movement after a change — a new category, a photo push, a review month",
        ]} />
        <Panel title="What to change when it's flat" items={[
          "Reviews first: the gap between you and the leader is usually counted in reviews",
          "Then the primary category and the services list",
          "Then the city pages on your website that the profile links to",
          "Not the name, not the address — those changes are the suspension triggers above",
        ]} />
      </div>
      <InApp>The <AppLink href="/ranking-grid">GMB Ranking Grid</AppLink> scans a grid across your service area and shows your map rank at each point, so a change is measured instead of guessed.</InApp>
    </Lesson>
    </ModuleHome>
  );
}
