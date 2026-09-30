import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { porkbun } from "./adapters/porkbun";
import { namecom } from "./adapters/namecom";
import { changeInput, desired, canonical, type DomainState } from "./types";
import { verify, doh } from "./dns";
const record = {
  name: "@",
  type: "A" as const,
  content: "203.0.113.10",
  ttl: 600,
  priority: 0,
};
const state: DomainState = {
  domain: "example.test",
  expires: null,
  autoRenew: null,
  status: null,
  nameservers: ["ns1.example.test", "ns2.example.test"],
  records: [],
};
describe("registrar capability boundary", () => {
  it("contains no forbidden provider endpoints", () => {
    for (const file of readdirSync(new URL("./adapters/", import.meta.url))) {
      const source = readFileSync(
        new URL(`./adapters/${file}`, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(
        /(?:\/|:)(?:transfer\w*|getAuthCode\w*|authCode|epp|unlock\w*|lock\w*|setContacts|contacts|purchase\w*|renew\w*|updateAutoRenew|billing|privacy\w*|createDomain|deleteDomain)(?:[\/`'"{\s]|$)/i,
      );
      expect(source).not.toMatch(
        /method\s*:\s*['"]DELETE['"][\s\S]*\/domain\//,
      );
    }
  });
  it("exposes only the allowlisted methods and builds explicit credential-safe Porkbun payloads", async () => {
    const http = vi.fn(
      async () => new Response(JSON.stringify({ status: "SUCCESS", id: "42" })),
    );
    const a = porkbun({ key: "SECRET_KEY", secret: "SECRET_TOKEN" }, http);
    expect(Object.keys(a).sort()).toEqual(
      [
        "list",
        "read",
        "setNameservers",
        "createRecord",
        "updateRecord",
        "deleteRecord",
      ].sort(),
    );
    await a.createRecord("example.test", record);
    expect(http.mock.calls[0][0]).toBe(
      "https://api.porkbun.com/api/json/v3/dns/create/example.test",
    );
    expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({
      name: "",
      type: "A",
      content: record.content,
      ttl: 600,
      prio: 0,
      apikey: "SECRET_KEY",
      secretapikey: "SECRET_TOKEN",
    });
    await expect(a.createRecord("../transfer", record)).rejects.toThrow();
    await expect(
      a.updateRecord("example.test", { ...record, id: "../../unlock" }),
    ).rejects.toThrow();
    await expect(
      a.createRecord("example.test", { ...record, type: "NS" } as any),
    ).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("uses current Name.com CORE colon RPC and never echoes upstream secrets", async () => {
    const http = vi.fn(async () => new Response("{}"));
    const a = namecom({ key: "user", secret: "token" }, http);
    await a.setNameservers("example.test", state.nameservers);
    expect(http.mock.calls[0][0]).toBe(
      "https://api.name.com/core/v1/domains/example.test:setNameservers",
    );
    expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({
      nameservers: state.nameservers,
    });
    const bad = porkbun(
      { key: "secret", secret: "never-log" },
      async () =>
        new Response('{"status":"ERROR","message":"secret never-log"}', {
          status: 403,
        }),
    );
    await expect(bad.list()).rejects.toThrow("Porkbun request failed");
    await expect(bad.list()).rejects.not.toThrow("never-log");
  });
  it("validates all six record types, rejects side effects and Cloudflare DNS edits", () => {
    for (const type of ["A", "AAAA", "CNAME", "TXT", "MX", "CAA"]) {
      const content = (
        {
          A: "192.0.2.1",
          AAAA: "2001:db8::1",
          CNAME: "target.example.test",
          TXT: "v=spf1 -all",
          MX: "mail.example.test",
          CAA: '0 issue "letsencrypt.org"',
        } as any
      )[type];
      expect(
        changeInput.safeParse({
          kind: "create",
          record: { ...record, type, content },
        }).success,
      ).toBe(true);
    }
    expect(
      changeInput.safeParse({
        kind: "nameservers",
        nameservers: state.nameservers,
        locked: false,
      }).success,
    ).toBe(false);
    expect(() =>
      desired(
        { ...state, nameservers: ["a.ns.cloudflare.com"] },
        { kind: "create", record },
      ),
    ).toThrow("Cloudflare");
    expect(canonical(["a", "b"])).toBe(canonical(["b", "a"]));
  });
  it("verifies public DNS without reporting propagation as success", async () => {
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [
              { type: 2, data: "NS2.EXAMPLE.TEST." },
              { type: 2, data: "ns1.example.test." },
            ],
          }),
        ),
    );
    expect(
      await verify(
        "example.test",
        { kind: "nameservers", nameservers: state.nameservers },
        state,
        http,
      ),
    ).toBe(true);
    expect(
      await verify(
        "example.test",
        {
          kind: "nameservers",
          nameservers: ["a.example.test", "b.example.test"],
        },
        state,
        http,
      ),
    ).toBe(false);
    await expect(
      doh("example.test", "A", async () => new Response('{"Status":2}')),
    ).rejects.toThrow();
  });
});

it("reads Porkbun metadata with the documented exact-domain list filter and pages Name.com CORE records", async () => {
  const porkHttp = vi.fn(async (raw: any, init: any) => {
    const p = new URL(raw).pathname;
    if (p.endsWith("/domain/listAll")) {
      expect(JSON.parse(init.body).domain).toBe("example.test");
      return Response.json({
        status: "SUCCESS",
        domains: [
          { domain: "example.test", expireDate: "2027-01-01", autoRenew: 1 },
        ],
      });
    }
    if (p.includes("/getNs/"))
      return Response.json({
        status: "SUCCESS",
        ns: ["a.example.test", "b.example.test"],
      });
    return Response.json({
      status: "SUCCESS",
      records: [
        {
          id: "1",
          name: "www.example.test",
          type: "A",
          content: "192.0.2.1",
          ttl: "600",
        },
      ],
    });
  });
  expect(
    await porkbun({ key: "fixture", secret: "fixture" }, porkHttp).read(
      "example.test",
    ),
  ).toMatchObject({
    domain: "example.test",
    autoRenew: true,
    records: [{ name: "www", id: "1" }],
  });
  const nameHttp = vi.fn(async (raw: any) => {
    const u = new URL(raw);
    if (!u.pathname.endsWith("/records"))
      return Response.json({
        domainName: "example.test",
        nameservers: [],
        autorenewEnabled: false,
      });
    const n = Number(u.searchParams.get("page"));
    return Response.json({
      records: [
        {
          id: n,
          host: n === 1 ? "www" : "mail",
          type: "A",
          answer: "192.0.2.1",
          ttl: 300,
        },
      ],
      ...(n === 1 ? { nextPage: 2 } : {}),
    });
  });
  expect(
    (
      await namecom({ key: "fixture", secret: "fixture" }, nameHttp).read(
        "example.test",
      )
    ).records,
  ).toHaveLength(2);
  expect(nameHttp).toHaveBeenCalledTimes(3);
});
