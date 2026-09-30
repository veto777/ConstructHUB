import { BlockList, isIP } from "net";
import { normalizeBlockedIp } from "./route-guards";

// The IP list served to the owner's Google Ads Script (GET /api/click-guard/exclusion-list/:trackingId).
// It applies the Click Guard settings the owner saved: the manual exclusions are added,
// whitelisted IPs are removed, and the list is capped at the chosen length.

export const EXCLUSION_LIST_MAX = 500; // Google Ads allows 500 IP exclusions per campaign.
const EXCLUSION_LIST_MIN = 50;

/** One entry per line (commas also accepted, as in the settings form); invalid entries are skipped. */
export function parseIpEntries(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(/[\n,]+/)
    .map(s => normalizeBlockedIp(s))
    .filter((ip): ip is string => !!ip);
}

/** clamp(settings.exclusionListRate, 50, 500); 500 when it was never set. */
export function exclusionListCap(rate: unknown): number {
  const n = typeof rate === "number" ? rate : typeof rate === "string" && rate.trim() ? Number(rate) : NaN;
  if (!Number.isFinite(n)) return EXCLUSION_LIST_MAX;
  return Math.min(EXCLUSION_LIST_MAX, Math.max(EXCLUSION_LIST_MIN, Math.floor(n)));
}

function whitelistMatcher(entries: string[]): (ip: string) => boolean {
  const exact = new Set(entries);
  const covered = new BlockList();
  for (const entry of entries) {
    const family = isIP(entry);
    if (family) { covered.addAddress(entry, family === 6 ? "ipv6" : "ipv4"); continue; }
    const wildcard = entry.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\*$/);
    if (wildcard) { covered.addSubnet(`${wildcard[1]}.0`, 24, "ipv4"); continue; }
    const cidr = entry.match(/^([^/]+)\/(\d{1,3})$/);
    const cidrFamily = cidr ? isIP(cidr[1]) : 0;
    if (cidr && cidrFamily) covered.addSubnet(cidr[1], Number(cidr[2]), cidrFamily === 6 ? "ipv6" : "ipv4");
  }
  // A single IP is dropped when any whitelist entry covers it. A range is dropped only when
  // the same range is whitelisted: it cannot be split to carve out one address.
  return (ip) => {
    if (exact.has(ip)) return true;
    const family = isIP(ip);
    return family ? covered.check(ip, family === 6 ? "ipv6" : "ipv4") : false;
  };
}

export function buildExclusionList(blockedIps: string[], settings: Record<string, unknown> | null | undefined): string[] {
  const s = settings || {};
  const whitelisted = whitelistMatcher(parseIpEntries(s.whitelistIps));
  const cap = exclusionListCap(s.exclusionListRate);
  const out = new Set<string>();
  // The owner's manual exclusions come first, then automatic/manual blocks (newest first).
  for (const ip of [...parseIpEntries(s.manualExcludeIps), ...blockedIps.map(v => normalizeBlockedIp(v)).filter((v): v is string => !!v)]) {
    if (out.size >= cap) break;
    if (!whitelisted(ip)) out.add(ip);
  }
  return [...out];
}
