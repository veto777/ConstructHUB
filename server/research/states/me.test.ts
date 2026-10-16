import { afterEach, describe, expect, it, vi } from "vitest";
import { ASBESTOS_CONSULTANTS, ASBESTOS_CONTRACTORS, UST_INSTALLERS, asbestosHits, clearMaineCache, headedTable, pack, ustHits, ustPerson, setMaineFloorForTests } from "./me";
import { resetHostState } from "../http";

// Trimmed from www.maine.gov/dep/waste/asbestos/asbestoscontractors.html, fetched 2026-10-15.
const ASBESTOS = `<table cellspacing="0" class="mytable display">
        <thead>
          <tr>
            <th>Business Name</th>
            <th>Address</th>
            <th>City</th>
            <th>State</th>
    		<th>Zip</th>
            <th nowrap>Phone</th>
          </tr>
        </thead>
        <tbody>
	  <tr>
<td>Abram Environmental</td>
<td>PO Box 1627</td>
<td>Scarborough</td>
<td>ME</td>
<td>04070</td>
<td>2077562252</td>
</tr><tr>
<td>Acadia Contractors LLC</td>
<td>780 Auburn Road</td>
<td>Turner</td>
<td>ME</td>
<td>04240</td>
<td>2072255400</td>
</tr><tr>
<td>Kevin W. Smith &amp; Son, Inc.</td>
<td>580 Richville Road</td>
<td>Standish</td>
<td>ME</td>
<td>04084</td>
<td>2076421015</td>
</tr>

</tbody>
</table>`;

// Trimmed from www.maine.gov/dep/waste/busti/certifiedlist.html, fetched 2026-10-15.
const UST = `<table cellspacing="0" class="mytable display">
        <thead>
          <tr>
            <th>Name</th>
            <th>Company</th>
            <th>Town</th>
            <th nowrap>Phone</th>
          </tr>
        </thead>
        <tbody>
<tr>\r\n<td>Adjutant, Todd</td>\r\n<td></td>\r\n<td>Arundel</td>\r\n<td style="text-align:right">400-0324</td>\r\n</tr><tr>
<td>Boucher, Jr., Daniel (INSP)</td>\r\n<td>Advanced Tank Testing Services</td>\r\n<td>South Deerfield, MA</td>\r\n<td style="text-align:right">413-665-8300</td>\r\n</tr><tr>
<td>Lewis, Michael (INSP) (C1-3)</td>\r\n<td>Petroleum Maintenance Systems</td>\r\n<td>Auburn</td>\r\n<td style="text-align:right">777-3092</td>\r\n</tr><tr>
<td>St. Pierre, Marc (INSP)</td>\r\n<td>Simard and Sons, Inc.</td>\r\n<td>Lewiston</td>\r\n<td style="text-align:right">783-0297</td>\r\n</tr><tr>
<td>D'Amour, Joshua</td>\r\n<td>Simard and Sons, Inc.</td>\r\n<td>Lewiston</td>\r\n<td style="text-align:right">783-0297</td>\r\n</tr>
</tbody>
</table>`;

