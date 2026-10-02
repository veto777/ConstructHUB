import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || "constructhub";

export async function uploadToR2(
  buffer: Buffer,
  contentType: string,
  folder: string,
  extension: string = "jpg",
  fileName?: string
): Promise<string> {
  if (fileName && !/^[A-Za-z0-9-]+\.jpg$/.test(fileName)) throw new Error("Invalid media filename");
  const key = fileName ? `${folder}/${randomUUID()}/${fileName}` : `${folder}/${randomUUID()}.${extension}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return key;
}

/** `range` is an HTTP Range header value ("bytes=0-99"), passed through to R2 for media seeking. */
export async function getFromR2(key: string, opts: { range?: string } = {}): Promise<{
  body: ReadableStream | null; contentType: string; contentLength?: number; contentRange?: string;
}> {
  const result = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(opts.range ? { Range: opts.range } : {}),
  }));

  return {
    body: result.Body as any,
    contentType: result.ContentType || "application/octet-stream",
    contentLength: typeof result.ContentLength === "number" ? result.ContentLength : undefined,
    contentRange: result.ContentRange || undefined,
  };
}

export async function deleteFromR2(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}

export function isR2Key(url: string): boolean {
  return url.startsWith("r2/") || url.startsWith("logos/") || url.startsWith("uploads/") || url.startsWith("photos/") || url.startsWith("media/");
}

export function getR2Url(key: string): string {
  return `/api/files/${key}`;
}

// ── Call Assistant recordings (calls+crm lane, docs/call-assistant/LANES.md) ──
// Fixed-key put: recordings live at voice/<orgId>/<callSid>.wav so a re-upload
// of the same call overwrites instead of orphaning a second object.
export function r2Configured(): boolean {
  return !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

export async function putToR2Key(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!/^[A-Za-z0-9_\-./]+$/.test(key) || key.includes("..")) throw new Error("Invalid R2 key");
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}
