/**
 * A person's own report from /report-issue ("Report an issue" in every footer):
 *
 *   POST /api/issues/report   { trying, happened, page?, impact, email?, website?, diagnostics, screenshot? }
 *     → 201 { id, reference: "#1234", status, screenshot: "saved" | "not_saved" | "none" } | 400 | 403 | 413 | 429
 *   GET  /api/issues/mine     → { account: { id, plan }, reports: MyIssueReport[] }   (signed in; 401 otherwise)
 *
 * Every report is its own ops_issues row (source "user", a random fingerprint:
 * never merged), status `new`, and the issue desk takes user reports before
 * anything the app captured itself (issues.ts DESK_ORDER_SQL). "I can't use
 * the site" is the pipeline's highest severity and rings the admins' bell at once.
 *
 * Works signed out (a person who cannot sign in must be able to say so), so:
 *   - signed out, an email is required — it is where the answer goes;
 *   - a honeypot field ("website") a person never sees: filled in → answered
 *     like a success, nothing stored;
 *   - rate limits per account, per IP and overall (in memory: one process serves the app);
 *   - a cross-site post is refused (Sec-Fetch-Site), like the browser error reports;
 *   - everything stored passes scrub.ts: the reporter's words, the page URL
 *     (no query string), the browser errors. The reply address lives in its
 *     own column and is never sent to the issue desk.
 *
 * The screenshot (an image, ≤ 5 MB) goes to R2 under issue-reports/ — a key the
 * public /api/files route cannot reach (it serves three-segment keys only) —
 * and only platform admins can open it. Without R2 it is not kept, and the
 * answer says so; nothing is ever written to local disk.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  PUBLIC_REPORT_STATUS_LABELS, USER_REPORT_IMPACTS, USER_REPORT_SEVERITY, publicReportStatus,
  type MyIssueReport, type OpsIssue, type UserReportImpact,
} from "@shared/ops-issues";
import { createUserReport, listUserReports, normalizePath } from "./issues";
import { summarizeUserAgent } from "./client-errors";
import { notifyAdminsOfBlockerReport } from "./digest";
import { scrubText } from "./scrub";
import type { Queryable } from "./schema";

export const USER_REPORT_PATH = "/api/issues/report";
/** A 5 MB image is ~6.7 MB as base64; the rest of the body is small. */
export const USER_REPORT_BODY_LIMIT = "8mb";
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  "image/gif": { ext: "gif", magic: (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")) },
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reportBody = z.object({
  trying: text(3, 300),
  happened: text(5, 5000),
  page: z.string().trim().max(500).optional().default(""),
  impact: z.enum(USER_REPORT_IMPACTS),
  email: z.string().trim().max(254).email().optional().or(z.literal("")),
  /** The honeypot: hidden from people, irresistible to form-filling bots. */
  website: z.string().max(500).optional(),
  diagnostics: z.object({
    url: z.string().max(2000).default(""),
    userAgent: z.string().max(600).default(""),
    viewport: z.object({ width: z.number().int().min(0).max(20_000), height: z.number().int().min(0).max(20_000) }).default({ width: 0, height: 0 }),
    language: z.string().max(40).optional(),
    timezone: z.string().max(80).optional(),
    time: z.string().max(40).default(""),
    recentErrors: z.array(z.object({
      kind: z.string().max(40).default("error"),
      message: z.string().max(1000),
      at: z.string().max(40).default(""),
      source: z.string().max(500).optional(),
    })).max(10).default([]),
  }).default({}),
  screenshot: z.object({ type: z.string().max(40), data: z.string().max(7_200_000) }).nullable().optional(),
});

type Limiter = { allow: (key: string, now: number) => boolean };
function windowLimiter(max: number, windowMs: number): Limiter {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return {
    allow(key, now) {
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + windowMs }); return true; }
      if (cur.n >= max) return false;
      cur.n++;
      return true;
    },
  };
}

export type UserReportUser = { id: number; email?: string | null };

