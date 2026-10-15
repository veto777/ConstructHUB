import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
vi.mock("../storage", () => ({ storage: {} }));
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import adapter, { assertMyGovPage, MYGOV_NAME_REPORTS, myGovNameMatches, myGovReportAdapter, myGovReportDate, myGovTenant, parseMyGovLocations, parseMyGovModules, parseMyGovProjects, parseMyGovReport, readXlsxRows, stripContactDetails } from "./mygov";
const fixture = (file: string) => readFileSync(new URL(`./fixtures/mygov/${file}`, import.meta.url), "utf8");
const json = (file: string) => JSON.parse(fixture(file));
const ctx: AdapterCtx = { databaseId: 17, databaseName: "Crowley", jurisdiction: "Crowley, TX", searchUrl: "https://public.mygov.us/crowley_tx", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 5 } };
const fetchMock = vi.mocked(politeFetch);
function response(file: string, cookie?: string) { return new Response(fixture(file), { headers: cookie ? { "set-cookie": cookie } : {} }); }
function happyPath() {
  fetchMock.mockResolvedValueOnce(response("crowley-lookup.html", "PHPSESSID=test-session; Path=/; HttpOnly"))
    .mockResolvedValueOnce(response("crowley-412-locations.json"))
    .mockResolvedValueOnce(response("crowley-modules.json"))
    .mockResolvedValueOnce(response("crowley-projects.json"));
}
beforeEach(() => vi.resetAllMocks());
describe("MyGov recorded public lookup", () => {
  it("registers every target label with the correct vendor and disables alerts", async () => {
    const { getAdapter, supportsAlerts } = await import("./registry");
    for (const label of ["MyGov", "MyGov Permits & Licenses", "MyGov public portal", "MyGov permits"]) {
      expect(getAdapter(label.toUpperCase())).toBe(adapter);
      expect(supportsAlerts(label)).toBe(false);
    }
    for (const label of ["MGO Connect", "MyGovernmentOnline (MGO Connect)", "MyGovernmentOnline (MGO)"]) {
      expect(getAdapter(label)?.platform).toBe("MGO Connect");
      expect(supportsAlerts(label)).toBe(false);
    }
  });
  it("derives arbitrary tenant paths and refuses unrelated/legacy URLs", () => {
    expect(myGovTenant("http://public.mygov.us/wi_wisconsin_rapids/templates?module=pi")).toBe("https://public.mygov.us/wi_wisconsin_rapids");
    for (const url of ["https://public.mygov.us.evil.test/crowley_tx", "https://app.mygov.us/create_login_next.php?cityid=845", "https://public.mygov.us/", "https://user@public.mygov.us/crowley_tx"]) expect(() => myGovTenant(url)).toThrow();
  });
  it("preserves the real project JSON and does not reinterpret creation/completion as issue/application dates", () => {
    const data = json("crowley-projects.json");
    const rows = parseMyGovProjects(data, "412 E Main St, Crowley, TX 76036", ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ permitNumber: "24-000750", databaseId: 17, jurisdiction: "Crowley, TX", status: "Archived", issuedAt: null, appliedAt: null, sourceUrl: null, contractorName: null });
    expect(rows[0].raw).toBe(data.projects[0]);
    expect(parseMyGovProjects(json("russell-empty-projects.json"), "", ctx)).toEqual([]);
  });
  it("replays the public session and address/module/project requests", async () => {
    happyPath();
    expect(await adapter.search(ctx, { type: "address", value: "412 E Main" })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchMock.mock.calls;
    expect(calls[1][0]).toBe(`${ctx.searchUrl}/getLookupResults`);
    expect(String(calls[1][1]?.body)).toBe("address_search=412+E+Main");
    expect(new Headers(calls[1][1]?.headers).get("Cookie")).toBe("PHPSESSID=test-session");
    expect(String(calls[3][1]?.body)).toBe("location_id=8378&module=pi");
    expect(calls.every(call => call[2]?.minDelayMs === 1000)).toBe(true);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("returns no permits for the recorded Barling location with zero public projects", async () => {
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html"))
      .mockResolvedValueOnce(response("barling-main-locations.json"))
      .mockResolvedValueOnce(response("barling-modules.json"));
    expect(await adapter.search(ctx, { type: "address", value: "Main" })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("refuses broad results instead of silently truncating or crawling the town", async () => {
    expect(parseMyGovLocations(json("crowley-main-locations.json")).length).toBeGreaterThan(50);
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html")).mockResolvedValueOnce(response("crowley-main-locations.json"));
    await expect(adapter.search(ctx, { type: "address", value: "Main" })).rejects.toThrow("more specific address");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("throws for malformed/error payloads and missing permit identifiers", () => {
    expect(() => parseMyGovLocations({ error: "unavailable" })).toThrow();
    expect(() => parseMyGovModules({})).toThrow();
    expect(() => parseMyGovProjects({}, "", ctx)).toThrow();
    const data = json("crowley-projects.json");
    delete data.projects[0].code_id;
    expect(() => parseMyGovProjects(data, "", ctx)).toThrow();
    expect(() => assertMyGovPage("<title>Verify you are human</title>", ctx.searchUrl)).toThrow(PortalBlockedError);
    expect(() => assertMyGovPage("<title>Login</title>", ctx.searchUrl)).toThrow();
  });
  it("propagates blocks and incomplete responses rather than returning zero results", async () => {
    fetchMock.mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: "address", value: "412 E Main" })).rejects.toMatchObject({ status: 429 });
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html"))
      .mockResolvedValueOnce(response("crowley-412-locations.json"))
      .mockResolvedValueOnce(response("crowley-modules.json"))
      .mockResolvedValueOnce(response("russell-empty-projects.json"));
    await expect(adapter.search(ctx, { type: "address", value: "412 E Main" })).rejects.toThrow("incomplete");
  });
  it("does not search by unsupported fields or simulate recent permits", async () => {
    expect(adapter.capabilities).toEqual({ search: ["address"], listRecent: false, detail: false });
    await expect(adapter.search(ctx, { type: "permit", value: "24-000750" })).rejects.toThrow("does not support");
    await expect(adapter.search(ctx, { type: "company", value: "Smith" })).rejects.toThrow("does not support");
    expect(await adapter.listRecent(ctx, "2026-10-03")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const xlsx = (file: string) => readFileSync(new URL(`./fixtures/mygov/${file}`, import.meta.url));
const reportFile = (file: string, name: string) => new Response(xlsx(file), { headers: { "content-type": `application/octet-stream; name=${name}`, "content-disposition": `attachment; filename="${name}"` } });
const meta = (id: number) => ({ id, title: "t", url: `https://public.mygov.us/x/downloadReport?moduleName=pi&id=${id}` });
describe("MyGov name/company search over published tenant reports", () => {
  it("reads the real XLSX workbook (shared strings, Excel newline escapes, sparse cells)", () => {
    const rows = readXlsxRows(xlsx("crowley-report-313.xlsx"));
    expect(rows[0].slice(0, 2)).toEqual(["Template name", "Permit Number"]);
    expect(rows).toHaveLength(8);
    expect(rows[6][3]).toContain("no fees due.\n");
    expect(rows[1][8]).toBe("");
  });
  it("folds one-row-per-contact into one permit and keeps role-less names as listed names, never as contractor", () => {
    const records = parseMyGovReport(readXlsxRows(xlsx("crowley-report-313.xlsx")), meta(313), ctx);
    expect(records).toHaveLength(2);
    const r = records[0];
    expect(r).toMatchObject({ permitNumber: "24-001057", address: "900 Compass Rd", permitType: "Building Permit New (Residential)", issuedAt: "2025-10-06", expiresAt: "2027-02-24", appliedAt: null, valuation: 145200, contractorName: null, applicantName: null, ownerName: null, sourceUrl: meta(313).url });
    expect(r.raw?.listedNames).toEqual(["ERIC HARTLEY / Homepro Operating LLC", "Ignacio Vazquez / J&S Plumbing Services, LLC", "Michael Akins / J&S HVAC Services LLC", "Tingfu Qiao / Wan Pacific Real Estate", "Mark Talbott / Wanbridge Homes"]);
    // Contact details are never copied into the record.
    expect(JSON.stringify(r.raw)).not.toMatch(/Phone|Mobile|Mailing Address|Physical Address|redacted/);
    expect(r.raw?.report).toMatchObject({ id: 313, permits: 2, issuedFrom: "2025-10-06" });
  });
  it("keeps reused permit numbers apart when address and project differ (Texarkana)", () => {
    const records = parseMyGovReport(readXlsxRows(xlsx("texarkana-report-280.xlsx")), meta(280), ctx);
    expect(records).toHaveLength(4);
    const roof = records.find(r => r.address === "1924 W 13th")!;
    expect(roof.raw?.listedNames).toEqual(["Mr. Perez Perez Roofing"]);
    expect(myGovNameMatches("Perez Roofing", roof)).toBe(true);
    expect(myGovNameMatches("Bonefish Grill", roof)).toBe(false);
    expect(records.find(r => r.address === "3209 Mall Dr.")?.issuedAt).toBeNull();
  });
  it("maps the labelled Contractor Name column and splits role-tagged credential contacts (Little Elm)", () => {
    const records = parseMyGovReport(readXlsxRows(xlsx("little-elm-report-15.xlsx")), meta(15), ctx);
    const r = records.find(x => x.permitNumber === "26-002763")!;
    expect(r.contractorName).toBe("Warrior 153 Construction, LLC");
    expect(r.raw?.listedNames).toEqual(["John Davis Clogbusters (Plumbing Contractor)", "Robert Curras Warrior 153 Construction, LLC (General Contractor - Other)"]);
    expect(myGovNameMatches("warrior 153 construction", r)).toBe(true);
    expect(myGovNameMatches("John Curras", r)).toBe(false); // words from two different contacts
    expect(myGovNameMatches("Install bathroom", r)).toBe(false); // description is not a name field
  });
  it("strips phone and e-mail from the Applicant cell (Paris)", () => {
    const [r] = parseMyGovReport(readXlsxRows(xlsx("paris-report-372.xlsx")), meta(372), ctx);
    expect(r).toMatchObject({ permitNumber: "26-001306", applicantName: "Ilya Lukasevich, Roofing Ranger LLC", issuedAt: "2026-09-14", status: null });
    expect(stripContactDetails("A B, C LLC, (903) 555-1234, a@b.test")).toBe("A B, C LLC");
    expect(myGovReportDate("02/24/2027 at 3:51 PM")).toBe("2027-02-24");
    expect(myGovReportDate("2027-02-24")).toBeNull();
  });
  it("refuses reports without a permit number or name columns instead of inventing records", () => {
    expect(() => parseMyGovReport([["Permit Title", "Collaborators"], ["x", "y"]], meta(369), ctx)).toThrow("Permit Number");
    expect(() => parseMyGovReport([["Permit Number", "Permit Title"], ["1", "x"]], meta(1), ctx)).toThrow("no name columns");
  });
  it("downloads each verified report once and returns only whole-word name matches", async () => {
    const crowley = myGovReportAdapter("crowley_tx");
    expect(crowley.capabilities).toEqual({ search: ["address", "name", "company"], listRecent: false, detail: false });
    fetchMock.mockResolvedValueOnce(reportFile("crowley-report-313.xlsx", "Yearly Report of ALL Issued Permits (posted monthly) (Excel).xlsx"))
      .mockResolvedValueOnce(reportFile("crowley-report-313.xlsx", "Report of Open Permits (Excel).xlsx"));
    const hits = await crowley.search(ctx, { type: "company", value: "J&S Plumbing Services" });
    expect(hits.map(h => h.permitNumber)).toEqual(["24-001057"]);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      "https://public.mygov.us/crowley_tx/downloadReport?moduleName=pi&id=313",
      "https://public.mygov.us/crowley_tx/downloadReport?moduleName=pi&id=375",
    ]);
    expect(fetchMock.mock.calls.every(c => c[2]?.minDelayMs === 1000)).toBe(true);
    fetchMock.mockResolvedValueOnce(reportFile("crowley-report-313.xlsx", "Yearly Report of ALL Issued Permits (posted monthly) (Excel).xlsx"))
      .mockResolvedValueOnce(reportFile("crowley-report-313.xlsx", "Report of Open Permits (Excel).xlsx"));
    expect(await crowley.search(ctx, { type: "name", value: "Plumbing Smith" })).toEqual([]);
  });
  it("fails loudly when a report id was renamed or the stored URL is another tenant", async () => {
    const crowley = myGovReportAdapter("crowley_tx");
    fetchMock.mockResolvedValueOnce(reportFile("crowley-report-313.xlsx", "Garage Sales.xlsx"));
    await expect(crowley.search(ctx, { type: "company", value: "Homepro" })).rejects.toThrow("no longer");
    await expect(myGovReportAdapter("tx_abilene").search(ctx, { type: "company", value: "Homepro" })).rejects.toThrow("cannot serve");
    await expect(crowley.search(ctx, { type: "permit", value: "24-001057" })).rejects.toThrow("does not support");
    expect(() => myGovReportAdapter("canyon_tx")).toThrow();
  });
  it("registers report search only for the verified tenants' jurisdictions", async () => {
    const { getAdapterFor, getAdapter } = await import("./registry");
    for (const { jurisdiction } of Object.values(MYGOV_NAME_REPORTS)) {
      expect(getAdapterFor({ platform: "MyGov", jurisdiction }).capabilities.search).toEqual(["address", "name", "company"]);
    }
    expect(getAdapterFor({ platform: "MyGov", jurisdiction: "Canyon, TX" })).toBe(getAdapter("MyGov"));
    expect(getAdapter("MyGov")?.capabilities.search).toEqual(["address"]);
  });
});
