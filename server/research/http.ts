/**
 * HTTP for the research sources: the portal adapters' politeFetch rules (honest User-Agent, one request at a time per
 * host with a minimum delay) plus what research needs on top (audit 2026-10-15; round 2, decision 6):
 *
 *   - A deadline that covers the body, not just the headers: a server that sends headers and then stalls can't hold
 *     the serial report queue or the daily file refresh. `timeoutMs` bounds the headers, `bodyTimeoutMs` the whole
 *     exchange (body included).
 *   - robots.txt is honored at run time (HARD RULE 2), and fails closed: a 2xx robots.txt is parsed, a 404 or 410
 *     allows, and a 401, 403, 429, 5xx, timeout or an HTML page served as robots.txt (a challenge) disallows the
 *     whole host for an hour, then it is fetched again.
 *   - Redirects are followed by hand (at most MAX_HOPS), and every hop is checked against robots.txt, the host's
 *     block and cooldown, and the per-host rate limit, like the first request.
 *   - One per-host state for every caller: after a 401 or 403 the host gets no request for the rest of the runs
 *     that were going on (a report, a file load) and for an hour after; a Retry-After (seconds or an HTTP date) sets
 *     a cooldown every caller waits out, or fails on when it is longer than MAX_WAIT_MS.
 *   - Access denials throw PortalBlockedError; a source's catch rethrows it (rethrowIfBlocked) instead of moving on to
 *     the next request. Other HTTP errors (a 404 on one detail page) are plain Errors.
 *
 * Every source under server/research uses this module (not ../scrapers/polite-fetch directly). A source with its own
 * client (a plain HTTPS request, a browser) calls guard() before each request and noteResponse() after it.
 */
import { PortalBlockedError, USER_AGENT, rateLimitHost as limitHost, sleep } from "../scrapers/polite-fetch";

export { PortalBlockedError, USER_AGENT, sleep };

export type ResearchFetchOptions = {
  minDelayMs?: number;
  /** Retries on 429/503 with a growing delay (never on 401/403). Default 2. */
  retries?: number;
  /** Until the response headers arrive. Default 45 s. */
  timeoutMs?: number;
  /** The whole exchange, body included. Default the larger of 4 × timeoutMs and 3 minutes. */
  bodyTimeoutMs?: number;
};

/** The longest Retry-After we wait out; a publisher asking for more gets no request until a later report. */
export const MAX_WAIT_MS = 2 * 60_000;
/** Redirect hops followed for one request. */
export const MAX_HOPS = 8;
/** How long a host that denied access (or whose robots.txt couldn't be read) gets no request. */
export const BLOCK_MS = 3600_000;

/** Retry-After as milliseconds: delta-seconds or an HTTP date (RFC 9110 §10.2.3); null when absent or unreadable. */
export function retryAfterMs(v: string | null | undefined, now = Date.now()): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Rethrows an access denial (401/403, robots.txt, a blocked host, a cooldown too long to wait); anything else returns. */
export function rethrowIfBlocked(err: unknown): void {
  if (err instanceof PortalBlockedError) throw err;
}

// ── Per-host state ──────────────────────────────────────────────────────────────────────────────────────────────

type HostState = { blockedUntil?: number; blockedRuns?: Set<number>; why?: string; status?: number; coolUntil?: number };
const hosts = new Map<string, HostState>();
const activeRuns = new Set<number>();
let runSeq = 0;
const hostOf = (url: string) => new URL(url).host;

/**
 * One report or one file load. A host that denies access during it gets no request until every run that was going
 * on at that moment has ended, and for at least BLOCK_MS.
 */
export async function withRun<T>(fn: () => Promise<T>): Promise<T> {
  const id = ++runSeq;
  activeRuns.add(id);
  try { return await fn(); } finally { activeRuns.delete(id); }
}

/** Marks the host as having denied access (a 401/403 answer, or a robots.txt that couldn't be read). */
export function blockHost(url: string, status: number, why: string): void {
  const st = hosts.get(hostOf(url)) ?? {};
  hosts.set(hostOf(url), { ...st, blockedUntil: Date.now() + BLOCK_MS, blockedRuns: new Set(activeRuns), why, status });
}

