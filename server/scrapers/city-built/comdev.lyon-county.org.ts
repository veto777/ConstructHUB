import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, formFields, emptyRecord, isoDate } from './http';
const prefix = 'ctl00$BodyPlaceHolder$';
const path = '/CitizenPortal/PermitUI/PermitSearch.aspx';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    const $ = load(html);
    const count = $('#ctl00_BodyPlaceHolder_lblResultCount').text().trim();
    if (!/^\d+$/.test(count)) throw new Error('Lyon: missing result count');
    const result: PermitRecord[] = [];
    $('#ctl00_BodyPlaceHolder_dgSearchResults tr.itemstyle, #ctl00_BodyPlaceHolder_dgSearchResults tr.alternatingitemstyle').each((_, row) => {
        const v = $(row).children('td').map((_, e) => $(e).text().trim()).get();
        if (v.length !== 11 || !v[0]) throw new Error('Lyon: unrecognized permit row');
        const date = (s: string) => isoDate(s.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, '$1/$2/$3'));
        result.push({ ...emptyRecord(ctx, v[0]), address: v[2] || null, description: v[1] || null,
            permitType: v[4] || null, appliedAt: date(v[5]), expiresAt: date(v[6]), status: v[7] || null,
            raw: { html: $.html(row) } });
    });
    if (result.length !== Number(count)) throw new Error('Lyon: incomplete results; narrow the search');
    return result;
}
async function query(ctx: AdapterCtx, values: Record<string, string>) {
    const u = new URL(ctx.searchUrl);
    if (u.host !== 'comdev.lyon-county.org' || !u.pathname.startsWith('/CitizenPortal/')) throw new Error('Not a Lyon Citizen Portal URL');
    const url = new URL(path, u).href;
    const session = new PublicSession(ctx);
    const html = await session.request(url);
    const fields = formFields(html);
    for (const [key, value] of Object.entries(values)) fields.set(prefix + key, value);
    fields.set(prefix + 'btnSearch', 'Search');
    return parseResults(await session.request(url, fields), ctx);
}
const site: PortalAdapter = {
    platform: 'Community Development Citizen Portal',
    capabilities: { search: ['address', 'permit', 'company', 'name'], listRecent: true, detail: false },
    async search(ctx, q) {
        const fields = { address: 'txbAddress', permit: 'txbPermitNumber', company: 'txbContractorBusinessName', name: 'txbOwnerName' } as const;
        if (!(q.type in fields)) throw new Error(`Lyon does not support ${q.type} search`);
        if (!q.value.trim()) throw new Error('Search value required');
        return query(ctx, { [fields[q.type as keyof typeof fields]]: q.value.trim() });
    },
    async listRecent(ctx, since) {
        const date = new Date(since);
        if (!Number.isFinite(date.valueOf())) throw new Error('Invalid since date');
        const us = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
        const records = await query(ctx, { txbSubmissionDateBegin: us(date), txbSubmissionDateEnd: us(new Date()) });
        return records.filter(r => r.appliedAt && r.appliedAt >= date.toISOString().slice(0, 10));
    }
};
export default site;
