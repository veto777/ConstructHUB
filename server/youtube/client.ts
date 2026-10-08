/**
 * YouTube Data API v3 + YouTube Analytics API, with plain fetch (no SDK).
 *
 * Everything here is pure with respect to the database: tokens come from and
 * go to a `YoutubeStore` (server/youtube/store.ts is the Postgres one, tests
 * pass a fake), and every network call goes through the `http` passed in, so
 * the unit tests never reach Google.
 *
 * Two kinds of connection use this one library, each through its own store:
 *   - the SITE connection: the company channel (YOUTUBE_CHANNEL_ID), made once
 *     by a platform admin on /admin/youtube (server/youtube/routes.ts);
 *   - a CUSTOMER connection: a customer's own channel, one per account, made in
 *     Social Media (server/youtube/customer-routes.ts) with fewer scopes
 *     (CUSTOMER_SCOPES) and no expected channel (`anyChannel`).
 * Both go through the app's existing Google OAuth client (GOOGLE_CLIENT_ID /
 * _SECRET — the same one Google sign-in and the Search Console connect use).
 *
 * No function logs or returns a token; errors carry a short code and a
 * message that never includes Google's response body verbatim.
 */
import { open, readFile, stat } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const YT_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YT_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YT_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
/**
 * Managing captions and playlists is NOT covered by youtube.upload: Google's
 * captions.insert, playlists.insert and playlistItems.insert accept only
 * youtube.force-ssl (or the broader youtube / youtubepartner scopes). It is
 * not requested by default — it also allows editing and deleting the
 * channel's videos — so uploadCaption() and addToPlaylist() refuse with a
 * clear message until the owner opts in with YOUTUBE_EXTRA_SCOPES and reconnects.
 */
export const YT_FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const YT_MANAGE_SCOPES = [YT_FORCE_SSL_SCOPE, "https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtubepartner"];

export const DEFAULT_YOUTUBE_CHANNEL_ID = "UCRsxhhzhirrQCnqETChhyFw";
export const expectedChannelId = (): string => (process.env.YOUTUBE_CHANNEL_ID || "").trim() || DEFAULT_YOUTUBE_CHANNEL_ID;

