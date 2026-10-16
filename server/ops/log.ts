/**
 * Journal-safe error logging. `console.error(label, err)` prints the whole
 * error object: for a Postgres error that is `detail` ("Failing row contains
 * (12, Jane Doe, jane@x.com, …)"), for a nodemailer error the rejected
 * addresses and the server's text, for a body-parser error the raw request
 * body (a login form, an API key). This prints the scrubbed facts instead
 * (name, message, code, status, trimmed stack — scrub.ts errorFacts), on one
 * line, and never the body.
 */
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
