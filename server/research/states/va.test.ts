import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvRecords } from "../bulk";
import { checkDporColumns, EVA_STATUSES, evaBusinesses, evaHit, parseEvaReport, sccHit, vaLongDate, vaRegulantHit, vaReleaseLines, vaRevocationEntries, vaRevocationHits, vaRevocationIndex, vaRevokedBusiness, vaSpecialties } from "./va";

// Rows as published in DPOR's regulant lists on 2026-10-15 (2701__crnt.txt, 2710__crnt.txt), e-mail column blanked.
const HEADER = "BOARD\tOCCUPATION\tCERTIFICATE #\tINDIVIDUAL NAME\tBUSINESS NAME\tFIRST LINE ADDRESS\tSECOND LINE ADDRESS\tP O BOX #\tCITY\tSTATE\tFIVE DIGIT ZIP CODE\tZIP CODE EXTENSION\tPROVINCE\tCOUNTRY\tPOSTAL CODE\tEXPIRATION DATE\tCERTIFICATION DATE\tLICENSE RANK\tLICENSE SPECIALTY\tEMAILADDRESS";
const FIRM = "27\t01\t006397\t\tLANTZ CONSTRUCTION COMPANY\t539 SOUTH MAIN ST\t\t\tBROADWAY\tVA\t22815\t0000\t\t\t\t01/31/2028\t04/26/1962\tA\tCBC RBC \t";
const TRADESMAN = "27\t10\t070965\tDERRICK S SHIFFLETT \t\t567 MILL LN\t\t\tELKTON\tVA\t22827\t0000\t\t\t\t03/31/2028\t03/28/2019\tTRAD\tMPLB \t";

async function records(text: string): Promise<Record<string, string>[]> {
  const p = join(tmpdir(), `va-test-${Date.now()}.txt`);
  await fs.writeFile(p, text);
  const out: Record<string, string>[] = [];
  for await (const r of csvRecords(p, "\t")) out.push(r);
  await fs.rm(p);
  return out;
}

describe("Virginia DPOR regulant lists", () => {
  it("accepts the regulant-list layout and rejects an error page served in its place", async () => {
    const [firm] = await records(`${HEADER}\n${FIRM}\n`);
    expect(() => checkDporColumns(firm, "2701")).not.toThrow();
    const [page] = await records("<!DOCTYPE html>\n<html><head><title>Page not found | DPOR</title></head></html>\n");
    expect(() => checkDporColumns(page, "2705b")).toThrow(/not the regulant-list layout/);
  });

  it("reads a contractor firm and a tradesman", async () => {
    const [firm, trad] = await records(`${HEADER}\n${FIRM}\n${TRADESMAN}\n`);
    const a = vaRegulantHit(firm, { file: "2701", type: "Class A Contractor", holder: "business" as const }, "src")!;
    expect(a.business).toBe("LANTZ CONSTRUCTION COMPANY");
    expect(a.hit).toMatchObject({ licenseNumber: "2701006397", licenseType: "Class A Contractor", expires: "2028-01-31", city: "BROADWAY, VA", principal: null,
      specialty: "CBC (Commercial building), RBC (Residential building)", matchedOn: "business" });
    const t = vaRegulantHit(trad, { file: "2710", type: "Tradesman", holder: "individual" as const }, "src")!;
    expect(t.person).toBe("DERRICK S SHIFFLETT");
    expect(t.hit).toMatchObject({ licenseNumber: "2710070965", businessName: null, specialty: "MPLB (Master Plumber)", matchedOn: "principal" });
    // Round 2, decision 2: the list's class decides who holds the license.
    expect(a.hit.holder).toBe("business");
    expect(t.hit.holder).toBe("individual");
    // A tradesman row with an employer named is still the tradesman's license.
    expect(vaRegulantHit({ ...trad, "BUSINESS NAME": "SHIFFLETT PLUMBING LLC" }, { file: "2710", type: "Tradesman", holder: "individual" }, "src")!.hit.holder).toBe("individual");
    // A contractor row naming only a person doesn't say whether it is a sole proprietor's.
    expect(vaRegulantHit({ ...firm, "BUSINESS NAME": "", "INDIVIDUAL NAME": "JOHN DOE" }, { file: "2701", type: "Class A Contractor", holder: "business" }, "src")!.hit.holder).toBeNull();
  });

  it("shows codes DPOR doesn't define as codes", () => {
    expect(vaSpecialties("EMC H/H", "27")).toBe("code EMC, H/H (Highway/heavy)");
    expect(vaSpecialties("ENG ARC", "04")).toBe("code ENG, code ARC");
    expect(vaSpecialties("", "27")).toBeNull();
  });
});

