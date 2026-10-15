/**
 * HTTP for the research sources: the portal adapters' politeFetch rules (honest User-Agent, one request at a time per
 * host with a minimum delay) plus what research needs on top (audit 2026-10-15; round 2, decision 6):
 *
 *   - A deadline that covers the body, not just the headers: a server that sends headers and then stalls can't hold
 *     the serial report queue or the daily file refresh. `timeoutMs` bounds the headers, `bodyTimeoutMs` the whole
 *     exchange (body included).
 *   - robots.txt is honored at run time (HARD RULE 2), and fails closed: a 2xx robots.txt is parsed, a 404 or 410
 *     allows, and a 401, 403, 429, 5xx, timeout or a challenge/error page served as robots.txt disallows the
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
  for (const h of Array.from(holding.values())) h.end();
  holding.clear(); turns.clear(); expiredUnreleased.clear();
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
 * Retry-After) is known before the next is sent. Each turn is owned by its request (round 4, finding 12): guard()
 * returns a Turn, and only that Turn's release() ends it, so a late completion can't end somebody else's turn. A turn
 * held past its limit (HOLD_MS, or the request's own deadline) first aborts its request (Turn.signal), then ends.
 */
const HOLD_MS = 15_000;
export type Turn = {
  /** Aborts when the turn is held past its limit; the request must be sent with it (fetch signal, or a timeout no longer than the limit). */
  readonly signal: AbortSignal;
  /** Ends this turn (once the response headers are in, or the request failed). A second call, or a call after the turn expired, does nothing. */
  release: () => void;
};
type Held = { turn: Turn; expired: boolean; released: boolean; end: () => void };
const turns = new Map<string, Promise<void>>();
/** The turn each host's request holds now. */
const holding = new Map<string, Held>();
/** Turns that expired before their owner released them (matched to a late releaseHost(url) from a caller without a Turn). */
const expiredUnreleased = new Map<string, Held[]>();

async function takeTurn(url: string, minDelayMs: number, holdMs = HOLD_MS): Promise<Turn> {
  const host = hostOf(url);
  const prev = turns.get(host) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => (done = r));
  turns.set(host, prev.then(() => mine));
  await prev;
  try { await waitTurn(url, minDelayMs); } catch (err) { done(); throw err; }
  const ctrl = new AbortController();
  const held: Held = {
    expired: false, released: false,
    end: () => {
      clearTimeout(timer);
      if (holding.get(host) === held) holding.delete(host);
      done();
    },
    turn: {
      signal: ctrl.signal,
      release: () => {
        if (held.released) return;
        held.released = true;
        if (held.expired) dropExpired(host, held); else held.end();
      },
    },
  };
  const timer = setTimeout(() => {
    // Abort the request first, then hand the host to the next one.
    held.expired = true;
    ctrl.abort(new Error(`no answer from ${host} within ${Math.round(holdMs / 1000)}s; the request was stopped`));
    expiredUnreleased.set(host, [...(expiredUnreleased.get(host) ?? []), held]);
    held.end();
  }, holdMs);
  (timer as { unref?: () => void }).unref?.();
  holding.set(host, held);
  return held.turn;
}

function dropExpired(host: string, held: Held): void {
  const list = (expiredUnreleased.get(host) ?? []).filter((h) => h !== held);
  if (list.length) expiredUnreleased.set(host, list); else expiredUnreleased.delete(host);
}

/**
 * Ends a turn. With the Turn guard() returned, only that turn ends (the way to call it). Without one (a caller that
 * kept no Turn), a late completion is matched to an expired turn first, so it can't end the turn another request
 * holds now; only when no turn on the host expired does it end the current one.
 */
export function releaseHost(url: string, turn?: Turn): void {
  if (turn) { turn.release(); return; }
  const host = hostOf(url);
  const stale = expiredUnreleased.get(host)?.[0];
  if (stale) { stale.turn.release(); return; }
  holding.get(host)?.turn.release();
}

/**
 * Everything a request must pass before it is sent: the host's block, robots.txt, then the host's turn in its queue
 * (cooldown waited out, or a failure when longer than MAX_WAIT_MS; the rate limit; the block and cooldown checked
 * again right before dispatch). Throws PortalBlockedError when refused. The caller sends the request with the Turn's
 * signal (or a timeout no longer than `holdMs`), calls noteResponse() with the answer and releaseHost(url, turn) once
 * the headers are in (or the request failed). `holdMs` is how long the turn may be held (default HOLD_MS): past it,
 * the request is aborted and the next one may go.
 */
