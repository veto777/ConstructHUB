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
        (!u.port || u.port === "443") &&
        !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) &&
        !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
          u.hostname,
        ) &&
        u.hostname.includes(".") &&
        !/\.(local|internal|localhost|home\.arpa)\.?$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  }, "Use a public HTTPS media URL");
export const tiktokPrivacyLevels = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export const destinationSchema = z
  .object({
    accountId: opaqueId,
    platform: z.enum(platforms),
    pageId: opaqueId.optional(),
    boardId: opaqueId.optional(),
    title: z.string().max(100).optional(),
    privacy: z.enum(["public", "private", "unlisted"]).default("private"),
    // TikTok (Content Sharing Guidelines, docs/social-apps/tiktok.md §5.2): who can view has NO default — "" until
    // the customer picks one of the creator's own options; comments / Duet / Stitch are off until ticked.
    tiktokPrivacy: z.enum(["", ...tiktokPrivacyLevels]).default(""),
    allowComment: z.boolean().default(false),
    allowDuet: z.boolean().default(false),
    allowStitch: z.boolean().default(false),
    isBrandedContent: z.boolean().default(false),
    isYourBrand: z.boolean().default(false),
    /** @deprecated The old "Publish publicly" checkbox, still read from stored settings, drafts and the public API. */
    tiktokPublic: z.boolean().optional(),
  })
  .strict();
/** The TikTok privacy level a destination chose, or "" when none was chosen (legacy `tiktokPublic` honoured). */
export function tiktokPrivacyOf(d: Pick<Destination, "tiktokPrivacy" | "tiktokPublic">): string {
  if (d.tiktokPrivacy) return d.tiktokPrivacy;
  return d.tiktokPublic === undefined ? "" : d.tiktokPublic ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
}
export type Destination = z.infer<typeof destinationSchema>;
export const postSchema = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(63206),
    destinations: z.array(destinationSchema).min(1).max(20).refine(
      (items) => new Set(items.map((d) => [d.accountId, d.pageId || "", d.boardId || ""].join(":"))).size === items.length,
      "Choose each destination only once",
    ),
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
  if (d.platform === "tiktok") {
    // The stored payload's field names; the native adapter (server/social/native-nets.ts tiktokPlan) reads the same ones.
    // No privacy chosen → no privacyLevel: the post can be a draft, but it is never sent with a guessed audience.
    const privacyLevel = tiktokPrivacyOf(d);
    if (d.isBrandedContent && privacyLevel === "SELF_ONLY")
      throw new Error("tiktok: Branded content visibility cannot be set to private.");
    Object.assign(target, {
      ...(privacyLevel ? { privacyLevel } : {}),
      disabledComments: !d.allowComment,
      disabledDuet: !d.allowDuet,
      disabledStitch: !d.allowStitch,
      isBrandedContent: !!d.isBrandedContent,
      isYourBrand: !!d.isYourBrand,
      isAiGenerated: ai,
    });
  }
  return {
    post: {
      accountId: d.accountId,
      content: { text, mediaUrls, platform: d.platform },
      target,
    },
  };
}