export type UserReportOptions = {
  pool?: Queryable;
  /** The signed-in person, or null (default: the session's req.user — the person, not the workspace they act for). */
  currentUser?: (req: Request) => UserReportUser | null;
  /** Reports per account / per signed-out IP in `windowMs` (defaults 5 and 3 per 10 minutes), per account or IP per day (20), all together per hour (200). */
  perUser?: number;
  perIp?: number;
  windowMs?: number;
  perDay?: number;
  globalPerHour?: number;
  now?: () => number;
  /** Stores the screenshot, returns its key; null = no storage here (default: R2 when configured). */
  storeScreenshot?: ((buffer: Buffer, contentType: string, ext: string) => Promise<string>) | null;
  /** "pro (active)" — the account's plan as the subscriptions table has it (default: read it). */
  planOf?: (userId: number, q: Queryable) => Promise<string | null>;
  notifyBlocker?: typeof notifyAdminsOfBlockerReport;
};

async function defaultPlanOf(userId: number, q: Queryable): Promise<string | null> {
  try {
    const { rows: [s] } = await q.query(`SELECT plan, status FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [userId]);
    return s ? `${s.plan} (${s.status})` : null;
  } catch { return null; }
}

async function defaultStore(): Promise<UserReportOptions["storeScreenshot"]> {
  const r2 = await import("../r2");
  if (!r2.r2Configured()) return null;
  return (buffer, contentType, ext) => r2.uploadToR2(buffer, contentType, "issue-reports", ext);
}

/**
 * People type credentials into a problem report ("my password is …"). scrub.ts catches key formats, URLs and
 * query strings; this catches the sentence form before the text goes through it. The word stays, the value goes.
 */
const SAID_SECRET_RE = /\b(pass(?:word|code|phrase)?|pwd|passwd|secret|token|api[ _-]?key|otp|2fa code|verification code)\b(\s*(?:is|was|are|=|:)\s*)(?:(["'`])[^"'`\n]{1,120}\3|[^\s"'`,;]+)/gi;
export const withoutSaidSecrets = (s: string): string => s.replace(SAID_SECRET_RE, (_m, word: string, joiner: string) => `${word}${joiner}[redacted]`);

/** A page the reporter named: the path with its ids replaced, no query string, no origin. */
function reportedPage(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  try { return normalizePath(new URL(s, "https://constructhub.us").pathname); } catch { return scrubText(s, 200); }
}

export function toMyReport(i: OpsIssue): MyIssueReport {
  const status = publicReportStatus(i.status);
  const impact = (USER_REPORT_IMPACTS as readonly string[]).includes(String(i.detail?.impact)) ? (i.detail.impact as UserReportImpact) : "broken";
  return {
    id: i.id,
    trying: typeof i.detail?.trying === "string" ? i.detail.trying : i.title.replace(/^User report:\s*/, ""),
    impact, status, statusLabel: PUBLIC_REPORT_STATUS_LABELS[status],
    createdAt: i.firstSeen, reply: i.publicReply, repliedAt: i.publicReplyAt,
  };
}

export function registerUserReportRoutes(app: Express, opts: UserReportOptions = {}): void {
  const currentUser = opts.currentUser ?? ((req: Request) => ((req as any).user?.id ? ((req as any).user as UserReportUser) : null));
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const userLimit = windowLimiter(opts.perUser ?? 5, windowMs);
  const ipLimit = windowLimiter(opts.perIp ?? 3, windowMs);
  const dayLimit = windowLimiter(opts.perDay ?? 20, 86_400_000);
  const globalLimit = windowLimiter(opts.globalPerHour ?? 200, 3_600_000);
  const clock = opts.now ?? Date.now;
  const db = async (): Promise<Queryable> => opts.pool ?? (await import("../db")).pool;

  app.post(USER_REPORT_PATH, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const site = req.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return res.status(403).json({ message: "Send the report from the ConstructHUB page." });
    const parsed = reportBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = String(first?.path?.[0] ?? "");
      const message =
        field === "trying" ? "Tell us what you were trying to do (a few words is enough)." :
        field === "happened" ? "Tell us what happened instead." :
        field === "impact" ? "Choose how bad it is." :
        field === "email" ? "That email address doesn’t look right." :
        field === "screenshot" ? "The screenshot is too large (5 MB at most)." : "Something in the report couldn’t be read. Reload the page and try again.";
      return res.status(400).json({ message, field: field || undefined });
    }
    const body = { ...parsed.data, trying: withoutSaidSecrets(parsed.data.trying), happened: withoutSaidSecrets(parsed.data.happened) };
    // A bot filled the field no person can see: it hears "received", nothing is stored.
    if (body.website) return res.status(201).json({ id: null, reference: null, status: "received", screenshot: "none" });

    const user = currentUser(req);
    const email = (body.email || "").toLowerCase();
    if (!user && !email) return res.status(400).json({ message: "Add your email address so we can reply.", field: "email" });

    const now = clock();
    const who = user ? `u:${user.id}` : `ip:${String(req.ip || req.socket.remoteAddress || "unknown")}`;
    if (!(user ? userLimit : ipLimit).allow(who, now) || !dayLimit.allow(who, now) || !globalLimit.allow("all", now)) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ message: "That’s a lot of reports in a short time. Wait a few minutes and send it again — or email support@constructhub.us." });
    }

    try {
      const q = await db();
      // The screenshot: a real image of an allowed type, within the size cap, and only into R2.
      let screenshot: { key: string; type: string; bytes: number } | null = null;
      let screenshotResult: "saved" | "not_saved" | "none" = "none";
      if (body.screenshot) {
        const kind = IMAGE_TYPES[body.screenshot.type];
        const buffer = Buffer.from(body.screenshot.data.replace(/^data:[^,]*,/, ""), "base64");
        if (!kind || buffer.length < 12 || !kind.magic(buffer)) return res.status(400).json({ message: "The screenshot must be a PNG, JPEG, WebP or GIF image.", field: "screenshot" });
        if (buffer.length > SCREENSHOT_MAX_BYTES) return res.status(413).json({ message: "The screenshot is too large (5 MB at most).", field: "screenshot" });
        const store = opts.storeScreenshot === undefined ? await defaultStore() : opts.storeScreenshot;
        screenshotResult = "not_saved";
        if (store) {
          try {
            screenshot = { key: await store(buffer, body.screenshot.type, kind.ext), type: body.screenshot.type, bytes: buffer.length };
            screenshotResult = "saved";
          } catch (e) {
            console.warn(`[issues] screenshot not stored: ${scrubText((e as Error)?.message ?? e, 200)}`);
          }
        }
      }

      const d = body.diagnostics;
      const plan = user ? await (opts.planOf ?? defaultPlanOf)(user.id, q) : null;
      const issue = await createUserReport({
        title: `User report: ${body.trying}`,
        severity: USER_REPORT_SEVERITY[body.impact],
        reporterUserId: user?.id ?? null,
        // Where the answer goes: the address typed on the form, else the account's own.
        reporterEmail: email || (user?.email ? String(user.email).toLowerCase() : null),
        detail: {
          impact: body.impact,
          trying: body.trying,
          happened: body.happened,
          page: reportedPage(body.page),
          reporter: { signedIn: !!user, userId: user?.id ?? null, plan },
          diagnostics: {
            sentFrom: reportedPage(d.url),
            browser: summarizeUserAgent(d.userAgent || req.get("user-agent")),
            viewport: `${d.viewport.width}x${d.viewport.height}`,
            language: d.language ?? null,
            timezone: d.timezone ?? null,
            clientTime: d.time || null,
            recentErrors: d.recentErrors.map((e) => ({
              kind: e.kind, at: e.at, message: scrubText(e.message, 300),
              source: e.source ? e.source.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").slice(0, 200) : null,
            })),
          },
          screenshot,
        },
      }, q);
      if (body.impact === "blocker") await (opts.notifyBlocker ?? notifyAdminsOfBlockerReport)(issue, q);
      return res.status(201).json({ id: issue.id, reference: `#${issue.id}`, status: publicReportStatus(issue.status), screenshot: screenshotResult });
    } catch (e) {
      console.error("[issues] user report failed:", (e as Error)?.message ?? e);
      return res.status(500).json({ message: "We couldn’t save your report. Try again, or email support@constructhub.us." });
    }
  });

  app.get("/api/issues/mine", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const user = currentUser(req);
    if (!user) return res.status(401).json({ message: "Sign in to see your reports." });
    try {
      const q = await db();
      // `account` is exactly what a report from this person carries (the page shows it before they send).
      res.json({ account: { id: user.id, plan: await (opts.planOf ?? defaultPlanOf)(user.id, q) }, reports: (await listUserReports(user.id, q)).map(toMyReport) });
    } catch (e) {
      console.error("[issues] listing a user's reports failed:", (e as Error)?.message ?? e);
      res.status(500).json({ message: "Could not load your reports. Try again." });
    }
  });
}
