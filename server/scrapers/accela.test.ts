import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./polite-fetch", async importOriginal => ({
  ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn(),
}));
import adapter, { accelaPortalUrl, accelaAgencyCode, assertAccelaScope, accelaForm, accelaSearchForm,
  accelaRecentForm, parseAccelaRecords, accelaDetailFields, isoDate } from "./accela";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx } from "./types";
import { getAdapter } from "./registry";

const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/accela/${name}.html.gz`, import.meta.url))).toString("utf8");
const sources = JSON.parse(readFileSync(new URL("./fixtures/accela/sources.json", import.meta.url), "utf8")) as {file:string;url:string;sha256:string}[];
const source = (name: string) => sources.find(s => s.file === `${name}.html.gz`)!.url;
const ctx = (name = "tampa"): AdapterCtx => ({
  databaseId: 5, databaseName: name, jurisdiction: name === "lane" ? "Lane County, OR" : "Tampa, FL",
  searchUrl: source(`${name}-form`), portalUrl: source(`${name}-form`),
  browser: vi.fn(async () => { throw new Error("HTTP adapter must not launch a browser"); }),
  log: vi.fn(), politeness: { minDelayMs: 1000 },
});
const respond = (name: string, headers?: HeadersInit) => vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(name), { status: 200, headers }));
const redirect = (name: string) => vi.mocked(politeFetch).mockResolvedValueOnce(new Response(null, {status:302,headers:{location:source(name)}}));

beforeEach(() => { vi.resetAllMocks(); adapter.capabilities.listRecent = true; });
afterEach(() => { vi.useRealTimers(); });

describe("recorded ACA forms and records", () => {
  it("keeps every recorded response unchanged after lossless decompression", () => {
    for (const s of sources) {
      const bytes = gunzipSync(readFileSync(new URL(`./fixtures/accela/${s.file}`, import.meta.url)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(s.sha256);
    }
  });
  it("preserves live ViewState and CSRF fields, splits full street addresses, and clears historical date defaults", () => {
    const html = fixture("tampa-form");
    const before = accelaForm(html);
    const form = accelaSearchForm(html, {type:"address",value:"2917 W Main St"});
    expect(form.get("__VIEWSTATE")).toBe(before.get("__VIEWSTATE"));
    expect(form.get("ACA_CS_FIELD")).toBe(before.get("ACA_CS_FIELD"));
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSNumber$ChildControl0")).toBe("2917");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSStreetName")).toBe("Main");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$ddlGSStreetSuffix")).toBe("St");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$ddlGSDirection")).toBe("W");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate")).toBe("");
  });
  it("builds actual license/business/last-name fields from the licensed-professional form", () => {
    const html = fixture("tampa-license-form");
    expect(accelaSearchForm(html,{type:"company",value:"ACTION AIRCONDITIONING INC"}).get("ctl00$PlaceHolderMain$txtBusiName")).toBe("ACTION AIRCONDITIONING INC");
    expect(accelaSearchForm(html,{type:"license",value:"CAC042730"}).get("ctl00$PlaceHolderMain$txtLicenseNumber")).toBe("CAC042730");
    expect(accelaSearchForm(html,{type:"name",value:"RUSSELL"}).get("ctl00$PlaceHolderMain$txtLastName")).toBe("RUSSELL");
    expect(() => accelaSearchForm(html,{type:"keyword",value:"HVAC"})).toThrow("does not expose");
  });
  it("builds inclusive date fields and rejects invalid dates", () => {
    const form = accelaRecentForm(fixture("lane-form"), "2026-10-03T15:22:00Z", "2026-10-10");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate")).toBe("10/03/2026");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate")).toBe("10/10/2026");
    expect(isoDate("2/29/2024")).toBe("2024-02-29");
    expect(isoDate("2/29/2025")).toBeNull();
    expect(isoDate("pending")).toBeNull();
    expect(() => accelaRecentForm(fixture("lane-form"), "2026-10-11", "2026-10-10")).toThrow("valid ISO date range");
  });
  it("normalizes real records without relabeling the ambiguous Date column as issuance", () => {
    const html = fixture("tampa-address");
    const records = parseAccelaRecords(html, ctx(), source("tampa-form"), source("tampa-address"));
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({permitNumber:"BTR-27-0633104",address:"2917 W Main St T 33607",status:"Issued",issuedAt:null,appliedAt:null,expiresAt:"2027-10-07",contractorName:null});
    expect(records[0].sourceUrl).toContain("agencyCode=TAMPA");
    expect(html).toContain(records[0].raw!.html);
  });
  it("parses contractor names, licenses and valuation from a real detail page", () => {
    const d = accelaDetailFields(fixture("tampa-detail"),"BTR-27-0633104",source("tampa-form"),source("tampa-detail"));
    expect(d).toMatchObject({Contractor:"DAVID Car RUSSELL / ACTION AIRCONDITIONING INC","Contractor license":"CAC042730","Job value":"11591.00"});
    const r = parseAccelaRecords(fixture("tampa-detail"),ctx(),source("tampa-form"),source("tampa-detail"))[0];
    expect(r.valuation).toBe(11591);
    expect(r.issuedAt).toBeNull();
    expect(accelaDetailFields(fixture("tampa-detail"),"W8061",source("tampa-form"),source("tampa-detail"))).toBeNull();
  });
  it("does not mistake redacted email or additional-professionals navigation for names", () => {
    const d = accelaDetailFields(fixture("lane-detail"),"509-BP26-02727",source("lane-form"),source("lane-detail"));
    expect(d).toMatchObject({Contractor:"RENEWABLE ELECTRIC LLC","Contractor license":"195934; C1229"});
  });
  it("distinguishes an actual no-results page from an unsubmitted form or login page", () => {
    expect(parseAccelaRecords(fixture("lane-no-records"),ctx("lane"),source("lane-form"),source("lane-no-records"))).toEqual([]);
    expect(() => parseAccelaRecords(fixture("lane-form"),ctx("lane"),source("lane-form"),source("lane-form"))).toThrow("neither records");
    expect(() => parseAccelaRecords(fixture("cobb-login"),ctx(),source("cobb-landing"),source("cobb-login"))).toThrow("neither records");
  });
  it("rejects Oregon aggregate results from agencies outside the configured URL", () => {
    expect(() => parseAccelaRecords(fixture("oregon-shared-results"),ctx(),source("oregon-shared-results"),source("oregon-shared-results"))).toThrow("outside the configured agency");
    expect(() => assertAccelaScope(source("lane-form"),source("tampa-detail"))).toThrow("outside");
  });
  it("binds a custom-host agency to the real ACA stylesheet declaration", () => {
    const code = accelaAgencyCode(source("cobb-landing"),fixture("cobb-landing"));
    expect(code).toBe("COBBCO");
    expect(() => assertAccelaScope(source("cobb-landing"),`${source("cobb-login")}&agencyCode=COBBCO`,code)).not.toThrow();
    expect(() => assertAccelaScope(source("cobb-landing"),`${source("cobb-login")}&agencyCode=LANE_CO`,code)).toThrow("outside");
    expect(() => assertAccelaScope(source("cobb-landing"),source("lane-detail"),code)).toThrow("outside");
  });
  it("rejects modern public portals, city information pages, and missing agency paths", () => {
    for (const u of ["https://aca-prod.accela.com/", "https://ftbragg-prod.accela.com/portal/core/index", "https://www.auroragov.org/business_services/aurora4biz", "http://www.buildingpermits.oregon.gov/"]) expect(() => accelaPortalUrl(u)).toThrow();
    expect(accelaPortalUrl("http://aca-oregon.accela.com/LANE_CO/")).toBe("https://aca-oregon.accela.com/LANE_CO/");
  });
  it("registers every declared platform alias case-insensitively", () => {
    for (const label of [adapter.platform,...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
  });
});

describe("offline HTTP workflow using recorded public responses", () => {
  it("searches without browser or storage and carries cookies into the postback", async () => {
    respond("tampa-form", {"set-cookie":"ASP.NET_SessionId=test-session; Path=/; HttpOnly"}); respond("tampa-address");
    const c = ctx();
    expect(await adapter.search(c,{type:"address",value:"2917 W Main St"})).toHaveLength(4);
    expect(c.browser).not.toHaveBeenCalled();
    const [url, init, options] = vi.mocked(politeFetch).mock.calls[1];
    expect(url).toBe(source("tampa-form"));
    expect(init!.method).toBe("POST");
    expect(new Headers(init!.headers).get("cookie")).toBe("ASP.NET_SessionId=test-session");
    expect(new URLSearchParams(init!.body as string).get("__EVENTTARGET")).toBe("ctl00$PlaceHolderMain$btnNewSearch");
    expect(options!.minDelayMs).toBe(1000);
  });
  it("discovers the Building link on a landing page", async () => {
    respond("tampa-landing"); respond("tampa-form"); respond("tampa-address");
    const c = {...ctx(),searchUrl:source("tampa-landing")};
    expect(await adapter.search(c,{type:"address",value:"2917 Main"})).toHaveLength(4);
    expect(vi.mocked(politeFetch).mock.calls[1][0]).toBe(source("tampa-form"));
  });
  it("follows all three actual result pages and returns 23 distinct permits", async () => {
    respond("lane-form"); for (let p=1;p<=3;p++) respond(`lane-address-page${p}`);
    const rows = await adapter.search(ctx("lane"),{type:"address",value:"89817 Territorial"});
    expect(rows).toHaveLength(23);
    expect(new Set(rows.map(r=>r.permitNumber)).size).toBe(23);
    expect(politeFetch).toHaveBeenCalledTimes(4);
  });
  it("throws rather than returning a truncated ten-page weekly listing", async () => {
    respond("sacramento-form"); for (let p=1;p<=10;p++) respond(`sacramento-week-page${p}`);
    await expect(adapter.listRecent(ctx("sacramento"),"2026-10-03")).rejects.toThrow("exceeds 10 pages");
    expect(politeFetch).toHaveBeenCalledTimes(11);
  },30000);
  it("rejects a repeated page", async () => {
    respond("lane-form"); respond("lane-address-page1"); respond("lane-address-page1");
    await expect(adapter.search(ctx("lane"),{type:"address",value:"89817 Territorial"})).rejects.toThrow("did not advance");
  });
  it("lists by the real date controls", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));
    respond("sacramento-form"); respond("sacramento-recent");
    expect(await adapter.listRecent(ctx("sacramento"),"2026-10-10")).toHaveLength(6);
    const form = new URLSearchParams(vi.mocked(politeFetch).mock.calls[1][1]!.body as string);
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate")).toBe("10/10/2026");
    expect(form.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate")).toBe("10/10/2026");
  });
  it("marks a tenant with no date controls unsupported without issuing searches", async () => {
    respond("boulder-form");
    const c = {...ctx(),searchUrl:source("boulder-form")};
    expect(await adapter.listRecent(c,"2026-10-03")).toEqual([]);
    expect(adapter.capabilities.listRecent).toBe(false);
    expect(c.log).toHaveBeenCalledWith(expect.stringContaining("recent listing unavailable"));
    expect(politeFetch).toHaveBeenCalledTimes(1);
  });
  it("selects Search by Licensed Professional and follows its permit association", async () => {
    respond("lane-form"); respond("lane-license-form"); respond("lane-license-results"); redirect("lane-detail"); respond("lane-detail");
    const rows = await adapter.search(ctx("lane"),{type:"license",value:"C1229"});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({permitNumber:"509-BP26-02727",contractorName:"RENEWABLE ELECTRIC LLC",contractorLicense:"195934; C1229"});
    const select = new URLSearchParams(vi.mocked(politeFetch).mock.calls[1][1]!.body as string);
    expect(select.get("ctl00$PlaceHolderMain$ddlSearchType")).toBe("2");
    const licensePost = new URLSearchParams(vi.mocked(politeFetch).mock.calls[2][1]!.body as string);
    expect(licensePost.get("ctl00$PlaceHolderMain$txtLicenseNumber")).toBe("C1229");
  });
  it("uses direct General Search company fields when no licensed-professional selector exists", async () => {
    respond("sacramento-form"); redirect("sacramento-detail"); respond("sacramento-detail");
    expect(await adapter.search(ctx("sacramento"),{type:"company",value:"ME AND CEE INC"})).toHaveLength(1);
    const body = new URLSearchParams(vi.mocked(politeFetch).mock.calls[1][1]!.body as string);
    expect(body.get("ctl00$PlaceHolderMain$generalSearchForm$txtGSBusiName")).toBe("ME AND CEE INC");
  });
  it("requires the exact permit number for detail", async () => {
    respond("tampa-form"); redirect("tampa-detail"); respond("tampa-detail");
    const r = await adapter.detail!(ctx(),"BTR-27-0633104");
    expect(r).toMatchObject({permitNumber:"BTR-27-0633104",contractorLicense:"CAC042730",valuation:11591});
  });
  it("keeps an explicitly reported grid expiration when detail omits it", async () => {
    respond("tampa-form"); respond("tampa-address"); respond("tampa-detail");
    const r = await adapter.detail!(ctx(),"BTR-27-0633104");
    expect(r).toMatchObject({permitNumber:"BTR-27-0633104",expiresAt:"2027-10-07",contractorLicense:"CAC042730"});
  });
  it("returns null detail only for an explicit no-result search", async () => {
    respond("lane-form"); respond("lane-no-records");
    expect(await adapter.detail!(ctx("lane"),"509-BP26-02727")).toBeNull();
  });
  it("propagates typed blocked errors without fabricating empty results", async () => {
    const error = new PortalBlockedError(source("tampa-form"),429);
    vi.mocked(politeFetch).mockRejectedValueOnce(error);
    await expect(adapter.search(ctx(),{type:"address",value:"2917 Main"})).rejects.toBe(error);
  });
  it("rejects cross-agency redirects before following them", async () => {
    redirect("lane-detail");
    await expect(adapter.search(ctx(),{type:"permit",value:"BTR-27-0633104"})).rejects.toThrow("outside");
    expect(politeFetch).toHaveBeenCalledTimes(1);
  });
  it("fails on login walls rather than treating them as no records", async () => {
    const c = {...ctx(),searchUrl:source("cobb-landing")};
    respond("cobb-landing"); redirect("cobb-login"); respond("cobb-login");
    await expect(adapter.search(c,{type:"address",value:"100 Main"})).rejects.toThrow("public search unavailable");
  });
});
