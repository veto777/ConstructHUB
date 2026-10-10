import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./polite-fetch", async (original) => {
  const json = vi.fn();
  return { ...await original<typeof import("./polite-fetch")>(), politeJson: json,
    politeFetch: vi.fn(async (...args: unknown[]) => new Response(JSON.stringify(await json(...args)))) };
});
import { politeJson, politeFetch, PortalBlockedError } from "./polite-fetch";
import adapter, { DATASETS, OPENDATA_JURISDICTIONS, buildQuery, datasetFor, isoDate, parseRow, responseRows, searchWhere, recentWhere, PAGE_SIZE } from "./opendata";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/opendata/${name}.json`, import.meta.url), "utf8"));
function ctx(jurisdiction = "Austin, TX"): AdapterCtx {
  const d = DATASETS[jurisdiction];
  return { jurisdiction, databaseId: 42, databaseName: jurisdiction, searchUrl: d.portalUrls[0] ?? d.url, portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 50 } };
}
beforeEach(() => { vi.mocked(politeJson).mockReset(); vi.mocked(politeFetch).mockClear(); });
describe("recorded government responses", () => {
  it("maps Socrata fields, links and raw without inventing missing values", () => {
    const raw = fixture("3syk-w9eu")[0];
    const record = parseRow(DATASETS["Austin, TX"], raw, ctx());
    expect(record.permitNumber).toBe("2026-123876 PP");
    expect(record.address).toBe("10941 TALLSALT DR");
    expect(record.issuedAt).toBe("2026-09-24");
    expect(record.contractorName).toBeNull();
    expect(record.valuation).toBeNull();
    expect(record.databaseId).toBe(42);
    expect(record.sourceUrl).toContain("t_selected_folderrsn=13775765");
    expect(record.raw).toBe(raw);
    expect(record).not.toHaveProperty("browser");
  });
  it("maps Chicago split address and monetary cost", () => {
    const record = parseRow(DATASETS["Chicago, IL"], fixture("ydr8-5enu")[0], ctx("Chicago, IL"));
    expect(record.permitNumber).toBe("101046020");
    expect(record.address).toBe("7529 N CLARK ST");
    expect(record.valuation).toBe(5500);
    expect(record.contractorName).toBe("3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY");
  });
  it("maps ArcGIS epoch dates and WGS84 geometry, retaining the entire feature", () => {
    const d=DATASETS["Minneapolis, MN"], payload=fixture("Minneapolis__MN");
    const raw=responseRows(d,payload).rows[0]; const record=parseRow(d,raw,ctx("Minneapolis, MN"));
    expect(record.permitNumber).toBe("BLDG716044");
    expect(record.address).toBe("1 1ST ST S");
    expect(record.issuedAt).toBe(new Date(1530179304000).toISOString());
    expect(record.valuation).toBe(0);
    expect(record.raw).toBe(raw);
    expect(record.lat).toBeCloseTo(44.98295);
  });
  it("maps Carto records without misinterpreting projected coordinates as latitude", () => {
    const d=DATASETS["Philadelphia, PA"], payload=fixture("Philadelphia__PA");
    const record=parseRow(d,responseRows(d,payload).rows[0],ctx("Philadelphia, PA"));
    expect(record.permitNumber).toBe("EP-2024-003069");
    expect(record.contractorName).toBe("FRED DINARDO JR");
    expect(record.lng).toBeNull();
  });
  it("maps CKAN monetary strings and absent contractor", () => {
    const d=DATASETS["Boston, MA"], payload=fixture("Boston__MA");
    const record=parseRow(d,responseRows(d,payload).rows[0],ctx("Boston, MA"));
    expect(record.permitNumber).toBe("A1004007");
    expect(record.valuation).toBe(5000);
    expect(record.contractorName).toBeNull();
  });
});
describe("verified metadata", () => {
  it("every mapped field exists in its recorded official schema", () => {
    const provenance = fixture("provenance");
    expect(Object.keys(DATASETS)).toHaveLength(40);
    for (const [jurisdiction, d] of Object.entries(DATASETS)) {
      const names = provenance[jurisdiction].fieldNames;
      for (const field of [d.dateField, ...Object.values(d.fields).flat(), ...(d.contractorContacts ?? []).flatMap(c => [c.name, c.type])]) expect(names, `${jurisdiction}: ${field}`).toContain(field);
    }
  });
});
describe("native queries", () => {
  it.each(["Austin, TX","Minneapolis, MN","Philadelphia, PA","Boston, MA"])("escapes SQL literals for %s", jurisdiction => {
    const d=DATASETS[jurisdiction];
    expect(searchWhere(d,{type:"address",value:"O'Brien"})).toContain("O''BRIEN");
    const u=new URL(buildQuery(d,recentWhere(d,"2026-10-03T12:30:00Z"),1000));
    expect(decodeURIComponent(u.href)).toContain("2026-10-03");
    expect(u.href).toContain("1000");
  });
  it("replays calendar-day feeds for hourly polling without inventing timezones", () => {
    expect(recentWhere(DATASETS["New York, NY"],"2026-10-10T17:00:00Z")).toBe("issued_date >= '2026-10-10'");
    expect(isoDate("2026-10-10T12:15:30.000")).toBe("2026-10-10T12:15:30.000");
    expect(isoDate("2026-10-10T00:00:00.000")).toBe("2026-10-10");
  });
  it("uses ArcGIS DATE for date-only columns", () => expect(recentWhere(DATASETS["Detroit, MI"],"2026-10-03")).toBe("issued_date >= DATE '2026-10-03'"));
  it("restricts Chicago company searches to contractor contacts", () => {
    const where = searchWhere(DATASETS["Chicago, IL"], {type:"company",value:"3 S SUPPLY COMPANY"});
    expect(where).toContain("upper(contact_1_type) LIKE 'CONTRACTOR%'");
    expect(where).toContain("upper(contact_15_name)");
  });
  it("queries split ArcGIS addresses without unsupported SQL concatenation", () => {
    const where=searchWhere(DATASETS["Las Vegas, NV"],{type:"address",value:"10101 BANBURRY CROSS DR"});
    expect(where).toContain("STNO = 10101"); expect(where).not.toContain("CAST");
    expect(searchWhere(DATASETS["Las Vegas, NV"], {type:"keyword",value:"BANBURRY"})).not.toContain("CAST");
  });
  it("rejects invalid dates, blank queries and caller wildcard scans", () => {
    const d=DATASETS["Austin, TX"];
    expect(()=>recentWhere(d,"nonsense")).toThrow();
    expect(()=>recentWhere(d,"2026-02-31")).toThrow();
    expect(()=>searchWhere(d,{type:"address",value:" "})).toThrow();
    expect(()=>searchWhere(d,{type:"address",value:"%"})).toThrow();
    expect(()=>searchWhere(DATASETS["Los Angeles, CA"],{type:"company",value:"ACME"})).toThrow(/not published/);
  });
  it("uses exact jurisdiction plus authorized URL, including shared-host tenant paths", () => {
    expect(datasetFor(ctx())).toBe(DATASETS["Austin, TX"]);
    expect(()=>datasetFor({...ctx(),searchUrl:"https://example.com"})).toThrow();
    expect(()=>datasetFor({...ctx("Columbus, OH"),searchUrl:DATASETS["Fort Worth, TX"].portalUrls[0]})).toThrow();
    expect(()=>datasetFor({...ctx(),jurisdiction:"Austin, IN"})).toThrow();
  });
  it("exports one platform with no aliases", () => {
    expect(OPENDATA_JURISDICTIONS).toEqual(Object.keys(DATASETS));
    expect(adapter.platform).toBe("Open data"); expect(adapter.aliases??[]).toEqual([]);
    expect(adapter.capabilities.listRecent).toBe(true);
  });
});
describe("failure and pagination semantics", () => {
  it("recognizes HTTP 200 HTML CAPTCHA challenges", async () => {
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response("<html>Cloudflare CAPTCHA</html>"));
    await expect(adapter.listRecent(ctx(), "2026-10-03")).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("only genuine empty results return []", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce([]);
    expect(await adapter.search(ctx(),{type:"permit",value:"NOT-A-PERMIT"})).toEqual([]);
    vi.mocked(politeJson).mockResolvedValueOnce({message:"broken"});
    await expect(adapter.listRecent(ctx(),"2026-10-03")).rejects.toThrow(/Malformed/);
  });
  it("propagates blocked requests and API-level auth failures", async () => {
    vi.mocked(politeJson).mockRejectedValueOnce(new PortalBlockedError("https://example.com",429));
    await expect(adapter.listRecent(ctx(),"2026-10-03")).rejects.toBeInstanceOf(PortalBlockedError);
    expect(()=>responseRows(DATASETS["Miami-Dade County, FL"],{error:{code:499,message:"Token required"}})).toThrow(PortalBlockedError);
    expect(()=>responseRows(DATASETS["Boston, MA"],{success:false,error:{message:"SQL failed"}})).toThrow();
  });
  it("paginates at 1000 rows and enforces minimum politeness", async () => {
    const raw=fixture("3syk-w9eu")[0];
    vi.mocked(politeJson).mockResolvedValueOnce(Array.from({length:PAGE_SIZE},()=>raw)).mockResolvedValueOnce([raw]);
    const records=await adapter.listRecent(ctx(),"2026-10-03");
    expect(records).toHaveLength(1001);
    const call=vi.mocked(politeJson).mock.calls[1];
    expect(new URL(call[0]).searchParams.get("$offset")).toBe("1000");
    expect(call[2]?.minDelayMs).toBe(1000);
  });
  it("honors transfer-limit flags even on shorter ArcGIS pages", async () => {
    const raw=fixture("Minneapolis__MN").features;
    vi.mocked(politeJson).mockResolvedValueOnce({features:[raw[0]],exceededTransferLimit:true}).mockResolvedValueOnce({features:[raw[1]],exceededTransferLimit:false});
    expect(await adapter.listRecent(ctx("Minneapolis, MN"),"2026-10-03")).toHaveLength(2);
    expect(new URL(vi.mocked(politeJson).mock.calls[1][0]).searchParams.get("resultOffset")).toBe("1");
  });
  it("fails when the server ignores pagination", async () => {
    const raw=fixture("Minneapolis__MN").features;
    vi.mocked(politeJson).mockResolvedValue({features:raw,exceededTransferLimit:true});
    await expect(adapter.listRecent(ctx("Minneapolis, MN"),"2026-10-03")).rejects.toThrow(/ignored pagination/);
  });
  it("fails on missing permit identifiers instead of silently dropping records", () => expect(()=>parseRow(DATASETS["Austin, TX"],{},ctx())).toThrow(/no permit number/));
  it("does not publish projected coordinates as latitude or longitude", () => {
    const raw = fixture("Minneapolis__MN").features[0];
    const copy = structuredClone(raw);
    copy.attributes.Latitude = 3000000; copy.attributes.Longitude = 3000000;
    const record = parseRow(DATASETS["Minneapolis, MN"],copy,ctx("Minneapolis, MN"));
    expect(record.lat).toBeNull(); expect(record.lng).toBeNull();
  });
  it("keeps unknown dates null", () => {expect(isoDate(null)).toBeNull();expect(isoDate("not a date")).toBeNull();});
});
