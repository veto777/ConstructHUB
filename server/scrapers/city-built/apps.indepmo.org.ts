import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { politeJson } from '../polite-fetch';
import { emptyRecord, isoDate } from './http';
/** The original portal links to this city-owned open-data feed. It is an
 * explicit active-permit subset, not an archive or new-permit date feed. */
const endpoint = 'https://apps.independencemo.gov/opendata/api/opendata/dataset?code=V1BUILDINGPERMITS';
export function parseDataset(data: unknown, ctx: AdapterCtx): PermitRecord[] {
    const d = data as any;
    if (d?.dataSetCode !== 'V1BUILDINGPERMITS' || d.status !== 0 || !Array.isArray(d.dataSetData)) throw new Error('Independence: invalid active-permit dataset');
    return d.dataSetData.map((row: unknown) => {
        if (!Array.isArray(row) || row.some(field => !field || typeof field.title !== 'string')) throw new Error('Independence: malformed dataset row');
        const fields = Object.fromEntries(row.map(field => [field.title, field.value]));
        if (typeof fields['Permit Number'] !== 'string' || !fields['Permit Number']) throw new Error('Independence: missing permit number');
        const str = (name: string) => typeof fields[name] === 'string' ? fields[name].trim() || null : null;
        const valuation = str('Construction Value');
        return { ...emptyRecord(ctx, fields['Permit Number']), address: str('Address'), issuedAt: isoDate(str('Date Issued')),
            permitType: str('Type'), description: str('Construction Description'),
            valuation: valuation !== null && Number.isFinite(Number(valuation)) ? Number(valuation) : null,
            raw: { row, dataSetCode: d.dataSetCode, dataSetName: d.dataSetName, lastUpdated: d.lastUpdated } };
    });
}
const site: PortalAdapter = {
    platform: 'City of Independence Permits & Applications Center (city-specific)',
    capabilities: { search: ['address', 'permit'], listRecent: false, detail: false },
    async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (u.host !== 'apps.indepmo.org' || u.pathname.toLowerCase() !== '/apps/buildingpermits') throw new Error('Not an Independence permit portal URL');
        if (!['address', 'permit'].includes(q.type)) throw new Error(`Independence does not support ${q.type} search`);
        const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const value = normalize(q.value);
        if (!value) throw new Error('Search value required');
        const rows = parseDataset(await politeJson(endpoint, {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 0 }), ctx);
        ctx.log('Independence: searching the city open-data active-permit dataset only');
        return rows.filter(r => normalize(q.type === 'address' ? r.address ?? '' : r.permitNumber).includes(value));
    },
    async listRecent() { return []; }
};
export default site;
