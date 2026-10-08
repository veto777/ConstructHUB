/**
 * A customer's own YouTube channel, in Social Media (/social-media). Any
 * signed-in account — the same door as the rest of the Social Media tool,
 * which has no plan gate — and always the account's OWN data: every handler
 * passes the signed-in user's id to the store, and the store has no read
 * without one (customer-store.ts).
 *
 *   GET    /api/social/youtube/status              connected?, which channel, today's allowance
 *   GET    /api/social/youtube/connect             → Google consent (302; ?format=json answers { url })
 *   GET    /api/social/youtube/callback            ← Google; saves the connection or says why not, then → /social-media
 *   POST   /api/social/youtube/disconnect          revoke at Google + delete everything stored for this account
 *   GET    /api/social/youtube/videos              this account's videos and their upload status
 *   POST   /api/social/youtube/videos              open a file upload to our storage (multipart)
 *   GET    /api/social/youtube/videos/:id/parts/:n where to PUT part n (direct to R2, and the proxy)
 *   PUT    /api/social/youtube/videos/:id/parts/:n the proxy: part body through this API
 *   POST   /api/social/youtube/videos/:id/parts/:n record the ETag of a direct part
 *   POST   /api/social/youtube/videos/:id/complete file stored → ready
 *   POST   /api/social/youtube/videos/:id/publish  title, privacy, made-for-kids, certification → queued for the worker
 *   DELETE /api/social/youtube/videos/:id          remove the record and the stored file
 *
 * Living under /api/social puts these behind the agency middleware's closed
 * allowlist (server/agency/middleware.ts): an agency team member acting for an
 * owner gets 404 here — a channel grant is an account-wide credential and is
 * never delegated — and request bodies are never logged (server/request-log.ts).
 *
 * Same discipline as the admin connection (./routes.ts): the app's own Google
 * OAuth client, a random one-time state kept in the session and bound to the
 * user, Origin checked on every state-changing request, tokens encrypted at
 * rest. No response from these routes contains a token or a storage key.
 */
import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appConnectUrl, finishAppConnection } from "../app-connections";
import { logActivity } from "../account-events";
import { rateLimit } from "../growth-limits";
import { originOk } from "../hub/access";
import { oauthBaseUrl } from "../site-context";
import {
  CUSTOMER_SCOPES, YoutubeError, completeConnect, consentUrl, newPendingState, oauthErrorCode, stateMatches, type PendingState,
} from "./client";
import {
  VIDEO_PART_BYTES, CUSTOMER_VIDEO_MIMES, expectedPartBytes, handleOf, keyIsOwn, validateVideoFile, videoKey,
} from "./customer-media";
import { customerMessage, kickCustomerYoutubeWorker, purgeCustomerYoutube, removeStoredFile } from "./customer-service";
import {
  customerMaxBytes, customerStatus, dailyUsage, deleteVideo, getVideo, insertVideo, listVideos, markVideoReady, openFileCount, publicVideo,
  queueVideo, recordCustomerError, recordVideoPart, saveCustomerConnection, type VideoRow,
} from "./customer-store";

type CustomerPending = PendingState & { business: string | null };
declare module "express-session" {
  interface SessionData {
    youtubeCustomerOAuth?: CustomerPending;
  }
}

type GetUser = (req: any, res: any) => any;
export type CustomerYoutubeRouteOptions = { http?: typeof fetch };

export const CUSTOMER_YOUTUBE_CALLBACK_PATH = "/api/social/youtube/callback";
export const CUSTOMER_YOUTUBE_PAGE = "/social-media";
/** The redirect URI Google must have on file for customers — built exactly like the Search Console one. */
export const customerYoutubeRedirectUri = (req: Request): string => `${oauthBaseUrl(req)}${CUSTOMER_YOUTUBE_CALLBACK_PATH}`;
/** Files one account may have waiting in our storage at once. */
export const MAX_OPEN_FILES = 5;

