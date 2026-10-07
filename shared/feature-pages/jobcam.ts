import type { FeaturePage } from "./types";
import { CRM_ADDONS, CRM_PLANS, CRM_PLAN_KEYS } from "../crm-plans";
import { JOBCAM_INCLUDED_GB, JOBCAM_STORAGE_TIERS_GB, formatJobcamTier } from "../jobcam-storage";
import { formatUsd, joinNames } from "../plan-copy";

/**
 * JobCam — job-site photos and video inside the CRM (/crm/jobcam on the portal host).
 *
 * Every claim below is backed by the code in `sources`:
 *   - the camera (photo + video, project pre-selected or nearest first, tags that stick, time + device GPS on
 *     every shot, library upload): client/src/pages/jobcam/capture.tsx
 *   - shots are queued on the device and sent in parts, resuming after a lost connection:
 *     client/src/lib/jobcam-queue.ts, server/jobcam/upload-state.ts
 *   - caps (photo size, video size and length) and accepted file types: server/jobcam/upload-state.ts LIMITS
 *   - thumbnails, a web-size copy, a poster frame and a browser-playable copy of phone video; time and place
 *     read from the file when it carries them: server/jobcam/processor.ts, server/jobcam/exif.ts
 *   - the feed (grid or day timeline, tags with all/any, starred, photos/videos, dates, search across projects,
 *     addresses, tags, people), bulk actions and the viewer: client/src/components/jobcam/feed.tsx, server/jobcam/routes.ts
 *   - who sees what (project visibility; the uploader or a manager may delete): server/jobcam/access.ts
 *   - share links (gallery or timeline, password, expiry, revoke, view count, sent by email or text):
 *     server/jobcam/share.ts, client/src/components/jobcam/share-dialog.tsx
 *   - "Show to client": the client portal lists only media a team member switched on: server/jobcam/routes.ts
 *     (portalMediaWhere), server/jobcam/portal-visibility.test.ts
 *   - storage sizes, the meter and "Request more storage": shared/jobcam-storage.ts, server/jobcam/usage.ts
 *   - how it is sold (CRM Max includes it; an add-on on the other CRM plans): shared/crm-plans.ts, server/jobcam/plan.ts
 * Not built, so not claimed: drawing on photos, voice or AI notes, reports, checklists.
 * Numbers that live in the price book are read from it, never typed.
 */

const ADDON = CRM_ADDONS.jobcam;
const INCLUDED_IN = joinNames(CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.jobcam).map((k) => CRM_PLANS[k].name));
const ADDON_ON = joinNames(ADDON.availableOn.map((k) => CRM_PLANS[k].name));
const INCLUDED_STORAGE = formatJobcamTier(JOBCAM_INCLUDED_GB);
const LARGER_SIZES = joinNames(JOBCAM_STORAGE_TIERS_GB.filter((t) => t > JOBCAM_INCLUDED_GB).map((t) => t.toLocaleString("en-US")));

