/**
 * What the homeowner client portal renders, decided in one place so a
 * contractor's "See what the client sees" preview can never end on a page
 * that explains nothing.
 *
 *   previewParam — the URL carries ?preview=expired: the server refused the
 *                  preview grant (expired, re-opened, minted elsewhere).
 *   wasPreview   — this tab was showing a contractor preview a moment ago
 *                  (the 15-minute preview session has since run out).
 */
export type ClientPortalView = "loading" | "dashboard" | "sign-in" | "preview-ended" | "error";

export function clientPortalView(s: {
  loading: boolean;
  /** HTTP status of the failed documents request, if it failed. */
  errorStatus: number | null;
  previewParam: boolean;
  wasPreview: boolean;
}): ClientPortalView {
  // A refused grant wins over everything — even a still-valid session in the
  // same browser (an earlier preview of ANOTHER client, or the contractor's
  // own homeowner login) must not be shown as if it were the one asked for.
  if (s.previewParam) return "preview-ended";
  if (s.loading) return "loading";
  if (s.errorStatus === 401) return s.wasPreview ? "preview-ended" : "sign-in";
  if (s.errorStatus !== null) return "error";
  return "dashboard";
}

/** "401: Sign in required" → 401 (lib/queryClient throws `${status}: ${text}`). */
export function errorStatusOf(error: unknown): number | null {
  if (!error) return null;
  const m = /^(\d{3})\b/.exec(String((error as any)?.message ?? error));
  return m ? Number(m[1]) : 0;
}