/** Sets the host's cooldown: no caller sends it anything before then. */
export function coolHost(url: string, ms: number): void {
  const st = hosts.get(hostOf(url)) ?? {};
  hosts.set(hostOf(url), { ...st, coolUntil: Math.max(st.coolUntil ?? 0, Date.now() + ms) });
}

/** Why the host gets no request now (null: it may be asked). */
export function hostBlocked(url: string): { status: number; why: string } | null {
  const st = hosts.get(hostOf(url));
  if (!st?.blockedUntil) return null;
  const running = Array.from(st.blockedRuns ?? []).some((r) => activeRuns.has(r));
  return Date.now() < st.blockedUntil || running ? { status: st.status ?? 403, why: st.why ?? "access denied" } : null;
}

/** For tests: forget every host's state and cached robots.txt. */
export function resetHostState(): void { hosts.clear(); robotsCache.clear(); }

/**
 * Everything a request must pass before it is sent: the host's block, robots.txt, the host's cooldown (waited out,
 * or a failure when longer than MAX_WAIT_MS) and the per-host rate limit. Throws PortalBlockedError when refused.
 */
export async function guard(url: string, minDelayMs = 1000): Promise<void> {
  const b = hostBlocked(url);
  if (b) throw new PortalBlockedError(url, b.status, `${hostOf(url)} denied access earlier (${b.why}); no further requests for now`);
  await checkRobots(url);
  const cool = (hosts.get(hostOf(url))?.coolUntil ?? 0) - Date.now();
  if (cool > MAX_WAIT_MS) throw new PortalBlockedError(url, 429, `${hostOf(url)} asked us to wait ${Math.ceil(cool / 60_000)} minute(s) before the next request`);
  if (cool > 0) await sleep(cool);
  await limitHost(url, minDelayMs);
}

/** The rate limit alone, plus the host's block and cooldown (for callers that check robots.txt themselves). */
export async function rateLimitHost(url: string, minDelayMs: number): Promise<void> {
  const b = hostBlocked(url);
  if (b) throw new PortalBlockedError(url, b.status, `${hostOf(url)} denied access earlier (${b.why}); no further requests for now`);
  const cool = (hosts.get(hostOf(url))?.coolUntil ?? 0) - Date.now();
  if (cool > MAX_WAIT_MS) throw new PortalBlockedError(url, 429, `${hostOf(url)} asked us to wait ${Math.ceil(cool / 60_000)} minute(s) before the next request`);
  if (cool > 0) await sleep(cool);
  await limitHost(url, minDelayMs);
}

/**
 * What every response tells the host state: a 401/403 blocks the host (and throws), a Retry-After sets its
 * cooldown. For sources with their own client; politeFetch and fetchWithDeadline call it on every hop.
 */
export function noteResponse(url: string, status: number, retryAfter?: string | null): void {
  if (status === 401 || status === 403) {
    blockHost(url, status, `HTTP ${status}`);
    throw new PortalBlockedError(url, status);
  }
  const wait = retryAfterMs(retryAfter);
  if (wait != null && (status === 429 || status === 503)) coolHost(url, wait);
}

// ── robots.txt ──────────────────────────────────────────────────────────────────────────────────────────────────

type Rule = { allow: boolean; path: string };
const robotsCache = new Map<string, { rules: Rule[]; at: number; ttl: number; denied?: string }>();
const ROBOTS_TTL_MS = 12 * 3600_000;
/** Our product token in robots.txt groups (the UA is "ConstructHUB-PermitBot/1.0"). */
const AGENT_TOKEN = "constructhub-permitbot";

