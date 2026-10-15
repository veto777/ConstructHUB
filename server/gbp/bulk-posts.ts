/**
 * Bulk posts: drop a folder of photos and the listing gets one Google post a day (or every N days), each with a
 * short AI caption written from the photo, published at a random minute inside the owner's window so the
 * cadence never looks machine-made (owner 2026-10-15: "dump 300 photos and the algo actually takes a photo a day
 * and gives it a snappy description for google posts and submits daily at random times").
 *
 * Sources: photos already uploaded to the library; a FileLoaded project (its flp_/flg_ key, stored encrypted);
 * a Dropbox shared folder link (downloaded once as a zip). Every source ends up as library photos in a folder
 * named after the run, so the drip itself has one shape.
 *
 * Flow: a run is created (status importing) → the worker imports the photos a batch at a time → every photo gets
 * its day and random time (status active) → within 36 hours of a time the worker writes the caption and queues
 * the post through the ordinary content queue (gbp_content_jobs), which publishes it on time and keeps the
 * history → the run is done when every item is published or failed. Nothing is drafted far ahead, so an
 * owner who pauses a run on day 3 has paid for 3 captions, not 300.
 */
import { z } from 'zod';
import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { unzipSync } from 'fflate';
import { pool } from '../db';
import { GoogleError } from './client';
import { ownedLocation } from './service';
import { enqueue, photosFor, publicPhotoUrl, draftPrompt, generateDraft, requireAutoPosts, AutoPostsRequired, type DraftAI } from './content';
import { preparePhoto, seoName } from './content-upload';
import { getR2Url } from '../r2';
import { encryptToken, decryptToken } from './token-crypto';
import { sendModuleRequired } from '../entitlements';
import { takeBudget } from '../growth-limits';
import { recordFailure } from '../ops/issues';
import { fitChars } from '../ai-output';
import { workerInterval } from "../workers";

