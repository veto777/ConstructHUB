import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, emptyRecord, splitAddress, assertPublicPage } from './http';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    if (/no records matching your search were returned/i.test($.text()))
        return [];
    const records = new Map<string, PermitRecord>();
    $('table').each((_, el) => {
        const rows = $(el).children('tbody').children('tr');
        if (rows.length !== 6 || !rows.eq(4).text().includes('Application (Permit) Number'))
            return;
        const cells = (i: number) => rows.eq(i).children('td').map((_, e) => $(e).text().trim()).get();
        const a = cells(1), b = cells(3), c = cells(5);
        if (!/^\d+$/.test(c[0]))
            throw new Error('Johnston: invalid permit row');
        const prior = records.get(c[0]);
        if (prior) {
            (prior.raw!.rows as string[]).push($.html(el));
            if (prior.applicantName !== a[3])
                prior.applicantName = null;
            return;
        }
        const cost = Number(c[1].replace(/[$,]/g, ''));
        records.set(c[0], {
            ...emptyRecord(ctx, c[0]), address: b[0] || null, permitType: a[1] || null, applicantName: a[3] || null, contractorName: c[3] && !/see card/i.test(c[3]) ? c[3] : null, valuation: c[1] && Number.isFinite(cost) ? cost : null, raw: {
                rows: [$.html(el)]
            }
        });
    });
    if (!records.size)
        throw new Error('Johnston: missing permit results or no-results message');
    return [...records.values()];
}
const site: PortalAdapter = {
    platform: 'County permit search', capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: false
    }, async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (!['www.johnstonnc.gov', 'johnstonnc.gov'].includes(u.host) || !['/content.cfm', '/insp/content.cfm'].includes(u.pathname))
            throw new Error('Not a Johnston County permit search URL');
        const fields = new URLSearchParams();
        let path: string;
        if (q.type === 'permit') {
            if (!/^\d+$/.test(q.value.trim()))
                throw new Error('Johnston permit numbers are numeric');
            fields.set('PermitNum', q.value.trim());
            path = '/insp/permit_by_apno.cfm';
        }
        else if (q.type === 'address') {
            const a = splitAddress(q.value);
            if (!/^\d+$/.test(a.number))
                throw new Error('Johnston address search requires a numeric house number');
            fields.set('HouseNum', a.number);
            fields.set('StreetName', a.street.replace(/,.*$/, '').replace(/^(?:N|S|E|W|NE|NW|SE|SW)\s+/i, '').replace(/\s+(?:STREET|ST|ROAD|RD|DRIVE|DR|AVENUE|AVE|LANE|LN|COURT|CT|BOULEVARD|BLVD|CIRCLE|CIR)$/i, ''));
            path = '/insp/permitbyaddress1.cfm';
        }
        else
            throw new Error(`Johnston does not support ${q.type} search`);
        return parseResults(await new PublicSession(ctx).request(new URL(path, u).href, fields), ctx);
    }, async listRecent() {
        return [];
    }
};
export default site;
