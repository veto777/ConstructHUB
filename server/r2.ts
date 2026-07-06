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
  extension: string = "jpg"
): Promise<string> {
  const key = `${folder}/${randomUUID()}.${extension}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return key;
}

export async function getFromR2(key: string): Promise<{ body: ReadableStream | null; contentType: string }> {
  const result = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));

  return {
    body: result.Body as any,
    contentType: result.ContentType || "application/octet-stream",
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