describe("Maine DEP tables", () => {
  it("reads the asbestos table by its own headers; every row is a business's license", () => {
    const hits = asbestosHits(ASBESTOS, ASBESTOS_CONTRACTORS, "Asbestos abatement contractor");
    expect(hits).toHaveLength(3);
    expect(hits[1]).toMatchObject({
      state: "ME", businessName: "Acadia Contractors LLC", city: "Turner", address: "780 Auburn Road, Turner, ME 04240",
      phone: "2072255400", holder: "business", licenseNumber: null, status: null, expires: null, licenseType: "Asbestos abatement contractor",
    });
    expect(hits[2].businessName).toBe("Kevin W. Smith & Son, Inc.");
  });

  it("refuses a table whose columns changed instead of mis-reading it", () => {
    expect(() => headedTable(ASBESTOS.replace("<th>City</th>", "<th>Town</th>"), ["Business Name", "Address", "City", "State", "Zip", "Phone"])).toThrow(/columns changed/);
    expect(() => headedTable("<p>none</p>", ["Name"])).toThrow(/no table/);
  });

  it("reads tank installers as individuals: no phone or street, the employer kept as company", () => {
    const hits = ustHits(UST);
    expect(hits.map((h) => h.principal)).toEqual(["Todd Adjutant", "Daniel Boucher Jr.", "Michael Lewis", "Marc St. Pierre", "Joshua D'Amour"]);
    for (const h of hits) { expect(h.holder).toBe("individual"); expect(h.phone).toBeNull(); expect(h.address).toBeNull(); }
    expect(hits[0]).toMatchObject({ businessName: null, city: "Arundel", licenseType: "Underground oil storage tank installer (may install and inspect)" });
    expect(hits[1]).toMatchObject({ businessName: "Advanced Tank Testing Services", city: "South Deerfield, MA", licenseType: "Underground oil storage tank inspector" });
    // A mark the page doesn't explain is shown as a code, not interpreted.
    expect(hits[2].specialty).toBe("code C1-3");
    expect(hits[3].people).toEqual([{ name: "Marc St. Pierre", role: "Certified individual (company: Simard and Sons, Inc.)" }]);
  });

  it("flips names with a generation suffix", () => {
    expect(ustPerson("Haskell, Jr., Edward")).toBe("Edward Haskell Jr.");
    expect(ustPerson("Lewis Jr., Michael")).toBe("Michael Lewis Jr.");
  });
});

describe("Maine live searches", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetHostState(); clearMaineCache(); setMaineFloorForTests(null); });
  const stub = () => {
    resetHostState(); clearMaineCache(); setMaineFloorForTests(1);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url); calls.push(u);
      if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /cgi-bin/\n", { status: 200 });
      if (u === UST_INSTALLERS) return new Response(UST, { status: 200 });
      if (u === ASBESTOS_CONTRACTORS) return new Response(ASBESTOS, { status: 200 });
      // A consultants list with one firm of its own (an empty table is an error now: round 8, finding 7).
      if (u === ASBESTOS_CONSULTANTS) return new Response(ASBESTOS.replace(/<tr>\s*<td>[\s\S]*<\/tr>/, "<tr><td>Northern Air Quality Consulting</td><td>1 Main St</td><td>Bangor</td><td>ME</td><td>04401</td><td>(207) 555-0101</td></tr>"), { status: 200 });
      return new Response("", { status: 404 });
    }));
    return calls;
  };

  it("asbestos: companies only, by whole words; phone is the one identifier", async () => {
    stub();
    const [asb] = pack.liveLicenses!;
    expect(asb.kinds).toEqual(["company"]);
    expect((await asb.search("Acadia Contractors", "company")).map((h) => h.businessName)).toEqual(["Acadia Contractors LLC"]);
    expect(await asb.search("Acadia", "person")).toEqual([]);
    expect(await asb.search("Smith", "company")).toHaveLength(1);
    expect(await asb.search("Smit", "company")).toHaveLength(0);
    expect((await asb.searchBy!({ type: "phone", value: "(207) 225-5400" }))!.map((h) => h.matchedOn)).toEqual(["phone"]);
    expect(await asb.searchBy!({ type: "license", value: "12345" })).toBeNull();
  });

  it("tank installers: a person by name, a company by the Company column; the page is fetched once", async () => {
    const calls = stub();
    const ust = pack.liveLicenses![1];
    expect(ust.searchBy).toBeUndefined();
    expect((await ust.search("Marc St. Pierre", "person")).map((h) => h.principal)).toEqual(["Marc St. Pierre"]);
    const co = await ust.search("Simard and Sons", "company");
    expect(co.map((h) => [h.principal, h.matchedOn, h.holder])).toEqual([["Marc St. Pierre", "business", "individual"], ["Joshua D'Amour", "business", "individual"]]);
    expect(calls.filter((u) => u === UST_INSTALLERS)).toHaveLength(1);
  });

  it("a non-2xx page is an error, never an empty result", async () => {
    resetHostState(); clearMaineCache(); setMaineFloorForTests(1);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("gone", { status: 404 })));
    await expect(pack.liveLicenses![1].search("Marc St. Pierre", "person")).rejects.toThrow(/HTTP 404/);
  });
});
