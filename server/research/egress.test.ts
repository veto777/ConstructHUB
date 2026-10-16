/**
 * The research egress (RESEARCH_PROXY_URL, owner request 2026-10-15): the dispatcher/agent follows the env var, unset
 * is direct, the credentials never reach a log line, and a proxy that can't be reached fails loudly without a direct
 * retry. No internet: the proxies and origins here are small servers on 127.0.0.1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createServer as createNetServer, connect as netConnect, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import { ProxyAgent, Agent } from "undici";
import {
  ResearchProxyError, assertBrowserEgress, curlProxy, describeEgress, logResearchEgress, markProxiedContext, openTunnel, parseProxyUrl,
  proxyFailure, redactProxySecrets, researchBrowserProxy, researchContextOptions, researchDispatcher, researchEgress, researchFetch,
  researchHttpsAgent, resetResearchEgress,
} from "./egress";
import { guardBrowser, politeFetch, rethrowIfBlocked, resetHostState } from "./http";

const USER = "nord_user_7Q";
const PASS = "s3cr3t-P@ss/word";
const enc = encodeURIComponent;

async function useProxy(url: string | undefined) {
  await resetResearchEgress();
  if (url === undefined) delete process.env.RESEARCH_PROXY_URL; else process.env.RESEARCH_PROXY_URL = url;
}

beforeEach(async () => { await useProxy(undefined); resetHostState(); });
afterEach(async () => { vi.restoreAllMocks(); await useProxy(undefined); resetHostState(); });

const listen = <S extends Server | NetServer>(s: S) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const close = (s: Server | NetServer) => new Promise<void>((r) => { (s as Server).closeAllConnections?.(); s.close(() => r()); });

/** An origin on loopback that counts what it is asked. */
async function origin() {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/robots.txt") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "text/plain" }).end("hello from origin");
  });
  return { server, hits, port: await listen(server) };
}

/** A minimal HTTP CONNECT proxy that wants Basic USER:PASS; records each CONNECT and its credentials. */
async function connectProxy() {
  const seen: { target: string; auth: string | undefined }[] = [];
  const server = createServer((_req, res) => res.writeHead(405).end());
  server.on("connect", (req, client: Socket, head: Buffer) => {
    seen.push({ target: req.url ?? "", auth: req.headers["proxy-authorization"] });
    if (req.headers["proxy-authorization"] !== `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`) {
      client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"); return;
    }
    const [host, port] = (req.url ?? "").split(":");
    const up = netConnect(Number(port), host, () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) up.write(head); up.pipe(client); client.pipe(up); });
    up.on("error", () => client.destroy());
    client.on("error", () => up.destroy());
  });
  return { server, seen, port: await listen(server) };
}

/** A minimal SOCKS5 proxy (RFC 1928/1929, user/password only); records each destination and the login. */
async function socksProxy() {
  const seen: { dest: string; user: string; pass: string }[] = [];
  const server = createNetServer((c) => {
    c.on("error", () => c.destroy());
    let buf = Buffer.alloc(0), stage = 0, user = "", pass = "";
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2 && buf.length >= 2 + buf[1]) { buf = buf.subarray(2 + buf[1]); c.write(Buffer.from([5, 2])); stage = 1; }
      if (stage === 1 && buf.length >= 2) {
        const ul = buf[1]; if (buf.length < 3 + ul) return; const pl = buf[2 + ul]; if (buf.length < 3 + ul + pl) return;
        user = buf.subarray(2, 2 + ul).toString(); pass = buf.subarray(3 + ul, 3 + ul + pl).toString();
        buf = buf.subarray(3 + ul + pl);
        const ok = user === USER && pass === PASS;
        c.write(Buffer.from([1, ok ? 0 : 1])); if (!ok) { c.end(); return; } stage = 2;
      }
      if (stage === 2 && buf.length >= 5) {
        const atyp = buf[3]; let host: string, off: number;
        if (atyp === 3) { const n = buf[4]; if (buf.length < 7 + n) return; host = buf.subarray(5, 5 + n).toString(); off = 5 + n; }
        else if (atyp === 1) { if (buf.length < 10) return; host = Array.from(buf.subarray(4, 8)).join("."); off = 8; }
        else { c.end(); return; }
        const port = buf.readUInt16BE(off); const rest = buf.subarray(off + 2);
        seen.push({ dest: `${host}:${port}`, user, pass });
        stage = 3; c.off("data", onData);
        const up = netConnect(port, host, () => {
          c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) up.write(rest);
          up.pipe(c); c.pipe(up);
        });
        up.on("error", () => c.destroy());
      }
    };
    c.on("data", onData);
  });
  return { server, seen, port: await listen(server) };
}