export async function ensureBulkPostsSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS gbp_bulk_posts (
    id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id integer NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
    name text NOT NULL, source text NOT NULL, source_ref jsonb NOT NULL DEFAULT '{}'::jsonb, folder_id integer,
    status text NOT NULL DEFAULT 'importing', every_days integer NOT NULL DEFAULT 1, start_on date NOT NULL,
    timezone text NOT NULL, open_hour integer NOT NULL DEFAULT 9, close_hour integer NOT NULL DEFAULT 17,
    weekdays integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}', instructions text NOT NULL DEFAULT '',
    total integer NOT NULL DEFAULT 0, imported integer NOT NULL DEFAULT 0, error text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS gbp_bulk_post_items (
    id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES gbp_bulk_posts(id) ON DELETE CASCADE,
    position integer NOT NULL, photo_id integer, source_name text, request_key uuid NOT NULL DEFAULT gen_random_uuid(),
    due_at timestamptz, status text NOT NULL DEFAULT 'pending', caption text, job_id bigint, error text,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id, position));
  CREATE INDEX IF NOT EXISTS gbp_bulk_items_due ON gbp_bulk_post_items(due_at) WHERE status='pending';`);
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
/** The file-drop service's API base (an optional connector; the customer brings their own project key). Unset = the
 * FileLoaded option is hidden. Configured, never written in code: this product's code names only its own hosts. */
export const fileDropBase = () => (process.env.BULK_POSTS_FILEDROP_API_BASE || '').replace(/\/$/, '');
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_BYTES = 400 * 1024 * 1024;
const MAX_PHOTOS = 400;

export const createInput = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.enum(['library', 'fileloaded', 'dropbox']),
  photoIds: z.array(z.number().int().positive()).max(MAX_PHOTOS).default([]),
  fileloaded: z.object({ slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,80}$/i), key: z.string().trim().regex(/^fl[gp]_[A-Za-z0-9_-]{8,200}$/) }).optional(),
  dropbox: z.object({ url: z.string().trim().url().max(1000) }).optional(),
  everyDays: z.number().int().min(1).max(30).default(1),
  startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().max(100),
  openHour: z.number().int().min(0).max(23).default(9),
  closeHour: z.number().int().min(1).max(24).default(17),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  instructions: z.string().trim().max(2000).default(''),
});

/** The minutes a zone is ahead of UTC at an instant (Intl, so DST is right). */
function tzOffsetMinutes(at: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - at) / 60000);
}
/** The instant of a wall-clock time on a calendar day in a zone. */
export function zonedInstant(day: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  guess -= tzOffsetMinutes(guess, timeZone) * 60000;
  guess = Date.UTC(y, m - 1, d, hour, minute) - tzOffsetMinutes(guess, timeZone) * 60000;
  return new Date(guess);
}
const addDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const weekdayOf = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();

/** One instant per photo: every N days from the start, allowed weekdays only, a random minute inside the window. */
export function planTimes(count: number, o: { everyDays: number; startOn: string; timezone: string; openHour: number; closeHour: number; weekdays: number[] }, rand: () => number = Math.random): Date[] {
  if (o.closeHour <= o.openHour) throw new GoogleError('invalid', 'The posting window must close after it opens', 400);
  try { new Intl.DateTimeFormat('en-US', { timeZone: o.timezone }); } catch { throw new GoogleError('invalid', 'Invalid timezone', 400); }
  const out: Date[] = [];
  let day = o.startOn;
  const now = Date.now();
  while (out.length < count) {
    if (o.weekdays.includes(weekdayOf(day))) {
      const span = (o.closeHour - o.openHour) * 60;
      const minute = Math.floor(rand() * span);
      let at = zonedInstant(day, o.openHour + Math.floor(minute / 60), minute % 60, o.timezone);
      // A start day that is already past its window: the first post goes out a few minutes from now.
      if (at.getTime() < now) at = new Date(now + (5 + Math.floor(rand() * 40)) * 60000);
      out.push(at);
      day = addDays(day, o.everyDays);
    } else day = addDays(day, 1);
  }
  return out;
}

async function runFolder(user: number, name: string) {
  const label = `Bulk posts: ${name}`.slice(0, 120);
  const { rows: [f] } = await pool.query('SELECT id FROM media_folders WHERE user_id=$1 AND name=$2 ORDER BY id LIMIT 1', [user, label]);
  if (f) return f.id as number;
  return (await pool.query('INSERT INTO media_folders(user_id,name) VALUES($1,$2) RETURNING id', [user, label])).rows[0].id as number;
}

/** A downloaded image becomes a library photo (processed like an upload: JPEG, SEO filename). */
async function storePhoto(user: number, folderId: number, loc: any, bytes: Buffer, index: number): Promise<number> {
  const name = seoName('{business}-{n}', loc.business_name, loc.city || '', index);
  const p = await preparePhoto(bytes, name, { title: loc.business_name });
  const { rows: [photo] } = await pool.query('INSERT INTO media_photos(user_id,folder_id,name,url,r2_key,size) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [user, folderId, name, getR2Url(p.key), p.key, p.size]);
  return photo.id;
}

type Fetch = typeof fetch;

/** FileLoaded: the project's image files (name + id), newest last so a numbered folder posts in order. */
export async function listFileloaded(slug: string, key: string, http: Fetch = fetch): Promise<{ id: string; name: string; size: number }[]> {
  const base = fileDropBase();
  if (!base) throw new GoogleError('invalid', 'The FileLoaded connector is not configured on this server', 400);
  const r = await http(`${base}/api/p/${encodeURIComponent(slug)}/files`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw new GoogleError('invalid', 'FileLoaded refused that key. Check the project key (flp_…) or use a global key (flg_…).', 400);
  if (r.status === 404) throw new GoogleError('invalid', 'FileLoaded has no project with that name.', 400);
  if (!r.ok) throw new GoogleError('transient', `FileLoaded answered ${r.status}`, 502);
  const body: any = await r.json();
  const files: any[] = Array.isArray(body) ? body : Array.isArray(body?.files) ? body.files : [];
  return files
    .filter((f) => typeof f?.name === 'string' && IMAGE_RE.test(f.name) && (f.size == null || f.size <= MAX_PHOTO_BYTES))
    .map((f) => ({ id: String(f.id), name: String(f.name), size: Number(f.size ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_PHOTOS);
}

async function downloadFileloaded(slug: string, key: string, id: string, http: Fetch = fetch): Promise<Buffer> {
  const r = await http(`${fileDropBase()}/api/p/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}/download`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`FileLoaded download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) throw new Error('Photo over 25 MB');
  return buf;
}

