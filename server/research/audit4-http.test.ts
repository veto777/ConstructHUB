/**
 * Regression tests for the HTTP findings of the round-4 Codex audit (2026-10-15): #6 (redirects in browser pages and
 * the scraper's API posts are followed hop by hop through the guard, each answer noted against the URL that answered)
 * and #12 (request-owned turns; an expired turn aborts its request before the next one may go).
 */
import { afterEach, describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { PortalBlockedError, blockHost, guard, guardBrowser, hostBlocked, noteResponse, releaseHost, resetHostState, robotsFor, type Turn } from "./http";
import { researchPost, researchTransport, type ResearchTransport } from "../scrapers/research-transport";
import { setRobotsEnforced as __setRobotsEnforced } from "./http";
// These tests exercise the robots.txt Disallow rule, which the OWNER ORDER of 2026-10-15 switched off in production.
beforeAll(() => __setRobotsEnforced(true));
afterAll(() => __setRobotsEnforced(false));

afterEach(() => { vi.restoreAllMocks(); resetHostState(); });

/** robots.txt: c.test disallows /private; every other host has none. */
function mockRobots() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const u = new URL(String(input));
    if (u.pathname !== "/robots.txt") throw new Error(`unexpected fetch ${u}`);
    return u.host === "c.test" ? new Response("User-agent: *\nDisallow: /private", { status: 200 }) : new Response("", { status: 404 });
  });
}

type Answer = { status: number; headers?: Record<string, string>; body?: string };
const response = (url: string, a: Answer) => ({
  url: () => url, status: () => a.status, headers: () => a.headers ?? {}, body: async () => Buffer.from(a.body ?? ""),
});

/** A page or context with one route handler; `load` plays one browser request through it. */
function fakeTarget(answers: Record<string, Answer>) {
  let handler!: (route: any) => Promise<unknown>;
  let onResponse!: (res: any) => void;
  const sent: string[] = [];
  const target = {
    route: async (_p: string, h: (route: any) => Promise<unknown>) => { handler = h; },
    on: (_e: "response", fn: (res: any) => void) => { onResponse = fn; },
  };
  async function load(url: string, resourceType = "document", method = "GET") {
    const request = { url: () => url, resourceType: () => resourceType, method: () => method, postDataBuffer: () => null, headers: () => ({}) };
    const out: { fulfilled?: any; aborted?: string } = {};
    await handler({
      request: () => request,
      continue: async () => { throw new Error("continue() lets the browser follow redirects unguarded"); },
      fetch: async (o: { url: string; maxRedirects: number }) => {
        expect(o.maxRedirects).toBe(0);
        sent.push(o.url);
        const a = answers[o.url];
        if (!a) throw new Error(`no answer for ${o.url}`);
        return response(o.url, a);
      },
      fulfill: async (f: any) => { out.fulfilled = f; },
      abort: async (why: string) => { out.aborted = why; },
    });
    return { ...out, request };
  }
  return { target, load, sent, emit: (res: any) => onResponse(res) };
}

