import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, formFields, emptyRecord, isoDate, assertPublicPage } from './http';
const prefix = 'ctl00$cphBody$';
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, ctx.searchUrl);
    const $ = load(html);
    const records: PermitRecord[] = [];
    if (/Permit #\s*\d+/.test($('#LabelPgTitle').text())) {
        const title = $('#LabelPgTitle').text().trim();
        const n = title.match(/Permit #\s*(\d+)/)![1];
        const val = (id: string) => $('#cphBody_' + id).attr('value')?.trim() || null;
        const pages: Record<string, string> = {
            '0': 'BLPermit.aspx', '1': 'BLPermit.aspx', '2': 'APermitEL.aspx', '3': 'APermitPL.aspx', '4': 'APermitME.aspx', '6': 'APermitFR.aspx', '7': 'MHPermit.aspx', '8': 'APermitIG.aspx'
        };
        const valuation = val('txtValuation');
        return [{
                ...emptyRecord(ctx, n), address: val('txtPrjAddr'), issuedAt: isoDate(val('txtIssueDt')), description: val('txtPropUse'), permitType: title.split(' Permit #')[0], contractorLicense: val('txtCLId'), status: $('#cphBody_LabelStatus').text().trim() || null, valuation: valuation !== null && Number.isFinite(Number(valuation.replace(/[$,]/g, ''))) ? Number(valuation.replace(/[$,]/g, '')) : null, sourceUrl: pages[n[0]] ? new URL(pages[n[0]] + '?PermitNo=' + n + '&PopUp=1', ctx.searchUrl).href : null, raw: {
                    html
                }
            }];
    }
    const count = $('#InfoSpan').text().match(/Records Retrieved:\s*(\d+)/);
    // WATS reports its own failures there, e.g. "Error : Execution Timeout Expired." on a contractor-name search.
    const portalError = $('#InfoSpan').text().match(/Error\s*:\s*(.{1,160})/)?.[1]?.trim();
    if (!count && portalError)
        throw new Error(`St. Johns: portal error: ${portalError}`);
    if (!count)
        throw new Error('St. Johns: missing result count (portal failure or changed layout)');
    const colors: Record<string, string> = {};
    $('span[style*="background-color"]').each((_, el) => {
        const color = $(el).attr('style')?.match(/background-color:([^;]+)/i)?.[1].toLowerCase();
        if (color)
            colors[color] = $(el).text().trim();
    });
    $('#cphBody_gvSearch tr').each((_, el) => {
        const cells = $(el).children('td');
        if (cells.length !== 5)
            return;
        const values = cells.map((_, c) => $(c).text().trim()).get();
        const permitNumber = values[0];
        if (!/^\d+$/.test(permitNumber))
            throw new Error('St. Johns: invalid permit number');
        const page: Record<string, string> = {
            '0': 'BLPermit.aspx', '1': 'BLPermit.aspx', '2': 'APermitEL.aspx', '3': 'APermitPL.aspx', '4': 'APermitME.aspx', '6': 'APermitFR.aspx', '7': 'MHPermit.aspx', '8': 'APermitIG.aspx'
        };
        const color = $(el).attr('style')?.match(/background-color:([^;]+)/i)?.[1].toLowerCase();
        records.push({
            ...emptyRecord(ctx, permitNumber), address: values[1] || null, workClass: values[2] || null, issuedAt: isoDate(values[3]), contractorName: values[4] || null, status: color ? colors[color] ?? null : null, sourceUrl: page[permitNumber[0]] ? new URL(`${page[permitNumber[0]]}?PermitNo=${permitNumber}&PopUp=1`, ctx.searchUrl).href : null, raw: {
                html: $.html(el)
            }
        });
    });
    if (records.length !== Number(count[1]))
        throw new Error(`St. Johns: incomplete results, expected ${count[1]}, got ${records.length}`);
    if (records.length >= ST_JOHNS_RESULT_CAP)
        throw new Error(`St. Johns: search results capped at ${ST_JOHNS_RESULT_CAP}; narrow the search`);
    return records;
}
/** WATS returns at most this many rows ("Records Retrieved: 5000" for a large builder's license). */
export const ST_JOHNS_RESULT_CAP = 5000;

