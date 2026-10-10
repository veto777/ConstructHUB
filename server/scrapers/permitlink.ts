import * as cheerio from 'cheerio';
import { PortalBlockedError, rateLimitHost, USER_AGENT } from './polite-fetch';
import type { AdapterCtx, PermitRecord, PortalAdapter } from './types';

export function permitlinkUrl(input: string): string {
  const u = new URL(input);
  if (!['http:', 'https:'].includes(u.protocol) || !/^(?:www\.)?permitlink(?:online|usa-online|usaonline)\.com$/i.test(u.hostname) || u.port || u.username || u.password || !/^\/csp\/[a-z0-9_-]+\/DocumentLink\.[a-z]+\.cls$/i.test(u.pathname)) throw new Error('Not a supported PermitLink tenant portal');
  u.protocol = 'https:';
  u.pathname = u.pathname.replace(/[^/]+$/, 'DocumentLink.GuestPermitListCenter.cls');
  u.search = ''; u.hash = '';
  return u.href;
}
export function permitlinkDate(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
export function permitlinkFilters(type: string, value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('PermitLink search requires a nonempty value');
  if (type === 'permit') return { PermitID: trimmed };
  if (type !== 'address') throw new Error(`PermitLink does not support ${type} search`);
  const m = /^(\d+[a-z]?(?:-\d+)?)\s+(.+)$/i.exec(trimmed);
  return m ? { HouseNumber: m[1], Location: m[2] } : { Location: trimmed };
}

/** Preserve each complete HTML row, including its government-side document ID. */
export function parsePermitlinkTable(html: string, ctx: AdapterCtx): { records: PermitRecord[]; rowIds: string[] } {
  const $ = cheerio.load(html);
  const headers = $('th[id^="th_"]').map((_, e) => $(e).attr('id')!.replace(/^th_/, '').replace(/_\d+$/, '')).get();
  if (!headers.includes('PermitID') || !headers.includes('Location')) throw new Error('PermitLink public permit table missing or changed');
  const records: PermitRecord[] = [];
  const rowIds: string[] = [];
  $('tr[zenvalue]').each((_, e) => {
    const cells = $(e).children('td');
    if (cells.length < headers.length) throw new Error('Malformed PermitLink permit row');
    const values: Record<string, string> = {};
    headers.forEach((name, i) => { values[name] = cells.eq(i).text().replace(/\s+/g, ' ').trim(); });
    rowIds.push($(e).attr('zenvalue')!);
    // Draft is a placeholder shared by many documents, never a permit identifier.
    if (!values.PermitID || /^draft$/i.test(values.PermitID)) return;
    const text = (key: string) => values[key] || null;
    records.push({
      permitNumber: values.PermitID, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
      address: [values.HouseNumber, values.Location].filter(Boolean).join(' ') || null,
      parcel: text('ParcelID'), lat: null, lng: null, permitType: text('PermitType'), workClass: null,
      description: text('WorkDescription'), status: text('PermitListStatus') ?? text('FinalStatus'),
      issuedAt: permitlinkDate(values.Issued ?? ''), appliedAt: permitlinkDate(values.Applied ?? ''), expiresAt: null,
      valuation: null, contractorName: text('Contractor'), contractorLicense: null,
      applicantName: null, ownerName: text('Owner'), sourceUrl: null,
      raw: { html: $.html(e) },
    });
  });
  return { records, rowIds };
}

const adapter: PortalAdapter = {
  platform: 'PermitLink', aliases: ['PermitLink online permits'],
  capabilities: { search: ['address', 'permit'], listRecent: false, detail: false },
  async search(ctx, q) {
    const url = permitlinkUrl(ctx.searchUrl);
    const filters = permitlinkFilters(q.type, q.value);
    const browser = await ctx.browser();
    let failure: Error | null = null;
    try {
      // The supplied browser context already uses ConstructHUB's User-Agent.
      // Also retain the honest header on every routed request.
      // ZEN's broker serializes per-session state. Use its own public read-only UI,
      // with every request rate-limited, rather than replay opaque session tokens.
      await browser.route('**/*', async route => {
        const request = route.request();
        if (failure || new URL(request.url()).hostname !== new URL(url).hostname || ['image', 'font', 'stylesheet', 'media'].includes(request.resourceType())) return route.abort();
        await rateLimitHost(request.url(), Math.max(1000, ctx.politeness.minDelayMs));
        if (failure) return route.abort();
        await route.continue({ headers: { ...request.headers(), 'user-agent': USER_AGENT } });
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(60000);
      page.on('requestfailed', request => { if (['xhr', 'document', 'script'].includes(request.resourceType())) ctx.log(`Request failed: ${request.url()} ${request.failure()?.errorText}`); });
      page.on('response', response => {
        if (response.request().resourceType() === 'xhr') ctx.log(`Broker HTTP ${response.status()}`);
        if ([401, 403, 429, 503].includes(response.status())) failure = new PortalBlockedError(response.url(), response.status());
        else if (response.status() >= 400 && ['document', 'xhr'].includes(response.request().resourceType())) failure = new Error(`PermitLink HTTP ${response.status()}: ${response.url()}`);
      });
      page.on('dialog', async dialog => { failure = new Error(`PermitLink: ${dialog.message()}`); await dialog.dismiss(); });
      ctx.log(`Opening ${url}`);
      await page.goto(url, { waitUntil: 'load', timeout: 120000 });
      if (failure) throw failure;
      const body = await page.locator('body').innerText();
      if (/captcha|verify you are human|access denied|just a moment/i.test(body)) throw new PortalBlockedError(url, 403, 'PermitLink public page presented a challenge');
      await page.waitForFunction(() => {
        const table = (window as any).zenPage?.getComponentById('table');
        return table && table.progressBarTimerId == null && document.querySelector('th[id^="th_PermitID_"]');
      });
      const refresh = async (nextPage?: number) => {
        const previous = await page.evaluate(() => (window as any).zenPage.getComponentById('table').lastUpdate);
        await page.evaluate(({ filters, nextPage }) => {
          const table = (window as any).zenPage.getComponentById('table');
          if (nextPage) { table.gotoPage(nextPage); return; }
          for (const [name, value] of Object.entries(filters)) {
            const input = document.querySelector<HTMLInputElement>(`[id^="filter1_${name}_"]`);
            if (!input) throw new Error(`PermitLink has no public ${name} filter`);
            input.value = value;
            table.filterChanged(name, false);
          }
          table.executeQuery();
        }, { filters, nextPage });
        await page.waitForFunction(previous => {
          const table = (window as any).zenPage.getComponentById('table');
          return table.lastUpdate !== previous && table.progressBarTimerId == null;
        }, previous);
        if (failure) throw failure;
      };
      ctx.log('Applying public table filters');
      await refresh();
      const all: PermitRecord[] = [];
      const seen = new Set<string>();
      for (let number = 1; number <= 100; number++) {
        if (failure) throw failure;
        const state = await page.evaluate(() => {
          const table = (window as any).zenPage.getComponentById('table');
          return { total: String(table.rowCount), pages: table.getPageCount(), error: table.error };
        });
        if (state.error) throw new Error(`PermitLink table: ${state.error}`);
        if (!/^\d+$/.test(state.total) || !Number.isInteger(state.pages) || state.pages < 0) throw new Error('Invalid PermitLink pagination');
        const { records, rowIds } = parsePermitlinkTable(await page.content(), ctx);
        if (rowIds.some(id => seen.has(id))) throw new Error('PermitLink repeated a result page');
        rowIds.forEach(id => seen.add(id));
        all.push(...records);
        if (number >= state.pages) {
          if (seen.size !== Number(state.total)) throw new Error('PermitLink returned incomplete search results');
          return all;
        }
        if (!rowIds.length) throw new Error('PermitLink returned an empty intermediate page');
        await refresh(number + 1);
      }
      throw new Error('PermitLink search exceeds 100 pages; narrow the query');
    } catch (error) {
      throw failure ?? error;
    } finally { await browser.close(); }
  },
  async listRecent(ctx) { permitlinkUrl(ctx.searchUrl); return []; },
};
export default adapter;
