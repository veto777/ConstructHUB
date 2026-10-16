/**
 * Where research crawls leave from (owner request 2026-10-15): through the proxy RESEARCH_PROXY_URL names (a NordVPN
 * "service credentials" SOCKS5 or HTTPS proxy), or, unset, straight from this server as before.
 *
 *   RESEARCH_PROXY_URL=socks5://USER:PASS@host:1080     SOCKS5 (the proxy resolves the names)
 *   RESEARCH_PROXY_URL=https://USER:PASS@host:89        HTTPS proxy (TLS to the proxy, then CONNECT)
 *   RESEARCH_PROXY_URL=http://USER:PASS@host:3128       plain HTTP proxy (CONNECT)
 *
 * Only research uses it: http.ts (politeFetch, fetchWithDeadline, robots.txt), the node:https clients (bulk.ts
 * plainRequest, MA's Contractor Hub), the browsers research opens (VT rosters, and the permit-search contexts a
 * research run opens through ../scrapers/research-transport), and curl for the Sunbiz SFTP files. Nothing sets a
 * global proxy: Stripe, Google, mail and the rest keep the direct route.
 *
 * Set but unreachable (or malformed), a research request fails with a ResearchProxyError naming the proxy; nothing
 * ever falls back to the direct route. Credentials are never logged: everything printed names host:port only.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { Agent as HttpsAgent, type AgentOptions } from "node:https";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { ProxyAgent, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import { SocksClient } from "socks";

export type EgressConfig =
  | { mode: "direct" }
  | { mode: "proxy"; protocol: "socks5" | "http" | "https"; host: string; port: number; username: string; password: string; label: string }
  | { mode: "invalid"; reason: string };

/** A research request that could not go out through the research proxy (unreachable, refused, misconfigured). */
export class ResearchProxyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ResearchProxyError";
  }
}

const DEFAULT_PORT = { socks5: 1080, http: 80, https: 443 } as const;

/** Reads a RESEARCH_PROXY_URL value. Empty/unset: direct. Never puts the credentials into `reason` or `label`. */
export function parseProxyUrl(raw: string | undefined): EgressConfig {
  const v = (raw ?? "").trim();
  if (!v) return { mode: "direct" };
  let u: URL;
  try { u = new URL(v); } catch { return { mode: "invalid", reason: "not a URL (expected socks5://user:pass@host:port or https://user:pass@host:port)" }; }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const protocol = scheme === "socks5" || scheme === "socks5h" || scheme === "socks" ? "socks5" : scheme === "http" || scheme === "https" ? scheme : null;
  if (!protocol) return { mode: "invalid", reason: `unsupported scheme "${scheme}:" (use socks5:, https: or http:)` };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { mode: "invalid", reason: "no proxy host" };
  const port = u.port ? Number(u.port) : DEFAULT_PORT[protocol];
  let username: string, password: string;
  try { username = decodeURIComponent(u.username); password = decodeURIComponent(u.password); }
  catch { return { mode: "invalid", reason: "the user name or password is not valid percent-encoding" }; }
  return { mode: "proxy", protocol, host, port, username, password, label: `${protocol}://${u.hostname}:${port}` };
}

let config: EgressConfig | null = null;
/** The egress in force: RESEARCH_PROXY_URL as read on first use (a change needs a restart). */
export function researchEgress(): EgressConfig {
  return (config ??= parseProxyUrl(process.env.RESEARCH_PROXY_URL));
}

/** The boot line: "research egress: proxy <host>" / "research egress: direct". Never carries the credentials. */
export function describeEgress(cfg: EgressConfig = researchEgress()): string {
  if (cfg.mode === "direct") return "research egress: direct";
  if (cfg.mode === "proxy") return `research egress: proxy ${cfg.label}${cfg.username ? " (with credentials)" : ""}`;
  return `research egress: RESEARCH_PROXY_URL is invalid (${cfg.reason}); every research request will fail until it is fixed`;
}

let logged = false;
/** Logs the egress once (boot). */
export function logResearchEgress(log: (line: string) => void = console.log): void {
  if (logged) return;
  logged = true;
  log(describeEgress());
}

/** Removes the proxy's user name and password from a message, in case a library echoed them. */
export function redactProxySecrets(text: string, cfg: EgressConfig = researchEgress()): string {
  if (cfg.mode !== "proxy") return text;
  let out = text.replace(/\b((?:socks5h?|socks|https?):\/\/)[^\s/@]*@/gi, "$1***@");
  for (const s of [cfg.password, encodeURIComponent(cfg.password), cfg.username, encodeURIComponent(cfg.username)]) {
    if (s && s.length >= 3) out = out.split(s).join("***");
  }
  return out;
}