const page: FeaturePage = {
  key: "jobcam",
  slug: "jobcam",
  group: "run",
  status: "ready",
  title: "JobCam",
  kicker: "Job-site photos and video",
  headline: { lead: "Every Job-Site Photo, Filed to ", swipe: "Its Job" },
  lede:
    "JobCam is the camera inside ConstructHub CRM. Your crew shoots photos and video on site, and each shot lands in " +
    "the right project with the time and place it was taken, ready to find, tag and share with the client.",
  hero: { mascot: "standing", bubble: "Got a photo of that flashing before it was covered?" },
  steps: [
    {
      title: "Open the camera",
      body: "On a phone, open JobCam and it picks the nearest job, or choose the project yourself.",
    },
    {
      title: "Shoot photos or video",
      body: "Every shot carries the time and the phone's location, plus the tags you set for that visit.",
    },
    {
      title: "It files itself",
      body: "Shots upload in the background into that project's feed, and pick up where they left off if the signal drops.",
    },
    {
      title: "Share what the client should see",
      body: "Send a link to a gallery or the job's timeline by email or text, or switch single shots on for the client portal.",
    },
  ],
  cards: [
    {
      icon: "camera",
      title: "A camera made for the job site",
      body: "Photo and video from the phone's browser or the ConstructHUB app, with a grid overlay, a flashlight toggle where the phone allows it, and upload from the phone's library.",
    },
    {
      icon: "map-pin",
      title: "Time and place on every shot",
      body: "Each photo and video keeps when it was taken and where. If the file carries its own time and location, JobCam reads those; otherwise it uses the phone's.",
    },
    {
      icon: "folder",
      title: "Filed by job",
      body: "Every shot belongs to a project and its client, so the project page, the client page and the company-wide feed all show the same record.",
    },
    {
      icon: "history",
      title: "A day-by-day timeline",
      body: "See a job as a grid or as a timeline grouped by day, newest first, with who took each shot.",
    },
    {
      icon: "tag",
      title: "Tags, stars and search",
      body: "Anyone on the crew can tag shots. Filter by tags, starred, photos or videos and dates, or search projects, addresses, tags and people across every job.",
    },
    {
      icon: "share",
      title: "Share links you control",
      body: "A link to a gallery of chosen shots or to the job's live timeline, with an optional password and expiry date. Revoke it any time, and see how often it was opened.",
    },
    {
      icon: "eye",
      title: "You decide what the client sees",
      body: "Nothing reaches the client portal until someone on your team switches a shot to Show to client.",
    },
    {
      icon: "database",
      title: "Storage with a clear meter",
      body: `${INCLUDED_STORAGE} of storage comes with JobCam, with a meter that shows how much is used. Larger sizes are available on request.`,
    },
  ],
  spotlight: {
    kicker: "On every shot",
    heading: { title: "What JobCam ", em: "Keeps" },
    points: [
      "The original file is kept as it was shot; smaller copies are made for fast viewing.",
      "Phone video is converted to a copy that plays in a browser when the original would not.",
      "Captions and tags can be edited later by the person who shot it or by a manager.",
      "Deleting a shot takes it out of every feed and frees its storage.",
    ],
    panel: {
      label: "Media record",
      title: "Fields on a shot",
      items: ["Project and client", "Taken at", "Location and its source", "Taken by", "Tags", "Caption", "Starred", "Show to client"],
      note: "Location shows only when the phone or the file supplied one.",
    },
  },
  audience: [
    {
      title: "Crews in the field",
      body: "Open the camera, shoot, move on. The shot is filed to the job without typing a name or picking a folder later.",
    },
    {
      title: "Owners and project managers",
      body: "See what happened on each job today from the office, and find the photo of a hidden condition months later.",
    },
    {
      title: "Offices that keep clients informed",
      body: "Send progress as a link or show chosen shots in the client portal, without texting photos from a personal phone.",
    },
  ],
  pricing: {
    kind: "crmAddon",
    addon: "jobcam",
    note: "JobCam is part of ConstructHub CRM, which is its own subscription, separate from the ConstructHUB platform plans.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A ConstructHub CRM workspace with JobCam on its plan, and at least one project to shoot into. The camera runs in the phone's browser and in the ConstructHUB app; it asks for camera access, and for location if you want the place recorded.",
    },
    {
      q: "Which plans include it?",
      a: `JobCam is part of ConstructHub CRM, not the ConstructHUB platform plans. It is included in ${INCLUDED_IN}. On ${ADDON_ON} it is an add-on at ${formatUsd(ADDON.monthlyCents)} a month, which the account owner adds to the CRM subscription.`,
    },
    {
      q: "How much storage do I get?",
      a: `${INCLUDED_STORAGE} comes with JobCam, counting the photos and videos and the smaller copies made of them. A meter shows what is used, and when it is full new uploads wait until you delete some or get more. Larger sizes (${LARGER_SIZES} GB) are set up on request: use Request more storage in JobCam.`,
    },
    {
      q: "Who on my team can see and delete photos?",
      a: "Anyone who can see a project can see and add to its JobCam feed, field crews included. A shot can be deleted by the person who took it or by someone whose role manages jobs or clients, and the same roles create share links.",
    },
    {
      q: "What doesn't it do?",
      a: "JobCam captures, files, finds and shares photos and video. It does not draw on photos, write notes or reports for you, or run checklists, and the camera needs a connection to send what it shot: shots wait on the phone until it has one.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // capture + queue: client/src/pages/jobcam/capture.tsx, client/src/lib/jobcam-queue.ts (IndexedDB queue, resumable parts);
  // caps and types: server/jobcam/upload-state.ts LIMITS, PHOTO_MIMES, VIDEO_MIMES; renditions and the browser-playable
  // video copy, time/place from the file: server/jobcam/processor.ts, server/jobcam/exif.ts; project visibility and
  // who may delete or share: server/jobcam/access.ts, server/jobcam/routes.ts; share links (kinds, password, expiry,
  // revoke, send by email/text): server/jobcam/share.ts; the portal's client_visible rule: server/jobcam/routes.ts
  // portalMediaWhere; storage sizes, the limit check on open and complete, the request: shared/jobcam-storage.ts,
  // server/jobcam/usage.ts, server/jobcam/routes.ts.
  inDepth: {
    heading: { title: "Job-Site Photo Documentation, ", em: "Explained" },
    paragraphs: [
      "JobCam is construction photo documentation built into ConstructHub CRM. Instead of job photos living in each " +
        "crew member's camera roll, every photo and video is taken into a project. The camera opens with the nearest " +
        "job already chosen when the phone knows where it is, using the project's own location or where its earlier " +
        "shots were taken, and a picker lists every other project the person is allowed to see.",
      "Each shot is saved on the phone first and then sent in pieces, so a weak signal on site does not lose it: the " +
        "upload carries on from the piece it reached. Photos can be JPEG, PNG, WebP or HEIC and video MP4, MOV or WebM, " +
        "each with a size cap, and video has a length cap. Once a file arrives, ConstructHUB makes a thumbnail and a " +
        "web-size copy, a poster frame for video, and a copy of phone video that plays in a browser when the original " +
        "would not. The original is kept untouched.",
      "Time and place come from the file itself when it has them and from the phone otherwise, and the record says " +
        "which. That is what makes job site photos useful later: you can pull up one project's timeline day by day, " +
        "filter by tag, or search every job by project name, address, tag or the person who took the shot. Team " +
        "access follows the CRM's project rules, so a field crew member sees the jobs they are on.",
      "Sharing is deliberate. A share link opens a gallery of the shots you picked or the job's live timeline on a " +
        "page that needs no account, and you can add a password, set an expiry date, send it by email or text from " +
        "the CRM, and revoke it. Separately, the client portal shows a homeowner only the shots someone on your team " +
        "switched to Show to client; everything else stays internal.",
      `Storage is metered per workspace. ${INCLUDED_STORAGE} is included, the meter turns to a warning as it fills, ` +
        "and at the limit new uploads are refused until space is freed or a larger size is set up for you. Nothing " +
        "already stored is removed.",
    ],
  },
  related: ["crm", "crmSchedule", "texting"],
  app: { href: "/crm/jobcam", surface: "portal", label: "Open JobCam" },
  headings: {
    steps: { title: "From the Job Site to the File in ", em: "Four Steps" },
    cards: { title: "What JobCam ", em: "Gives You" },
  },
  seo: {
    title: "Job-Site Photo & Video App for Contractors | ConstructHUB",
    description:
      "Take job-site photos and video with time and GPS, filed to each project. Tag, search, see a daily timeline, and share with clients by link.",
  },
  sources: [
    "client/src/pages/jobcam/capture.tsx",
    "client/src/pages/jobcam/index.tsx",
    "client/src/pages/jobcam/project.tsx",
    "client/src/pages/jobcam/share.tsx",
    "client/src/components/jobcam/feed.tsx",
    "client/src/components/jobcam/share-dialog.tsx",
    "client/src/components/jobcam/storage-meter.tsx",
    "client/src/lib/jobcam-queue.ts",
    "server/jobcam/routes.ts",
    "server/jobcam/upload-state.ts",
    "server/jobcam/processor.ts",
    "server/jobcam/exif.ts",
    "server/jobcam/access.ts",
    "server/jobcam/share.ts",
    "server/jobcam/usage.ts",
    "server/jobcam/plan.ts",
    "server/jobcam/portal-visibility.test.ts",
    "shared/jobcam-storage.ts",
    "shared/crm-plans.ts",
  ],
};

export default page;
