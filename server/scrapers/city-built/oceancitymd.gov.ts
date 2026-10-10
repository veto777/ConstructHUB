import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { politeJson, PortalBlockedError } from '../polite-fetch';
import { emptyRecord } from './http';
/** Read-only layer linked by the town's public Permit Tracker dashboard. */
export const layer = 'https://services1.arcgis.com/jjVcwHv9AQEq3DH3/arcgis/rest/services/TOC_Building_Permits_Read_Only/FeatureServer/0';
export function parsePage(data: unknown, ctx: AdapterCtx): { records: PermitRecord[]; more: boolean } {
    const d = data as any;
    if (d?.error) {
        if ([401, 403, 429, 498, 499].includes(d.error.code)) throw new PortalBlockedError(layer, d.error.code === 499 || d.error.code === 498 ? 401 : d.error.code, d.error.message);
        throw new Error(`Ocean City query failed: ${d.error.message}`);
    }
    if (!Array.isArray(d?.features)) throw new Error('Ocean City: invalid feature response');
    const date = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null;
    return { more: d.exceededTransferLimit === true, records: d.features.map((f: any) => {
        const a = f?.attributes;
        if (!a || typeof a.App_ !== 'string' || !a.App_ || !Number.isInteger(a.OBJECTID)) throw new Error('Ocean City: invalid permit feature');
        const str = (k: string) => typeof a[k] === 'string' ? a[k].trim() || null : null;
        const publicLink = str('link');
        return { ...emptyRecord(ctx, a.App_), address: str('ADDRESS'), permitType: str('Permit_Type'),
            description: str('Description'), status: str('Status'), appliedAt: date(a.DateRecd), issuedAt: date(a.DateIssd),
            parcel: str('TAXID'), valuation: typeof a.Value === 'number' ? a.Value : null,
            lat: d.spatialReference?.wkid === 4326 && typeof f.geometry?.y === 'number' ? f.geometry.y : null,
            lng: d.spatialReference?.wkid === 4326 && typeof f.geometry?.x === 'number' ? f.geometry.x : null,
            sourceUrl: publicLink?.startsWith('https://oceancitymd.gov/GIS/Permits/') ? publicLink : null, raw: f };
    }) };
}
export function searchWhere(type: string, value: string) {
    if (!['address', 'permit'].includes(type)) throw new Error(`Ocean City does not support ${type} search`);
    if (!value.trim()) throw new Error('Search value required');
    const field = type === 'address' ? 'ADDRESS' : 'App_';
    const literal = value.trim().toUpperCase().replace(/'/g, "''");
    return type === 'permit' ? `UPPER(${field}) = '${literal}'` : `UPPER(${field}) LIKE '%${literal}%'`;
}
async function query(ctx: AdapterCtx, where: string) {
    const u = new URL(ctx.searchUrl);
    if (u.host !== 'oceancitymd.gov' || u.pathname !== '/oc/departments/planning-community-development/online-permitting/') throw new Error('Not an Ocean City public permitting URL');
    const out: PermitRecord[] = [], seen = new Set<number>();
    for (let page = 0; page < 50; page++) {
        const url = new URL(layer + '/query');
        url.search = new URLSearchParams({ f: 'json', where, outFields: '*', returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID', resultOffset: String(out.length), resultRecordCount: '2000' }).toString();
        const data = await politeJson(url.href, {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 0 });
        const result = parsePage(data, ctx);
        for (const row of result.records) {
            const id = (row.raw?.attributes as Record<string, number>).OBJECTID;
            if (seen.has(id)) throw new Error('Ocean City: repeated page; retry search');
            seen.add(id);
            out.push(row);
        }
        if (!result.more) return out;
        if (!result.records.length) throw new Error('Ocean City: incomplete pagination');
    }
    throw new Error('Ocean City: result limit exceeded; narrow search');
}
const site: PortalAdapter = {
    platform: 'town online permitting', capabilities: { search: ['address', 'permit'], listRecent: true, detail: false },
    async search(ctx, q) { return query(ctx, searchWhere(q.type, q.value)); },
    async listRecent(ctx, since) {
        const date = new Date(since);
        if (!Number.isFinite(date.valueOf())) throw new Error('Invalid since date');
        const time = date.toISOString().replace('T', ' ').slice(0, 19);
        return query(ctx, `(DateIssd >= TIMESTAMP '${time}' OR DateRecd >= TIMESTAMP '${time}')`);
    }
};
export default site;
