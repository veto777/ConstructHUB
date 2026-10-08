/**
 * The ONE boundary between the SEO module's errors and what a customer reads.
 *
 * Owner rule: a customer never sees who the SEO data comes from, nor what it
 * costs us — on a page, in an error, in a saved note shown later, anywhere.
 * Inside the server an error keeps its exact wording (the vendor's name, its
 * `status_message`, the dollar figures of the internal cap): that is for the
 * log, the issue desk and platform admins. Everything that leaves for a
 * customer goes through here:
 *
 *   seoErrorResponse  — an error thrown while serving /api/seo/*  -> status + JSON body
 *   publicFailure     — an error from background work             -> the note saved for the customer
 *   publicNote        — a note ALREADY saved (rank runs, grid scans) -> safe to show; rows are never rewritten
 *
 * No customer copy is built from an error's own text. Unknown errors get a
 * neutral sentence; the text they carried is logged.
 */
import { z } from "zod";
import { SEO_CREDIT_PACKS } from "@shared/seo-credits";
import { DataForSeoError, SEO_SOURCE_PUBLIC_MESSAGES } from "./dataforseo";
import { SeoBudgetError, BUDGET_PAUSED_MESSAGE } from "./budget";
import { SEO_NOT_READY_MESSAGE } from "./plan";

/** The vendor by any spelling, its hosts and its env names. Nothing matching this may reach a customer. */
export const VENDOR_NAME_RE = /dataforseo|data\s*for\s*seo|\bdfs\b/i;
/** Platform admins are told which vendor an error came from. */
export const SEO_VENDOR_NAME = "DataForSEO";

/** An error the server did not expect. It says nothing about credits: what was or was not charged is on the usage page. */
export const SEO_UNEXPECTED_MESSAGE = "Something went wrong on our side — try again in a few minutes. Your SEO usage page shows whether anything was charged.";
/** A saved note that cannot be shown as written. */
export const SEO_NOTE_FALLBACK = "The check could not be completed.";

/**
 * An error whose `message` was WRITTEN FOR THE CUSTOMER by the code that throws it (a limit reached, a thing not
 * found). Extend this — never plain Error — for anything a route should answer with as it is; a plain Error's
 * text is never shown.
 */
export class SeoCustomerError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = new.target.name; }
}

/**
 * The things that did not fail, but could not be done at this moment and can be asked for again as they are. Each has
 * its customer message and status here, so a route answers them the same way everywhere and a page can offer "try again".
 *   seo_busy          the one-at-a-time section this request needed (server/seo/locks.ts) was held by another request —
 *                     possibly in another server process — for longer than a request may wait. 503: ours, temporary.
 *   seo_crawl_changed the newest crawl was replaced while it was being read (server/seo/audit.ts readNewestCrawl),
 *                     three times over. 409: the thing asked about changed under the request.
 */
export const SEO_RETRY = {
  seo_busy: { status: 503, message: "That is still being worked on for your account — try again in a minute." },
  seo_crawl_changed: { status: 409, message: "The newest crawl changed while it was being read — try again in a moment." },
} as const;
export type SeoRetryCode = keyof typeof SEO_RETRY;
/** An SeoCustomerError the customer can simply retry; `code` tells the page which case it is. */
export class SeoRetryableError extends SeoCustomerError {
  constructor(readonly code: SeoRetryCode) { super(SEO_RETRY[code].message, SEO_RETRY[code].status); }
}

export type SeoErrorResponse = { status: number; body: Record<string, unknown>; /** Something the server did not expect: worth a line in the log and the issue desk. */ unexpected: boolean };

const SOURCE_STATUS: Record<DataForSeoError["code"], number> = {
  not_configured: 503, auth: 502, rate_limited: 429, timeout: 504, upstream: 502, invalid: 400, task_failed: 400,
};

const isOurs = (e: unknown) => e instanceof DataForSeoError || e instanceof SeoBudgetError || e instanceof SeoCustomerError || e instanceof z.ZodError;
/**
 * Some lookups wrap the source's error in a plain Error and keep the original as `cause` (fetchGrid does, to
 * carry what the tries cost). The wrapper's text is the source's own, so it is never shown: the original decides.
 */
function knownError(e: unknown): unknown {
  const cause = (e as { cause?: unknown } | null)?.cause;
  return !isOurs(e) && (cause instanceof DataForSeoError || cause instanceof SeoBudgetError) ? cause : e;
}

/**
 * Turn any error from an SEO route into the response for it. `admin` (a
 * platform admin is asking) adds an `admin` block with the internal wording;
 * nobody else ever gets it.
 */
export function seoErrorResponse(thrown: unknown, opts: { admin?: boolean } = {}): SeoErrorResponse {
  const admin = opts.admin === true, e = knownError(thrown);
  if (e instanceof z.ZodError) return { status: 400, unexpected: false, body: { message: "Invalid input", issues: e.issues.slice(0, 3) } };
  // Could not be done just now and can be asked for again as it is: the code and `retryable` let a page say so.
  if (e instanceof SeoRetryableError) return { status: e.status, unexpected: false, body: { code: e.code, message: e.message, retryable: true } };
  // Written for the customer by the feature that throws it (ListError, WatchError).
  if (e instanceof SeoCustomerError) return { status: e.status, unexpected: false, body: { message: e.message } };
  if (e instanceof SeoBudgetError) {
    // `message` is the customer's: SEO credit, or the neutral "paused". The wholesale dollars and the cap are in `detail`.
    return { status: 402, unexpected: false, body: {
      code: e.code, message: e.message, ...(e.code === "seo_credits" ? { packs: SEO_CREDIT_PACKS } : {}),
      ...(admin ? { admin: { vendor: SEO_VENDOR_NAME, detail: e.detail, estimateUsd: e.estimateUsd, remainingUsd: e.remainingUsd } } : {}),
    } };
  }
  if (e instanceof DataForSeoError) {
    return { status: SOURCE_STATUS[e.code] ?? 502, unexpected: false, body: {
      code: e.publicCode, message: e.publicMessage, ...(e.code === "not_configured" ? { configured: false } : {}),
      ...(admin ? { admin: { vendor: SEO_VENDOR_NAME, code: e.code, detail: e.message, vendorStatus: e.status ?? null, costUsd: e.costUsd } } : {}),
    } };
  }
  const err = e as { message?: unknown; name?: unknown } | null;
  return { status: 500, unexpected: true, body: {
    code: "seo_error", message: SEO_UNEXPECTED_MESSAGE,
    ...(admin ? { admin: { detail: String(err?.message ?? e).slice(0, 500), name: typeof err?.name === "string" ? err.name : null } } : {}),
  } };
}

