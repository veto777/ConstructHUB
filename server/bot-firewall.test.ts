import { describe, expect, it } from "vitest";
// The crawler firewall (server/bot-firewall.ts; owner, 2026-10-16): Google crawls, nothing else does.
import { classifyRequest, isGoogleIp, overRate, RATE } from "./bot-firewall";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CUBOT = "Mozilla/5.0 (Linux; Android 11; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("bot firewall", () => {
  it("lets browsers through and sends Google crawlers to the IP check", () => {
    for (const ua of [CHROME, IPHONE, CUBOT]) expect(classifyRequest("/pricing", ua), ua).toBe("human");
    expect(classifyRequest("/", GOOGLEBOT)).toBe("google");
    expect(classifyRequest("/", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("google");
    expect(classifyRequest("/", "AdsBot-Google (+http://www.google.com/adsbot.html)")).toBe("google");
  });
  it("refuses every other crawler, scraper, library and headless browser", () => {
    const bots = [
      "", "curl/8.5.0", "Wget/1.21", "python-requests/2.31", "Go-http-client/2.0", "axios/1.6.0", "node-fetch/1.0",
      "Scrapy/2.11 (+https://scrapy.org)", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "Mozilla/5.0 (compatible; SemrushBot/7~bl)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "CCBot/2.0 (https://commoncrawl.org/faq/)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "Mozilla/5.0 (compatible; YandexBot/3.0)", "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Safari/605.1.15 (Applebot/0.1)",
      "Twitterbot/1.0", "LinkedInBot/1.0", "SomeTool/1.0",
    ];
    for (const ua of bots) expect(classifyRequest("/", ua), ua).toBe("bot");
  });
  it("Meta's ad crawler may read pages (ad review), never the API, and can be switched off", () => {
    const meta = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
    expect(classifyRequest("/features/crm", meta)).toBe("meta-ad");
    expect(classifyRequest("/api/databases", meta)).toBe("bot");
    expect(classifyRequest("/features/crm", meta, { allowMetaAds: false })).toBe("bot");
  });
  it("machine-to-machine paths and the keyed API are not judged by user agent", () => {
    for (const p of ["/api/stripe/webhook", "/api/crm/webhooks", "/voice/incoming", "/api/inbound-mail", "/api/click-guard/track", "/api/vpn-shield/script/abc", "/api/click-guard/exclusion-list/abc", "/.well-known/apple-app-site-association", "/robots.txt"]) {
      expect(classifyRequest(p, "Stripe/1.0"), p).toBe("machine");
    }
    expect(classifyRequest("/api/v1/permits", "python-requests/2.31", { hasApiKey: true })).toBe("machine");
    expect(classifyRequest("/api/v1/permits", "python-requests/2.31")).toBe("bot");
    expect(classifyRequest("/api/databases", "python-requests/2.31", { hasApiKey: true })).toBe("bot");
  });
  it("a fake Googlebot fails the reverse-then-forward DNS check", async () => {
    const real = { reverse: async () => ["crawl-66-249-66-1.googlebot.com"], lookup: async () => [{ address: "66.249.66.1" }] };
    const spoofed = { reverse: async () => ["crawl-66-249-66-1.googlebot.com.evil.net"], lookup: async () => [{ address: "6.6.6.6" }] };
    const mismatch = { reverse: async () => ["crawl.googlebot.com"], lookup: async () => [{ address: "66.249.66.9" }] };
    expect(await isGoogleIp("66.249.66.1", real)).toBe(true);
    expect(await isGoogleIp("6.6.6.6", spoofed)).toBe(false);
    expect(await isGoogleIp("66.249.66.2", mismatch)).toBe(false);
  });
  it("rate limits bulk page and API pulls per IP, never static files", () => {
    const t = Date.UTC(2026, 9, 16, 12, 0, 5);
    for (let i = 0; i < RATE.pagesPerMinute; i++) expect(overRate("1.1.1.1", "/features/x", t)).toBe(false);
    expect(overRate("1.1.1.1", "/features/x", t)).toBe(true);
    // Blocked for the block window, even in the next minute.
    expect(overRate("1.1.1.1", "/pricing", t + 61_000)).toBe(true);
    expect(overRate("1.1.1.1", "/pricing", t + RATE.blockMinutes * 60_000 + 61_000)).toBe(false);
    for (let i = 0; i < 1000; i++) expect(overRate("2.2.2.2", "/assets/index-abc.js", t)).toBe(false);
    for (let i = 0; i < RATE.apiPerMinute; i++) expect(overRate("3.3.3.3", "/api/auth/me", t)).toBe(false);
    expect(overRate("3.3.3.3", "/api/auth/me", t)).toBe(true);
  });
});

it("public tutorial media is open to the social networks' fetchers", () => {
  expect(classifyRequest("/api/tutorials/media/crm-clients.social-vertical.0123abcd.mp4", "facebookexternalhit/1.1")).toBe("machine");
  expect(classifyRequest("/api/tutorials/media/story-tut-crm-pricebook.4a0254f3.mp4", "curl/8.5.0")).toBe("machine");
  expect(classifyRequest("/api/files/social/a8132d899a79405ba0bb6c2888be5eaa/media.jpg", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe("machine");
  expect(classifyRequest("/api/files/other/a8132d899a79405ba0bb6c2888be5eaa/media.jpg", "facebookexternalhit/1.1")).toBe("bot");
  expect(classifyRequest("/api/tutorials", "curl/8.5.0")).toBe("bot");
});
