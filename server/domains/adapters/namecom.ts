import {
  domainName,
  recordInput,
  type RegistrarAdapter,
  type DnsRecord,
  DomainError,
} from "../types";
/** Official CORE v1 adapter. Credentials are username + API token, never account password. */
export function namecom(
  credentials: { key: string; secret: string },
  http: typeof fetch = fetch,
): RegistrarAdapter {
  const call = async (method: string, path: string, body?: object) => {
    const allowed =
      (method === "GET" &&
        /^\/core\/v1\/domains(?:\?page=\d+&perPage=100|\/[a-z0-9.-]+(?:\/records\?page=\d+&perPage=100)?)$/.test(
          path,
        )) ||
      (method === "POST" &&
        /^\/core\/v1\/domains\/[a-z0-9.-]+(?::setNameservers|\/records)$/.test(
          path,
        )) ||
      (["PUT", "DELETE"].includes(method) &&
        /^\/core\/v1\/domains\/[a-z0-9.-]+\/records\/\d+$/.test(path));
    if (!allowed) throw new DomainError("Operation not allowed");
    try {
      const r = await http(`https://api.name.com${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error();
      return r.status === 204 ? {} : await r.json();
    } catch {
      throw new DomainError(
        "Name.com request failed. Check API access and credentials.",
        502,
      );
    }
  };
  const info = (d: any) => ({
    domain: domainName.parse(d.domainName),
    expires: d.expireDate || null,
    autoRenew:
      typeof d.autorenewEnabled === "boolean" ? d.autorenewEnabled : null,
    status: d.status || null,
    nameservers: (d.nameservers || []).map((n: string) =>
      n.toLowerCase().replace(/\.$/, ""),
    ),
  });
  const payload = (raw: DnsRecord) => {
    const r = recordInput.parse(raw);
    return {
      host: r.name === "@" ? "" : r.name,
      type: r.type,
      answer: r.content,
      ttl: r.ttl,
      priority: r.priority,
    };
  };
  return {
    async list(cursor = "1") {
      if (!/^\d+$/.test(cursor)) throw new DomainError("Invalid cursor");
      const d = await call(
        "GET",
        `/core/v1/domains?page=${cursor}&perPage=100`,
      );
      return {
        domains: (d.domains || []).map(info),
        next: d.nextPage ? String(d.nextPage) : null,
      };
    },
    async read(raw) {
      const domain = domainName.parse(raw),
        d = await call("GET", `/core/v1/domains/${domain}`);
      let page = 1;
      const records: DnsRecord[] = [];
      do {
        const r = await call(
          "GET",
          `/core/v1/domains/${domain}/records?page=${page}&perPage=100`,
        );
        records.push(
          ...(r.records || [])
            .filter((x: any) =>
              ["A", "AAAA", "CNAME", "TXT", "MX", "CAA"].includes(x.type),
            )
            .map((r: any) => ({
              id: String(r.id),
              name: r.host || "@",
              type: r.type,
              content: r.answer,
              ttl: r.ttl,
              priority: r.priority || 0,
            })),
        );
        if (!r.nextPage) break;
        if (r.nextPage <= page || page >= 100)
          throw new DomainError("DNS zone pagination limit", 502);
        page = r.nextPage;
      } while (true);
      return { ...info(d), records };
    },
    async setNameservers(raw, ns) {
      await call(
        "POST",
        `/core/v1/domains/${domainName.parse(raw)}:setNameservers`,
        { nameservers: ns.map((n) => domainName.parse(n)) },
      );
    },
    async createRecord(raw, r) {
      const d = await call(
        "POST",
        `/core/v1/domains/${domainName.parse(raw)}/records`,
        payload(r),
      );
      return { ...r, id: String(d.id) };
    },
    async updateRecord(raw, r) {
      if (!r.id || !/^\d+$/.test(r.id))
        throw new DomainError("Missing record ID");
      await call(
        "PUT",
        `/core/v1/domains/${domainName.parse(raw)}/records/${r.id}`,
        payload(r),
      );
    },
    async deleteRecord(raw, r) {
      recordInput.parse(r);
      if (!r.id || !/^\d+$/.test(r.id))
        throw new DomainError("Missing record ID");
      await call(
        "DELETE",
        `/core/v1/domains/${domainName.parse(raw)}/records/${r.id}`,
      );
    },
  };
}
