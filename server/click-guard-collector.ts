// Bounds for the public Click Guard collector (POST /api/click-guard/track). The tracking id is in every
// customer's page source, so anyone can post here: every stored field is a short string and each visitor IP
// gets a fixed window of beacons. A real page view is one small beacon (server/tracking-script.ts).

/** JSON body cap for the collector, mounted in server/index.ts before the catch-all parser. */
export const CLICK_TRACK_BODY_LIMIT = "16kb";

export const CLICK_TRACK_FIELD_MAX = {
  trackingId: 100, fingerprint: 100, deviceType: 40, browser: 40, os: 40, screenResolution: 40,
  language: 40, timezone: 80, referrer: 2000, landingPage: 2000, userAgent: 512,
} as const;
export type ClickTrackField = keyof typeof CLICK_TRACK_FIELD_MAX;

/** A beacon field as stored: a trimmed string cut to its cap, or null when absent, empty or not text. */
export function trackField(value: unknown, field: ClickTrackField): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim().slice(0, CLICK_TRACK_FIELD_MAX[field]);
  return s || null;
}

// Fixed-window in-memory buckets (the process-local idiom of server/crm/client-auth.ts).
const WINDOW_MS = 10 * 60 * 1000;
export const CLICK_TRACK_IP_LIMIT = 120;
const MAX_KEYS = 20_000;
const buckets = new Map<string, { start: number; count: number }>();

/** True while this key (a visitor IP) is within its beacons for the current window. */
export function allowClickTrack(key: string, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    if (buckets.size >= MAX_KEYS) {
      buckets.forEach((v, k) => { if (now - v.start >= WINDOW_MS) buckets.delete(k); });
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (b.count >= CLICK_TRACK_IP_LIMIT) return false;
  b.count++;
  return true;
}
