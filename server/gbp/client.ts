/** Google HTTP boundary. Injectable fetch/clock make tests entirely offline. */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const SERVICES = {
  accounts: ['mybusinessaccountmanagement.googleapis.com', 'My Business Account Management API'],
  information: ['mybusinessbusinessinformation.googleapis.com', 'My Business Business Information API'],
  reviews: ['mybusiness.googleapis.com', 'Google My Business API'],
  performance: ['businessprofileperformance.googleapis.com', 'Business Profile Performance API'],
} as const;
export type Service = keyof typeof SERVICES;
export class GoogleError extends Error {
  constructor(public kind: 'auth'|'permission'|'quota'|'disabled'|'transient'|'invalid', message: string, public status = 502) { super(message); }
}
export function classify(status: number, body: any, service: Service): GoogleError {
  const reasons = JSON.stringify(body?.error || body);
  if (/SERVICE_DISABLED|accessNotConfigured/.test(reasons)) return new GoogleError('disabled', `Enable ${SERVICES[service][1]} in Google Cloud`, 403);
  if (status === 401 || /invalid_grant/.test(reasons)) return new GoogleError('auth', 'Reconnect Google Business Profile', 401);
  if (status === 429 || /RESOURCE_EXHAUSTED|rateLimitExceeded/.test(reasons)) return new GoogleError('quota', 'Google quota reached. Try again later.', 429);
  if (status === 403) return new GoogleError('permission', 'Google denied permission. Check your Business Profile owner/manager access.', 403);
  if (status >= 500) return new GoogleError('transient', 'Google is temporarily unavailable. Try again.', 503);
  return new GoogleError('invalid', 'Google rejected the request. Check the selected business resource.', 400);
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// Smooth spacing avoids bursts: at most 299 requests in a rolling minute.
export class Limiter {
  private tail: Promise<void> = Promise.resolve();
  private last = -Infinity;
  constructor(private now = Date.now, private wait = sleep) {}
  take() {
    const run = this.tail.then(async () => {
      await this.wait(Math.max(0, this.last + 201 - this.now()));
      this.last = this.now();
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
const projectLimiter = new Limiter();
export class GoogleClient {
  constructor(private token: () => Promise<string>, private http: typeof fetch = fetch, private limiter = projectLimiter, private wait = sleep) {}
  async request(service: Service, path: string, method = 'GET', body?: unknown): Promise<any> {
    if (!/^\/(v1|v4)\//.test(path) || path.includes('..')) throw new Error('Invalid Google resource');
    for (let attempt = 0; ; attempt++) {
      const token = await this.token();
      await this.limiter.take();
      let response: Response;
      try {
        response = await this.http(`https://${SERVICES[service][0]}${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        if (e instanceof GoogleError) throw e;
        if (method === 'POST' || attempt >= 3) throw new GoogleError('transient', 'Google request timed out. Try again.', 503);
        await this.wait(1000 * 2 ** attempt); continue;
      }
      let data: any;
      try { data = response.status === 204 ? {} : await response.json(); }
      catch { if(response.ok) throw new GoogleError('transient','Google returned an unreadable response. Try again.',503); data={}; }
      if (response.ok) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new GoogleError('transient','Google returned an invalid response. Try again.',503);
        return data;
      }
      const error = classify(response.status, data, service);
      // Preserve actionable provider validation details without reflecting credentials.
      if (typeof data?.error?.message === 'string') {
        const detail = (token ? data.error.message.split(token).join('[redacted]') : data.error.message)
          .replace(/Bearer\s+\S+|ya29\.[\w.-]+/gi, '[redacted]')
          .replace(/(access_token|refresh_token|api_key|key|client_secret)=([^\s&]+)/gi, '$1=[redacted]')
          .slice(0, 500);
        error.message += ` Google: ${detail}`;
      }
      if (method === 'POST' || !['transient','quota'].includes(error.kind) || attempt >= 3) throw error;
      const retry = response.headers.get('retry-after');
      const retryMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry)*1000 : Date.parse(retry)-Date.now()) : 0;
      // Do not shorten a provider-requested long delay: hand it back to the scheduler.
      if (retryMs > 60000) throw error;
      await this.wait(Math.max(retryMs || 0, 1000 * 2 ** attempt + Math.random()*250));
    }
  }
  async pages(service: Service, path: string, field: string): Promise<any[]> {
    const items: any[] = []; const seen = new Set<string>(); let token = '';
    do {
      const data = await this.request(service, path + (path.includes('?') ? '&' : '?') + new URLSearchParams({ pageSize: service === 'accounts' ? '20' : service === 'reviews' ? '50' : '100', ...(token ? {pageToken: token} : {}) }));
      if (data[field] !== undefined && !Array.isArray(data[field])) throw new GoogleError('invalid', 'Invalid Google list response');
      if (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string') throw new GoogleError('invalid', 'Invalid Google pagination token');
      items.push(...(data[field] || [])); token = data.nextPageToken || '';
      if (token && seen.has(token)) throw new GoogleError('invalid', 'Google repeated a pagination token');
      seen.add(token);
    } while (token);
    return items;
  }
}
export function resource(value: unknown, type: 'accounts'|'locations'): string {
  if (typeof value !== 'string' || !new RegExp(`^${type}/[A-Za-z0-9_-]+$`).test(value)) throw new GoogleError('invalid', `Invalid ${type} resource`, 400);
  return value;
}
export function mapLocation(account: any, loc: any) {
  const addr = loc.storefrontAddress || {};
  return { accountResource: resource(account.name, 'accounts'), gbpName: resource(loc.name, 'locations'), accountName: account.accountName,
    businessName: loc.title, address: addr.addressLines?.join(', ') || null, city: addr.locality || null,
    state: addr.administrativeArea || null, zipCode: addr.postalCode || null, country: addr.regionCode || null,
    phone: loc.phoneNumbers?.primaryPhone || null, website: loc.websiteUri || null, placeId: loc.metadata?.placeId || null };
}
export const METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','WEBSITE_CLICKS','CALL_CLICKS','BUSINESS_DIRECTION_REQUESTS'];
export function performancePath(location: string, start: string, end: string) {
  const q = new URLSearchParams(); METRICS.forEach(m => q.append('dailyMetrics', m));
  for (const [key,date] of [['start_date',start],['end_date',end]]) {
    const [year,month,day] = date.split('-');
    for (const [part,value] of Object.entries({year,month,day})) q.set(`dailyRange.${key}.${part}`, String(Number(value)));
  }
  return `/v1/${resource(location,'locations')}:fetchMultiDailyMetricsTimeSeries?${q}`;
}
export function mapPerformance(data: any): {date: string; metric: string; value: number}[] {
  const rows = [];
  for (const group of data.multiDailyMetricTimeSeries || []) for (const series of group.dailyMetricTimeSeries || []) {
    if (!METRICS.includes(series.dailyMetric) || series.dailySubEntityType) continue;
    for (const point of series.timeSeries?.datedValues || []) {
      const d = point.date;
      // DatedValue omits value for zero (protobuf default); an absent date/series is unavailable.
      const value = Number(point.value ?? '0');
      const date = `${d?.year}-${String(d?.month).padStart(2,'0')}-${String(d?.day).padStart(2,'0')}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || !Number.isSafeInteger(value) || value < 0) throw new GoogleError('invalid','Invalid Google metric response');
      rows.push({date, metric: series.dailyMetric, value});
    }
  }
  return rows;
}

const DAYS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const clock = (t: any) => {
  const h = Number(t?.hours ?? 0), m = Number(t?.minutes ?? 0);
  return `${((h % 12) || 12)}:${String(m).padStart(2,'0')} ${h % 24 < 12 ? 'AM' : 'PM'}`;
};
/** Business Information location → ConstructHUB business_locations fields (Google is the source of truth). */
export function mapProfile(loc: any, attributes: any[] = []) {
  const cats = loc.categories || {};
  const allCats = [cats.primaryCategory, ...(cats.additionalCategories || [])].filter(Boolean);
  const serviceNames = new Map<string,string>();
  for (const c of allCats) for (const t of c.serviceTypes || []) if (t.serviceTypeId && t.displayName) serviceNames.set(t.serviceTypeId, t.displayName);
  const pretty = (id: string) => { const s = id.split(':').pop()!.replace(/_/g,' '); return s.charAt(0).toUpperCase() + s.slice(1); };
  const services = [...new Set((loc.serviceItems || []).map((i: any) =>
    i.freeFormServiceItem?.label?.displayName || (i.structuredServiceItem?.serviceTypeId ? serviceNames.get(i.structuredServiceItem.serviceTypeId) || pretty(i.structuredServiceItem.serviceTypeId) : null)
  ).filter(Boolean) as string[])];
  let hours: Record<string,string> | null = null;
  if (loc.regularHours?.periods?.length) {
    hours = {};
    for (const day of DAYS) {
      const ps = loc.regularHours.periods.filter((p: any) => p.openDay === day);
      hours[cap(day)] = !ps.length ? 'Closed' : ps.map((p: any) =>
        (!p.openTime?.hours && !p.openTime?.minutes && Number(p.closeTime?.hours) === 24) ? 'Open 24 hours' : `${clock(p.openTime)} – ${clock(p.closeTime)}`).join(', ');
    }
  }
  const a = loc.storefrontAddress || {};
  const od = loc.openInfo?.openingDate;
  const status: Record<string,string> = { OPEN: 'Open', CLOSED_TEMPORARILY: 'Temporarily closed', CLOSED_PERMANENTLY: 'Permanently closed' };
  const social: Record<string,string> = {};
  const socialKeys: Record<string,string> = { url_facebook:'facebook', url_instagram:'instagram', url_linkedin:'linkedin', url_pinterest:'pinterest', url_tiktok:'tiktok', url_twitter:'twitter', url_youtube:'youtube' };
  for (const at of attributes) {
    const key = socialKeys[String(at.name || '').split('/').pop()!];
    const uri = at.uriValues?.[0]?.uri;
    if (key && typeof uri === 'string' && /^https:\/\//.test(uri)) social[key] = uri;
  }
  return {
    businessName: loc.title || null,
    phone: loc.phoneNumbers?.primaryPhone || null,
    website: loc.websiteUri || null,
    address: a.addressLines?.join(', ') || null, city: a.locality || null, state: a.administrativeArea || null,
    zipCode: a.postalCode || null, country: a.regionCode || null,
    categories: allCats.map((c: any) => c.displayName).filter(Boolean),
    description: loc.profile?.description || null,
    serviceAreas: (loc.serviceArea?.places?.placeInfos || []).map((p: any) => p.placeName).filter(Boolean),
    services, hours,
    openingDate: od?.year ? [od.year, od.month, od.day].filter(Boolean).map((n: number, i: number) => i ? String(n).padStart(2,'0') : String(n)).join('-') : null,
    openStatus: status[loc.openInfo?.status] || null,
    placeId: loc.metadata?.placeId || null, googleCid: loc.metadata?.mapsUri || null,
    social,
  };
}
export const PROFILE_READ_MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,serviceArea,profile,openInfo,metadata,serviceItems';