/** A Dropbox shared folder link as a zip. Only dropbox.com hosts; ?dl=1 asks for the download. */
export function dropboxZipUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new GoogleError('invalid', 'Paste the Dropbox shared link', 400); }
  if (!/^(www\.)?dropbox\.com$/.test(u.hostname)) throw new GoogleError('invalid', 'That is not a dropbox.com link', 400);
  u.protocol = 'https:'; u.searchParams.set('dl', '1');
  return u.toString();
}
async function downloadDropboxZip(url: string, http: Fetch = fetch): Promise<{ name: string; bytes: Buffer }[]> {
  const r = await http(url, { redirect: 'follow', signal: AbortSignal.timeout(600000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; ConstructHUB bulk posts)' } });
  if (!r.ok) throw new Error(`Dropbox answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_ZIP_BYTES) throw new Error('The Dropbox folder is over 400 MB; split it into smaller folders');
  const type = r.headers.get('content-type') || '';
  // A link to one image downloads the image itself.
  if (/^image\//.test(type)) return [{ name: 'photo.jpg', bytes: buf }];
  const entries = unzipSync(new Uint8Array(buf));
  return Object.entries(entries)
    .filter(([name, data]) => IMAGE_RE.test(name) && !name.includes('__MACOSX') && !/(^|\/)\./.test(name) && data.length > 0 && data.length <= MAX_PHOTO_BYTES)
    .map(([name, data]) => ({ name, bytes: Buffer.from(data) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_PHOTOS);
}

/** Create a run. Library photos are planned at once; FileLoaded and Dropbox runs import in the worker. */
export async function createRun(user: number, location: number, raw: unknown, http: Fetch = fetch) {
  await requireAutoPosts(user);
  const b = createInput.parse(raw);
  const loc = await ownedLocation(user, location);
  if (!loc.gbp_location_name) throw new GoogleError('invalid', 'Link this location to its Google Business Profile first', 409);
  const plan = { everyDays: b.everyDays, startOn: b.startOn, timezone: b.timezone, openHour: b.openHour, closeHour: b.closeHour, weekdays: b.weekdays };
  planTimes(1, plan); // validates the window and zone before anything is stored
  let sourceRef: any = {}, total = 0, status = 'importing';
  let photoIds: number[] = [];
  if (b.source === 'library') {
    if (!b.photoIds.length) throw new GoogleError('invalid', 'Choose or upload at least one photo', 400);
    photoIds = (await photosFor(user, b.photoIds)).map((p) => p.id);
    total = photoIds.length; status = 'active';
  } else if (b.source === 'fileloaded') {
    if (!b.fileloaded) throw new GoogleError('invalid', 'Enter the FileLoaded project and key', 400);
    const files = await listFileloaded(b.fileloaded.slug, b.fileloaded.key, http);
    if (!files.length) throw new GoogleError('invalid', 'No JPEG, PNG or WebP photos in that FileLoaded project', 400);
    sourceRef = { slug: b.fileloaded.slug, keyEnc: encryptToken(b.fileloaded.key), files };
    total = files.length;
  } else {
    if (!b.dropbox) throw new GoogleError('invalid', 'Paste the Dropbox shared link', 400);
    sourceRef = { url: dropboxZipUrl(b.dropbox.url) };
    total = 0; // known after the zip is opened
  }
  const folderId = await runFolder(user, b.name);
  const { rows: [run] } = await pool.query(`INSERT INTO gbp_bulk_posts(user_id,location_id,name,source,source_ref,folder_id,status,every_days,start_on,timezone,open_hour,close_hour,weekdays,instructions,total,imported)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [user, location, b.name, b.source, JSON.stringify(sourceRef), folderId, status, b.everyDays, b.startOn, b.timezone, b.openHour, b.closeHour, b.weekdays, b.instructions, total, photoIds.length]);
  if (photoIds.length) {
    const times = planTimes(photoIds.length, plan);
    for (let i = 0; i < photoIds.length; i++)
      await pool.query('INSERT INTO gbp_bulk_post_items(run_id,position,photo_id,due_at) VALUES($1,$2,$3,$4)', [run.id, i, photoIds[i], times[i]]);
  }
  return runView(run.id);
}

export async function runView(id: number) {
  const { rows: [run] } = await pool.query('SELECT * FROM gbp_bulk_posts WHERE id=$1', [id]);
  if (!run) throw new GoogleError('invalid', 'Run not found', 404);
  const { rows: items } = await pool.query(`SELECT i.id,i.position,i.photo_id,i.source_name,i.due_at,i.status,i.caption,i.job_id,i.error,p.url AS photo_url
    FROM gbp_bulk_post_items i LEFT JOIN media_photos p ON p.id=i.photo_id WHERE i.run_id=$1 ORDER BY i.position`, [id]);
  const { source_ref: _secret, ...safe } = run;
  const counts = { pending: 0, queued: 0, published: 0, failed: 0, skipped: 0 } as Record<string, number>;
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const next = items.find((i) => (i.status === 'pending' || i.status === 'queued') && i.due_at)?.due_at ?? null;
  return { ...safe, sourceLabel: run.source === 'fileloaded' ? `FileLoaded · ${run.source_ref?.slug ?? ''}` : run.source === 'dropbox' ? 'Dropbox folder' : 'Library photos', counts, next, items };
}

export async function listRuns(user: number, location: number) {
  const { rows } = await pool.query('SELECT id FROM gbp_bulk_posts WHERE user_id=$1 AND location_id=$2 ORDER BY created_at DESC LIMIT 50', [user, location]);
  return Promise.all(rows.map((r) => runView(r.id)));
}

/** Pause keeps everything; resume re-plans the remaining pending items from today; cancel skips what is left. */
export async function setRunStatus(user: number, location: number, id: number, action: 'pause' | 'resume' | 'cancel') {
  const { rows: [run] } = await pool.query('SELECT * FROM gbp_bulk_posts WHERE id=$1 AND user_id=$2 AND location_id=$3', [id, user, location]);
  if (!run) throw new GoogleError('invalid', 'Run not found', 404);
  if (action === 'pause' && ['active', 'importing'].includes(run.status)) await pool.query("UPDATE gbp_bulk_posts SET status='paused',updated_at=now() WHERE id=$1", [id]);
  if (action === 'resume' && run.status === 'paused') {
    const { rows: pending } = await pool.query("SELECT id FROM gbp_bulk_post_items WHERE run_id=$1 AND status='pending' ORDER BY position", [id]);
    const today = new Date().toISOString().slice(0, 10);
    const times = planTimes(pending.length, { everyDays: run.every_days, startOn: today, timezone: run.timezone, openHour: run.open_hour, closeHour: run.close_hour, weekdays: run.weekdays });
    for (let i = 0; i < pending.length; i++) await pool.query('UPDATE gbp_bulk_post_items SET due_at=$2 WHERE id=$1', [pending[i].id, times[i]]);
    await pool.query("UPDATE gbp_bulk_posts SET status=CASE WHEN imported<total OR total=0 THEN 'importing' ELSE 'active' END,updated_at=now() WHERE id=$1", [id]);
  }
  if (action === 'cancel' && run.status !== 'done') {
    await pool.query("UPDATE gbp_bulk_post_items SET status='skipped' WHERE run_id=$1 AND status='pending'", [id]);
    // Queued posts that have not gone out yet are cancelled in the content queue too.
    await pool.query("UPDATE gbp_content_jobs j SET status='cancelled' FROM gbp_bulk_post_items i WHERE i.run_id=$1 AND i.job_id=j.id AND j.status='queued'", [id]);
    await pool.query("UPDATE gbp_bulk_post_items SET status='skipped' WHERE run_id=$1 AND status='queued'", [id]);
    await pool.query("UPDATE gbp_bulk_posts SET status='done',updated_at=now() WHERE id=$1", [id]);
  }
  return runView(id);
}

/** Import a batch for one run (FileLoaded: 15 files per tick; Dropbox: the whole zip once), then plan the days. */
async function importTick(run: any, http: Fetch) {
  const loc = (await pool.query('SELECT * FROM business_locations WHERE id=$1', [run.location_id])).rows[0];
  if (!loc) { await pool.query("UPDATE gbp_bulk_posts SET status='done',error='Location deleted' WHERE id=$1", [run.id]); return; }
  const ref = run.source_ref || {};
  let imported = run.imported as number, total = run.total as number;
  if (run.source === 'fileloaded') {
    const key = decryptToken(ref.keyEnc);
    if (!key) throw new Error('FileLoaded key missing');
    const files: { id: string; name: string }[] = ref.files || [];
    const batch = files.slice(imported, imported + 15);
    for (const f of batch) {
      try {
        const bytes = await downloadFileloaded(ref.slug, key, f.id, http);
        const photoId = await storePhoto(run.user_id, run.folder_id, loc, bytes, imported);
        await pool.query('INSERT INTO gbp_bulk_post_items(run_id,position,photo_id,source_name) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,position) DO NOTHING', [run.id, imported, photoId, f.name]);
      } catch (e: any) {
        await pool.query("INSERT INTO gbp_bulk_post_items(run_id,position,source_name,status,error) VALUES($1,$2,$3,'failed',$4) ON CONFLICT(run_id,position) DO NOTHING", [run.id, imported, f.name, String(e?.message || e).slice(0, 300)]);
      }
      imported++;
      await pool.query('UPDATE gbp_bulk_posts SET imported=$2,updated_at=now() WHERE id=$1', [run.id, imported]);
    }
  } else if (run.source === 'dropbox') {
    const files = await downloadDropboxZip(ref.url, http);
    if (!files.length) throw new Error('No JPEG, PNG or WebP photos in that Dropbox folder');
    total = files.length;
    await pool.query('UPDATE gbp_bulk_posts SET total=$2 WHERE id=$1', [run.id, total]);
    for (const f of files) {
      try {
        const photoId = await storePhoto(run.user_id, run.folder_id, loc, f.bytes, imported);
        await pool.query('INSERT INTO gbp_bulk_post_items(run_id,position,photo_id,source_name) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,position) DO NOTHING', [run.id, imported, photoId, f.name]);
      } catch (e: any) {
        await pool.query("INSERT INTO gbp_bulk_post_items(run_id,position,source_name,status,error) VALUES($1,$2,$3,'failed',$4) ON CONFLICT(run_id,position) DO NOTHING", [run.id, imported, f.name, String(e?.message || e).slice(0, 300)]);
      }
      imported++;
      await pool.query('UPDATE gbp_bulk_posts SET imported=$2,updated_at=now() WHERE id=$1', [run.id, imported]);
    }
  }
  if (imported >= total && total > 0) {
    const { rows: pending } = await pool.query("SELECT id FROM gbp_bulk_post_items WHERE run_id=$1 AND status='pending' ORDER BY position", [run.id]);
    const times = planTimes(pending.length, { everyDays: run.every_days, startOn: run.start_on instanceof Date ? run.start_on.toISOString().slice(0, 10) : String(run.start_on).slice(0, 10), timezone: run.timezone, openHour: run.open_hour, closeHour: run.close_hour, weekdays: run.weekdays });
    for (let i = 0; i < pending.length; i++) await pool.query('UPDATE gbp_bulk_post_items SET due_at=$2 WHERE id=$1', [pending[i].id, times[i]]);
    await pool.query("UPDATE gbp_bulk_posts SET status='active',error=NULL,updated_at=now() WHERE id=$1", [run.id]);
  }
}

/** The caption for one photo, then the post into the content queue at the item's time. */
async function queueItem(run: any, item: any, ai: DraftAI) {
  const loc = (await pool.query('SELECT * FROM business_locations WHERE id=$1', [run.location_id])).rows[0];
  const [photo] = await photosFor(run.user_id, [item.photo_id]);
  const style = (await pool.query('SELECT summary FROM gbp_content_style WHERE user_id=$1 AND location_id=$2', [run.user_id, run.location_id])).rows[0]?.summary || '';
  const instructions = [
    'Write it as a short, upbeat Google post about this photo: one or two sentences a customer would enjoy, under 300 characters, no hashtags.',
    run.instructions,
  ].filter(Boolean).join(' ');
  if (!await takeBudget(`gbp-content-ai:${run.user_id}`, 100, 1, 86400000)) throw new GoogleError('quota', 'Daily AI budget reached; this post waits for tomorrow', 429);
  const caption = fitChars(await ai(draftPrompt('post', loc, { instructions }, style), [publicPhotoUrl(photo.r2_key || '')]), 1500);
  const jobs = await enqueue(run.user_id, run.location_id, {
    requestKey: item.request_key,
    items: [{ kind: 'post', photoIds: [photo.id], summary: caption, topicType: 'STANDARD' }],
    schedule: { start: new Date(item.due_at).toISOString(), everyMinutes: 1440 },
  });
  await pool.query("UPDATE gbp_bulk_post_items SET status='queued',caption=$2,job_id=$3,error=NULL WHERE id=$1", [item.id, caption, jobs[0]?.id ?? null]);
}

/** One tick: imports, then the posts due within 36 hours, then statuses back from the content queue. */
export async function runBulkPostsWorker(ai: DraftAI = generateDraft, http: Fetch = fetch, onlyRun?: number) {
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query('SELECT pg_try_advisory_lock(7177,1) locked')).rows[0].locked;
    if (!locked) return;
    const where = onlyRun ? 'AND id=$1' : '';
    const args = onlyRun ? [onlyRun] : [];
    const { rows: importing } = await c.query(`SELECT * FROM gbp_bulk_posts WHERE status='importing' ${where} ORDER BY updated_at LIMIT 5`, args);
    for (const run of importing) {
      try { await importTick(run, http); }
      catch (e: any) {
        await c.query('UPDATE gbp_bulk_posts SET error=$2,updated_at=now() WHERE id=$1', [run.id, String(e?.message || e).slice(0, 300)]);
        void recordFailure('job', 'Bulk posts import', e, { runId: run.id }, 'warning');
      }
    }
    const { rows: due } = await c.query(`SELECT i.*, r.user_id, r.location_id, r.instructions, r.id AS run_id FROM gbp_bulk_post_items i JOIN gbp_bulk_posts r ON r.id=i.run_id
      WHERE r.status='active' AND i.status='pending' AND i.photo_id IS NOT NULL AND i.due_at <= now() + interval '36 hours' ${onlyRun ? 'AND r.id=$1' : ''} ORDER BY i.due_at LIMIT 40`, args);
    for (const item of due) {
      try { await queueItem({ id: item.run_id, user_id: item.user_id, location_id: item.location_id, instructions: item.instructions }, item, ai); }
      catch (e: any) {
        const quota = e instanceof GoogleError && e.kind === 'quota';
        await c.query(quota ? 'UPDATE gbp_bulk_post_items SET error=$2 WHERE id=$1' : "UPDATE gbp_bulk_post_items SET status='failed',error=$2 WHERE id=$1", [item.id, String(e?.message || e).slice(0, 300)]);
        if (!quota) void recordFailure('job', 'Bulk posts caption', e, { itemId: item.id }, 'warning');
      }
    }
    // What the content queue did with the queued posts.
    await c.query(`UPDATE gbp_bulk_post_items i SET status=CASE WHEN j.status='published' THEN 'published' WHEN j.status IN ('failed','cancelled') THEN 'failed' ELSE i.status END, error=COALESCE(j.error,i.error)
      FROM gbp_content_jobs j WHERE i.job_id=j.id AND i.status='queued' AND j.status IN ('published','failed','cancelled')`);
    await c.query(`UPDATE gbp_bulk_posts r SET status='done',updated_at=now() WHERE r.status='active' AND r.total>0 AND r.imported>=r.total
      AND NOT EXISTS (SELECT 1 FROM gbp_bulk_post_items i WHERE i.run_id=r.id AND i.status IN ('pending','queued'))`);
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock(7177,1)');
    c.release();
  }
}

