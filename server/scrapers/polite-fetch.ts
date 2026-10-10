/**
 * Polite HTTP for portal adapters: honest User-Agent, one request at a time per
 * host with a minimum delay, back-off on 403/429, and a typed error so callers
 * can record "blocked" instead of inventing an empty result.
 *
 * Rules (CLAUDE.md + fleet brief): public records only, <=1 request/second per
 * host, never bypass CAPTCHAs/anti-bot challenges, never log in, no proxies.
 */
export const USER_AGENT =
  "Mozilla/5.0 (compatible; ConstructHUB-PermitBot/1.0; +https://constructhub.us/permits; contact: support@constructhub.us)";

export class PortalBlockedError extends Error {
  constructor(public readonly url: string, public readonly status: number, message?: string) {
    super(message ?? `Portal returned HTTP ${status} for ${url}`);
    this.name = "PortalBlockedError";
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const lastRequestByHost = new Map<string, number>();
const queueByHost = new Map<string, Promise<void>>();

/** Wait until at least `minDelayMs` has passed since the previous request to this host. Serializes per host. */
export async function rateLimitHost(url: string, minDelayMs: number): Promise<void> {
  const host = new URL(url).host;
  const prev = queueByHost.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  queueByHost.set(host, prev.then(() => mine));
  await prev;
  try {
    const wait = (lastRequestByHost.get(host) ?? 0) + minDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestByHost.set(host, Date.now());
  } finally {
    release();
  }
}

export type PoliteFetchOptions = {
  minDelayMs?: number;
  /** Retries on 429/503 (and 403 once) with a growing delay. Default 2. */
  retries?: number;
  timeoutMs?: number;
};

/** fetch() with the honest UA, per-host rate limiting and back-off. Throws PortalBlockedError on 401/403/429 after retries. */
export async function politeFetch(url: string, init: RequestInit = {}, opts: PoliteFetchOptions = {}): Promise<Response> {
  const minDelayMs = opts.minDelayMs ?? 1000;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 45000;
  let attempt = 0;
  for (;;) {
    await rateLimitHost(url, minDelayMs);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    if (!headers.has("accept")) headers.set("accept", "text/html,application/json;q=0.9,*/*;q=0.8");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: ctrl.signal, redirect: init.redirect ?? "follow" });
    } finally {
      clearTimeout(timer);
    }
    const blocked = res.status === 429 || res.status === 403 || res.status === 401 || res.status === 503;
    if (!blocked) return res;
    if (attempt >= retries || res.status === 401) throw new PortalBlockedError(url, res.status);
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 5000 * 2 ** attempt);
    attempt += 1;
    await sleep(backoff);
  }
}

/** Convenience: politeFetch + text. */
export async function politeText(url: string, init?: RequestInit, opts?: PoliteFetchOptions): Promise<string> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) throw new PortalBlockedError(url, res.status, `HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Convenience: politeFetch + json. */
export async function politeJson<T = unknown>(url: string, init?: RequestInit, opts?: PoliteFetchOptions): Promise<T> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) throw new PortalBlockedError(url, res.status, `HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Playwright default launch args used by every adapter (mirrors server/scraper.ts). */
export const CHROMIUM_ARGS = [
  "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions",
  "--no-first-run", "--disable-background-networking", "--disable-default-apps", "--disable-sync",
  "--disable-features=site-per-process", "--js-flags=--max-old-space-size=256",
];
