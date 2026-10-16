/**
 * GET /api/files/:folder/:subfolder/:filename[/download] — the app's public, unauthenticated
 * window onto the shared R2 bucket (inherited from the Replit import: getR2Url() hands these URLs
 * to <img> tags, emails, Google and the social networks).
 *
 * It serves an ALLOWLIST only. Every other object in the bucket is private and has its own gated
 * route, so anything not listed here is a 404 (never a 403 — no oracle for what exists):
 *
 *   PUBLIC (served here; every key is a server-minted random UUID / token, so the URL is the capability)
 *     logos/company/<uuid>.<ext>   account + CRM company logos (r2 uploadToR2 via /api/upload/logo, crm/payments.ts)
 *     logos/gmb/<uuid>.<ext>       GMB logo (/api/upload/logo type=gmb-logo)
 *     photos/reviews/<uuid>.<ext>  review-request photos (/api/upload/review-photos; review-feedback downloads)
 *     media/<uuid>/<name>.jpg      GBP photos, processed for Google (gbp/content-upload.ts, gbp/bulk-posts.ts)
 *     social/<token32>/media.<ext> social posts' media the networks fetch (social/native.ts startUpload)
 *
 *   PRIVATE (never here)
 *     voice/<org>/recordings/<sid>.wav  → GET /api/crm/voice/calls/:id/recording (org member)
 *     jobcam[-x]/<org>/<id>/…           → JobCam member routes + /api/jc/:token share links
 *     ytvideo[-x]/<user>/<id>/…         → YouTube customer-video routes
 *     issue-reports/<uuid>.<ext>        → platform-admin issue desk (ops/routes.ts)
 *     anything else (backups, future prefixes) — closed until someone adds it above on purpose
 *
 *   Two-segment public keys (avatars/<uuid>.<ext>, media/<uuid>.<ext>, tutorials/…) cannot match a
 *   three-segment route at all; tutorials have their own Range-aware route (tutorials/media.ts).
 *
 * Express 5 decodes "%2F" inside a param, so each param is checked on its own decoded value: a
 * param holding "/" or "\" (or "..") is refused before anything is joined into a key.
 */
import type { Express, Request, Response } from "express";
import { Readable } from "stream";
import { isPrivateMediaKey } from "../jobcam/storage";
import { R2_READ_TIMEOUT_MS, isR2Timeout } from "../r2-http";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// uploadToR2 names files `<uuid>.<ext>`; review photos take the ext from the user's file name.
const UUID_FILE = new RegExp(`^${UUID}\\.[A-Za-z0-9_-]{1,32}$`);

type Rule = { folder: string; subfolder: (s: string) => boolean; filename: (f: string) => boolean };
const exact = (v: string) => (s: string) => s === v;

export const PUBLIC_FILE_RULES: readonly Rule[] = [
  { folder: "logos", subfolder: exact("company"), filename: (f) => UUID_FILE.test(f) },
  { folder: "logos", subfolder: exact("gmb"), filename: (f) => UUID_FILE.test(f) },
  { folder: "photos", subfolder: exact("reviews"), filename: (f) => UUID_FILE.test(f) },
  // uploadToR2(…, fileName) only accepts /^[A-Za-z0-9-]+\.jpg$/ (r2.ts).
  { folder: "media", subfolder: (s) => new RegExp(`^${UUID}$`).test(s), filename: (f) => /^[A-Za-z0-9-]{1,200}\.jpg$/.test(f) },
  { folder: "social", subfolder: (s) => /^[a-f0-9]{32}$/.test(s), filename: (f) => /^media\.(?:jpg|png|webp|mp4|mov)$/.test(f) },
  // Press release photos (server/press/routes.ts uploadToR2(…, "press/photos", ext)) go out with the release.
  // press/inbox/ (inbound wire mail attachments) is private: platform admins read it via /api/admin/press/attachments.
  { folder: "press", subfolder: exact("photos"), filename: (f) => UUID_FILE.test(f) },
];

const cleanSegment = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 256 && !/[\/\\\0]/.test(s) && !s.includes("..") && s.trim() === s;

/**
 * The R2 key for an allowlisted public object, or null (→ 404) for anything else. Takes the route's
 * params (same signature as the 2026-10-16 hotfix on main, which this supersedes).
 */
