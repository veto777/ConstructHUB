import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { politeJson } from '../polite-fetch';
import { PublicSession, emptyRecord, isoDate, assertPublicPage } from './http';
export function parseAddress(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    const table = $('#permits');
    if (!table.length || !table.find('th').text().includes('Permit Number'))
        throw new Error('Summit: missing permits table');
    const address = $('.card').filter((_, e) => $(e).find('h5').first().text() === 'Address Details').find('h6').first().text().trim() || null;
    return table.find('tbody tr').toArray().map(el => {
        const td = $(el).children('td');
        if (td.length !== 7)
            throw new Error('Summit: unexpected permit table row');
        const v = td.map((_, e) => $(e).text().trim()).get();
        const href = td.eq(0).find('a').attr('href');
        if (!v[2] || !href?.startsWith('/PermitResult?'))
            throw new Error('Summit: invalid permit link');
        return {
            ...emptyRecord(ctx, v[2]), address, permitType: v[1] || null, status: v[3] || null, issuedAt: isoDate(v[4]), sourceUrl: new URL(href, ctx.searchUrl).href, raw: {
                html: $.html(el)
            }
        };
    });
}
export function parseDetail(html: string, ctx: AdapterCtx): PermitRecord | null {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    if (/permit (?:was )?not found|no permit found/i.test($('main').text()))
        return null;
    const cards = $('.card');
    const card = (title: string) => cards.filter((_, e) => $(e).find('h5').first().text().trim() === title);
    const info = card('Permit Information'), details = card('Permit Details');
    const field = (container: ReturnType<typeof card>, key: string) => container.find('div.text-muted,h6').toArray().map(e => $(e).text().trim()).find(t => t.startsWith(key + ':'))?.slice(key.length + 1).trim() || null;
    const number = field(info, 'Number');
    if (!number)
        throw new Error('Summit: missing permit detail');
    return {
        ...emptyRecord(ctx, number), address: field(details, 'Address'), parcel: field(details, 'Parcel'), ownerName: field(card('Owner Information'), 'Name'), applicantName: field(card('Applicant Information'), 'Name'), contractorName: field(card('Contractor Information'), 'Name'), permitType: field(info, 'Type'), workClass: field(info, 'Category'), description: field(info, 'Work Description'), status: field(info, 'Status'), issuedAt: isoDate(field(info, 'Issue Date')), appliedAt: isoDate(field(info, 'Applied Date')), expiresAt: isoDate(field(info, 'Expire Date')), sourceUrl: new URL('/PermitResult?PermitNumber=' + encodeURIComponent(number), ctx.searchUrl).href, raw: {
            permitInformation: info.toString(), permitDetails: details.toString()
        }
    };
}
function validate(ctx: AdapterCtx) {
    const u = new URL(ctx.searchUrl);
    if (u.host !== 'permitsearch.summitoh.net' || u.pathname !== '/')
        throw new Error('Not a Summit County public search URL');
    return u;
}
const site: PortalAdapter = {
    platform: "Jurisdiction's own portal", capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: true
    }, async search(ctx, q) {
        const u = validate(ctx);
        if (!q.value.trim())
            throw new Error('Search value required');
        const session = new PublicSession(ctx);
        if (q.type === 'permit') {
            const row = parseDetail(await session.request(new URL('/PermitResult?PermitNumber=' + encodeURIComponent(q.value.trim()), u).href), ctx);
            return row ? [row] : [];
        }
        if (q.type !== 'address')
            throw new Error(`Summit does not support ${q.type} search`);
        if (q.value.trim().length < 3)
            throw new Error('Summit address search needs at least three characters');
        const data = await politeJson<any>(new URL('/api/search/' + encodeURIComponent(q.value.trim()), u).href, {}, {
            minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 0
        });
        if (data?.status !== 200 || !Array.isArray(data.value) || data.errorMessages?.length)
            throw new Error('Summit address lookup failed');
        if (data.value.length > 25)
            throw new Error('Summit address query matches over 25 properties; include house number');
        const result = new Map<string, PermitRecord>();
        for (const address of data.value) {
            if (!Number.isInteger(address.objectId))
                throw new Error('Summit invalid address ID');
            for (const r of parseAddress(await session.request(new URL('/AddressResult?id=' + address.objectId, u).href), ctx))
                result.set(r.permitNumber, r);
        }
        return [...result.values()];
    }, async listRecent() {
        return [];
    }, async detail(ctx, n) {
        const records = await site.search(ctx, {
            type: 'permit', value: n
        });
        return records[0] ?? null;
    }
};
export default site;
