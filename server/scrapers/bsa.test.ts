import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
import adapter, { bsaTenant, bsaDate, parseBsaSearchForm, parseBsaSearchResults, parseBsaPermitGrid, parseBsaPermitDetail, bsaPermitGridUrl } from "./bsa";
import { politeFetch } from "./polite-fetch";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/bsa/${name}`, import.meta.url), "utf8");
const ctx: AdapterCtx = { databaseId: 42, databaseName: "Rochester Hills", jurisdiction: "Rochester Hills, MI", searchUrl: "https://bsaonline.com/Home/MunicipalityHome?uid=385", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 0 } };
const base = "https://bsaonline.com/?uid=385";
beforeEach(() => vi.mocked(politeFetch).mockReset());
describe("BS&A recorded responses", () => {
  it("derives the municipality from URLs and rejects unrelated hosts", () => {
    expect(bsaTenant("https://www.bsaonline.com/Contractors?UID=258").uid).toBe("258");
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
    expect(parsed.records[0]).toMatchObject({ permitNumber: "PB-2001-0568", issuedAt: "2001-09-05", status: "FINALED", contractorName: null, valuation: null, databaseId: 42 });
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
