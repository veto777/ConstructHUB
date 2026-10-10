import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, emptyRecord, isoDate, assertPublicPage } from './http';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    const values: Record<string, string> = {};
    $('p:has(label)').each((_, e) => {
        const key = $(e).find('label').first().text().trim().replace(/:$/, '');
        const copy = $(e).clone();
        copy.find('label').remove();
        values[key] = copy.text().replace(/\s+/g, ' ').trim();
    });
    if (values['permit#'])
        return [{
                ...emptyRecord(ctx, values['permit#']), address: values.location || null, status: values['permit status'] || null, issuedAt: isoDate(values['issued on']), appliedAt: isoDate(values['created on']), expiresAt: isoDate(values.expiration), contractorName: values.contractor || null, workClass: values['work type'] || null, description: values['work description'] || null, sourceUrl: new URL('/buildingpermit/permits/search?search=' + encodeURIComponent(values['permit#']), ctx.searchUrl).href, raw: {
                    fields: values
                }
            }];
    if (/Nothing Found/.test($.text()))
        return [];
    const tables = $('table').filter((_, e) => $(e).find('thead th').length === 5 && $(e).find('thead').text().includes('permit number'));
    if (!tables.length)
        throw new Error('Garden Grove: missing search results');
    const records: PermitRecord[] = [];
    tables.each((_, table) => {
        const headers = $(table).find('thead th').map((_, e) => $(e).text().trim()).get();
        $(table).find('tbody tr').each((_, el) => {
            const cells = $(el).children('td,th');
            const v = cells.map((_, e) => $(e).text().trim()).get();
            const href = cells.first().find('a').attr('href');
            if (!v[0] || !href?.startsWith('/buildingpermit/permits/'))
                throw new Error('Garden Grove: invalid result link');
            records.push({
                ...emptyRecord(ctx, v[0]), issuedAt: headers[1] === 'issued' ? isoDate(v[1]) : null, status: v[2] || null, workClass: headers[3] === 'work type' ? v[3] || null : null, description: v[headers.indexOf('work description')] || null, sourceUrl: new URL(href, ctx.searchUrl).href, raw: {
                    html: $.html(el)
                }
            });
        });
    });
    return records;
}
const site: PortalAdapter = {
    platform: 'City-built', capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: true
    }, async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (u.host !== 'ggcity.org' || !u.pathname.startsWith('/buildingpermit/'))
            throw new Error('Not a Garden Grove public building permit URL');
        if (!['address', 'permit'].includes(q.type))
            throw new Error(`Garden Grove does not support ${q.type} search`);
        if (!q.value.trim())
            throw new Error('Search value required');
        const url = new URL('/buildingpermit/permits/search', u);
        url.searchParams.set('search', q.value.trim());
        return parseResults(await new PublicSession(ctx).request(url.href), ctx);
    }, async listRecent() {
        return [];
    }, async detail(ctx, n) {
        const r = await site.search(ctx, {
            type: 'permit', value: n
        });
        const matches = r.filter(r => r.permitNumber === n);
        if (matches.length > 1)
            throw new Error('Garden Grove: ambiguous permit number');
        return matches[0] ?? null;
    }
};
export default site;
