import { domainName, canonical, type Change, type DomainState } from "./types";
const numbers: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
};
export async function doh(
  name: string,
  type: string,
  http: typeof fetch = fetch,
): Promise<string[]> {
  if (!/^[a-zA-Z0-9_*.-]+$/.test(name) || name.length > 253 || !numbers[type])
    throw new Error("Invalid DNS query");
  const r = await http(
    `https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name, type })}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  if (!r.ok) throw new Error("DNS resolver unavailable");
  const d = await r.json();
  if (![0, 3].includes(d.Status)) throw new Error("DNS lookup failed");
  return (d.Answer || [])
    .filter((a: any) => a.type === numbers[type])
    .map((a: any) => normalize(type, a.data))
    .sort();
}
export function normalize(type: string, value: string) {
  if (type === "AAAA") {
    try {
      return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    } catch {
      return value;
    }
  }
  return type === "TXT"
    ? value.replace(/^"|"$/g, "").replace(/"\s+"/g, "")
    : ["NS", "CNAME", "MX"].includes(type)
      ? value.toLowerCase().replace(/\.$/, "")
      : value;
}
export async function verify(
  domain: string,
  change: Change,
  after: DomainState,
  http: typeof fetch = fetch,
) {
  if (change.kind === "nameservers")
    return (
      canonical(await doh(domain, "NS", http)) ===
      canonical(change.nameservers.map((n) => normalize("NS", n)))
    );
  const r = change.record,
    name = r.name === "@" ? domain : `${r.name}.${domain}`,
    observed = await doh(name, r.type, http);
  const expected = after.records
    .filter((x) => x.name === r.name && x.type === r.type)
    .map((x) =>
      normalize(
        x.type,
        x.type === "MX" ? `${x.priority} ${x.content}` : x.content,
      ),
    )
    .sort();
  return canonical(observed) === canonical(expected);
}
export async function dnsSnapshot(
  domain: string,
  state: DomainState | null,
  http: typeof fetch = fetch,
) {
  domainName.parse(domain);
  const questions = new Map<string, { name: string; type: string }>();
  for (const type of Object.keys(numbers))
    questions.set(`${domain}:${type}`, { name: domain, type });
  for (const r of state?.records || []) {
    const name = r.name === "@" ? domain : `${r.name}.${domain}`;
    questions.set(`${name}:${r.type}`, { name, type: r.type });
  }
  // Worker handles one bounded zone; no wildcard enumeration or claim of complete DNS discovery.
  if (questions.size > 200)
    throw new Error(
      "DNS monitoring supports up to 200 name/type pairs per domain",
    );
  const result: Record<string, string[]> = {};
  for (const [key, q] of questions)
    result[key] = await doh(q.name, q.type, http);
  return result;
}
