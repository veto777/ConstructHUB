/**
 * JobCam object storage — R2 (S3 API) when R2_ENDPOINT/keys are set, else a
 * local tree under tmp/jobcam/ (dev boxes, and an honest fallback that keeps
 * the whole feature working without a bucket). Both modes speak the same
 * multipart contract the routes expose:
 *
 *   createMultipart → partTarget(n) (a PUT URL per part) → completeMultipart
 *
 * In R2 mode each part target is a presigned UploadPart URL (SigV4, 15-min
 * TTL) so the browser streams straight to Cloudflare, plus a proxy URL on our
 * API the client falls back to if the direct PUT is blocked (bucket CORS not
 * set yet). In local mode only the proxy URL exists. Keys are always
 * `jobcam/<orgId>/<mediaId>/<name>.<ext>` and validated before any I/O.
 */
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { buildQueryString } from "@smithy/querystring-builder";
import { r2Configured } from "../r2";
import { PART_URL_TTL_S } from "./upload-state";

export type StorageMode = "r2" | "local";

const BUCKET = process.env.R2_BUCKET_NAME || "constructhub";
const LOCAL_ROOT = path.join(process.cwd(), "tmp", "jobcam");

let s3: S3Client | null = null;
function client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT!,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
  }
  return s3;
}

export function storageMode(): StorageMode {
  if (process.env.JOBCAM_STORAGE === "local") return "local";
  return r2Configured() && !!process.env.R2_ENDPOINT ? "r2" : "local";
}

/** Keys are built by us; a hand-edited row must still never escape the prefix. */
export function assertKey(key: string): string {
  if (!/^jobcam\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(key) || key.includes("..")) {
    throw new Error("Invalid JobCam storage key");
  }
  return key;
}

export function mediaKey(orgId: string, mediaId: string, name: string): string {
  return assertKey(`jobcam/${orgId}/${mediaId}/${name}`);
}

const localPath = (key: string) => path.join(LOCAL_ROOT, assertKey(key));
const localPartsDir = (uploadId: string) => path.join(LOCAL_ROOT, "_parts", uploadId.replace(/[^A-Za-z0-9_-]/g, ""));

// ── Presigning (R2 mode) ────────────────────────────────────────────────────

class Sha256 extends Hash { constructor(secret?: any) { super("sha256", secret); } }
let signer: SignatureV4 | null = null;
function presigner(): SignatureV4 {
  return signer ??= new SignatureV4({
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    region: "auto",
    service: "s3",
    sha256: Sha256 as any,
    uriEscapePath: false,
    applyChecksum: false,
  });
}

/** A presigned UploadPart PUT: the browser PUTs the raw part body and reads the ETag header. */
export async function presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  const endpoint = new URL(process.env.R2_ENDPOINT!);
  const req = new HttpRequest({
    method: "PUT",
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    path: `/${BUCKET}/${assertKey(key)}`,
    query: { partNumber: String(partNumber), uploadId },
    headers: { host: endpoint.host },
  });
  const signed = await presigner().presign(req, { expiresIn: PART_URL_TTL_S });
  const port = signed.port ? `:${signed.port}` : "";
  return `${signed.protocol}//${signed.hostname}${port}${signed.path}?${buildQueryString(signed.query ?? {})}`;
}

// ── Multipart ───────────────────────────────────────────────────────────────

export type MultipartHandle = { mode: StorageMode; key: string; storageUploadId: string | null };

export async function createMultipart(key: string, mime: string, uploadRowId: string): Promise<MultipartHandle> {
  assertKey(key);
  if (storageMode() === "r2") {
    const r = await client().send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: mime }));
    if (!r.UploadId) throw new Error("R2 did not return an UploadId");
    return { mode: "r2", key, storageUploadId: r.UploadId };
  }
  await fs.promises.mkdir(localPartsDir(uploadRowId), { recursive: true });
  return { mode: "local", key, storageUploadId: null };
}

/** The direct URL for part n (R2 only); callers add the proxy URL themselves. */
export async function directPartUrl(h: MultipartHandle, n: number): Promise<string | null> {
  if (h.mode !== "r2" || !h.storageUploadId) return null;
  return presignUploadPart(h.key, h.storageUploadId, n);
}

