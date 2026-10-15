/**
 * Regression tests for the HTTP findings of the round-5 Codex audit (2026-10-15): #6 (a 2xx challenge page on any
 * transport blocks the host that sent it; HTML character references are decoded before matching) and #7 (robots.txt
 * paths are compared percent-encoding-normalized, RFC 9309 §2.2.2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortalBlockedError, challengePage, decodeEntities, fetchWithDeadline, guard, guardBrowser, hostBlocked, noteResponse, normalizeRobotsPath,
  politeFetch, refuseChallengeBody, releaseHost, resetHostState, robotsAllowed, robotsAllows, robotsFor, visibleText, type Turn,
} from "./http";
import { download } from "./bulk";
import { researchPost, researchTransport, type ResearchTransport } from "../scrapers/research-transport";
import { promises as fs } from "node:fs";

afterEach(() => { vi.restoreAllMocks(); resetHostState(); });

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

/** robots.txt answers per host (404: none), and every other URL from `pages`; records what was sent. */
function mockNet(pages: Record<string, () => Response>, robots: Record<string, () => Response> = {}) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const u = new URL(String(input));
    if (u.pathname === "/robots.txt") return robots[u.host]?.() ?? new Response("", { status: 404 });
    sent.push(u.toString());
    const p = pages[u.toString()];
    if (!p) throw new Error(`unexpected fetch ${u}`);
    return p();
  });
  return sent;
}

