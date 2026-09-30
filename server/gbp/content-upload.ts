import type { Express } from 'express';
import multer from 'multer';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { pool } from '../db';
import { processPhoto } from '../photo-processor';
import { uploadToR2, getFromR2, getR2Url } from '../r2';
import { takeBudget } from '../growth-limits';
import { ownedLocation } from './service';
import { GoogleError } from './client';
import { photosFor } from './content';
export function seoName(pattern: string, business: string, city: string, index: number) {
    return (pattern.replaceAll('{business}', business).replaceAll('{city}', city).replaceAll('{n}', String(index + 1)).normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 160) || `photo-${index + 1}`) + '.jpg';
}
const options = z.object({ pattern: z.string().min(1).max(200).default('{business}-{city}-{n}'), title: z.string().max(200).default(''), lat: z.coerce.number().min(-90).max(90).optional(), lon: z.coerce.number().min(-180).max(180).optional(), photoIds: z.array(z.number().int().positive()).max(100).optional() }).refine(v => (v.lat === undefined) === (v.lon === undefined), 'Both GPS coordinates are required');
export async function preparePhoto(buffer: Buffer, name: string, exif: {
    title?: string;
    lat?: number;
    lon?: number;
}, upload = uploadToR2) {
    const dir = await mkdtemp(join(tmpdir(), 'gbp-content-'));
    try {
        const input = join(dir, 'input'), output = join(dir, name);
        await writeFile(input, buffer);
        await processPhoto({ inputPath: input, outputPath: output, exif });
        const bytes = await readFile(output);
        const key = await upload(bytes, 'image/jpeg', 'media', 'jpg', name);
        return { key, size: bytes.length };
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
export function registerContentUpload(app: Express, auth: (req: any, res: any) => any) {
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 }, fileFilter: (_r, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)) });
    // The browser streams up to 100 files sequentially. A single request never buffers 100 full photos.
    app.post('/api/gbp/content/:location/upload', async (req, res, next) => {
        const u = auth(req, res);
        if (!u)
            return;
        try {
            const loc = z.coerce.number().int().positive().parse(req.params.location);
            await ownedLocation(u.id, loc);
            if (!await takeBudget(`gbp-content-upload:${u.id}`, 100, 1, 3600000))
                return void res.status(429).json({ message: 'Hourly photo processing limit reached' });
            next();
        }
        catch {
            res.status(400).json({ message: 'Invalid location or upload budget unavailable' });
        }
    }, (req, res) => upload.single('photo')(req, res, async (err) => {
        if (err)
            return void res.status(400).json({ message: 'Upload one JPEG, PNG or WebP, up to 15 MB' });
        try {
            const u = req.user!, loc = await ownedLocation(u.id, Number(req.params.location)), b = options.parse(req.body), index = z.coerce.number().int().min(0).max(99).parse(req.body.index || 0);
            if (!req.file)
                throw new Error('Photo required');
            const name = seoName(b.pattern, loc.business_name, loc.city || '', index), p = await preparePhoto(req.file.buffer, name, { title: b.title, lat: b.lat, lon: b.lon });
            let folder=(await pool.query("SELECT id FROM media_folders WHERE user_id=$1 AND name='GBP uploads' ORDER BY id LIMIT 1",[u.id])).rows[0];
            folder??=(await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,'GBP uploads') RETURNING id",[u.id])).rows[0];
            const { rows: [photo] } = await pool.query('INSERT INTO media_photos(user_id,folder_id,name,url,r2_key,size) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,url', [u.id, folder.id, name, getR2Url(p.key), p.key, p.size]);
            res.json(photo);
        }
        catch (e) {
            res.status(e instanceof GoogleError ? e.status : 400).json({ message: e instanceof GoogleError ? e.message : 'Unable to process photo; check file and metadata' });
        }
    }));
    app.post('/api/gbp/content/:location/prepare', async (req, res) => {
        const u = auth(req, res);
        if (!u)
            return;
        try {
            const loc = await ownedLocation(u.id, z.coerce.number().int().positive().parse(req.params.location)), b = options.parse(req.body), photos = await photosFor(u.id, b.photoIds || []);
            if (!photos.length)
                throw new GoogleError('invalid', 'Select photos', 400);
            if (!await takeBudget(`gbp-content-upload:${u.id}`, 100, photos.length, 3600000))
                throw new GoogleError('quota', 'Hourly photo processing limit reached', 429);
            const saved = [];
            for (let i = 0; i < photos.length; i++) {
                const photo = photos[i];
                if (!photo.r2_key?.startsWith('media/'))
                    throw new GoogleError('invalid', 'Photo must be in the R2 media library', 400);
                const source = await getFromR2(photo.r2_key), parts: Buffer[] = [];
                let size = 0;
                for await (const part of source.body as any) {
                    size += part.length;
                    if (size > 15 * 1024 * 1024)
                        throw new Error('Photo too large');
                    parts.push(Buffer.from(part));
                }
                const name = seoName(b.pattern, loc.business_name, loc.city || '', i), p = await preparePhoto(Buffer.concat(parts), name, { title: b.title, lat: b.lat, lon: b.lon });
                const { rows: [copy] } = await pool.query(`INSERT INTO media_photos(user_id,folder_id,name,url,r2_key,size) SELECT user_id,folder_id,$3,$4,$5,$6 FROM media_photos WHERE id=$1 AND user_id=$2 RETURNING id,name,url`, [photo.id, u.id, name, getR2Url(p.key), p.key, p.size]);
                saved.push(copy);
            }
            res.json(saved);
        }
        catch (e) {
            res.status(e instanceof GoogleError ? e.status : 400).json({ message: e instanceof GoogleError ? e.message : 'Could not prepare selected photos' });
        }
    });
}
