/**
 * Journal-safe error logging. `console.error(label, err)` prints the whole
 * error object: for a Postgres error that is `detail` ("Failing row contains
 * (12, Jane Doe, jane@x.com, …)"), for a nodemailer error the rejected
 * addresses and the server's text, for a body-parser error the raw request
 * body (a login form, an API key). This prints the scrubbed facts instead
 * (name, message, code, status, trimmed stack — scrub.ts errorFacts), on one
 * line, and never the body.
 */
import type { Response } from "express";
import { errorFacts } from "./scrub";

/** A body-parser error: `type` is "entity.parse.failed", "entity.too.large", … and `body` is the raw request. */
export function isBodyParserError(err: unknown): boolean {
  const type = (err as { type?: unknown } | null)?.type;
  return typeof type === "string" && type.startsWith("entity.");
}

/**
 * What the journal may see of an error. A body-parser error is reduced to its
 * type, status and length — its message quotes the body and its `body` field
 * is the body; everything else goes through errorFacts.
 */
export function errorLogFacts(err: unknown): Record<string, unknown> {
  if (isBodyParserError(err)) {
    const e = err as { type: string; status?: unknown; statusCode?: unknown; length?: unknown };
    const status = e.status ?? e.statusCode;
    return {
      type: e.type,
      status: typeof status === "number" ? status : undefined,
      length: typeof e.length === "number" ? e.length : undefined,
    };
  }
  return errorFacts(err);
}

/** `logError("Create contract failed:", err)` — the label plus the scrubbed facts as one JSON line. */
export function logError(label: string, err: unknown): void {
  let line: string;
  try { line = JSON.stringify(errorLogFacts(err)); } catch { line = '{"thrown":"[unreadable error]"}'; }
  console.error(label, line);
}

/** What a route answers for an error it did not expect. Never the error's own text. */
export const GENERIC_500_MESSAGE = "Something went wrong. Try again.";

/** Says whether an error's `message` was written for the person reading the page (our own typed errors). */
export type SafeErrorTest = (err: unknown) => boolean;

/** Trusts instances of the given error classes — e.g. `safeErrorClasses(GoogleError)` — and nothing else. */
export function safeErrorClasses(...classes: Array<abstract new (...args: any[]) => Error>): SafeErrorTest {
  return (err) => classes.some((c) => err instanceof c);
}

/**
 * Trusts an Error our own code tagged with a 4xx `status`
 * (`throw Object.assign(new Error("Campaign not found"), { status: 404 })`).
 * Use it only where the try block cannot reach a third-party error that also carries a `status`. A body-parser
 * error (4xx, its message quotes the request body) is never trusted.
 */
export const hasClientStatus: SafeErrorTest = (err) => {
  const status = (err as { status?: unknown } | null)?.status;
  return err instanceof Error && !isBodyParserError(err) && typeof status === "number" && status >= 400 && status < 500;
};

/**
 * The catch-all answer of a route: `catch (err) { fail500(res, "Create folder failed:", err); }`.
 * An error `isSafe` vouches for is answered with its own message (and its own 4xx/5xx `status`, else 500) and
 * not logged — it is an expected outcome. Anything else is logged through logError and answered with
 * GENERIC_500_MESSAGE, so a Postgres `detail`, a vendor's response text or a stack never reaches the page.
 */
export function fail500(res: Response, label: string, err: unknown, isSafe?: SafeErrorTest): void {
  let safe = false;
  try { safe = !!isSafe?.(err) && err instanceof Error && typeof err.message === "string" && err.message.length > 0; } catch { safe = false; }
  if (safe) {
    const status = (err as { status?: unknown }).status;
    if (!res.headersSent) res.status(typeof status === "number" && status >= 400 && status <= 599 ? status : 500).json({ message: (err as Error).message });
    return;
  }
  logError(label, err);
  if (!res.headersSent) res.status(500).json({ message: GENERIC_500_MESSAGE });
}
