import { afterEach, describe, expect, it, vi } from "vitest";
import { clbActionBusinesses, clbActionHit, clbHit, clbQuery, evsBusinesses, longDates, pack, parseClbActions, parseEvs, parseWvDebar, sfmHits, wvDebarBusinesses, wvDebarHit } from "./wv";

// Saved from the live sources on 2026-10-15.
const SFM_ROWS = [
  { FirstName: "BRADLEY", LastName: "SHAFFER", State: "WV", Suffix: null, LicenseNumber: "J92921915580211", LicenseType: "JOURNEYMAN,ELECTRICIAN", CertificationExpirationDate: "30-06-2024", City: "EGLON" },
  { FirstName: "BRADLEY", LastName: "SHAFFER", State: "WV", Suffix: null, LicenseNumber: "J92921915580211", LicenseType: "JOURNEYMAN,ELECTRICIAN", CertificationExpirationDate: "30-06-2027", City: "EGLON" },
];

// Trimmed from www.state.wv.us/admin/purchase/debar.html, 2026-10-15 (five of its 30 rows, as published).
const DEBAR_PAGE = `<p>Below is a list of vendors who are currently debarred
from doing business with the State of West Virginia. </p>
<table alt="Debarred Vendor Listings" width="100%" border="1">
  <tbody>
    <tr class="auto-style2">
      <td><strong>Vendor Name</strong></td>
      <td><strong>Vendor Address</strong></td>
      <td><strong>Debarment Date</strong></td>
      <td><strong>Debarment Period</strong></td>
      <td><strong>Debarment Scope</strong></td>
    </tr>
    <tr class="auto-style2">
      <td><strong>Andrew P. Nichols</strong></td>
      <td>732 Nursery Lane<br>
        Lesage, WV 25537<br>
        OR<br>
        RR 1, 407H<br>
      Lesage, WV 25537</td>
      <td>October 13, 2017;<br>
      updated April 29, 2022</td>
      <td>Permanent</td>
      <td>All Commodities and Services except for work as an employee of Marshall University and its affiliated research entities.</td>
    </tr>
    <tr class="auto-style2">
      <td><strong>Backwoods Trucking</strong></td>
      <td><p>P.O. Box 394<br>
        Raysal, WV 24879</p>
        <p>90480 Jamie Drive<br>
      Bradshaw, WV 24817</p></td>
      <td>April 20, 2021</td>
      <td>Permanent</td>
      <td>All Commodities and Services</td>
    </tr>
    <tr class="auto-style2">
      <td><strong>Bayliss &amp; Ramey, Inc.</strong></td>
      <td>145 Vaughan Drive<br>
      Fraziers Bottom, WV 25082</td>
      <td>September 28, 2017</td>
      <td>Permanent</td>
      <td>All Commodities and Services</td>
    </tr>
    <tr class="auto-style2">
      <td><strong>May Baqai<br>
      Individually and as Notice of Process Recipient for Planet Cellular Inc.</strong></td>
      <td>1919 NW 137th Way<br>
      Pembroke Pines, FL 33028</td>
      <td>September 8, 2022</td>
      <td>Permanent</td>
      <td>All Commodities and Services</td>
    </tr>
    <tr class="auto-style2">
      <td><strong>Nancy Kennedy</strong></td>
      <td><p>P.O. Box 394<br>
        Raysal, WV 24879</p>
        <p>90480 Jamie Drive<br>
      Bradshaw, WV 24817</p></td>
      <td>April 20,2021</td>
      <td>Permanent</td>
      <td>All Commodities and Services</td>
    </tr>
  </tbody>
</table>`;

const EVS_PAGE = `<TABLE class="table table-bordered">
\t<tr style="background-color:lightgoldenrodyellow;color:blue !important;font-weight:bolder;">
\t\t<td>Business Name</td>
\t\t<td>Owner Name</td>
\t\t<td>City</td>
\t\t<td>State</td>
\t\t<td>FEIN</td>
\t</tr>
<tr>
\t<td valign="top"> A & A SANDS CONSTRUCTION INC&nbsp;</td>
\t<td valign="top"> , &nbsp;</td>
\t<td valign="top"> WILLIAMSTOWN&nbsp;</td>
\t<td valign="top"> WV&nbsp;</td>
\t<td valign="top"> *****4532&nbsp;</td>
</tr>
</TABLE>`;

