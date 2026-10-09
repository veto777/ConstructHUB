/**
 * Listing editor: the owner edits the Google Business Profile fields the Business Information API
 * lets a manager write, and we PATCH exactly what changed.
 *
 *   loadListing        GET  location (+ attributes) with the editor's read mask
 *   writeListing       PATCH locations/{id}?updateMask=<changed fields>; per-field verdict
 *   writeAttributes    PATCH locations/{id}/attributes?attributeMask=<changed attributes>
 *   searchCategories   GET  categories (Google's real category ids, FULL view = service types)
 *   attributeMetadata  GET  attributes?parent=… (which attributes this listing may set, by type)
 *   searchRegions      Places Autocomplete, regions only (service-area places need Google place ids)
 *
 * Verdicts are honest: "applied" only when Google's response carries the value we sent; "pending"
 * when it does not but Google flags metadata.hasPendingEdits (a review); "unconfirmed" otherwise.
 * A Google 4xx surfaces as "rejected" with Google's own message (GoogleClient appends it).
 *
 * Every write is logged (account_activity gbp.profile_change) and the account holder is notified at
 * once — Google's third-party policy: "provide notice to the end-client of the change within 48 hours".
 * Profile Guard learns the new approved value for applied fields; a pending field is remembered as an
 * 'owner-pending' change so checkGuard recognises it as ours when Google publishes it (guard.ts).
 *
 * Gating: the same as the existing PATCH /api/gbp/locations/:id/profile — a signed-in account (the
 * agency owner when acting in a workspace), a location it owns, and the per-route request budget.
 * No plan gate exists on the Business Profile write routes today, so none is added here.
 */
import { z } from 'zod';
import type { Express, Request, Response } from 'express';
import { pool } from '../db';
import { logActivity, notifyUser } from '../account-events';
import { takeBudget } from '../growth-limits';
import { GoogleClient, GoogleError } from './client';
import { clientFor, ownedLocation, withLocationLock, publicError } from './service';
import { guardRow, snapshotOf, GUARD_FIELDS } from './guard';
import { profileFields } from './profile-input';
import {
  LISTING_FIELDS, LISTING_FIELD_LABELS, readField, setField, same, normalizeField, validateListing, validateAttributes,
  buildAttributeMask, ATTRIBUTE_NAME, type AttributeValue, type FieldIssues,
} from '@shared/gbp-listing';

export const LISTING_READ_MASK = 'name,languageCode,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,labels,profile,openInfo,metadata,serviceItems,moreHours';

/* ── Input schemas (shape + injection safety; the rules live in shared/gbp-listing.ts) ── */
const money = z.object({ currencyCode: z.string().regex(/^[A-Z]{3}$/), units: z.union([z.string().regex(/^\d{1,12}$/), z.number().int().min(0)]).optional(), nanos: z.number().int().min(0).max(999_999_999).optional() }).strict();
const serviceItem = z.object({
  price: money.optional(),
  structuredServiceItem: z.object({ serviceTypeId: z.string().min(1).max(200), description: z.string().max(300).optional() }).strict().optional(),
  freeFormServiceItem: z.object({ category: z.string().regex(/^categories\/[\w:.-]+$/), label: z.object({ displayName: z.string().trim().min(1).max(1000), description: z.string().max(2000).optional(), languageCode: z.string().max(20).optional() }).strict() }).strict().optional(),
}).strict();
export const listingInput = z.object({ fields: profileFields.extend({
  labels: z.array(z.string().trim().min(1).max(255)).max(100).nullable().optional(),
  serviceItems: z.array(serviceItem).max(500).nullable().optional(),
}).strict().refine((f) => Object.keys(f).length > 0, 'Nothing changed') }).strict();

const attributeValue = z.object({
  name: z.string().regex(ATTRIBUTE_NAME),
  valueType: z.enum(['BOOL', 'ENUM', 'URL', 'REPEATED_ENUM']),
  values: z.array(z.union([z.boolean(), z.string().max(200)])).max(50).optional(),
  uriValues: z.array(z.object({ uri: z.string().url().max(2048) }).strict()).max(10).optional(),
  repeatedEnumValue: z.object({ setValues: z.array(z.string().max(200)).max(100).optional(), unsetValues: z.array(z.string().max(200)).max(100).optional() }).strict().optional(),
}).strict();
export const attributesInput = z.object({ attributeMask: z.array(z.string().regex(ATTRIBUTE_NAME)).min(1).max(200), attributes: z.array(attributeValue).max(200) }).strict();