describe("Virginia SCC open data", () => {
  const ds = { resource: "x", page: "https://data.virginia.gov/dataset/corporation", kind: "Corporation", loaded: "2024-11-14" };
  it("marks an automatic revocation adverse and a voluntary termination neutral", () => {
    // KRUSE CONSTRUCTION CO., INC., as data.virginia.gov returned it on 2026-10-15.
    const revoked = sccHit({ EntityID: "\tF0279614  ", Name: "KRUSE CONSTRUCTION CO., INC.", Status: "INACTIVE  ", StatusReason: "Automatically Revoked - Annual Report and/or Fees - Can Reinstate", "Status Date": "2024-08-31 00:00:00", IncorpDate: "1974-04-16 00:00:00", IncorpState: "PA        ", City: "DOWNINGTOWN", State: "Pennsylvania" }, ds);
    expect(revoked).toMatchObject({ id: "F0279614", adverse: true, date: "1974-04-16", endDate: "2024-08-31", city: "DOWNINGTOWN, Pennsylvania", status: "Corporation: INACTIVE, Automatically Revoked - Annual Report and/or Fees - Can Reinstate" });
    const vol = sccHit({ EntityID: "\tS4551604  ", Name: "Covenant Roofing & Construction, LLC", Status: "INACTIVE  ", StatusReason: "Voluntarily Canceled - Cannot Reinstate", "Status Date": "6/1/2022", IncorpDate: "5/16/2013", IncorpState: "VA        ", City: "Woodbridge", State: "Virginia  " }, { ...ds, kind: "LLC" });
    expect(vol).toMatchObject({ adverse: null, date: "2013-05-16", endDate: "2022-06-01", status: "LLC: INACTIVE, Voluntarily Canceled - Cannot Reinstate" });
  });
});