describe("West Virginia sources", () => {
  it("keeps the latest certification period of each electrician license", () => {
    const hits = sfmHits(SFM_ROWS, "principal");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ licenseNumber: "J92921915580211", licenseType: "JOURNEYMAN ELECTRICIAN", expires: "2027-06-30", city: "EGLON, WV", principal: "BRADLEY SHAFFER" });
  });

  it("reads Employer Violator System rows without the owner", () => {
    expect(parseEvs(EVS_PAGE)[0]).toEqual({ name: "A & A SANDS CONSTRUCTION INC", city: "WILLIAMSTOWN", state: "WV", fein: "*****4532" });
  });

  it("leaves out an EVS row whose business name is a person's own (FCRA)", () => {
    expect(evsBusinesses(EVS_PAGE).map((r) => r.name)).toEqual(["A & A SANDS CONSTRUCTION INC"]);
  });

  describe("the Fire Marshal search", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("sends no header posing as the site's own page, and says when it can't search an identifier", async () => {
      const calls: { url: string; headers: Headers }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), headers: new Headers(init.headers) });
        if (String(url).endsWith("/robots.txt")) return new Response("", { status: 404 });
        return new Response(JSON.stringify({ Data: SFM_ROWS }), { status: 200, headers: { "content-type": "application/json" } });
      }));
      const sfm = pack.liveLicenses!.find((s) => /Fire Marshal/.test(s.source))!;
      expect(await sfm.searchBy!({ type: "phone", value: "304 555 0100" })).toBeNull();
      const hits = await sfm.searchBy!({ type: "license", value: "J92921915580211" });
      expect(hits).toHaveLength(1);
      const post = calls.find((c) => /LicenseeSearch_Read/.test(c.url))!;
      expect(post.headers.has("x-requested-with")).toBe(false);
      expect(post.headers.has("referer")).toBe(false);
      expect(post.headers.has("origin")).toBe(false);
      expect(post.headers.get("user-agent")).toMatch(/ConstructHUB-PermitBot/);
    });
  });
});

describe("WV Purchasing Division debarred vendors", () => {
  it("reads every row with its first City, ST line and the published dates", () => {
    const rows = parseWvDebar(DEBAR_PAGE);
    expect(rows.map((r) => r.name)).toEqual(["Andrew P. Nichols", "Backwoods Trucking", "Bayliss & Ramey, Inc.", "May Baqai Individually and as Notice of Process Recipient for Planet Cellular Inc.", "Nancy Kennedy"]);
    expect(rows[1]).toMatchObject({ city: "Raysal, WV", period: "Permanent", scope: "All Commodities and Services" });
    expect(longDates("October 13, 2017; updated April 29, 2022")).toEqual(["2017-10-13", "2022-04-29"]);
    expect(longDates("April 20,2021")).toEqual(["2021-04-20"]);
  });
  it("keeps businesses only: named people and \"… Individually and as …\" rows are left out (FCRA)", () => {
    expect(wvDebarBusinesses(parseWvDebar(DEBAR_PAGE)).map((r) => r.name)).toEqual(["Backwoods Trucking", "Bayliss & Ramey, Inc."]);
  });
  it("a hit is a current debarment with the period and scope as published, and no street", () => {
    const [b] = wvDebarBusinesses(parseWvDebar(DEBAR_PAGE)).filter((r) => /Bayliss/.test(r.name));
    const hit = wvDebarHit(b);
    expect(hit).toMatchObject({ name: "Bayliss & Ramey, Inc.", category: "debarment", date: "2017-09-28", endDate: null, city: "Fraziers Bottom, WV", adverse: true,
      status: "Debarred from doing business with the State of West Virginia (debarment period: Permanent)", detail: "Scope: All Commodities and Services" });
    expect(hit.address).toBeUndefined();
  });
  it("a page without the table is an error, not zero debarments", () => {
    expect(() => parseWvDebar("<html>Service unavailable</html>")).toThrow(/unexpected page/);
  });
});

describe("West Virginia (audit round 2)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("the Division of Labor lists are not searched while www.wvlabor.com's robots.txt can't be read", () => {
    expect(pack.liveLicenses!.map((s) => s.source)).toEqual(["WV State Fire Marshal electrician licenses", "WV Contractor Licensing Board contractor licenses"]);
    expect(pack.blocked!.some((b) => /wvlabor\.com.*HTTP 500/.test(b))).toBe(true);
  });
  it("the person-only lookups say so, and their licenses are individuals' (decisions 2, 8)", () => {
    expect(pack.liveLicenses!.find((s) => /Fire Marshal/.test(s.source))!.kinds).toEqual(["person"]);
    expect(sfmHits(SFM_ROWS as any, "principal").every((h) => h.holder === "individual")).toBe(true);
  });
  it("an EVS access denial stops the load at once, as a PortalBlockedError, with no retry (decision 6)", async () => {
    const { PortalBlockedError, resetHostState } = await import("../http");
    resetHostState();
    let pages = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/robots.txt")) return new Response("", { status: 404 });
      pages++;
      return new Response("denied", { status: 403 });
    }));
    const evs = pack.bulk!.find((b) => b.id === "wv-oic-evs")!;
    const it = evs.load()[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBeInstanceOf(PortalBlockedError);
    expect(pages).toBe(1);
    resetHostState();
  });
});

