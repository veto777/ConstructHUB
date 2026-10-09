/**
 * Listing editor: the update-mask builder, the validation that mirrors Google's stated rules, the
 * attribute mask, verdicts, and the route guard. Google is never called: the client gets a mocked
 * fetch, and the pure parts need no network at all. The route tests that touch rows use the lane's
 * local dev DB (same guard as guard.test.ts) with throw-away fixtures.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from '../db';
import { ensureAccountEventsSchema } from '../account-events';
import { ensureGbpSchema } from './schema';
import { ensureProfileGuardSchema } from './guard-schema';
import { GoogleClient, Limiter } from './client';
import { buildUpdateMask, validateListing, buildAttributeMask, validateAttributes, withUtm, moneyFromDecimal, decimalFromMoney, LISTING_FIELDS } from '@shared/gbp-listing';
import { verdictsFor, registerListingEditorRoutes, listingInput, LISTING_READ_MASK } from './listing-editor';
import { checkGuard, configureGuard, previewSnapshot } from './guard';
vi.mock('../email', () => ({ sendWithFallback: vi.fn(async () => ({ success: true })) }));

const loaded = {
  name: 'locations/editorfixture', title: 'Fixture Roofing', phoneNumbers: { primaryPhone: '555-0100' }, websiteUri: 'https://fixture.example.invalid/',
  categories: { primaryCategory: { name: 'categories/gcid:roofing_contractor', displayName: 'Roofing contractor', serviceTypes: [{ serviceTypeId: 'job_type_id:roof_repair', displayName: 'Roof repair' }] }, additionalCategories: [{ name: 'categories/gcid:siding_contractor', displayName: 'Siding contractor' }] },
  storefrontAddress: { revision: 3, regionCode: 'US', addressLines: ['1 Fixture St'], locality: 'Tampa', administrativeArea: 'FL', postalCode: '33601' },
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] },
  serviceArea: { businessType: 'CUSTOMER_AND_BUSINESS_LOCATION', regionCode: 'US', places: { placeInfos: [{ placeName: 'Tampa, FL', placeId: 'ChIJ-fixture' }] } },
  profile: { description: 'Roofs since 1999.' }, openInfo: { status: 'OPEN', openingDate: { year: 1999 } }, labels: ['crew-a'],
  serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:roof_repair' } }], metadata: { hasPendingEdits: false, placeId: 'fixture' },
};

describe('update mask: only what changed, in the shape locations.patch takes', () => {
  it('is empty when nothing changed, even if Google added output-only parts', () => {
    const draft = structuredClone(loaded);
    draft.categories.primaryCategory.displayName = 'Different label';
    (draft.serviceArea as any).regionCode = 'CA';
    draft.storefrontAddress.revision = 4;
    expect(buildUpdateMask(loaded, draft)).toEqual({ fields: {}, mask: [] });
  });
  it('lists changed fields only, strips category display names and keeps both category parts together', () => {
    const draft = structuredClone(loaded);
    draft.title = 'Fixture Roofing & Siding';
    draft.categories.additionalCategories.push({ name: 'categories/gcid:gutter_cleaning_service', displayName: 'Gutter cleaning service' } as any);
    const { fields, mask } = buildUpdateMask(loaded, draft);
    expect(mask).toEqual(['title', 'categories']);
    expect(fields.categories).toEqual({ primaryCategory: { name: 'categories/gcid:roofing_contractor' }, additionalCategories: [{ name: 'categories/gcid:siding_contractor' }, { name: 'categories/gcid:gutter_cleaning_service' }] });
  });
  it('sends null (mask without a body value) for a field the owner emptied', () => {
    const draft = structuredClone(loaded);
    draft.profile.description = '';
    draft.labels = [];
    (draft as any).websiteUri = undefined;
    const { fields, mask } = buildUpdateMask(loaded, draft);
    expect(mask.sort()).toEqual(['labels', 'profile.description', 'websiteUri']);
    expect(fields).toEqual({ 'profile.description': null, labels: null, websiteUri: null });
  });
  it('treats reordered additional categories and phones as unchanged, reordered address lines as changed', () => {
    const draft = structuredClone(loaded);
    draft.phoneNumbers = { primaryPhone: '555-0100', additionalPhones: ['555-0101', '555-0102'] };
    const two = structuredClone(draft); two.phoneNumbers.additionalPhones.reverse();
    expect(buildUpdateMask(draft, two).mask).toEqual([]);
    const lines = structuredClone(loaded); lines.storefrontAddress.addressLines = ['Suite 2', '1 Fixture St'];
    const twoLines = structuredClone(lines); twoLines.storefrontAddress.addressLines.reverse();
    expect(buildUpdateMask(lines, twoLines).mask).toEqual(['storefrontAddress']);
  });
  it('covers every editor field', () => {
    for (const f of LISTING_FIELDS) expect(typeof f).toBe('string');
    expect(LISTING_READ_MASK.split(',')).toEqual(expect.arrayContaining(['title', 'labels', 'serviceItems', 'specialHours', 'metadata']));
  });
});

describe('validation mirrors the API rules', () => {
  const today = new Date('2026-10-09T12:00:00Z');
  it('description: 750 characters is a hard limit; links and prices are warnings', () => {
    expect(validateListing({ 'profile.description': 'x'.repeat(751) }).errors['profile.description']).toHaveLength(1);
    expect(validateListing({ 'profile.description': 'x'.repeat(750) }).errors).toEqual({});
    const { warnings } = validateListing({ 'profile.description': 'Visit https://a.test — 50% off, $5 bagels' });
    expect(warnings['profile.description']).toHaveLength(2);
  });
  it('phones: at most two additional numbers; website: a full http(s) URL', () => {
    expect(validateListing({ phoneNumbers: { primaryPhone: '1', additionalPhones: ['2', '3', '4'] } }).errors.phoneNumbers).toBeTruthy();
    expect(validateListing({ phoneNumbers: { primaryPhone: '1', additionalPhones: ['2', '3'] } }).errors).toEqual({});
    expect(validateListing({ websiteUri: 'javascript:alert(1)' }).errors.websiteUri).toBeTruthy();
    expect(validateListing({ websiteUri: 'fixture.example.invalid' }).errors.websiteUri).toBeTruthy();
    expect(validateListing({ websiteUri: 'https://fixture.example.invalid/?utm_source=google' }).errors).toEqual({});
  });
  it('name: never empty; Google naming-guideline patterns are warnings, not blocks', () => {
    expect(validateListing({ title: '  ' }).errors.title).toBeTruthy();
    expect(validateListing({ title: null }).errors.title).toBeTruthy();
    const { errors, warnings } = validateListing({ title: 'Fixture Roofing LLC - 2872 Open 24 hours 813-555-0100 www.fixture.test' });
    expect(errors).toEqual({});
    expect(warnings.title.length).toBeGreaterThanOrEqual(4);
  });
  it('categories: a real id for the primary, up to nine additional, no repeats; both parts travel together', () => {
    expect(validateListing({ categories: { primaryCategory: { name: 'Roofing' }, additionalCategories: [] } }).errors.categories).toBeTruthy();
    expect(validateListing({ categories: { primaryCategory: { name: 'categories/gcid:a' }, additionalCategories: [{ name: 'categories/gcid:a' }] } }).errors.categories).toBeTruthy();
    expect(validateListing({ categories: { primaryCategory: { name: 'categories/gcid:a' }, additionalCategories: Array.from({ length: 10 }, (_, i) => ({ name: `categories/gcid:b${i}` })) } }).errors.categories).toBeTruthy();
    expect(validateListing({ categories: { primaryCategory: { name: 'categories/gcid:a' }, additionalCategories: [{ name: 'categories/gcid:b' }] } }).errors).toEqual({});
  });
  it('hours: closing after opening (24:00 allowed), special hours shorter than 24 hours and no times on a closed day', () => {
    expect(validateListing({ regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 9 } }] } }).errors.regularHours).toBeTruthy();
    expect(validateListing({ regularHours: { periods: [{ openDay: 'MONDAY', openTime: {}, closeDay: 'MONDAY', closeTime: { hours: 24 } }] } }).errors).toEqual({});
    expect(validateListing({ regularHours: { periods: [{ openDay: 'FUNDAY', openTime: {}, closeDay: 'MONDAY', closeTime: { hours: 24 } }] } }).errors.regularHours).toBeTruthy();
    const ok = { specialHourPeriods: [{ startDate: { year: 2026, month: 11, day: 26 }, closed: true }, { startDate: { year: 2026, month: 12, day: 24 }, openTime: { hours: 8 }, closeTime: { hours: 12 } }] };
    expect(validateListing({ specialHours: ok }).errors).toEqual({});
    expect(validateListing({ specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 11, day: 26 }, closed: true, openTime: { hours: 8 } }] } }).errors.specialHours).toBeTruthy();
    expect(validateListing({ specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 11, day: 26 }, endDate: { year: 2026, month: 11, day: 28 }, openTime: { hours: 8 }, closeTime: { hours: 12 } }] } }).errors.specialHours).toBeTruthy();
    expect(validateListing({ specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 2, day: 30 }, closed: true }] } }).errors.specialHours).toBeTruthy();
  });
  it('opening date: year required, no more than a year ahead; status from the enum', () => {
    expect(validateListing({ 'openInfo.openingDate': { year: 2028, month: 1 } }, { today }).errors['openInfo.openingDate']).toBeTruthy();
    expect(validateListing({ 'openInfo.openingDate': { year: 2027, month: 6 } }, { today }).errors).toEqual({});
    expect(validateListing({ 'openInfo.openingDate': { year: 1999, day: 4 } }, { today }).errors['openInfo.openingDate']).toBeTruthy();
    expect(validateListing({ 'openInfo.status': 'GONE' }).errors['openInfo.status']).toBeTruthy();
    expect(validateListing({ 'openInfo.status': 'CLOSED_PERMANENTLY' }).warnings['openInfo.status']).toBeTruthy();
  });
  it('service area: up to 20 places, each with Google\'s place id; a service-area business needs one', () => {
    expect(validateListing({ serviceArea: { businessType: 'CUSTOMER_LOCATION_ONLY', places: { placeInfos: [] } } }).errors.serviceArea).toBeTruthy();
    expect(validateListing({ serviceArea: { businessType: 'CUSTOMER_LOCATION_ONLY', places: { placeInfos: [{ placeName: 'Tampa, FL' }] } } }).errors.serviceArea).toBeTruthy();
    expect(validateListing({ serviceArea: { businessType: 'CUSTOMER_LOCATION_ONLY', places: { placeInfos: Array.from({ length: 21 }, (_, i) => ({ placeName: `P${i}`, placeId: `id${i}` })) } } }).errors.serviceArea).toBeTruthy();
    expect(validateListing({ serviceArea: { businessType: 'CUSTOMER_LOCATION_ONLY', places: { placeInfos: [{ placeName: 'Tampa, FL', placeId: 'ChIJx' }] } } }).errors).toEqual({});
  });
  it('labels 1–255 each; services: one kind per item, structured description ≤ 300, price shape', () => {
    expect(validateListing({ labels: ['ok', 'x'.repeat(256)] }).errors.labels).toBeTruthy();
    expect(validateListing({ labels: ['a', 'a'] }).errors.labels).toBeTruthy();
    expect(validateListing({ serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:x' }, freeFormServiceItem: { category: 'categories/gcid:a', label: { displayName: 'y' } } }] }).errors.serviceItems).toBeTruthy();
    expect(validateListing({ serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:x', description: 'd'.repeat(301) } }] }).errors.serviceItems).toBeTruthy();
    expect(validateListing({ serviceItems: [{ freeFormServiceItem: { category: 'categories/gcid:a', label: { displayName: 'n'.repeat(141) } } }] }).warnings.serviceItems).toBeTruthy();
    expect(validateListing({ serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:x' }, price: { currencyCode: 'usd', units: '10' } }] }).errors.serviceItems).toBeTruthy();
    expect(validateListing({ serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:x' }, price: { currencyCode: 'USD', units: '149', nanos: 500000000 } }] }).errors).toEqual({});
  });
  it('refuses fields the editor does not write (metadata, name)', () => {
    expect(validateListing({ metadata: { hasGoogleUpdated: false } }).errors.metadata).toBeTruthy();
    expect(() => listingInput.parse({ fields: { name: 'locations/other' } })).toThrow();
    expect(() => listingInput.parse({ fields: {} })).toThrow();
    expect(listingInput.parse({ fields: { labels: ['a'], serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:x' } }] } }).fields.labels).toEqual(['a']);
  });
  it('helpers: UTM keeps existing query, money round-trips units and nanos', () => {
    expect(withUtm('https://fixture.example.invalid/a?x=1', { source: 'google', medium: 'organic', campaign: 'gbp' })).toBe('https://fixture.example.invalid/a?x=1&utm_source=google&utm_medium=organic&utm_campaign=gbp');
    expect(moneyFromDecimal('149.5')).toEqual({ currencyCode: 'USD', units: '149', nanos: 500000000 });
    expect(moneyFromDecimal('20')).toEqual({ currencyCode: 'USD', units: '20' });
    expect(moneyFromDecimal('abc')).toBeNull();
    expect(decimalFromMoney({ units: '149', nanos: 500000000 })).toBe('149.50');
  });
});

describe('attribute mask: Google\'s update/delete contract', () => {
  const before = [
    { name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [true] },
    { name: 'attributes/url_facebook', valueType: 'URL', uriValues: [{ uri: 'https://facebook.example.invalid/fixture' }] },
    { name: 'attributes/pay_credit_card_types_accepted', valueType: 'REPEATED_ENUM', repeatedEnumValue: { setValues: ['visa'], unsetValues: ['amex'] } },
  ] as any[];
  it('puts changed attributes in the mask and body, deleted ones in the mask only, unchanged ones nowhere', () => {
    const after = structuredClone(before);
    after[0].values = [false];                              // changed
    after.splice(1, 1);                                     // facebook removed → delete
    after.push({ name: 'attributes/has_free_estimates', valueType: 'BOOL', values: [true] }); // new
    const { attributeMask, attributes } = buildAttributeMask(before, after);
    expect(attributeMask.sort()).toEqual(['attributes/has_free_estimates', 'attributes/has_wheelchair_accessible_entrance', 'attributes/url_facebook']);
    expect(attributes.map((a) => a.name).sort()).toEqual(['attributes/has_free_estimates', 'attributes/has_wheelchair_accessible_entrance']);
    expect(attributes.find((a) => a.name === 'attributes/has_wheelchair_accessible_entrance')).toEqual({ name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [false] });
  });
  it('an attribute emptied in place is a delete; an untouched set is an empty mask', () => {
    const after = structuredClone(before); after[1].uriValues = [];
    expect(buildAttributeMask(before, after)).toEqual({ attributeMask: ['attributes/url_facebook'], attributes: [] });
    expect(buildAttributeMask(before, structuredClone(before))).toEqual({ attributeMask: [], attributes: [] });
  });
  it('validates by type: BOOL one boolean, ENUM one id, URL https, REPEATED_ENUM at least one and no overlap', () => {
    expect(validateAttributes([{ name: 'attributes/x', valueType: 'BOOL', values: ['yes'] }] as any)['attributes/x']).toBeTruthy();
    expect(validateAttributes([{ name: 'attributes/x', valueType: 'ENUM', values: [] }] as any)['attributes/x']).toBeTruthy();
    expect(validateAttributes([{ name: 'attributes/x', valueType: 'URL', uriValues: [{ uri: 'javascript:1' }] }] as any)['attributes/x']).toBeTruthy();
    expect(validateAttributes([{ name: 'attributes/x', valueType: 'REPEATED_ENUM', repeatedEnumValue: { setValues: ['a'], unsetValues: ['a'] } }] as any)['attributes/x']).toBeTruthy();
    expect(validateAttributes([{ name: 'metadata', valueType: 'BOOL', values: [true] }] as any).metadata).toBeTruthy();
    expect(validateAttributes(before as any)).toEqual({});
  });
});

describe('verdicts are honest', () => {
  it('applied only when Google echoes the value; pending when Google flags a review; unconfirmed otherwise', () => {
    const fields = { title: 'New name', 'profile.description': 'New text' };
    const body = { title: 'New name', profile: { description: 'New text' } };
    expect(verdictsFor(fields, body, { ...loaded, title: 'New name', profile: { description: 'New text' } })).toEqual({ title: 'applied', 'profile.description': 'applied' });
    expect(verdictsFor(fields, body, { ...loaded, title: 'New name', metadata: { hasPendingEdits: true } })).toEqual({ title: 'applied', 'profile.description': 'pending' });
    expect(verdictsFor(fields, body, { ...loaded })).toEqual({ title: 'unconfirmed', 'profile.description': 'unconfirmed' });
    expect(verdictsFor({ labels: null }, {}, { ...loaded, labels: undefined })).toEqual({ labels: 'applied' });
  });
});

/* ── Routes: guard and the mocked Google boundary ─────────────────────────── */
let live: any, http: ReturnType<typeof vi.fn>, lastPatch: { url: URL; body: any } | null = null;
function harness(auth = (req: any) => req.user) {
  const handlers = new Map<string, any>();
  const app: any = {};
  for (const method of ['get', 'post', 'patch']) app[method] = (path: string, fn: any) => handlers.set(`${method} ${path}`, fn);
  const client = new GoogleClient(async () => 'fixture-token', http as any, new Limiter(() => 0, async () => {}), async () => {});
  registerListingEditorRoutes(app, auth, { make: () => client, http: http as any });
  return handlers;
}
const response = () => { const res: any = { json: vi.fn() }; res.status = vi.fn(() => res); return res; };
const request = (over: any = {}) => ({ user: { id: user }, session: {}, query: {}, body: {}, params: {}, headers: { 'user-agent': 'listing fixture' }, ip: '192.0.2.9', ...over });
let user = 0, other = 0, id = 0;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('a local development DB is required');
  await ensureGbpSchema(); await ensureAccountEventsSchema(); await ensureProfileGuardSchema();
  const { rows } = await pool.query("INSERT INTO users(email,password_hash) VALUES('listing-'||gen_random_uuid()||'@example.invalid',null),('listing-'||gen_random_uuid()||'@example.invalid',null) RETURNING id");
  [user, other] = rows.map((r) => r.id);
  id = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,'Fixture Roofing','accounts/editorfixture','locations/editorfixture','fixture-subject') RETURNING id", [user])).rows[0].id;
  live = structuredClone(loaded);
  http = vi.fn(async (input: any, options: any = {}) => {
    const u = new URL(String(input));
    if (!u.hostname.endsWith('googleapis.com')) throw new Error(`unexpected host ${u.hostname}`);
    if (u.pathname.endsWith('/attributes') && options.method === 'PATCH') {
      lastPatch = { url: u, body: JSON.parse(options.body) };
      const mask = u.searchParams.get('attributeMask')!.split(',');
      live.attributes = (live.attributes || []).filter((a: any) => !mask.includes(a.name)).concat(lastPatch.body.attributes);
      return new Response(JSON.stringify({ name: 'locations/editorfixture/attributes', attributes: live.attributes }));
    }
    if (u.pathname.endsWith('/attributes')) return new Response(JSON.stringify({ name: 'locations/editorfixture/attributes', attributes: live.attributes || [] }));
    if (u.pathname.endsWith('/categories')) return new Response(JSON.stringify({ categories: [{ name: 'categories/gcid:roofing_contractor', displayName: 'Roofing contractor', serviceTypes: [{ serviceTypeId: 'job_type_id:roof_repair', displayName: 'Roof repair' }] }, { name: 'not a category' }] }));
    if (options.method === 'PATCH') {
      lastPatch = { url: u, body: JSON.parse(options.body) };
      if (live.rejectWith) return new Response(JSON.stringify({ error: { code: 400, message: live.rejectWith } }), { status: 400 });
      for (const field of u.searchParams.get('updateMask')!.split(',')) {
        if (live.reviewing?.includes(field)) { live.metadata.hasPendingEdits = true; continue; }
        const [root, key] = field.split('.');
        if (key) { live[root] ??= {}; if (lastPatch.body[root]?.[key] === undefined) delete live[root][key]; else live[root][key] = lastPatch.body[root][key]; }
        else if (lastPatch.body[field] === undefined) delete live[field]; else live[field] = lastPatch.body[field];
      }
      return new Response(JSON.stringify(live));
    }
    return new Response(JSON.stringify(live));
  });
});
afterAll(async () => {
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)', [[user, other]]);
  await pool.query('DELETE FROM users WHERE id=ANY($1)', [[user, other]]);
  await pool.end();
});