describe("finding 6: browser redirects are followed here, every hop guarded", () => {
  it("A → B → C where robots.txt disallows C: A and B are sent, C is not, and the load is refused", async () => {
    mockRobots();
    const t = fakeTarget({
      "https://a.test/x": { status: 302, headers: { location: "https://b.test/y" } },
      "https://b.test/y": { status: 302, headers: { location: "https://c.test/private/z" } },
    });
    const check = await guardBrowser(t.target, 0);
    const r = await t.load("https://a.test/x");
    expect(t.sent).toEqual(["https://a.test/x", "https://b.test/y"]);
    expect(r.aborted).toBe("blockedbyclient");
    expect(check).toThrow(PortalBlockedError);
  });

  it("a passive resource's redirect to an already blocked host is not sent", async () => {
    mockRobots();
    blockHost("https://blocked.test/", 403, "HTTP 403");
    const t = fakeTarget({ "https://a.test/logo.png": { status: 301, headers: { location: "https://blocked.test/logo.png" } } });
    const check = await guardBrowser(t.target, 0);
    const r = await t.load("https://a.test/logo.png", "image");
    expect(t.sent).toEqual(["https://a.test/logo.png"]);
    expect(r.aborted).toBe("blockedbyclient");
    // An image left out doesn't stop the page; a 403 answer to one does.
    expect(check).not.toThrow();
    const t2 = fakeTarget({ "https://d.test/logo.png": { status: 403 } });
    const check2 = await guardBrowser(t2.target, 0);
    await t2.load("https://d.test/logo.png", "image");
    expect(check2).toThrow(PortalBlockedError);
  });

  it("each answer is noted against the host that answered, and the browser's own response event doesn't note it again", async () => {
    mockRobots();
    const t = fakeTarget({
      "https://a.test/x": { status: 302, headers: { location: "https://b.test/y" } },
      "https://b.test/y": { status: 403 },
    });
    await guardBrowser(t.target, 0);
    await t.load("https://a.test/x");
    expect(hostBlocked("https://b.test/")).toBeTruthy();
    expect(hostBlocked("https://a.test/")).toBeNull();
  });

  it("the last hop's page is given for the URL asked for, with a <base> naming where it came from", async () => {
    mockRobots();
    const t = fakeTarget({
      "https://a.test/portal": { status: 302, headers: { location: "/portal/Default.aspx" } },
      "https://a.test/portal/Default.aspx": { status: 200, headers: { "content-type": "text/html" }, body: "<html><head><title>x</title></head><body><header>h</header></body></html>" },
    });
    await guardBrowser(t.target, 0);
    const r = await t.load("https://a.test/portal");
    expect(r.fulfilled.body).toContain('<head><base href="https://a.test/portal/Default.aspx"><title>');
    expect(r.fulfilled.body).toContain("<header>h</header>");
    // The browser reports the final status for the first URL; it is not noted against a.test/portal again.
    t.emit({ request: () => r.request, url: () => "https://a.test/portal", status: () => 403, headers: () => ({}) });
    expect(hostBlocked("https://a.test/")).toBeNull();
  });
});

describe("finding 6: the scraper's API posts in a research search", () => {
  const store: ResearchTransport = {
    fetch: async () => { throw new Error("unused"); },
    guardContext: async () => undefined,
    before: (url, holdMs) => guard(url, 0, holdMs),
    after: (url, status, retryAfter, turn) => { releaseHost(url, turn as Turn); noteResponse(url, status, retryAfter); },
  };
  function fakeRequest(answers: Record<string, Answer>) {
    const sent: { url: string; method: string; data: unknown }[] = [];
    const request = {
      post: vi.fn(async () => { throw new Error("post() follows redirects by itself"); }),
      fetch: vi.fn(async (url: string, o: { method: string; data?: unknown; maxRedirects: number }) => {
        expect(o.maxRedirects).toBe(0);
        sent.push({ url, method: o.method, data: o.data });
        return { ...response(url, answers[url]), dispose: async () => undefined };
      }),
    };
    return { request: request as any, sent };
  }

  it("a redirect to an already blocked host is not sent", async () => {
    mockRobots();
    blockHost("https://blocked.test/", 403, "HTTP 403");
    const f = fakeRequest({ "https://a.test/api/energov/search/search": { status: 307, headers: { location: "https://blocked.test/api" } } });
    await expect(researchTransport.run(store, () => researchPost(f.request, "https://a.test/api/energov/search/search", { data: { k: 1 } }))).rejects.toBeInstanceOf(PortalBlockedError);
    expect(f.sent.map((s) => s.url)).toEqual(["https://a.test/api/energov/search/search"]);
  });

  it("a redirect to a path robots.txt disallows is not sent; a 307 keeps the POST, a 303 turns it into a GET", async () => {
    mockRobots();
    const f = fakeRequest({
      "https://a.test/api/s": { status: 307, headers: { location: "https://b.test/api/s" } },
      "https://b.test/api/s": { status: 303, headers: { location: "https://c.test/private/s" } },
    });
    await expect(researchTransport.run(store, () => researchPost(f.request, "https://a.test/api/s", { data: { k: 1 } }))).rejects.toThrow(/robots\.txt disallows/);
    expect(f.sent).toEqual([{ url: "https://a.test/api/s", method: "POST", data: { k: 1 } }, { url: "https://b.test/api/s", method: "POST", data: { k: 1 } }]);
  });

  it("the answer is noted against the host that answered", async () => {
    mockRobots();
    const f = fakeRequest({
      "https://a.test/api/s": { status: 302, headers: { location: "https://b.test/api/s" } },
      "https://b.test/api/s": { status: 403 },
    });
    await expect(researchTransport.run(store, () => researchPost(f.request, "https://a.test/api/s", { data: {} }))).rejects.toBeInstanceOf(PortalBlockedError);
    expect(hostBlocked("https://b.test/")).toBeTruthy();
    expect(hostBlocked("https://a.test/")).toBeNull();
  });

  it("outside a research search it is the plain post, as before", async () => {
    const post = vi.fn(async () => "ok");
    expect(await researchPost({ post } as any, "https://a.test/api/s", { data: 1, timeout: 5 })).toBe("ok");
    expect(post).toHaveBeenCalledWith("https://a.test/api/s", { data: 1, timeout: 5 });
  });
});

