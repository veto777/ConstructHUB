/**
 * Washington: the exact location code for a street address, from WA DOR's free
 * public tax-rate lookup URL interface (webgis.dor.wa.gov/webapi/AddressRates.aspx,
 * the service behind dor.wa.gov's "Tax rate lookup" tool).
 *
 * Why: a mailing city is not the tax jurisdiction. 4783 Bayshore Dr, Blaine 98230
 * has a Blaine mailing address but lies in unincorporated Whatcom County inside
 * the Whatcom PTBA (location 3737, 8.9%), not the City of Blaine (3702, 9.1%).
 * WA charges construction sales tax at the job site, so for a WA address with a
 * street line the resolver asks DOR first and falls back to the city name.
 *
 * Result codes (DOR's documentation): 0 address found · 1 address not found but
 * the ZIP+4 was · 2 address corrected and found · 3 address corrected, ZIP+4
 * found · 4 address corrected and found (ZIP-level fix) · 5 only the ZIP found ·
 * 6 nothing found · 9 error. Codes 0–4 place the address; 5+ are ignored (a
 * 5-digit ZIP can span several jurisdictions).
 *
 * One GET per distinct address, cached for a day in memory; 4 s timeout; any
 * failure → null and the city lookup runs. WA_DOR_ADDRESS_LOOKUP=off disables it.
 */
const ENDPOINT = "https://webgis.dor.wa.gov/webapi/AddressRates.aspx";
const TTL_MS = 24 * 60 * 60 * 1000;

export type WaAddressLocation = {
  locationCode: string;
  /** Combined rate as DOR returns it, in percent (8.9). */
  ratePct: number;
  /** "Q42026" → "Q4 2026", when DOR returns a period. */
  periodLabel: string | null;
  resultCode: number;
};

/** Parse DOR's XML answer (pure; tested). */
export function parseWaAddressXml(xml: string): WaAddressLocation | null {
  const resp = xml.match(/<response\b([^>]*)>/i)?.[1] ?? xml.match(/<response\b([^>]*)\/>/i)?.[1];
  if (!resp) return null;
  const attr = (s: string, name: string) => s.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? null;
  const code = Number(attr(resp, "code"));
  const loc = attr(resp, "loccode");
  const rate = Number(attr(resp, "rate"));
  if (!Number.isInteger(code) || code > 4 || !loc || !/^\d{4}$/.test(loc) || !Number.isFinite(rate) || rate <= 0) return null;
  const period = xml.match(/\bperiod="Q([1-4])(\d{4})"/i);
  return {
    locationCode: loc,
    ratePct: Math.round(rate * 100 * 10_000) / 10_000,
    periodLabel: period ? `Q${period[1]} ${period[2]}` : null,
    resultCode: code,
  };
}

const cache = new Map<string, { at: number; value: WaAddressLocation | null }>();

export async function lookupWaAddress(
  addr: { addressLine1: string; city?: string | null; zip?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<WaAddressLocation | null> {
  if (process.env.WA_DOR_ADDRESS_LOOKUP === "off") return null;
  const line = addr.addressLine1.trim();
  const zip = (addr.zip ?? "").match(/\d{5}/)?.[0] ?? "";
  if (!line || (!zip && !addr.city)) return null;
  const key = `${line}|${addr.city ?? ""}|${zip}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const qs = new URLSearchParams({ output: "xml", addr: line, city: addr.city?.trim() ?? "", zip });
  let value: WaAddressLocation | null = null;
  try {
    const res = await fetchImpl(`${ENDPOINT}?${qs}`, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null; // not cached: try again next time
    value = parseWaAddressXml(await res.text());
  } catch {
    return null;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function clearWaAddressCache(): void {
  cache.clear();
}