const idParam = z.coerce.number().int().positive().max(2147483647);

/** Shape check (zod) and rule check (shared) in one answer: per-field errors the form can show, never a bare "Invalid input". */
export function parseListingFields(body: any): { fields: Record<string, any>; warnings: FieldIssues } | { errors: FieldIssues; warnings: FieldIssues } {
  const raw = body?.fields;
  const parsed = listingInput.safeParse(body);
  const { errors, warnings } = validateListing(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = typeof issue.path[1] === 'string' ? issue.path[1] : 'fields';
      if (!errors[field]?.length) (errors[field] ??= []).push(issue.message);
    }
    if (!Object.keys(errors).length) errors.fields = ['Nothing changed'];
  }
  if (Object.keys(errors).length) return { errors, warnings };
  return { fields: (parsed as any).data.fields, warnings };
}
const label = (f: string) => (LISTING_FIELD_LABELS as Record<string, string>)[f] ?? f;

/* ── Verdicts ─────────────────────────────────────────────────────────────── */
export type Verdict = 'applied' | 'pending' | 'unconfirmed';
/** Per field: did Google's PATCH response carry what we sent? */
export function verdictsFor(fields: Record<string, any>, body: any, response: any): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  const pendingFlag = !!response?.metadata?.hasPendingEdits;
  for (const f of Object.keys(fields)) {
    const want = normalizeField(f, readField(body, f)), got = normalizeField(f, readField(response, f));
    out[f] = same(want, got) ? 'applied' : pendingFlag ? 'pending' : 'unconfirmed';
  }
  return out;
}

/* ── Reads ───────────────────────────────────────────────────────────────── */
export async function loadListing(userId: number, id: number, client?: GoogleClient) {
  const l = await ownedLocation(userId, id);
  client ??= clientFor(userId, l.gbp_google_subject);
  const location = await client.request('information', `/v1/${l.gbp_location_name}?readMask=${LISTING_READ_MASK}`);
  if (location.name !== l.gbp_location_name || typeof location.title !== 'string') throw new GoogleError('transient', 'Google did not return this location', 503);
  let attributes: any[] | null = null, attributesError: string | null = null;
  try {
    const r = await client.request('information', `/v1/${l.gbp_location_name}/attributes`);
    if (r.attributes !== undefined && !Array.isArray(r.attributes)) throw new GoogleError('invalid', 'Invalid Google attributes response');
    attributes = (r.attributes || []).filter((a: any) => typeof a?.name === 'string');
  } catch (e) {
    if (e instanceof GoogleError && e.kind === 'auth') throw e;
    attributesError = publicError(e).message;
  }
  const { rows: pending } = await pool.query("SELECT field,new_value,detected_at FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2 AND status='owner-pending' ORDER BY id", [userId, id]);
  return { location, attributes, attributesError, pending: pending.map((p) => ({ field: p.field, value: p.new_value, since: p.detected_at })), locationId: id, businessName: l.business_name };
}

export async function searchCategories(client: GoogleClient, q: string, regionCode = 'US', languageCode = 'en') {
  const params = new URLSearchParams({ regionCode, languageCode, view: 'FULL', pageSize: '100' });
  if (q) params.set('filter', `displayName=${q}`);
  const r = await client.request('information', `/v1/categories?${params}`);
  if (r.categories !== undefined && !Array.isArray(r.categories)) throw new GoogleError('invalid', 'Invalid Google categories response');
  return (r.categories || []).filter((c: any) => typeof c?.name === 'string' && /^categories\/[\w:.-]+$/.test(c.name)).map((c: any) => ({
    name: c.name, displayName: typeof c.displayName === 'string' ? c.displayName : c.name,
    serviceTypes: (c.serviceTypes || []).filter((t: any) => t?.serviceTypeId && t?.displayName).map((t: any) => ({ serviceTypeId: t.serviceTypeId, displayName: t.displayName })),
  }));
}