const configured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const backPath = (business: string | null, result: "connected" | "failed") =>
  `${CUSTOMER_YOUTUBE_PAGE}?${business ? `business=${business}&` : ""}youtube=${result}`;

const noAngle = (s: string) => !/[<>]/.test(s);
/** YouTube counts a tag with a space as two characters longer (it is quoted), and the commas between tags. */
export const tagsLength = (tags: string[]): number => tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

/** What "Publish to YouTube" must send. The messages are written for the person filling in the form. */
export const publishInput = z.object({
  title: z.string({ required_error: "Enter a title." }).trim().min(1, "Enter a title.").max(100, "A title is at most 100 characters.").refine(noAngle, "A title cannot contain < or >."),
  description: z.string().max(5000, "A description is at most 5,000 characters.").refine(noAngle, "A description cannot contain < or >.")
    .refine((s) => Buffer.byteLength(s) <= 5000, "The description is too long for YouTube (accented letters and emoji count as more than one character).").default(""),
  tags: z.array(z.string().trim().min(1).max(60).refine((t) => noAngle(t) && !t.includes(","), "A tag cannot contain a comma, < or >.")).max(30, "Use at most 30 tags.")
    .refine((t) => tagsLength(t) <= 500, "Tags are limited to 500 characters in total.").default([]),
  privacy: z.enum(["public", "unlisted", "private"], { errorMap: () => ({ message: "Choose who can see the video: public, unlisted or private." }) }).default("private"),
  madeForKids: z.boolean({ required_error: "Answer whether the video is made for kids (yes or no).", invalid_type_error: "Answer whether the video is made for kids (yes or no)." }),
  certify: z.literal(true, { errorMap: () => ({ message: "Tick the box confirming the video follows YouTube's Community Guidelines and that you own the rights to it." }) }),
}).strict();

const fileInput = z.object({
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().max(100),
  bytes: z.number().int().positive(),
}).strict();

