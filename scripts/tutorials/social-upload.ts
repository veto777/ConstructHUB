/**
 * Put a video's social cuts where Blotato (and so Instagram, TikTok, LinkedIn…) can fetch them:
 * our own R2 bucket, served publicly by https://constructhub.us/api/tutorials/media/<name>.
 *
 *   npx tsx scripts/tutorials/social-upload.ts <helpKey>… [--out-dir DIR]… [--dry-run]
 *   npx tsx scripts/tutorials/social-upload.ts <helpKey>… --check        only ask the public address for each file
 *
 * Blotato needs nothing uploaded to it: "pass any publicly accessible URL in mediaUrls". The media
 * route serves `tutorials/<name>.<section>.<hash8>.(mp4|jpg)` (shared/help/videos.ts, TUTORIAL_FILE),
 * so a cut is stored as  tutorials/<helpKey>.social-<what>.<hash8>.<ext>  — <what> is vertical, tiktok,
 * feed, cover-vertical or cover-feed, <hash8> the first 8 hex digits of the file's sha256 — and is
 * reachable with the route as deployed today. (A help key that itself has a dot cannot be named this
 * way; none of the recorded videos has one.)
 *
 * CREATE-ONLY, like upload.ts: every put carries `If-None-Match: *`, an existing key is left alone
 * when its size matches and is an error when it does not, nothing is ever deleted. After the puts the
 * public address of every file is asked for its first bytes (a 206 with the right total length) and
 * social/hosted.json is written — social-post.ts posts only what that file lists.
 * R2 keys are read at run time from the live env file and never printed.
 */
import fs from "fs";
import path from "path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseArgs, readEnvFile, sha256 } from "./lib";
import { DEFAULT_OUT_DIRS } from "./social";
import { TUTORIAL_FILE, TUTORIAL_PREFIX } from "../../shared/help/videos";

export const PUBLIC_MEDIA = "https://constructhub.us/api/tutorials/media/";
const TYPES: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg" };
const R2_ENV_FILE = process.env.TUTORIAL_R2_ENV || "/home/voiceban/ConstructHUB-live/.env";
const R2_KEYS = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
/** social/<file> → the <what> of its key. */
export const SOCIAL_FILES: Record<string, string> = {
  "vertical.mp4": "vertical", "vertical-tiktok.mp4": "tiktok", "feed.mp4": "feed", "cover-vertical.jpg": "cover-vertical", "cover-feed.jpg": "cover-feed",
};
export type Hosted = { helpKey: string; files: Record<string, { key: string; url: string; bytes: number; sha256: string; etag?: string; verifiedAt?: string }> };

/** The storage key of one social file, or an error when the media route could not serve it. */
export function socialKey(helpKey: string, file: string, hash: string): string {
  const what = SOCIAL_FILES[file];
  if (!what) throw new Error(`${file} is not a social file`);
  const name = `${helpKey}.social-${what}.${hash.slice(0, 8)}.${file.slice(file.lastIndexOf(".") + 1)}`;
  if (!TUTORIAL_FILE.test(name)) throw new Error(`${name} is not a name the media route serves (a help key with a dot needs the route extended)`);
  return `${TUTORIAL_PREFIX}${name}`;
}

/** Ask the public address for the first bytes: Instagram and TikTok fetch with ranges, and so do we. */
async function reachable(url: string, bytes: number): Promise<string | null> {
  const res = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(30_000) });
  await res.arrayBuffer();
  const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1]);
  if (res.status !== 206) return `answered ${res.status}, not 206`;
  if (total !== bytes) return `is ${total} bytes there, ${bytes} here`;
  const type = res.headers.get("content-type") ?? "";
  return type.startsWith(TYPES[url.slice(url.lastIndexOf(".") + 1)]) ? null : `has content type ${type}`;
}

