/**
 * VPN Shield's response mode for one tracked site (tracked_domains.settings.vpnBlockMode).
 *
 * Log-first (reviewers, 2026-10-11): a site that has never saved a mode LOGS flagged visitors and
 * blocks nobody. The Settings tab says so ("Blocking is ON after you save"), the marketing says so,
 * and the server has to agree — a site added through IP Tracker's "Add site" carries no VPN
 * settings at all, and until this change the detection endpoint blocked its VPN visitors anyway.
 *
 * Used by the tracking endpoint (what happens to a flagged visitor) and by the settings POST (a save
 * that leaves the mode out keeps the saved mode instead of silently switching the site to Block).
 */
export const VPN_MODES = ["block", "log", "redirect"] as const;
export type VpnMode = (typeof VPN_MODES)[number];

/** What an unconfigured site does: records the detection, blocks nobody. */
export const VPN_DEFAULT_MODE: VpnMode = "log";

/** The mode the owner saved, or null when the site has never saved one (or the value is not a mode). */
export function savedVpnMode(settings: unknown): VpnMode | null {
  const mode = settings && typeof settings === "object" ? (settings as Record<string, unknown>).vpnBlockMode : undefined;
  return typeof mode === "string" && (VPN_MODES as readonly string[]).includes(mode) ? (mode as VpnMode) : null;
}

/** The mode the server enforces on a detection: the saved one, else Log only. */
export function effectiveVpnMode(settings: unknown): VpnMode {
  return savedVpnMode(settings) ?? VPN_DEFAULT_MODE;
}

/**
 * Bounds for the public tracking endpoint (POST /api/vpn-shield/track, audit 08 #1). The endpoint is
 * anonymous and firewall-exempt, so every caller-supplied string is cut to a fixed length before it is
 * stored and the calls are counted per visitor address and per site. A real page view sends a few
 * hundred bytes once per load; nothing below changes what the tracking script's payload stores.
 */
export const VPN_TRACK_BODY_LIMIT = "16kb";
export const VPN_TRACK_ID_MAX = 64;
const VPN_TRACK_FIELD_MAX = { fingerprint: 64, deviceType: 40, browser: 40, os: 40, referrer: 2000, landingPage: 2000, userAgent: 500 } as const;
export type VpnTrackFields = { [K in keyof typeof VPN_TRACK_FIELD_MAX]: string | null };

/** The optional text fields of a tracking body: a non-empty string cut to its cap, anything else null. */
export function vpnTrackFields(body: unknown): VpnTrackFields {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out = {} as VpnTrackFields;
  for (const key of Object.keys(VPN_TRACK_FIELD_MAX) as (keyof typeof VPN_TRACK_FIELD_MAX)[]) {
    const v = src[key];
    out[key] = typeof v === "string" && v ? v.slice(0, VPN_TRACK_FIELD_MAX[key]) : null;
  }
  return out;
}

/** In-memory fixed window, the same shape as the issue desk's intake limiter (server/ops/client-errors.ts). */
export function vpnTrackLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return {
    allow(key: string, now: number): boolean {
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + windowMs }); return true; }
      if (cur.n >= max) return false;
      cur.n++;
      return true;
    },
  };
}