export async function attributeMetadata(client: GoogleClient, locationName: string, category?: string, regionCode = 'US', languageCode = 'en') {
  const params = category ? new URLSearchParams({ categoryName: category, regionCode, languageCode }) : new URLSearchParams({ parent: locationName });
  const rows = await client.pages('information', `/v1/attributes?${params}`, 'attributeMetadata');
  return rows.filter((m: any) => typeof m?.parent === 'string' && ATTRIBUTE_NAME.test(m.parent) && ['BOOL', 'ENUM', 'URL', 'REPEATED_ENUM'].includes(m.valueType)).map((m: any) => ({
    name: m.parent, valueType: m.valueType, displayName: typeof m.displayName === 'string' ? m.displayName : m.parent.split('/').pop(),
    groupDisplayName: typeof m.groupDisplayName === 'string' ? m.groupDisplayName : 'Other', repeatable: !!m.repeatable, deprecated: !!m.deprecated,
    valueMetadata: (m.valueMetadata || []).filter((v: any) => v?.value !== undefined).map((v: any) => ({ value: v.value, displayName: typeof v.displayName === 'string' ? v.displayName : String(v.value) })),
  }));
}

/** Service-area places must be Google place ids of regions; Places Autocomplete (regions) is the real source. */
export async function searchRegions(q: string, http: typeof fetch = fetch) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new GoogleError('disabled', 'Place search is not configured on this server. Ask support to add the Places key.', 503);
  const u = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  u.searchParams.set('input', q); u.searchParams.set('types', '(regions)'); u.searchParams.set('key', key);
  let r: Awaited<ReturnType<typeof fetch>>;
  try { r = await http(u, { signal: AbortSignal.timeout(15000) }); } catch { throw new GoogleError('transient', 'Place search timed out. Try again.', 503); }
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !['OK', 'ZERO_RESULTS'].includes(data?.status)) throw new GoogleError('transient', 'Place search failed. Try again.', 503);
  return (data.predictions || []).filter((p: any) => typeof p?.place_id === 'string' && typeof p?.description === 'string').map((p: any) => ({ placeId: p.place_id, placeName: p.description }));
}

/* ── Writes ──────────────────────────────────────────────────────────────── */
export async function writeListing(userId: number, id: number, fields: Record<string, any>, client?: GoogleClient, req: any = null) {
  const l = await ownedLocation(userId, id);
  const names = Object.keys(fields);
  if (!names.length) throw new GoogleError('invalid', 'Nothing changed', 400);
  return withLocationLock(id, async () => {
    const body: any = {};
    for (const [f, v] of Object.entries(fields)) setField(body, f, v);
    client ??= clientFor(userId, l.gbp_google_subject);
    const response = await client.request('information', `/v1/${l.gbp_location_name}?updateMask=${names.join(',')}`, 'PATCH', body);
    if (response.name !== l.gbp_location_name) throw new GoogleError('transient', 'Google did not confirm the profile edit. Check the profile before retrying.', 503);
    const verdicts = verdictsFor(fields, body, response);
    const applied = names.filter((f) => verdicts[f] === 'applied'), pending = names.filter((f) => verdicts[f] === 'pending');
    const guarded = (f: string) => (GUARD_FIELDS as readonly string[]).includes(f);
    const g = await guardRow(userId, id);
    if (g.snapshot) {
      const confirmed = snapshotOf(response);
      for (const f of applied.filter(guarded)) { g.snapshot[f] = confirmed[f]; delete g.observed[f]; }
      await pool.query('UPDATE gbp_guard SET snapshot=$3,observed=$4,updated_at=now() WHERE user_id=$1 AND location_id=$2', [userId, id, JSON.stringify(g.snapshot), JSON.stringify(g.observed)]);
      if (applied.length) await pool.query("UPDATE gbp_guard_changes SET status='owner-edited',resolved_at=now() WHERE user_id=$1 AND location_id=$2 AND field=ANY($3) AND status='pending'", [userId, id, applied]);
    }
    // Google is reviewing these: remember what we asked for, so Guard treats the value as ours when it lands.
    const requested = snapshotOf(body);
    for (const f of pending.filter(guarded)) {
      await pool.query("UPDATE gbp_guard_changes SET status='superseded',resolved_at=now() WHERE user_id=$1 AND location_id=$2 AND field=$3 AND status='owner-pending'", [userId, id, f]);
      await pool.query("INSERT INTO gbp_guard_changes(user_id,location_id,field,old_value,new_value,source,evidence,status) VALUES($1,$2,$3,$4,$5,$6,$7,'owner-pending')",
        [userId, id, f, JSON.stringify(g.snapshot?.[f] ?? snapshotOf(response)[f] ?? null), JSON.stringify(requested[f] ?? null), 'owner-edit via ConstructHUB (awaiting Google review)', JSON.stringify({ updateMask: names.join(','), hasPendingEdits: true })]);
    }
    await logActivity(req, userId, 'gbp.profile_change', { locationId: id, action: 'listing-edit', fields: names, verdicts });
    const summary = names.map(label).join(', ');
    await notifyUser(userId, 'gbp.profile_change', {
      title: 'Business Profile edited from ConstructHUB',
      body: `${l.business_name}: ${summary}.${pending.length ? ` Google is reviewing: ${pending.map(label).join(', ')}.` : ''}${names.length - applied.length - pending.length ? ' Some fields were not confirmed by Google; check the profile.' : ''}`,
      link: `/listing-editor?location=${id}`, actionUrl: `/listing-editor?location=${id}`, actionLabel: 'Open listing editor',
    });
    return { verdicts, location: response };
  });
}

