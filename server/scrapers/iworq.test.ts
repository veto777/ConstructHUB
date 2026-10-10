import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PortalBlockedError, politeFetch } from "./polite-fetch";
import adapter, { buildSearchUrl, discoverSearchUrls, inspectSearchForm, parseIworqDate, parsePermitTable, parsePortalUrl, selectSearchField } from "./iworq";
import type { AdapterCtx } from "./types";

vi.mock("./polite-fetch", async importOriginal => ({
  ...await importOriginal<typeof import("./polite-fetch")>(),
  politeFetch: vi.fn(),
}));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/iworq/${name}.html`, import.meta.url), "utf8");
const douglasHome = "https://douglascounty.portal.iworq.net/portalhome/douglascounty";
const douglasSearch = "https://douglascounty.portal.iworq.net/DOUGLASCOUNTY/permits/600";
const northLiberty = "https://portal.iworq.net/NORTHLIBERTY/permits/600";
const ctx = (url = douglasHome): AdapterCtx => ({
  searchUrl: url, portalUrl: url, databaseId: 0, databaseName: "Douglas County, OR", jurisdiction: "Douglas County, OR",
  browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 20 },
});
const mockFetch = vi.mocked(politeFetch);
beforeEach(() => vi.resetAllMocks());

 describe("iWorQ URL and form discovery", () => {
  it("supports both shared and tenant hosts, and clears stored search tokens", () => {
    expect(parsePortalUrl(northLiberty).tenant).toBe("NORTHLIBERTY");
    expect(parsePortalUrl(douglasHome).kind).toBe("home");
    expect(parsePortalUrl(`${northLiberty}?search=old&g-recaptcha-response=secret`).url.href).toBe(northLiberty);
    expect(parsePortalUrl("https://cottonwoodheights.portal.iworq.net/COTTONWOODHEIGHTS/new-permit/600/1032").kind).toBe("application");
  });
  it.each([
    "https://www.montgomerycountync.gov/departments/inspections",
    "https://portal.iworq.net.evil.test/NORTHLIBERTY/permits/600",
    "https://evilportal.iworq.net/NORTHLIBERTY/permits/600",
    "https://user:password@portal.iworq.net/NORTHLIBERTY/permits/600",
    "http://portal.iworq.net/NORTHLIBERTY/permits/600",
    "https://portal.iworq.net/NORTHLIBERTY/permits/600/other",
    "https://owego2.portal.iworq.net/OWEGO/cases/400",
  ])("rejects nonpermit or unsafe URL %s", url => expect(() => parsePortalUrl(url)).toThrow());
  it("discovers current and historical modules without guessing module IDs", () => {
    expect(discoverSearchUrls(fixture("douglas-home"), douglasHome)).toEqual([
      douglasSearch, "https://douglascounty.portal.iworq.net/douglascounty/permits/602",
    ]);
  });
  it("takes the agency DSN from links when it differs from the hostname", () => {
    expect(discoverSearchUrls(fixture("dearborn-home"), "https://dearbornpermit.portal.iworq.net/portalhome/dearbornpermit")).toEqual([
      "https://dearbornpermit.portal.iworq.net/DEARBORNCOUNTY/permits/600",
    ]);
  });
  it("does not mistake an application-labelled tenant for application-only", () => {
    expect(discoverSearchUrls(fixture("hastings-home"), "https://cityofhastings.portal.iworq.net/portalhome/cityofhastings")).toHaveLength(2);
  });
  it("detects actual tenant fields including custom historical fields", () => {
    const current = inspectSearchForm(fixture("douglas-search"), douglasSearch);
    expect(selectSearchField(current, "address")).toBe("propertyaddress");
    expect(selectSearchField(current, "company")).toBe("contractor_id");
    expect(selectSearchField(current, "license")).toBeNull();
    const historical = inspectSearchForm(fixture("douglas-history"), douglasSearch);
    expect(selectSearchField(historical, "permit")).toBe("text1");
    expect(selectSearchField(historical, "address")).toBe("text11");
    expect(selectSearchField(inspectSearchForm(fixture("chamblee-search"), "https://chamblee.portal.iworq.net/CHAMBLEE/permits/601"), "name")).toBe("text1");
  });
  it.each(["douglas-search", "graham-search", "kennesaw-search", "chamblee-search", "cottonwood-search", "northliberty-search"])("refuses to build a query around the real CAPTCHA in %s", name => {
    expect(inspectSearchForm(fixture(name), douglasSearch).captcha).toBe(true);
    expect(() => buildSearchUrl(fixture(name), douglasSearch, { type: "address", value: "100 Main St" })).toThrow(PortalBlockedError);
  });
});

describe("real public North Liberty listing", () => {
  const records = () => parsePermitTable(fixture("northliberty-search"), { databaseId: 0, jurisdiction: "North Liberty, IA" }, northLiberty);
  it("parses 15 real rows without duplicating the mobile layout", () => {
    const rows = records();
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      permitNumber: "20261133", address: "1252 Trinity Ln", workClass: "Z - Fence",
      sourceUrl: "https://portal.iworq.net/NORTHLIBERTY/permit/600/29798462",
      issuedAt: null, appliedAt: null, contractorName: null, status: null,
    });
    expect(rows[1]).toMatchObject({ permitNumber: "20261132", address: "1252 Trinity Ln", workClass: "Z - Patio" });
    expect(rows[14].permitNumber).toBe("20261119");
  });
  it("retains raw rows and does not invent an issue date from generic Date", () => {
    const row = records()[0];
    expect(row.raw?.html).toContain("10/09/2026");
    expect(row.issuedAt).toBeNull();
    expect(row.appliedAt).toBeNull();
  });
  it("rejects a landing page as search results", () => {
    expect(() => parsePermitTable(fixture("douglas-home"), ctx(), douglasHome)).toThrow("Unrecognized");
  });
  it("parses calendar dates strictly", () => {
    expect(parseIworqDate("10/09/2026")).toBe("2026-10-09");
    expect(parseIworqDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIworqDate("02/29/2025")).toBeNull();
    expect(parseIworqDate("pending")).toBeNull();
    expect(parseIworqDate(null)).toBeNull();
  });
});

describe("search failures remain failures, not empty results", () => {
  it("stops after discovery and preflight without issuing a protected search", async () => {
    mockFetch.mockResolvedValueOnce(new Response(fixture("douglas-home")))
      .mockResolvedValueOnce(new Response(fixture("douglas-search")));
    const context = ctx();
    await expect(adapter.search(context, { type: "address", value: "100 Main St" })).rejects.toThrow(PortalBlockedError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map(c => c[0])).toEqual([douglasHome, douglasSearch]);
    expect(mockFetch.mock.calls[0][2]?.minDelayMs).toBe(1000);
    expect(context.browser).not.toHaveBeenCalled();
  });
  it("does not return the unfiltered initial listing as permit search results", async () => {
    mockFetch.mockResolvedValueOnce(new Response(fixture("northliberty-search")));
    await expect(adapter.search(ctx(northLiberty), { type: "permit", value: "20261133" })).rejects.toThrow(PortalBlockedError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("reports a request portal with no linked public records search", async () => {
    mockFetch.mockResolvedValueOnce(new Response(fixture("clay-home")));
    await expect(adapter.search(ctx("https://portal.iworq.net/CLAYCOUNTY/new-request/700/3481"), { type: "permit", value: "100" })).rejects.toThrow("no discoverable public records search");
    expect(mockFetch.mock.calls[0][0]).toBe("https://portal.iworq.net/portalhome/CLAYCOUNTY");
  });
  it("does not load application forms to discover public search", async () => {
    mockFetch.mockResolvedValueOnce(new Response(fixture("cottonwood-home")))
      .mockResolvedValueOnce(new Response(fixture("cottonwood-search")));
    await expect(adapter.search(ctx("https://cottonwoodheights.portal.iworq.net/COTTONWOODHEIGHTS/new-permit/600/1032"), { type: "address", value: "100 Main St" })).rejects.toThrow(PortalBlockedError);
    expect(mockFetch.mock.calls.every(c => !c[0].includes("new-permit"))).toBe(true);
  });
  it("propagates HTTP blocking from politeFetch", async () => {
    const blocked = new PortalBlockedError(douglasHome, 429);
    mockFetch.mockRejectedValueOnce(blocked);
    await expect(adapter.search(ctx(), { type: "permit", value: "100" })).rejects.toBe(blocked);
  });
  it("throws on server failures and unexpected redirects", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(adapter.search(ctx(), { type: "address", value: "100 Main St" })).rejects.toThrow("HTTP 500");
    mockFetch.mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://example.org/login" } }));
    await expect(adapter.search(ctx(), { type: "address", value: "100 Main St" })).rejects.toThrow("outside the tenant");
  });
  it("rejects unsupported query types and invalid URLs before any network requests", async () => {
    await expect(adapter.search(ctx(), { type: "license", value: "100" })).rejects.toThrow("not supported");
    await expect(adapter.search(ctx("https://example.org/"), { type: "address", value: "100 Main St" })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("does not claim alerts or emulate date listing with searches", async () => {
    expect(adapter.capabilities.listRecent).toBe(false);
    expect(adapter.capabilities.detail).toBe(false);
    await expect(adapter.listRecent(ctx(northLiberty), "2026-10-03T00:00:00Z")).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    await expect(adapter.listRecent(ctx("https://example.org/"), "2026-10-03")).rejects.toThrow();
  });
});
