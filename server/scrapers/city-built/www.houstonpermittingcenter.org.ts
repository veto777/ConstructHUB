import { load } from 'cheerio';
import type { AdapterCtx, PermitRecord, PortalAdapter } from '../types';
import { PublicSession, emptyRecord, assertPublicPage } from './http';
const origin = 'https://cohtora.houstontx.gov';
const entry = origin + '/approot/soldpermits/online_permit.htm';
const endpoint = origin + '/ibi_apps/WFServlet.ibfs';
/** Parse only primitive JavaScript string/number array literals. Never evaluate
 * the report's scripts. WebFOCUS stores the complete data separately from DOM paging. */
export function stringTable(text: string): (string | number)[] {
    const start = [...text.matchAll(/\bARstrings\s*=\s*\[/g)].at(-1);
    if (!start) throw new Error('Houston: missing report string table');
    let i = start.index + start[0].length;
    const out: (string | number)[] = [];
    const whitespace = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
    while (i < text.length) {
        whitespace();
        if (text[i] === ']') return out;
        const quote = text[i];
        if (quote === "'" || quote === '"') {
            i++;
            let value = '', closed = false;
            while (i < text.length) {
                const c = text[i++];
                if (c === quote) { closed = true; break; }
                if (c !== '\\') { value += c; continue; }
                const esc = text[i++];
                if (esc === 'u' || esc === 'x') {
                    const n = esc === 'u' ? 4 : 2, hex = text.slice(i, i + n);
                    if (!new RegExp(`^[a-f0-9]{${n}}$`, 'i').test(hex)) throw new Error('Houston: malformed string escape');
                    value += String.fromCharCode(parseInt(hex, 16)); i += n;
                } else {
                    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\', '/': '/' };
                    if (!Object.hasOwn(escapes, esc)) throw new Error('Houston: unsupported string escape');
                    value += escapes[esc];
                }
            }
            if (!closed) throw new Error('Houston: unterminated string');
            out.push(value);
        } else {
            const num = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(text.slice(i));
            if (!num) throw new Error('Houston: nonliteral report data');
            out.push(Number(num[0])); i += num[0].length;
        }
        whitespace();
        if (text[i] === ',') { i++; continue; }
        if (text[i] !== ']') throw new Error('Houston: nonliteral report data');
    }
    throw new Error('Houston: truncated report data');
}
export function parseResults(html: string, ctx: AdapterCtx): PermitRecord[] {
    assertPublicPage(html, endpoint);
    const $ = load(html);
    if (/under Maintenance/i.test($.text())) throw new Error('Houston: selected search is under maintenance');
    const metadata = $('meta[name="ibi-report"]').attr('content') ?? '';
    const expected = /records=(\d+)/.exec(metadata);
    // The server also produces a plain no-results report; require its explicit wording.
    if (!expected && /0 Record\(s\) found|No records found/i.test($.text())) return [];
    if (!expected) throw new Error('Houston: missing report metadata');
    if (Number(expected[1]) === 0) return [];
    const strings = stringTable(html);
    const match = /T_cont\[NumOfTable\]\s*=\s*(\[\[[\s\S]*?\]);/.exec(html);
    if (!match) throw new Error('Houston: missing complete row data');
    const data = JSON.parse(match[1]) as unknown[];
    if (!Array.isArray(data) || data.length !== Number(expected[1])) throw new Error('Houston: report cache contains only part of the result; narrow the search');
    const out: PermitRecord[] = [];
    const seen = new Map<string, PermitRecord>();
    for (const row of data) {
        if (!Array.isArray(row) || row.length < 7) throw new Error('Houston: invalid report row');
        const v = row.slice(0, 7).map(cell => {
            if (!Array.isArray(cell) || !Number.isInteger(cell[0]) || strings[cell[0]] === undefined) throw new Error('Houston: invalid report cell');
            return String(strings[cell[0]]).trim();
        });
        if (!/^\d+$/.test(v[0])) throw new Error('Houston: invalid project number');
        const key = JSON.stringify(v);
        if (seen.has(key)) { (seen.get(key)!.raw!.rows as unknown[]).push(row); continue; }
        const url = new URL(endpoint);
        url.search = new URLSearchParams({ IBIF_webapp: '/ibi_apps', IBIC_server: 'EDASERVE', IBIWF_msgviewer: 'OFF', IBIAPP_app: 'soldpermits', IBIF_ex: 'sold_permit_d', CLICKED_ON: '', PN: v[0], PT: v[6] }).toString();
        const record: PermitRecord = { ...emptyRecord(ctx, v[0]), address: v[3] || null, permitType: v[1] || null,
            workClass: v[6] || null, ownerName: v[2] || null, description: v[4] || null,
            valuation: v[5] && Number.isFinite(Number(v[5])) ? Number(v[5]) : null,
            sourceUrl: url.href, raw: { rows: [row], values: v, reportRecordCount: Number(expected[1]) } };
        // Source uses project numbers across several permit types. Preserve them;
        // do not synthesize a government identifier by appending the type code.
        seen.set(key, record); out.push(record);
    }
    return out;
}
export function buildRequest(type: string, value: string) {
    const types: Record<string, string> = { address: 'JA', permit: 'PN' };
    if (!Object.hasOwn(types, type)) throw new Error(`Houston does not support ${type} search`);
    if (!value.trim()) throw new Error('Search value required');
    return new URLSearchParams({ IBIAPP_app: 'soldpermits', IBIF_ex: 'online_per_se', IBIC_server: 'EDASERVE', VALMN: ' ', VALMX: ' ', SRH: value.trim(), SELTD: types[type], PTYPE: '11', ERRTITLE: ' ', IBIMR_sub_action: 'MR_USER_FEX' });
}
const site: PortalAdapter = {
    platform: 'Houston Permitting Center', capabilities: { search: ['address', 'permit'], listRecent: false, detail: false },
    async search(ctx, q) {
        const u = new URL(ctx.searchUrl);
        if (u.host !== 'www.houstonpermittingcenter.org' || !['/', '/sold-permits-search'].includes(u.pathname)) throw new Error('Not a Houston public permitting portal URL');
        const session = new PublicSession(ctx, origin);
        await session.request(entry);
        return parseResults(await session.request(endpoint, buildRequest(q.type, q.value)), ctx);
    },
    async listRecent() { return []; }
};
export default site;
