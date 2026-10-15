/**
 * The research runner's transport for permit searches (audit round 3, decision 5).
 *
 * A permit search started by the research runner runs inside `researchTransport.run(...)`; while it does, every
 * politeFetch an adapter makes, every browser context the scraper opens for it, and the scraper's own API requests go
 * through the research HTTP guard (robots.txt, the shared host block and cooldown, the per-host queue). Outside the
 * runner (the Search page, the permit sweeps) nothing is set and the adapters behave exactly as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type ResearchTransport = {
  /** Replaces politeFetch: same arguments, same errors (PortalBlockedError on an access denial). */
  fetch: (url: string, init: RequestInit, opts: { minDelayMs?: number; retries?: number; timeoutMs?: number }) => Promise<Response>;
  /** Puts a browser context behind the guard. */
  guardContext: (context: unknown) => Promise<void>;
  /** Before a request the scraper sends with its own client (Playwright's context.request). */
  before: (url: string) => Promise<void>;
  /** After it: the answer's status and Retry-After. */
  after: (url: string, status: number, retryAfter?: string | null) => void;
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

export function afterResearchRequest(url: string, status: number, retryAfter?: string | null): void {
  researchTransport.getStore()?.after(url, status, retryAfter);
}
