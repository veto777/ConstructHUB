import * as cheerio from 'cheerio';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx, PermitRecord, PortalAdapter } from './types';

/** Shared by the four HTML adapters; no storage or application imports. */
export function assertPublicResponse(html: string, url: string): void {
  const $ = cheerio.load(html);
  $('script,style').remove();
  const text = $.text();
  if (/verify (you are|that you are) human|access denied|just a moment|captcha|request (has been )?blocked|incapsula incident/i.test(text)) {
    throw new PortalBlockedError(url, 403, `Public portal challenge at ${url}`);
  }
  if (/runtime error|server error in|an error (has )?occurred|error occurred|encountered an error|service unavailable/i.test(text)) throw new Error(`Portal error at ${url}`);
}

/** Isolated cookie session, manual redirects retain cookies and rate-limit each hop. */
export function portalSession(ctx: AdapterCtx) {
  const cookies = new Map<string, Map<string, string>>();
  return async function request(url: string, body?: URLSearchParams): Promise<{ html: string; url: string }> {
    let current = url;
    for (let hop = 0; hop < 8; hop++) {
      const host = new URL(current).host;
      const jar = cookies.get(host) ?? new Map<string, string>();
      const res = await politeFetch(current, {
        method: body ? 'POST' : 'GET', body,
        headers: { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ') }, redirect: 'manual',
      }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), timeoutMs: 30000 });
      for (const cookie of res.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0,i), pair.slice(i+1));
      }
      cookies.set(host, jar);
      if ([301,302,303,307,308].includes(res.status)) {
        const loc = res.headers.get('location'); if (!loc) throw new Error('Portal redirect without Location');
        const next = new URL(loc, current);
        if (!['http:','https:'].includes(next.protocol)) throw new Error('Invalid portal redirect');
        if (body && next.origin !== new URL(current).origin) throw new Error('Refusing cross-origin form redirect');
        current = next.href;
        if ([301,302,303].includes(res.status)) body = undefined;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} at ${current}`);
      const html = await res.text(); assertPublicResponse(html, current);
      return { html, url: current };
    }
    throw new Error('Portal redirect limit exceeded');
  };
}

export function formValues(html: string, selector = 'form'): URLSearchParams {
  const $ = cheerio.load(html); const data = new URLSearchParams();
  $(selector).first().find('input[name],select[name],textarea[name]').each((_i,e) => {
    const el = $(e); const type = el.attr('type')?.toLowerCase();
    if (el.is('[disabled]') || ['button','submit','image','reset','file'].includes(type ?? '') || (['checkbox','radio'].includes(type ?? '') && !el.is('[checked]'))) return;
    const value = el.val();
    for (const v of Array.isArray(value) ? value : [value ?? '']) data.append(el.attr('name')!, v);
  });
  return data;
}
export function isoDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  const raw = m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : value.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!raw || Number.isNaN(Date.parse(raw)) || new Date(raw).toISOString().slice(0,10) !== raw) return null;
  return raw;
}
export function usDate(iso: string): string {
  const date = isoDate(iso); if (!date) throw new Error('Expected an ISO date');
  return `${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(0,4)}`;
}
export function smartgovUrl(input: string): string {
  const u = new URL(input);
  if (!['https:','http:'].includes(u.protocol) || !u.hostname.endsWith('.smartgovcommunity.com')) throw new Error('Not a SmartGov community portal URL');
  return new URL('/ApplicationPublic/ApplicationSearch/Search', u).href;
}
export function parseSmartGovResults(html: string, ctx: AdapterCtx, url: string): PermitRecord[] {
  assertPublicResponse(html,url);
  const $ = cheerio.load(html); const records: PermitRecord[] = [];
  $('.search-result-item').each((_i,e) => {
    const row = $(e); const link = row.find('.search-result-title a');
    const permitNumber = link.text().trim(); if (!permitNumber) return;
    const cols = row.find('.col-lg-3');
    const type = cols.eq(0).children('div').eq(0).text().trim() || null;
    const state = cols.eq(0).children('div').eq(1).text().trim();
    const statusDate = state.match(/,\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*$/)?.[1];
    const status = state.replace(/,\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/, '').trim() || null;
    const address = cols.eq(1).children('div').map((_j,d) => $(d).text().trim()).get().filter(s => /[\w\d]/.test(s)).join(', ') || null;
    // The third column lists the people/companies on the permit (owner, contractor or both; the list does not say which).
    const listedNames = cols.eq(2).children('div').map((_j,d) => $(d).text().trim()).get().filter(s => /[a-z]/i.test(s));
    const action = link.attr('onclick')?.match(/['"](Detail\/[\w-]+)['"]/)?.[1];
    const form = $('form[action]').first().attr('action') ?? new URL(url).pathname.replace(/\/(Search|SearchPage)$/, '');
    records.push({ permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
      address, permitType: type, status, description: null,
      // The displayed date belongs to the current status, not necessarily issuance.
      issuedAt: status && /^(?:Step\s+\d+\s+of\s+\d+:\s*)?issued\b/i.test(status) ? isoDate(statusDate) : null,
      appliedAt: null, contractorName: null, applicantName: null,
      sourceUrl: action ? new URL(`${form}/${action}`,url).href : null,
      raw: { html: $.html(e), ...(listedNames.length ? { listedNames } : {}) },
    });
  });
  if (!records.length && !/No results found/i.test($('.alert-info').text())) throw new Error('Unrecognized SmartGov result page');
  return records;
}

export function parseSmartGovDetail(html: string, ctx: AdapterCtx, url: string): PermitRecord {
  assertPublicResponse(html,url);
  const $=cheerio.load(html);
  const header=$('[aria-label="Record number"]');
  const permitNumber=header.children('span').first().text().trim();
  if(!permitNumber)throw new Error('Unrecognized SmartGov permit detail');
  const fields:Record<string,string>={};
  $('.case-main-section-table-right tr').each((_i,e)=>{const cells=$(e).children('td');if(cells.length===2)fields[cells.eq(0).text().trim()]=cells.eq(1).text().trim()});
  const contacts:Record<string,string>={};
  $('.contacts-section-row').each((_i,e)=>{const row=$(e);const name=row.find('.contact-name').text().trim();const role=row.find('.contact-role').text().trim();if(name&&role)contacts[role]=name});
  const contact=(pattern:RegExp)=>Object.entries(contacts).find(([role])=>pattern.test(role))?.[1]??null;
  const address=$('.case-main-section-table-left tr').slice(1,3).map((_i,e)=>$(e).children('td').first().text().trim()).get().filter(Boolean).join(', ')||null;
  const badge=header.find('.case-header-status-badge').text().trim();
  return {permitNumber,databaseId:ctx.databaseId,jurisdiction:ctx.jurisdiction,address,
    parcel:$('.case-main-section-table-left a[aria-label^="parcel "]').first().text().trim()||null,
    permitType:$('.case-header-title').first().text().trim()||null,
    status:badge.replace(/:\s*\d{1,2}\/\d{1,2}\/\d{4}$/, '')||null,
    issuedAt:isoDate(fields.Issued),appliedAt:isoDate(fields.Submitted),expiresAt:isoDate(fields['Application Expires']),
    contractorName:contact(/^(primary |general )?contractor$/i),applicantName:contact(/^(applicant|submitter of the application)$/i),ownerName:contact(/^owner( of record)?$/i),
    sourceUrl:url,raw:{html},
  };
}

export function smartgovSearchBody(html: string, fields: Record<string,string>): URLSearchParams {
  const body = formValues(html);
  for (const [key,value] of Object.entries(fields)) body.set(key,value);
  // Same timestamp validator generated by public FormSupport.requestVerificationString().
  body.set('__submitFormValidator__', `abcd${Date.now()}z`);
  return body;
}
async function run(ctx: AdapterCtx, fields: Record<string,string>, advanced: boolean): Promise<PermitRecord[]> {
  const base = smartgovUrl(ctx.searchUrl); const request = portalSession(ctx);
  let page = await request(advanced ? base.replace(/Search$/, 'AdvancedSearch') : base);
  const $ = cheerio.load(page.html);
  const action = $('form[action]').first().attr('action');
  if (!action || !action.includes('ApplicationSearch')) throw new Error('SmartGov public search form unavailable');
  for (const field of Object.keys(fields)) if (!$(`[name="${field}"]`).length) throw new Error(`SmartGov search field unavailable: ${field}`);
  const endpoint = new URL(`${action}/Search`,base).href;
  const body = smartgovSearchBody(page.html,fields);
  page = await request(endpoint,body);
  const totalText=cheerio.load(page.html)('#search-results .muted').first().text();
  const expected=Number(totalText.match(/([\d,]+)\s+results/i)?.[1]?.replace(/,/g,'')??0);
  const out: PermitRecord[] = []; const seen = new Set<string>();
  for (let index = 0; index < 1000; index++) {
    const records = parseSmartGovResults(page.html,ctx,endpoint);
    if (index && !records.some(r => !seen.has(r.permitNumber))) throw new Error('SmartGov pagination repeated a page');
    for (const r of records) if (!seen.has(r.permitNumber)) {seen.add(r.permitNumber);out.push(r);}
    const dom = cheerio.load(page.html);
    const pages = dom('[onclick*="gotoPage"]').map((_i,e) => Number(dom(e).attr('onclick')?.match(/gotoPage\(\s*(\d+)/)?.[1])).get();
    if (!pages.some(n => n > index)) {
      if(expected && out.length<expected)throw new Error('SmartGov pagination ended before the reported result count');
      return out;
    }
    const next = new URLSearchParams(body); next.set('_applicationSearchPage',String(index+1));
    page = await request(new URL(`${action}/SearchPage`,base).href,next);
  }
  throw new Error('SmartGov pagination exceeded 1000 pages; results are incomplete');
}

const adapter: PortalAdapter = {
  platform: 'SmartGov',
  aliases: ["SmartGov (Granicus)", "SmartGov (Planning & Development portal)", "SmartGov (via city redirect)", "SmartGov Citizen Portal", "SmartGov Community Portal", "SmartGov Community portal", "SmartGov Online Permit Center", "SmartGov Online Permit Portal", "SmartGov Online Permitting", "SmartGov Online Permitting and Inspection Portal", "SmartGov Online Portal", "SmartGov Permit & Development Portal", "SmartGov Permit Center", "SmartGov Permit Management & Tracking", "SmartGov Permit Portal", "SmartGov Permitting & Licensing Portal", "SmartGov Public Permit Portal", "SmartGov Public Portal", "SmartGov Public Portal (Granicus)", "SmartGov Public Portal (via county permitting link)", "SmartGov building permits online", "SmartGov citizen portal", "SmartGov community portal", "SmartGov customer portal", "SmartGov electronic permit/application system", "SmartGov permit portal", "SmartGov portal", "SmartGov public portal"],
  capabilities: { search: ['address','permit','name','company'], listRecent: true, detail: true },
  async search(ctx,q) {
    if (!q.value?.trim()) throw new Error('Search value is required');
    const fields: Record<string,string> = { address: 'SiteAddress.Street1', permit:'CaseNumber', name:'PrimaryContact.Contact.DisplayName', company:'PrimaryContractor.Contact.DisplayName' };
    if (!fields[q.type]) throw new Error(`Unsupported SmartGov search: ${q.type}`);
    return run(ctx,{Module:'Permitting',[fields[q.type]]:q.value},true);
  },
  async detail(ctx,permitNumber) {
    const rows=await run(ctx,{Module:'Permitting',CaseNumber:permitNumber},true);
    const match=rows.find(r=>r.permitNumber.toLowerCase()===permitNumber.toLowerCase());
    if(!match)return null;
    if(!match.sourceUrl)throw new Error('SmartGov detail link unavailable');
    const page=await portalSession(ctx)(match.sourceUrl);
    const detail=parseSmartGovDetail(page.html,ctx,page.url);
    if(detail.permitNumber.toLowerCase()!==permitNumber.toLowerCase())throw new Error('SmartGov detail did not match requested permit');
    return detail;
  },
  async listRecent(ctx,since) { return run(ctx,{Module:'Permitting',IssuedOn:`${usDate(since)} To ${usDate(new Date().toISOString())}`},true); },
};
export default adapter;