export function publicFileKey(params: { folder?: unknown; subfolder?: unknown; filename?: unknown } | null | undefined): string | null {
  const { folder, subfolder, filename } = params ?? {};
  if (!cleanSegment(folder) || !cleanSegment(subfolder) || !cleanSegment(filename)) return null;
  const rule = PUBLIC_FILE_RULES.find((r) => r.folder === folder && r.subfolder(subfolder) && r.filename(filename));
  if (!rule) return null;
  const key = `${folder}/${subfolder}/${filename}`;
  return isPrivateMediaKey(key) ? null : key; // belt and braces: the JobCam / ytvideo trees never qualify
}

export type PublicFileReader = (key: string, opts: { abortSignal: AbortSignal }) => Promise<{ body: any; contentType: string; contentLength?: number }>;
const defaultReader: PublicFileReader = async (key, opts) => (await import("../r2")).getFromR2(key, opts);

// Inline only for media types a browser cannot run. review-photos stores the client-claimed mimetype,
// so an uploaded "text/html" or SVG must never render on this origin — it is sent as a download.
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"]);

/** A download name safe inside a quoted Content-Disposition value (the hotfix's character set). */
function downloadName(raw: unknown, fallback: string): string {
  return String((typeof raw === "string" && raw) || fallback).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "download";
}

/** Settles with `pending`, or rejects as soon as `signal` aborts; a body that arrives late is destroyed. */
function untilAborted<T extends { body?: unknown }>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error("R2 read aborted"), { name: "AbortError" }));
      pending.then((late) => destroyBody(late?.body), () => {});
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
function destroyBody(b: any) {
  if (!b) return;
  if (typeof b.destroy === "function") { if (!b.destroyed) b.destroy(); } else b.cancel?.().catch?.(() => {});
}
const toNodeStream = (raw: any): Readable => (typeof raw?.pipe === "function" ? raw : Readable.fromWeb(raw));

/**
 * Incident 2026-10-15 (server/tutorials/media.ts): an R2 body that is neither read to the end nor
 * destroyed keeps its pool socket. So the "viewer went away" hook is attached before the R2 read, the
 * read gets an AbortSignal and a deadline, and every path that does not pipe the body (HEAD, viewer gone,
 * error) destroys it. A read that does not answer in time is a 504, never a hang.
 */
export function registerPublicFileRoutes(app: Express, opts: { read?: PublicFileReader; timeoutMs?: number } = {}) {
  const read = opts.read ?? defaultReader;
  const timeoutMs = opts.timeoutMs ?? R2_READ_TIMEOUT_MS;
  const serve = (download: boolean) => async (req: Request, res: Response) => {
    const key = publicFileKey(req.params);
    if (!key) return res.status(404).json({ message: "File not found" });
    const filename = String(req.params.filename);
    const ac = new AbortController();
    let body: Readable | undefined;
    let viewerGone = false, timedOut = false;
    const release = () => { if (!ac.signal.aborted) ac.abort(); destroyBody(body); };
    // "close" also fires after a normal finish; releasing then is a no-op.
    res.on("close", () => { if (!res.writableFinished) viewerGone = true; release(); });
    if (req.socket?.destroyed) return;
    const deadline = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    try {
      const got = await untilAborted(read(key, { abortSignal: ac.signal }), ac.signal);
      clearTimeout(deadline);
      if (got.body) body = toNodeStream(got.body);
      if (viewerGone || res.destroyed) return release();
      if (!body) return res.status(404).json({ message: "File not found" });
      const contentType = got.contentType || "application/octet-stream";
      const inline = INLINE_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
      res.setHeader("Content-Type", inline ? contentType : "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (download || !inline) {
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName(req.query.name, filename)}"`);
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      if (typeof got.contentLength === "number") res.setHeader("Content-Length", String(got.contentLength));
      if (req.method === "HEAD") { release(); return res.end(); }
      const stream = body;
      if (stream.destroyed) throw new Error("R2 body closed before it was read");
      stream.on("error", () => { release(); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      stream.pipe(res);
    } catch (err: any) {
      clearTimeout(deadline);
      release();
      if (viewerGone || res.destroyed || res.headersSent) return;
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return res.status(404).json({ message: "File not found" });
      if (timedOut || isR2Timeout(err)) {
        console.warn(`Public file: R2 did not answer for ${key} (${timedOut ? "deadline" : err?.message})`);
        return res.status(504).json({ message: "The file store did not answer in time. Try again." });
      }
      console.error("Error serving R2 file:", err?.message || err);
      res.status(500).json({ message: download ? "Failed to download file" : "Failed to serve file" });
    }
  };
  app.get("/api/files/:folder/:subfolder/:filename", serve(false));
  app.get("/api/files/:folder/:subfolder/:filename/download", serve(true));
}
