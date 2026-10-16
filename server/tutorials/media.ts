/**
 * Walkthrough-video media: GET /api/tutorials/media/:file — public, cacheable, and Range-aware.
 *
 * Why its own route: `/api/files/…` does not forward `Range`, and iPhones (Safari) will not play or
 * seek an MP4 that cannot answer `206 Partial Content`. The approach is JobCam's (server/jobcam/
 * storage.ts → getObject): R2 when it is configured (production), a local folder otherwise (dev).
 *
 * What it will serve is narrow on purpose:
 *   · only keys under the fixed `tutorials/` prefix, and only the shape mux.ts writes —
 *     `<helpKey>.<hash8>.(mp4|vtt|jpg)` — so no path can leave the prefix and nothing else in the
 *     bucket is reachable through it;
 *   · the Content-Type comes from the extension, never from the stored object.
 * The name carries the file's content hash, so the response is immutable for a year: a re-recorded
 * video has a new name (shared/help/videos/<helpKey>.json).
 */
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import type { Express, Request, Response } from "express";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { TUTORIAL_FILE, TUTORIAL_PREFIX } from "@shared/help/videos";
import { R2_READ_TIMEOUT_MS, isR2Timeout, r2RequestHandler } from "../r2-http";

const TYPES: Record<string, string> = { mp4: "video/mp4", vtt: "text/vtt; charset=utf-8", jpg: "image/jpeg" };

/** The storage key and content type for a requested file name, or null when the name is not ours. */
export function tutorialObject(file: unknown): { key: string; contentType: string } | null {
  if (typeof file !== "string" || file.length > 120 || !TUTORIAL_FILE.test(file)) return null;
  return { key: `${TUTORIAL_PREFIX}${file}`, contentType: TYPES[file.slice(file.lastIndexOf(".") + 1)] };
}

export type ByteRange = { start: number; end: number };
/**
 * One well-formed `bytes=a-b` / `bytes=a-` / `bytes=-n` range inside a file of `size` bytes.
 * `null` = no usable range: serve the whole file (RFC 9110 lets a server ignore a Range it does not
 * like). `"unsatisfiable"` = it starts past the end: 416.
 */
export function parseRange(raw: unknown, size: number): ByteRange | null | "unsatisfiable" {
  if (typeof raw !== "string") return null;
  const m = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(raw.trim());
  if (!m || (!m[1] && !m[2])) return null;
  if (size <= 0) return "unsatisfiable";
  if (!m[1]) { // the last n bytes
    const n = Number(m[2]);
    return n === 0 ? "unsatisfiable" : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (m[2] && Number(m[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

const r2Ready = () => !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
export const tutorialStorageMode = (): "r2" | "local" => (process.env.TUTORIALS_STORAGE !== "local" && r2Ready() ? "r2" : "local");
const BUCKET = process.env.R2_BUCKET_NAME || "constructhub";
const localRoot = () => process.env.TUTORIALS_LOCAL_DIR || path.join(process.cwd(), "tmp", "tutorials");

// The client has timeouts and a bounded pool (server/r2-http.ts). `S3Like` and the setter exist so the tests
// can stand in a mocked or a fake-R2 client.
type S3Like = Pick<S3Client, "send">;
let s3: S3Like | null = null;
let readTimeoutMs = R2_READ_TIMEOUT_MS;
const client = (): S3Like => (s3 ??= new S3Client({
  region: "auto", endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  requestHandler: r2RequestHandler(),
  maxAttempts: 2,
}));
/** Tests only: replace the R2 client (null = build the real one again) and the read deadline. */
export function setTutorialR2ForTests(c: S3Like | null, timeoutMs = R2_READ_TIMEOUT_MS): void {
  s3 = c;
  readTimeoutMs = timeoutMs;
}

type Served = { status: 200 | 206 | 416; body?: Readable; size?: number; length?: number; contentRange?: string };

async function fromLocal(file: string, rangeHeader: unknown): Promise<Served | null> {
  const p = path.join(localRoot(), file); // `file` passed TUTORIAL_FILE: no slash, no dot-dot
  let size: number;
  try { size = (await fs.promises.stat(p)).size; } catch { return null; }
  const range = parseRange(rangeHeader, size);
  if (range === "unsatisfiable") return { status: 416, size };
  if (!range) return { status: 200, body: fs.createReadStream(p), size, length: size };
  return { status: 206, body: fs.createReadStream(p, range), size, length: range.end - range.start + 1, contentRange: `bytes ${range.start}-${range.end}/${size}` };
}

/**
 * `pending`, or a rejection as soon as `signal` aborts — so the route never waits on a send() that does
 * not honour its abort. If such a send() answers later anyway, its body is destroyed, not leaked.
 */
function untilAborted<T extends { Body?: unknown }>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error("R2 read aborted"), { name: "AbortError" }));
      pending.then((late) => { const b = late?.Body as any; if (typeof b?.destroy === "function") b.destroy(); else b?.cancel?.(); }, () => {});
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

async function fromR2(key: string, rangeHeader: unknown, abortSignal: AbortSignal): Promise<Served | null> {
  // Only a range we would accept ourselves is passed on; anything else gets the whole object.
  const m = typeof rangeHeader === "string" ? /^bytes=(\d{0,15})-(\d{0,15})$/.exec(rangeHeader.trim()) : null;
  const range = m && (m[1] || m[2]) && !(m[1] && m[2] && Number(m[2]) < Number(m[1])) ? `bytes=${m[1]}-${m[2]}` : undefined;
  try {
    // abortSignal: the viewer left or the deadline passed — the in-flight request (or its place in the
    // socket queue) is dropped. requestTimeout: per attempt, to the response headers.
    const pending = client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(range ? { Range: range } : {}) }),
      { abortSignal, requestTimeout: readTimeoutMs },
    );
    const r = await untilAborted(pending, abortSignal);
    if (!r.Body) return null;
    const raw = r.Body as any;
    const body: Readable = typeof raw.pipe === "function" ? raw : Readable.fromWeb(raw);
    const length = typeof r.ContentLength === "number" ? r.ContentLength : undefined;
    return r.ContentRange ? { status: 206, body, length, contentRange: r.ContentRange } : { status: 200, body, length, size: length };
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey") return null;
    if (range && (e?.$metadata?.httpStatusCode === 416 || e?.name === "InvalidRange")) return { status: 416 };
    throw e;
  }
}

