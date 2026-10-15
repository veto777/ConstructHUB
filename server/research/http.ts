/**
 * HTTP for the research sources: the portal adapters' politeFetch rules (honest User-Agent, one request at a time per
 * host with a minimum delay) plus what research needs on top (audit 2026-10-15):
 *
 *   - A deadline that covers the body, not just the headers: a server that sends headers and then stalls can't hold
 *     the serial report queue or the daily file refresh. `timeoutMs` bounds the headers, `bodyTimeoutMs` the whole
 *     exchange (body included).
 *   - 401 and 403 are terminal: an access denial is reported as "could not search", never retried around.
 *   - 429/503 back off by Retry-After in either form (seconds or an HTTP date). A wait longer than MAX_WAIT_MS is not
 *     slept through: the search fails and says so.
 *   - robots.txt is honored at run time (HARD RULE 2): a Disallow for our agent (or for *) stops the request.
 *
 * Every source under server/research uses this module (not ../scrapers/polite-fetch directly), and a direct fetch()
 * goes through fetchWithDeadline.
 */
import { PortalBlockedError, USER_AGENT, rateLimitHost, sleep } from "../scrapers/polite-fetch";

export { PortalBlockedError, USER_AGENT, rateLimitHost, sleep };

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

/** Retry-After as milliseconds: delta-seconds or an HTTP date (RFC 9110 §10.2.3); null when absent or unreadable. */
export function retryAfterMs(v: string | null | undefined, now = Date.now()): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

// ── robots.txt ──────────────────────────────────────────────────────────────────────────────────────────────────

type Rule = { allow: boolean; path: string };
const robotsCache = new Map<string, { rules: Rule[]; at: number }>();
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

async function rulesFor(origin: string): Promise<Rule[]> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
  let rules: Rule[] = [];
  try {
    await rateLimitHost(origin, 1000);
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    const text = res.ok ? await res.text() : "";
    // A 4xx means no robots.txt (RFC 9309 §2.3.1.3); an HTML error page served as robots.txt carries no rules either.
    if (res.ok && /user-agent\s*:/i.test(text) && !/^\s*</.test(text)) rules = parseRobots(text);
  } catch { /* unreachable: no rules known; the request itself will fail or succeed on its own */ }
  robotsCache.set(origin, { rules, at: Date.now() });
  return rules;
}

/** Throws PortalBlockedError when robots.txt disallows the URL for us. */
export async function checkRobots(url: string): Promise<void> {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return;
  if (!robotsAllows(await rulesFor(u.origin), u.pathname + u.search)) {
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

/**
 * A single fetch() with the honest UA and one deadline over the whole exchange, body included (the timer keeps
 * running after the headers; reading the body after it fires throws). For the few sources that need fetch() itself
 * (redirect handling, cookies); everything else uses politeFetch.
 */
export async function fetchWithDeadline(url: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  await checkRobots(url);
  const ctrl = new AbortController();
  follow(init.signal, ctrl);
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`)), timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  try {
    return await fetch(url, { ...init, headers, signal: ctrl.signal });
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
  await checkRobots(url);
  let connectRetries = 0;
  for (let attempt = 0; ; ) {
    await rateLimitHost(url, minDelayMs);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    if (!headers.has("accept")) headers.set("accept", "text/html,application/json;q=0.9,*/*;q=0.8");
    if (headers.has("cookie") && !headers.get("cookie")!.trim()) headers.delete("cookie");
    const ctrl = new AbortController();
    follow(init.signal, ctrl);
    const headTimer = setTimeout(() => ctrl.abort(new Error(`no response in ${Math.round(timeoutMs / 1000)}s: ${url}`)), timeoutMs);
    const bodyTimer = setTimeout(() => ctrl.abort(new Error(`response not finished in ${Math.round(bodyTimeoutMs / 1000)}s: ${url}`)), bodyTimeoutMs);
    (bodyTimer as { unref?: () => void }).unref?.();
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: ctrl.signal, redirect: init.redirect ?? "follow" });
    } catch (e) {
      clearTimeout(bodyTimer);
      // Node gives up connecting after 10 s; no request reached the server, so a fresh connection is tried again.
      if ((e as { cause?: { code?: string } })?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" && connectRetries < 2) { connectRetries++; continue; }
      throw e;
    } finally {
      clearTimeout(headTimer);
    }
    if (res.status === 401 || res.status === 403) {
      clearTimeout(bodyTimer);
      await res.body?.cancel().catch(() => undefined);
      throw new PortalBlockedError(url, res.status);
    }
    if (res.status !== 429 && res.status !== 503) return res;
    clearTimeout(bodyTimer);
    await res.body?.cancel().catch(() => undefined);
    const asked = retryAfterMs(res.headers.get("retry-after"));
    if (attempt >= retries) throw new PortalBlockedError(url, res.status);
    if (asked != null && asked > MAX_WAIT_MS) throw new PortalBlockedError(url, res.status, `HTTP ${res.status}: the server asked to wait ${Math.ceil(asked / 60_000)} minute(s) (${url})`);
    await sleep(asked ?? Math.min(60_000, 5000 * 2 ** attempt));
    attempt++;
  }
}

/** politeFetch + text (a non-2xx answer throws). */
export async function politeText(url: string, init?: RequestInit, opts?: ResearchFetchOptions): Promise<string> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new PortalBlockedError(url, res.status, `HTTP ${res.status} for ${url}`); }
  return res.text();
}

/** politeFetch + JSON (a non-2xx answer throws). */
export async function politeJson<T = unknown>(url: string, init?: RequestInit, opts?: ResearchFetchOptions): Promise<T> {
  const res = await politeFetch(url, init, opts);
  if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new PortalBlockedError(url, res.status, `HTTP ${res.status} for ${url}`); }
  return (await res.json()) as T;
}
