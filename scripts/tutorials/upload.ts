/**
 * Upload — stage 5 of docs/tutorials/VIDEO-PIPELINE.md. Puts a walkthrough's three files in R2 under
 * the keys the manifest lists (shared/help/videos.json), so the deployed app can serve them from
 * GET /api/tutorials/media/:file.
 *
 *   tsx scripts/tutorials/upload.ts <helpKey> [--from tmp/tutorials] [--check] [--dry-run]
 *
 * CREATE-ONLY. It never deletes and never overwrites:
 *   · a key that already exists is left alone — reported as "already there" when its size matches the
 *     manifest, and a hard error when it does not (a hash-named key with other content is a bug);
 *   · each put carries `If-None-Match: *`, so even a race cannot replace an object.
 * Before anything is sent, every local file is checked against the manifest (bytes and sha256): what
 * is uploaded is exactly what was measured and committed. `--check` only looks (HEAD), `--dry-run`
 * says what it would do.
 *
 * Credentials come from the environment and are never printed:
 *   R2_ENDPOINT  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET_NAME
 */
import fs from "fs";
import path from "path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { LOCAL_STORE, flagStr, parseArgs, sha256 } from "./lib";
import { TUTORIAL_FILE, TUTORIAL_PREFIX, VIDEO_MANIFEST } from "../../shared/help/videos";

const TYPES: Record<string, string> = { mp4: "video/mp4", vtt: "text/vtt; charset=utf-8", jpg: "image/jpeg" };

async function main() {
  const args = parseArgs(process.argv.slice(2), ["check", "dry-run"]);
  const helpKey = args._[0];
  const entry = helpKey ? VIDEO_MANIFEST[helpKey] : undefined;
  if (!entry) throw new Error(`Usage: tsx scripts/tutorials/upload.ts <helpKey>   (in videos.json: ${Object.keys(VIDEO_MANIFEST).join(", ") || "none"})`);
  const from = path.resolve(flagStr(args, "from", LOCAL_STORE)!);
  const checkOnly = !!args.flags.check, dry = !!args.flags["dry-run"];

  const files = [entry.video, entry.captions, entry.poster].map((f) => {
    const name = f.key.slice(TUTORIAL_PREFIX.length);
    if (!f.key.startsWith(TUTORIAL_PREFIX) || !TUTORIAL_FILE.test(name)) throw new Error(`${f.key}: not a tutorial media key`);
    return { ...f, name, contentType: TYPES[name.slice(name.lastIndexOf(".") + 1)] };
  });
  // What goes up is what the manifest describes — verified before the first request.
  const bodies = new Map<string, Buffer>();
  if (!checkOnly) for (const f of files) {
    const data = fs.readFileSync(path.join(from, f.name));
    if (data.length !== f.bytes || sha256(data) !== f.sha256) throw new Error(`${f.name} on disk is not the file in videos.json — run mux.ts --publish again`);
    bodies.set(f.key, data);
  }

  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error("Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (and R2_BUCKET_NAME)");
  const Bucket = process.env.R2_BUCKET_NAME || "constructhub";
  const s3 = new S3Client({ region: "auto", endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
  const head = async (Key: string): Promise<{ bytes: number; contentType?: string } | null> => {
    try {
      const r = await s3.send(new HeadObjectCommand({ Bucket, Key }));
      return { bytes: Number(r.ContentLength), contentType: r.ContentType };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return null;
      throw e;
    }
  };

  let missing = 0;
  for (const f of files) {
    const there = await head(f.key);
    if (there) {
      if (there.bytes !== f.bytes) throw new Error(`${f.key} exists in R2 with ${there.bytes} bytes, the manifest says ${f.bytes} — refusing to touch it`);
      console.log(`  = ${f.key}  already there (${there.bytes} bytes, ${there.contentType})`);
      continue;
    }
    if (checkOnly) { missing++; console.log(`  ✗ ${f.key}  not in R2`); continue; }
    if (dry) { console.log(`  + ${f.key}  would upload ${f.bytes} bytes as ${f.contentType}`); continue; }
    await s3.send(new PutObjectCommand({
      Bucket, Key: f.key, Body: bodies.get(f.key)!, ContentType: f.contentType,
      CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*",
    }));
    const after = await head(f.key);
    if (!after || after.bytes !== f.bytes) throw new Error(`${f.key}: uploaded, but R2 reports ${after?.bytes ?? "no object"} — check the bucket`);
    console.log(`  + ${f.key}  uploaded ${after.bytes} bytes (${after.contentType})`);
  }
  if (missing) { console.error(`${missing} file(s) of ${helpKey} are not in R2`); process.exit(1); }
  console.log(checkOnly ? `${helpKey}: all ${files.length} files are in R2 with the manifest's sizes` : dry ? "dry run: nothing was sent" : `${helpKey}: done`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