export function startBulkPostsWorker() {
  if (process.env.GBP_CONTENT_WORKER_ENABLED !== 'true') return;
  return workerInterval('Bulk posts worker', () => runBulkPostsWorker().catch((e) => { console.error('Bulk posts worker failed'); void recordFailure('job', 'Bulk posts tick', e); }), 10 * 60000).timer;
}

export function registerBulkPostRoutes(app: Express, auth: (req: any, res: any) => any) {
  const route = (method: 'get' | 'post', suffix: string, fn: (req: any, user: number, location: number) => Promise<any>) => app[method](`/api/gbp/content/:location/bulk-posts${suffix}`, async (req, res) => {
    const u = auth(req, res);
    if (!u) return;
    try {
      const location = z.coerce.number().int().positive().parse(req.params.location);
      await ownedLocation(u.id, location);
      if (method !== 'get' && !await takeBudget(`gbp-content:${u.id}`, 180)) return void res.status(429).json({ message: 'Content request limit reached' });
      res.json(await fn(req, u.id, location));
    } catch (e: any) {
      if (e instanceof AutoPostsRequired) return void sendModuleRequired(res, 'autoPosts');
      res.status(e instanceof z.ZodError ? 400 : e instanceof GoogleError ? e.status : 500).json({ message: e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : e instanceof GoogleError ? e.message : 'Bulk posts failed' });
    }
  });
  route('get', '', async (_r, u, l) => ({ runs: await listRuns(u, l), workerEnabled: process.env.GBP_CONTENT_WORKER_ENABLED === 'true', fileloaded: !!fileDropBase() }));
  route('post', '', async (r, u, l) => createRun(u, l, r.body));
  route('post', '/:id/:action', async (r, u, l) => setRunStatus(u, l, z.coerce.number().int().positive().parse(r.params.id), z.enum(['pause', 'resume', 'cancel']).parse(r.params.action)));
  // "Check FileLoaded": how many photos a key can see, before anything is created.
  route('post', '/check-fileloaded', async (r, u) => {
    await requireAutoPosts(u);
    const b = createInput.shape.fileloaded.unwrap().parse(r.body);
    const files = await listFileloaded(b.slug, b.key);
    return { count: files.length, sample: files.slice(0, 5).map((f) => f.name) };
  });
}