/** A loopback port with nothing listening on it. */
async function deadPort() {
  const s = createNetServer();
  const port = await listen(s);
  await close(s);
  return port;
}

describe("parseProxyUrl", () => {
  it("unset or blank is direct", () => {
    expect(parseProxyUrl(undefined)).toEqual({ mode: "direct" });
    expect(parseProxyUrl("   ")).toEqual({ mode: "direct" });
  });
  it("reads NordVPN's SOCKS5 and HTTPS forms, decoding the credentials", () => {
    const s = parseProxyUrl(`socks5://${enc(USER)}:${enc(PASS)}@amsterdam.nordvpn.com:1080`);
    expect(s).toMatchObject({ mode: "proxy", protocol: "socks5", host: "amsterdam.nordvpn.com", port: 1080, username: USER, password: PASS, label: "socks5://amsterdam.nordvpn.com:1080" });
    const h = parseProxyUrl(`https://${enc(USER)}:${enc(PASS)}@us1234.nordvpn.com:89`);
    expect(h).toMatchObject({ mode: "proxy", protocol: "https", host: "us1234.nordvpn.com", port: 89, password: PASS });
    expect(parseProxyUrl("socks5h://h.example")).toMatchObject({ protocol: "socks5", port: 1080 });
    expect(parseProxyUrl("https://h.example")).toMatchObject({ protocol: "https", port: 443 });
  });
  it("a malformed or unsupported value is invalid, and its reason carries no secret", () => {
    expect(parseProxyUrl("ftp://u:p@h:21")).toMatchObject({ mode: "invalid" });
    expect(parseProxyUrl(`not a url ${PASS}`)).toMatchObject({ mode: "invalid" });
    expect(JSON.stringify(parseProxyUrl(`not a url ${PASS}`))).not.toContain(PASS);
  });
});

