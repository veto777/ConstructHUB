import { describe, it, expect, vi, beforeEach } from 'vitest';
// Disconnect must never reach the purge for a Google account that is not connected.
vi.mock('./grants', async (importOriginal) => ({ ...(await importOriginal<typeof import('./grants')>()), purgeGoogleData: vi.fn(async () => {}) }));
import { registerGbpRoutes } from './routes';
import { purgeGoogleData } from './grants';

// A user id no fixture uses: the disconnect DELETE matches nothing and nothing else is written.
const USER = -40404;
function harness() {
  const handlers = new Map<string, any>();
  const app: any = { use: vi.fn() };
  for (const method of ['get', 'post', 'patch', 'delete']) app[method] = (path: string, fn: any) => handlers.set(`${method} ${path}`, fn);
  registerGbpRoutes(app, (req: any) => req.user, { afterConnect: async () => {} });
  return handlers;
}
const response = () => { const res: any = { redirect: vi.fn(), json: vi.fn() }; res.status = vi.fn(() => res); return res; };
const request = (over: any = {}) => {
  const headers = { host: '127.0.0.1:8203', ...(over.headers || {}) };
  return { user: { id: USER }, session: {}, query: {}, body: {}, protocol: 'http', ...over, headers,
    get: (name: string) => (headers as any)[name.toLowerCase()],
    // express req.accepts: '*/*' (fetch/XHR default) prefers the first listed type; a page load prefers html.
    accepts: (types: string[]) => (String((headers as any).accept || '*/*').includes('text/html') ? 'html' : types[0]) };
};

describe('GET /api/gbp/connect without a recent identity check', () => {
  beforeEach(() => vi.clearAllMocks());
  it('sends a page navigation to Locations to verify instead of a bare JSON 403', async () => {
    const connect = harness().get('get /api/gbp/connect');
    for (const headers of [{ 'sec-fetch-mode': 'navigate' }, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }]) {
      const res = response();
      await connect(request({ headers }), res);
      expect(res.redirect).toHaveBeenCalledWith('/locations?gbp=reauth');
      expect(res.status).not.toHaveBeenCalled();
    }
  });
  it('keeps the JSON reauth challenge for the in-page preflight and for fetch/XHR', async () => {
    const connect = harness().get('get /api/gbp/connect');
    for (const req of [request({ query: { format: 'json' }, headers: { 'sec-fetch-mode': 'navigate' } }), request()]) {
      const res = response();
      await connect(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reauth: true }));
      expect(res.redirect).not.toHaveBeenCalled();
    }
  });
  it('still goes straight to Google consent once identity was verified', async () => {
    const connect = harness().get('get /api/gbp/connect');
    const res = response();
    const req = request({ headers: { 'sec-fetch-mode': 'navigate' }, session: { recentAuth: { userId: USER, at: Date.now() } } });
    await connect(req, res);
    expect(String(res.redirect.mock.calls[0]?.[0])).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(req.session.gbpOAuth?.userId).toBe(USER);
  });
});

describe('POST /api/gbp/disconnect', () => {
  it('answers 404 for a Google account that is not connected and purges nothing', async () => {
    const disconnect = harness().get('post /api/gbp/disconnect');
    const res = response();
    await disconnect(request({ body: { subject: 'FIX-c04-not-a-connected-subject' }, session: { recentAuth: { userId: USER, at: Date.now() } } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'That Google account is not connected' });
    expect(purgeGoogleData).not.toHaveBeenCalled();
  });
});
