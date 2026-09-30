import { z } from "zod";
export const platforms = [
  "twitter",
  "facebook",
  "instagram",
  "linkedin",
  "threads",
  "bluesky",
  "tiktok",
  "youtube",
  "pinterest",
] as const;
// Conservative plain-text caps; provider still validates media and account-specific restrictions.
export const socialLimits: Record<string, number> = {
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  threads: 500,
  bluesky: 300,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
};
export const opaqueId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w-]+$/);
export const publicMediaUrl = z
  .string()
  .url()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.hostname.includes(":") &&
        !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
          u.hostname,
        ) &&
        u.hostname.includes(".") &&
        !/\.(local|internal)$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  }, "Use a public HTTPS media URL");
export const destinationSchema = z
  .object({
    accountId: opaqueId,
    platform: z.enum(platforms),
    pageId: opaqueId.optional(),
    boardId: opaqueId.optional(),
    title: z.string().max(100).optional(),
    privacy: z.enum(["public", "private", "unlisted"]).default("private"),
    tiktokPublic: z.boolean().default(false),
    isBrandedContent: z.boolean().default(false),
    isYourBrand: z.boolean().default(false),
  })
  .strict();
export type Destination = z.infer<typeof destinationSchema>;
export const postSchema = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(63206),
    destinations: z.array(destinationSchema).min(1).max(20),
    tweaks: z.record(z.string().max(63206)).default({}),
    mediaUrls: z.array(publicMediaUrl).max(10).default([]),
    scheduledTime: z.string().datetime({ offset: true }).optional(),
    draft: z.boolean().default(false),
  })
  .strict();
export const mixTypes = [
  "project",
  "tips",
  "reviews",
  "offers",
  "gbp",
] as const;
export const autoSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["approval", "automatic"]).default("approval"),
    destinations: z.array(destinationSchema).max(20).default([]),
    cadence: z.number().int().min(1).max(7).default(1),
    period: z.enum(["day", "week"]).default("week"),
    mix: z.array(z.enum(mixTypes)).min(1).max(5).default(["tips"]),
    instructions: z.string().max(4000).default(""),
    examples: z.string().max(4000).default(""),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      })
      .default("America/New_York"),
    blackoutStart: z.number().int().min(0).max(23).default(21),
    blackoutEnd: z.number().int().min(0).max(23).default(8),
    aiDailyBudget: z.number().int().min(0).max(20).default(3),
  })
  .strict()
  .refine(
    (v) => !v.enabled || v.destinations.length > 0,
    "Choose accounts before enabling auto mode",
  );
export type AutoSettings = z.infer<typeof autoSchema>;
export function inBlackout(settings: AutoSettings, now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: settings.timezone,
    }).format(now),
  );
  const { blackoutStart: s, blackoutEnd: e } = settings;
  return s === e
    ? false
    : s < e
      ? hour >= s && hour < e
      : hour >= s || hour < e;
}
export function postPayload(
  d: Destination,
  text: string,
  mediaUrls: string[],
  ai = false,
) {
  if (!text.trim()) throw new Error(`${d.platform}: post text is required`);
  if ([...text].length > socialLimits[d.platform])
    throw new Error(
      `${d.platform}: text exceeds ${socialLimits[d.platform]} characters`,
    );
  if (d.platform === "facebook" && !d.pageId)
    throw new Error("Facebook requires a Page");
  if (
    ["instagram", "tiktok", "youtube", "pinterest"].includes(d.platform) &&
    !mediaUrls.length
  )
    throw new Error(`${d.platform} requires media`);
  if (d.platform === "pinterest" && !d.boardId)
    throw new Error("Pinterest requires a board");
  if (d.platform === "youtube" && !d.title?.trim())
    throw new Error("YouTube requires a title");
  const target: Record<string, unknown> = { targetType: d.platform };
  if (d.pageId) target.pageId = d.pageId;
  if (d.platform === "pinterest")
    Object.assign(target, { boardId: d.boardId, title: d.title });
  if (
    d.platform === "facebook" &&
    mediaUrls.some((u) => /\.(mp4|mov)(\?|$)/i.test(u))
  )
    target.mediaType = "reel";
  if (d.platform === "youtube")
    Object.assign(target, {
      title: d.title,
      privacyStatus: d.privacy,
      shouldNotifySubscribers: false,
      isMadeForKids: false,
      containsSyntheticMedia: ai,
    });
  if (d.platform === "tiktok")
    Object.assign(target, {
      privacyLevel: d.tiktokPublic ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY",
      disabledComments: true,
      disabledDuet: true,
      disabledStitch: true,
      isBrandedContent: d.isBrandedContent,
      isYourBrand: d.isYourBrand,
      isAiGenerated: ai,
    });
  return {
    post: {
      accountId: d.accountId,
      content: { text, mediaUrls, platform: d.platform },
      target,
    },
  };
}
