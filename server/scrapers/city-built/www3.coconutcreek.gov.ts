import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, emptyRecord, splitAddress, assertPublicPage } from './http';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    if (/Nothing was found, please try again/.test($.text()))
        return [];
    const table = $('table').filter((_, e) => $(e).find('th').first().text() === 'Permit #');
    if (!table.length)
        throw new Error('Coconut Creek: missing permits table');
    return table.find('tr').toArray().filter(e => $(e).children('td').length > 0).map(el => {
        const td = $(el).children('td');
        const n = td.eq(0).find('input[name=btnsubmit]').attr('value');
        if (td.length !== 5 || !n)
            throw new Error('Coconut Creek: invalid result row');
        return {
            ...emptyRecord(ctx, n), status: td.eq(1).text().trim() || null, permitType: td.eq(2).text().trim() || null, ownerName: td.eq(3).text().trim() || null, address: td.eq(4).text().trim() || null, raw: {
                html: $.html(el)
            }
        };
    });
}
const site: PortalAdapter = {
    platform: 'City permit portal', capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: false
    }, async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (u.host !== 'www3.coconutcreek.gov' || u.pathname.toLowerCase() !== '/sd/permit/permit_status_01.asp')
            throw new Error('Not a Coconut Creek permit search URL');
        const value = q.value.trim();
        if (!value)
            throw new Error('Search value required');
        const fields = new URLSearchParams({
            permit_no: '', parcel_id: '', house_num: '', street: '', submitbutton: 'Search'
        });
        let number = '';
        if (q.type === 'permit') {
            if (!/^\d+$/.test(value))
                throw new Error('Coconut Creek permit numbers are numeric');
            fields.set('permit_no', value);
        }
        else if (q.type === 'address') {
            const a = splitAddress(value);
            number = a.number;
            const street = a.street.replace(/^(?:N|S|E|W)\s+/i, '').replace(/\s+(?:RD|ROAD|ST|STREET|DR|DRIVE|AVE|AVENUE|BLVD|BOULEVARD)(?:\s.*)?$/i, '');
            fields.set('street', street);
        }
        else
            throw new Error(`Coconut Creek does not support ${q.type} search`);
        const rows = parseResults(await new PublicSession(ctx).request(new URL('permit_status_02.asp', u).href, fields), ctx);
        return number ? rows.filter(r => r.address?.match(/^\d+[A-Za-z-]*/)?.[0] === number) : rows;
    }, async listRecent() {
        return [];
    }
};
export default site;
