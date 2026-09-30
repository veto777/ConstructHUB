import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
// Same deny-private approach as CRM integrations, tightened to public unicast only.
export function publicIP(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Reject mapped, transition, local, documentation and non-global IPv6 ranges.
  return (
    isIP(ip) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(ip) &&
    !/^2002:|^2001:db8:/i.test(ip) &&
    !(
      ip.toLowerCase().startsWith("2001:") &&
      parseInt(ip.split(":")[1] || "0", 16) < 0x200
    )
  );
}
export function siteUrl(raw: string) {
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    raw.length > 2048
  )
    throw new Error(
      "Use a public HTTP or HTTPS website URL on port 80 or 443.",
    );
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (
    /^(localhost|metadata)(\.|$)|\.(local|internal|localhost)\.?$/i.test(h) ||
    (isIP(h) && !publicIP(h))
  )
    throw new Error("Private network URLs are not allowed.");
  u.hash = "";
  return u.href;
}
export type PageResponse = {
  url: string;
  status: number;
  body: string;
  bytes: number;
  headers: Record<string, string>;
  redirects: string[];
};
export type Transport = (
  url: URL,
  address: { address: string; family: number },
) => Promise<Omit<PageResponse, "url" | "redirects">>;
const transport: Transport = (url, address) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        agent: false,
        headers: {
          "User-Agent": "ConstructHUBSiteScan/1.0",
          "Accept-Encoding": "identity",
        },
        // Pin the validated address into the socket lookup. No second DNS resolution/rebinding.
        lookup: ((_host: any, options: any, cb: any) =>
          options?.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as any,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2_000_000)
            request.destroy(new Error("Response exceeded 2 MB limit"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
            bytes,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([k, v]) => [
                k,
                String(v || ""),
              ]),
            ),
          }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Request timed out")),
      10_000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
export function makeSafeFetch(
  resolve = (host: string) => lookup(host, { all: true, verbatim: true }),
  send: Transport = transport,
) {
  return async (
    raw: string,
    allowed: (url: string) => boolean = () => true,
  ): Promise<PageResponse> => {
    let url = siteUrl(raw);
    const redirects: string[] = [];
    for (let n = 0; n <= 5; n++) {
      if (!allowed(url)) throw new Error("Redirect excluded by crawl policy");
      const u = new URL(url),
        host = u.hostname.replace(/^\[|\]$/g, "");
      const addresses = await Promise.race([
        resolve(host),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error("DNS timeout")), 5000);
          t.unref();
        }),
      ]);
      if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
        throw new Error("DNS resolved to a non-public address");
      const r = await send(u, addresses[0]);
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        redirects.push(url);
        url = siteUrl(new URL(r.headers.location, url).href);
        continue;
      }
      return { ...r, url, redirects };
    }
    throw new Error("Redirect limit exceeded");
  };
}
export const safeFetch = makeSafeFetch();