const proxyOrFail = (): Extract<EgressConfig, { mode: "proxy" }> | null => {
  const cfg = researchEgress();
  if (cfg.mode === "invalid") throw new ResearchProxyError(`research egress: RESEARCH_PROXY_URL is invalid (${cfg.reason}); research request refused`);
  return cfg.mode === "proxy" ? cfg : null;
};

let lastFailLog = 0;
/** A transport failure while the proxy is on, as a ResearchProxyError (logged, at most every 30 s). */
export function proxyFailure(err: unknown, target: string): ResearchProxyError {
  if (err instanceof ResearchProxyError) return err;
  const cfg = researchEgress();
  const label = cfg.mode === "proxy" ? cfg.label : "(none)";
  const cause = (err as { cause?: unknown })?.cause ?? err;
  const code = (cause as { code?: string })?.code;
  const why = redactProxySecrets(`${code ? `${code}: ` : ""}${(cause as Error)?.message ?? String(cause)}`);
  let host = target;
  try { host = new URL(target).host; } catch { /* keep as given */ }
  const out = new ResearchProxyError(`research egress via proxy ${label} failed (${why}) for ${host}; not retried directly`, { cause });
  if (Date.now() - lastFailLog > 30_000) { lastFailLog = Date.now(); console.error(`[research] ${out.message}`); }
  return out;
}

/** An abort we started (a deadline, a turn ending), which is not a proxy failure. */
const isAbort = (err: unknown, signal?: AbortSignal | null) =>
  !!signal?.aborted || (err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError";

// ── fetch ───────────────────────────────────────────────────────────────────────────────────────────────────────

let dispatcher: Dispatcher | null = null;
/** The undici dispatcher research fetches use: null for direct; ProxyAgent (HTTP/HTTPS proxy) or a SOCKS5 agent. */
export function researchDispatcher(): Dispatcher | null {
  const cfg = proxyOrFail();
  if (!cfg) return null;
  if (dispatcher) return dispatcher;
  if (cfg.protocol === "socks5") {
    dispatcher = socksDispatcher({ type: 5, host: cfg.host, port: cfg.port, ...(cfg.username ? { userId: cfg.username, password: cfg.password } : {}) }, { connect: { timeout: 10_000 } });
  } else {
    const uri = `${cfg.protocol}://${cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host}:${cfg.port}`;
    const token = cfg.username || cfg.password ? `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}` : undefined;
    dispatcher = new ProxyAgent({ uri, ...(token ? { token } : {}), proxyTls: { servername: cfg.host, timeout: 10_000 }, connect: { timeout: 10_000 } });
  }
  return dispatcher;
}

/**
 * fetch() for research: the global fetch, given the research dispatcher when the proxy is on (undici 7 dispatchers
 * take Node's own fetch handlers, so Response, Headers and FormData stay the global ones). A network failure through
 * the proxy is a ResearchProxyError; an abort (a deadline) passes through as it was.
 */
export async function researchFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const d = researchDispatcher();
  if (!d) return fetch(url, init);
  try {
    return await fetch(url, { ...init, dispatcher: d } as RequestInit);
  } catch (err) {
    if (isAbort(err, init.signal)) throw err;
    throw proxyFailure(err, url);
  }
}

// ── Raw tunnels (node:https clients, the browser bridge, plain-HTTP forwarding) ──────────────────────────────────

/** A TCP stream to host:port through the proxy (SOCKS5 CONNECT, or HTTP CONNECT over TCP/TLS to the proxy). */
export async function openTunnel(host: string, port: number, timeoutMs = 15_000): Promise<Socket> {
  const cfg = proxyOrFail();
  if (!cfg) throw new Error("openTunnel: research egress is direct");
  try {
    if (cfg.protocol === "socks5") {
      const { socket } = await SocksClient.createConnection({
        command: "connect", timeout: timeoutMs, destination: { host, port },
        proxy: { type: 5, host: cfg.host, port: cfg.port, ...(cfg.username ? { userId: cfg.username, password: cfg.password } : {}) },
      });
      return socket;
    }
    return await httpConnect(cfg, host, port, timeoutMs);
  } catch (err) {
    throw proxyFailure(err, `https://${host.includes(":") ? `[${host}]` : host}:${port}`);
  }
}