export async function guard(url: string, minDelayMs = 1000, holdMs = HOLD_MS): Promise<Turn> {
  refuseIfBlocked(url);
  await checkRobots(url);
  return takeTurn(url, minDelayMs, holdMs);
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
    const turn = await takeTurn(cur, 1000);
    let res: { status: number; text: string; location?: string | null; retryAfter?: string | null };
    try {
      const own = robotsFetchers.get(u.origin);
      if (own) {
        res = await Promise.race([own(cur), new Promise<never>((_, rej) => {
          setTimeout(() => rej(new Error("timed out")), 15_000);
          turn.signal.addEventListener("abort", () => rej(turn.signal.reason), { once: true });
        })]);
      } else {
        const r = await fetch(cur, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.any([AbortSignal.timeout(15_000), turn.signal]), redirect: "manual" });
        const read = r.status >= 200 && r.status < 500 && !REDIRECTS.has(r.status);
        res = { status: r.status, location: r.headers.get("location"), retryAfter: r.headers.get("retry-after"), text: read ? (await r.text()).slice(0, 200_000) : (await r.body?.cancel().catch(() => undefined), "") };
      }
    } finally {
      turn.release();
    }
    // A 401/403 on robots.txt is not a refusal of the host by itself (RFC 9309 §2.3.1.3: robots.txt "unavailable"):
    // robotsFor() decides from the answer. Many open-data API hosts (ArcGIS REST "Invalid URL", api.box.com) answer
    // every unknown path that way. A 401/403 on a data request still blocks the host (noteResponse there).
    // A challenge page with that 401/403 is a refusal: it blocks the host that answered.
    if ((res.status !== 401 && res.status !== 403) || challengePage(res.text)) noteResponse(cur, res.status, res.retryAfter);
    if (!REDIRECTS.has(res.status) || !res.location) return res;
    if (hop + 1 >= ROBOTS_HOPS) throw new Error(`more than ${ROBOTS_HOPS} redirects for robots.txt`);
    const next = new URL(res.location, cur);
    if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error(`robots.txt redirect to ${next.protocol} refused`);
    cur = next.toString();
  }
}

/**
 * What robots.txt says for one origin (RFC 9309): 2xx → its rules (a challenge page instead: denied; any other HTML
 * page: no rules); a 4xx, 401 and 403 included → no rules, unless the page is a challenge; 429, 5xx, a timeout or a
 * network failure → denied for an hour, then fetched again.
 */
/**
 * A bot challenge or a WAF block page (Cloudflare, Akamai, Imperva, F5, PerimeterX, CAPTCHAs). Such an answer to
 * robots.txt refuses the host for an hour, whatever its status code. A plain 401/403/404 page ("Invalid URL", an empty
 * 401, IIS's "Server Error … 404 - File or directory not found") is not one: it means there is no robots.txt.
 *
 * Vendor markers count anywhere in the page; the general words ("access denied", "captcha", "just a moment") only in
 * what a reader sees, its title and text, never in scripts or attributes (round 4 sweep: an Accela app page logs
 * "Storage access denied" from a script, a Revize 404 page sets form_captcha, My L&I loads reCAPTCHA for its sign-in).
 */
const CHALLENGE_MARKERS = /cf-chl|cf_chl|challenge-platform|_incapsula_|incapsula incident|perimeterx|px-captcha|captcha-delivery|ak_bmsc|bm-verify/i;
const CHALLENGE_WORDS = /just a moment|checking your browser|attention required|captcha|access denied|request rejected|are you a robot|unusual traffic|bot detection/i;
/** Down words: a 2xx page instead of a robots file that says the server is down is refused like a 5xx. */
const DOWN_WORDS = /server error|service unavailable|bad gateway/i;

/** The words a reader sees on an HTML page: scripts, styles and tags removed. */
export function visibleText(html: string): string {
  return html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

export function challengePage(text: string, down = false): boolean {
  const t = text.slice(0, 20_000);
  if (CHALLENGE_MARKERS.test(t)) return true;
  const seen = /<[a-z!]/i.test(t) ? visibleText(t) : t;
  return CHALLENGE_WORDS.test(seen) || (down && DOWN_WORDS.test(seen));
}

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
        // An HTML page is a refusal only when it is a bot challenge or an error page. An app that answers every path
        // with its own page (OK CIB's verify site) has no robots file: no rules, as RFC 9309 reads unparseable content.
        entry = html && challengePage(res.text, true)
          ? { rules: [], denied: "robots.txt answered with a challenge or error page" }
          : { rules: !html && /user-agent\s*:/i.test(res.text) ? parseRobots(res.text) : [] };
      } else if (res.status === 429 || res.status >= 500) entry = { rules: [], denied: `robots.txt answered HTTP ${res.status}` };
      // Any other 4xx (401, 403, 404, 410…) means no robots.txt (RFC 9309 §2.3.1.3), unless the page is a challenge.
      else if (res.status >= 400 && res.status < 500) entry = challengePage(res.text) ? { rules: [], denied: `robots.txt answered HTTP ${res.status} with a challenge page` } : { rules: [] };
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
 * Puts a browser page or context behind the guarded transport (round 3, decision 5; round 4, finding 6). Every page
 * load, XHR and fetch passes the full guard (block, robots.txt, the host's queue: cooldown, rate limit, the recheck
 * before dispatch). Styles, scripts, images and fonts are checked against the block, cooldown and robots.txt without
 * the rate limit. Every request is sent from here with its redirects held back, and each redirect hop is sent from
 * here too, after the same checks (the browser would follow a redirect without asking the route again). Each answer
 * goes to noteResponse() against the URL that answered. The browser gets the last answer for the URL it asked for; a
 * page that came from another address gets a <base> for it, so its relative links still point where they should.
 * The returned check throws the first access denial seen, so a load stops instead of moving on.
 */