// Trimmed from wvclboard.wv.gov/verify/ajax/ (action=verifySearch busiName=March, then verifyPage), 2026-10-15.
const CLB_COUNT = `{\n    "records": [\n        {\n            "count": 2\n        }\n    ]\n}`;
const CLB_ROWS = [
  { license: "WV001838", company: "MARCH-WESTIN COMPANY INC", dba: "", address: "360 FRONTIER AVENUE", city: "MORGANTOWN", state: "WV", zip: "26505", county: "MONONGALIA", phone: "(304) 599-4880", class: "ELECTRICAL; GENERAL BUILDING; GENERAL ENGINEERING; HVAC; PIPING; PLUMBING; SPECIALTY", expires: "8/21/2027" },
  { license: "WV044047", company: "RANDALL A MARCHESI", dba: "RANDALL A MARCHESI FLOORING", address: "1799 RIDGEWOOD DRIVE", city: "WASHINGTON", state: "PA", zip: "15301", county: "OUT OF STATE", phone: "(412) 217-1642", class: "SPECIALTY; FLOOR COVERING; CARPET INSTALLATION", expires: "5/25/2027" },
];

// Trimmed from wvclboard.wv.gov/about/actions.asp, 2026-10-15 (five of its 57 rows, as published).
const CLB_ACTIONS_PAGE = `<p>The following disciplinary actions have been taken by the WV Contractor Licensing Board:&nbsp;</p>
<table cellpadding="1" cellspacing="1" class="table" style="width:100%;">
	<thead>
		<tr>
			<th scope="col"><strong>Date of Board Decision</strong></th>
			<th scope="col"><strong>License #</strong></th>
			<th scope="col"><strong>&nbsp;Licensee</strong></th>
			<th scope="col"><strong>Final Order</strong></th>
		</tr>
	</thead>
	<tbody>
	</tbody>
	<tbody>
		<tr>
			<td>April 17, 2025</td>
			<td>WV064033</td>
			<td>AMERICAN MEP INC</td>
			<td><a href="https://wvclboard.wv.gov/www/download_resource.asp?id=181" target="_blank">April 17, 2025</a></td>
		</tr>
	</tbody>
	<tbody>
		<tr>
			<td>April 17, 2025</td>
			<td>WV061907</td>
			<td>QUESENBERRY&#39;S CONSTRUCTION LLC</td>
			<td><a href="https://wvclboard.wv.gov/www/download_resource.asp?id=189" target="_blank">April 17, 2025</a></td>
		</tr>
	</tbody>
	<tbody>
    <tbody>
		<tr>
			<td>April 17, 2025</td>
			<td>WV062785/WV064411</td>
			<td>PRIME EXTERIORS LLC & IRONCLAD CONSTRUCTION LLC</td>
			<td><a href="https://wvclboard.wv.gov/www/download_resource.asp?id=191" target="_blank">April 17, 2025</a></td>
		</tr>
	</tbody>
	<tbody>
		<tr>
			<td>June 13, 2024</td>
			<td>WV032163</td>
			<td>BRANDON BALLARD DBA WV CONCRETE</td>
			<td><a href="https://wvclboard.wv.gov/www/download_resource.asp?id=129" target="_blank">June 14, 2024</a></td>
		</tr>
	</tbody>
	<tbody>
		<tr>
			<td>August 25, 2022</td>
			<td>WV053132</td>
			<td>BENTZ PROPERTY & CONTRACTING LLC</td>
			<td><a href="https://wvclboard.wv.gov/www/download_resource.asp?id=117" target="_blank">December 21, 2022</a></td>
		</tr>
	</tbody>
</table>`;

