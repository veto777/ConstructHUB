import {
  domainName,
  recordInput,
  type RegistrarAdapter,
  type DomainState,
  type DnsRecord,
  DomainError,
} from "../types";
export function porkbun(
  credentials: { key: string; secret: string },
  http: typeof fetch = fetch,
): RegistrarAdapter {
  const call = async (path: string, body: object = {}) => {
    // Closed endpoint set. No caller can supply an arbitrary registrar operation.
    if (
      !/^\/domain\/(listAll|(?:getNs|updateNs)\/[a-z0-9.-]+)$|^\/dns\/(retrieve\/[a-z0-9.-]+|create\/[a-z0-9.-]+|(?:edit|delete)\/[a-z0-9.-]+\/\d+)$/.test(
        path,
      )
    )
      throw new DomainError("Operation not allowed");
    try {
      const r = await http(`https://api.porkbun.com/api/json/v3${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          apikey: credentials.key,
          secretapikey: credentials.secret,
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      const d = await r.json();
      if (!r.ok || d.status !== "SUCCESS") throw new Error();
      return d;
    } catch {
      throw new DomainError(
        "Porkbun request failed. Check API access and credentials.",
        502,
      );
    }
  };
  const info = (d: any, nameservers: string[] = []) => ({
    domain: domainName.parse(d.domain),
    expires: d.expireDate || d.expire_date || null,
    autoRenew:
      d.autoRenew === undefined
        ? null
        : ["1", 1, true, "yes"].includes(d.autoRenew),
    status: d.status || null,
    nameservers,
  });
  const payload = (raw: DnsRecord) => {
    const r = recordInput.parse(raw);
    return {
      name: r.name === "@" ? "" : r.name,
      type: r.type,
      content: r.content,
      ttl: r.ttl,
      prio: r.priority,
    };
  };
  return {
    async list(cursor = "0") {
      if (!/^\d+$/.test(cursor)) throw new DomainError("Invalid cursor");
      const d = await call("/domain/listAll", { start: Number(cursor) });
      return {
        domains: d.domains.map((v: any) => info(v)),
        next: d.domains.length === 1000 ? String(Number(cursor) + 1000) : null,
      };
    },
    async read(raw) {
      const domain = domainName.parse(raw);
      const d = await call("/domain/listAll", { domain }),
        ns = await call(`/domain/getNs/${domain}`),
        dns = await call(`/dns/retrieve/${domain}`);
      if (
        !Array.isArray(d.domains) ||
        d.domains.length !== 1 ||
        d.domains[0].domain !== domain
      )
        throw new DomainError("Domain not available in this account", 404);
      return {
        ...info(
          d.domains[0],
          ns.ns.map((n: string) => n.toLowerCase().replace(/\.$/, "")),
        ),
        records: dns.records
          .filter((r: any) =>
            ["A", "AAAA", "CNAME", "TXT", "MX", "CAA"].includes(r.type),
          )
          .map((r: any) => ({
            id: String(r.id),
            name:
              r.name === domain
                ? "@"
                : r.name.replace(
                    new RegExp(`\\.${domain.replace(/\./g, "\\.")}\\.?$`),
                    "",
                  ),
            type: r.type,
            content: r.content,
            ttl: Number(r.ttl),
            priority: Number(r.prio || 0),
          })),
      } as DomainState;
    },
    async setNameservers(raw, nameservers) {
      await call(`/domain/updateNs/${domainName.parse(raw)}`, {
        ns: nameservers.map((n) => domainName.parse(n)),
      });
    },
    async createRecord(raw, r) {
      const d = await call(`/dns/create/${domainName.parse(raw)}`, payload(r));
      return { ...r, id: String(d.id) };
    },
    async updateRecord(raw, r) {
      if (!r.id || !/^\d+$/.test(r.id))
        throw new DomainError("Missing record ID");
      await call(`/dns/edit/${domainName.parse(raw)}/${r.id}`, payload(r));
    },
    async deleteRecord(raw, r) {
      recordInput.parse(r);
      if (!r.id || !/^\d+$/.test(r.id))
        throw new DomainError("Missing record ID");
      await call(`/dns/delete/${domainName.parse(raw)}/${r.id}`);
    },
  };
}
