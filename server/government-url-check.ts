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
  if (governmentFailureIsDead(r.error || '')) return { status: 'dead', reason: r.error, ...evidence };
  if (!r.httpStatus || r.httpStatus >= 400) return { status: 'unverified', reason: r.error || `HTTP ${r.httpStatus} (blocked/transient)`, ...evidence };
  if (/domain (is )?(for sale|parked)|buy this domain|sedo domain|website is for sale/i.test(text + title)) return { status: 'dead', reason: 'parked/for-sale domain', ...evidence };
  if (/^(404|page not found|not found|error|website unavailable)|page (you requested |was )?not found/i.test(title) || (text.length < 1800 && /page (you requested |was )?not found|404 -|site not found/i.test(text))) return { status: 'dead', reason: 'soft 404', ...evidence };
  if (/just a moment|access denied|verify you are human|attention required|request rejected/i.test(title + text.slice(0, 200))) return { status: 'unverified', reason: 'bot challenge', ...evidence };
  // Navigation often mentions permits/assessors on every page. It is not topic evidence.
  $('nav,header,footer,aside,[role="navigation"],.menu,.navigation').remove();
  const main = $('main,article,[role="main"],#main,#content').first();
  const content = (main.length ? main.text() : $('body').text()).replace(/\s+/g, ' ').trim();
  const topic = kind === 'appraiser' ? /assess(?:or|ing|ment)|apprais|property (search|records|assessment|valuation|lister|owner services)|parcel|real estate|tax (search|records)|revenue commission(?:er)?|myproperty|tax administration|board of taxation|commissioner of revenue|real property tax/i : /permits?|building inspection|development services|planning and building/i;

  // A permit link that lands on another government service (tax/revenue, budget transparency, procurement, utility
  // billing, film/tourism, stormwater-only) is the wrong page, whatever the page says (2026-10-04 portal batch).
  if (kind !== 'appraiser' && final && /taxandrevenue|\/transparency|procurement\.|utility-?billing|paymentus|invoicecloud|\/tourism\/|film-office|stormwater/i.test(final.hostname + final.pathname + final.hash)) {
    return { status: 'dead', reason: 'not a building-permit service (tax, budget, procurement, utility, tourism or stormwater)', ...evidence };
  }
  if (!topic.test(content + title)) {
    if (final && final.pathname === '/' && /community news|county news|town news|upcoming events|welcome to (?:the )?(?:city|town|county)/i.test(content)) return { status: 'dead', reason: 'generic homepage; department URL required', ...evidence };
    return { status: 'unverified', reason: 'no on-topic page content (manual/browser review required)', ...evidence };
  }
  if (/^(www\.)?(civicplus.com|accela.com|tylertech.com|opengov.com|schneidergis.com)$/.test(new URL(r.finalUrl).hostname)) return { status: 'dead', reason: 'generic vendor homepage', ...evidence };
  if (final && !isDedicatedGovernmentPortal(final.href) && /^\/(?:home\/?|default\.aspx)?$/i.test(final.pathname) && /^(home|welcome|official website)(\s*[|–—-]|$)/i.test(title) && !topic.test(title)) return { status: 'dead', reason: 'generic homepage; department URL required', ...evidence };
  return { status: 'live', reason: 'GET succeeded with on-topic content; jurisdiction review still required', ...evidence };
}

export function isGenericGovernmentVendorUrl(url: string): boolean {
  const final = new URL(url);
  const trackingOnly = [...final.searchParams.keys()].every(k => /^(utm_|gclid$|fbclid$)/i.test(k));
  return final.pathname === '/' && trackingOnly && /^(www\.)?(publicaccessnow\.com|parcelquest\.com|qpublic\.net|qpublic\.schneidercorp\.com|citizenserve\.com|mygov\.us|smartgovcommunity\.com|schneidercorp\.com|beacon\.schneidercorp\.com|gworks\.com|gis\.vgsi\.com|vgsi\.com|patriotproperties\.com|devnet\.com|civicplus\.com|accela\.com|tylertech\.com|opengov\.com)$/.test(final.hostname);
}

/** Transport failures that make a browser link unusable, rather than just inconclusive. */
export function governmentFailureIsDead(reason: string): boolean {
  return /ENOTFOUND|EAI_NONAME|EAI_AGAIN|ENODATA|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|CERT_|CERTIFICATE|ERR_TLS|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN/i.test(reason);
}

/** A jurisdiction's self-service tenant is not the vendor's marketing homepage. */
export function isDedicatedGovernmentPortal(url: string): boolean {
  const host = new URL(url).hostname;
  // These dedicated office domains are present in the NETR source and rendered
  // department evidence archived by the a4 audit; this list never generates URLs.
  const assessmentHosts = ['dalecountyrevenue.com', 'leecountyrevenuecommissioner.com',
    'randolphcountyrevenue.com', 'tallapoosapropertytax.com', 'harrisoncountypva.com',
    'grantassessor.org', 'ptcoupeeassessor.com', 'websterassessor.org',
    'gasconadecountyassessor.com', 'mcintosh.northdakotaassessors.com',
    'corson.southdakotadirectors.com', 'polkcad.org', 'rrcad.org'];
  return assessmentHosts.includes(host.replace(/^www\./, '')) || /^[a-z0-9-]+\.publicaccessnow\.com$/.test(host) || /^[a-z0-9-]+\.portal\.opengov\.com$/.test(host) ||
    (/\.(gov|us)$/.test(host) && /^(permits?|permitslicenses|planningandpermitting|assessor|assessment|propertysearch)\./.test(host));
}
