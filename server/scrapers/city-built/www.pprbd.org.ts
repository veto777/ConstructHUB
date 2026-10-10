import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { politeJson, PortalBlockedError } from '../polite-fetch';
import { emptyRecord } from './http';
const departments: Record<string, string> = { B: 'Building', E: 'Electrical', H: 'Mechanical', P: 'Plumbing', S: 'Sign', T: 'Manufactured Home', V: 'Elevator', W: 'Wrecking' };
const statuses: Record<string, string> = { F: 'Finaled', O: 'Open', P: 'Pending', L: 'Locked' };
const jurisdictions = ['EL PASO COUNTY', 'MANITOU SPRINGS', 'MONUMENT', 'WOODLAND PARK'];
export function jurisdictionFilter(ctx: AdapterCtx) {
    const u = new URL(ctx.searchUrl);
    if (u.host !== 'www.pprbd.org' || !['/', '/Search/Permit'].includes(u.pathname)) throw new Error('Not a PPRBD public portal URL');
    // All catalog cities share one regional URL. The host selects PPRBD; the
    // explicit catalog jurisdiction restricts records within that agency.
    const jurisdiction = ctx.jurisdiction.split(',')[0].trim().toUpperCase();
    if (!jurisdictions.includes(jurisdiction)) throw new Error('PPRBD: unverified catalog jurisdiction scope');
    return jurisdiction;
}
export function parsePage(data: unknown, ctx: AdapterCtx, jurisdiction: string): { records: PermitRecord[]; more: boolean } {
    const d = data as any;
    if (d?.error) {
        if ([401, 403, 429, 498, 499].includes(d.error.code)) throw new PortalBlockedError(ctx.searchUrl, d.error.code >= 498 ? 401 : d.error.code, d.error.message);
        throw new Error(`PPRBD: ${d.error.message}`);
    }
    if (!Array.isArray(d?.features)) throw new Error('PPRBD: invalid GIS response');
    return { more: d.exceededTransferLimit === true, records: d.features.map((feature: any) => {
        const a = feature?.attributes;
        if (!a || typeof a.PermitNum !== 'string' || !a.PermitNum || !Number.isInteger(a.OBJECTID) || a.Jurisdiction !== jurisdiction) throw new Error('PPRBD: malformed record or jurisdiction mismatch');
        const str = (key: string) => typeof a[key] === 'string' ? a[key].trim() || null : null;
        return { ...emptyRecord(ctx, a.PermitNum), address: str('FullAddress1'), parcel: str('parcel'),
            contractorName: str('ContractorName'), description: str('ProjectDesc'), workClass: str('ProjectCode'),
            permitType: departments[a.PermitDept] ?? str('PermitDept'), status: statuses[a.PermitStatus] ?? str('PermitStatus'),
            valuation: typeof a.Valuation === 'number' ? a.Valuation : null,
            lat: d.spatialReference?.wkid === 4326 && typeof feature.geometry?.y === 'number' ? feature.geometry.y : null,
            lng: d.spatialReference?.wkid === 4326 && typeof feature.geometry?.x === 'number' ? feature.geometry.x : null,
            raw: feature };
    }) };
}
const site: PortalAdapter = {
    platform: 'Pikes Peak Regional Building Department (PPRBD)',
    capabilities: { search: ['address', 'permit', 'company', 'name'], listRecent: false, detail: false },
    async search(ctx, q) {
        const jurisdiction = jurisdictionFilter(ctx);
        const fields: Record<string, string> = { address: 'FullAddress1', permit: 'PermitNum', company: 'ContractorName', name: 'ContractorName' };
        if (!Object.hasOwn(fields, q.type)) throw new Error(`PPRBD does not support ${q.type} search`);
        if (!q.value.trim()) throw new Error('Search value required');
        const value = q.value.trim().toUpperCase().replace(/'/g, "''");
        const predicate = q.type === 'permit' ? `UPPER(PermitNum) = '${value}'` : `UPPER(${fields[q.type]}) LIKE '%${value}%'`;
        const where = `Jurisdiction = '${jurisdiction}' AND ${predicate}`;
        const out: PermitRecord[] = [];
        for (const department of Object.keys(departments)) {
            const seen = new Set<number>();
            let offset = 0, complete = false;
            for (let page = 0; page < 25; page++) {
                const url = new URL(`https://maps.pprbd.org/server/rest/services/Permits_Full_${department}_WM/MapServer/0/query`);
                url.search = new URLSearchParams({ f: 'json', where, outFields: '*', returnGeometry: 'true', outSR: '4326', resultOffset: String(offset), resultRecordCount: '2000', orderByFields: 'OBJECTID' }).toString();
                const parsed = parsePage(await politeJson(url.href, {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 0 }), ctx, jurisdiction);
                for (const row of parsed.records) {
                    const id = (row.raw!.attributes as Record<string, number>).OBJECTID;
                    if (seen.has(id)) throw new Error('PPRBD: repeated results page');
                    seen.add(id); out.push(row);
                }
                offset += parsed.records.length;
                if (!parsed.more) { complete = true; break; }
                if (!parsed.records.length) throw new Error('PPRBD: incomplete results page');
            }
            if (!complete) throw new Error('PPRBD: result limit exceeded; narrow search');
        }
        return out;
    },
    // Public GIS labels the field only "Permit Date". Preserve it in raw until
    // its issue/application meaning is verified; the linked detail page failed.
    async listRecent() { return []; }
};
export default site;
