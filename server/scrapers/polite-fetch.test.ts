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
