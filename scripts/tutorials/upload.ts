/**
 * Upload — stage 5 of docs/tutorials/VIDEO-PIPELINE.md. Puts a walkthrough's three files (the video,
 * its captions, its poster) in R2 and THEN writes the video's manifest file,
 * shared/help/videos/<helpKey>.json — the file that makes the player appear in the app.
 *
 *   tsx scripts/tutorials/upload.ts <helpKey> [--out analysis/video-out/<helpKey>] [--dry-run]
 *   tsx scripts/tutorials/upload.ts <helpKey> --check     HEAD the manifest's keys; compare size and ETag
 *   tsx scripts/tutorials/upload.ts <helpKey> --adopt     a manifest without upload proof: HEAD, record the ETags
 *
 * CREATE-ONLY. It never deletes and never overwrites:
 *   · a key that already exists is left alone — "already there" when its size matches, and a hard
 *     error when it does not (a hash-named key with other content is a bug);
 *   · each put carries `If-None-Match: *`, so even a race cannot replace an object.
 * Before anything is sent, every local file is checked against what mux.ts measured (video.json:
 * bytes and sha256). The manifest is written only after R2 has answered a HEAD for all three keys,
 * and it records the ETags R2 gave — the registry test refuses a video whose manifest has no such
 * proof. The three files are also copied to the dev store (tmp/tutorials/) so a dev server plays them.
 *
 * Credentials: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME from the
 * environment, else read (read-only, at run time) from the live env file. Never printed.
 */
import fs from "fs";
import path from "path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { LOCAL_STORE, ROOT, flagStr, parseArgs, readEnvFile, sha256 } from "./lib";
import { writeIndexes } from "./gen-index";
import { TUTORIAL_FILE, TUTORIAL_PREFIX, type VideoFile, type VideoManifestEntry } from "../../shared/help/videos";