/** Server-side part write (the proxy path, and the only path in local mode). Returns the ETag. */
export async function putPart(h: MultipartHandle, uploadRowId: string, n: number, body: Buffer): Promise<string> {
  if (h.mode === "r2") {
    const r = await client().send(new UploadPartCommand({
      Bucket: BUCKET, Key: h.key, UploadId: h.storageUploadId!, PartNumber: n, Body: body, ContentLength: body.length,
    }));
    if (!r.ETag) throw new Error("R2 did not return an ETag for the part");
    return r.ETag;
  }
  const dir = localPartsDir(uploadRowId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, String(n)), body);
  return `"local-${n}-${body.length}"`;
}

export async function completeMultipart(h: MultipartHandle, uploadRowId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void> {
  if (h.mode === "r2") {
    await client().send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET, Key: h.key, UploadId: h.storageUploadId!, MultipartUpload: { Parts: parts },
    }));
    return;
  }
  const dir = localPartsDir(uploadRowId);
  const dest = localPath(h.key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);
  for (const p of parts) {
    await new Promise<void>((resolve, reject) => {
      const src = fs.createReadStream(path.join(dir, String(p.PartNumber)));
      src.on("error", reject);
      src.on("end", resolve);
      src.pipe(out, { end: false });
    });
  }
  await new Promise<void>((resolve, reject) => { out.on("error", reject); out.end(resolve); });
  await fs.promises.rm(dir, { recursive: true, force: true });
}

export async function abortMultipart(h: MultipartHandle, uploadRowId: string): Promise<void> {
  if (h.mode === "r2") {
    await client().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: h.key, UploadId: h.storageUploadId! })).catch(() => {});
    return;
  }
  await fs.promises.rm(localPartsDir(uploadRowId), { recursive: true, force: true });
}

// ── Objects ─────────────────────────────────────────────────────────────────

export async function putObjectFromFile(key: string, filePath: string, mime: string): Promise<number> {
  assertKey(key);
  const { size } = await fs.promises.stat(filePath);
  if (storageMode() === "r2") {
    await client().send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: fs.createReadStream(filePath), ContentType: mime, ContentLength: size,
    }));
    return size;
  }
  const dest = localPath(key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(filePath, dest);
  return size;
}

export async function objectSize(key: string): Promise<number | null> {
  assertKey(key);
  try {
    if (storageMode() === "r2") {
      const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return typeof r.ContentLength === "number" ? r.ContentLength : null;
    }
    return (await fs.promises.stat(localPath(key))).size;
  } catch {
    return null;
  }
}

export type ObjectStream = {
  body: Readable;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  status: 200 | 206;
};

/** `range` is the raw HTTP Range header ("bytes=0-99"), honoured in both modes so video seeks work. */
export async function getObject(key: string, mime: string, range?: string): Promise<ObjectStream | null> {
  assertKey(key);
  if (storageMode() === "r2") {
    try {
      const r = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(range ? { Range: range } : {}) }));
      if (!r.Body) return null;
      const body = r.Body as any;
      const stream: Readable = typeof body.pipe === "function" ? body : Readable.fromWeb(body);
      return {
        body: stream,
        contentType: r.ContentType || mime,
        contentLength: typeof r.ContentLength === "number" ? r.ContentLength : undefined,
        contentRange: r.ContentRange || undefined,
        status: r.ContentRange ? 206 : 200,
      };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey") return null;
      throw e;
    }
  }
  const p = localPath(key);
  let size: number;
  try { size = (await fs.promises.stat(p)).size; } catch { return null; }
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { start = 0; end = size - 1; }
    return {
      body: fs.createReadStream(p, { start, end }), contentType: mime,
      contentLength: end - start + 1, contentRange: `bytes ${start}-${end}/${size}`, status: 206,
    };
  }
  return { body: fs.createReadStream(p), contentType: mime, contentLength: size, status: 200 };
}

export async function downloadToFile(key: string, destPath: string): Promise<void> {
  const obj = await getObject(key, "application/octet-stream");
  if (!obj) throw new Error(`Object not found: ${key}`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await pipeline(obj.body, fs.createWriteStream(destPath));
}

export async function deleteObject(key: string): Promise<void> {
  assertKey(key);
  if (storageMode() === "r2") {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
    return;
  }
  await fs.promises.rm(localPath(key), { force: true });
}
