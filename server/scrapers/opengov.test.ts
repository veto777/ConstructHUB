import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterCtx, PermitSearchType } from "./types";

vi.mock("./polite-fetch", async importOriginal => {
  const actual = await importOriginal<typeof import("./polite-fetch")>();
  return { ...actual, politeFetch: vi.fn() };
});
vi.mock("../scraper", () => ({ scrapeByPlatform: vi.fn() }));

import adapter, { apiFromHtml, parseJson, parseRecord, portalIdentity, searchIds, searchRequest } from "./opengov";
import { IMPLEMENTED_SEARCH_TYPES } from "./opengov";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import { getAdapter, supportsAlerts } from "./registry";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/opengov/${name}`, import.meta.url), "utf8");
const html = fixture("cheltenham-storefront.html");
const disabled = fixture("01-portagecountyoh-general_settings-200.json");
const enabled = fixture("05-vestaviahillsal-general_settings-200.json");
const denied = fixture("06-vestaviahillsal-search_results-403.json");
const fetchMock = vi.mocked(politeFetch);
const ctx = (): AdapterCtx => ({
  databaseId: 0, databaseName: "Vestavia Hills, AL", jurisdiction: "Vestavia Hills, AL",
  searchUrl: "https://vestaviahillsal.portal.opengov.com/", portalUrl: null,
  browser: vi.fn(async () => { throw new Error("Browser must not be used"); }),
  log: vi.fn(), politeness: { minDelayMs: 1000 },
});
const response = (body: string, status = 200, headers?: HeadersInit) => new Response(body, { status, headers });

beforeEach(() => { fetchMock.mockReset(); });

describe("OpenGov identity and discovered requests", () => {
  it("derives tenants from both public domain families and discards deep links", () => {
    expect(portalIdentity("https://watertownma.viewpointcloud.com/categories/1071")).toEqual({ tenant: "watertownma", origin: "https://watertownma.viewpointcloud.com" });
    expect(portalIdentity("https://newburyportma.portal.opengov.com/search?x=1").tenant).toBe("newburyportma");
  });
  it.each([
    "https://brattleboro.pay.opengov.com/stw_php/stwub/ubtipact.php",
    "https://stories.opengov.com/mebanenc/", "https://ankenyonestop.ankenyiowa.gov/",
    "https://example.com/", "https://x.portal.opengov.com.example.com/",
    "https://api-east.viewpointcloud.com/", "https://user:password@x.portal.opengov.com/",
    "https://x.portal.opengov.com:8443/", "file:///tmp/example",
  ])("rejects unrelated URLs: %s", url => { expect(() => portalIdentity(url)).toThrow(); });
  it("discovers the API host from the recorded public shell", () => {
    expect(apiFromHtml(html)).toBe("https://api-east.viewpointcloud.com/v2");
    expect(() => apiFromHtml("<html></html>")).toThrow(/configuration missing/);
    expect(() => apiFromHtml(html.replaceAll("api-east.viewpointcloud.com", "example.com"))).toThrow(/Unexpected OpenGov API/);
  });
  it("encodes query parameters without injecting another filter", () => {
    const url = new URL(searchRequest("https://api-east.viewpointcloud.com/v2/vestaviahillsal", "address", "100 Main St & other=1"));
    expect(url.searchParams.get("key")).toBe("100 Main St & other=1");
    expect(url.searchParams.get("criteria")).toBe("location");
    expect(url.searchParams.has("other")).toBe(false);
    expect(url.searchParams.get("fetchNumber")).toBe("100");
    expect(new URL(searchRequest("https://api-east.viewpointcloud.com/v2/vestaviahillsal", "permit", "2026", 200)).searchParams.get("criteria")).toBe("record");
  });
  it.each(["name", "company", "license", "keyword"] as PermitSearchType[])("does not invent a %s query mapping", type => {
    expect(() => searchRequest("https://api-east.viewpointcloud.com/v2/vestaviahillsal", type, "Construction")).toThrow(/does not support/);
  });
  it("rejects empty or overlong queries", () => {
    expect(() => searchRequest("https://example.com", "permit", "")).toThrow(/query length/);
    expect(() => searchRequest("https://example.com", "permit", "a".repeat(51))).toThrow(/query length/);
  });
});

describe("recorded response validation", () => {
  it("recognizes the recorded forbidden response even with HTTP 200", () => {
    expect(() => parseJson(denied, "https://api-east.viewpointcloud.com")).toThrow(PortalBlockedError);
  });
  it("does not turn settings or an error document into permits or no results", () => {
    const settings = parseJson(enabled, "https://api-east.viewpointcloud.com") as { data: unknown };
    expect(() => searchIds(settings, "address")).toThrow(/expected an array/);
    expect(() => parseRecord(settings.data, ctx(), ctx().searchUrl)).toThrow(/record shape/);
    expect(() => parseRecord(JSON.parse(denied), ctx(), ctx().searchUrl)).toThrow(/record shape/);
    expect(() => parseJson("<html>upstream failure</html>", "https://example.com")).toThrow(/non-JSON/);
  });
  it("accepts the empty-array protocol shape without inventing records", () => {
    expect(searchIds([], "permit")).toEqual([]);
  });
});

describe("adapter's public access boundary", () => {
  it.each(["address", "permit"] as const)("stops when the tenant disables public %s searches", async type => {
    const c = ctx(); c.searchUrl = "https://portagecountyoh.portal.opengov.com/";
    fetchMock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(disabled));
    await expect(adapter.search(c, { type, value: "2026" })).rejects.toThrow(/disabled public/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c.browser).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 503])("propagates HTTP %s as blocked, never an empty result", async status => {
    fetchMock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(enabled)).mockResolvedValueOnce(response(denied, status));
    await expect(adapter.search(ctx(), { type: "address", value: "100 Main St" })).rejects.toMatchObject({ name: "PortalBlockedError", status });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("propagates the helper's typed error without attempting another endpoint", async () => {
    const error = new PortalBlockedError("https://api-east.viewpointcloud.com", 403);
    fetchMock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(enabled)).mockRejectedValueOnce(error);
    await expect(adapter.search(ctx(), { type: "permit", value: "2026" })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("uses the caller's politeness setting with a one-second floor", async () => {
    for (const [delay, expected] of [[0, 1000], [2500, 2500]]) {
      const c = ctx(); c.politeness.minDelayMs = delay;
      fetchMock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(disabled));
      await expect(adapter.search(c, { type: "permit", value: "2026" })).rejects.toThrow();
      expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ redirect: "manual" }), expect.objectContaining({ minDelayMs: expected, retries: 1 }));
    }
  });
  it("follows the observed same-tenant ViewPoint-to-OpenGov redirect", async () => {
    const c = ctx(); c.searchUrl = "https://watertownma.viewpointcloud.com/categories/1071";
    fetchMock.mockResolvedValueOnce(response("", 301, { location: "https://watertownma.portal.opengov.com" })).mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(enabled)).mockResolvedValueOnce(response(denied, 403));
    await expect(adapter.search(c, { type: "permit", value: "2026" })).rejects.toThrow(PortalBlockedError);
    expect(fetchMock.mock.calls[1][0]).toBe("https://watertownma.portal.opengov.com/");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api-east.viewpointcloud.com/v2/watertownma/general_settings/1");
  });
  it.each(["https://accounts.viewpointcloud.com/", "https://cheltenhamtownship.portal.opengov.com/", "https://vestaviahillsal.portal.opengov.com/login"])("rejects unexpected redirects to %s", async location => {
    fetchMock.mockResolvedValueOnce(response("", 302, { location }));
    await expect(adapter.search(ctx(), { type: "permit", value: "2026" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps unsupported queries and date listing off the network", async () => {
    const c = ctx();
    await expect(adapter.search(c, { type: "company", value: "Construction" })).rejects.toThrow(/does not support/);
    expect(await adapter.listRecent(c, "2026-10-03T00:00:00.000Z")).toEqual([]);
    // Blocked on every tenant tried (Turnstile / public search disabled): not searchable until a live run succeeds.
    expect(adapter.capabilities).toEqual({ search: [], listRecent: false, detail: false });
    expect(IMPLEMENTED_SEARCH_TYPES).toEqual(["address", "permit"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("registers every handled label case-insensitively without enabling alerts", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) {
      expect(getAdapter(` ${label.toUpperCase()} `)).toBe(adapter);
      expect(supportsAlerts(label)).toBe(false);
    }
    expect(getAdapter("OpenGov (Ankeny One Stop)")).toBeNull();
  });
});
