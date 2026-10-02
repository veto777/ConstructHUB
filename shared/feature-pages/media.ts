import type { FeaturePage } from "./types";

/**
 * Photo Optimizer (sidebar "Photo Optimizer", page "SEO Photo Optimizer", with the Media Library under it) — every
 * claim is backed by the code in `sources`:
 *   - find the business on Google (name or Maps link) to fill name, address and coordinates; templates and business
 *     info are saved in this browser: client/src/pages/photos.tsx (localStorage "gmb-photo-templates"),
 *     server/routes.ts /api/photos/business-search + /business-details
 *   - service-area discovery (cities, towns, neighborhoods, townships, counties) rotated through filenames,
 *     descriptions, EXIF tags and keywords: photos.tsx (Service Area Cities), server/routes.ts /api/photos/nearby-cities
 *     and /api/photos/process (rotatedArea)
 *   - up to 10 photos per batch; filename from company, service, area and keyword; EXIF artist, copyright, title,
 *     description, keywords and GPS from the business location; resized down to 4096 px; JPEG out:
 *     server/routes.ts /api/photos/process, server/photo-processor.ts (processPhoto, generateFileName)
 *   - watermark text or logo with opacity; brightness/contrast/saturation; auto-enhance; mirror flip:
 *     photo-processor.ts, server/routes.ts /api/photos/auto-enhance, photos.tsx
 *   - descriptions from templates (instant) or AI per photo from the facts you give (no image is sent):
 *     server/routes.ts /api/photos/generate-description
 *   - Google strips EXIF on upload → no ranking promise: photos.tsx and media-library.tsx copy
 *   - download one or all (zip), save to a Media Library folder: server/routes.ts /api/photos/download-all,
 *     /api/media/save-processed; Media Library folders with a client address, rename, download, delete:
 *     client/src/pages/media-library.tsx, server/routes.ts /api/media/*
 *   - every plan, fair use (no monthly count; the processing rate limit is the only cap):
 *     server/growth-quotas.ts METERS.photos, server/routes.ts growthCostLimit
 *   (Not claimed: media-library.tsx says direct uploads to a folder get the folder's GPS embedded, but
 *    POST /api/media/upload stores the file as uploaded — flagged in the report, left off this page.)
 */

const page: FeaturePage = {
  key: "media",
  slug: "media",
  group: "grow",
  status: "ready",
  title: "Photo Optimizer",
  kicker: "Job photos",
  headline: { lead: "Job Photos Named, Tagged and ", swipe: "Ready to Use" },
  lede:
    "Batch-process your job photos: add your watermark, give them clear keyword filenames, write descriptions and " +
    "photo details, then download them or keep them in Media Library folders.",
  hero: { mascot: "standing", bubble: "Drop in your job photos. I'll tidy them up." },
  steps: [
    {
      title: "Set up your business",
      body: "Find your business on Google to fill in its name, address and location, or load a template you saved.",
    },
    {
      title: "Pick services and areas",
      body: "Choose your category and keywords, and the nearby cities, towns or neighborhoods to work into each photo.",
    },
    {
      title: "Add photos and a watermark",
      body: "Upload up to 10 photos per batch, touch them up or auto-enhance them, and add a text or logo watermark.",
    },
    {
      title: "Process and keep",
      body: "Download the finished photos one by one or as a zip, or save them to a folder in your Media Library.",
    },
  ],
  cards: [
    {
      icon: "tag",
      title: "Keyword filenames",
      body: "Each photo gets a clear filename built from your company, the service, the area and a keyword, instead of a camera number.",
    },
    {
      icon: "file",
      title: "Photo details written in",
      body: "Title, description, keywords, author and copyright are written into each photo, with GPS coordinates from your business location.",
    },
    {
      icon: "map-pin",
      title: "Service areas, rotated",
      body: "Find the cities, towns, neighborhoods or counties around your address, and rotate them through the batch.",
    },
    {
      icon: "sparkles",
      title: "Descriptions",
      body: "Instant template descriptions, or AI-written ones for each photo from the business details you enter.",
    },
    {
      icon: "shield",
      title: "Your watermark",
      body: "Stamp your company name or logo on every photo, at the opacity you choose.",
    },
    {
      icon: "wrench",
      title: "Quick touch-ups",
      body: "Brightness, contrast and saturation per photo, one-click auto-enhance, and an optional mirror flip.",
    },
    {
      icon: "folder",
      title: "Media Library",
      body: "Folders per project with the client's address, where you can upload, rename, download and delete photos.",
    },
    {
      icon: "layers",
      title: "Saved templates",
      body: "Save your business info, category and keywords as a template in your browser and reuse it on the next batch.",
    },
  ],
  audience: [
    {
      title: "Contractors with a camera roll of jobs",
      body: "Turn phone photos into named, watermarked files you can post or send.",
    },
    {
      title: "Owners who share photos on many sites",
      body: "Your name and details travel with the file to the sites that keep photo details.",
    },
    {
      title: "Teams keeping photos by project",
      body: "One Media Library folder per job, with the client's address on it.",
    },
  ],
  pricing: {
    kind: "plan",
    note: "There's no monthly photo count; a processing rate limit keeps use fair.",
  },
  faqs: [
    {
      q: "Do geotags and keyword filenames help me rank on Google?",
      a: "We don't promise that. Google strips photo details when you upload to a Business Profile, so geotags and details are for your own files and for other sites that keep them.",
    },
    {
      q: "Which plans include it?",
      a: "Every plan, with no monthly photo count. You process up to 10 photos per batch, and a rate limit keeps processing fair for everyone.",
    },
    {
      q: "What do I need?",
      a: "Your job photos and your business's name and address. Finding your business on Google fills those in; you don't need to connect a Google account.",
    },
    {
      q: "Does it post the photos to Google for me?",
      a: "No. It prepares the files. To publish photos to your Business Profile on a schedule, use Posts & Photos.",
    },
  ],
  related: ["gbpContent", "gbp", "social"],
  app: { href: "/photos", surface: "app" },
  headings: {
    steps: { title: "A Batch of Photos in ", em: "Four\u00a0Steps" },
    cards: { title: "What Every Batch ", em: "Gets\u00a0You" },
    faq: { title: "Before You ", em: "Upload" },
  },
  seo: {
    title: "SEO Photo Optimizer for Contractor Job Photos | ConstructHUB",
    description:
      "Watermark job photos, give them keyword filenames, write descriptions, author and GPS details in one batch, and keep them in Media Library folders.",
  },
  sources: [
    "client/src/pages/photos.tsx",
    "client/src/pages/media-library.tsx",
    "server/photo-processor.ts",
    "server/growth-quotas.ts",
    "server/routes.ts",
  ],
};

export default page;
