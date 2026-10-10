import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./polite-fetch", async () => ({ ...await vi.importActual<typeof import("./polite-fetch")>("./polite-fetch"), politeFetch: vi.fn() }));
vi.mock("../scraper", () => ({ scrapeByPlatform: vi.fn() }));
import adapter, { cityviewRoot, cityviewSearchUrl, parseCityviewDetail, parseCityviewResults, cityviewDate } from "./cityview";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import { getAdapter } from "./registry";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/cityview/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const root = "https://cityserve.cityofcarrollton.com/CityViewPortal";
const ctx: AdapterCtx = { databaseId: 71, databaseName: "Carrollton", jurisdiction: "Carrollton, TX", searchUrl: root + "/Permit/Locator", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
beforeEach(() => vi.resetAllMocks());

describe("CityView real recorded responses", () => {
  it("parses the original Downers Grove list and geographic marker without inventing dates", () => {
    const p = json("downers-main.json");
    const result = parseCityviewResults(p, ctx, "https://cvportal.downers.us");
    expect(result.records).toHaveLength(20); expect(result.next).toBe(true);
    expect(result.records[0]).toMatchObject({ permitNumber: "26-ELC-0131", address: "6840 MAIN ST, DOWNERS GROVE, IL 60516", status: "In Plan Check", parcel: "0920300018", lat: 41.76301270135683, issuedAt: null, contractorName: null, databaseId: 71 });
    expect(result.records[0].sourceUrl).toBe("https://cvportal.downers.us/Permit/Status?permitId=85622");
    expect(result.records[0].raw?.marker).toEqual(p.LocationMarkers[0]);
    expect(p.View).toContain(result.records[0].raw?.html);
  });
  it("parses exact-search detail dates and preserves the original HTML", () => {
    const html = fixture("downers-detail.html");
    const r = parseCityviewDetail(html, ctx, "https://cvportal.downers.us/Permit/Status?permitId=85622");
    expect(r).toMatchObject({ permitNumber: "26-ELC-0131", appliedAt: "2026-10-07", expiresAt: "2027-10-07", issuedAt: null, workClass: "New", address: "6840 MAIN ST, DOWNERS GROVE, IL 60516", parcel: "0920300018" });
    expect(r.raw).toEqual({ html });
  });
  it("fetches all three recorded Carrollton pages with one public cookie session", async () => {
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture("carrollton-address-0.html"), { headers: { "set-cookie": "testSession=public; Path=/" } }));
    for (let i = 1; i <= 3; i++) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(`carrollton-address-${i}.json`)));
    const records = await adapter.search(ctx, { type: "address", value: "1111 S Main St" });
    expect(records).toHaveLength(49);
    expect(records[0].permitNumber).toBe("PRMH202605452");
    expect(politeFetch).toHaveBeenCalledTimes(4);
    expect(String(vi.mocked(politeFetch).mock.calls[3][0])).toContain("pageNumber=2");
    expect(vi.mocked(politeFetch).mock.calls[1][1]?.headers).toMatchObject({ Cookie: "testSession=public" });
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("follows the recorded exact-permit redirect to a public detail page", async () => {
    for (const file of ["downers-permit-0.html", "downers-permit-1.json", "downers-permit-2.html"])
      vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(file)));
    const downers = { ...ctx, searchUrl: "https://cvportal.downers.us/Permit/Application" };
    const records = await adapter.search(downers, { type: "permit", value: "26-ELC-0131" });
    expect(records).toHaveLength(1); expect(records[0].appliedAt).toBe("2026-10-07");
    expect(politeFetch).toHaveBeenCalledTimes(3);
  });
  it("returns [] only for the recorded genuine Monroe no-results response", () => {
    expect(parseCityviewResults(json("monroe-address-1.json"), ctx, root)).toEqual({ records: [], next: false });
  });
  it("reads an actual issued date on the Carrollton detail page", () => {
    const record = parseCityviewDetail(fixture("carrollton-permit-2.html"), ctx, root + "/Permit/Status");
    expect(record).toMatchObject({ permitNumber: "PRMH202605452", issuedAt: "2026-09-28", appliedAt: "2026-09-25", expiresAt: "2027-03-28" });
  });
  it("parses the third tenant's older list and detail layouts", () => {
    const records = parseCityviewResults(json("monroe-main-address-1.json"), ctx, "https://cvportal.monroenc.org/portal").records;
    expect(records).toHaveLength(5); expect(records[0].permitNumber).toBe("PR21200420");
    expect(records[0].status).toBe("Closed");
    expect(parseCityviewDetail(fixture("monroe-permit-2.html"), ctx, root).appliedAt).toBe("2020-09-04");
  });
  it("does not silently return a truncated search when a page repeats", async () => {
    // Each fetch returns a fresh response, since response bodies are consumable.
    vi.mocked(politeFetch).mockImplementationOnce(async () => new Response(fixture("carrollton-address-0.html")))
      .mockImplementation(async () => new Response(fixture("carrollton-address-1.json")));
    await expect(adapter.search(ctx, { type: "address", value: "1111 S Main St" })).rejects.toThrow("repeated");
  });
  it("classifies the real Naples CAPTCHA as blocked", async () => {
    vi.mocked(politeFetch).mockResolvedValue(new Response(fixture("naples-captcha.html")));
    await expect(adapter.search(ctx, { type: "permit", value: "26-ELC-0131" })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("rejects links into another tenant on the same shared host", () => {
    const p = json("carrollton-address-1.json");
    p.View = p.View.replaceAll("/CityViewPortal/Permit/Status?", "/OtherPortal/Permit/Status?");
    expect(() => parseCityviewResults(p, ctx, root)).toThrow("outside the tenant");
    expect(() => parseCityviewResults({ View: "", RedirectUrl: "/Home/LocatorCaptcha" }, ctx, root)).toThrow(PortalBlockedError);
  });
  it("throws on changed schemas, server failures and missing permit numbers", () => {
    expect(() => parseCityviewResults({}, ctx, root)).toThrow();
    expect(() => parseCityviewResults({ View: "Internal Server Error" }, ctx, root)).toThrow();
    const p = json("downers-main.json"); p.View = p.View.replace("26-ELC-0131", "");
    expect(() => parseCityviewResults(p, ctx, root)).toThrow("missing permit number");
  });
});

describe("CityView contract", () => {
  it("derives tenant roots and preserves shared-host tenancy", () => {
    expect(cityviewRoot("https://cvportal.downers.us/Permit/Application")).toBe("https://cvportal.downers.us");
    expect(cityviewRoot("https://cityview2.iharriscomputer.com/RouttCountyPortal/")).toBe("https://cityview2.iharriscomputer.com/RouttCountyPortal");
    expect(cityviewRoot("https://cityview.lpcgov.org/Account/Logon")).toBe("https://cityview.lpcgov.org");
    expect(() => cityviewRoot("https://www.blueprinceportal.com/login")).toThrow();
    expect(() => cityviewRoot("https://www.dmcityview.com/feature-2/story")).toThrow();
    expect(new URL(cityviewSearchUrl(root, "100 Main & Second", 2)).searchParams.get("searchValue")).toBe("100 Main & Second");
  });
  it("rejects unsupported searches and advertises no date listing", async () => {
    await expect(adapter.search(ctx, { type: "company", value: "contractor" })).rejects.toThrow("does not support");
    expect(await adapter.listRecent(ctx, "2026-10-03T00:00:00Z")).toEqual([]);
    expect(adapter.capabilities.listRecent).toBe(false); expect(politeFetch).not.toHaveBeenCalled();
  });
  it("normalizes only valid reported US dates", () => {
    expect(cityviewDate("2/29/2024")).toBe("2024-02-29"); expect(cityviewDate("2/29/2025")).toBeNull();
    expect(cityviewDate("unknown")).toBeNull(); expect(cityviewDate(null)).toBeNull();
  });
  it("registers every supported CityView label, but excludes BluePrince", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
    expect(getAdapter("Harris CityView BluePrince Portal")).not.toBe(adapter);
  });
});
