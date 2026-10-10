import { describe, it, expect, vi } from "vitest";
import express from "express";
import { adsVerdict, doorHtml, registerAdsLanding, ADS_LANDINGS, DEFAULT_ADS_LP_KEYS, type AdsRequestFacts } from "./ads-landing";
import { googleTagSnippet, googleTagIds, withGoogleTag } from "./google-tag";
import { MARKETING_ROUTES } from "@shared/seo";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const visitor = (over: Partial<AdsRequestFacts> = {}): AdsRequestFacts => ({
  userAgent: CHROME, ip: "73.12.44.9", country: "US", asn: 7922, clickId: "Cj0KCQjw_abcdefghijklmnop", key: "ch_crm_2026",
  googleVerified: false, allowedIp: false, rangeHit: null, intel: null, banned: false, ...over,
});

describe("ad landing doors", () => {
  it("each door serves a real, prerendered marketing page", () => {
    expect(ADS_LANDINGS).toEqual({ "/googleads-features": "/features", "/googleads-crm": "/features/crm", "/googleads-pricing": "/pricing" });
    for (const target of Object.values(ADS_LANDINGS)) expect(MARKETING_ROUTES).toContain(target);
  });

  it("serves a US visitor who clicked an ad with the campaign key", () => {
    expect(adsVerdict(visitor())).toEqual({ action: "serve", reason: "visitor" });
    expect(adsVerdict(visitor({ key: "ch_feat_2026" }))).toEqual({ action: "serve", reason: "visitor" });
    // No Cloudflare geo or ASN header (a direct hit on the origin) is not held against a visitor.
    expect(adsVerdict(visitor({ country: null, asn: null }))).toEqual({ action: "serve", reason: "visitor" });
  });

  it("sends anyone without a Google click id or the key to the public page", () => {
    expect(adsVerdict(visitor({ clickId: null }))).toEqual({ action: "redirect", reason: "no_click_id" });
    expect(adsVerdict(visitor({ clickId: "short" }))).toEqual({ action: "redirect", reason: "no_click_id" });
    expect(adsVerdict(visitor({ key: null }))).toEqual({ action: "redirect", reason: "bad_key" });
    expect(adsVerdict(visitor({ key: "guess" }))).toEqual({ action: "redirect", reason: "bad_key" });
    expect(adsVerdict(visitor({ key: "summer" }), ["summer"])).toEqual({ action: "serve", reason: "visitor" });
  });

  it("blocks bots, and a Google user agent only passes when the IP is Google's", () => {
    expect(adsVerdict(visitor({ userAgent: "" }))).toEqual({ action: "block", reason: "no_user_agent" });
    for (const ua of ["python-requests/2.31", "curl/8.4.0", "Mozilla/5.0 HeadlessChrome/120", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "SomeClient/1.0"]) {
      expect(adsVerdict(visitor({ userAgent: ua })), ua).toEqual({ action: "block", reason: "bot_user_agent" });
    }
    const adsbot = "AdsBot-Google (+http://www.google.com/adsbot.html)";
    expect(adsVerdict(visitor({ userAgent: adsbot, clickId: null, key: null }))).toEqual({ action: "block", reason: "fake_google" });
    expect(adsVerdict(visitor({ userAgent: adsbot, clickId: null, key: null, googleVerified: true }))).toEqual({ action: "serve", reason: "google_verified" });
  });

  it("keeps non-US visitors and hosting networks out; only the hosting IP is excluded from Ads", () => {
    expect(adsVerdict(visitor({ country: "IN" }))).toEqual({ action: "redirect", reason: "non_us" });
    expect(adsVerdict(visitor({ asn: 16509 }))).toEqual({ action: "redirect", reason: "proxy_network", exclude: true });
  });

  it("always serves the owner's own IPs", () => {
    expect(adsVerdict(visitor({ allowedIp: true, clickId: null, key: null, userAgent: "" }))).toEqual({ action: "serve", reason: "owner" });
  });

  it.each(['datacenter', 'vpn'] as const)("excludes %s ranges without an ASN header", rangeHit => {
    expect(adsVerdict(visitor({ asn: null, rangeHit }))).toEqual({ action: "redirect", reason: "proxy_network", exclude: true });
  });
  it.each(['proxy', 'vpn', 'tor', 'hosting'] as const)("excludes online %s intelligence", flag => {
    expect(adsVerdict(visitor({ asn: null, intel: { proxy: false, vpn: false, tor: false, hosting: false, [flag]: true } })))
      .toEqual({ action: "redirect", reason: "proxy_network", exclude: true });
  });
  it("uses an online ASN, allows negative intelligence, and preserves owner/Google precedence", () => {
    const clean = { proxy: false, vpn: false, tor: false, hosting: false };
    expect(adsVerdict(visitor({ intel: clean }))).toEqual({ action: 'serve', reason: 'visitor' });
    expect(adsVerdict(visitor({ intel: { ...clean, asn: 16509 } }))).toEqual({ action: 'redirect', reason: 'proxy_network', exclude: true });
    const bad = { banned: true, rangeHit: 'vpn' as const, intel: { ...clean, tor: true } };
    expect(adsVerdict(visitor({ ...bad, allowedIp: true }))).toEqual({ action: 'serve', reason: 'owner' });
    expect(adsVerdict(visitor({ ...bad, userAgent: 'Googlebot', googleVerified: true }))).toEqual({ action: 'serve', reason: 'google_verified' });
  });
  it("rejects a previously banned IP before click-id and key checks", () => {
    expect(adsVerdict(visitor({ banned: true, clickId: null, key: null }))).toEqual({ action: 'redirect', reason: 'landing_ban', exclude: true });
  });

  it("a door is never indexed", () => {
    const html = doorHtml("<html><head><title>CRM</title></head><body></body></html>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(doorHtml(html)).toBe(html);
  });

  it("ships three default keys, one per door", () => {
    expect(DEFAULT_ADS_LP_KEYS).toEqual(["ch_feat_2026", "ch_crm_2026", "ch_price_2026"]);
  });
});

describe("google tag", () => {
  const PAGE = "<html><head><title>x</title></head><body></body></html>";
  it("adds nothing until an id is configured, and ignores a malformed one", () => {
    expect(googleTagSnippet({})).toBe("");
    expect(withGoogleTag(PAGE, {})).toBe(PAGE);
    expect(googleTagIds({ GOOGLE_TAG_IDS: "nonsense, <script>, AW-12" })).toEqual([]);
  });

  it("loads gtag.js once, configures every id and exposes the conversion labels", () => {
    const env = { GOOGLE_TAG_IDS: "AW-1234567890, G-ABCDEF1234", GOOGLE_ADS_CONVERSION_SIGNUP: "AW-1234567890/AbCdEf_123", GOOGLE_ADS_CONVERSION_PURCHASE: "javascript:alert(1)" };
    const html = withGoogleTag(PAGE, env);
    expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=AW-1234567890"');
    expect(html).toContain("gtag('config','AW-1234567890');gtag('config','G-ABCDEF1234');");
    expect(html).toContain('"signup":"AW-1234567890/AbCdEf_123"');
    expect(html).toContain('"purchase":null');
    expect(html.indexOf("gtag/js")).toBeLessThan(html.indexOf("</head>"));
    expect(withGoogleTag(html, env)).toBe(html);
  });
});

vi.mock('./db', () => ({ pool: { query: vi.fn(async () => ({ rows: [{ id: '1' }] })) } }));
vi.mock('./ads-landing-intel', () => ({
  startAdsIntel: vi.fn(), lookupIntel: vi.fn(async () => null), boundedIntel: vi.fn(async () => null),
  rangeHit: vi.fn(() => null), isLandingBanned: vi.fn(() => false), banIp: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ default: {
  reverse: vi.fn(async () => ['crawl.googlebot.com']),
  lookup: vi.fn(async () => [{ address: '127.0.0.1' }]),
} }));

describe('door responses', () => {
  it('disables the recorder only for a DNS-verified Google crawler', async () => {
    const app = express();
    registerAdsLanding(app, () => '<html><head><title>Public page</title></head><body>Page</body></html>');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/googleads-crm`, { headers: { 'user-agent': 'Googlebot' } });
      expect(await response.text()).toContain('name="ads-door-recording" content="off"');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it.each(Object.keys(ADS_LANDINGS))('%s is uncacheable for both served and rejected visits', async door => {
    const app = express();
    registerAdsLanding(app, () => '<html><head><title>Public page</title></head><body>Page</body></html>');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    try {
      for (const [suffix, ua] of [['?gclid=Cj0KCQjw_abcdefghijklmnop&k=ch_feat_2026', CHROME], ['', CHROME], ['', 'curl/8']]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${door}${suffix}`, { headers: { 'user-agent': ua }, redirect: 'manual' });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('cdn-cache-control')).toBe('no-store');
        expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Public page');
      }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('also prevents caching when rendering fails', async () => {
    const app = express();
    registerAdsLanding(app, () => { throw new Error('render failed'); });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/googleads-pricing`, { redirect: 'manual' });
      expect(response.status).toBe(302);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
