import { z } from 'zod';
import { pool } from '../db';
import { encryptToken, decryptToken } from '../gbp/token-crypto';
export const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
export const customerId = z.string().trim().regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/).transform(s => s.replaceAll('-', ''));
export class AdsError extends Error {
  constructor(message: string, public status = 400, public uncertain = false) { super(message); }
}
export const configured = () => !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_PROJECT_ACCESS_ENABLED === 'true'));
export const redirectUri = () => process.env.GOOGLE_ADS_REDIRECT_URI || `${(process.env.APP_URL || 'https://constructhub.us').replace(/\/$/, '')}/api/ads/callback`;
export interface AdsApi {
  search(cid: string, query: string, pageToken?: string): Promise<{results: any[]; nextPageToken?: string}>;
  mutate(cid: string, operations: any[], validateOnly?: boolean): Promise<any>;
  link(manager: string, operation: any, validateOnly?: boolean): Promise<any>;
}
export async function takeAdsQuota() {
  // Database-shared smooth 240 QPM, including validation calls; independent of GBP's budget.
  for (;;) {
    const r = await pool.query(`UPDATE ads_request_budget SET next_at=clock_timestamp()+interval '250 milliseconds' WHERE id=1 AND next_at<=clock_timestamp() RETURNING id`);
    if (r.rowCount) return;
    await new Promise(r => setTimeout(r, 250));
  }
}
export class AdsClient implements AdsApi {
  constructor(private manager: string, private token: () => Promise<string>, private http: typeof fetch = fetch,
    private quota: () => Promise<void> = takeAdsQuota, private version = process.env.GOOGLE_ADS_API_VERSION || 'v25') {
    customerId.parse(manager);
    if (!/^v\d+$/.test(version)) throw new AdsError('Invalid Google Ads API version');
  }
  private async request(cid: string, endpoint: string, body: unknown, write: boolean): Promise<any> {
    customerId.parse(cid);
    const token = await this.token();
    await this.quota();
    let r: Response;
    try {
      r = await this.http(`https://googleads.googleapis.com/${this.version}/customers/${cid}/${endpoint}`, {
        method: 'POST', redirect:'error', headers: {Authorization: `Bearer ${token}`, ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? {'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN} : {}),
          'login-customer-id': this.manager, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
    } catch { throw new AdsError(write ? 'Google write outcome unknown. Reconcile in Google before retrying.' : 'Google temporarily unavailable.', 503, write); }
    if (!r.ok) throw new AdsError(r.status === 401 ? 'Reconnect Google Ads.' : r.status === 403 ? 'Google denied access. Check MCC permissions and Google Cloud project Ads API approval.' : r.status === 429 ? 'Google quota reached; queued reads retry later.' : 'Google rejected the request. Review account permissions, API version and supported campaign settings.', r.status === 429 ? 429 : r.status >= 500 ? 503 : r.status, write && r.status >= 500);
    let data: any;
    try { data = await r.json(); } catch { throw new AdsError('Google returned an unreadable response.', 502, write); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.partialFailureError) throw new AdsError('Google returned an invalid response.', 502, write);
    return data;
  }
  async search(cid: string, query: string, pageToken?: string) {
    const d = await this.request(cid, 'googleAds:search', {query, ...(pageToken ? {pageToken} : {})}, false);
    if ((d.results !== undefined && !Array.isArray(d.results)) || (d.nextPageToken !== undefined && typeof d.nextPageToken !== 'string')) throw new AdsError('Invalid Google search response', 502);
    return {results: d.results || [], nextPageToken: d.nextPageToken};
  }
  mutate(cid: string, operations: any[], validateOnly = false) {
    return this.request(cid, 'googleAds:mutate', {mutateOperations: operations, partialFailure: false, validateOnly}, !validateOnly);
  }
  link(manager: string, operation: any, validateOnly = false) {
    // CustomerClientLinkService takes a singular operation and returns result, not results[].
    return this.request(manager, 'customerClientLinks:mutate', {operation, validateOnly}, !validateOnly);
  }
}
export async function oauthTokens(body: Record<string,string>, http: typeof fetch = fetch) {
  const r = await http('https://oauth2.googleapis.com/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: process.env.GOOGLE_ADS_CLIENT_ID!, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!, ...body}), signal: AbortSignal.timeout(20000)});
  const t = await r.json();
  if (!r.ok || typeof t.access_token !== 'string' || (t.scope && !String(t.scope).split(' ').includes(ADS_SCOPE))) throw new AdsError('Google authorization failed. Reconnect and allow Google Ads access.', 401);
  return t;
}
export async function clientFor(userId: number, http: typeof fetch = fetch): Promise<AdsClient> {
  if(!configured()) throw new AdsError('Owner setup required: Google Ads project access and OAuth credentials.',503);
  const {rows:[g]} = await pool.query('SELECT * FROM ads_grants WHERE user_id=$1', [userId]);
  if (!g || g.reconnect_required) throw new AdsError('Connect the agency MCC first.', 409);
  return new AdsClient(g.manager_id, async () => {
    if (g.access_token && new Date(g.expires_at).getTime() > Date.now()+60000) return decryptToken(g.access_token)!;
    let t: any;
    try { t = await oauthTokens({grant_type:'refresh_token', refresh_token:decryptToken(g.refresh_token)!}, http); }
    catch (e) {
      if(e instanceof AdsError && e.status === 401) await pool.query('UPDATE ads_grants SET reconnect_required=true,access_token=NULL WHERE user_id=$1 AND connection_id=$2',[userId,g.connection_id]);
      throw e;
    }
    const r = await pool.query('UPDATE ads_grants SET access_token=$3,expires_at=$4,refresh_token=COALESCE($5,refresh_token) WHERE user_id=$1 AND connection_id=$2 RETURNING user_id',
      [userId,g.connection_id,encryptToken(t.access_token),new Date(Date.now()+Number(t.expires_in||3600)*1000),encryptToken(t.refresh_token)]);
    if(!r.rowCount) throw new AdsError('Connection changed.',409);
    g.access_token=encryptToken(t.access_token); g.expires_at=new Date(Date.now()+Number(t.expires_in||3600)*1000);
    return t.access_token;
  }, http);
}
/** Worker-only bounded pagination. Oversized snapshots fail closed, never silently truncate. */
export async function searchAll(api: AdsApi, cid: string, query: string) {
  const rows: any[] = [], seen = new Set<string>(); let page: string|undefined;
  do {
    const r = await api.search(cid, query, page); rows.push(...r.results); page = r.nextPageToken;
    if (rows.length > 50000 || seen.size>=100 || (page && seen.has(page))) throw new AdsError('Google result exceeds snapshot limits or repeated a page. Narrow the account scope.',422);
    if(page) seen.add(page);
  } while(page);
  return rows;
}
