import { describe, expect, it } from "vitest";
import { parseLaDetail, parseLaResults, parseLaViolations } from "./la";

// Snippets of arlspublic.lslbc.louisiana.gov and lslbc.gov pages saved 2026-10-15.
const QP = `<tbody><tr><td><a onclick="ShowAccountDetails('Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d',  );" href="#void">Flower, Paul</a></td>
<td><a onclick="ShowAccountDetails('Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d', );" href="#void"> WOODWARD DESIGN + BUILD, LLC</a></td><td>New Orleans</td><td>LA</td></tr></tbody>`;
const DETAIL = `<fieldset><legend>Contractor Information</legend><div class="display-label">Name</div><div class="display-field">WOODWARD DESIGN + BUILD, LLC</div>
<div class="display-label">Mailing Address</div><div class="display-field">P O Box 13547<br />New Orleans, LA  70185</div>
<div class="display-label">Phone Number</div><div class="display-field">(504) 822-6443</div></fieldset>
<fieldset><legend>Licenses</legend><div id="ContactDiv"><div class="display-label">License</div><div class="display-field">CL.00424</div>
<div class="display-label">Type</div><div class="display-field">Commercial License Certificate</div>
<div class="display-label">Status</div><div class="display-field"><span style='color: Black;'>Active</span></div>
<div class="display-label">Expiration Date</div><div class="display-field">10/27/2027</div></div>
<table id="ClassificationListing"><thead><tr><th>Class</th><th>Qualifying Party</th></tr></thead><tr><td>BUILDING CONSTRUCTION</td><td>Paul H. Flower</td></tr></table>`;
const VIOLATIONS = `<table id="tablepress-1"><tr class="row-2"><td class="column-1">MPL Concrete Finishing LLC</td><td class="column-2">Hammond, Louisiana</td><td class="column-3">6/18/2026</td><td class="column-4">2025-0007-02</td><td class="column-5"> Bidding or conducting work without the proper license</td><td class="column-6">Found guilty, fines and assessed costs.</td></tr></table>`;

describe("Louisiana LSLBC parsers", () => {
  it("keeps the company of a qualifier row", () => {
    // The qualifier is kept too, so a person search fetches only the companies this person qualifies.
    expect(parseLaResults(QP)).toEqual([{ key: "Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d", name: "WOODWARD DESIGN + BUILD, LLC", qualifiers: ["Flower, Paul"] }]);
  });
  it("reads a detail page", () => {
    expect(parseLaDetail(DETAIL)).toEqual({
      name: "WOODWARD DESIGN + BUILD, LLC", city: "New Orleans, LA", address: "P O Box 13547, New Orleans, LA 70185", phone: "(504) 822-6443",
      licenses: [{ number: "CL.00424", type: "Commercial License Certificate", status: "Active", expires: "2027-10-27" }],
      classes: [{ cls: "BUILDING CONSTRUCTION", qualifier: "Paul H. Flower" }],
    });
  });
  it("reads the violations table", () => {
    expect(parseLaViolations(VIOLATIONS)[0]).toMatchObject({ name: "MPL Concrete Finishing LLC", id: "2025-0007-02", date: "2026-06-18", city: "Hammond, Louisiana", adverse: true });
  });
});

describe("LA audit fixes (2026-10-15)", () => {
  it("searchBy says null for what the board can't search by", async () => {
    const { searchLslbcBy } = await import("./la");
    expect(await searchLslbcBy({ type: "phone", value: "(504) 822-6443" })).toBeNull();
    expect(await searchLslbcBy({ type: "address", value: "1 Canal St, New Orleans" })).toBeNull();
  });
});

// public.spbla.com/license/datatable, fetched 2026-10-15 (two rows, trimmed to the fields read): a company search
// for "roto-rooter" (MP1614) and a plumber search for "smith" (MP1784, employer "Retired").
const SPBLA_JSON = {"draw": 1, "recordsTotal": 8671, "recordsFiltered": 2, "data": [{"license_number": "MP1614", "license_type": "Master Plumber", "person_name_first": "Michael", "person_name_last": "Murray", "employer": "Murray Plumbing Inc Dba Roto-Rooter Plumbers\n", "address": "4925 Shed Rd<br />\nBossier City, LA 71111\n", "details": "<p class=\"d-block d-md-none\">\n    <b>MP1614</b><br />\n    Master Plumber</br>Active</br>WSPS</p>\n\n<p>\n        <b>Murray Plumbing Inc Dba Roto-Rooter Plumbers</b><br />\n        Michael Murray<br />\n        (318) 746-6741<br />\n        Bossier Parish</p>\n\n\n<p class=\"d-block d-lg-none\">\n    4925 Shed Rd<br />\nBossier City, LA 71111\n</p>\n", "license_status": "<i class=\"fas fa-check\" title=\"Current\" data-toggle=\"tooltip\" data-placement=\"top\"></i>", "license_type_status": "Master Plumber</br>Active</br>WSPS", "expiration_date": {"\u0000App\\Options\\DateTimeOption\u0000_inner_value": {"\u0000*\u0000endOfTime": false, "date": "2026-12-31 00:00:00.000000", "timezone": "America/Chicago"}}}, {"license_number": "MP1784", "license_type": "Master Plumber", "person_name_first": "Steven", "person_name_last": "Smith", "employer": "Retired\n", "address": "<br />\n, LA \n", "details": "<p class=\"d-block d-md-none\">\n    <b>MP1784</b><br />\n    Master Plumber</br>Inactive</p>\n\n<p>\n        <b>Retired</b><br />\n        Steven Smith<br />\n        <br />\n        </p>\n\n\n<p class=\"d-block d-lg-none\">\n    <br />\n, LA \n</p>\n", "license_status": "<i class=\"fas fa-pause\" title=\"Inactive\" data-toggle=\"tooltip\" data-placement=\"top\"></i>", "license_type_status": "Master Plumber</br>Inactive", "expiration_date": {"\u0000App\\Options\\DateTimeOption\u0000_inner_value": {"\u0000*\u0000endOfTime": false, "date": "2026-12-31 00:00:00.000000", "timezone": "America/Chicago"}}}]};

