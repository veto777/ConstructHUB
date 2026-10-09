import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { ensureGrowthSchema } from '../growth-schema';
import { ensureGbpSchema } from './schema';
import { ensureAccountEventsSchema } from '../account-events';
import { ensureGbpContentSchema, enqueue, scheduleTimes, publicPhotoUrl, itemInput, runContentWorker, registerContentRoutes, payloadFor, createDraftGenerator } from './content';
import { GoogleClient, Limiter } from './client';
import { seoName, preparePhoto } from './content-upload';
import sharp from 'sharp';
import { Readable, Writable } from 'node:stream';
import * as r2 from '../r2';
import piexif from 'piexifjs';
let user: number, other: number, location: number, photo: number, app: express.Express;
const due = { start: '2026-01-01T12:00:00Z', everyMinutes: 1 };
const ai = vi.fn(async () => 'Fixture AI draft');
let status = 200, pages = 0;
const http = vi.fn(async (input: any, init: any) => {
    if (init.method === 'GET') {
        pages++;
        return new Response(JSON.stringify({ localPosts: [{ summary: 'Fixture past update', callToAction: { actionType: 'CALL' } }], ...(pages === 1 ? { nextPageToken: 'page2' } : {}) }));
    }
    return new Response(JSON.stringify(status === 200 ? { name: `accounts/content/locations/content/${input.endsWith('/media') ? 'media' : 'localPosts'}/fixture`, state: 'LIVE' } : { error: { code: status } }), { status });
});
const make = () => new GoogleClient(async () => 'fixture', http, new Limiter(() => 0, async () => { }), async () => { });
const call = async (path: string, body?: any, method = body ? 'POST' : 'GET', owner = user) => {
    // Invoke the registered Express handler without opening another lane port.
    const fullPath=`/api/gbp/content/${location}${path}`;
    const layer=(app.router as any).stack.find((entry:any)=>entry.route?.methods[method.toLowerCase()] && entry.match(fullPath));
    if(!layer)throw new Error('Test route not found');
    const response:any={statusCode:200,status(code:number){this.statusCode=code;return this;},json(value:any){this.body=JSON.parse(JSON.stringify(value));return this;}};
    await layer.route.stack[0].handle({headers:{'x-fixture-user':String(owner)},params:layer.params,body},response);
    return {status:response.statusCode,body:response.body};
};
beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || !['127.0.0.1', 'localhost'].includes(url.hostname))
        throw new Error('a local development DB is required');
    process.env.GBP_MEDIA_PUBLIC_BASE_URL = 'https://media.example.invalid';
    await ensureGrowthSchema();
    await ensureGbpSchema();
    await ensureAccountEventsSchema();
    await ensureGbpContentSchema();
    await ensureGbpContentSchema();
    const users = (await pool.query("INSERT INTO users(email) VALUES('content-'||gen_random_uuid()||'@example.invalid'),('content-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows;
    [user, other] = users.map(u => u.id);
    // Scheduling and AI content require an active Pro subscription.
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'pro','active')", [user]);
    location = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,'Content fixture','accounts/content','locations/content','subject') RETURNING id", [user])).rows[0].id;
    const folder = (await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,'Content fixture') RETURNING id", [user])).rows[0].id;
    photo = (await pool.query("INSERT INTO media_photos(user_id,folder_id,name,url,r2_key) VALUES($1,$2,'Fixture.jpg','/fixture.jpg','media/fixture.jpg') RETURNING id", [user, folder])).rows[0].id;
    app = express();
    app.use(express.json());
    registerContentRoutes(app, (req, res) => { const id = Number(req.headers['x-fixture-user']); if (!id) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } return { id }; }, ai, make);

});
afterAll(async () => { await pool.query('DELETE FROM media_photos WHERE user_id=$1', [user]); await pool.query('DELETE FROM media_folders WHERE user_id=$1', [user]); await pool.query('DELETE FROM business_locations WHERE user_id=$1', [user]); await pool.query('DELETE FROM users WHERE id=ANY($1)', [[user, other]]); await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1)", [[`gbp-content:${user}`, `gbp-content-ai:${user}`, `gbp-content-publish:${user}`]]); await pool.end(); });
describe('GBP content scheduling and validation', () => {
    it('spaces over closed hours and DST using the selected timezone', () => {
        const times = scheduleTimes({ start: '2026-03-06T22:00:00Z', everyMinutes: 1440, businessHours: true, timezone: 'America/New_York' }, 2);
        expect(times.map(d => d.toISOString())).toEqual(['2026-03-09T13:00:00.000Z', '2026-03-10T13:00:00.000Z']);
        expect(() => scheduleTimes({ ...due, custom: [] }, 1)).toThrow();
        expect(() => scheduleTimes({ ...due, timezone: 'invalid' }, 1)).toThrow();
    });
    it('rejects impossible event dates instead of silently publishing on a different day', () => {
        const post = { kind: 'post', summary: 'Fixture event', topicType: 'EVENT',
            event: { title: 'Fixture', start: '2027-02-29T09:00', end: '2027-03-02T10:00' } };
        expect(itemInput.safeParse(post).success).toBe(false);
        expect(itemInput.safeParse({ ...post, event: { ...post.event, start: '2028-02-29T09:00', end: '2028-03-01T10:00' } }).success).toBe(true);
        expect(itemInput.safeParse({ ...post, event: { ...post.event, start: '2027-02-28T24:00' } }).success).toBe(false);
    });
    it('schedules daily, weekly and explicit times and crosses the autumn DST weekend correctly', () => {
        expect(scheduleTimes({start:'2027-01-04T09:00:00Z',everyMinutes:1440},2).map(d=>d.toISOString()))
            .toEqual(['2027-01-04T09:00:00.000Z','2027-01-05T09:00:00.000Z']);
        expect(scheduleTimes({start:'2027-01-04T09:00:00Z',everyMinutes:10080},2)[1].toISOString()).toBe('2027-01-11T09:00:00.000Z');
        const custom=['2027-01-04T09:00:00Z','2027-01-10T12:00:00Z'];
        expect(scheduleTimes({...due,custom},2).map(d=>d.toISOString())).toEqual(custom.map(d=>new Date(d).toISOString()));
        expect(scheduleTimes({start:'2026-10-30T21:00:00Z',businessHours:true,timezone:'America/New_York'},1)[0].toISOString()).toBe('2026-11-02T14:00:00.000Z');
        expect(()=>scheduleTimes({...due,custom:['2027-01-10T12:00:00Z'],businessHours:true},1)).toThrow('outside selected business hours');
    });
    it('validates offers and CTA URLs and confines photo URLs to owned R2 keys', () => {
        expect(itemInput.safeParse({ kind: 'post', summary: 'Offer', topicType: 'OFFER' }).success).toBe(false);
        expect(itemInput.safeParse({ kind: 'post', summary: 'Text', callToAction: { actionType: 'BOOK', url: 'javascript:alert(1)' } }).success).toBe(false);
        expect(() => publicPhotoUrl('../secret')).toThrow();
        expect(publicPhotoUrl('media/file.jpg')).toBe('https://media.example.invalid/media/file.jpg');
    });
    it('uses the existing photo processor with real JPEG metadata and a mocked R2 upload', async () => {
        const upload = vi.fn(async () => 'media/processed.jpg'), buffer = await sharp({ create: { width: 300, height: 300, channels: 3, background: 'red' } }).jpeg().toBuffer();
        const name = seoName('{business}-{city}-{n}', 'Fixture Contractor', 'Seattle', 0);
        expect(name).toBe('Fixture-Contractor-Seattle-1.jpg');
        await preparePhoto(buffer, name, { title: 'Fixture title', lat: 47.6, lon: -122.3 }, upload);
        const output = upload.mock.calls[0] as any;
        expect((await sharp(output[0]).metadata()).exif).toBeDefined();
        const metadata = piexif.load(output[0].toString('binary'));
        expect(Buffer.from(metadata['0th'][piexif.ImageIFD.XPTitle]).toString('utf16le')).toBe('Fixture title\0');
        expect(metadata.GPS[piexif.GPSIFD.GPSLatitudeRef]).toBe('N');
        expect(metadata.GPS[piexif.GPSIFD.GPSLongitudeRef]).toBe('W');
        expect(metadata.GPS[piexif.GPSIFD.GPSLatitude][0]).toEqual([47,1]);
        expect(output[4]).toBe(name);
    });
});
describe('real lane DB and mocked provider integration', () => {
    it('authenticates every route and rejects cross-owner reads, media and writes', async () => {
        expect((await call('', undefined, 'GET', 0)).status).toBe(401);
        expect((await call('', undefined, 'GET', other)).status).toBe(404);
        expect((await call('/queue', { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'x' }], schedule: due }, 'POST', other)).status).toBe(404);
        await expect(payloadFor(other, { kind: 'photo', photoIds: [photo] })).rejects.toMatchObject({ status: 404 });
        expect((await call('/jobs/1', { action: 'cancel' }, 'PATCH', other)).status).toBe(404);
    });
    it('reserves once for repeated submission, publishes once under concurrent workers and logs/alerts', async () => {
        const body = { requestKey: randomUUID(), items: [{ kind: 'photo', photoIds: [photo], summary: 'Caption' }], schedule: due };
        const a = await enqueue(user, location, body), b = await enqueue(user, location, body);
        expect(a[0].id).toBe(b[0].id);
        http.mockClear();
        await Promise.all([runContentWorker(make), runContentWorker(make)]);
        await runContentWorker(make);
        expect(http).toHaveBeenCalledTimes(1);
        const row = (await pool.query('SELECT * FROM gbp_content_jobs WHERE id=$1', [a[0].id])).rows[0];
        expect(row).toMatchObject({ status: 'published', attempts: 1 });
        expect(JSON.parse(http.mock.calls[0][1].body)).toMatchObject({ mediaFormat: 'PHOTO', description: 'Caption', sourceUrl: 'https://media.example.invalid/media/fixture.jpg' });
        expect((await pool.query('SELECT * FROM user_notifications WHERE user_id=$1', [user])).rows.some(r => r.kind === 'gbp.post_published')).toBe(true);
        expect((await pool.query('SELECT * FROM account_activity WHERE user_id=$1', [user])).rows.some(r => r.kind === 'gbp.content_published')).toBe(true);
    });
    it('never blindly retries transient create errors; uncertain jobs require acknowledgement', async () => {
        status = 503;
        http.mockClear();
        const [job] = await enqueue(user, location, { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'Fixture post' }], schedule: due });
        await runContentWorker(make);
        expect(http).toHaveBeenCalledTimes(1);
        expect((await call(`/jobs/${job.id}`, { action: 'retry' }, 'PATCH')).status).toBe(409);
        expect((await call(`/jobs/${job.id}`, { action: 'retry', checkedGoogle: true }, 'PATCH')).status).toBe(200);
        status = 200;
        await runContentWorker(make);
        expect((await call('')).body.jobs.find((j: any) => j.id === job.id).status).toBe('published');
    });
    it('recovers interrupted dispatches without resending; cancels queued jobs', async () => {
        const [job] = await enqueue(user, location, { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'Interrupted' }], schedule: due });
        await pool.query("UPDATE gbp_content_jobs SET status='publishing' WHERE id=$1", [job.id]);
        http.mockClear();
        await runContentWorker(make);
        expect(http).not.toHaveBeenCalled();
        expect((await call(`/jobs/${job.id}`, { action: 'cancel' }, 'PATCH')).body.status).toBe('cancelled');
        const [queued] = await enqueue(user, location, { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'Cancel' }], schedule: due });
        expect((await call(`/jobs/${queued.id}`, { action: 'cancel' }, 'PATCH')).status).toBe(200);
        await runContentWorker(make);
        expect(http).not.toHaveBeenCalled();
    });
    it('learns across all pages, saves editable guidance and generates vision drafts without queuing', async () => {
        const before = (await call('')).body.jobs.length;
        pages = 0;
        expect((await call('/learn', {})).body).toMatchObject({ draft: true, postCount: 2, summary: 'Fixture AI draft' });
        expect(pages).toBe(2);
        await call('/style', { summary: 'Owner edited style' }, 'PATCH');
        ai.mockClear();
        expect((await call('/draft', { kind: 'photo', photoIds: [photo], instructions: 'Describe workmanship', examples: 'Example' })).body.drafts[0]).toMatchObject({ photoId: photo, text: 'Fixture AI draft' });
        expect(ai.mock.calls[0]).toEqual([expect.stringContaining('Owner edited style'), ['https://media.example.invalid/media/fixture.jpg']]);
        expect((await call('')).body.jobs.length).toBe(before);
    });
    it('does not change already approved content under a reused submission key', async () => {
        const requestKey = randomUUID(), body = { requestKey, items: [{ kind: 'post', summary: 'Approved original' }], schedule: due };
        await enqueue(user, location, body);
        await expect(enqueue(user, location, { ...body, items: [{ kind: 'post', summary: 'Changed content' }] })).rejects.toMatchObject({ status: 409 });
        await pool.query("UPDATE gbp_content_jobs SET status='cancelled' WHERE request_key=$1", [requestKey]);
    });
    it('preserves local event times, suppresses cover captions and applies business hours at dispatch', async () => {
        const event = await payloadFor(user, { kind: 'post', summary: 'Fixture event', topicType: 'EVENT', event: { title: 'Fixture', start: '2027-01-01T09:30', end: '2027-01-01T11:00' } });
        expect(event).toMatchObject({ event: { schedule: { startTime: { hours: 9, minutes: 30 } } } });
        expect(await payloadFor(user, { kind: 'photo', photoIds: [photo], summary: 'Hidden', category: 'COVER' })).not.toHaveProperty('description');
        const now = new Date(), day = now.getUTCDay(), nextDay = (day + 1) % 7;
        const [job] = await enqueue(user, location, { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'Business hours' }], schedule: { ...due, businessHours: true, timezone: 'UTC', weekdays: [nextDay] } });
        await pool.query('UPDATE gbp_content_jobs SET due_at=now()-interval \'1 day\' WHERE id=$1', [job.id]);
        http.mockClear();
        await runContentWorker(make);
        expect(http).not.toHaveBeenCalled();
        const row = (await pool.query('SELECT * FROM gbp_content_jobs WHERE id=$1', [job.id])).rows[0];
        expect(row.status).toBe('queued');
        expect(new Date(row.due_at).getTime()).toBeGreaterThan(Date.now());
    });
    it('moves a later moderation rejection out of published history and alerts only once', async () => {
        const [job] = await enqueue(user, location, { requestKey: randomUUID(), items: [{ kind: 'post', summary: 'Moderation fixture' }], schedule: due });
        await runContentWorker(make);
        const rejectedApp = express();
        registerContentRoutes(rejectedApp, () => ({ id: user }), ai, () => ({request: async () => ({state:'REJECTED'})}) as any);
        const originalApp = app;
        app = rejectedApp;
        try {
            await call('/refresh', {});
            const row = (await pool.query('SELECT * FROM gbp_content_jobs WHERE id=$1',[job.id])).rows[0];
            expect(row).toMatchObject({status:'rejected',google_status:'REJECTED'});
            expect(row.error).toContain('corrected post');
            const count = async () => Number((await pool.query("SELECT count(*) FROM user_notifications WHERE user_id=$1 AND kind='gbp.post_failed'",[user])).rows[0].count);
            const first = await count();
            await call('/refresh', {});
            expect(await count()).toBe(first);
        } finally { app = originalApp; }
    });
    it('honors provider failure details and redacts the bearer token', async () => {
        const request = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid photo size; fixture-secret', code: 400 } }), { status: 400 }));
        const c = new GoogleClient(async () => 'fixture-secret', request, new Limiter(() => 0, async () => { }));
        await expect(c.request('reviews', '/v4/accounts/content/locations/content/media', 'POST', {})).rejects.toThrow('Invalid photo size; [redacted]');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('uses vision content parts at the actual AI HTTP boundary with a mocked client', async () => {
        const old = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'fixture-key';
        try {
            const httpAI = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Draft from image' } }] })));
            expect(await createDraftGenerator(httpAI)('Fixture prompt', ['https://media.example.invalid/media/x.jpg'])).toBe('Draft from image');
            const body = JSON.parse((httpAI.mock.calls[0] as any)[1].body);
            expect(body.messages[1].content[1]).toMatchObject({ type: 'image_url', image_url: { detail: 'low' } });
        }
        finally {
            if (old === undefined)
                delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
            else
                process.env.AI_INTEGRATIONS_OPENAI_API_KEY = old;
        }
    });
    it('accepts a 100-photo queue, rejects 101, and prevents publishing after a location is relinked', async () => {
        const items=Array.from({length:100},(_,i)=>({kind:'photo',photoIds:[photo],summary:`Boundary fixture ${i}`}));
        const jobs=await enqueue(user,location,{requestKey:randomUUID(),items,schedule:due});
        expect(jobs).toHaveLength(100);
        await pool.query("UPDATE gbp_content_jobs SET status='cancelled' WHERE id=ANY($1::bigint[])",[jobs.map(j=>j.id)]);
        await expect(enqueue(user,location,{requestKey:randomUUID(),items:[...items,items[0]],schedule:due})).rejects.toThrow();
        const [job]=await enqueue(user,location,{requestKey:randomUUID(),items:[items[0]],schedule:due});
        await pool.query("UPDATE business_locations SET gbp_location_name='locations/relinked' WHERE id=$1",[location]);
        try {
            http.mockClear();await runContentWorker(make);expect(http).not.toHaveBeenCalled();
            expect((await pool.query('SELECT status,error FROM gbp_content_jobs WHERE id=$1',[job.id])).rows[0]).toMatchObject({status:'failed',error:expect.stringContaining('linkage changed')});
        } finally {await pool.query("UPDATE business_locations SET gbp_location_name='locations/content' WHERE id=$1",[location]);}
    });
    it('stores durable media references and mints their signed URL at delayed dispatch', async () => {
        const saved=process.env.GBP_MEDIA_PUBLIC_BASE_URL;
        delete process.env.GBP_MEDIA_PUBLIC_BASE_URL;
        try {
            const [job]=await enqueue(user,location,{requestKey:randomUUID(),items:[{kind:'photo',photoIds:[photo]}],schedule:due});
            expect(job.payload.sourceUrl).toBe('r2:media/fixture.jpg');
            const dispatchTime=Date.now()+2*86400000;
            const now=vi.spyOn(Date,'now').mockReturnValue(dispatchTime);
            try {
                http.mockClear();await runContentWorker(make);
                const payload=JSON.parse(http.mock.calls[0][1].body),url=new URL(payload.sourceUrl);
                expect(Number(url.searchParams.get('exp'))).toBe(Math.floor(dispatchTime/1000)+3600);
            } finally {now.mockRestore();}
        } finally {if(saved!==undefined)process.env.GBP_MEDIA_PUBLIC_BASE_URL=saved;}
    });
    it('rejects malformed requests and enforces the daily AI budget before provider calls', async () => {
        expect((await call('/queue', { items: [] })).status).toBe(400);
        await pool.query("INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,100) ON CONFLICT(key,period) DO UPDATE SET used=100", [`gbp-content-ai:${user}`, String(Math.floor(Date.now() / 86400000))]);
        ai.mockClear();
        expect((await call('/draft', { kind: 'post' })).status).toBe(429);
        expect(ai).not.toHaveBeenCalled();
    });
});