describe("WV Contractor Licensing Board", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a license row keeps the search's own columns; no status or holder is published", () => {
    expect(clbHit(CLB_ROWS[0], "business")).toMatchObject({ businessName: "MARCH-WESTIN COMPANY INC", principal: null, licenseNumber: "WV001838",
      licenseType: "ELECTRICAL; GENERAL BUILDING; GENERAL ENGINEERING; HVAC; PIPING; PLUMBING; SPECIALTY", city: "MORGANTOWN, WV", expires: "2027-08-21",
      address: "360 FRONTIER AVENUE", phone: "(304) 599-4880", status: null, holder: null });
  });

  it("a sole proprietor's license names the person as the licensee and the DBA as the business", () => {
    expect(clbHit(CLB_ROWS[1], "principal")).toMatchObject({ businessName: "RANDALL A MARCHESI FLOORING", principal: "RANDALL A MARCHESI",
      people: [{ name: "RANDALL A MARCHESI", role: "Licensee, doing business as the name above" }], holder: null, city: "WASHINGTON, PA" });
  });

  it("the search name drops suffixes and punctuation (the field matches a phrase)", () => {
    expect(clbQuery("March-Westin Company, Inc.")).toBe("March-Westin");
  });

  it("searches as the page does (verifySearch, then verifyPage) with only the form's fields, and by license number", async () => {
    const calls: { url: string; body: URLSearchParams; headers: Headers }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).endsWith("/robots.txt")) return new Response("", { status: 404 });
      const body = new URLSearchParams(String(init.body ?? ""));
      calls.push({ url: String(url), body, headers: new Headers(init.headers) });
      if (body.get("action") === "verifySearch") return new Response(body.get("busiName") || body.get("licNo") ? CLB_COUNT : `{"records":[{"count":0}]}`, { status: 200, headers: { "set-cookie": "ASPSESSIONIDX=abc; path=/" } });
      return new Response(JSON.stringify({ records: body.get("pageNo") === "1" ? CLB_ROWS : [] }), { status: 200 });
    }));
    const clb = pack.liveLicenses!.find((s) => /Contractor Licensing Board/.test(s.source))!;
    const hits = await clb.search("March Westin Company", "company");
    expect(hits.map((h) => h.licenseNumber)).toEqual(["WV001838", "WV044047"]);
    const first = calls[0];
    expect(first.url).toBe("https://wvclboard.wv.gov/verify/ajax/");
    expect(Object.fromEntries(first.body)).toEqual({ action: "verifySearch", licNo: "", busiClas: "", busiName: "March Westin", busiDba: "", city: "", cnty: "" });
    expect(first.headers.has("referer")).toBe(false);
    expect(first.headers.has("x-requested-with")).toBe(false);
    expect(Object.fromEntries(calls[1].body)).toEqual({ action: "verifyPage", pageNo: "1", recsPage: "100" });
    expect(calls[1].headers.get("cookie")).toMatch(/ASPSESSIONIDX=abc/);
    expect(await clb.searchBy!({ type: "phone", value: "304 599 4880" })).toBeNull();
    const byNo = await clb.searchBy!({ type: "license", value: "wv001838" });
    expect(byNo!.map((h) => h.licenseNumber)).toEqual(["WV001838"]);
  });

  it("reads the disciplinary actions table, with the board's dates and the final order link", () => {
    const rows = parseClbActions(CLB_ACTIONS_PAGE);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual({ decided: "2022-08-25", licenses: ["WV053132"], licensee: "BENTZ PROPERTY & CONTRACTING LLC", orderDate: "2022-12-21",
      orderUrl: "https://wvclboard.wv.gov/www/download_resource.asp?id=117" });
    expect(rows[1].licensee).toBe("QUESENBERRY'S CONSTRUCTION LLC");
  });

  it("keeps businesses only: two companies on one row are split with their licenses, a person's DBA keeps the trade name", () => {
    const rows = parseClbActions(CLB_ACTIONS_PAGE);
    expect(clbActionBusinesses(rows[2])).toEqual([{ name: "PRIME EXTERIORS LLC", license: "WV062785" }, { name: "IRONCLAD CONSTRUCTION LLC", license: "WV064411" }]);
    expect(clbActionBusinesses(rows[3])).toEqual([{ name: "WV CONCRETE", license: "WV032163" }]);
    expect(clbActionBusinesses(rows[4])).toEqual([{ name: "BENTZ PROPERTY & CONTRACTING LLC", license: "WV053132" }]);
    expect(clbActionBusinesses({ decided: null, licenses: ["WV000001"], licensee: "JOHN SMITH", orderDate: null, orderUrl: null })).toEqual([]);
    const hit = clbActionHit(rows[3], clbActionBusinesses(rows[3])[0]);
    expect(hit).toMatchObject({ name: "WV CONCRETE", id: "WV032163", licenseNumber: "WV032163", category: "discipline", date: "2024-06-13", adverse: true,
      detail: "Final order 2024-06-14: https://wvclboard.wv.gov/www/download_resource.asp?id=129" });
    expect(JSON.stringify(hit)).not.toMatch(/BALLARD/);
  });

  it("a page without the table is an error, not zero actions; the source is registered and no longer listed as blocked", () => {
    expect(() => parseClbActions("<html>Service unavailable</html>")).toThrow(/unexpected page/);
    expect(pack.bulk!.find((b) => b.id === "wv-clb-actions")).toMatchObject({ companiesOnly: true, category: "discipline" });
    expect(pack.blocked!.some((b) => /wvclboard/.test(b))).toBe(false);
  });
});
