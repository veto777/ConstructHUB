import { load } from 'cheerio';
import { politeFetch, PortalBlockedError } from '../polite-fetch';
import type { AdapterCtx, PermitRecord } from '../types';
/** Session cookies are scoped to this one origin and never persisted. */
export class PublicSession {
    private cookies = new Map<string, string>();
    constructor(private ctx: AdapterCtx, private origin = new URL(ctx.searchUrl).origin, private validate = assertPublicPage) {
    }
    async request(url: string, fields?: URLSearchParams): Promise<string> {
        if (new URL(url).origin !== this.origin)
            throw new Error(`Unexpected portal origin: ${url}`);
        const headers: Record<string, string> = {};
        if (this.cookies.size)
            headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        if (fields)
            headers['content-type'] = 'application/x-www-form-urlencoded';
        const res = await politeFetch(url, {
            method: fields ? 'POST' : 'GET', headers, body: fields?.toString()
        }, {
            minDelayMs: Math.max(1000, this.ctx.politeness.minDelayMs), retries: 0
        });
        for (const c of res.headers.getSetCookie()) {
            const pair = c.split(';')[0];
            const p = pair.indexOf('=');
            this.cookies.set(pair.slice(0, p), pair.slice(p + 1));
        }
        if (!res.ok)
            throw new Error(`Portal HTTP ${res.status}: ${url}`);
        const html = await res.text();
        this.validate(html, url);
        return html;
    }
}
export function assertPublicPage(html: string, url: string) {
    if (/g-recaptcha|h-captcha|captcha challenge|verify you are human|access denied|cf-chl-|challenge-platform/i.test(html))
        throw new PortalBlockedError(url, 403, 'Portal requires CAPTCHA or returned an access challenge');
    if (/<title>\s*(?:Error|Server Error)|Server Error in .* Application|Runtime Error/i.test(html))
        throw new Error(`Portal error page: ${url}`);
}
export function formFields(html: string): URLSearchParams {
    const $ = load(html);
    const fields = new URLSearchParams();
    $('form input[name],form select[name],form textarea[name]').each((_, el) => {
        const e = $(el);
        const type = (e.attr('type') ?? '').toLowerCase();
        if (e.attr('disabled') !== undefined || ['submit', 'button', 'image', 'file', 'password'].includes(type) || (['checkbox', 'radio'].includes(type) && e.attr('checked') === undefined))
            return;
        const value = e.is('select') ? e.find('option[selected]').first().attr('value') ?? e.find('option').first().attr('value') ?? '' : e.attr('value') ?? '';
        fields.append(e.attr('name')!, value);
    });
    return fields;
}
export function splitAddress(value: string) {
    const m = value.trim().match(/^(\d+[A-Za-z-]*)\s+(.+)$/);
    return {
        number: m?.[1] ?? '', street: m?.[2] ?? value.trim()
    };
}
export function isoDate(value: string | undefined | null): string | null {
    if (!value?.trim())
        return null;
    const s = value.trim();
    let y, m, d;
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
    if (us) {
        [, m, d, y] = us;
    }
    else if (iso) {
        [, y, m, d] = iso;
    }
    else {
        const english = s.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        if (!english || !months.includes(english[1].slice(0, 3).toLowerCase()))
            return null;
        y = english[3];
        m = String(months.indexOf(english[1].slice(0, 3).toLowerCase()) + 1);
        d = english[2];
    }
    const out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const dt = new Date(out);
    return Number.isNaN(dt.valueOf()) || dt.toISOString().slice(0, 10) !== out ? null : out;
}
export function emptyRecord(ctx: AdapterCtx, permitNumber: string): PermitRecord {
    return {
        permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId, address: null, parcel: null, lat: null, lng: null, permitType: null, workClass: null, description: null, status: null, issuedAt: null, appliedAt: null, expiresAt: null, valuation: null, contractorName: null, contractorLicense: null, applicantName: null, ownerName: null, sourceUrl: null, raw: null
    };
}
