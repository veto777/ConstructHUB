/**
 * YouTube uploader for a finished walkthrough — DRY RUN BY DEFAULT, and NEVER RUN AGAINST GOOGLE YET.
 *
 *   tsx scripts/tutorials/youtube-upload.ts <helpKey> [--out analysis/video-out/<helpKey>]            what would be sent
 *   tsx scripts/tutorials/youtube-upload.ts <helpKey> --upload                                        send it
 *
 * Reads youtube.json (written by mux.ts) and the three files beside it: walkthrough.mp4, captions.srt,
 * thumbnail.jpg. A dry run checks that they exist and match youtube.json and prints the request it
 * would make. `--upload` refuses to start without YT_CLIENT_ID, YT_CLIENT_SECRET and YT_REFRESH_TOKEN
 * (an OAuth client and a refresh token granted the `youtube.upload` scope — plus `youtube.force-ssl`
 * for the captions track — by the owner of the channel named in youtube.json). None of the three
 * exists yet; they are read from the environment only and never printed.
 *
 * Every upload is PRIVATE: the owner watches it in YouTube Studio and publishes it. This tool has no
 * flag that makes a video public, and it never deletes or replaces a video.
 *
 * STATUS: written from the YouTube Data API v3 reference (videos.insert resumable upload,
 * thumbnails.set, captions.insert) and NOT TESTED against the API — there are no credentials. Expect
 * to fix details on the first real run; do that run on one video, by hand, with the owner watching.
 * Playlists are not handled: youtube.json names the playlist, the owner (or a later version) files it.
 */
import fs from "fs";
import path from "path";
import { ROOT, flagStr, parseArgs, sha256 } from "./lib";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com";

async function main() {
  const args = parseArgs(process.argv.slice(2), ["upload"]);
  const helpKey = args._[0];
  if (!helpKey) throw new Error("Usage: tsx scripts/tutorials/youtube-upload.ts <helpKey> [--out DIR] [--upload]");
  const dir = path.resolve(flagStr(args, "out") ?? path.join(ROOT, "analysis", "video-out", helpKey));
  const y = JSON.parse(fs.readFileSync(path.join(dir, "youtube.json"), "utf8"));
  if (y.helpKey !== helpKey) throw new Error(`${dir}/youtube.json is for ${y.helpKey}`);
  const file = (name: string) => { const p = path.join(dir, name); if (!fs.existsSync(p)) throw new Error(`${p} is missing`); return p; };
  const video = file(y.files.video), captions = file(y.files.captions), thumbnail = file(y.files.thumbnail);
  if (sha256(fs.readFileSync(video)) !== y.video.sha256) throw new Error("walkthrough.mp4 is not the encode youtube.json describes — run mux.ts again");
  if (y.title.length > 70 || y.tags.length > 12 || y.madeForKids !== false) throw new Error("youtube.json breaks the house rules (title ≤ 70, ≤ 12 tags, not made for kids)");
  if (fs.statSync(thumbnail).size > 2_000_000) throw new Error("thumbnail.jpg is over 2 MB");

  const body = {
    snippet: { title: y.title, description: y.description, tags: y.tags, categoryId: String(y.categoryId), defaultLanguage: y.defaultLanguage, defaultAudioLanguage: y.defaultAudioLanguage },
    // Always private: publishing is the owner's click in YouTube Studio.
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false, embeddable: true },
  };
  console.log(`${helpKey} → ${y.channel.name} (${y.channel.handle})`);
  console.log(`  video      ${path.basename(video)}  ${(fs.statSync(video).size / 1e6).toFixed(2)} MB  ${y.video.width}x${y.video.height}  ${y.video.durationSec}s  ${y.video.lufs} LUFS`);
  console.log(`  captions   ${path.basename(captions)}  (English, with timing)`);
  console.log(`  thumbnail  ${path.basename(thumbnail)}  ${(fs.statSync(thumbnail).size / 1000).toFixed(0)} kB`);
  console.log(`  title      ${y.title}\n  playlist   ${y.playlist} (to be filed by hand)\n  privacy    private`);
  if (!args.flags.upload) { console.log("dry run: nothing was sent. --upload sends it (needs YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN)."); return; }

  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) throw new Error("refusing to upload: set YT_CLIENT_ID, YT_CLIENT_SECRET and YT_REFRESH_TOKEN (see the header of this file)");

  const tokenRes = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: "refresh_token" }) });
  if (!tokenRes.ok) throw new Error(`Google refused the refresh token (${tokenRes.status})`);
  const auth = { Authorization: `Bearer ${(await tokenRes.json()).access_token}` };

  // The channel the token belongs to must be the one youtube.json names.
  const mine = await (await fetch(`${API}/youtube/v3/channels?part=id&mine=true`, { headers: auth })).json();
  if (mine?.items?.[0]?.id !== y.channel.id) throw new Error(`the token is for channel ${mine?.items?.[0]?.id ?? "?"}, not ${y.channel.id}`);

  // videos.insert, resumable: open the session with the metadata, then send the file.
  const data = fs.readFileSync(video);
  const open = await fetch(`${API}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(data.length) },
    body: JSON.stringify(body),
  });
  const session = open.headers.get("location");
  if (!open.ok || !session) throw new Error(`could not open the upload (${open.status}): ${(await open.text()).slice(0, 300)}`);
  const sent = await fetch(session, { method: "PUT", headers: { ...auth, "Content-Type": "video/mp4", "Content-Length": String(data.length) }, body: data });
  if (!sent.ok) throw new Error(`the upload failed (${sent.status}): ${(await sent.text()).slice(0, 300)}`);
  const id = (await sent.json()).id as string;
  console.log(`  uploaded: https://youtu.be/${id} (private)`);

  const thumb = await fetch(`${API}/upload/youtube/v3/thumbnails/set?videoId=${id}&uploadType=media`, { method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: fs.readFileSync(thumbnail) });
  console.log(thumb.ok ? "  thumbnail set" : `  ! thumbnail not set (${thumb.status}) — set it in YouTube Studio`);

  const boundary = `tut${Date.now()}`;
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ snippet: { videoId: id, language: "en", name: "English", isDraft: false } })}\r\n--${boundary}\r\nContent-Type: application/x-subrip\r\n\r\n`),
    fs.readFileSync(captions), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const cap = await fetch(`${API}/upload/youtube/v3/captions?uploadType=multipart&part=snippet`, { method: "POST", headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
  console.log(cap.ok ? "  captions added" : `  ! captions not added (${cap.status}) — upload captions.srt in YouTube Studio ("with timing")`);
  fs.writeFileSync(path.join(dir, "youtube-uploaded.json"), JSON.stringify({ helpKey, videoId: id, at: new Date().toISOString(), privacyStatus: "private" }, null, 2) + "\n");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