describe('routes: the same guard as the profile PATCH, Google fully mocked', () => {
  it('does nothing for an unauthenticated request (auth answers), and never reaches Google', async () => {
    const h = harness((_req: any, res: any) => { res.status(401).json({ message: 'Not authenticated' }); return null; });
    const res = response();
    await h.get('get /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(http).not.toHaveBeenCalled();
  });
  it('answers 404 for a location another account owns, before any Google call', async () => {
    const h = harness(); const res = response();
    await h.get('get /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, user: { id: other } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(http).not.toHaveBeenCalled();
  });
  it('rejects a malformed body (400) and a rule violation (400 with per-field errors) without writing', async () => {
    const h = harness(); const patch = h.get('patch /api/gbp/locations/:id/listing');
    let res = response();
    await patch(request({ params: { id: String(id) }, body: { fields: { metadata: { hasPendingEdits: false } } } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors.metadata).toBeTruthy();
    res = response();
    await patch(request({ params: { id: String(id) }, body: { fields: { 'profile.description': 'x'.repeat(751) } } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors['profile.description']).toHaveLength(1);
    expect(http.mock.calls.filter((c) => c[1]?.method === 'PATCH')).toHaveLength(0);
  });
  it('loads the live listing with the editor read mask and the attributes', async () => {
    live.attributes = [{ name: 'attributes/has_free_estimates', valueType: 'BOOL', values: [true] }];
    const h = harness(); const res = response();
    await h.get('get /api/gbp/locations/:id/listing')(request({ params: { id: String(id) } }), res);
    const out = res.json.mock.calls[0][0];
    expect(out.location.title).toBe('Fixture Roofing');
    expect(out.attributes).toHaveLength(1);
    expect(String(http.mock.calls[0][0])).toContain(`readMask=${LISTING_READ_MASK}`);
  });
  it('PATCHes only the changed fields, records the edit, notifies the owner, and reports applied', async () => {
    const h = harness(); const res = response();
    await h.get('patch /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, body: { fields: { title: 'Fixture Roofing & Siding', labels: ['crew-a', 'crew-b'] } } }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(lastPatch!.url.searchParams.get('updateMask')).toBe('title,labels');
    expect(lastPatch!.body).toEqual({ title: 'Fixture Roofing & Siding', labels: ['crew-a', 'crew-b'] });
    expect(res.json.mock.calls[0][0].verdicts).toEqual({ title: 'applied', labels: 'applied' });
    const { rows: log } = await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind='gbp.profile_change' ORDER BY id DESC LIMIT 1", [user]);
    expect(log[0].detail).toMatchObject({ action: 'listing-edit', locationId: id, fields: ['title', 'labels'] });
    const { rows: notes } = await pool.query("SELECT title FROM user_notifications WHERE user_id=$1 AND kind='gbp.profile_change'", [user]);
    expect(notes.some((n) => /edited from ConstructHUB/.test(n.title))).toBe(true);
  });
  it('clears a field by sending the mask without a body value', async () => {
    const h = harness(); const res = response();
    await h.get('patch /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, body: { fields: { 'profile.description': null } } }), res);
    expect(lastPatch!.url.searchParams.get('updateMask')).toBe('profile.description');
    expect(lastPatch!.body).toEqual({});
    expect(res.json.mock.calls[0][0].verdicts).toEqual({ 'profile.description': 'applied' });
  });
  it('reports a review as pending (not saved), remembers it for Profile Guard, and Guard adopts it when it lands', async () => {
    // Establish a Guard snapshot of the current values first.
    const client = new GoogleClient(async () => 'fixture-token', http as any, new Limiter(() => 0, async () => {}), async () => {});
    const preview = await previewSnapshot(user, id, client);
    await configureGuard(user, id, 'notify', ['title', 'phoneNumbers'], preview.token);
    live.reviewing = ['title'];
    const h = harness(); const res = response();
    await h.get('patch /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, body: { fields: { title: 'Reviewed Name' } } }), res);
    expect(res.json.mock.calls[0][0].verdicts).toEqual({ title: 'pending' });
    const { rows } = await pool.query("SELECT status,new_value FROM gbp_guard_changes WHERE location_id=$1 AND field='title' ORDER BY id DESC LIMIT 1", [id]);
    expect(rows[0]).toEqual({ status: 'owner-pending', new_value: 'Reviewed Name' });
    // Google publishes the reviewed value: not a foreign change.
    live.reviewing = []; live.title = 'Reviewed Name'; live.metadata.hasPendingEdits = false;
    await checkGuard(user, id, client);
    const { rows: after } = await pool.query("SELECT status FROM gbp_guard_changes WHERE location_id=$1 AND field='title' ORDER BY id", [id]);
    expect(after.map((r) => r.status)).toEqual(['applied']);
    expect((await pool.query('SELECT snapshot FROM gbp_guard WHERE location_id=$1', [id])).rows[0].snapshot.title).toBe('Reviewed Name');
  });
  it('surfaces a Google rejection with Google\'s message and claims nothing', async () => {
    live.rejectWith = 'Invalid value for field title: contains a phone number.';
    const h = harness(); const res = response();
    await h.get('patch /api/gbp/locations/:id/listing')(request({ params: { id: String(id) }, body: { fields: { title: 'Fixture 555-0100' } } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toContain('Google: Invalid value for field title');
    live.rejectWith = undefined;
  });
  it('writes attributes with the attribute mask and refuses a body attribute outside the mask', async () => {
    const h = harness(); let res = response();
    await h.get('patch /api/gbp/locations/:id/listing/attributes')(request({ params: { id: String(id) }, body: { attributeMask: ['attributes/has_free_estimates', 'attributes/url_facebook'], attributes: [{ name: 'attributes/url_facebook', valueType: 'URL', uriValues: [{ uri: 'https://facebook.example.invalid/fixture' }] }] } }), res);
    expect(lastPatch!.url.pathname).toBe('/v1/locations/editorfixture/attributes');
    expect(lastPatch!.url.searchParams.get('attributeMask')).toBe('attributes/has_free_estimates,attributes/url_facebook');
    expect(res.json.mock.calls[0][0].verdicts).toEqual({ 'attributes/has_free_estimates': 'applied', 'attributes/url_facebook': 'applied' });
    res = response();
    await h.get('patch /api/gbp/locations/:id/listing/attributes')(request({ params: { id: String(id) }, body: { attributeMask: ['attributes/a'], attributes: [{ name: 'attributes/b', valueType: 'BOOL', values: [true] }] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('category picker returns real category ids only', async () => {
    const h = harness(); const res = response();
    await h.get('get /api/gbp/locations/:id/listing/categories')(request({ params: { id: String(id) }, query: { q: 'roof' } }), res);
    expect(res.json.mock.calls[0][0].categories).toEqual([{ name: 'categories/gcid:roofing_contractor', displayName: 'Roofing contractor', serviceTypes: [{ serviceTypeId: 'job_type_id:roof_repair', displayName: 'Roof repair' }] }]);
    expect(String(http.mock.calls.at(-1)![0])).toContain('filter=displayName%3Droof');
  });
  it('multi-location apply gives one verdict per owned location and refuses a foreign one by id', async () => {
    const h = harness(); const res = response();
    await h.get('post /api/gbp/listing/bulk')(request({ body: { locationIds: [id, 2147483647], fields: { labels: ['bulk'] } } }), res);
    const { results } = res.json.mock.calls[0][0];
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id, ok: true, verdicts: { labels: 'applied' } });
    expect(results[1]).toMatchObject({ id: 2147483647, ok: false });
  });
  it('place search is refused honestly when no Places key is configured', async () => {
    const saved = process.env.GOOGLE_PLACES_API_KEY; delete process.env.GOOGLE_PLACES_API_KEY;
    try {
      const h = harness(); const res = response();
      await h.get('get /api/gbp/listing/places')(request({ query: { q: 'Tampa' } }), res);
      expect(res.status).toHaveBeenCalledWith(503);
    } finally { if (saved !== undefined) process.env.GOOGLE_PLACES_API_KEY = saved; }
  });
  it('never contacted a host other than googleapis.com', () => {
    for (const call of http.mock.calls) expect(new URL(String(call[0])).hostname).toMatch(/\.googleapis\.com$/);
  });
});
