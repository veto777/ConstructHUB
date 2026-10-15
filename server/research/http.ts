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
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

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
export function resetHostState(): void {
  hosts.clear(); robotsCache.clear(); robotsPending.clear();
  for (const free of Array.from(holding.values())) free();
  turns.clear();
}

/** The host's block as a thrown PortalBlockedError (nothing when it may be asked). */
function refuseIfBlocked(url: string): void {
  const b = hostBlocked(url);
  if (b) throw new PortalBlockedError(url, b.status, `${hostOf(url)} denied access earlier (${b.why}); no further requests for now`);
}

const coolLeft = (url: string) => (hosts.get(hostOf(url))?.coolUntil ?? 0) - Date.now();

/**
 * Waits out the host's cooldown and rate limit, then checks the block and cooldown again right before the request
 * is sent (round 3, decision 5): a 403 or a Retry-After that arrived while this request waited stops it.
 */
async function waitTurn(url: string, minDelayMs: number): Promise<void> {
  for (;;) {
    refuseIfBlocked(url);
    const cool = coolLeft(url);
    if (cool > MAX_WAIT_MS) throw new PortalBlockedError(url, 429, `${hostOf(url)} asked us to wait ${Math.ceil(cool / 60_000)} minute(s) before the next request`);
    if (cool > 0) { await sleep(cool); continue; }
    await limitHost(url, minDelayMs);
    refuseIfBlocked(url);
    if (coolLeft(url) <= 0) return;
  }
}

/**
 * The per-host request queue: one guarded request per host is out at a time, so the answer to one (a 403, a
 * Retry-After) is known before the next is sent. The turn ends when the caller calls releaseHost() (after the
 * response headers, or after a failure), or after HOLD_MS at the latest.
 */
const HOLD_MS = 15_000;
const turns = new Map<string, Promise<void>>();
const holding = new Map<string, () => void>();

async function takeTurn(url: string, minDelayMs: number): Promise<void> {
  const host = hostOf(url);
  const prev = turns.get(host) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => (done = r));
  turns.set(host, prev.then(() => mine));
  await prev;
  try { await waitTurn(url, minDelayMs); } catch (err) { done(); throw err; }
  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    clearTimeout(timer);
    if (holding.get(host) === free) holding.delete(host);
    done();
  };
  const timer = setTimeout(free, HOLD_MS);
  (timer as { unref?: () => void }).unref?.();
  holding.set(host, free);
}

/** Ends the host's current turn (see takeTurn): call it once the response headers are in, or the request failed. */
export function releaseHost(url: string): void { holding.get(hostOf(url))?.(); }

/**
 * Everything a request must pass before it is sent: the host's block, robots.txt, then the host's turn in its queue
 * (cooldown waited out, or a failure when longer than MAX_WAIT_MS; the rate limit; the block and cooldown checked
 * again right before dispatch). Throws PortalBlockedError when refused. The caller sends the request, calls
 * noteResponse() with the answer and releaseHost() once the headers are in (or the request failed).
 */
export async function guard(url: string, minDelayMs = 1000): Promise<void> {
  refuseIfBlocked(url);
  await checkRobots(url);
  await takeTurn(url, minDelayMs);
}