describe("finding 6: a challenge page in a 2xx answer blocks the host that sent it", () => {
  it("a data request answered 200 with 'Checking your browser' throws, and the next request to that host is not sent", async () => {
    const sent = mockNet({
      "https://data.test/api/q": () => html("<html><body><h1>Checking your browser</h1></body></html>"),
      "https://data.test/api/q2": () => html("<p>ok</p>"),
    });
    await expect(politeFetch("https://data.test/api/q", {}, { minDelayMs: 0 })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(hostBlocked("https://data.test/")).not.toBeNull();
    await expect(politeFetch("https://data.test/api/q2", {}, { minDelayMs: 0 })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(sent).toEqual(["https://data.test/api/q"]);
  });

  it("blocks the host that answered, not the one first asked (after a redirect)", async () => {
    mockNet({
      "https://a.test/start": () => new Response("", { status: 302, headers: { location: "https://waf.test/page" } }),
      "https://waf.test/page": () => html('<html><head><title>Just a moment...</title></head><body></body></html>'),
    });
    await expect(fetchWithDeadline("https://a.test/start", {}, 10_000, 0)).rejects.toThrow(/waf\.test answered with a bot challenge page/);
    expect(hostBlocked("https://waf.test/")).not.toBeNull();
    expect(hostBlocked("https://a.test/")).toBeNull();
  });

  it("an ordinary page passes, its body whole and still streamed (larger than the part read for the check)", async () => {
    const big = "<html><body>" + "<p>permit row</p>".repeat(20_000) + "</body></html>";
    mockNet({ "https://ok.test/list": () => html(big) });
    const res = await politeFetch("https://ok.test/list", {}, { minDelayMs: 0 });
    expect(res.status).toBe(200);
    expect(res.url).toBe("https://ok.test/list");
    expect(await res.text()).toBe(big);
  });

  it("a JSON answer or a 4xx page is not read for a challenge (RFC 9309 4xx handling and the S3 XML error unchanged)", async () => {
    mockNet({
      "https://j.test/a": () => new Response('{"msg":"access denied"}', { status: 200, headers: { "content-type": "application/json" } }),
      "https://j.test/b": () => html("<h1>Access denied</h1>", 404),
    });
    expect((await politeFetch("https://j.test/a", {}, { minDelayMs: 0 })).status).toBe(200);
    expect((await politeFetch("https://j.test/b", {}, { minDelayMs: 0, retries: 0 })).status).toBe(404);
    expect(hostBlocked("https://j.test/")).toBeNull();
    expect(challengePage("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>")).toBe(false);
  });

  it("a bulk download answered with a challenge page is refused and leaves no file", async () => {
    mockNet({ "https://files.test/x.csv": () => html('<html><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></html>') });
    const before = (await fs.readdir((await import("node:os")).tmpdir())).filter((f) => f.startsWith("ch-bulk-")).length;
    await expect(download("https://files.test/x.csv")).rejects.toBeInstanceOf(PortalBlockedError);
    const after = (await fs.readdir((await import("node:os")).tmpdir())).filter((f) => f.startsWith("ch-bulk-")).length;
    expect(after).toBe(before);
    expect(hostBlocked("https://files.test/")).not.toBeNull();
  });

  it("the browser guard stops a load whose page is a challenge, and blocks that host", async () => {
    mockNet({});
    let handler!: (route: any) => Promise<unknown>;
    const target = { route: async (_p: string, h: any) => { handler = h; }, on: () => undefined };
    const check = await guardBrowser(target, 0);
    const out: { aborted?: string; fulfilled?: unknown } = {};
    await handler({
      request: () => ({ url: () => "https://portal.test/search", resourceType: () => "document", method: () => "GET", postDataBuffer: () => null, headers: () => ({}) }),
      fetch: async () => ({ url: () => "https://portal.test/search", status: () => 200, headers: () => ({ "content-type": "text/html" }), body: async () => Buffer.from("<html><title>Attention Required! | Cloudflare</title></html>") }),
      continue: async () => { throw new Error("unguarded"); },
      fulfill: async (f: unknown) => { out.fulfilled = f; },
      abort: async (why: string) => { out.aborted = why; },
    });
    expect(out.aborted).toBe("blockedbyclient");
    expect(out.fulfilled).toBeUndefined();
    expect(check).toThrow(PortalBlockedError);
    expect(hostBlocked("https://portal.test/")).not.toBeNull();
  });

  it("the scraper's API post in a research search: a challenge page throws when the runner checks bodies", async () => {
    mockNet({});
    const store: ResearchTransport = {
      fetch: async () => { throw new Error("unused"); },
      guardContext: async () => undefined,
      before: (url, holdMs) => guard(url, 0, holdMs),
      after: (url, status, retryAfter, turn) => { releaseHost(url, turn as Turn); noteResponse(url, status, retryAfter); },
      checkBody: refuseChallengeBody,
    };
    const request = {
      fetch: vi.fn(async (url: string) => ({ url: () => url, status: () => 200, headers: () => ({ "content-type": "text/html" }), body: async () => Buffer.from("<h1>Are you a robot?</h1>"), dispose: async () => undefined })),
    };
    await expect(researchTransport.run(store, () => researchPost(request as any, "https://energov.test/api/search", { data: {} }))).rejects.toBeInstanceOf(PortalBlockedError);
    expect(hostBlocked("https://energov.test/")).not.toBeNull();
  });

  it("HTML character references are decoded before matching: 'Access&#32;denied' on robots.txt refuses", async () => {
    expect(decodeEntities("Access&#32;denied &#x41;&amp;B&nbsp;x")).toBe("Access denied A&B x");
    expect(visibleText("<html><body>Access&#32;denied</body></html>").trim()).toBe("Access denied");
    mockNet({}, { "r.test": () => html("<html><body>Access&#32;denied</body></html>") });
    expect((await robotsFor("https://r.test")).denied).toBeTruthy();
    expect(await robotsAllowed("https://r.test/x")).toBe(false);
  });
});

describe("finding 7: robots.txt paths are compared percent-encoding-normalized (RFC 9309)", () => {
  const rules = [{ allow: false, path: "/private" }, { allow: false, path: "/a/b" }];
  it("an escaped unreserved character is the character: /%70rivate is /private", () => {
    expect(robotsAllows(rules, "/private")).toBe(false);
    expect(robotsAllows(rules, "/%70rivate")).toBe(false);
    expect(robotsAllows(rules, "/%70RIVATE")).toBe(true);
    expect(robotsAllows([{ allow: false, path: "/%70rivate" }], "/private/x")).toBe(false);
    // An escaped reserved character stays apart: /a%2Fb is not /a/b.
    expect(robotsAllows(rules, "/a%2Fb")).toBe(true);
    expect(robotsAllows([{ allow: false, path: "/a%2fb" }], "/a%2Fb")).toBe(false);
  });
  it("normalizes hex case and non-ASCII characters", () => {
    expect(normalizeRobotsPath("/%7euser/%2f%3A")).toBe("/~user/%2F%3A");
    expect(normalizeRobotsPath("/café")).toBe("/caf%C3%A9");
    expect(robotsAllows([{ allow: false, path: "/café" }], "/caf%c3%a9")).toBe(false);
  });
  it("a redirect to the encoded path is not sent", async () => {
    const sent = mockNet(
      { "https://p.test/start": () => new Response("", { status: 302, headers: { location: "/%70rivate/data" } }) },
      { "p.test": () => new Response("User-agent: *\nDisallow: /private", { status: 200 }) },
    );
    await expect(politeFetch("https://p.test/start", {}, { minDelayMs: 0 })).rejects.toThrow(/robots\.txt disallows/);
    expect(sent).toEqual(["https://p.test/start"]);
  });
});
