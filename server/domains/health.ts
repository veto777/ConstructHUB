import https from "node:https";
import { lookup } from "node:dns/promises";
import { publicIP } from "../sitescan/http";
import { domainName } from "./types";
export type Health = { up: boolean | null; sslExpires: string | null };
/** Fixed HTTPS port, no redirects, validate every DNS answer and pin one into the socket. */
export async function websiteHealth(raw: string): Promise<Health> {
  const domain = domainName.parse(raw);
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(domain, { all: true });
  } catch {
    return { up: false, sslExpires: null };
  }
  if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
    return { up: null, sslExpires: null };
  return new Promise((resolve) => {
    const a = addresses[0];
    const req = https.request(
      {
        hostname: domain,
        port: 443,
        path: "/",
        method: "HEAD",
        agent: false,
        servername: domain,
        lookup: ((_h: any, o: any, cb: any) =>
          o?.all ? cb(null, [a]) : cb(null, a.address, a.family)) as any,
      },
      (res) => {
        const cert = (
          res.socket as import("node:tls").TLSSocket
        ).getPeerCertificate();
        const expires =
          cert?.valid_to && Number.isFinite(Date.parse(cert.valid_to))
            ? new Date(cert.valid_to).toISOString()
            : null;
        res.resume();
        resolve({
          up: !!res.statusCode && res.statusCode < 500,
          sslExpires: expires,
        });
      },
    );
    req.setTimeout(10000, () => req.destroy());
    req.on("error", () => resolve({ up: false, sslExpires: null }));
    req.end();
  });
}
