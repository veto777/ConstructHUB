/** One query-string value from the current address, or null when absent. */
export function readQueryParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** A positive whole number from the query string (page numbers, ids); null otherwise. */
export function readQueryInt(key: string): number | null {
  const raw = readQueryParam(key);
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/**
 * Mirror filter state into the address bar so a refresh or shared link reopens the
 * same view. Replaces the current history entry (no Back-button spam). Pass null,
 * undefined or "" for a default value to drop that key; other keys are left alone.
 */
export function replaceQueryParams(values: Record<string, string | number | null | undefined>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  if (url.search !== window.location.search) {
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}
