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