function httpConnect(cfg: Extract<EgressConfig, { mode: "proxy" }>, host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock: Socket = cfg.protocol === "https"
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host, ALPNProtocols: ["http/1.1"] })
      : netConnect({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => fail(new Error(`no CONNECT answer in ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    let buf = Buffer.alloc(0);
    const fail = (e: Error) => { clearTimeout(timer); sock.destroy(); reject(e); };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) { if (buf.length > 16_384) fail(new Error("CONNECT answer too long")); return; }
      sock.off("data", onData); sock.off("error", fail);
      sock.pause(); // no data lost before the caller (TLS, a pipe) takes the stream
      clearTimeout(timer);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf.subarray(0, end).toString("latin1"))?.[1] ?? 0);
      if (status !== 200) { sock.destroy(); reject(new Error(`proxy answered CONNECT with HTTP ${status || "?"}${status === 407 ? " (credentials refused)" : ""}`)); return; }
      const rest = buf.subarray(end + 4);
      if (rest.length) sock.unshift(rest);
      resolve(sock);
    };
    sock.on("data", onData);
    sock.once("error", fail);
    sock.once(cfg.protocol === "https" ? "secureConnect" : "connect", () => {
      const target = `${host.includes(":") ? `[${host}]` : host}:${port}`;
      const auth = cfg.username || cfg.password ? `Proxy-Authorization: Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}\r\n` : "";
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
    });
  });
}

/** An https.Agent whose connections run through the proxy (TLS to the origin over the tunnel; `ca` etc. still apply). */
class ProxiedHttpsAgent extends HttpsAgent {
  createConnection(options: ConnectionOptions & { host?: string; port?: number; servername?: string }, cb: (err: Error | null, s?: Duplex) => void): undefined {
    const host = options.host ?? "localhost";
    openTunnel(host, Number(options.port ?? 443)).then((socket) => {
      const tls = tlsConnect({ ...options, socket, servername: options.servername ?? (/^[\d.:]+$/.test(host) ? undefined : host) });
      tls.once("secureConnect", () => cb(null, tls));
      tls.once("error", (e) => cb(e));
    }, (e: Error) => cb(e));
    return undefined;
  }
}

let httpsAgent: HttpsAgent | null = null;
/**
 * The agent a research node:https request passes (`agent: researchHttpsAgent()`): undefined when direct (Node's
 * default agent, as before), the tunnelling agent when the proxy is on. Throws when RESEARCH_PROXY_URL is invalid.
 */
export function researchHttpsAgent(): HttpsAgent | undefined {
  if (!proxyOrFail()) return undefined;
  return (httpsAgent ??= new ProxiedHttpsAgent({ keepAlive: false } as AgentOptions));
}

// ── Browsers ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Chromium can't log in to a SOCKS5 proxy, so a browser never talks to the research proxy itself: it uses this
 * loopback bridge (an HTTP proxy on 127.0.0.1, a random port, a random password), which sends every CONNECT and
 * plain-HTTP request on through the research proxy. The real credentials stay in this process.
 */
let bridge: Promise<{ server: Server; port: number; password: string }> | null = null;

const HOP_BY_HOP = /^(?:proxy-authorization|proxy-connection|connection|keep-alive|transfer-encoding|te|trailer|upgrade)$/i;

function startBridge(): Promise<{ server: Server; port: number; password: string }> {
  const password = randomBytes(18).toString("base64url");
  const expected = `Basic ${Buffer.from(`research:${password}`).toString("base64")}`;
  const authorized = (req: IncomingMessage) => req.headers["proxy-authorization"] === expected;
  const server = createServer((req, res) => {
    if (!authorized(req)) { res.writeHead(407, { "proxy-authenticate": 'Basic realm="research"' }).end(); return; }
    let target: URL;
    try { target = new URL(req.url ?? ""); } catch { res.writeHead(400).end(); return; }
    if (target.protocol !== "http:") { res.writeHead(400).end(); return; }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP_BY_HOP.test(k))) as Record<string, string | string[]>;
    // Plain HTTP through a tunnel to the origin's port 80 (SOCKS5 or CONNECT): the same path every research fetch takes.
    const out = httpRequest({
      host: target.hostname, port: Number(target.port || 80), method: req.method, path: target.pathname + target.search, headers,
      createConnection: ((_o: unknown, cb: (e: Error | null, s?: Socket) => void) => { openTunnel(target.hostname.replace(/^\[|\]$/g, ""), Number(target.port || 80)).then((s) => cb(null, s), (e) => cb(e)); return undefined; }) as never,
    }, (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); });
    out.on("error", (e) => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }); res.end(e.message); });
    req.pipe(out);
  });
  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => client.destroy());
    if (!authorized(req)) { client.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"research\"\r\n\r\n"); return; }
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? "");
    if (!m) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    openTunnel(m[1], Number(m[2])).then((up) => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) up.write(head);
      up.on("error", () => client.destroy());
      client.on("close", () => up.destroy());
      up.pipe(client); client.pipe(up);
    }, () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve({ server, port: (server.address() as { port: number }).port, password });
    });
  });
}

export type BrowserProxy = { server: string; username: string; password: string; bypass?: string };

/**
 * The `proxy` for a research browser (launch or newContext): undefined when direct; the loopback bridge when the
 * proxy is on. Throws (never returns undefined) when RESEARCH_PROXY_URL is invalid.
 */
export async function researchBrowserProxy(): Promise<BrowserProxy | undefined> {
  if (!proxyOrFail()) return undefined;
  bridge ??= startBridge().catch((e) => { bridge = null; throw e; });
  const b = await bridge;
  return { server: `http://127.0.0.1:${b.port}`, username: "research", password: b.password };
}

/** Options to spread into a research browser context: `{ proxy }` when the proxy is on, `{}` when direct. */
export async function researchContextOptions(): Promise<{ proxy?: BrowserProxy }> {
  const proxy = await researchBrowserProxy();
  return proxy ? { proxy } : {};
}

const proxiedContexts = new WeakSet<object>();
/** Records a browser context opened with researchContextOptions() (its traffic goes through the bridge). */
export function markProxiedContext(context: object): void { proxiedContexts.add(context); }

/** A research browser context with the research proxy when it is on (and recorded as such); as before when direct. */
export async function newResearchContext<C extends object, O extends object>(browser: { newContext(options?: O): Promise<C> }, options: O): Promise<C> {
  const extra = await researchContextOptions();
  const context = await browser.newContext({ ...options, ...extra });
  if (extra.proxy) markProxiedContext(context);
  return context;
}

/**
 * Refuses (ResearchProxyError) to put a page or context behind the research guard when the proxy is on but the
 * context was not opened through it: its requests would leave from this server's own address.
 */
export function assertBrowserEgress(target: unknown): void {
  const cfg = proxyOrFail();
  if (!cfg) return;
  const t = target as { context?: () => object };
  const context = typeof t?.context === "function" ? t.context() : target;
  if (!context || typeof context !== "object" || !proxiedContexts.has(context)) {
    throw new ResearchProxyError(`research egress: a browser context opened without the research proxy (${cfg.label}); refused instead of going out directly`);
  }
}

// ── curl (the Sunbiz SFTP files) ────────────────────────────────────────────────────────────────────────────────

/**
 * The environment and extra arguments for a research curl: unchanged when direct. With the proxy on, the proxy URL
 * goes in the child's ALL_PROXY (not on the command line, where `ps` would show the password), NO_PROXY is cleared,
 * and an HTTP(S) proxy gets --proxytunnel (SFTP needs a CONNECT tunnel).
 */
export function curlProxy(): { env: NodeJS.ProcessEnv | undefined; args: string[] } {
  const cfg = proxyOrFail();
  if (!cfg) return { env: undefined, args: [] };
  const auth = cfg.username || cfg.password ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@` : "";
  const host = cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
  const scheme = cfg.protocol === "socks5" ? "socks5h" : cfg.protocol;
  const env: NodeJS.ProcessEnv = { ...process.env, ALL_PROXY: `${scheme}://${auth}${host}:${cfg.port}`, NO_PROXY: "", no_proxy: "" };
  delete env.all_proxy; delete env.HTTPS_PROXY; delete env.https_proxy; delete env.HTTP_PROXY; delete env.http_proxy;
  return { env, args: cfg.protocol === "socks5" ? [] : ["--proxytunnel"] };
}

/** For tests: forget the parsed env var, the agents and the bridge. */
export async function resetResearchEgress(): Promise<void> {
  config = null; logged = false; lastFailLog = 0;
  const d = dispatcher; dispatcher = null;
  httpsAgent?.destroy(); httpsAgent = null;
  const b = bridge; bridge = null;
  await d?.close().catch(() => undefined);
  if (b) await b.then((x) => new Promise<void>((r) => x.server.close(() => r())), () => undefined);
}