/** The rate limit plus the host's block and cooldown, checked again after the wait (for callers that check robots.txt themselves). */
export async function rateLimitHost(url: string, minDelayMs: number): Promise<void> {
  await waitTurn(url, minDelayMs);
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

/** A host a source reaches with its own client (MA's Contractor Hub, whose server leaves out its intermediate certificate). */
type RobotsFetcher = (url: string) => Promise<{ status: number; text: string; location?: string | null; retryAfter?: string | null }>;
const robotsFetchers = new Map<string, RobotsFetcher>();
/** Reads `origin`'s robots.txt with the source's own client, so robots.txt is checked over the same connection. */
export function useRobotsFetcher(origin: string, fn: RobotsFetcher): void { robotsFetchers.set(new URL(origin).origin, fn); }

/** Redirect hops followed for a robots.txt (RFC 9309 §2.3.1.2 asks for at least five). */
const ROBOTS_HOPS = 5;
const robotsPending = new Map<string, Promise<{ rules: Rule[]; denied?: string }>>();

/**
 * One robots.txt request through the guarded transport (round 3, decision 5): redirects followed by hand, every hop
 * through the host block and its queue (rate limit, cooldown), a hop to another page also through that page's own
 * robots.txt, and noteResponse() on every answer, recorded against the host that answered.
 */
async function fetchRobots(origin: string, chain: Set<string>): Promise<{ status: number; text: string }> {
  let cur = `${origin}/robots.txt`;
  for (let hop = 0; ; hop++) {
    const u = new URL(cur);
    // A hop to a page on another host (not its robots.txt) needs that host's robots.txt to allow it. A hop on a host
    // whose robots.txt is the one being read (mopro.mo.gov/robots.txt → /license/robots.txt) can't be checked against
    // it; it is still guarded below, and its answer is the robots.txt (an HTML page is a refusal).
    if (u.pathname !== "/robots.txt" && !chain.has(u.origin)) {
      const r = await robotsFor(u.origin, chain);
      if (r.denied || !robotsAllows(r.rules, u.pathname + u.search)) throw new PortalBlockedError(cur, 0, `robots.txt redirects to ${u.host}${u.pathname}, which robots.txt does not allow`);
    }
    refuseIfBlocked(cur);
    await takeTurn(cur, 1000);
    let res: { status: number; text: string; location?: string | null; retryAfter?: string | null };
    try {
      const own = robotsFetchers.get(u.origin);
      if (own) {
        res = await Promise.race([own(cur), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 15_000))]);
      } else {
        const r = await fetch(cur, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
        const ok = r.status >= 200 && r.status < 300;
        res = { status: r.status, location: r.headers.get("location"), retryAfter: r.headers.get("retry-after"), text: ok ? await r.text() : (await r.body?.cancel().catch(() => undefined), "") };
      }
    } finally {
      releaseHost(cur);
    }
    noteResponse(cur, res.status, res.retryAfter);
    if (!REDIRECTS.has(res.status) || !res.location) return res;
    if (hop + 1 >= ROBOTS_HOPS) throw new Error(`more than ${ROBOTS_HOPS} redirects for robots.txt`);
    const next = new URL(res.location, cur);
    if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error(`robots.txt redirect to ${next.protocol} refused`);
    cur = next.toString();
  }
}

/**
 * What robots.txt says for one origin (round 2, decision 6): 2xx → its rules (an HTML page instead of a robots file
 * is a challenge: denied); 404/410 → no rules; 401, 403, 429, 5xx, a timeout or a network failure → denied for an
 * hour, then fetched again. Other 4xx answers mean "no robots.txt" (RFC 9309 §2.3.1.3).
 */
export async function robotsFor(origin: string, chain: Set<string> = new Set()): Promise<{ rules: Rule[]; denied?: string }> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < hit.ttl) return hit;
  const pending = !chain.size ? robotsPending.get(origin) : undefined;
  if (pending) return pending;
  const work = (async () => {
    let entry: { rules: Rule[]; denied?: string };
    try {
      const res = await fetchRobots(origin, new Set(chain).add(origin));
      const ok = res.status >= 200 && res.status < 300;
      if (ok) {
        const html = /^\s*</.test(res.text) || /<html[\s>]/i.test(res.text.slice(0, 2000));
        entry = html ? { rules: [], denied: "robots.txt answered with an HTML page (a challenge or an error page)" } : { rules: /user-agent\s*:/i.test(res.text) ? parseRobots(res.text) : [] };
      } else if (res.status === 404 || res.status === 410) entry = { rules: [] };
      else if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) entry = { rules: [], denied: `robots.txt answered HTTP ${res.status}` };
      else if (REDIRECTS.has(res.status)) entry = { rules: [], denied: "robots.txt redirected without a location" };
      else entry = { rules: [] };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      entry = { rules: [], denied: err instanceof PortalBlockedError && (e.status === 401 || e.status === 403)
        ? `robots.txt answered HTTP ${e.status}` : `robots.txt could not be read (${String(e?.message ?? err).slice(0, 120)})` };
    }
    robotsCache.set(origin, { ...entry, at: Date.now(), ttl: entry.denied ? BLOCK_MS : ROBOTS_TTL_MS });
    return entry;
  })();
  if (!chain.size) { robotsPending.set(origin, work); work.finally(() => robotsPending.delete(origin)).catch(() => undefined); }
  return work;
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