/** The scopes one consent asks for: upload + read-back + analytics, plus any the owner opted into. */
export function requestedScopes(): string[] {
  const extra = (process.env.YOUTUBE_EXTRA_SCOPES || "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https:\/\/www\.googleapis\.com\/auth\/[a-z.-]+$/.test(s));
  return [...new Set([YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_ANALYTICS_SCOPE, ...extra])];
}

/** What a customer's consent asks for: upload the videos they choose and read back which channel it is. Nothing else. */
export const CUSTOMER_SCOPES: readonly string[] = [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";
const TIMEOUT_MS = 20_000;
/** One resumable chunk: a multiple of 256 KiB, as the protocol requires for every chunk but the last. */
export const UPLOAD_CHUNK_BYTES = 32 * 256 * 1024;

export type YoutubeErrorCode =
  | "not_configured" | "not_connected" | "needs_reconnect" | "state" | "denied" | "redirect_uri" | "scope"
  | "exchange" | "no_refresh_token" | "no_channel" | "wrong_channel" | "missing_scope" | "quota" | "request" | "upload";

export class YoutubeError extends Error {
  constructor(public code: YoutubeErrorCode, message: string, public status = 502, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "YoutubeError";
  }
}

/** The stored connection as the library needs it (tokens already decrypted by the store). */
export type YoutubeGrant = {
  channelId: string;
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  needsReconnect: boolean;
};
export type YoutubeStore = {
  load(): Promise<YoutubeGrant | null>;
  /** After a refresh: the new access token (and a rotated refresh token, when Google sends one). */
  saveAccess(t: { accessToken: string; expiresAt: Date; refreshToken?: string | null }): Promise<void>;
  /** Google refused the refresh token: uploads stop until an admin connects again. */
  markNeedsReconnect(reason: string): Promise<void>;
};
export type Deps = { store: YoutubeStore; http?: typeof fetch; now?: () => number; /** Base wait before re-asking an interrupted upload (tests pass 0). */ retryDelayMs?: number };

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new YoutubeError("not_configured", "Google OAuth is not configured", 503);
  return { id, secret };
}

/* ── OAuth: state, consent URL, code exchange ─────────────────────────────── */

export type PendingState = { state: string; userId: number; expires: number; redirect: string };
export const STATE_TTL_MS = 10 * 60 * 1000;

export function newPendingState(userId: number, redirect: string, now = Date.now()): PendingState {
  return { state: randomBytes(32).toString("hex"), userId, expires: now + STATE_TTL_MS, redirect };
}

/**
 * Is this callback the answer to the consent this admin's session started?
 * The pending record lives in the session (so it is bound to that browser and
 * that signed-in admin) and the route deletes it before checking, so a state
 * works once.
 */
export function stateMatches(pending: PendingState | undefined | null, userId: number, state: unknown, now = Date.now()): pending is PendingState {
  if (!pending || typeof state !== "string" || !state) return false;
  if (pending.userId !== userId || pending.expires < now) return false;
  const a = Buffer.from(pending.state), b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function consentUrl(state: string, redirectUri: string, scopes: readonly string[] = requestedScopes()): string {
  const q = new URLSearchParams({
    client_id: clientCreds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "false",
    prompt: "consent select_account",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

const scopeList = (scope: unknown): string[] => String(scope ?? "").split(/\s+/).filter(Boolean);

/** Google's OAuth error → our code. redirect_uri / scope problems are the two an admin can fix in the Cloud console. */
export function oauthErrorCode(error: unknown): YoutubeErrorCode {
  const e = String(error ?? "");
  if (e === "redirect_uri_mismatch") return "redirect_uri";
  if (e === "invalid_scope") return "scope";
  if (e === "access_denied") return "denied";
  return "exchange";
}

export type CompletedConnect = {
  channelId: string;
  channelTitle: string;
  /** Customer flow only: the channel's small picture as Google returned it (null when it sent none). */
  channelThumbnail?: string | null;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
};

/**
 * The callback's work, without Express or the database: exchange the code,
 * ask Google which channel was authorised, and refuse anything but the
 * expected channel. A Google account can own several channels and brand
 * accounts, and the consent screen makes the person pick one — picking the
 * personal one by mistake must not connect it.
 *
 * youtube.upload is required. youtube.readonly is what lets us read the
 * channel back, so without it the check cannot pass. The analytics scope is
 * optional: the returned `scopes` say what was really granted.
 *
 * `anyChannel` is the customer flow: there is no expected channel, so the
 * channel of the account that was picked is the one connected (the caller
 * shows the customer which one that was).
 */
export async function completeConnect(
  input: { code: string; redirectUri: string; expected?: string; anyChannel?: boolean },
  http: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<CompletedConnect> {
  const { id, secret } = clientCreds();
  const expected = input.expected ?? expectedChannelId();
  let r: Response, t: any;
  try {
    r = await http(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code: input.code, redirect_uri: input.redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    t = await r.json();
  } catch {
    throw new YoutubeError("exchange", "Google did not answer the sign-in exchange. Try connecting again.");
  }
  if (!r.ok || !t?.access_token) {
    const code = oauthErrorCode(t?.error);
    throw new YoutubeError(code, code === "redirect_uri"
      ? "Google rejected the redirect URI. Add the exact URI shown on this page to the OAuth client's Authorized redirect URIs."
      : code === "scope"
        ? "Google rejected the requested scopes. Add them under Google Auth Platform → Data access."
        : "Google refused the sign-in exchange. Try connecting again.", 400);
  }
  const scopes = scopeList(t.scope);
  if (!scopes.includes(YT_UPLOAD_SCOPE))
    throw new YoutubeError("scope", "Google did not grant permission to upload videos. Connect again and leave the upload permission ticked.", 400);
  if (!t.refresh_token)
    throw new YoutubeError("no_refresh_token", "Google did not return a long-lived token. Connect again.", 400);

  let c: Response, d: any;
  try {
    c = await http(`${API}/channels?part=id%2Csnippet&mine=true&maxResults=50`, {
      headers: { Authorization: `Bearer ${t.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    d = await c.json();
  } catch {
    throw new YoutubeError("request", "Could not read back which channel was authorised. Try connecting again.");
  }
  if (!c.ok)
    throw new YoutubeError(scopes.includes(YT_READONLY_SCOPE) ? "request" : "scope",
      scopes.includes(YT_READONLY_SCOPE)
        ? "Could not read back which channel was authorised. Check that YouTube Data API v3 is enabled, then connect again."
        : "Google did not grant permission to see the channel, so it could not be checked. Connect again and leave every permission ticked.", 400);
  const items: any[] = Array.isArray(d?.items) ? d.items : [];
  if (!items.length)
    throw new YoutubeError("no_channel", "The Google account that was picked has no YouTube channel. Connect again and pick the Construct HUB channel.", 400);
  const match = input.anyChannel ? items.find((i) => typeof i?.id === "string" && i.id) : items.find((i) => i?.id === expected);
  if (!match && input.anyChannel)
    throw new YoutubeError("no_channel", "The Google account that was picked has no YouTube channel.", 400);
  if (!match) {
    const picked = items.map((i) => ({ id: String(i?.id ?? ""), title: String(i?.snippet?.title ?? "") }));
    const names = picked.map((p) => `"${p.title || "untitled"}" (${p.id})`).join(", ");
    throw new YoutubeError("wrong_channel",
      `The channel that was picked is ${names}, not the company channel (${expected}). Nothing was connected. Connect again and pick the Construct HUB channel when Google asks which account or channel.`,
      400, { picked, expected });
  }
  const thumb = match.snippet?.thumbnails?.default?.url;
  return {
    channelId: String(match.id),
    channelTitle: String(match.snippet?.title ?? ""),
    ...(input.anyChannel ? { channelThumbnail: typeof thumb === "string" && /^https:\/\/[a-z0-9.-]+\.(ggpht|googleusercontent)\.com\//i.test(thumb) ? thumb : null } : {}),
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    expiresAt: new Date(now() + Number(t.expires_in || 3600) * 1000),
    scopes,
  };
}

/** Tell Google to forget the grant. True when Google confirmed (or the token was already dead). */
export async function revokeToken(token: string, http: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await http(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.ok || r.status === 400; // 400 invalid_token: nothing left to revoke
  } catch {
    return false;
  }
}

/* ── Access token ─────────────────────────────────────────────────────────── */

/**
 * A usable access token for the connected channel, refreshed on demand.
 * `invalid_grant` (the owner removed the app's access, or the grant expired)
 * marks the connection as needing a reconnect and stops there.
 */
export async function getYoutubeAccessToken(deps: Deps): Promise<string> {
  const http = deps.http ?? fetch, now = deps.now ?? Date.now;
  const g = await deps.store.load();
  if (!g || !g.refreshToken) throw new YoutubeError("not_connected", "The YouTube channel is not connected. Connect it on /admin/youtube.", 409);
  if (g.needsReconnect) throw new YoutubeError("needs_reconnect", "The YouTube connection has expired. Reconnect it on /admin/youtube.", 401);
  if (g.accessToken && g.expiresAt && g.expiresAt.getTime() > now() + 60_000) return g.accessToken;
  const { id, secret } = clientCreds();
  let r: Response, t: any;
  try {
    r = await http(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: g.refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    t = await r.json();
  } catch {
    throw new YoutubeError("request", "YouTube token refresh is unavailable right now. Try again.");
  }
  if (t?.error === "invalid_grant") {
    await deps.store.markNeedsReconnect("Google no longer accepts the saved sign-in (invalid_grant).");
    throw new YoutubeError("needs_reconnect", "The YouTube connection has expired. Reconnect it on /admin/youtube.", 401);
  }
  if (!r.ok || !t?.access_token) throw new YoutubeError("request", "YouTube token refresh was refused. Try again.");
  await deps.store.saveAccess({
    accessToken: t.access_token,
    expiresAt: new Date(now() + Number(t.expires_in || 3600) * 1000),
    refreshToken: t.refresh_token ?? null,
  });
  return t.access_token;
}

async function grantedScopes(deps: Deps): Promise<string[]> {
  return (await deps.store.load())?.scopes ?? [];
}

/** One authorised JSON call. Google's body is read for its reason only; it is never echoed. */
async function call(deps: Deps, url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<{ r: Response; d: any }> {
  const http = deps.http ?? fetch;
  const token = await getYoutubeAccessToken(deps);
  let r: Response, d: any;
  try {
    r = await http(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) });
    const raw = await r.text();
    d = raw ? JSON.parse(raw) : {};
  } catch {
    throw new YoutubeError("request", "YouTube request failed");
  }
  if (!r.ok && r.status !== 308) throw apiError(r.status, d);
  return { r, d };
}

function apiError(status: number, d: any): YoutubeError {
  const reason = String(d?.error?.errors?.[0]?.reason ?? d?.error?.status ?? "");
  if (status === 401) return new YoutubeError("needs_reconnect", "YouTube rejected the sign-in. Reconnect it on /admin/youtube.", 401);
  if (status === 403 && /quota|rateLimit|uploadLimit/i.test(reason))
    return new YoutubeError("quota", "YouTube's daily limit for this app is used up. Try again after midnight Pacific time.", 429, { reason });
  if (status === 403 && /insufficient/i.test(reason))
    return new YoutubeError("missing_scope", "The connection does not include the permission this needs. Reconnect on /admin/youtube.", 403, { reason });
  return new YoutubeError("request", `YouTube rejected the request (${status}${/^[A-Za-z_.]{1,60}$/.test(reason) ? ` ${reason}` : ""})`, status >= 500 ? 502 : 400, { reason, httpStatus: status });
}

/* ── Upload (resumable protocol) ──────────────────────────────────────────── */

/**
 * Where the bytes come from when they are not a local file: a size and a way
 * to read one byte range at a time. The uploader asks for one chunk
 * (UPLOAD_CHUNK_BYTES) and sends it before asking for the next, so a video in
 * object storage is never held in memory whole.
 */
export type VideoSource = { size: number; read(offset: number, length: number): Promise<Buffer> };

export type UploadVideoInput = {
  /** A local file… */
  filePath?: string;
  /** …or a ranged reader (object storage). Exactly one of the two. */
  source?: VideoSource;
  /** Called after each chunk YouTube confirmed, with the bytes stored so far. */
  onProgress?: (sentBytes: number, totalBytes: number) => void | Promise<void>;
  title: string;
  description?: string;
  tags?: string[];
  /** YouTube category id; 27 = Education, 28 = Science & Technology (default), 26 = Howto & Style. */
  categoryId?: string;
  /** Defaults to "private". An app that has not passed YouTube's API audit gets its uploads locked private anyway. */
  privacyStatus?: "private" | "unlisted" | "public";
  madeForKids?: boolean;
  defaultLanguage?: string;
  /**
   * Scheduled publishing: an ISO date-time at least PUBLISH_AT_MIN_LEAD_MS ahead. YouTube accepts
   * `status.publishAt` only on a PRIVATE video that has never been published, and makes it public
   * itself at that time — so with this set the request always says "private", whatever
   * `privacyStatus` asks for. Sent as RFC 3339 in UTC.
   */
  publishAt?: string;
  /**
   * YouTube's altered-or-synthetic-content disclosure (`status.containsSyntheticMedia`, settable in
   * videos.insert). Sent only when given: the tutorials leave it out; the AI-generated gator shorts
   * (scripts/gator) send `true`.
   */
  containsSyntheticMedia?: boolean;
};

/** A scheduled time closer than this is refused: the upload and YouTube's processing have to finish first. */
export const PUBLISH_AT_MIN_LEAD_MS = 15 * 60 * 1000;

/** A publish time as YouTube wants it (RFC 3339, UTC, whole seconds) — or a refusal when it is not a time or is too soon. */
export function normalizePublishAt(publishAt: string, now: number = Date.now()): string {
  const t = typeof publishAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(publishAt) ? Date.parse(publishAt) : NaN;
  if (!Number.isFinite(t)) throw new YoutubeError("request", "The publish time must be an ISO date-time with a time zone (2026-10-09T13:00:00Z)", 400);
  if (t < now) throw new YoutubeError("request", "The publish time is in the past", 400);
  if (t < now + PUBLISH_AT_MIN_LEAD_MS) throw new YoutubeError("request", "The publish time must be at least 15 minutes ahead", 400);
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** The metadata request that opens a resumable upload session (exported for the tests). */
export function uploadSessionRequest(input: UploadVideoInput, size: number, now: number = Date.now()): { url: string; headers: Record<string, string>; body: any } {
  const title = input.title.trim();
  if (!title || title.length > 100 || /[<>]/.test(title)) throw new YoutubeError("upload", "A video title is 1–100 characters, without < or >", 400);
  const description = input.description ?? "";
  if (Buffer.byteLength(description) > 5000 || /[<>]/.test(description)) throw new YoutubeError("upload", "A video description is at most 5,000 bytes, without < or >", 400);
  const snippet: Record<string, unknown> = { title, description, categoryId: input.categoryId ?? "28" };
  if (input.tags?.length) snippet.tags = input.tags;
  if (input.defaultLanguage) { snippet.defaultLanguage = input.defaultLanguage; snippet.defaultAudioLanguage = input.defaultLanguage; }
  return {
    url: `${UPLOAD_API}/videos?uploadType=resumable&part=snippet%2Cstatus`,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/*",
    },
    body: {
      snippet,
      status: {
        ...(input.publishAt !== undefined
          ? { privacyStatus: "private", publishAt: normalizePublishAt(input.publishAt, now), selfDeclaredMadeForKids: input.madeForKids ?? false }
          : { privacyStatus: input.privacyStatus ?? "private", selfDeclaredMadeForKids: input.madeForKids ?? false }),
        ...(input.containsSyntheticMedia !== undefined ? { containsSyntheticMedia: input.containsSyntheticMedia } : {}),
      },
    },
  };
}

/** `publishAt` is present only when YouTube's answer carried one (a scheduled upload). */
export type UploadedVideo = { videoId: string; privacyStatus: string | null; uploadStatus: string | null; publishAt?: string };
const uploaded = (d: any): UploadedVideo => ({
  videoId: String(d.id), privacyStatus: d.status?.privacyStatus ?? null, uploadStatus: d.status?.uploadStatus ?? null,
  ...(typeof d.status?.publishAt === "string" ? { publishAt: d.status.publishAt } : {}),
});

/**
 * Upload one video file. Returns the new video's id and the privacy status
 * YouTube actually gave it (which can be "private" whatever was asked for).
 * With `publishAt` the video is uploaded private and YouTube publishes it at
 * that time (videos.insert — covered by youtube.upload, scheduled or not).
 */
export async function uploadVideo(input: UploadVideoInput, deps: Deps): Promise<UploadedVideo> {
  const http = deps.http ?? fetch;
  if (!input.source === !input.filePath) throw new YoutubeError("upload", "Give the video as a file path or as a source, not both", 400);
  const file = input.source ? null : await open(input.filePath!, "r");
  try {
    const size = input.source ? input.source.size : (await stat(input.filePath!)).size;
    if (!Number.isSafeInteger(size) || size <= 0) throw new YoutubeError("upload", "The video file is empty", 400);
    const readChunk = async (offset: number, length: number): Promise<Buffer> => {
      if (input.source) {
        const got = await input.source.read(offset, length);
        if (got.length !== length) throw new YoutubeError("upload", "The stored video could not be read in full", 502);
        return got;
      }
      const chunk = Buffer.alloc(length);
      await file!.read(chunk, 0, length, offset);
      return chunk;
    };
    return await sendVideo(input, size, readChunk, deps, http);
  } finally {
    await file?.close();
  }
}

async function sendVideo(
  input: UploadVideoInput, size: number, readChunk: (offset: number, length: number) => Promise<Buffer>, deps: Deps, http: typeof fetch,
): Promise<UploadedVideo> {
  const session = uploadSessionRequest(input, size, (deps.now ?? Date.now)());
  const { r: opened } = await call(deps, session.url, { method: "POST", headers: session.headers, body: JSON.stringify(session.body) });
  const location = opened.headers.get("location");
  if (!location || !location.startsWith("https://www.googleapis.com/")) throw new YoutubeError("upload", "YouTube did not open an upload session");

  {
    let offset = 0, failures = 0;
    for (;;) {
      const length = Math.min(UPLOAD_CHUNK_BYTES, size - offset);
      const chunk = await readChunk(offset, length);
      let r: Response;
      try {
        // The session URI is the credential for the bytes; the bearer token is sent as well, as Google's clients do.
        r = await http(location, {
          method: "PUT",
          headers: { Authorization: `Bearer ${await getYoutubeAccessToken(deps)}`, "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}` },
          body: chunk,
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
      } catch {
        r = new Response(null, { status: 503 });
      }
      if (r.status === 200 || r.status === 201) {
        const d: any = await r.json().catch(() => ({}));
        if (!d?.id) throw new YoutubeError("upload", "YouTube accepted the file but returned no video id");
        return uploaded(d);
      }
      if (r.status === 308) { offset = nextOffset(r); failures = 0; await input.onProgress?.(offset, size); continue; }
      if (r.status >= 500 && ++failures <= 5) {
        // Ask how much arrived, then carry on from there.
        await new Promise((ok) => setTimeout(ok, (deps.retryDelayMs ?? 1000) * 2 ** failures));
        let s: Response;
        try { s = await http(location, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
        catch { continue; }
        if (s.status === 200 || s.status === 201) {
          const d: any = await s.json().catch(() => ({}));
          if (d?.id) return uploaded(d);
        }
        if (s.status === 308) offset = nextOffset(s);
        continue;
      }
      throw apiError(r.status, await r.json().catch(() => ({})));
    }
  }
}

/**
 * What YouTube says about one of the channel's own videos after the upload:
 * `uploadStatus` is uploaded → processed, or rejected / failed / deleted with
 * a reason. Null when YouTube no longer lists the video.
 *
 * videos.list is covered by youtube.readonly (which both kinds of connection
 * have). By default only part=status is asked for. `{ full: true }` asks for
 * status, snippet and processingDetails — processingDetails is an owner-only
 * part, which the same youtube.readonly grant of the channel's owner covers —
 * and fills the optional fields: the scheduled time, when it went public, the
 * title, how far processing is, and which thumbnail sizes exist.
 */
export type VideoStatus = {
  uploadStatus: string | null; privacyStatus: string | null; rejectionReason: string | null; failureReason: string | null;
  /** The scheduled publish time (only while the video is private and scheduled). */
  publishAt?: string | null;
  /** When the video went public (for a private video: when it was uploaded). */
  publishedAt?: string | null;
  title?: string | null;
  channelId?: string | null;
  /** processingDetails.processingStatus: processing | succeeded | failed | terminated. */
  processingStatus?: string | null;
  /**
   * The thumbnail sizes YouTube lists (default, medium, high, standard, maxres). The API has no
   * field that says whether a thumbnail is a custom one — this is only what exists.
   */
  thumbnailSizes?: string[];
};
export async function getVideoStatus(videoId: string, deps: Deps, opts: { full?: boolean } = {}): Promise<VideoStatus | null> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  const { d } = await call(deps, `${API}/videos?part=${opts.full ? "status%2Csnippet%2CprocessingDetails" : "status"}&id=${encodeURIComponent(videoId)}`);
  const item = (Array.isArray(d?.items) ? d.items : [])[0];
  const s = item?.status;
  if (!s) return null;
  const text = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{1,40}$/.test(v) ? v : null);
  const time = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  const base = { uploadStatus: text(s.uploadStatus), privacyStatus: text(s.privacyStatus), rejectionReason: text(s.rejectionReason), failureReason: text(s.failureReason) };
  if (!opts.full) return base;
  const thumbs = item.snippet?.thumbnails;
  return {
    ...base,
    publishAt: time(s.publishAt),
    publishedAt: time(item.snippet?.publishedAt),
    title: typeof item.snippet?.title === "string" ? item.snippet.title.slice(0, 200) : null,
    channelId: typeof item.snippet?.channelId === "string" && idOk(item.snippet.channelId) ? item.snippet.channelId : null,
    processingStatus: text(item.processingDetails?.processingStatus),
    thumbnailSizes: thumbs && typeof thumbs === "object" ? Object.keys(thumbs).filter((k) => /^[a-z]{1,12}$/.test(k)) : [],
  };
}

/**
 * Move (or set) the scheduled publish time of a video that is still private.
 *
 * videos.update is NOT covered by youtube.upload or youtube.readonly: it needs
 * youtube.force-ssl (or the broader youtube / youtubepartner), the same
 * permission captions and playlists need. An update of part=status replaces
 * every writable field of that part, so the current values are read first
 * (videos.list, youtube.readonly) and sent back unchanged beside the new time.
 * A video that is already public (or unlisted) is refused: YouTube schedules
 * only a private video that has never been published.
 */
export async function updateVideoSchedule(videoId: string, publishAt: string, deps: Deps): Promise<{ videoId: string; publishAt: string; privacyStatus: string | null }> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  const at = normalizePublishAt(publishAt, (deps.now ?? Date.now)());
  await requireManageScope(deps, "Rescheduling a video");
  const { d: cur } = await call(deps, `${API}/videos?part=status&id=${encodeURIComponent(videoId)}`);
  const s = (Array.isArray(cur?.items) ? cur.items : [])[0]?.status;
  if (!s) throw new YoutubeError("request", "YouTube does not list this video", 404);
  if (s.privacyStatus !== "private") throw new YoutubeError("request", "Only a private video can be scheduled; this one is already published", 409);
  const status: Record<string, unknown> = { privacyStatus: "private", publishAt: at };
  for (const k of ["embeddable", "license", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"] as const)
    if (s[k] !== undefined) status[k] = s[k];
  const { d } = await call(deps, `${API}/videos?part=status`, {
    method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ id: videoId, status }),
  });
  return { videoId, publishAt: typeof d?.status?.publishAt === "string" ? d.status.publishAt : at, privacyStatus: d?.status?.privacyStatus ?? null };
}

export type SnippetUpdate = { title: string; description: string; tags?: readonly string[] };
/**
 * Rewrite the title, description and tags of a video that is already on YouTube (videos.update,
 * part=snippet — the youtube.force-ssl permission, like every other edit).
 *
 * An update of part=snippet REPLACES the part: the title and the category must be sent, and any
 * other writable field that is left out is erased. So the video's current snippet is read first
 * (videos.list) and its category and languages go back unchanged beside the new text. Nothing but
 * the three fields named here changes; the video's status, schedule and file are not touched.
 */
export async function updateVideoSnippet(videoId: string, input: SnippetUpdate, deps: Deps): Promise<{ videoId: string; title: string; descriptionLength: number; tags: number }> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  const title = input.title.trim(), description = input.description;
  if (!title || title.length > 100 || /[<>]/.test(title)) throw new YoutubeError("request", "A title is 1 to 100 characters, without < or >", 400);
  if (Buffer.byteLength(description, "utf8") > 5000 || description.length > 5000 || /[<>]/.test(description))
    throw new YoutubeError("request", "A description is at most 5,000 characters, without < or >", 400);
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1) > 500) throw new YoutubeError("request", "Tags are at most 500 characters in all", 400);
  await requireManageScope(deps, "Editing a video's description");
  const { d: cur } = await call(deps, `${API}/videos?part=snippet&id=${encodeURIComponent(videoId)}`);
  const s = (Array.isArray(cur?.items) ? cur.items : [])[0]?.snippet;
  if (!s) throw new YoutubeError("request", "YouTube does not list this video", 404);
  if (!s.categoryId) throw new YoutubeError("request", "YouTube answered no category for this video; nothing was changed", 502);
  const snippet: Record<string, unknown> = { title, description, categoryId: String(s.categoryId), tags };
  for (const k of ["defaultLanguage", "defaultAudioLanguage"] as const) if (typeof s[k] === "string") snippet[k] = s[k];
  const { d } = await call(deps, `${API}/videos?part=snippet`, {
    method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ id: videoId, snippet }),
  });
  return { videoId, title: typeof d?.snippet?.title === "string" ? d.snippet.title : title, descriptionLength: typeof d?.snippet?.description === "string" ? d.snippet.description.length : description.length, tags: Array.isArray(d?.snippet?.tags) ? d.snippet.tags.length : tags.length };
}

/** "Range: bytes=0-N" on a 308 says N+1 bytes are stored; no Range header means none are. */
function nextOffset(r: Response): number {
  const m = /bytes=0-(\d+)/.exec(r.headers.get("range") ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

/* ── Thumbnail, captions, playlists ───────────────────────────────────────── */

const idOk = (id: string) => /^[A-Za-z0-9_-]{5,64}$/.test(id);

export async function setThumbnail(videoId: string, jpgPath: string, deps: Deps): Promise<void> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  const body = await readFile(jpgPath);
  if (body.length > 2 * 1024 * 1024) throw new YoutubeError("upload", "A thumbnail is at most 2 MB", 400);
  await call(deps, `${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST", headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length) }, body,
  }, 120_000);
}

async function requireManageScope(deps: Deps, what: string): Promise<void> {
  const scopes = await grantedScopes(deps);
  if (!scopes.some((s) => YT_MANAGE_SCOPES.includes(s)))
    throw new YoutubeError("missing_scope",
      `${what} needs the ${YT_FORCE_SSL_SCOPE} permission, which this connection does not have. Set YOUTUBE_EXTRA_SCOPES to it, add it under Data access in Google Cloud, and reconnect on /admin/youtube.`, 403);
}

/** The multipart/related body for captions.insert (exported for the tests). */
export function captionRequest(videoId: string, language: string, srt: Buffer, boundary = `chub_${randomBytes(12).toString("hex")}`): { url: string; headers: Record<string, string>; body: Buffer } {
  const meta = JSON.stringify({ snippet: { videoId, language, name: "", isDraft: false } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/x-subrip\r\n\r\n`),
    srt,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    url: `${UPLOAD_API}/captions?uploadType=multipart&part=snippet`,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) },
    body,
  };
}

