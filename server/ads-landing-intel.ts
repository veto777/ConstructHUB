/** Ads door network intelligence. Failures keep the last good ranges; online
 * lookups enrich the hit after the response when the 1.5 second budget expires. */
import { BlockList, isIP } from "node:net";
import { pool } from "./db";

export type PrivacyIntel = { proxy: boolean; vpn: boolean; tor: boolean; hosting: boolean; asn?: number | null };
export type RangeHit = "datacenter" | "vpn" | null;
const warned = new Set<string>();
function warn(key: string) {
  if (!warned.has(key)) { warned.add(key); console.warn(`[ads-lp] ${key}; keeping previous intelligence`); }
}

/** Node's native matcher handles compressed IPv6 and IPv4-mapped addresses. */
export function cidrMatcher(lines: readonly string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const line of lines) {
    const [address, prefix, extra] = line.trim().split("/");
    const family = isIP(address);
    if (!family || extra !== undefined || !/^\d+$/.test(prefix || "")) continue;
    const bits = Number(prefix);
    if (bits > (family === 4 ? 32 : 128)) continue;
    list.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return (ip) => {
    const family = isIP(ip);
    return !!family && list.check(ip, family === 4 ? "ipv4" : "ipv6");
  };
}
const feeds = ["datacenter", "vpn"].flatMap(kind => [4, 6].map(version => ({
  kind: kind as Exclude<RangeHit, null>,
  url: `https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/${kind}/ipv${version}.txt`,
  matches: (_ip: string): boolean => false,
})));
export function rangeHit(ip: string): RangeHit {
  return feeds.find(feed => feed.matches(ip))?.kind ?? null;
}
export async function refreshRanges(): Promise<void> {
  await Promise.all(feeds.map(async feed => {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error("feed unavailable");
      const lines = (await res.text()).split(/\r?\n/).map(line => line.trim()).filter(line => {
        const [ip, prefix, extra] = line.split('/');
        const family = isIP(ip);
        return family && extra === undefined && /^\d+$/.test(prefix || '') && Number(prefix) <= (family === 4 ? 32 : 128);
      });
      if (!lines.length) throw new Error("empty feed");
      feed.matches = cidrMatcher(lines);
    } catch { warn(feed.url); }
  }));
}

let schema: Promise<unknown> | undefined;
function ensureSchema() {
  return schema ??= pool.query(`CREATE TABLE IF NOT EXISTS ip_intel_cache (
    ip text PRIMARY KEY, intel jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now()
  )`).catch(e => { schema = undefined; throw e; });
}
const pending = new Map<string, Promise<PrivacyIntel | null>>();
async function lookup(ip: string): Promise<PrivacyIntel | null> {
  try {
    await ensureSchema();
    const { rows } = await pool.query("SELECT intel FROM ip_intel_cache WHERE ip=$1 AND fetched_at > now()-interval '30 days'", [ip]);
    if (rows[0]) return rows[0].intel;
  } catch { warn("intel cache unavailable"); }
  const intel: PrivacyIntel = { proxy: false, vpn: false, tor: false, hosting: false, asn: null };
  let received = false;
  await Promise.all([
    (async () => {
      try {
        const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error("ipinfo unavailable");
        const data = await res.json();
        if (data.error || !data.ip) throw new Error("invalid ipinfo response");
        const asn = /^AS(\d+)\b/.exec(String(data.org || ""));
        if (asn) intel.asn = Number(asn[1]);
        for (const key of ["proxy", "vpn", "tor", "hosting"] as const) intel[key] ||= data.privacy?.[key] === true;
        received = true;
      } catch { warn("ipinfo unavailable"); }
    })(),
    (async () => {
      const key = process.env.IPQS_API_KEY;
      if (!key) return;
      try {
        const res = await fetch(`https://ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error("IPQS unavailable");
        const data = await res.json();
        if (data.success !== true) throw new Error("invalid IPQS response");
        for (const flag of ["proxy", "vpn", "tor"] as const) intel[flag] ||= data[flag] === true;
        intel.hosting ||= data.bot_status === true || Number(data.fraud_score) >= 85;
        if (intel.asn == null && Number.isSafeInteger(Number(data.ASN)) && Number(data.ASN) > 0) intel.asn = Number(data.ASN);
        received = true;
      } catch { warn("IPQS unavailable"); }
    })(),
  ]);
  if (!received) return null;
  try {
    await ensureSchema();
    await pool.query(`INSERT INTO ip_intel_cache(ip,intel) VALUES($1,$2)
      ON CONFLICT(ip) DO UPDATE SET intel=excluded.intel,fetched_at=now()`, [ip, JSON.stringify(intel)]);
  } catch { warn("intel cache unavailable"); }
  return intel;
}
export function lookupIntel(ip: string): Promise<PrivacyIntel | null> {
  if (!isIP(ip)) return Promise.resolve(null);
  const existing = pending.get(ip);
  if (existing) return existing;
  const work = lookup(ip).catch(() => null).finally(() => pending.delete(ip));
  pending.set(ip, work);
  return work;
}
export async function boundedIntel(work: Promise<PrivacyIntel | null>, ms = 1500): Promise<PrivacyIntel | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}

let banned = new Set<string>();
const recentBans = new Map<string, number>();
export function banIp(ip: string): void { recentBans.set(ip, Date.now()); banned.add(ip); }
export function isLandingBanned(ip: string): boolean { return banned.has(ip); }
export async function refreshBans(): Promise<void> {
  try {
    const { rows } = await pool.query(`SELECT DISTINCT ip FROM ads_lp_hits WHERE at > now()-interval '60 days'
      AND (action='block' OR reason IN ('proxy_network','hosting_network')) AND ip IS NOT NULL`);
    const next = new Set<string>(rows.map(row => row.ip));
    for (const [ip, at] of recentBans) {
      if (Date.now() - at < 10 * 60e3) next.add(ip); else recentBans.delete(ip);
    }
    banned = next;
  } catch { warn("landing bans unavailable"); }
}
let started = false;
export function startAdsIntel(): void {
  if (started) return;
  started = true;
  void refreshRanges(); void refreshBans();
  setInterval(() => void refreshRanges(), 12 * 3600e3).unref();
  setInterval(() => void refreshBans(), 10 * 60e3).unref();
}