describe("choosing the dispatcher and agents from RESEARCH_PROXY_URL", () => {
  it("unset: direct everywhere (global fetch untouched, Node's default https agent, no browser proxy, curl as before)", async () => {
    expect(researchEgress()).toEqual({ mode: "direct" });
    expect(researchDispatcher()).toBeNull();
    expect(researchHttpsAgent()).toBeUndefined();
    expect(await researchBrowserProxy()).toBeUndefined();
    expect(await researchContextOptions()).toEqual({});
    expect(curlProxy()).toEqual({ env: undefined, args: [] });
    expect(() => assertBrowserEgress({})).not.toThrow();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await researchFetch("https://example.gov/x", { method: "GET" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][1] as Record<string, unknown>).dispatcher).toBeUndefined();
  });

  it("socks5: a SOCKS agent (not a ProxyAgent) for fetch; curl gets socks5h in ALL_PROXY, never on the command line", async () => {
    await useProxy(`socks5://${enc(USER)}:${enc(PASS)}@127.0.0.1:1080`);
    const d = researchDispatcher();
    expect(d).toBeInstanceOf(Agent);
    expect(d).not.toBeInstanceOf(ProxyAgent);
    expect(researchDispatcher()).toBe(d);
    expect(researchHttpsAgent()).toBeDefined();
    const c = curlProxy();
    expect(c.args).toEqual([]);
    expect(c.env?.ALL_PROXY).toBe(`socks5h://${enc(USER)}:${enc(PASS)}@127.0.0.1:1080`);
    expect(c.env?.NO_PROXY).toBe("");
  });

  it("https: undici's ProxyAgent; curl tunnels (--proxytunnel); every fetch carries it", async () => {
    await useProxy(`https://${enc(USER)}:${enc(PASS)}@127.0.0.1:89`);
    expect(researchDispatcher()).toBeInstanceOf(ProxyAgent);
    const c = curlProxy();
    expect(c.args).toEqual(["--proxytunnel"]);
    expect(c.args.join(" ")).not.toContain(PASS);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await researchFetch("https://example.gov/x");
    expect((spy.mock.calls[0][1] as Record<string, unknown>).dispatcher).toBe(researchDispatcher());
  });

  it("invalid: every research transport refuses (no direct fallback)", async () => {
    await useProxy("ftp://nope");
    expect(() => researchDispatcher()).toThrow(ResearchProxyError);
    expect(() => researchHttpsAgent()).toThrow(ResearchProxyError);
    expect(() => curlProxy()).toThrow(ResearchProxyError);
    await expect(researchBrowserProxy()).rejects.toThrow(ResearchProxyError);
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(researchFetch("https://example.gov/x")).rejects.toThrow(/RESEARCH_PROXY_URL is invalid/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("logging", () => {
  it("logs the egress once at boot: direct, or the proxy's host and never its credentials", async () => {
    const lines: string[] = [];
    logResearchEgress((l) => lines.push(l));
    logResearchEgress((l) => lines.push(l));
    expect(lines).toEqual(["research egress: direct"]);
    await useProxy(`socks5://${enc(USER)}:${enc(PASS)}@proxy.example:1080`);
    logResearchEgress((l) => lines.push(l));
    expect(lines[1]).toBe("research egress: proxy socks5://proxy.example:1080 (with credentials)");
    for (const l of lines) { expect(l).not.toContain(USER); expect(l).not.toContain(PASS); expect(l).not.toContain(enc(PASS)); }
    await useProxy(`https://${USER}:${enc(PASS)}@`);
    expect(describeEgress()).not.toContain(PASS);
  });

  it("a proxy failure's message and log line name the proxy, never the credentials", async () => {
    await useProxy(`https://${enc(USER)}:${enc(PASS)}@proxy.example:89`);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = proxyFailure(new TypeError("fetch failed", { cause: Object.assign(new Error(`connect to https://${USER}:${enc(PASS)}@proxy.example:89 failed (${PASS})`), { code: "ECONNREFUSED" }) }), "https://data.example.gov/a");
    expect(e).toBeInstanceOf(ResearchProxyError);
    expect(e.message).toMatch(/^research egress via proxy https:\/\/proxy\.example:89 failed \(ECONNREFUSED: .*\) for data\.example\.gov; not retried directly$/);
    const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("research egress via proxy");
    for (const s of [e.message, logged]) { expect(s).not.toContain(PASS); expect(s).not.toContain(enc(PASS)); expect(s).not.toContain(USER); }
    expect(redactProxySecrets(`socks5://a:b@h:1 and ${PASS}`)).toBe("socks5://***@h:1 and ***");
    expect(() => rethrowIfBlocked(e)).toThrow(ResearchProxyError);
  });
});

describe("through a proxy on loopback", () => {
  it("HTTP proxy: politeFetch (robots.txt too) goes through CONNECT with the credentials", async () => {
    const o = await origin(), p = await connectProxy();
    try {
      await useProxy(`http://${enc(USER)}:${enc(PASS)}@127.0.0.1:${p.port}`);
      const res = await politeFetch(`http://127.0.0.1:${o.port}/page`, {}, { minDelayMs: 0 });
      expect(await res.text()).toBe("hello from origin");
      expect(o.hits).toEqual(["/robots.txt", "/page"]);
      expect(p.seen.length).toBeGreaterThan(0);
      expect(p.seen.every((s) => s.target === `127.0.0.1:${o.port}`)).toBe(true);
    } finally { await close(o.server); await close(p.server); }
  });

  it("SOCKS5 proxy: politeFetch and raw tunnels go through it with the login", async () => {
    const o = await origin(), p = await socksProxy();
    try {
      await useProxy(`socks5://${enc(USER)}:${enc(PASS)}@127.0.0.1:${p.port}`);
      const res = await politeFetch(`http://127.0.0.1:${o.port}/page`, {}, { minDelayMs: 0 });
      expect(await res.text()).toBe("hello from origin");
      expect(o.hits).toEqual(["/robots.txt", "/page"]);
      expect(p.seen[0]).toEqual({ dest: `127.0.0.1:${o.port}`, user: USER, pass: PASS });
      const sock = await openTunnel("127.0.0.1", o.port);
      const text = await new Promise<string>((r) => { let t = ""; sock.on("data", (d) => { t += d; }); sock.on("end", () => r(t)); sock.write("GET /raw HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"); });
      expect(text).toContain("hello from origin");
      expect(o.hits).toContain("/raw");
    } finally { await close(o.server); await close(p.server); }
  });

  it("the browser bridge: loopback only, its own random password, forwards through the research proxy", async () => {
    const o = await origin(), p = await socksProxy();
    try {
      await useProxy(`socks5://${enc(USER)}:${enc(PASS)}@127.0.0.1:${p.port}`);
      const bp = (await researchBrowserProxy())!;
      expect(bp.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(bp.password).not.toBe(PASS);
      expect(JSON.stringify(bp)).not.toContain(PASS);
      const port = Number(new URL(bp.server).port);
      const get = (auth?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path: `http://127.0.0.1:${o.port}/via-bridge`, headers: auth ? { "proxy-authorization": auth } : {} }, (res) => {
          let body = ""; res.on("data", (d) => { body += d; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject); req.end();
      });
      expect((await get()).status).toBe(407);
      const ok = await get(`Basic ${Buffer.from(`research:${bp.password}`).toString("base64")}`);
      expect(ok).toEqual({ status: 200, body: "hello from origin" });
      expect(p.seen.some((s) => s.dest === `127.0.0.1:${o.port}`)).toBe(true);
    } finally { await close(o.server); await close(p.server); }
  });

  it("an unreachable proxy fails loudly as a proxy error, and the origin is never asked directly", async () => {
    const o = await origin();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const scheme of ["http", "socks5"]) {
        await useProxy(`${scheme}://${enc(USER)}:${enc(PASS)}@127.0.0.1:${await deadPort()}`);
        resetHostState();
        const e = await politeFetch(`http://127.0.0.1:${o.port}/page`, {}, { minDelayMs: 0, retries: 0 }).catch((x) => x);
        expect(e).toBeInstanceOf(ResearchProxyError);
        expect(e.message).toMatch(/research egress via proxy .*127\.0\.0\.1:\d+ failed/);
        expect(e.message).not.toContain(PASS);
        await expect(openTunnel("127.0.0.1", o.port)).rejects.toBeInstanceOf(ResearchProxyError);
      }
      expect(o.hits).toEqual([]);
      const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain("research egress via proxy");
      expect(logged).not.toContain(PASS);
    } finally { await close(o.server); }
  });
});

describe("browser contexts", () => {
  const fakeContext = () => ({ route: vi.fn(async () => undefined), on: vi.fn() });

  it("with the proxy on, a context not opened through it is refused; one that was is guarded", async () => {
    await useProxy(`socks5://127.0.0.1:${await deadPort()}`);
    const plain = fakeContext();
    await expect(guardBrowser(plain)).rejects.toThrow(ResearchProxyError);
    expect(plain.route).not.toHaveBeenCalled();
    const proxied = fakeContext();
    markProxiedContext(proxied);
    await expect(guardBrowser(proxied)).resolves.toBeTypeOf("function");
    // A page counts by its context.
    expect(() => assertBrowserEgress({ context: () => proxied })).not.toThrow();
    expect(() => assertBrowserEgress({ context: () => plain })).toThrow(ResearchProxyError);
  });

  it("direct: any context is guarded as before", async () => {
    await expect(guardBrowser(fakeContext())).resolves.toBeTypeOf("function");
  });
});