export async function uploadCaption(videoId: string, srtPath: string, language: string, deps: Deps): Promise<{ captionId: string }> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) throw new YoutubeError("request", "Invalid caption language", 400);
  await requireManageScope(deps, "Adding captions");
  const req = captionRequest(videoId, language, await readFile(srtPath));
  const { d } = await call(deps, req.url, { method: "POST", headers: req.headers, body: req.body }, 120_000);
  return { captionId: String(d?.id ?? "") };
}

/** Put a video in the channel's playlist with this title, creating the playlist (same privacy as asked, default private) if there is none. */
export async function addToPlaylist(videoId: string, playlistTitle: string, deps: Deps, opts: { privacyStatus?: "private" | "unlisted" | "public" } = {}): Promise<{ playlistId: string; created: boolean }> {
  if (!idOk(videoId)) throw new YoutubeError("request", "Invalid video id", 400);
  const title = playlistTitle.trim();
  if (!title || title.length > 150) throw new YoutubeError("request", "A playlist title is 1–150 characters", 400);
  await requireManageScope(deps, "Adding to a playlist");
  let playlistId: string | null = null, page = "", created = false;
  for (let i = 0; i < 20 && !playlistId; i++) {
    const { d } = await call(deps, `${API}/playlists?part=id%2Csnippet&mine=true&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    playlistId = (d.items ?? []).find((p: any) => String(p?.snippet?.title ?? "").trim().toLowerCase() === title.toLowerCase())?.id ?? null;
    page = d.nextPageToken ?? "";
    if (!page) break;
  }
  const json = { "Content-Type": "application/json; charset=UTF-8" };
  if (!playlistId) {
    const { d } = await call(deps, `${API}/playlists?part=snippet%2Cstatus`, {
      method: "POST", headers: json, body: JSON.stringify({ snippet: { title }, status: { privacyStatus: opts.privacyStatus ?? "private" } }),
    });
    if (!d?.id) throw new YoutubeError("request", "YouTube did not create the playlist");
    playlistId = String(d.id);
    created = true;
  }
  await call(deps, `${API}/playlistItems?part=snippet`, {
    method: "POST", headers: json, body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  });
  return { playlistId: playlistId!, created };
}

/* ── Analytics ────────────────────────────────────────────────────────────── */

export const ANALYTICS_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained"] as const;
export type VideoAnalyticsRow = { video: string; views: number; estimatedMinutesWatched: number; averageViewDuration: number; subscribersGained: number };

export function analyticsUrl(startDate: string, endDate: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(startDate) || !day.test(endDate) || startDate > endDate) throw new YoutubeError("request", "Dates are YYYY-MM-DD, start on or before end", 400);
  const q = new URLSearchParams({
    ids: "channel==MINE", startDate, endDate,
    metrics: ANALYTICS_METRICS.join(","), dimensions: "video", sort: "-views", maxResults: "50",
  });
  return `${ANALYTICS_API}/reports?${q}`;
}

/** The channel's top 50 videos by views between two dates (inclusive), as Google reports them — rows are never invented. */
export async function getChannelAnalytics(input: { startDate: string; endDate: string }, deps: Deps): Promise<VideoAnalyticsRow[]> {
  const url = analyticsUrl(input.startDate, input.endDate);
  if (!(await grantedScopes(deps)).includes(YT_ANALYTICS_SCOPE))
    throw new YoutubeError("missing_scope", "The connection does not include YouTube Analytics. Reconnect on /admin/youtube and leave that permission ticked.", 403);
  const { d } = await call(deps, url);
  const cols: string[] = (d.columnHeaders ?? []).map((h: any) => String(h?.name ?? ""));
  const at = (name: string) => cols.indexOf(name);
  if (at("video") < 0) throw new YoutubeError("request", "YouTube Analytics returned an unexpected report shape");
  const num = (row: any[], name: string) => { const v = Number(row[at(name)]); return Number.isFinite(v) ? v : 0; };
  return (d.rows ?? []).map((row: any[]) => ({
    video: String(row[at("video")]),
    views: num(row, "views"),
    estimatedMinutesWatched: num(row, "estimatedMinutesWatched"),
    averageViewDuration: num(row, "averageViewDuration"),
    subscribersGained: num(row, "subscribersGained"),
  }));
}