/**
 * What to save for the customer when background work fails (a grid scan, a
 * rank run). `fallback` is used for anything that is not one of our own errors.
 */
export function publicFailure(thrown: unknown, fallback: string): string {
  const e = knownError(thrown);
  if (e instanceof SeoBudgetError) return e.message;
  if (e instanceof DataForSeoError) return e.publicMessage;
  // Its message was written for the customer here (SEO_RETRY), so it is kept — and is a known note when read back.
  if (e instanceof SeoRetryableError) return e.message;
  return fallback;
}

// ── Notes that are already saved ────────────────────────────────────────────
// seo_rank_runs.error and seo_grid_scans.error were written by earlier versions of this code, some of
// them with the error's own text. They are made safe when READ; the rows themselves are left as they are.

const REFUNDED_TAIL = " — their cost was refunded";
/** The notes this code writes for the customer, whole. Anything else is not shown as written. */
const KNOWN_NOTES: (string | RegExp)[] = [
  ...Object.values(SEO_SOURCE_PUBLIC_MESSAGES), SEO_NOT_READY_MESSAGE, BUDGET_PAUSED_MESSAGE, SEO_NOTE_FALLBACK, SEO_UNEXPECTED_MESSAGE,
  // The retryable cases above (SEO_RETRY), should background work ever save one through publicFailure.
  ...Object.values(SEO_RETRY).map((r) => r.message),
  // server/seo/jobs.ts
  "Site is gone", "No keywords to check", "Some checks were not accepted by the search data service.",
  "None of the checks were accepted by the search data service. Your credits were not charged.",
  "The check could not be started — try again in a few minutes.",
  "This month's included SEO data is used up, so the automatic weekly check was skipped. Automatic checks never spend credit you bought — press Run check now to use it.",
  // The same note since checks can run more often than weekly (server/seo/jobs.ts WEEKLY_SKIPPED_MESSAGE); the line above stays for notes saved before.
  "This month's included SEO data is used up, so the automatic check was skipped. Automatic checks never spend credit you bought — press Run check now to use it.",
  /^\d+ of \d+ checks were not accepted by the search data service$/,
  /^\d+ check\(s\) failed: [^·]{1,230} \((desktop|mobile)\)$/,
  /^\d+ check\(s\) never came back from the queue$/,
  /^The check stopped before it finished\.( The checks that never came back were refunded\.)?$/,
  "the checks that were not delivered were refunded", "their cost was refunded",
  // The customer's own credit, at the customer's price (server/seo/credits.ts outOfCreditMessage).
  /^This needs about \$\d+\.\d\d of SEO data and you have \$\d+\.\d\d left this month\. Add credit to keep going — your plan's allowance comes back on the 1st\.$/,
  // server/seo/grid.ts and the grid routes
  "The scan ran but its results could not be saved.", "The scan could not be completed. Try again in a few minutes.", "The scan could not be completed.",
  "The scan was interrupted before it finished. Lookups it had not made were not charged.",
  "The scan ran but its results could not be saved. You were not charged.",
  // server/seo/render-check.ts and its routes
  "The check was interrupted before it finished. You were not charged.", "The check ran but its results could not be saved. You were not charged.",
  "The check could not be completed. Try again in a few minutes.", "The check could not be completed.",
  // server/seo/grid-monitor.ts (repeating scans)
  "This month's included SEO data had run out, so the repeating scan was skipped.", "The repeating scan could not be completed; it will be tried again.",
  // What vendor errors read as before the wording above.
  "The search data service is busy — try again in a minute.", "That request couldn't be run — check the keyword or domain and try again.",
  "That check didn't complete — try again in a few minutes.", "The search data service didn't answer — try again in a few minutes.",
];
const isKnownNote = (s: string) => !VENDOR_NAME_RE.test(s) && KNOWN_NOTES.some((k) => (typeof k === "string" ? k === s : k.test(s)));

/**
 * A saved note, safe to show a customer. Notes are joined with " · "; each
 * part this code is known to write passes as it is, anything else — the raw
 * text of an error, whatever it says — becomes `fallback`. null stays null.
 */
export function publicNote(note: unknown, fallback = SEO_NOTE_FALLBACK): string | null {
  if (typeof note !== "string" || !note.trim()) return null;
  const parts: string[] = [];
  for (const raw of note.split(" · ")) {
    const part = raw.trim();
    if (!part) continue;
    let out: string;
    if (isKnownNote(part)) out = part;
    else if (part.endsWith(REFUNDED_TAIL)) { const head = part.slice(0, -REFUNDED_TAIL.length); out = `${isKnownNote(head) ? head : fallback}${REFUNDED_TAIL}`; }
    else out = fallback;
    if (!parts.includes(out)) parts.push(out);
  }
  return parts.length ? parts.join(" · ") : null;
}