/**
 * Incident 2026-10-15: every R2 response body must be read to the end or destroyed, or its socket stays
 * checked out of the client's pool; once the pool was full, every later media request hung. So the
 * "viewer went away" hook is attached BEFORE the R2 read starts, the read is aborted when it fires, and
 * every path that does not pipe the body (HEAD, viewer gone, error) destroys it. A read that does not
 * answer in time is a 504, never a hang.
 */
export function registerTutorialMediaRoutes(app: Express): void {
  app.get("/api/tutorials/media/:file", async (req: Request, res: Response) => {
    const object = tutorialObject(req.params.file);
    if (!object) return res.status(404).json({ message: "Not found" });
    const ac = new AbortController();
    let body: Readable | undefined;
    let viewerGone = false;
    let timedOut = false;
    const release = () => {
      if (!ac.signal.aborted) ac.abort();
      if (body && !body.destroyed) body.destroy();
    };
    // "close" also fires after a normal finish; releasing then is a no-op.
    res.on("close", () => { if (!res.writableFinished) viewerGone = true; release(); });
    if (req.socket?.destroyed) { viewerGone = true; return; }
    const deadline = setTimeout(() => { timedOut = true; ac.abort(); }, readTimeoutMs);
    try {
      const file = String(req.params.file);
      const served = tutorialStorageMode() === "r2" ? await fromR2(object.key, req.headers.range, ac.signal) : await fromLocal(file, req.headers.range);
      clearTimeout(deadline);
      body = served?.body;
      if (viewerGone || res.destroyed) return release();
      if (!served) return res.status(404).json({ message: "Not found" });
      res.setHeader("Accept-Ranges", "bytes");
      if (served.status === 416) {
        release();
        if (served.size !== undefined) res.setHeader("Content-Range", `bytes */${served.size}`);
        return res.status(416).end();
      }
      res.status(served.status);
      res.setHeader("Content-Type", object.contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (served.length !== undefined) res.setHeader("Content-Length", String(served.length));
      if (served.contentRange) res.setHeader("Content-Range", served.contentRange);
      const stream = served.body!;
      if (req.method === "HEAD") { release(); return res.end(); }
      if (stream.destroyed) throw new Error("R2 body closed before it was read");
      stream.on("error", () => { release(); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      stream.pipe(res);
    } catch (err: any) {
      clearTimeout(deadline);
      release();
      if (viewerGone || res.destroyed || res.headersSent) return;
      if (timedOut || isR2Timeout(err)) {
        console.warn(`Tutorial media: R2 did not answer for ${object.key} (${timedOut ? "deadline" : err?.message})`);
        return res.status(504).json({ message: "The video store did not answer in time. Try again." });
      }
      console.error("Error serving tutorial media:", err);
      res.status(500).json({ message: "Could not load the video" });
    }
  });
}