describe("Virginia DPOR contractor revocation releases", () => {
  // The start of the August 19, 2025 release as DPOR published it (08.19.25 license revocation template for website.txt).
  const TXT = [
    "REVOCATIONS", "", "Meeting Date - August 19, 2025", "", "Board Name - Contractors", "", "",
    "John G & Paul D. Williams, dba R L Williams Contractors", "MARION, VA ", "Case No. 2024-02689 ", "License Number 2705011904", "", "",
    "Shipley Builders Inc. ", "LITTLETON, NC", "Case No. 2024-00811", "License Number 2705127480", "", "",
    "Luke Britton dba Luke Britton Marine Construction", "CHINCOTEAGUE ISLAND, VA", "Case No. 2024-02448", "License Number 27051", "35164", "", "",
    "Sturdevant Expressions LLC dba Sturdevant Construction", "NEWPORT NEWS, VA ", "Case No. 2024-01978", "Case No. 2025-00304", "License Number 2705094568", "",
  ].join("\r\n");
  const TXT_URL = "https://www.dpor.virginia.gov/sites/default/files/News/08.19.25%20license%20revocation%20template%20for%20website.txt";

  it("reads every entry of a text release, a license number broken over two lines and repeated case lines too", () => {
    const { entries, unread } = vaRevocationEntries(vaReleaseLines(TXT, "text"));
    expect(unread).toBe(0);
    expect(entries).toEqual([
      { name: "John G & Paul D. Williams, dba R L Williams Contractors", city: "MARION, VA", cases: ["2024-02689"], license: "2705011904" },
      { name: "Shipley Builders Inc.", city: "LITTLETON, NC", cases: ["2024-00811"], license: "2705127480" },
      { name: "Luke Britton dba Luke Britton Marine Construction", city: "CHINCOTEAGUE ISLAND, VA", cases: ["2024-02448"], license: "2705135164" },
      { name: "Sturdevant Expressions LLC dba Sturdevant Construction", city: "NEWPORT NEWS, VA", cases: ["2024-01978", "2025-00304"], license: "2705094568" },
    ]);
  });

  it("keeps businesses only, revoked (adverse) with the release's listed date, and drops the people", () => {
    const r = vaRevocationHits(vaReleaseLines(TXT, "text"), TXT_URL, "August 19, 2025");
    expect(r).toMatchObject({ entries: 4, individuals: 2, unread: 0 });
    expect(r.hits.map((h) => h.name)).toEqual(["Shipley Builders Inc.", "Sturdevant Expressions LLC dba Sturdevant Construction"]);
    expect(r.hits[1]).toEqual({
      state: "VA", source: "Virginia DPOR Board for Contractors license revocations (news releases)", sourceUrl: TXT_URL, category: "discipline",
      name: "Sturdevant Expressions LLC dba Sturdevant Construction", id: "2024-01978, 2025-00304", date: "2025-08-19", endDate: null,
      status: "License revoked by the Board for Contractors", city: "NEWPORT NEWS, VA",
      detail: "Board for Contractors meeting of August 19, 2025; cases 2024-01978, 2025-00304; license 2705094568; DPOR news release listed August 19, 2025",
      amount: null, adverse: true, licenseNumber: "2705094568",
    });
    // A text that doesn't say "revocations" or "revoked" is not read as revocations.
    expect(vaRevocationHits(vaReleaseLines(TXT.replace("REVOCATIONS", "ACTIONS"), "text"), TXT_URL, null).hits).toEqual([]);
  });

  it("reads a release page (October 25, 2022) with case and license on one line", () => {
    // From https://www.dpor.virginia.gov/10-25-22_Contractor_revos, trimmed.
    const html = `<article><div property="schema:text" class="clearfix text-formatted field field--name-body"><p>10/25/2022<br>
<a href="https://www.dpor.virginia.gov/Contact/Media-Inquiries/">Media Contact</a><br>
&nbsp;<br>
________________________________________<br>
RICHMOND – The Board for Contractors revoked 9 licenses at its meeting Tuesday, October 25, 2022. Following is a summary of the Board’s actions.</p>
<p><strong>ALEXANDER LEWIS LEE T/A DR. LEE’S HOME REPAIR</strong><br>
DANVILLE, VA 24540<br>
File No. 2020-00746 | License No. 2705146209</p>
<p><strong>STILTZ OF VIRGINIA LLC</strong><br>
RICHMOND, VA 23225<br>
File no. 2022-01477 | License no. 2705173246&nbsp;&nbsp; &nbsp;</p>
<p><strong>TSOS LLC T/A BERRIZ DESIGN BUILD GROUP</strong><br>
FAIRFAX, VA<br>
File No. 2022-0095 | License No. 2705145177</p>
</div>
<div class="field field--name-field-accordion-widget"></div></article>`;
    const r = vaRevocationHits(vaReleaseLines(html, "html"), "https://www.dpor.virginia.gov/10-25-22_Contractor_revos", "October 25, 2022");
    expect(r).toMatchObject({ entries: 3, individuals: 1, unread: 0 });
    expect(r.hits.map((h) => [h.name, h.city, h.id, h.licenseNumber, h.date])).toEqual([
      ["STILTZ OF VIRGINIA LLC", "RICHMOND, VA 23225", "2022-01477", "2705173246", "2022-10-25"],
      ["TSOS LLC T/A BERRIZ DESIGN BUILD GROUP", "FAIRFAX, VA", "2022-0095", "2705145177", "2022-10-25"],
    ]);
    expect(r.hits[0].detail).toContain("Board for Contractors meeting of October 25, 2022");
  });

  it("drops a license of an individual's class whatever the name, and names without an entity word", () => {
    // December 10, 2024 release: a tradesman (2710) license, and a business-class license under a person's name.
    const lines = vaReleaseLines(["REVOCATIONS", "LEWIS, CORY RYAN", "Hurt, Virginia 24563", "Case No. 2024-01773", "License Number 2710072822",
      "JAMI CIROTTI", "South Boston, Virginia 24592", "Case No. 2024-01584", "License Number 2705124685",
      "WATERLINE AQUATICS INC", "Remington, Virginia 22734", "Case No. 2024-01639", "License Number 2705140211"].join("\n"), "text");
    const r = vaRevocationHits(lines, "u", "December 10, 2024");
    expect(r.individuals).toBe(2);
    expect(r.hits.map((h) => h.name)).toEqual(["WATERLINE AQUATICS INC"]);
    expect(vaRevokedBusiness("Rodney K Bryant Sr dba Bryant Plumbing Co")).toBe(false); // the licensee is the person before "dba"
    expect(vaRevokedBusiness("MONTOYA CONSTRUCTION OF MARYLAND INC., t/a MONTOYA CONSTRUCTION INC")).toBe(true);
    expect(vaRevokedBusiness("VINTAGE HOMES CL 1 LC")).toBe(true);
    expect(vaRevokedBusiness("ADVANCE ELECTRICAL TECHNOLOGY")).toBe(false); // no entity word: not shown to be a business
    expect(vaRevokedBusiness("CHERI E SIPE & SCOTTY D SIPE DBA SIPE’S CONSTRUCTION")).toBe(false);
  });

  it("lists the contractor releases from the News Releases page, with DPOR's printed dates", () => {
    // From https://www.dpor.virginia.gov/NewsReleases on 2026-10-15, trimmed.
    const page = `<h3>2026</h3><ul>
	<li><a href="/sites/default/files/News/REVOCATIONS%20REB%20SEPTEMBER%202026.txt">Real Estate License Revocations</a> | September 10, 2026</li>
	<li><a href="/sites/default/files/News/Contractors%20license%20revocation%20August%2025.txt">Contractor License Revocations</a> | August 25, 2026</li></ul>
<h3>2021</h3><ul>
	<li><a href="/News/Press-Releases/10-26-21_Contractor_revos">Contractor License Revocations</a> | Oct. 26. 2021</li></ul>`;
    expect(vaRevocationIndex(page)).toEqual([
      { url: "https://www.dpor.virginia.gov/sites/default/files/News/Contractors%20license%20revocation%20August%2025.txt", listed: "August 25, 2026" },
      { url: "https://www.dpor.virginia.gov/News/Press-Releases/10-26-21_Contractor_revos", listed: "Oct. 26. 2021" },
    ]);
    expect(vaLongDate("Oct. 26. 2021")).toBe("2021-10-26");
    expect(vaLongDate("Sept. 22, 2020")).toBe("2020-09-22");
    expect(vaLongDate("sometime in 2021")).toBeNull();
  });
});