const writableAttr = (a: any) => ({ valueType: a?.valueType, values: a?.values?.length ? a.values : undefined, uriValues: a?.uriValues?.length ? a.uriValues.map((u: any) => ({ uri: u.uri })) : undefined, repeatedEnumValue: a?.repeatedEnumValue && ((a.repeatedEnumValue.setValues?.length ?? 0) + (a.repeatedEnumValue.unsetValues?.length ?? 0)) ? a.repeatedEnumValue : undefined });

export async function writeAttributes(userId: number, id: number, input: { attributeMask: string[]; attributes: AttributeValue[] }, client?: GoogleClient, req: any = null) {
  const l = await ownedLocation(userId, id);
  const mask = [...new Set(input.attributeMask)];
  if (!mask.length) throw new GoogleError('invalid', 'Nothing changed', 400);
  if (input.attributes.some((a) => !mask.includes(a.name))) throw new GoogleError('invalid', 'Every attribute to update must be in the attribute mask', 400);
  return withLocationLock(id, async () => {
    client ??= clientFor(userId, l.gbp_google_subject);
    const name = `${l.gbp_location_name}/attributes`;
    const response = await client.request('information', `/v1/${name}?attributeMask=${mask.join(',')}`, 'PATCH', { name, attributes: input.attributes });
    if (response.attributes !== undefined && !Array.isArray(response.attributes)) throw new GoogleError('transient', 'Google did not confirm the attribute edit. Check the profile before retrying.', 503);
    const got = new Map((response.attributes || []).map((a: any) => [a.name, a]));
    const verdicts: Record<string, Verdict> = {};
    for (const n of mask) {
      const want = input.attributes.find((a) => a.name === n), have = got.get(n);
      verdicts[n] = want ? (have && same(writableAttr(want), writableAttr(have)) ? 'applied' : 'unconfirmed') : (have ? 'unconfirmed' : 'applied');
    }
    await logActivity(req, userId, 'gbp.profile_change', { locationId: id, action: 'attributes-edit', attributes: mask, verdicts });
    await notifyUser(userId, 'gbp.profile_change', {
      title: 'Business Profile attributes edited from ConstructHUB',
      body: `${l.business_name}: ${mask.map((m) => m.split('/').pop()).join(', ')}.`,
      link: `/listing-editor?location=${id}`, actionUrl: `/listing-editor?location=${id}`, actionLabel: 'Open listing editor',
    });
    return { verdicts, attributes: response.attributes || [] };
  });
}

/** Apply one change set to several owned locations; each location gets its own verdict or error, never a partial claim. */
export async function writeListingBulk(userId: number, locationIds: number[], fields: Record<string, any>, make: typeof clientFor = clientFor, req: any = null) {
  const results: any[] = [];
  for (const id of [...new Set(locationIds)]) {
    try {
      const l = await ownedLocation(userId, id);
      const r = await writeListing(userId, id, fields, make(userId, l.gbp_google_subject), req);
      results.push({ id, name: l.business_name, ok: true, verdicts: r.verdicts });
    } catch (e) {
      results.push({ id, ok: false, error: publicError(e).message, kind: publicError(e).kind });
    }
  }
  return { results };
}