describe("Louisiana State Plumbing Board roster", () => {
  it("reads a row as the plumber's own license, with the employer, flags and expiration", async () => {
    const { spblaHit } = await import("./la");
    expect(spblaHit(SPBLA_JSON.data[0], "business")).toEqual({
      state: "LA", source: "Louisiana State Plumbing Board licenses", sourceUrl: "https://public.spbla.com/",
      businessName: "Murray Plumbing Inc Dba Roto-Rooter Plumbers", licenseNumber: "MP1614", licenseType: "Master Plumber",
      specialty: "WSPS", status: "Current, Active", principal: "Michael Murray", city: "Bossier City, LA", expires: "2026-12-31",
      matchedOn: "business", address: "4925 Shed Rd, Bossier City, LA 71111", phone: "(318) 746-6741",
      people: [{ name: "Michael Murray", role: "Master Plumber" }], holder: "individual",
    });
  });
  it("names no employer for \"Retired\" and keeps no address when none is listed", async () => {
    const { spblaHit } = await import("./la");
    expect(spblaHit(SPBLA_JSON.data[1], "principal")).toMatchObject({
      businessName: null, licenseNumber: "MP1784", status: "Inactive", principal: "Steven Smith", city: null, address: null, phone: null, specialty: null,
    });
  });
  it("reads the board's serialized dates", async () => {
    const { spblaDay } = await import("./la");
    expect(spblaDay(SPBLA_JSON.data[0].expiration_date)).toBe("2026-12-31");
    expect(spblaDay([])).toBeNull();
    expect(spblaDay({ "\u0000App\\Options\\DateTimeOption\u0000_inner_value": { "\u0000*\u0000endOfTime": true, date: "9999-12-31 00:00:00" } })).toBeNull();
  });
  it("searches a company by its most distinctive word, leaving out Plumbing and suffixes", async () => {
    const { spblaCompanyWord } = await import("./la");
    expect(spblaCompanyWord("Murray Plumbing Inc")).toBe("MURRAY");
    expect(spblaCompanyWord("Roto-Rooter Service Co.")).toBe("ROTO-ROOTER");
    expect(spblaCompanyWord("Plumbing LLC")).toBeNull();
  });
  it("searches the datatable and keeps only whole-name matches (mocked fetch)", async () => {
    const { vi } = await import("vitest");
    const { searchSpbla, searchSpblaBy } = await import("./la");
    const { resetHostState } = await import("../http");
    resetHostState();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /", { status: 200 });
      return new Response(JSON.stringify(SPBLA_JSON), { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      const hits = await searchSpbla("Murray Plumbing Inc", "company");
      expect(hits.map((h) => h.licenseNumber)).toEqual(["MP1614"]);
      const q = new URL(urls.find((u) => u.includes("/license/datatable"))!);
      expect(q.searchParams.get("filter[employer_name]")).toBe("MURRAY");
      expect((await searchSpbla("Steven Smith", "person")).map((h) => h.licenseNumber)).toEqual(["MP1784"]);
      expect(await searchSpbla("Smith", "person")).toEqual([]); // one word is not a person's name
      expect((await searchSpblaBy({ type: "license", value: "MP1614" }))!.map((h) => h.licenseNumber)).toEqual(["MP1614"]);
      expect(await searchSpblaBy({ type: "license", value: "JP1614" })).toEqual([]); // a typed prefix must agree
    } finally { vi.unstubAllGlobals(); resetHostState(); }
  });
  it("can't search by phone or address, and is registered in the pack", async () => {
    const { searchSpblaBy, pack } = await import("./la");
    expect(await searchSpblaBy({ type: "phone", value: "(318) 746-6741" })).toBeNull();
    expect(await searchSpblaBy({ type: "address", value: "4925 Shed Rd, Bossier City" })).toBeNull();
    expect(pack.liveLicenses!.map((l) => l.source)).toContain("Louisiana State Plumbing Board licenses");
    expect(pack.blocked!.some((b) => /spbla/i.test(b))).toBe(false);
  });
});