describe("finding 12: each request owns its turn", () => {
  const settled = async (p: Promise<unknown>) => { let done = false; p.then(() => (done = true), () => (done = true)); await new Promise((r) => setTimeout(r, 20)); return done; };

  it("a turn held past its limit aborts its request, and its late release doesn't end the next request's turn", async () => {
    mockRobots();
    const url = "https://q.test/x";
    const a = await guard(url, 0, 60);
    const bP = guard(url, 0, 10_000);
    expect(await settled(bP)).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(a.signal.aborted).toBe(true);
    const b = await bP;
    const cP = guard(url, 0, 10_000);
    // A finishes late, released the old way by URL (a caller that kept no Turn), then with its own Turn: neither ends B's turn.
    releaseHost(url);
    expect(await settled(cP)).toBe(false);
    a.release();
    expect(await settled(cP)).toBe(false);
    expect(b.signal.aborted).toBe(false);
    b.release();
    const c = await cP;
    expect(c.signal.aborted).toBe(false);
    c.release();
  });

  it("releasing a turn twice ends only that turn", async () => {
    mockRobots();
    const url = "https://q.test/y";
    const a = await guard(url, 0);
    const bP = guard(url, 0);
    a.release();
    const b = await bP;
    const cP = guard(url, 0);
    a.release();
    expect(await settled(cP)).toBe(false);
    b.release();
    (await cP).release();
  });
});

describe("robots.txt: an IIS 404 page is no robots file (live 2026-10-15)", () => {
  it("aca-prod.accela.com and energovweb.capecoral.gov answer robots.txt with IIS's 'Server Error … 404' page: no rules", async () => {
    const iis404 = '<!DOCTYPE html><html><head><title>404 - File or directory not found.</title></head><body><div id="header"><h1>Server Error</h1></div><div id="content"><h2>404 - File or directory not found.</h2></div></body></html>';
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const u = new URL(String(input));
      if (u.host === "iis.test") return new Response(iis404, { status: 404, headers: { "content-type": "text/html" } });
      if (u.host === "down.test") return new Response("<html><body><h1>Server Error</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html" } });
    });
    expect((await robotsFor("https://iis.test")).denied).toBeUndefined();
    // A 2xx error page instead of a robots file still refuses, and so does a challenge with any status.
    expect((await robotsFor("https://down.test")).denied).toBeTruthy();
    expect((await robotsFor("https://cf.test")).denied).toBeTruthy();
  });
});

describe("robots.txt: challenge words count only where a reader sees them (round 4 sweep)", () => {
  it("script text and form settings are not a challenge; a title, page text or vendor marker is", async () => {
    const { challengePage } = await import("./http");
    // Accela's app page logs this from a script; a Revize 404 page sets form_captcha; My L&I loads reCAPTCHA for its sign-in.
    expect(challengePage('<html><head><title>Accela Citizen Access</title><script>console.warn("Storage access denied: " + e)</script></head><body><div id="app"></div></body></html>')).toBe(false);
    expect(challengePage('<html><head><title>Page not found</title><script>var form_captcha = "yes";</script></head><body>404</body></html>')).toBe(false);
    expect(challengePage('<html><head><title>My L&amp;I</title><script src="https://www.google.com/recaptcha/api.js"></script></head><body>Sign in</body></html>')).toBe(false);
    expect(challengePage("<html><head><title>Just a moment...</title></head><body></body></html>")).toBe(true);
    expect(challengePage("<html><head><title>Access Denied</title></head><body>Reference #18.abc</body></html>")).toBe(true);
    expect(challengePage('<html><body><iframe src="/_Incapsula_Resource?x=1"></iframe></body></html>')).toBe(true);
    expect(challengePage('<html><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></html>')).toBe(true);
    // A 2xx page that says the server is down refuses; the same words in a script do not.
    expect(challengePage("<html><title>Service Unavailable</title></html>", true)).toBe(true);
    expect(challengePage('<html><script>log("server error")</script><body>Welcome</body></html>', true)).toBe(false);
  });
});