export async function guardBrowser(target: Routable, minDelayMs = 1000): Promise<() => void> {
  let denied: unknown = null;
  const deny = (err: unknown) => { if (err instanceof PortalBlockedError) denied ??= err; };
  /** Requests answered here: every hop's answer is already noted (the "response" event would note the last one against the first URL). */
  const answered = new WeakSet<object>();
  await target.route("**/*", async (route: any) => {
    const req = route.request();
    const url: string = req.url();
    if (!/^https?:/i.test(url)) return route.continue();
    answered.add(req);
    const passive = PASSIVE.has(req.resourceType());
    let cur = url, method: string = req.method?.() ?? "GET", postData: Buffer | undefined = req.postDataBuffer?.() ?? undefined;
    let headers: Record<string, string> | undefined;
    try {
      for (let hop = 0; ; hop++) {
        let res: any;
        if (passive) {
          refuseIfBlocked(cur);
          if (coolLeft(cur) > 0) throw new PortalBlockedError(cur, 429, `${hostOf(cur)} asked us to wait; no requests until then`);
          await checkRobots(cur);
          res = await route.fetch({ url: cur, method, postData, headers, maxRedirects: 0, timeout: HOLD_MS });
        } else {
          const turn = await guard(cur, minDelayMs);
          // Playwright takes no abort signal here: its timeout ends the request when its turn does.
          try { res = await route.fetch({ url: cur, method, postData, headers, maxRedirects: 0, timeout: HOLD_MS }); } finally { turn.release(); }
        }
        try { noteResponse(cur, res.status(), res.headers()["retry-after"]); } catch (err) { deny(err); throw err; }
        const loc = res.headers()["location"];
        if (!REDIRECTS.has(res.status()) || !loc) return await fulfill(route, res, url, cur);
        if (hop + 1 >= MAX_HOPS) throw new Error(`more than ${MAX_HOPS} redirects from ${url}`);
        const next = new URL(loc, cur);
        if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error(`redirect to ${next.protocol} refused (${url})`);
        if (res.status() === 303 || ((res.status() === 301 || res.status() === 302) && method === "POST")) {
          method = "GET"; postData = undefined;
          headers = Object.fromEntries(Object.entries((req.headers?.() ?? {}) as Record<string, string>).filter(([k]) => !/^content-(?:type|length)$/i.test(k)));
        }
        cur = next.toString();
      }
    } catch (err) {
      // A style, script or image refused before it was sent is left out; a refused page load, XHR or fetch, or a
      // 401/403 answer to anything, stops the load.
      if (!passive) deny(err);
      return route.abort(err instanceof PortalBlockedError ? "blockedbyclient" : "failed").catch(() => undefined);
    }
  });
  target.on("response", (res: any) => {
    if (answered.has(res.request?.())) return;
    try { noteResponse(res.url(), res.status(), res.headers()["retry-after"]); } catch (err) { deny(err); }
  });
  return () => { if (denied) throw denied; };
}

/** The browser's answer: the last hop's response; an HTML page from another address gets a <base> naming it. */
async function fulfill(route: any, res: any, asked: string, answered: string): Promise<unknown> {
  if (answered === asked || !/text\/html/i.test(res.headers()["content-type"] ?? "")) return route.fulfill({ response: res });
  const html = (await res.body()).toString("utf8");
  const base = `<base href="${answered.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
  const body = /<base[\s>]/i.test(html.slice(0, 20_000)) ? html
    : /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (m: string) => m + base) : base + html;
  return route.fulfill({ response: res, body });
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
async function hops(url: string, init: RequestInit, signal: AbortSignal, minDelayMs: number, holdMs: number, onConnectTimeout?: () => boolean): Promise<Response> {
  const manual = init.redirect === "manual" || init.redirect === "error";
  let cur = url, method = (init.method ?? "GET").toUpperCase(), body = init.body;
  for (let hop = 0; ; hop++) {
    const turn = await guard(cur, minDelayMs, holdMs);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    if (headers.has("cookie") && !headers.get("cookie")!.trim()) headers.delete("cookie");
    if (method === "GET" || method === "HEAD") { headers.delete("content-type"); headers.delete("content-length"); }
    let res: Response;
    try {
      // The turn's signal aborts the request if it outlives its turn (round 4, finding 12).
      res = await fetch(cur, { ...init, method, body: method === "GET" || method === "HEAD" ? undefined : body, headers, signal: AbortSignal.any([signal, turn.signal]), redirect: "manual" });
    } catch (e) {
      turn.release();
      // Node gives up connecting after 10 s; no request reached the server, so a fresh connection is tried again.
      if ((e as { cause?: { code?: string } })?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" && onConnectTimeout?.()) { hop--; continue; }
      throw e;
    }
    turn.release();
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
    return await hops(url, init, ctrl.signal, minDelayMs, Math.min(timeoutMs, 3 * 60_000));
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
      res = await hops(url, { ...init, headers }, ctrl.signal, minDelayMs, timeoutMs, () => connectRetries++ < 2);
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
