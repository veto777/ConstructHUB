import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch, USER_AGENT } from "./polite-fetch";

afterEach(() => vi.unstubAllGlobals());

const sentHeaders = async (init: RequestInit): Promise<Headers> => {
  const fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  await politeFetch(`https://example.test/${Math.random()}`, init, { minDelayMs: 0 });
  return (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
};

describe("politeFetch headers", () => {
  // CentralSquare's aspgov.com hosts (F5 ASM) answered an empty `Cookie:` header with an "Error Occurred ...
  // support ID" page; six Click2Gov portals (Laredo, Jacksonville Beach, Temple Terrace, ...) failed on it.
  it("never sends an empty Cookie header from a session's still-empty jar", async () => {
    expect((await sentHeaders({ headers: { Cookie: "" } })).has("cookie")).toBe(false);
    expect((await sentHeaders({ headers: { cookie: "  " } })).has("cookie")).toBe(false);
  });
  it("keeps real cookies and the honest user agent", async () => {
    const headers = await sentHeaders({ headers: { cookie: "JSESSIONID=abc" } });
    expect(headers.get("cookie")).toBe("JSESSIONID=abc");
    expect(headers.get("user-agent")).toBe(USER_AGENT);
  });
});

describe("politeFetch connection retries", () => {
  const connectTimeout = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  // Addison, TX (EnerGov) intermittently took longer than Node's 10 s connect limit; curl got through.
  it("opens a fresh connection after a connect timeout, since no request reached the server", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(connectTimeout()).mockRejectedValueOnce(connectTimeout()).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await politeFetch(`https://slow.example/${Math.random()}`, {}, { minDelayMs: 0 })).text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("gives up after two retries and never retries other network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(connectTimeout());
    vi.stubGlobal("fetch", fetchMock);
    await expect(politeFetch(`https://down.example/${Math.random()}`, {}, { minDelayMs: 0 })).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const reset = vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    vi.stubGlobal("fetch", reset);
    await expect(politeFetch(`https://reset.example/${Math.random()}`, {}, { minDelayMs: 0 })).rejects.toThrow("fetch failed");
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