// Trimmed from logi.cgieva.com Report9020_Data (eVA Inactive Vendor List, eVA Status = Debarred), saved 2026-10-15
// (drill-down links shortened).
const EVA_HEAD = `<title>eVA Inactive Vendor List</title><TABLE><THEAD><TR><TH id="colLGL_NM-TH">Legal Name</TH></TR></THEAD>`;
const EVA_DEBARRED = `${EVA_HEAD}
<TR Row="1" CLASS=""><TD id="colSTATUS_Row1" CLASS="rdThemeDataTableCell alignLeft"><SPAN id="lblSTATUS_Row1">Debarred</SPAN><BR /><SPAN  id="lblREG_TYPE_Row1"><font color="#FF0000" size="1">Self</font></SPAN></TD><TD id="colHQ_Row1" CLASS="rdThemeDataTableCell alignLeft"><SPAN CLASS="headerTextSmall10" id="lblHQ_Row1">Y</SPAN></TD><TD id="colVEND_CUST_CD_Row1" CLASS="rdThemeDataTableCell alignLeft"> <a href="#" id="actDrilldown_Row1"><SPAN TITLE="Click for more detail!" CLASS="DrillDownUnderline" id="lblVEND_CUST_CD_Row1">E34719</SPAN></a></TD><TD id="colLGL_NM_Row1" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLGL_NM_Row1">AccesSecurity,&#160;Inc.</SPAN></TD><TD id="colLOC_NM_Row1" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLOC_NM_Row1">AccesSecurity</SPAN></TD><TD id="colSTR_1_NM_Row1" CLASS="rdThemeDataTableCell left"><SPAN  id="lblSTR_1_NM_Row1">6&#160;Royal&#160;Street,&#160;SW</SPAN></TD><TD id="colCITY_NM_Row1" CLASS="rdThemeDataTableCell left"><SPAN id="lblCITY_NM_Row1">Leesburg</SPAN></TD><TD id="colST_Row1" CLASS="rdThemeDataTableCell left"><SPAN id="lblST_Row1">VA</SPAN></TD><TD id="colZIP_Row1" CLASS="rdThemeDataTableCell left"><SPAN id="lblZIP_Row1">20176</SPAN></TD></TR>
<TR Row="18" CLASS="ThemeAlternatingRow TD"><TD id="colSTATUS_Row18" CLASS="rdThemeDataTableCell alignLeft"><SPAN id="lblSTATUS_Row18">Debarred</SPAN><BR /><SPAN  id="lblREG_TYPE_Row18"><font color="#FF0000" size="1">State</font></SPAN></TD><TD id="colHQ_Row18" CLASS="rdThemeDataTableCell alignLeft"><SPAN CLASS="headerTextSmall10" id="lblHQ_Row18">Y</SPAN></TD><TD id="colVEND_CUST_CD_Row18" CLASS="rdThemeDataTableCell alignLeft"> <a href="#" id="actDrilldown_Row18"><SPAN TITLE="Click for more detail!" CLASS="DrillDownUnderline" id="lblVEND_CUST_CD_Row18">VS0000251080</SPAN></a></TD><TD id="colLGL_NM_Row18" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLGL_NM_Row18">David&#160;Horton</SPAN></TD><TD id="colLOC_NM_Row18" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLOC_NM_Row18">Newport&#160;News&#160;VA</SPAN></TD><TD id="colSTR_1_NM_Row18" CLASS="rdThemeDataTableCell left"><SPAN  id="lblSTR_1_NM_Row18">716&#160;Mainsail&#160;Dr</SPAN></TD><TD id="colCITY_NM_Row18" CLASS="rdThemeDataTableCell left"><SPAN id="lblCITY_NM_Row18">Newport News</SPAN></TD><TD id="colST_Row18" CLASS="rdThemeDataTableCell left"><SPAN id="lblST_Row18">VA</SPAN></TD><TD id="colZIP_Row18" CLASS="rdThemeDataTableCell left"><SPAN id="lblZIP_Row18">23608-4712</SPAN></TD></TR>
<TR Row="19" CLASS=""><TD id="colSTATUS_Row19" CLASS="rdThemeDataTableCell alignLeft"><SPAN id="lblSTATUS_Row19">Debarred</SPAN><BR /><SPAN  id="lblREG_TYPE_Row19"><font color="#FF0000" size="1">Self</font></SPAN></TD><TD id="colHQ_Row19" CLASS="rdThemeDataTableCell alignLeft"><SPAN CLASS="headerTextSmall10" id="lblHQ_Row19">Y</SPAN></TD><TD id="colVEND_CUST_CD_Row19" CLASS="rdThemeDataTableCell alignLeft"> <a href="#" id="actDrilldown_Row19"><SPAN TITLE="Click for more detail!" CLASS="DrillDownUnderline" id="lblVEND_CUST_CD_Row19">VS0000087069</SPAN></a></TD><TD id="colLGL_NM_Row19" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLGL_NM_Row19">David&#160;Horton&#160;Logistics</SPAN></TD><TD id="colLOC_NM_Row19" CLASS="rdThemeDataTableCell left"><SPAN  id="lblLOC_NM_Row19">Newport&#160;News&#160;Office</SPAN></TD><TD id="colSTR_1_NM_Row19" CLASS="rdThemeDataTableCell left"><SPAN  id="lblSTR_1_NM_Row19">POBox&#160;14051</SPAN></TD><TD id="colCITY_NM_Row19" CLASS="rdThemeDataTableCell left"><SPAN id="lblCITY_NM_Row19">Newport News</SPAN></TD><TD id="colST_Row19" CLASS="rdThemeDataTableCell left"><SPAN id="lblST_Row19">VA</SPAN></TD><TD id="colZIP_Row19" CLASS="rdThemeDataTableCell left"><SPAN id="lblZIP_Row19">23608</SPAN></TD></TR>
</TABLE>`;
const EVA_NONE = `${EVA_HEAD}</TABLE><SPAN id="divShowNoData"><b><p align="center">No data found. Please search for a different value</p></b></SPAN>`;

