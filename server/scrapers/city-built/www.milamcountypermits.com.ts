import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { politeJson } from '../polite-fetch';
import { emptyRecord } from './http';
export const regionalHosts = ['www.milamcountypermits.com', 'www.hayscountypermits.com', 'www.kaufmancountypermits.com', 'www.wilcopermits.com'];
const columns = ['propertyType', 'name', 'address', 'permitNumber', 'permitType', 'status', 'statusDate'];
export function buildRequest(value: string, start = 0) {
    const p = new URLSearchParams({
        draw: '1', start: String(start), length: '30', 'search[value]': value, 'search[regex]': 'false', 'order[0][column]': '6', 'order[0][dir]': 'desc'
    });
    columns.forEach((c, i) => {
        p.set(`columns[${i}][data]`, c);
        p.set(`columns[${i}][name]`, c);
        p.set(`columns[${i}][searchable]`, 'true');
        p.set(`columns[${i}][orderable]`, ['permitNumber', 'statusDate'].includes(c) ? 'true' : 'false');
        p.set(`columns[${i}][search][value]`, '');
        p.set(`columns[${i}][search][regex]`, 'false');
    });
    return p;
}
export function parsePage(data: unknown, ctx: AdapterCtx): {
    records: PermitRecord[];
    count: number;
} {
    const d = data as any;
    if (!d || !Array.isArray(d.data) || !Number.isInteger(d.recordsFiltered) || d.recordsFiltered < 0 || d.error)
        throw new Error('FireInspection360: invalid public search response');
    return {
        count: d.recordsFiltered, records: d.data.map((row: any) => {
            if (typeof row.permitNumber !== 'string' || !row.permitNumber || typeof row.id !== 'string')
                throw new Error('FireInspection360: invalid permit row');
            const str = (k: string) => typeof row[k] === 'string' ? row[k] || null : null;
            return {
                ...emptyRecord(ctx, row.permitNumber), address: str('address'), description: str('name'), permitType: str('permitType'), status: str('status'), sourceUrl: new URL('/public/permits/details/' + encodeURIComponent(row.id), ctx.searchUrl).href, raw: row
            };
        })
    };
}
const site: PortalAdapter = {
    platform: 'FireInspection360', capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: false
    }, async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (!regionalHosts.includes(u.host) || !['/', '/public', '/public/permits/list'].includes(u.pathname))
            throw new Error('Not a supported FireInspection360 public portal URL');
        if (!['address', 'permit'].includes(q.type))
            throw new Error(`FireInspection360 does not support ${q.type} search`);
        const value = q.value.trim();
        if (!value)
            throw new Error('Search value required');
        const out: PermitRecord[] = [];
        const seen = new Set<string>();
        let expected: number | undefined;
        for (let page = 0; page < 100; page++) {
            const result = await politeJson(new URL('/api/v1/permits/datatables/list/public', u).href, {
                method: 'POST', body: buildRequest(value, out.length)
            }, {
                minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 0
            });
            const parsed = parsePage(result, ctx);
            if (expected !== undefined && parsed.count !== expected)
                throw new Error('FireInspection360 result set changed during pagination; retry search');
            expected = parsed.count;
            for (const row of parsed.records) {
                const id = row.raw!.id as string;
                if (seen.has(id)) throw new Error('FireInspection360 repeated page; retry search');
                seen.add(id);
                out.push(row);
            }
            if (out.length === expected) {
                const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                return out.filter(r => normalized(q.type === 'permit' ? r.permitNumber : r.address ?? '').includes(normalized(value)));
            }
            if (!parsed.records.length || out.length > expected)
                throw new Error('FireInspection360 incomplete pagination');
        }
        throw new Error('FireInspection360 result limit exceeded; narrow the search');
    }, async listRecent() {
        return [];
    }
};
export default site;