const cleanFileName = (name: string): string => (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 160) || "video";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function registerCustomerYoutubeRoutes(app: Express, auth: GetUser, opts: CustomerYoutubeRouteOptions = {}): void {
  const http = opts.http ?? fetch;
  const base = "/api/social/youtube";
  const gate = rateLimit("social-youtube", 40, 120);
  const storage = () => import("../jobcam/storage");

  /** The signed-in account, with the response already marked private. State-changing requests must come from our own pages. */
  const who = (req: Request, res: Response, write = false): { id: number } | null => {
    const user = auth(req, res);
    if (!user) return null;
    res.setHeader("Cache-Control", "private, no-store");
    if (write && !originOk(req)) { res.status(403).json({ message: "Forbidden" }); return null; }
    return user;
  };
  const oops = (res: Response, what: string, e: unknown) => {
    console.error(`[youtube] customer ${what} failed:`, (e as Error)?.message);
    if (!res.headersSent) res.status(500).json({ message: "That did not work. Try again." });
  };
  const remember = async (userId: number, code: string, message: string) => {
    try { await recordCustomerError(userId, code, message); } catch (e) { console.error("[youtube] could not save a customer's last error:", (e as Error)?.message); }
  };
  /** One of the caller's own videos in the given state, or the response is sent (404 for anyone else's id). */
  const ownVideo = async (req: Request, res: Response, userId: number, states?: VideoRow["state"][]): Promise<VideoRow | null> => {
    const id = String(req.params.id ?? "").toLowerCase();
    const v = UUID.test(id) ? await getVideo(userId, id) : null;
    if (!v || !keyIsOwn(v)) { res.status(404).json({ message: "Video not found" }); return null; }
    if (states && !states.includes(v.state)) { res.status(409).json({ message: "This video is past that step." }); return null; }
    return v;
  };
  const partNumber = (req: Request, v: VideoRow): number | null => {
    const n = Number(req.params.n);
    return Number.isInteger(n) && n >= 1 && n <= v.parts_total ? n : null;
  };

  app.get(`${base}/status`, async (req, res) => {
    const user = who(req, res); if (!user) return;
    try {
      const [s, usage] = await Promise.all([customerStatus(user.id), dailyUsage(user.id)]);
      res.json({
        configured: configured(),
        connected: s.connected,
        needsReconnect: s.needsReconnect,
        channel: s.connected ? { id: s.channelId, title: s.channelTitle, thumbnail: s.channelThumbnail, url: `https://www.youtube.com/channel/${s.channelId}` } : null,
        connectedAt: s.connectedAt,
        lastError: s.lastError,
        limits: {
          perDay: usage.customerCap,
          usedToday: usage.usedByCustomer,
          // The project's own numbers are not a customer's business; whether there is room today is.
          sharedLimitReached: usage.usedByProject >= usage.projectCap,
          maxBytes: customerMaxBytes(),
          maxWaitingFiles: MAX_OPEN_FILES,
          fileTypes: Object.values(CUSTOMER_VIDEO_MIMES),
        },
      });
    } catch (e) { oops(res, "status", e); }
  });

  app.get(`${base}/connect`, gate, async (req, res) => {
    const user = who(req, res); if (!user) return;
    const json = req.query.format === "json";
    if (!configured()) return void res.status(503).json({ message: customerMessage("not_configured") });
    try {
      const business = /^[1-9]\d{0,9}$/.test(String(req.query.business ?? "")) ? String(req.query.business) : null;
      const pending: CustomerPending = { ...newPendingState(user.id, customerYoutubeRedirectUri(req)), business };
      req.session.youtubeCustomerOAuth = pending;
      // In the iPhone app the consent opens in the system sheet (server/app-connections.ts); in a browser this is Google's URL unchanged.
      const url = await appConnectUrl(req, "youtube", consentUrl(pending.state, pending.redirect, CUSTOMER_SCOPES), backPath(business, "connected"));
      // Saved before leaving for Google, so the callback always finds it.
      req.session.save((err) => {
        if (err) return void res.status(500).json({ message: "Could not start the connection. Try again." });
        if (json) res.json({ url }); else res.redirect(url);
      });
    } catch (e) { oops(res, "connect", e); }
  });

  app.get(CUSTOMER_YOUTUBE_CALLBACK_PATH, async (req, res) => {
    const user = who(req, res); if (!user) return;
    const pending = req.session.youtubeCustomerOAuth;
    delete req.session.youtubeCustomerOAuth; // one use, whatever happens next
    const business = pending && typeof pending.business === "string" && /^[1-9]\d{0,9}$/.test(pending.business) ? pending.business : null;
    const back = (result: "connected" | "failed") => finishAppConnection(req, res, backPath(business, result));
    try {
      if (!stateMatches(pending, user.id, req.query.state)) {
        await remember(user.id, "state", customerMessage("state"));
        return void await back("failed");
      }
      if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
        const code = oauthErrorCode(req.query.error);
        await remember(user.id, code, customerMessage(code));
        return void await back("failed");
      }
      const done = await completeConnect({ code: req.query.code, redirectUri: pending.redirect, anyChannel: true }, http);
      await saveCustomerConnection(user.id, done);
      console.log(`[youtube] customer channel ${done.channelId} connected by user ${user.id}`);
      await logActivity(req, user.id, "youtube.connected", { channelId: done.channelId }).catch(() => undefined);
      await back("connected");
    } catch (e) {
      const known = e instanceof YoutubeError;
      if (!known) console.error("[youtube] customer callback failed:", (e as Error)?.message);
      await remember(user.id, known ? e.code : "exchange", known ? customerMessage(e.code) : "The connection could not be saved. Try connecting again.");
      if (!res.headersSent) await back("failed");
    }
  });

  app.post(`${base}/disconnect`, gate, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const r = await purgeCustomerYoutube(user.id, http);
      if (r.removed) {
        console.log(`[youtube] customer channel disconnected by user ${user.id} (revoked at Google: ${r.revokedAtGoogle})`);
        await logActivity(req, user.id, "youtube.disconnected").catch(() => undefined);
      }
      res.json({ disconnected: true, removed: r.removed, revokedAtGoogle: r.revokedAtGoogle, videosRemoved: r.videos });
    } catch (e) { oops(res, "disconnect", e); }
  });

  app.get(`${base}/videos`, async (req, res) => {
    const user = who(req, res); if (!user) return;
    try { res.json({ videos: (await listVideos(user.id)).map(publicVideo) }); } catch (e) { oops(res, "list", e); }
  });

  app.post(`${base}/videos`, gate, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const parsed = fileInput.safeParse(req.body ?? {});
      if (!parsed.success) return void res.status(400).json({ message: "Choose a video file." });
      const s = await customerStatus(user.id);
      if (!s.connected) return void res.status(409).json({ message: customerMessage("not_connected") });
      const verdict = validateVideoFile(parsed.data, customerMaxBytes());
      if (!verdict.ok) return void res.status(verdict.status).json({ message: verdict.message });
      if ((await openFileCount(user.id)) >= MAX_OPEN_FILES)
        return void res.status(429).json({ message: `You already have ${MAX_OPEN_FILES} videos waiting here. Publish or remove one first.` });
      const id = randomUUID();
      const key = videoKey(user.id, id, verdict.ext);
      const h = await (await storage()).createMultipart(key, verdict.mime, id);
      const v = await insertVideo({
        id, userId: user.id, fileName: cleanFileName(parsed.data.fileName), mime: verdict.mime, bytes: parsed.data.bytes,
        storageMode: h.mode, storageKey: key, storageUploadId: h.storageUploadId, partSize: VIDEO_PART_BYTES, partsTotal: verdict.partsTotal,
      });
      res.status(201).json({ video: publicVideo(v), partSize: v.part_size, partsTotal: v.parts_total });
    } catch (e) { oops(res, "open upload", e); }
  });

  app.get(`${base}/videos/:id/parts/:n`, async (req, res) => {
    const user = who(req, res); if (!user) return;
    try {
      const v = await ownVideo(req, res, user.id, ["receiving"]); if (!v) return;
      const n = partNumber(req, v);
      if (!n) return void res.status(400).json({ message: "Bad part number" });
      const proxyUrl = `${base}/videos/${v.id}/parts/${n}`;
      res.json({ n, url: (await (await storage()).directPartUrl(handleOf(v), n)) ?? proxyUrl, proxyUrl, bytes: expectedPartBytes(v, n) });
    } catch (e) { oops(res, "part target", e); }
  });

  // Proxy path: the part body comes through this API into storage (the only path in local mode, the fallback when a direct PUT is blocked).
  app.put(`${base}/videos/:id/parts/:n`, express.raw({ type: () => true, limit: VIDEO_PART_BYTES + 1024 * 1024 }), async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const v = await ownVideo(req, res, user.id, ["receiving"]); if (!v) return;
      const n = partNumber(req, v);
      if (!n) return void res.status(400).json({ message: "Bad part number" });
      const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length !== expectedPartBytes(v, n)) return void res.status(400).json({ message: `Part ${n} has the wrong size.` });
      const etag = await (await storage()).putPart(handleOf(v), v.id, n, body);
      res.json({ n, etag, partsDone: await recordVideoPart(user.id, v.id, n, etag) });
    } catch (e) { oops(res, "part upload", e); }
  });

  // Direct path: the browser PUT the part to R2 and hands over the ETag.
  app.post(`${base}/videos/:id/parts/:n`, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const v = await ownVideo(req, res, user.id, ["receiving"]); if (!v) return;
      const n = partNumber(req, v), etag = String(req.body?.etag ?? "").trim();
      if (!n || !etag || etag.length > 200) return void res.status(400).json({ message: "Bad part" });
      if (v.storage_mode !== "r2") return void res.status(400).json({ message: "Send the part body to this URL with PUT" });
      res.json({ n, etag, partsDone: await recordVideoPart(user.id, v.id, n, etag) });
    } catch (e) { oops(res, "part record", e); }
  });

  app.post(`${base}/videos/:id/complete`, gate, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const v = await ownVideo(req, res, user.id); if (!v) return;
      if (v.state !== "receiving") return void res.json({ video: publicVideo(v) }); // a repeated click
      const done = v.parts_done;
      const parts = Array.from({ length: v.parts_total }, (_, i) => ({ PartNumber: i + 1, ETag: done[String(i + 1)] }));
      if (parts.some((p) => !p.ETag)) return void res.status(409).json({ message: "The file did not arrive in full. Send it again." });
      const st = await storage();
      try { await st.completeMultipart(handleOf(v), v.id, parts); }
      catch (e) {
        // A retried complete after storage already assembled the object lands here; the size check below decides.
        if ((await st.objectSize(v.storage_key)) === null) {
          console.error("[youtube] customer upload could not be assembled:", (e as Error)?.message);
          return void res.status(502).json({ message: "Storage could not finish the upload. Send the file again." });
        }
      }
      // The announced size is what the cap was checked against, so the stored object must be exactly that.
      const size = await st.objectSize(v.storage_key);
      if (size !== v.bytes) {
        const gone = await deleteVideo(user.id, v.id);
        if (gone) await removeStoredFile({ ...gone, state: "ready" });
        return void res.status(409).json({ message: "The stored file does not match the one you chose. Send it again." });
      }
      await markVideoReady(user.id, v.id);
      res.json({ video: publicVideo({ ...v, state: "ready" }) });
    } catch (e) { oops(res, "complete", e); }
  });

  app.post(`${base}/videos/:id/publish`, gate, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const parsed = publishInput.safeParse(req.body ?? {});
      if (!parsed.success) return void res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the video's details." });
      const s = await customerStatus(user.id);
      if (!s.connected || !s.channelId) return void res.status(409).json({ code: "not_connected", message: customerMessage("not_connected") });
      if (s.needsReconnect) return void res.status(409).json({ code: "needs_reconnect", message: customerMessage("needs_reconnect") });
      const v = await ownVideo(req, res, user.id); if (!v) return;
      const { certify: _certified, ...meta } = parsed.data;
      const r = await queueVideo(user.id, v.id, { ...meta, channelId: s.channelId, channelTitle: s.channelTitle ?? "" });
      if (!r.ok) {
        if (r.reason === "not_ready")
          return void res.status(409).json({ code: r.reason, message: "This video cannot be sent from here any more. Choose the file again." });
        const usage = await dailyUsage(user.id);
        return void res.status(429).json({
          code: r.reason,
          message: r.reason === "customer_cap"
            ? `Daily limit reached: ${usage.customerCap} videos per day for each account. Try again tomorrow (the day resets at midnight Pacific time).`
            : "ConstructHUB's shared YouTube allowance for today is used up. Try again tomorrow (it resets at midnight Pacific time).",
        });
      }
      await logActivity(req, user.id, "youtube.video_queued", { videoId: v.id }).catch(() => undefined);
      kickCustomerYoutubeWorker();
      res.status(202).json({ video: publicVideo(r.video) });
    } catch (e) { oops(res, "publish", e); }
  });

  app.delete(`${base}/videos/:id`, gate, async (req, res) => {
    const user = who(req, res, true); if (!user) return;
    try {
      const v = await ownVideo(req, res, user.id); if (!v) return;
      const gone = await deleteVideo(user.id, v.id);
      if (!gone) return void res.status(409).json({ message: "This video is being sent to YouTube right now. Wait for it to finish." });
      await removeStoredFile(gone);
      res.json({ removed: true });
    } catch (e) { oops(res, "remove", e); }
  });
}