const TYPES: Record<string, string> = { mp4: "video/mp4", vtt: "text/vtt; charset=utf-8", jpg: "image/jpeg" };
const R2_ENV_FILE = process.env.TUTORIAL_R2_ENV || "/home/voiceban/ConstructHUB-live/.env";
const R2_KEYS = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const manifestPath = (helpKey: string) => path.join(ROOT, "shared/help/videos", `${helpKey}.json`);
const PARTS = ["video", "captions", "poster"] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2), ["check", "dry-run", "adopt"]);
  const helpKey = args._[0];
  if (!helpKey || !/^[a-z0-9-]+(\.[a-z0-9-]+)?$/.test(helpKey)) throw new Error("Usage: tsx scripts/tutorials/upload.ts <helpKey> [--check | --adopt | --dry-run]");
  const checkOnly = !!args.flags.check, adopt = !!args.flags.adopt, dry = !!args.flags["dry-run"];
  const dir = path.resolve(flagStr(args, "out") ?? path.join(ROOT, "analysis", "video-out", helpKey));

  // What is to be in R2: from the committed manifest (--check, --adopt) or from what mux.ts just measured.
  let durationSec: number, files: Record<(typeof PARTS)[number], VideoFile & { file?: string }>;
  if (checkOnly || adopt) {
    if (!fs.existsSync(manifestPath(helpKey))) throw new Error(`${helpKey} has no manifest (shared/help/videos/${helpKey}.json)`);
    const m = JSON.parse(fs.readFileSync(manifestPath(helpKey), "utf8")) as VideoManifestEntry;
    durationSec = m.durationSec; files = { video: m.video, captions: m.captions, poster: m.poster };
  } else {
    const built = JSON.parse(fs.readFileSync(path.join(dir, "video.json"), "utf8"));
    if (built.helpKey !== helpKey) throw new Error(`${dir}/video.json is for ${built.helpKey}`);
    durationSec = built.durationSec; files = built.files;
  }
  const bodies = new Map<string, Buffer>();
  for (const part of PARTS) {
    const f = files[part], name = f.key.slice(TUTORIAL_PREFIX.length);
    if (!f.key.startsWith(TUTORIAL_PREFIX) || !TUTORIAL_FILE.test(name) || !f.key.startsWith(`${TUTORIAL_PREFIX}${helpKey}.`)) throw new Error(`${f.key}: not a tutorial media key of ${helpKey}`);
    if (checkOnly || adopt) continue;
    // What goes up is what was measured — verified before the first request.
    const data = fs.readFileSync(path.join(dir, f.file!));
    if (data.length !== f.bytes || sha256(data) !== f.sha256) throw new Error(`${f.file} on disk is not the file video.json describes — run mux.ts again`);
    bodies.set(f.key, data);
  }

  const env: Record<string, string | undefined> = Object.fromEntries(R2_KEYS.map((k) => [k, process.env[k]]));
  if (R2_KEYS.slice(0, 3).some((k) => !env[k]) && fs.existsSync(R2_ENV_FILE)) for (const [k, v] of Object.entries(readEnvFile(R2_ENV_FILE, R2_KEYS))) env[k] ||= v;
  if (R2_KEYS.slice(0, 3).some((k) => !env[k])) throw new Error(`R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not set and not in ${R2_ENV_FILE}`);
  const Bucket = env.R2_BUCKET_NAME || "constructhub";
  const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! } });
  const head = async (Key: string): Promise<{ bytes: number; contentType?: string; etag: string } | null> => {
    try {
      const r = await s3.send(new HeadObjectCommand({ Bucket, Key }));
      return { bytes: Number(r.ContentLength), contentType: r.ContentType, etag: String(r.ETag ?? "").replace(/"/g, "") };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return null;
      throw e;
    }
  };

  const etags: Partial<Record<(typeof PARTS)[number], string>> = {};
  const committed = checkOnly ? (JSON.parse(fs.readFileSync(manifestPath(helpKey), "utf8")) as VideoManifestEntry).uploaded : undefined;
  let problems = 0;
  for (const part of PARTS) {
    const f = files[part], ext = f.key.slice(f.key.lastIndexOf(".") + 1);
    const there = await head(f.key);
    if (there) {
      if (there.bytes !== f.bytes) throw new Error(`${f.key} exists in R2 with ${there.bytes} bytes, expected ${f.bytes} — refusing to touch it`);
      if (checkOnly && committed?.[part] !== there.etag) { problems++; console.log(`  ✗ ${f.key}  ETag in R2 is not the one in the manifest`); continue; }
      etags[part] = there.etag;
      console.log(`  = ${f.key}  ${checkOnly || adopt ? "in R2" : "already there"} (${there.bytes} bytes, ${there.contentType})`);
      continue;
    }
    if (checkOnly || adopt) { problems++; console.log(`  ✗ ${f.key}  not in R2`); continue; }
    if (dry) { console.log(`  + ${f.key}  would upload ${f.bytes} bytes as ${TYPES[ext]}`); continue; }
    await s3.send(new PutObjectCommand({
      Bucket, Key: f.key, Body: bodies.get(f.key)!, ContentType: TYPES[ext],
      CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*",
    }));
    const after = await head(f.key);
    if (!after || after.bytes !== f.bytes) throw new Error(`${f.key}: uploaded, but R2 reports ${after?.bytes ?? "no object"} — check the bucket`);
    etags[part] = after.etag;
    console.log(`  + ${f.key}  uploaded ${after.bytes} bytes (${after.contentType})`);
  }
  if (problems) { console.error(`${problems} file(s) of ${helpKey} are not in R2 as the manifest describes`); process.exit(1); }
  if (checkOnly) { console.log(`${helpKey}: all three files are in R2 with the manifest's sizes and ETags`); return; }
  if (dry) { console.log("dry run: nothing was sent, no manifest written"); return; }

  // All three are in R2: the manifest may say so.
  const strip = ({ key, bytes, sha256: hash }: VideoFile): VideoFile => ({ key, bytes, sha256: hash });
  const previous = adopt ? (JSON.parse(fs.readFileSync(manifestPath(helpKey), "utf8")) as Partial<VideoManifestEntry>).uploaded : undefined;
  const entry: VideoManifestEntry = {
    helpKey, durationSec, video: strip(files.video), captions: strip(files.captions), poster: strip(files.poster),
    uploaded: { at: previous?.at ?? new Date().toISOString(), video: etags.video!, captions: etags.captions!, poster: etags.poster! },
  };
  fs.mkdirSync(path.dirname(manifestPath(helpKey)), { recursive: true });
  fs.writeFileSync(manifestPath(helpKey), JSON.stringify(entry, null, 2) + "\n");
  writeIndexes();
  if (!adopt) {
    fs.mkdirSync(LOCAL_STORE, { recursive: true });
    for (const part of PARTS) fs.copyFileSync(path.join(dir, files[part].file!), path.join(LOCAL_STORE, files[part].key.slice(TUTORIAL_PREFIX.length)));
  }
  console.log(`${helpKey}: in R2 · manifest → shared/help/videos/${helpKey}.json (commit it with the step script)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