describe("Virginia eVA Inactive Vendor List", () => {
  it("reads the report's rows", () => {
    const rows = parseEvaReport(EVA_DEBARRED);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ status: "Debarred", entered: "Self", evaId: "E34719", name: "AccesSecurity, Inc.", street: "6 Royal Street, SW", city: "Leesburg", st: "VA", zip: "20176" });
  });
  it("treats \"No data found\" as empty and anything else unexpected as an error", () => {
    expect(parseEvaReport(EVA_NONE)).toEqual([]);
    expect(() => parseEvaReport(EVA_HEAD)).toThrow(/no rows/);
    expect(() => parseEvaReport("<html>Server error</html>")).toThrow(/unexpected page/);
  });
  it("keeps companies only", () => {
    const names = evaBusinesses(parseEvaReport(EVA_DEBARRED)).map((r) => r.name);
    expect(names).toContain("AccesSecurity, Inc.");
    expect(names).not.toContain("David Horton");
  });
  it("makes a debarment hit with no invented dates", () => {
    const [r] = parseEvaReport(EVA_DEBARRED);
    expect(evaHit(r, EVA_STATUSES[0])).toMatchObject({ state: "VA", category: "debarment", name: "AccesSecurity, Inc.", id: "eVA ID E34719", date: null, endDate: null, city: "Leesburg, VA", address: "6 Royal Street, SW, Leesburg, VA 20176", adverse: true });
  });
});
