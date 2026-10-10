import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, formFields, emptyRecord, isoDate, splitAddress, assertPublicPage } from './http';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    if (/No records were found matching the search parameters/i.test($.text()))
        return [];
    const table = $('#search-results-table');
    if (!table.length)
        throw new Error('Eugene: missing search results table');
    const headers = table.find('thead th').map((_, e) => $(e).text().trim()).get();
    if (!headers.includes('Log Number') || !headers.includes('Received') || !headers.includes('Site Address'))
        throw new Error('Eugene: changed result columns');
    return table.find('tbody tr').toArray().map(el => {
        const cells = $(el).children('td');
        const values = cells.map((_, e) => $(e).text().trim()).get();
        const value = (label: string) => values[headers.indexOf(label)] || null;
        const number = value('Log Number');
        const href = cells.eq(0).find('a').attr('href');
        if (cells.length !== headers.length || !number || !/^\d{2}-\d+-\d{2}$/.test(number) || !href?.startsWith('PermitDetails?log='))
            throw new Error('Eugene: unrecognized permit row');
        return {
            ...emptyRecord(ctx, number), appliedAt: isoDate(value('Received')), issuedAt: isoDate(value('Date Issued')), expiresAt: isoDate(value('Expiration Date')), address: value('Site Address'), workClass: value('Scope of Work'), permitType: value('Permit Type'), status: value('Permit Status'), parcel: value('Map & Taxlot'), contractorName: /Search by Contractor Name/i.test($.text()) ? value('Name') : null, sourceUrl: new URL('/BuildingPermits/' + href, ctx.searchUrl).href, raw: {
                html: $.html(el)
            }
        };
    });
}
export function parseReport(html: string, ctx: AdapterCtx): PermitRecord {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    const cells = $('td').filter((_, e) => !$(e).find('td').length);
    const prefix = (key: string) => cells.toArray().map(e => $(e).text().trim()).find(t => t.startsWith(key + ':'))?.slice(key.length + 1).trim() || null;
    const field = (key: string) => cells.filter((_, e) => $(e).text().trim() === key + ':').first().next('td').text().trim() || null;
    const number = prefix('Permit Number');
    if (!number || !/^\d{2}-\d+-\d{2}$/.test(number))
        throw new Error('Eugene: invalid permit report');
    const received = field('Date Received');
    const date = received?.replace(/\/(\d{2})$/, (_, y) => '/' + (Number(y) >= 70 ? '19' : '20') + y);
    return {
        ...emptyRecord(ctx, number), address: prefix('Address'), description: prefix('Project Description'), status: field('Status'), permitType: field('Application Type'), workClass: field('Scope of Work'), appliedAt: isoDate(date), sourceUrl: new URL('/BuildingPermits/PermitDetails?log=' + number, ctx.searchUrl).href, raw: {
            html
        }
    };
}
function validate(ctx: AdapterCtx) {
    const u = new URL(ctx.searchUrl);
    if (u.host !== 'pdd.eugene-or.gov' || !/^\/buildingpermits\/permitsearch\/?$/i.test(u.pathname))
        throw new Error('Not an Eugene permit search URL');
    return u;
}
export function buildSearch(html: string, q: {
    type: string;
    value: string;
}): {
    path: string;
    fields: URLSearchParams;
} {
    const $ = load(html);
    let path: string;
    const fields = new URLSearchParams();
    const val = q.value.trim();
    if (!val)
        throw new Error('Search value required');
    if (q.type === 'permit') {
        const m = val.match(/^(\d{2})-(\d{1,5})-(\d{2})$/);
        if (!m)
            throw new Error('Eugene permit number must be YY-NNNNN-NN');
        path = 'SearchByPermitNumber';
        fields.set('LogYY', m[1]);
        fields.set('LogNumber', m[2]);
        fields.set('LogSequence', m[3]);
    }
    else if (q.type === 'address') {
        path = 'SearchBySiteAddress';
        const a = splitAddress(val);
        let street = a.street.replace(/,.*$/, '').toUpperCase();
        const direction = street.match(/^(N|S|E|W)\s+/)?.[1] ?? '';
        if (direction)
            street = street.slice(2);
        const options = $('select[name="address.AddressStreet"] option').map((_, e) => $(e).attr('value') ?? '').get().filter(Boolean).sort((a, b) => b.length - a.length);
        const choice = options.find(o => street === o.toUpperCase() || street.startsWith(o.toUpperCase() + ' '));
        if (!choice)
            throw new Error(`Eugene: street not found in public search options: ${a.street}`);
        const suffix = street.slice(choice.length).trim().split(/\s+/)[0] ?? '';
        const allowed = $('select[name="address.AddressType"] option').map((_, e) => $(e).attr('value')).get();
        const suffixOption = allowed.find(s => s.toUpperCase() === suffix) ?? '';
        fields.set('address.AddressNumber', a.number);
        fields.set('address.AddressDirection', direction);
        fields.set('address.AddressStreet', choice);
        fields.set('address.AddressType', suffixOption);
        fields.set('address.PermitStatus', '');
    }
    else if (q.type === 'company' || q.type === 'name') {
        const company = q.type === 'company';
        path = company ? 'SearchByContractorName' : 'SearchByPersonOrBusinessName';
        fields.set(company ? 'contractor.ContractorName' : 'name.PersonOrBusinessName', val);
        fields.set(company ? 'contractor.PermitStatus' : 'name.PermitStatus', '');
    }
    else
        throw new Error(`Eugene does not support ${q.type} search`);
    const form = $(`form[action$="/${path}"]`);
    if (!form.length)
        throw new Error('Eugene: expected search form missing');
    const base = formFields($.html(form));
    for (const [k, v] of fields)
        base.set(k, v);
    return {
        path, fields: base
    };
}
async function post(ctx: AdapterCtx, path: string, fields: URLSearchParams, session: PublicSession) {
    const html = await session.request(new URL('/BuildingPermits/' + path, ctx.searchUrl).href, fields);
    const $ = load(html);
    const report = $('#details-report-frame').attr('src');
    if (report) {
        const u = new URL(report, new URL('/BuildingPermits/', ctx.searchUrl));
        if (u.origin !== new URL(ctx.searchUrl).origin || u.pathname !== '/BuildingPermits/PermitReport')
            throw new Error('Eugene: unexpected report URL');
        return [parseReport(await session.request(u.href), ctx)];
    }
    return parseResults(html, ctx);
}
const site: PortalAdapter = {
    platform: 'City-built', capabilities: {
        search: ['address', 'permit', 'company', 'name'], listRecent: true, detail: false
    }, async search(ctx, q) {
        validate(ctx);
        const session = new PublicSession(ctx);
        const req = buildSearch(await session.request(ctx.searchUrl), q);
        return post(ctx, req.path, req.fields, session);
    }, async listRecent(ctx, since) {
        validate(ctx);
        const day = isoDate(since);
        if (!day)
            throw new Error('Invalid since date');
        const session = new PublicSession(ctx);
        const html = await session.request(ctx.searchUrl);
        const $ = load(html);
        const form = $('form[action$="/SearchByDateReceived"]');
        if (!form.length)
            throw new Error('Eugene: date received form missing');
        const fields = formFields($.html(form));
        const us = (s: string) => {
            const [y, m, d] = s.split('-');
            return `${m}/${d}/${y}`;
        };
        fields.set('received.FromDate', us(day));
        fields.set('received.ToDate', us(new Date().toISOString().slice(0, 10)));
        fields.set('received.PermitStatus', '');
        return (await post(ctx, 'SearchByDateReceived', fields, session)).filter(r => r.appliedAt && r.appliedAt >= day);
    }
};
export default site;
