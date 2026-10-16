import { afterEach, describe, expect, it, vi } from "vitest";
import { evsBusinesses, longDates, pack, parseEvs, parseWvDebar, sfmHits, wvDebarBusinesses, wvDebarHit } from "./wv";

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
    expect(pack.liveLicenses!.map((s) => s.source)).toEqual(["WV State Fire Marshal electrician licenses"]);
    expect(pack.blocked!.some((b) => /wvlabor\.com.*HTTP 500/.test(b))).toBe(true);
  });
  it("the person-only lookups say so, and their licenses are individuals' (decisions 2, 8)", () => {
    for (const s of pack.liveLicenses!) expect(s.kinds).toEqual(["person"]);
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