/** The rules of the group that applies to us: our own token's group if present, else "*". */
export function parseRobots(text: string): Rule[] {
  type Group = { agents: string[]; rules: Rule[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.rules.push({ allow: false, path: val });
    else if (key === "allow" && val) cur.rules.push({ allow: true, path: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && AGENT_TOKEN.startsWith(a.replace(/\/.*$/, ""))));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

const ruleRe = (path: string) => new RegExp("^" + path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
/** RFC 9309: the longest matching rule wins; Allow wins a tie; no matching rule allows. */
export function robotsAllows(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!ruleRe(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/**
 * What robots.txt says for one origin (round 2, decision 6): 2xx → its rules (an HTML page instead of a robots file
 * is a challenge: denied); 404/410 → no rules; 401, 403, 429, 5xx, a timeout or a network failure → denied for an
 * hour, then fetched again. Other 4xx answers mean "no robots.txt" (RFC 9309 §2.3.1.3).
 */
export async function robotsFor(origin: string): Promise<{ rules: Rule[]; denied?: string }> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < hit.ttl) return hit;
  let entry: { rules: Rule[]; denied?: string };
  try {
    await limitHost(origin, 1000);
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    const text = res.ok ? await res.text() : (await res.body?.cancel().catch(() => undefined), "");
    if (res.ok) {
      const html = /^\s*</.test(text) || /<html[\s>]/i.test(text.slice(0, 2000));
      entry = html ? { rules: [], denied: "robots.txt answered with an HTML page (a challenge or an error page)" } : { rules: /user-agent\s*:/i.test(text) ? parseRobots(text) : [] };
    } else if (res.status === 404 || res.status === 410) entry = { rules: [] };
    else if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) entry = { rules: [], denied: `robots.txt answered HTTP ${res.status}` };
    else entry = { rules: [] };
  } catch (err) {
    entry = { rules: [], denied: `robots.txt could not be read (${String((err as Error)?.message ?? err).slice(0, 80)})` };
  }
  robotsCache.set(origin, { ...entry, at: Date.now(), ttl: entry.denied ? BLOCK_MS : ROBOTS_TTL_MS });
  return entry;
}

/** True when robots.txt lets us request the URL (an unreadable robots.txt does not). */
export async function robotsAllowed(url: string): Promise<boolean> {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return true;
  const r = await robotsFor(u.origin);
  return !r.denied && robotsAllows(r.rules, u.pathname + u.search);
}

/** Throws PortalBlockedError when robots.txt disallows the URL for us, or couldn't be read. */
export async function checkRobots(url: string): Promise<void> {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return;
  const r = await robotsFor(u.origin);
  if (r.denied) throw new PortalBlockedError(url, 0, `${u.host}: ${r.denied}; no automated requests until it can be read`);
  if (!robotsAllows(r.rules, u.pathname + u.search)) {
    throw new PortalBlockedError(url, 0, `robots.txt disallows ${u.host}${u.pathname} for automated requests`);
  }
}

// ── Fetch ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Abort `ctrl` when `signal` aborts (a caller's own signal still works). */
function follow(signal: AbortSignal | null | undefined, ctrl: AbortController) {
  if (!signal) return;
  if (signal.aborted) ctrl.abort(signal.reason);
  else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * One request, its redirects followed by hand: every hop passes guard() (block, robots.txt, cooldown, rate limit)
 * and noteResponse() (a 401/403 blocks the host and throws; Retry-After sets the cooldown). A caller that asks for
 * redirect "manual" or "error" gets the first answer as it is. A 303, or a 301/302 after a POST, continues as a GET.
 */
async function hops(url: string, init: RequestInit, signal: AbortSignal, minDelayMs: number, onConnectTimeout?: () => boolean): Promise<Response> {
  const manual = init.redirect === "manual" || init.redirect === "error";
  let cur = url, method = (init.method ?? "GET").toUpperCase(), body = init.body;
  for (let hop = 0; ; hop++) {
    await guard(cur, minDelayMs);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    if (headers.has("cookie") && !headers.get("cookie")!.trim()) headers.delete("cookie");
    if (method === "GET" || method === "HEAD") { headers.delete("content-type"); headers.delete("content-length"); }
    let res: Response;
    try {
      res = await fetch(cur, { ...init, method, body: method === "GET" || method === "HEAD" ? undefined : body, headers, signal, redirect: "manual" });
    } catch (e) {
      // Node gives up connecting after 10 s; no request reached the server, so a fresh connection is tried again.
      if ((e as { cause?: { code?: string } })?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" && onConnectTimeout?.()) { hop--; continue; }
      throw e;
    }
    try { noteResponse(cur, res.status, res.headers.get("retry-after")); }
    catch (err) { await res.body?.cancel().catch(() => undefined); throw err; }
    const loc = res.headers.get("location");
    if (manual || !REDIRECTS.has(res.status) || !loc) return res;
    await res.body?.cancel().catch(() => undefined);
    if (hop + 1 >= MAX_HOPS) throw new Error(`more than ${MAX_HOPS} redirects from ${url}`);
    const next = new URL(loc, cur);
    if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error(`redirect to ${next.protocol} refused (${url})`);
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
    cur = next.toString();
  }
}

/**
 * A single request (redirects followed by hand, each hop guarded) with the honest UA and one deadline over the whole
 * exchange, body included (the timer keeps running after the headers; reading the body after it fires throws). For
 * the few sources that need fetch() itself (redirect handling, cookies); everything else uses politeFetch. A 401/403
 * throws PortalBlockedError.
 */
export async function fetchWithDeadline(url: string, init: RequestInit = {}, timeoutMs = 120_000, minDelayMs = 1000): Promise<Response> {
  const ctrl = new AbortController();
  follow(init.signal, ctrl);
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`)), timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  try {
    return await hops(url, init, ctrl.signal, minDelayMs);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** fetch() with the honest UA, per-host rate limiting, robots.txt, back-off and deadlines (see the top of the file). */
export async function politeFetch(url: string, init: RequestInit = {}, opts: ResearchFetchOptions = {}): Promise<Response> {
  const minDelayMs = opts.minDelayMs ?? 1000;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const bodyTimeoutMs = Math.max(opts.bodyTimeoutMs ?? Math.max(timeoutMs * 4, 180_000), timeoutMs);
  let connectRetries = 0;
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("accept")) headers.set("accept", "text/html,application/json;q=0.9,*/*;q=0.8");
  for (let attempt = 0; ; ) {
    const ctrl = new AbortController();
    follow(init.signal, ctrl);
    const headTimer = setTimeout(() => ctrl.abort(new Error(`no response in ${Math.round(timeoutMs / 1000)}s: ${url}`)), timeoutMs);
    const bodyTimer = setTimeout(() => ctrl.abort(new Error(`response not finished in ${Math.round(bodyTimeoutMs / 1000)}s: ${url}`)), bodyTimeoutMs);
    (bodyTimer as { unref?: () => void }).unref?.();
    let res: Response;
    try {
      res = await hops(url, { ...init, headers }, ctrl.signal, minDelayMs, () => connectRetries++ < 2);
    } catch (e) {
      clearTimeout(bodyTimer);
      throw e;
    } finally {
      clearTimeout(headTimer);
    }
    if (res.status !== 429 && res.status !== 503) return res;
    clearTimeout(bodyTimer);
    await res.body?.cancel().catch(() => undefined);
    const asked = retryAfterMs(res.headers.get("retry-after"));
    if (attempt >= retries) throw new PortalBlockedError(url, res.status);
    if (asked != null && asked > MAX_WAIT_MS) throw new PortalBlockedError(url, res.status, `HTTP ${res.status}: the server asked to wait ${Math.ceil(asked / 60_000)} minute(s) (${url})`);
    // No Retry-After: our own growing delay (the host's cooldown, when one was given, is waited out by guard()).
    if (asked == null) await sleep(Math.min(60_000, 5000 * 2 ** attempt));
    attempt++;
  }
}

/** A non-2xx answer that is not an access denial (a 404, a 500): a plain Error, so a source may skip that one page. */
function httpError(url: string, status: number): Error {
  return status === 401 || status === 403 || status === 429 ? new PortalBlockedError(url, status, `HTTP ${status} for ${url}`) : new Error(`HTTP ${status} for ${url}`);
}

/** politeFetch + text (a non-2xx answer throws). */
export async function politeText(url: string, init?: RequestInit, opts?: ResearchFetchOptions): Promise<string> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw httpError(url, res.status); }
  return res.text();
}

/** politeFetch + JSON (a non-2xx answer throws). */
export async function politeJson<T = unknown>(url: string, init?: RequestInit, opts?: ResearchFetchOptions): Promise<T> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw httpError(url, res.status); }
  return (await res.json()) as T;
}
