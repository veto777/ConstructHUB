import * as cheerio from 'cheerio';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function fetchGovernmentPage(url: string): Promise<any> {
  let last: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(18000) });
      const html = (await res.text()).slice(0, 2_000_000);
      last = { finalUrl: res.url, httpStatus: res.status, html, attempts: attempt };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (e: any) { last = { finalUrl: null, httpStatus: null, html: '', attempts: attempt, error: e.cause?.code || e.name }; }
    if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
  }
  return last;
}
export function classifyGovernmentPage(r: any, kind: string) {
  const final = r.finalUrl ? new URL(r.finalUrl) : null;
  const genericVendor = r.finalUrl && isGenericGovernmentVendorUrl(r.finalUrl);
  const $ = cheerio.load(r.html); $('script,style,noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const title = $('title').text().trim();
  const evidence = { title, excerpt: text.slice(0, 300) };
  if (genericVendor && r.httpStatus >= 200 && r.httpStatus < 400) return { status: 'dead', reason: 'generic vendor homepage', ...evidence };
  if ([404,410].includes(r.httpStatus)) return { status: 'dead', reason: `HTTP ${r.httpStatus}`, ...evidence };
  if (!r.httpStatus || r.httpStatus >= 400) return { status: 'unverified', reason: r.error || `HTTP ${r.httpStatus} (blocked/transient)`, ...evidence };
  if (/domain (is )?(for sale|parked)|buy this domain|sedo domain|website is for sale/i.test(text + title)) return { status: 'dead', reason: 'parked/for-sale domain', ...evidence };
  if (/^(404|page not found|not found|error|website unavailable)|page (you requested |was )?not found/i.test(title) || (text.length < 1800 && /page (you requested |was )?not found|404 -|site not found/i.test(text))) return { status: 'dead', reason: 'soft 404', ...evidence };
  if (/just a moment|access denied|verify you are human|attention required|request rejected/i.test(title + text.slice(0, 200))) return { status: 'unverified', reason: 'bot challenge', ...evidence };
  // Navigation often mentions permits/assessors on every page. It is not topic evidence.
  $('nav,header,footer,aside,[role="navigation"],.menu,.navigation').remove();
  const main = $('main,article,[role="main"],#main,#content').first();
  const content = (main.length ? main.text() : $('body').text()).replace(/\s+/g, ' ').trim();
  const topic = kind === 'appraiser' ? /assess(?:or|ing|ment)|apprais|property (search|records|assessment|valuation|lister|owner services)|parcel|real estate|tax (search|records)|revenue commission(?:er)?|myproperty|tax administration|board of taxation|commissioner of revenue|real property tax/i : /permits?|building inspection|development services|planning and building/i;
  if (!topic.test(content + title)) return { status: 'unverified', reason: 'no on-topic page content (manual/browser review required)', ...evidence };
  if (/^(www\.)?(civicplus.com|accela.com|tylertech.com|opengov.com|schneidergis.com)$/.test(new URL(r.finalUrl).hostname)) return { status: 'dead', reason: 'generic vendor homepage', ...evidence };
  if (final && /^\/(?:home\/?|default\.aspx)?$/i.test(final.pathname) && /^(home|welcome|official website)(\s*[|–—-]|$)/i.test(title) && !topic.test(title)) return { status: 'unverified', reason: 'generic homepage; department URL required', ...evidence };
  return { status: 'live', reason: 'GET succeeded with on-topic content; jurisdiction review still required', ...evidence };
}

export function isGenericGovernmentVendorUrl(url: string): boolean {
  const final = new URL(url);
  const trackingOnly = [...final.searchParams.keys()].every(k => /^(utm_|gclid$|fbclid$)/i.test(k));
  return final.pathname === '/' && trackingOnly && /^(www\.)?(parcelquest\.com|qpublic\.net|qpublic\.schneidercorp\.com|citizenserve\.com|mygov\.us|smartgovcommunity\.com|schneidercorp\.com|beacon\.schneidercorp\.com|gworks\.com|gis\.vgsi\.com|vgsi\.com|patriotproperties\.com|devnet\.com|civicplus\.com|accela\.com|tylertech\.com|opengov\.com)$/.test(final.hostname);
}
