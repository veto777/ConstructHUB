/**
 * What a saved-copy check (`peek`) answered when it had nothing fresh to show — pure, so the server tests can read it.
 * The server answers 404 either way (shell.tsx `isNotRunYet`); when a copy older than the window exists it adds
 * `code: "expired"` and `lastAt`, so the page says "last run <date>" rather than "not run yet" (server/seo/routes.ts
 * `notSaved`). Anything else — never run, or an answer that says nothing of the kind — is null.
 */
export const lastRunAt = (e: unknown): string | null => {
  const m = /^404: (\{[\s\S]*\})$/.exec(String((e as { message?: unknown } | null)?.message ?? ""));
  if (!m) return null;
  try {
    const body = JSON.parse(m[1]) as { code?: unknown; lastAt?: unknown };
    return body.code === "expired" && typeof body.lastAt === "string" && !Number.isNaN(Date.parse(body.lastAt)) ? body.lastAt : null;
  } catch { return null; }
};
