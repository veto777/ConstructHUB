/** The native shells append one of these versioned tokens to their user agent. */
export const fromNativeApp = (req: { headers?: Record<string, unknown> }): boolean =>
  /\bConstructHUB(App|CRM)\/\d/.test(String(req.headers?.["user-agent"] ?? ""));

/**
 * Open-redirect guard for post-auth `next` destinations. Only a plain
 * same-origin path survives: exactly one leading `/` (never `//host`), no
 * backslash anywhere (browsers resolve `/\host` as `//host`), no control
 * chars or whitespace. Anything else returns null and the caller falls back
 * to the default destination.
 */
export function safeNextPath(next: string | undefined | null): string | null {
  if (!next || typeof next !== "string" || next.length > 2048) return null;
  if (/[\x00-\x20\x7f\\]/.test(next)) return null;
  if (next[0] !== "/" || next[1] === "/") return null;
  const url = new URL(next, "http://local");
  if (url.origin !== "http://local" || !url.pathname.startsWith("/")) return null;
  return next;
}