async function main() {
  const argv = process.argv.slice(2), args = parseArgs(argv, ["dry-run", "check"]);
  const dirs: string[] = [];
  argv.forEach((a, i) => { if (a === "--out-dir" && argv[i + 1]) dirs.push(path.resolve(argv[i + 1])); });
  const outDirs = (dirs.length ? dirs : DEFAULT_OUT_DIRS).filter((d) => fs.existsSync(d));
  if (!args._.length) throw new Error("Usage: npx tsx scripts/tutorials/social-upload.ts <helpKey>… [--out-dir DIR]… [--dry-run | --check]");
  const dry = !!args.flags["dry-run"], checkOnly = !!args.flags.check;

  let s3: S3Client | null = null, Bucket = "constructhub";
  if (!dry && !checkOnly) {
    const env: Record<string, string | undefined> = Object.fromEntries(R2_KEYS.map((k) => [k, process.env[k]]));
    if (R2_KEYS.slice(0, 3).some((k) => !env[k]) && fs.existsSync(R2_ENV_FILE)) for (const [k, v] of Object.entries(readEnvFile(R2_ENV_FILE, R2_KEYS))) env[k] ||= v;
    if (R2_KEYS.slice(0, 3).some((k) => !env[k])) throw new Error(`R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not set and not in ${R2_ENV_FILE}`);
    Bucket = env.R2_BUCKET_NAME || Bucket;
    s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! } });
  }
  const head = async (Key: string): Promise<{ bytes: number; etag: string } | null> => {
    try { const r = await s3!.send(new HeadObjectCommand({ Bucket, Key })); return { bytes: Number(r.ContentLength), etag: String(r.ETag ?? "").replace(/"/g, "") }; }
    catch (e: any) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return null; throw e; }
  };

  let problems = 0;
  for (const helpKey of args._) {
    const folder = outDirs.map((d) => path.join(d, helpKey, "social")).find((d) => fs.existsSync(path.join(d, "social.json")));
    if (!folder) throw new Error(`${helpKey}: no social cuts (social/social.json) in ${outDirs.join(", ")} — run social.ts first`);
    const social = JSON.parse(fs.readFileSync(path.join(folder, "social.json"), "utf8"));
    const measured: Record<string, string | undefined> = {
      "vertical.mp4": social.cuts?.vertical?.sha256, "vertical-tiktok.mp4": social.cuts?.vertical?.tiktok?.sha256, "feed.mp4": social.cuts?.feed?.sha256,
    };
    const hostedFile = path.join(folder, "hosted.json");
    const hosted: Hosted = { helpKey, files: {} };
    console.log(`${helpKey}  (${folder})`);
    for (const file of Object.keys(SOCIAL_FILES)) {
      if (!fs.existsSync(path.join(folder, file))) throw new Error(`${helpKey}: ${file} is missing — run social.ts again`);
      const data = fs.readFileSync(path.join(folder, file)), hash = sha256(data);
      // What goes up is the file social.ts measured and a person looked at.
      if (measured[file] && measured[file] !== hash) throw new Error(`${helpKey}: ${file} is not the file social.json describes — run social.ts again`);
      const key = socialKey(helpKey, file, hash), url = `${PUBLIC_MEDIA}${key.slice(TUTORIAL_PREFIX.length)}`;
      let etag: string | undefined;
      if (dry) console.log(`  + ${key}  would upload ${data.length} bytes`);
      else if (!checkOnly) {
        const there = await head(key);
        if (there && there.bytes !== data.length) throw new Error(`${key} exists in R2 with ${there.bytes} bytes, expected ${data.length} — refusing to touch it`);
        if (there) { etag = there.etag; console.log(`  = ${key}  already there (${there.bytes} bytes)`); }
        else {
          await s3!.send(new PutObjectCommand({ Bucket, Key: key, Body: data, ContentType: TYPES[file.slice(file.lastIndexOf(".") + 1)], CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*" }));
          const after = await head(key);
          if (!after || after.bytes !== data.length) throw new Error(`${key}: uploaded, but R2 reports ${after?.bytes ?? "no object"}`);
          etag = after.etag;
          console.log(`  + ${key}  uploaded ${after.bytes} bytes`);
        }
      }
      if (dry) continue;
      const wrong = await reachable(url, data.length);
      if (wrong) { problems++; console.log(`  ✗ ${url}  ${wrong}`); continue; }
      console.log(`  ✓ ${url}  206, ${data.length} bytes`);
      hosted.files[file] = { key, url, bytes: data.length, sha256: hash, ...(etag ? { etag } : {}), verifiedAt: new Date().toISOString() };
    }
    if (!dry && Object.keys(hosted.files).length === Object.keys(SOCIAL_FILES).length) { fs.writeFileSync(hostedFile, JSON.stringify(hosted, null, 2) + "\n"); console.log(`  → ${hostedFile}`); }
  }
  if (problems) { console.error(`${problems} file(s) are not reachable at their public address`); process.exit(1); }
  if (dry) console.log("dry run: nothing was sent");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