// ── Browser pages ───────────────────────────────────────────────────────────────────────────────────────────────

/** Resource types a page loads on its own (styles, scripts, images, fonts): checked, but not rate limited. */
const PASSIVE = new Set(["stylesheet", "script", "image", "font", "media", "manifest", "texttrack", "ping"]);

type Routable = { route: (pattern: string, handler: (route: any) => Promise<unknown>) => Promise<unknown>; on: (event: "response", fn: (res: any) => void) => unknown };

/**
 * Puts a browser page or context behind the guarded transport (round 3, decision 5). Every page load, XHR and fetch
 * passes the full guard (block, robots.txt, the host's queue: cooldown, rate limit, the recheck before dispatch); it
 * is sent with its redirects held back, so a redirect's target passes the guard too before the browser follows it.
 * Its answer goes to noteResponse() against the host that answered. Styles, scripts, images and fonts are checked
 * against the block, cooldown and robots.txt without the rate limit. Every other response is noted as well.
 * The returned check throws the first access denial seen, so a load stops instead of moving on.
 */
export async function guardBrowser(target: Routable, minDelayMs = 1000): Promise<() => void> {
  let denied: unknown = null;
  const deny = (err: unknown) => { if (err instanceof PortalBlockedError) denied ??= err; };
  await target.route("**/*", async (route: any) => {
    const req = route.request();
    const url: string = req.url();
    if (!/^https?:/i.test(url)) return route.continue();
    if (PASSIVE.has(req.resourceType())) {
      const ok = !hostBlocked(url) && coolLeft(url) <= 0 && await robotsAllowed(url);
      return ok ? route.continue() : route.abort("blockedbyclient");
    }
    let res: any;
    try {
      await guard(url, minDelayMs);
      try { res = await route.fetch({ maxRedirects: 0 }); } finally { releaseHost(url); }
      noteResponse(url, res.status(), res.headers()["retry-after"]);
      const loc = res.headers()["location"];
      if (REDIRECTS.has(res.status()) && loc) {
        // The browser follows this redirect without asking the route again: its target passes the guard now.
        const next = new URL(loc, url).toString();
        await guard(next, minDelayMs);
        releaseHost(next);
      }
    } catch (err) {
      deny(err);
      return route.abort(err instanceof PortalBlockedError ? "blockedbyclient" : "failed").catch(() => undefined);
    }
    return route.fulfill({ response: res });
  });
  target.on("response", (res: any) => {
    try { noteResponse(res.url(), res.status(), res.headers()["retry-after"]); } catch (err) { deny(err); }
  });
  return () => { if (denied) throw denied; };
}

// ── Fetch ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Abort `ctrl` when `signal` aborts (a caller's own signal still works). */
function follow(signal: AbortSignal | null | undefined, ctrl: AbortController) {
  if (!signal) return;
  if (signal.aborted) ctrl.abort(signal.reason);
  else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
}

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
      releaseHost(cur);
      // Node gives up connecting after 10 s; no request reached the server, so a fresh connection is tried again.
      if ((e as { cause?: { code?: string } })?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" && onConnectTimeout?.()) { hop--; continue; }
      throw e;
    }
    releaseHost(cur);
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
