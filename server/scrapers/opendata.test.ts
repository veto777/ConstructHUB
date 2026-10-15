import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./polite-fetch", async (original) => {
  const json = vi.fn();
  return { ...await original<typeof import("./polite-fetch")>(), politeJson: json,
    politeFetch: vi.fn(async (...args: unknown[]) => new Response(JSON.stringify(await json(...args)))) };
});
import { politeJson, politeFetch, PortalBlockedError } from "./polite-fetch";
import adapter, { DATASETS, OPENDATA_JURISDICTIONS, buildQuery, contactsWhere, datasetFor, isoDate, keyWhere, parseRow, responseRows, searchWhere, recentWhere, PAGE_SIZE } from "./opendata";
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
      for (const f of d.companyFields ?? []) expect(d.fields[f], `${jurisdiction}: company field ${f}`).toBeTruthy();
      if (!d.contacts) continue;
      const c = d.contacts, contacts = provenance[jurisdiction].contacts;
      expect(contacts.id).toBe(c.id); expect(contacts.metadataUrl).toBe(c.metadataUrl);
      for (const field of [c.key, c.orderField, ...c.company, ...(c.person ?? []).flat(), ...(c.license ? [c.license] : []), ...(c.role ? [c.role.field] : [])]) {
        if (field !== ":id") expect(contacts.fieldNames, `${jurisdiction} contacts: ${field}`).toContain(field);
      }
    }
  });
  it("only the verified contacts datasets are configured", () => {
    expect(Object.keys(DATASETS).filter(j => DATASETS[j].contacts)).toEqual(["Los Angeles, CA", "San Francisco, CA", "Harris County, TX"]);
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
  it("company searches include the published permit holder / primary contact where that is the only name", () => {
    expect(searchWhere(DATASETS["San Diego, CA"],{type:"company",value:"IRONCORE CONSTRUCTION"})).toBe("((upper(APPROVAL_PERMIT_HOLDER) LIKE '%IRONCORE CONSTRUCTION%'))");
    expect(searchWhere(DATASETS["San Antonio, TX"],{type:"company",value:"Lennar Homes"})).toBe(`((upper("PRIMARY CONTACT") LIKE '%LENNAR HOMES%'))`);
    expect(()=>searchWhere(DATASETS["Fort Worth, TX"],{type:"company",value:"ACME"})).toThrow(/not published/);
  });
  it("builds contacts-dataset predicates with role filters and permit keys", () => {
    expect(contactsWhere(DATASETS["San Francisco, CA"],{type:"company",value:"O'Driscoll"})).toBe("(upper(role) IN ('CONTRACTOR')) AND (upper(firm_name) LIKE '%O''DRISCOLL%')");
    expect(contactsWhere(DATASETS["San Francisco, CA"],{type:"name",value:"Andrew Byrne"})).toContain("upper(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) LIKE '%ANDREW BYRNE%'");
    expect(contactsWhere(DATASETS["Los Angeles, CA"],{type:"company",value:"Pool Icons"})).toBe("(upper(contractors_business_name) LIKE '%POOL ICONS%')");
    expect(contactsWhere(DATASETS["Harris County, TX"],{type:"name",value:"Lennar"})).toBe("(upper(DBANAME) LIKE '%LENNAR%')");
    expect(()=>contactsWhere(DATASETS["San Francisco, CA"],{type:"company",value:"%"})).toThrow(/wildcards/);
    expect(()=>contactsWhere(DATASETS["San Francisco, CA"],{type:"address",value:"1 Main"})).toThrow();
    expect(keyWhere(DATASETS["Los Angeles, CA"],["23047-10000-01366","x'y"])).toBe("permit_nbr IN ('23047-10000-01366', 'x''y')");
    expect(keyWhere(DATASETS["Harris County, TX"],["2610070060"])).toBe("(PERMITNUMBER LIKE '2610070060-%')");
    expect(()=>keyWhere(DATASETS["Harris County, TX"],["26_1"])).toThrow(/metacharacters/);
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
    expect(()=>searchWhere(DATASETS["Los Angeles County, CA"],{type:"company",value:"ACME"})).toThrow(/not published/);
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
describe("contacts-dataset searches (recorded responses)", () => {
  it("San Francisco: contractor contacts, then permits by number", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture("San_Francisco__CA_contacts").filter((r: { role: string }) => r.role === "contractor"))
      .mockResolvedValueOnce(fixture("San_Francisco__CA_contact_permits"));
    const records = await adapter.search(ctx("San Francisco, CA"), {type:"company",value:"Terence Mcmahon"});
    expect(records).toHaveLength(1);
    expect(records[0].permitNumber).toBe("202610139351");
    expect(records[0].contractorName).toBe("Terence Mcmahon Construction");
    expect(records[0].contractorLicense).toBe("797580");
    const [contactsUrl, permitsUrl] = vi.mocked(politeJson).mock.calls.map(c => new URL(c[0] as string));
    expect(contactsUrl.pathname).toBe("/resource/3pee-9qhc.json");
    expect(contactsUrl.searchParams.get("$where")).toContain("upper(role) IN ('CONTRACTOR')");
    expect(permitsUrl.pathname).toBe("/resource/i98e-djp9.json");
    expect(permitsUrl.searchParams.get("$where")).toContain("permit_number IN ('202610139351')");
  });
  it("Los Angeles: certificate-of-occupancy contractor, then the permit", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture("Los_Angeles__CA_contacts")).mockResolvedValueOnce(fixture("Los_Angeles__CA_contact_permits"));
    const [record] = await adapter.search(ctx("Los Angeles, CA"), {type:"company",value:"POOL ICONS"});
    expect(record.permitNumber).toBe("23047-10000-01366");
    expect(record.address).toBe("5945 N HILLVIEW PARK AVE");
    expect(record.contractorName).toBe("POOL ICONS INC");
    expect(record.contractorLicense).toBe("479446");
  });
  it("Harris County: project applicant company, then every permit of the project", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture("Harris_County__TX_contacts")).mockResolvedValueOnce(fixture("Harris_County__TX_contact_permits"));
    const records = await adapter.search(ctx("Harris County, TX"), {type:"company",value:"Lennar Homes"});
    expect(records.map(r => r.permitNumber)).toEqual(["2610070060-RESB-001", "2610070060-RSW-001", "2610070060-RDW-001"]);
    expect(records.every(r => r.applicantName === "Lennar Homes" && r.contractorName === null)).toBe(true);
  });
  it("returns [] without a permit query when no contact matches", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce([]);
    expect(await adapter.search(ctx("San Francisco, CA"), {type:"company",value:"NO SUCH FIRM"})).toEqual([]);
    expect(vi.mocked(politeJson)).toHaveBeenCalledTimes(1);
  });
  it("keeps address searches on the main dataset only", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture("San_Francisco__CA_contact_permits"));
    expect(await adapter.search(ctx("San Francisco, CA"), {type:"address",value:"1 Main"})).toHaveLength(1);
    expect(new URL(vi.mocked(politeJson).mock.calls[0][0] as string).pathname).toBe("/resource/i98e-djp9.json");
  });
  it("accepts the publisher's former San Francisco domain as an alias", () => {
    expect(datasetFor({...ctx("San Francisco, CA"),searchUrl:"https://data.sfgov.org/resource/i98e-djp9.json"})).toBe(DATASETS["San Francisco, CA"]);
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