/* ── Routes ──────────────────────────────────────────────────────────────── */
export function registerListingEditorRoutes(app: Express, auth: (req: any, res: any) => any, options: { make?: typeof clientFor; http?: typeof fetch } = {}) {
  const make = options.make ?? clientFor;
  const route = (method: 'get' | 'post' | 'patch', path: string, fn: (req: Request, res: Response, userId: number) => Promise<unknown>) => {
    app[method](path, async (req, res) => {
      const u = auth(req, res); if (!u) return;
      try {
        if (method !== 'get' && !await takeBudget(`gbp-listing-route:${path}:user:${u.id}`, 30, 1, 600_000)) throw new GoogleError('quota', 'Too many requests. Try again later.', 429);
        await fn(req, res, u.id);
      } catch (e) {
        if (e instanceof z.ZodError) return void res.status(400).json({ message: 'Invalid input', issues: e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) });
        res.status(e instanceof GoogleError ? e.status : 500).json(publicError(e));
      }
    });
  };
  const clientForLocation = async (userId: number, id: number) => { const l = await ownedLocation(userId, id); return { l, client: make(userId, l.gbp_google_subject) }; };
  const base = '/api/gbp/locations/:id/listing';

  // The editor's load: the live Google location, its attributes and our edits Google is still reviewing.
  route('get', base, async (req, res, u) => { const id = idParam.parse(req.params.id); res.json(await loadListing(u, id, (await clientForLocation(u, id)).client)); });

  // Save: only the changed fields, validated against Google's stated rules first; verdict per field.
  route('patch', base, async (req, res, u) => {
    const id = idParam.parse(req.params.id);
    const parsed = parseListingFields(req.body);
    if ('errors' in parsed) return void res.status(400).json({ message: 'Fix the highlighted fields before saving.', ...parsed });
    res.json({ ...await writeListing(u, id, parsed.fields, (await clientForLocation(u, id)).client, req), warnings: parsed.warnings });
  });

  route('patch', base + '/attributes', async (req, res, u) => {
    const id = idParam.parse(req.params.id);
    const input = attributesInput.parse(req.body);
    const errors = validateAttributes(input.attributes);
    if (Object.keys(errors).length) return void res.status(400).json({ message: 'Fix the highlighted attributes before saving.', errors });
    res.json(await writeAttributes(u, id, input, (await clientForLocation(u, id)).client, req));
  });

  // Pickers: Google's category list (real ids) and the attributes this listing's category allows.
  route('get', base + '/categories', async (req, res, u) => {
    const id = idParam.parse(req.params.id);
    const q = z.string().trim().max(100).default('').parse(req.query.q ?? '');
    const region = z.string().regex(/^[A-Z]{2}$/).default('US').parse(req.query.region ?? 'US');
    const language = z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/).default('en').parse(req.query.language ?? 'en');
    res.json({ categories: await searchCategories((await clientForLocation(u, id)).client, q, region, language) });
  });
  route('get', base + '/attribute-metadata', async (req, res, u) => {
    const id = idParam.parse(req.params.id);
    const category = z.string().regex(/^categories\/[\w:.-]+$/).optional().parse(req.query.category || undefined);
    const region = z.string().regex(/^[A-Z]{2}$/).default('US').parse(req.query.region ?? 'US');
    const { l, client } = await clientForLocation(u, id);
    res.json({ attributes: await attributeMetadata(client, l.gbp_location_name, category, region) });
  });
  // Service-area search (Places, regions only). Not a Business Profile call.
  route('get', '/api/gbp/listing/places', async (req, res, _u) => {
    const q = z.string().trim().min(2).max(120).parse(req.query.q);
    res.json({ places: await searchRegions(q, options.http) });
  });
  // Multi-location: the same change set to several of the account's linked locations, one verdict each.
  route('post', '/api/gbp/listing/bulk', async (req, res, u) => {
    const { locationIds } = z.object({ locationIds: z.array(idParam).min(1).max(100) }).parse({ locationIds: req.body?.locationIds });
    const parsed = parseListingFields({ fields: req.body?.fields });
    if ('errors' in parsed) return void res.status(400).json({ message: 'Fix the highlighted fields before applying.', ...parsed });
    res.json({ ...await writeListingBulk(u, locationIds, parsed.fields, make, req), warnings: parsed.warnings });
  });
}

export { LISTING_FIELDS };
