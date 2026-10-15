/**
 * What a visitor types in a "look up any website" box, as the site name the SEO pages work with: a full address
 * ("https://www.example.com/services?x=1"), a bare host, upper case or stray spaces all become "example.com". The same
 * cleaning the server does before it stores a site, so what is shown on the
 * way to Site explorer is what will be looked up and saved. null when nothing like a site name is there.
 */
export function cleanDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try { host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname; } catch { return null; }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}