export type StJohnsLicense = { clid: string; name: string | null; company: string | null };
/** SearchCL.aspx answers a name with a license list, or with the one contractor's CLInfo page when only one matches. */
export function parseContractorSearch(html: string, url: string): StJohnsLicense[] {
    assertPublicPage(html, url);
    const $ = load(html);
    const info = $('form[action*="CLInfo.aspx"]').attr('action')?.match(/CLId=([^&]+)/i)?.[1];
    if (info) {
        // The info page's title label reads "SC-CGC1504066 * KLEFFMAN, JEFFREY LEE * ABLE CONSTRUCTION INC".
        const clid = decodeURIComponent(info);
        const parts = $('#cphBody_lblTitle1').text().replace(/\s+/g, ' ').trim().split(' * ').map(v => v.trim());
        if (parts[0] !== clid) throw new Error('St. Johns: contractor page does not match its license');
        return [{ clid, name: parts[1] || null, company: parts[2] || null }];
    }
    const count = $('#InfoSpan').text().match(/Records Retrieved:\s*(\d+)/);
    const portalError = $('#InfoSpan').text().match(/Error\s*:\s*(.{1,160})/)?.[1]?.trim();
    if (!count) throw new Error(portalError ? `St. Johns: portal error: ${portalError}` : 'St. Johns: contractor search returned no result count');
    const out: StJohnsLicense[] = [];
    $('#cphBody_gvSearch tr').each((_, el) => {
        const cells = $(el).children('td');
        const clid = cells.eq(0).find('a').first().text().trim();
        if (!clid) return;
        const text = (i: number) => cells.eq(i).text().replace(/\s+/g, ' ').trim() || null;
        out.push({ clid, name: text(1), company: text(2) });
    });
    if (out.length !== Number(count[1])) throw new Error(`St. Johns: contractor search expected ${count[1]} licenses, got ${out.length}`);
    return out;
}
const words = (v: string) => v.toLowerCase().split(/[^a-z0-9&']+/).filter(w => w.length >= 2);
/** The portal matches substrings ("Lennar" finds "STIMSON, JAMES LENNARD"); keep licenses naming every word. */
export function licensesNaming(licenses: StJohnsLicense[], value: string): StJohnsLicense[] {
    const want = words(value);
    return licenses.filter(l => [l.name, l.company].some(f => { const have = new Set(words(f ?? '')); return want.length > 0 && want.every(w => have.has(w)); }));
}
const MAX_LICENSES = 10;
/** Contractor name search times out in WATS itself ("Execution Timeout Expired"); look the contractor up first. */
async function byContractor(ctx: AdapterCtx, value: string): Promise<PermitRecord[]> {
    const url = new URL(ctx.searchUrl);
    if (url.host !== 'webapp.sjcfl.us' || !/^\/watswebx\/Permit\/SearchPermit.aspx$/i.test(url.pathname))
        throw new Error('Not a St. Johns WATS permit search URL');
    const search = new URL('SearchCL.aspx?PermitNo=&PopUp=0', ctx.searchUrl).href;
    const session = new PublicSession(ctx);
    const fields = formFields(await session.request(search));
    fields.set(prefix + 'txtSearch', value);
    fields.set(prefix + 'btnSearch', 'Search');
    const licenses = licensesNaming(parseContractorSearch(await session.request(search, fields), search), value);
    if (licenses.length > MAX_LICENSES) throw new Error(`St. Johns: ${licenses.length} contractor licenses match; narrow the search`);
    const out = new Map<string, PermitRecord>();
    for (const license of licenses) {
        for (const r of await query(ctx, { txtCLId: license.clid })) {
            // The grid's contractor column is the license's qualifier; the license itself names the company.
            out.set(r.permitNumber, { ...r, contractorName: license.company ?? r.contractorName, contractorLicense: license.clid,
                raw: { ...r.raw, listedNames: [license.company, license.name ?? r.contractorName].filter(Boolean), license } });
        }
    }
    return [...out.values()];
}
async function query(ctx: AdapterCtx, values: Record<string, string>) {
    const url = new URL(ctx.searchUrl);
    if (url.host !== 'webapp.sjcfl.us' || !/^\/watswebx\/Permit\/SearchPermit.aspx$/i.test(url.pathname))
        throw new Error('Not a St. Johns WATS permit search URL');
    const session = new PublicSession(ctx);
    const html = await session.request(url.href);
    const fields = formFields(html);
    for (const key of ['txtAddr', 'txtProjNm', 'txtPermitNo', 'txtClrsht', 'txtParcel', 'txtCLNm', 'txtCLId', 'txtSepticNo', 'TextBoxFromDt', 'TextBoxToDt', 'txtLgl1', 'txtLgl2', 'txtLgl3'])
        fields.set(prefix + key, '');
    fields.set(prefix + 'ddPermitType', '-1');
    fields.set(prefix + 'btnSearch', 'Search');
    for (const [k, v] of Object.entries(values))
        fields.set(prefix + k, v);
    return parseResults(await session.request(url.href, fields), ctx);
}
const site: PortalAdapter = {
    platform: 'WATS (county-specific)', capabilities: {
        search: ['address', 'permit', 'company', 'license', 'name'], listRecent: true, detail: false
    }, async search(ctx, q) {
        const fields: Record<string, string> = {
            address: 'txtAddr', permit: 'txtPermitNo', company: 'txtCLNm', license: 'txtCLId', name: 'txtCLNm'
        };
        const field = fields[q.type];
        if (!field)
            throw new Error(`St. Johns does not support ${q.type} search`);
        if (!q.value.trim())
            throw new Error('Search value required');
        if (q.type === 'company' || q.type === 'name')
            return byContractor(ctx, q.value.trim());
        return query(ctx, {
            [field]: q.value.trim()
        });
    }, async listRecent(ctx, since) {
        const day = isoDate(since);
        if (!day)
            throw new Error('Invalid since date');
        const d = new Date(day);
        d.setUTCDate(d.getUTCDate() - 1);
        const us = (s: string) => {
            const [y, m, d] = s.split('-');
            return `${m}/${d}/${y}`;
        };
        return (await query(ctx, {
            TextBoxFromDt: us(d.toISOString().slice(0, 10)), TextBoxToDt: us(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
        })).filter(r => r.issuedAt !== null && r.issuedAt !== undefined && r.issuedAt >= day);
    }
};
export default site;
