import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, assertPublicPage, emptyRecord, isoDate, splitAddress } from './http';
/** The site-wide feedback widget uses CAPTCHA; the independent permit-search
 * form does not. Inspect the search content without that unrelated widget. */
export function validatePage(html: string, url: string) {
    const $ = load(html);
    if ($('#form-permit').length && new URL(url).host === 'www.palmcoast.gov') {
        $('#feedbackForm').remove();
        $('script').remove();
    }
    assertPublicPage($.html(), url);
}
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    validatePage(html, ctx.searchUrl);
    const $ = load(html);
    if (/capped at/i.test($.text())) throw new Error('Palm Coast: search results capped; narrow the search');
    if (/No permits found/i.test($.text())) return [];
    const table = $('table').filter((_, e) => $(e).find('th').first().text().trim() === 'Permit #');
    if (table.length !== 1) throw new Error('Palm Coast: missing permit results');
    const records: PermitRecord[] = [];
    table.find('tbody tr').each((_, row) => {
        const cells = $(row).children('td');
        const v = cells.map((_, e) => $(e).text().trim()).get();
        const href = cells.first().find('a').attr('href');
        if (v.length !== 8 || !/^\d+$/.test(v[0]) || !href?.startsWith('/building/details/')) throw new Error('Palm Coast: invalid permit row');
        const valuation = v[7].replace(/[^\d.-]/g, '');
        records.push({ ...emptyRecord(ctx, v[0]), address: v[1] || null, permitType: v[2] || null,
            status: v[3] || null, issuedAt: isoDate(v[4]), applicantName: v[5] || null,
            ownerName: v[6] || null, valuation: valuation && Number.isFinite(Number(valuation)) ? Number(valuation) : null,
            sourceUrl: new URL(href, ctx.searchUrl).href, raw: { html: $.html(row) } });
    });
    const count = $.text().match(/Showing\s+(\d+)\s+permits?/);
    if (!count || records.length !== Number(count[1])) throw new Error('Palm Coast: incomplete permit results');
    return records;
}
export function addressFields(value: string) {
    const a = splitAddress(value.split(',')[0].replace(/\s+(?:UNIT|SUITE|STE|#)\s*.*$/i, '').trim());
    const parts = a.street.toUpperCase().split(/\s+/);
    if (/^(?:NE|NW|SE|SW|N|S|E|W)$/.test(parts.at(-1)!)) parts.pop();
    const suffix = /^(?:AV|AVE|BEND|BLVD|CIR|CT|DR|GRADE|HWY|LN|PATH|PKWY|PL|RD|RUN|S|SQ|ST|TER|TR|TRL|TURN|WAY)$/.test(parts.at(-1)!) ? parts.pop()! : '';
    return { HouseNumber: a.number, StreetName: parts.join(' '), StreetSuffix: suffix };
}
async function query(ctx: AdapterCtx, values: Record<string, string>) {
    const url = new URL(ctx.searchUrl);
    if (url.host !== 'www.palmcoast.gov' || url.pathname !== '/building/search') throw new Error('Not a Palm Coast permit search URL');
    const session = new PublicSession(ctx, url.origin, validatePage);
    const $ = load(await session.request(url.href));
    if (!$('#form-permit').length) throw new Error('Palm Coast: permit form missing');
    const token = $('input[name=__RequestVerificationToken]').first().attr('value');
    if (!token) throw new Error('Palm Coast: session form token missing');
    return parseResults(await session.request(url.href, new URLSearchParams({ ActiveTab: 'permit', __RequestVerificationToken: token, ...values })), ctx);
}
const site: PortalAdapter = {
    platform: 'Palm Coast Connect (city-specific)', capabilities: { search: ['address', 'permit', 'company'], listRecent: true, detail: false },
    async search(ctx, q) {
        if (!q.value.trim()) throw new Error('Search value required');
        if (q.type === 'address') return query(ctx, { SearchType: 'PermitByAddress', ...addressFields(q.value) });
        if (q.type === 'permit') return query(ctx, { SearchType: 'PermitByPermitNumber', PermitNumber: q.value.trim() });
        if (q.type === 'company') return query(ctx, { SearchType: 'PermitByContractor', ContractorName: q.value.trim() });
        throw new Error(`Palm Coast does not support ${q.type} search`);
    },
    async listRecent(ctx, since) {
        const date = new Date(since);
        if (!Number.isFinite(date.valueOf())) throw new Error('Invalid since date');
        const from = date.toISOString().slice(0, 10);
        const records = await query(ctx, { SearchType: 'PermitByDateRange', DateFrom: from, DateTo: new Date().toISOString().slice(0, 10), DateToSearch: 'ISSUED' });
        return records.filter(r => r.issuedAt && r.issuedAt >= from);
    }
};
export default site;
