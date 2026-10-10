import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
import adapter, { assertBsaPage, bsaTenant, bsaDate, parseBsaSearchForm, parseBsaSearchResults, parseBsaPermitGrid, parseBsaPermitDetail, bsaPermitGridUrl } from "./bsa";
import { politeFetch } from "./polite-fetch";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/bsa/${name}`, import.meta.url), "utf8");
const ctx: AdapterCtx = { databaseId: 42, databaseName: "Rochester Hills", jurisdiction: "Rochester Hills, MI", searchUrl: "https://bsaonline.com/Home/MunicipalityHome?uid=385", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 0 } };
const base = "https://bsaonline.com/?uid=385";
beforeEach(() => vi.mocked(politeFetch).mockReset());
describe("BS&A recorded responses", () => {
  it("derives the municipality from URLs and rejects unrelated hosts", () => {
    expect(bsaTenant("https://www.bsaonline.com/Contractors?UID=258").uid).toBe("258");
    expect(bsaTenant("https://bsaonline.com/DirectUrl/Cd_PermitApplicationContractor/3105").uid).toBe("3105");
    expect(() => bsaTenant("https://bsaonline.com/DirectUrl/Cd_PermitApplicationContractor/3105?uid=385")).toThrow("different municipalities");
    for (const url of ["https://bsaonline.com.evil.test/?uid=385", "https://bsaonline.com/", "https://bsaonline.com/?uid=385&uid=209", "https://user:secret@bsaonline.com/?uid=385"]) expect(() => bsaTenant(url)).toThrow();
  });
  it("reads the actual search tabs and separates property hits from permits", () => {
    expect([...parseBsaSearchForm(fixture("search-form.html"))]).toEqual([["record number", "6"], ["name", "0"], ["address", "1"], ["parcel number", "2"]]);
    const results = parseBsaSearchResults(fixture("rochester-hills-address-results.html"));
    expect(results.total).toBe(1); expect(results.hits[0].recordKeyType).toBe("2");
    expect(parseBsaSearchResults(fixture("permit-results.html")).hits[0].recordKeyType).toBe("3");
    expect(parseBsaSearchResults(fixture("no-results.html"))).toEqual({ hits: [], total: 0, nextPage: null });
    expect(() => parseBsaSearchResults(fixture("home.html"))).toThrow("explicit result count");
  });
  it("uses the grid JSON, never the placeholder HTML no-results row", () => {
    expect(bsaPermitGridUrl(fixture("property-grid.html"))).toContain("/CD_PropertySearchV2/GridPermitsSelectBinding?");
    const payload = JSON.parse(fixture("rochester-hills-permits-page1.json"));
    const parsed = parseBsaPermitGrid(payload, ctx, { address: "1008 ADELE CT", parcel: "70-15-28-277-017" }, base);
    expect(parsed.total).toBe(11); expect(parsed.records).toHaveLength(10);
    expect(parsed.records[0]).toMatchObject({ permitNumber: "PB-2001-0568", issuedAt: "2001-09-05T04:00:00.000Z", status: "FINALED", contractorName: null, valuation: null, databaseId: 42 });
    expect(parsed.records[0].raw).toEqual(payload.data[0]);
    expect(parsed.records[0].sourceUrl).toContain("recordKey=58826690-55e8-4bcf-8f89-a14301003a12");
  });
  it("parses permit details and keeps permit owner distinct from current property owner", () => {
    const record = parseBsaPermitDetail(fixture("permit-detail.html"), ctx, "https://bsaonline.com/CD_RecordDetails/Permit?uid=385&permitId=58826690-55e8-4bcf-8f89-a14301003a12");
    expect(record).toMatchObject({ permitNumber: "PB-2001-0568", address: "1008 ADELE CT", parcel: "70-15-28-277-017", description: "NEW HOUSE", issuedAt: "2001-09-05", appliedAt: "2001-07-31", contractorName: "DELRAY HOMES INC", ownerName: "MILLENIUM DEVELOPMENT INC", contractorLicense: null });
    expect(record.raw?.html).not.toContain("__RequestVerificationToken");
  });
  it("rejects invalid dates and default year-one timestamps", () => {
    expect(bsaDate("2/30/2026")).toBeNull(); expect(bsaDate(null)).toBeNull(); expect(bsaDate("/Date(-62135596800000)/")).toBeNull(); expect(bsaDate("2/29/2024")).toBe("2024-02-29");
  });
  it("returns an explicit empty search but never mistakes an unexpected page for zero results", async () => {
    for (const name of ["home.html", "search-session.html", "search-form.html", "no-results.html"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
    expect(await adapter.search(ctx, { type: "permit", value: "PB-2001-0945" })).toEqual([]);
    expect(politeFetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(politeFetch).mock.calls.every(call => call[2]?.minDelayMs === 1000)).toBe(true);
  });
  it("does not simulate a recent listing or unsupported contractor/license searches", async () => {
    expect(adapter.capabilities.listRecent).toBe(false);
    expect(await adapter.listRecent(ctx, "2026-10-03T00:00:00Z")).toEqual([]);
    await expect(adapter.search(ctx, { type: "company", value: "DELRAY" })).rejects.toThrow("does not support company");
    expect(politeFetch).not.toHaveBeenCalled();
  });
});

describe("BS&A failure handling", () => {
  it("propagates a blocked portal instead of returning no results", async () => {
    const { PortalBlockedError } = await import("./polite-fetch");
    vi.mocked(politeFetch).mockRejectedValueOnce(new PortalBlockedError(base, 403));
    await expect(adapter.search(ctx, { type: "address", value: "1008 ADELE" })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("rejects malformed grid responses and cross-tenant record URLs", () => {
    expect(() => parseBsaPermitGrid({ success: false }, ctx, { address: null, parcel: null }, base)).toThrow("portal error");
    expect(() => parseBsaPermitGrid(JSON.parse(fixture("rochester-hills-permits-page1.json")), ctx, { address: null, parcel: null }, "https://bsaonline.com/?uid=209")).toThrow("changed municipality");
  });
  it("refuses redirects outside BS&A before sending cookies to another host", async () => {
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.com/login" } }));
    await expect(adapter.search(ctx, { type: "address", value: "1008 ADELE" })).rejects.toThrow("outside its public portal");
    expect(politeFetch).toHaveBeenCalledTimes(1);
  });
  it("throws when a municipality is returned instead of search results", async () => {
    for (const name of ["home.html", "search-session.html", "search-form.html", "home.html"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
    await expect(adapter.search(ctx, { type: "address", value: "1008 ADELE" })).rejects.toThrow("explicit result count");
  });
  it("does not return an arbitrary partial match from detail", async () => {
    for (const name of ["home.html", "search-session.html", "search-form.html", "permit-results.html", "select-result.json", "permit-detail.html"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
    expect(await adapter.detail!(ctx, "PB-2001-056")).toBeNull();
  });
});

describe("BS&A full offline search replay", () => {
  it("fetches both permit grid pages and preserves the eleventh record", async () => {
    for (const name of ["home.html", "search-session.html", "search-form.html", "rochester-hills-address-results.html", "select-result.json", "property-parent.html", "property-grid.html", "rochester-hills-permits-page1.json", "rochester-hills-permits-page2.json"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
    const records = await adapter.search(ctx, { type: "address", value: "1008 ADELE" });
    expect(records).toHaveLength(11);
    expect(records[10].permitNumber).toBe("PP-2018-0182");
    expect(vi.mocked(politeFetch).mock.calls.at(-1)?.[1]?.body).toBe("page=2&size=10");
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("rejects a repeated grid page rather than returning duplicates or partial data", async () => {
    for (const name of ["home.html", "search-session.html", "search-form.html", "rochester-hills-address-results.html", "select-result.json", "property-parent.html", "property-grid.html", "rochester-hills-permits-page1.json", "rochester-hills-permits-page1.json"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
    await expect(adapter.search(ctx, { type: "address", value: "1008 ADELE" })).rejects.toThrow("repeated permit grid page");
  });
  it("does not interpret an absent permit grid as an empty loaded grid", () => {
    expect(() => bsaPermitGridUrl(fixture("property-without-permit-grid.html"))).toThrow("public permit grid unavailable");
  });
});

it("selects the exact associated property before reading its permits", async () => {
  for (const name of ["east-point-home.html", "east-point-search-session.html", "east-point-search-form.html", "east-point-unit-results.html", "select-result.json", "east-point-property-parent.html", "associated-property-selector.html", "associated-properties.json", "east-point-property-grid.html", "east-point-permits.json"]) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name)));
  const records = await adapter.search({ ...ctx, jurisdiction: "East Point, GA", searchUrl: "https://bsaonline.com/Home/MunicipalityHome?uid=2757" }, { type: "address", value: "2862 SEMMES ST 100" });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ permitNumber: "PB25-0107", address: "2862 SEMMES ST 100 (A)", jurisdiction: "East Point, GA", status: "Hold", issuedAt: null });
  const request = vi.mocked(politeFetch).mock.calls.find(([url]) => url.includes("PropertyAndParcelDetails"));
  expect(new URL(request![0]).searchParams.get("recordKey")).toBe("00007b5a-0000-0000-0000-000000000000");
});

vi.mock("../scraper", () => ({ scrapeByPlatform: vi.fn() }));
it("registers every supported BS&A label case-insensitively", async () => {
  const { getAdapter, supportsAlerts } = await import("./registry");
  const labels = ["BS&A Online", "BS&A", "BS&A Online permit application", "BS&A Online (Harrison Charter Township)", "BS&A Online e-permitting", "BS&A Online permit portal", "BS&A Online (myNixa)", "BS&A Online (Building Permit Inquiry)", "BS&A Online (building permit search/payment)", "BS&A Online (City of Hot Springs)"];
  for (const label of labels) {
    expect(getAdapter(` ${label.toUpperCase()} `)).toBe(adapter);
    expect(supportsAlerts(label)).toBe(false);
  }
});


it("classifies a CAPTCHA or unavailable Building Department without masking the failure", async () => {
  const { PortalBlockedError } = await import("./polite-fetch");
  // Error-message inputs only; these are not recorded government-data fixtures.
  expect(() => assertBsaPage("<main>Please complete the CAPTCHA</main>", base)).toThrow(PortalBlockedError);
  expect(() => assertBsaPage("<main>Building Department not available for this municipality</main>", base)).toThrow("not available for this municipality");
  expect(() => assertBsaPage(fixture("home.html"), base)).not.toThrow();
});
