/**
 * The research runner's transport for permit searches (audit round 3, decision 5).
 *
 * A permit search started by the research runner runs inside `researchTransport.run(...)`; while it does, every
 * politeFetch an adapter makes, every browser context the scraper opens for it, and the scraper's own API requests go
 * through the research HTTP guard (robots.txt, the shared host block and cooldown, the per-host queue). Outside the
 * runner (the Search page, the permit sweeps) nothing is set and the adapters behave exactly as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { APIRequestContext, APIResponse } from "playwright-core";

export type ResearchTransport = {
  /** Replaces politeFetch: same arguments, same errors (PortalBlockedError on an access denial). */
  fetch: (url: string, init: RequestInit, opts: { minDelayMs?: number; retries?: number; timeoutMs?: number }) => Promise<Response>;
  /** Puts a browser context behind the guard. */
  guardContext: (context: unknown) => Promise<void>;
  /**
   * Before a request the scraper sends with its own client (Playwright's context.request): resolves to the request's
   * turn on its host (its token), held at most `holdMs`.
   */
  before: (url: string, holdMs?: number) => Promise<unknown>;
  /** After it (or after it failed, status 0): ends that turn, then notes the answer's status and Retry-After. */
  after: (url: string, status: number, retryAfter?: string | null, turn?: unknown) => void;
};

export const researchTransport = new AsyncLocalStorage<ResearchTransport>();

/** Puts the context behind the research guard when a research permit search is running (otherwise nothing). */
export async function guardResearchContext(context: unknown): Promise<void> {
  await researchTransport.getStore()?.guardContext(context);
}

/** Guards one request the scraper sends with its own client, when a research permit search is running. */
export async function beforeResearchRequest(url: string): Promise<void> {
  await researchTransport.getStore()?.before(url);
}

export function afterResearchRequest(url: string, status: number, retryAfter?: string | null, turn?: unknown): void {
  researchTransport.getStore()?.after(url, status, retryAfter, turn);
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 8;

/**
 * A POST the scraper sends with Playwright's context.request (EnerGov's search API). Outside a research search it is
 * context.request.post() as before. In one (round 4, finding 6) its redirects are followed here, one hop at a time:
 * every hop passes the guard first and its answer is noted against the URL that answered. A 303, or a 301/302,
 * continues as a GET.
 */
export async function researchPost(request: APIRequestContext, url: string, opts: { headers?: Record<string, string>; data?: unknown; timeout?: number }): Promise<APIResponse> {
  const store = researchTransport.getStore();
  if (!store) return request.post(url, opts);
  const timeout = opts.timeout ?? 20_000;
  let cur = url, method = "POST", data = opts.data, headers = opts.headers;
  for (let hop = 0; ; hop++) {
    const turn = await store.before(cur, timeout);
    let res: APIResponse;
    try {
      res = await request.fetch(cur, { method, headers, data, timeout, maxRedirects: 0 });
    } catch (err) {
      store.after(cur, 0, null, turn);
      throw err;
    }
    store.after(cur, res.status(), res.headers()["retry-after"], turn);
    const loc = res.headers()["location"];
    if (!REDIRECTS.has(res.status()) || !loc) return res;
    await res.dispose().catch(() => undefined);
    if (hop + 1 >= MAX_HOPS) throw new Error(`more than ${MAX_HOPS} redirects from ${url}`);
    const next = new URL(loc, cur);
    if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error(`redirect to ${next.protocol} refused (${url})`);
    if (res.status() === 303 || res.status() === 301 || res.status() === 302) {
      method = "GET"; data = undefined;
      headers = headers && Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-(?:type|length)$/i.test(k)));
    }
    cur = next.toString();
  }
}