describe('signed media links (no public bucket)', () => {
    it('streams valid signed media, avoids storage on forged links, and contains source stream errors', async () => {
        const { signMediaKey } = await import('./content');
        const get = vi.spyOn(r2, 'getFromR2');
        const path = '/api/public/gbp-media';
        const layer = (app.router as any).stack.find((entry:any)=>entry.route?.methods.get && entry.match(path));
        const exp = Math.floor(Date.now()/1000)+3600, key = 'media/fixture.jpg';
        const invoke = async (sig:string) => {
            const chunks:Buffer[] = [];
            const response:any = new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
            response.statusCode=200;
            response.setHeader=vi.fn();
            response.status=(code:number)=>{response.statusCode=code;return response;};
            response.json=(body:any)=>response.end(JSON.stringify(body));
            await layer.route.stack[0].handle({query:{k:key,exp:String(exp),sig}},response);
            return {response,body:Buffer.concat(chunks).toString()};
        };
        try {
            expect((await invoke('forged')).response.statusCode).toBe(403);
            expect(get).not.toHaveBeenCalled();
            get.mockResolvedValue({body:Readable.from(['fixture image']) as any,contentType:'image/jpeg'});
            expect((await invoke(signMediaKey(key,exp))).body).toBe('fixture image');
            get.mockResolvedValue({body:new Readable({read(){this.destroy(new Error('Storage stream failed'));}}) as any,contentType:'image/jpeg'});
            expect((await invoke(signMediaKey(key,exp))).response.destroyed).toBe(true);
        } finally {get.mockRestore();}
    });
    it('fails closed without a configured signing secret', async () => {
        const { verifyMediaSignature, signMediaKey } = await import('./content');
        const key = process.env.GBP_TOKEN_KEY, session = process.env.SESSION_SECRET;
        delete process.env.GBP_TOKEN_KEY;
        delete process.env.SESSION_SECRET;
        try {
            expect(() => signMediaKey('media/fixture.jpg', Date.now())).toThrow('not configured');
            expect(verifyMediaSignature('media/fixture.jpg', Date.now(), 'forged')).toBe(false);
        } finally {
            if (key !== undefined) process.env.GBP_TOKEN_KEY = key;
            if (session !== undefined) process.env.SESSION_SECRET = session;
        }
    });
    it('mints a short-lived signed link, verifies it, and rejects tampering, expiry and non-media keys', async () => {
        const { verifyMediaSignature, signMediaKey, resolveMediaRefs } = await import('./content');
        const saved = process.env.GBP_MEDIA_PUBLIC_BASE_URL; delete process.env.GBP_MEDIA_PUBLIC_BASE_URL;
        try {
            const u = new URL(publicPhotoUrl('media/abc/photo.jpg'));
            expect(u.pathname).toBe('/api/public/gbp-media');
            const k = u.searchParams.get('k')!, exp = Number(u.searchParams.get('exp')), sig = u.searchParams.get('sig')!;
            expect(verifyMediaSignature(k, exp, sig)).toBe(true);
            expect(verifyMediaSignature('media/abc/other.jpg', exp, sig)).toBe(false);
            expect(verifyMediaSignature(k, exp + 1, sig)).toBe(false);
            const past = Math.floor(Date.now() / 1000) - 10;
            expect(verifyMediaSignature(k, past, signMediaKey(k, past))).toBe(false);
            expect(verifyMediaSignature('private/x.jpg', exp, signMediaKey('private/x.jpg', exp))).toBe(false);
            const out = resolveMediaRefs({ summary: 's', media: [{ mediaFormat: 'PHOTO', sourceUrl: 'r2:media/abc/photo.jpg' }] });
            expect(out.media[0].sourceUrl).toMatch(/\/api\/public\/gbp-media\?k=media%2Fabc%2Fphoto\.jpg&exp=\d+&sig=/);
        } finally { process.env.GBP_MEDIA_PUBLIC_BASE_URL = saved; }
    });
});
